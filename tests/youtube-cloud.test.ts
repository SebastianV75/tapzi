import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createYouTubeHandler } from '../server/youtube.ts';
import { CloudError, downloadAudio, downloadURL, MAX_REMOTE_BYTES, publicAddress, publicIPv4, tubeMP3 } from '../server/cloud-audio.ts';
import type { AudioResponse, AudioTransport } from '../server/cloud-audio.ts';

const id = 'dQw4w9WgXcQ', code = 'a'.repeat(32), secret = 'provider-secret-must-not-leak';
const media = Buffer.from('ID3\x04\x00\x00synthetic-test-header');
const abort = () => new AbortController();
const providerJSON = (extra = {}) => ({ status: 'success', result: [{ videoId: id, title: 'Mi sonido', duration: 10, dlurl: 'https://cdn.example/audio.mp3', ...extra }] });
const fakeFetch = (value: unknown, status = 200) => (async () => Response.json(value, { status })) as typeof fetch;
const audioResponse = (extra: Partial<AudioResponse> = {}): AudioResponse => ({ status: 200, type: 'audio/mpeg', body: Readable.from([media]), ...extra });

test('provider submits only the validated video ID and keeps credentials in headers', async () => {
  let endpoint = '', sent: RequestInit | undefined;
  const fetcher = (async (url, init) => { endpoint = String(url); sent = init; return Response.json(providerJSON()); }) as typeof fetch;
  const result = await tubeMP3(id, secret, abort().signal, fetcher);
  assert.equal(endpoint, 'https://tube-mp31.p.rapidapi.com/api/json');
  assert.equal(sent?.body, JSON.stringify({ videoId: id }));
  assert.equal(new Headers(sent?.headers).get('X-RapidAPI-Key'), secret);
  assert.equal(sent?.redirect, 'error'); assert.equal(result.title, 'Mi sonido');
});
test('provider failure messages do not expose upstream secrets or URLs', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(tubeMP3(id, secret, abort().signal, fakeFetch({ error: secret }, status)), error => error instanceof CloudError && !error.message.includes(secret));
  }
  for (const data of [{ status: 'success', result: [] }, { status: 'pending' }, providerJSON({ videoId: 'different-id' }), providerJSON({ duration: 601 }), providerJSON({ duration: null })]) {
    await assert.rejects(tubeMP3(id, secret, abort().signal, fakeFetch(data)));
  }
});
test('provider accepts safe text titles and rejects oversized JSON', async () => {
  const value = await tubeMP3(id, secret, abort().signal, fakeFetch(providerJSON({ title: '<b>Mi/audio</b>\r\n' })));
  assert.equal(value.title, '<b>Mi audio< b>');
  await assert.rejects(tubeMP3(id, secret, abort().signal, fakeFetch({ junk: 'x'.repeat(130 * 1024) })));
});
test('download URL rejects local networks, credentials, non-HTTPS and alternate ports', () => {
  for (const value of ['http://cdn.example/a', 'https://127.0.0.1/a', 'https://0x7f000001/a', 'https://2130706433/a', 'https://[::1]/a', 'https://[::ffff:127.0.0.1]/a', 'https://169.254.169.254/a', 'https://user:pass@cdn.example/a', 'https://cdn.example:8443/a', 'file:///tmp/audio']) assert.throws(() => downloadURL(value), value);
  assert.equal(downloadURL('https://cdn.example/a?q=signed#fragment').href, 'https://cdn.example/a?q=signed');
  for (const address of ['10.0.0.1', '100.64.0.1', '172.16.0.1', '192.168.1.1', '198.18.0.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1']) assert.equal(publicIPv4(address), false, address);
  assert.equal(publicIPv4('8.8.8.8'), true);
});
test('DNS validation rejects mixed public/private answers and pins a public IPv4', async () => {
  assert.equal(await publicAddress('cdn.example', async () => [{ address: '8.8.8.8', family: 4 }]), '8.8.8.8');
  for (const answers of [[], [{ address: '10.0.0.1', family: 4 }], [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }], [{ address: '::1', family: 6 }]]) await assert.rejects(publicAddress('cdn.example', async () => answers));
});
test('download follows bounded HTTPS redirects and revalidates every destination', async () => {
  const seen: string[] = [];
  const transport: AudioTransport = async url => { seen.push(url.href); return seen.length === 1 ? audioResponse({ status: 302, location: '/final' }) : audioResponse(); };
  assert.deepEqual(await downloadAudio('https://cdn.example/start', abort().signal, transport), media);
  assert.deepEqual(seen, ['https://cdn.example/start', 'https://cdn.example/final']);
  let attempts = 0;
  await assert.rejects(downloadAudio('https://cdn.example/start', abort().signal, async () => { attempts++; return audioResponse({ status: 302, location: 'https://127.0.0.1/admin' }); }));
  assert.equal(attempts, 1);
  attempts = 0;
  await assert.rejects(downloadAudio('https://cdn.example/start', abort().signal, async () => { attempts++; return audioResponse({ status: 302, location: '/again' }); }));
  assert.equal(attempts, 4);
});
test('download rejects oversized, HTML, empty and compressed responses and destroys streams', async () => {
  const cases: Partial<AudioResponse>[] = [
    { length: String(MAX_REMOTE_BYTES + 1) }, { body: Readable.from([Buffer.alloc(MAX_REMOTE_BYTES), Buffer.from('x')]) },
    { type: 'text/html' }, { body: Readable.from([Buffer.from('<html>not audio</html>')]) }, { body: Readable.from([]) }, { encoding: 'gzip' },
  ];
  for (const item of cases) {
    const response = audioResponse(item);
    await assert.rejects(downloadAudio('https://cdn.example/audio', abort().signal, async () => response));
    assert.equal(response.body.destroyed, true);
  }
});
test('download honors cancellation before issuing a request', async () => {
  const controller = abort(); controller.abort(); let called = false;
  await assert.rejects(downloadAudio('https://cdn.example/audio', controller.signal, async () => { called = true; return audioResponse(); }));
  assert.equal(called, false);
});

async function endpoint(t: TestContext, envOverrides = {}, deps: Parameters<typeof createYouTubeHandler>[1] = {}) {
  let calls = 0;
  const handler = createYouTubeHandler({ RAPIDAPI_KEY: secret, TAPZI_IMPORT_ACCESS_CODE: code, TAPZI_APP_ORIGIN: 'https://tapzi.test', VERCEL: '1', ...envOverrides }, {
    provider: async () => { calls++; return { title: 'Mi sonido', url: 'https://cdn.example/audio' }; }, download: async () => media, ...deps,
  });
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/api/youtube`;
  const post = (body: unknown = { url: `https://youtu.be/${id}` }, headers = {}) => fetch(url, { method: 'POST', headers: { Origin: 'https://tapzi.test', Authorization: `Bearer ${code}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { url, post, calls: () => calls };
}
test('disabled endpoint reports configuration honestly and never calls provider', async t => {
  const api = await endpoint(t, { RAPIDAPI_KEY: '' });
  const status = await fetch(api.url); assert.deepEqual(await status.json(), { enabled: false, authorized: false });
  assert.equal((await api.post()).status, 503); assert.equal(api.calls(), 0);
  const weak = await endpoint(t, { TAPZI_IMPORT_ACCESS_CODE: '1234' }); assert.equal((await weak.post()).status, 503);
});
test('access, origin, method and invalid requests reject before consuming provider quota', async t => {
  const api = await endpoint(t);
  assert.equal((await api.post(undefined, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await api.post(undefined, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await api.post(undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await fetch(api.url, { method: 'DELETE' })).status, 405);
  assert.equal((await api.post({ url: 'https://youtube.com.evil.test/watch?v=' + id })).status, 400);
  assert.equal((await api.post({ url: 'https://youtu.be/' + id, endpoint: 'https://evil.example' })).status, 400);
  assert.equal((await api.post({ url: 'x'.repeat(5000) })).status, 413);
  assert.equal((await api.post(undefined, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal(api.calls(), 0);
});
test('authenticated import returns bytes without exposing credentials and paces requests', async t => {
  const api = await endpoint(t);
  const response = await api.post();
  assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'audio/mpeg');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(decodeURIComponent(response.headers.get('X-Tapzi-Title')!), 'Mi sonido');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), media);
  assert.ok(!JSON.stringify([...response.headers]).includes(secret));
  for (let i = 0; i < 4; i++) assert.equal((await api.post()).status, 200);
  assert.equal((await api.post()).status, 429); assert.equal(api.calls(), 5);
});
test('concurrent import is rejected and disconnect cancels upstream work', async t => {
  let started = false, aborted = false;
  const api = await endpoint(t, {}, { provider: async (_id, _key, signal) => {
    started = true;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true }));
  } });
  const controller = abort();
  const pending = fetch(api.url, { method: 'POST', headers: { Origin: 'https://tapzi.test', Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: `https://youtu.be/${id}` }), signal: controller.signal }).catch(() => null);
  for (let i = 0; i < 100 && !started; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(started, true); assert.equal((await api.post()).status, 429);
  controller.abort(); await pending;
  for (let i = 0; i < 100 && !aborted; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(aborted, true);
});
