import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, request } from 'node:http';
import { mkdtemp, writeFile, readFile, readdir, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImporter } from '../server/importer.ts';

const id = 'fTCbikSOYBg';
const url = `https://youtu.be/${id}?ignored=$(touch%20bad)`;
async function fixture(mode = 'ok', timeoutMs = 3000, allowLan = false) {
  const root = await mkdtemp(join(tmpdir(), 'tapzi-test-'));
  const executable = join(root, 'yt-dlp');
  const log = join(root, 'argv');
  await writeFile(executable, `#!${process.execPath}
import { appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + '\\n');
appendFileSync(process.env.FAKE_LOG + '.cwd', process.cwd() + '\\n');
const mode = process.env.FAKE_MODE;
if (mode === 'timeout') {
 spawn(process.execPath, ['-e', "setInterval(() => require('node:fs').appendFileSync(process.env.FAKE_LOG + '.heartbeat', 'x'), 10)"], { stdio: 'ignore' });
 setInterval(() => {}, 1000);
}
else if (mode === 'noisy') { process.stdout.write('x'.repeat(1100000)); }
else if (mode === 'bot') { console.error('Sign in to confirm you’re not a bot. PRIVATE PATH'); process.exitCode = 1; }
else if (mode === 'fail') { console.error('PRIVATE PATH'); process.exitCode = 1; }
else if (mode === 'ffmpeg') { console.error('ffmpeg not found'); process.exitCode = 1; }
else if (args.includes('--dump-single-json')) {
 console.log(JSON.stringify({ duration: mode === 'unknown' ? null : mode === 'long' ? 601 : 30, is_live: mode === 'live', filesize: mode === 'large' ? 30000000 : 1000 }));
} else { writeFileSync(args[args.indexOf('--output') + 1].replace('%(ext)s', 'mp3'), mode === 'oversize' ? Buffer.alloc(26 * 1024 * 1024) : mode === 'empty' ? '' : 'MP3 bytes'); }
`);
  await chmod(executable, 0o700);
  const middleware = createImporter({
    env: { ...process.env, PATH: root + ':' + (process.env.PATH ?? ''),
      TAPZI_YTDLP_PATH: mode === 'path' ? undefined : mode === 'missing' ? join(root, 'absent') : executable,
      TAPZI_FFMPEG_PATH: undefined, TAPZI_ALLOW_LAN_IMPORT: allowLan ? '1' : '', FAKE_MODE: mode, FAKE_LOG: log },
    timeoutMs,
  });
  const server = createServer((req, res) => { middleware(req, res, () => { res.statusCode = 404; res.end(); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  return {
    root, base,
    async post(body: unknown = { url }, headers: Record<string, string> = {}, path = '/api/import-audio', method = 'POST') {
      return new Promise<Response>((resolve, reject) => {
        const req = request(base + path, { method, headers: { origin: base, 'content-type': 'application/json', ...headers } }, res => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode,
            headers: res.headers as Record<string, string> })));
        });
        req.on('error', reject);
        req.end(method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
      });
    },
    async calls(): Promise<string[][]> { try { return (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[]); } catch { return []; } },
    async heartbeat() { return readFile(log + '.heartbeat', 'utf8').catch(() => ''); },
    async clean() {
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
      try {
        const directories = (await readFile(log + '.cwd', 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
        for (const directory of directories) await assert.rejects(readdir(directory), { code: 'ENOENT' });
      } finally { await rm(root, { recursive: true, force: true }); }
    },
  };
}

for (const clip of [{}, { start: '0:02', end: '0:05' }, { start: '2' }, { end: '5' }]) {
  test(`success: canonical argv and ${JSON.stringify(clip)}`, async () => {
    const f = await fixture();
    try {
      const response = await f.post({ url, ...clip });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'audio/mpeg');
      assert.equal(response.headers.get('content-disposition'), `attachment; filename="tapzi-${id}.mp3"`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(await response.text(), 'MP3 bytes');
      const calls = await f.calls();
      assert.equal(calls.length, 2);
      for (const args of calls) {
        assert.deepEqual(args.slice(-2), ['--', `https://www.youtube.com/watch?v=${id}`]);
        for (const flag of ['--ignore-config', '--no-plugin-dirs', '--no-playlist', '--no-cache-dir']) assert.ok(args.includes(flag));
        assert.equal(args[args.indexOf('--js-runtimes') + 1], 'node');
        assert.ok(!args.some(arg => arg.includes('touch') || arg.includes('cookies')));
      }
      const output = calls[1][calls[1].indexOf('--output') + 1];
      await assert.rejects(readdir(join(output, '..')), { code: 'ENOENT' });
      if ('start' in clip || 'end' in clip) {
        assert.equal(calls[1][calls[1].indexOf('--download-sections') + 1], `*${'start' in clip ? 2 : 0}-${'end' in clip ? 5 : 30}`);
      } else assert.ok(!calls[1].includes('--download-sections'));
    } finally { await f.clean(); }
  });
}

test('rejections leave commands and busy state untouched', async () => {
  const f = await fixture();
  try {
    const cases: [unknown, Record<string, string>, number, string][] = [
      [{ url: 'https://example.com/evil' }, {}, 400, 'Usá un enlace de YouTube, Shorts o youtu.be.'],
      [{ url, start: '1;echo' }, {}, 400, 'Usá segundos o un tiempo como 0:12.'],
      [{ url, start: '5', end: '4' }, {}, 400, 'El final debe ser posterior al inicio.'],
      [{ url, start: 2 }, {}, 400, 'Use JSON with url and optional start/end strings.'],
      [{ url: 2 }, {}, 400, 'Use JSON with url and optional start/end strings.'],
      ['{', {}, 400, 'Send valid JSON.'],
      [' '.repeat(4097), {}, 413, 'Import JSON must be at most 4 KB.'],
      [{ url }, { 'content-type': 'text/plain' }, 415, 'Send application/json.'],
      [{ url }, { origin: '' }, 403, 'Import requires a same-origin request.'],
      [{ url }, { origin: 'null' }, 403, 'Import requires a same-origin request.'],
      [{ url }, { 'sec-fetch-site': 'cross-site' }, 403, 'Import requires a same-origin request.'],
      [{ url }, { origin: 'https://evil.example' }, 403, 'Import requires a same-origin request.'],
      [{ url }, { host: 'evil.example', origin: 'http://evil.example' }, 403, 'Import is loopback-only. Use TAPZI_ALLOW_LAN_IMPORT=1 only on a trusted network.'],
    ];
    for (const [body, headers, status, error] of cases) {
      const response = await f.post(body, headers);
      assert.equal(response.status, status);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { error });
      assert.deepEqual(await f.calls(), []);
    }
    assert.equal((await f.post(undefined, {}, '/api/import-audio', 'GET')).status, 405);
    assert.equal((await f.post(undefined, {}, '/api/import-audio?bypass=1')).status, 404);
    assert.equal((await f.post()).status, 200);
  } finally { await f.clean(); }
});

for (const [mode, status, error] of [
  ['missing', 503, 'Install current yt-dlp with EJS and a JavaScript runtime; put yt-dlp on PATH or set TAPZI_YTDLP_PATH.'],
  ['ffmpeg', 503, 'Install FFmpeg (including ffprobe) on PATH or set TAPZI_FFMPEG_PATH.'],
  ['bot', 502, 'YouTube blocked this request with a sign-in/bot check. Try on your local network later; no audio was saved.'],
  ['fail', 502, 'Audio extraction failed. Check your local tools and video availability; no audio was saved.'],
  ['empty', 502, 'Audio extraction failed. Check your local tools and video availability; no audio was saved.'],
  ['timeout', 504, 'Import timed out. Try a shorter clip or retry later; no audio was saved.'],
  ['noisy', 502, 'Audio extraction failed. Check your local tools and video availability; no audio was saved.'],
  ['unknown', 422, 'Use a non-live video with a known duration up to 600 seconds and source size up to 25 MB.'],
  ['oversize', 422, 'Use a non-live video with a known duration up to 600 seconds and source size up to 25 MB.'],
  ['long', 422, 'Use a non-live video with a known duration up to 600 seconds and source size up to 25 MB.'],
  ['live', 422, 'Use a non-live video with a known duration up to 600 seconds and source size up to 25 MB.'],
  ['large', 422, 'Use a non-live video with a known duration up to 600 seconds and source size up to 25 MB.'],
] as const) {
  test(`safe failure: ${mode}`, async () => {
    const f = await fixture(mode, mode === 'timeout' ? 150 : 3000);
    try {
      const response = await f.post();
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error });
      const calls = await f.calls();
      for (const args of calls.filter(args => args.includes('--output'))) {
        await assert.rejects(readdir(join(args[args.indexOf('--output') + 1], '..')), { code: 'ENOENT' });
      }
    } finally { await f.clean(); }
  });
}

test('concurrent requests are rejected; cancellation releases work', async () => {
  const f = await fixture('timeout', 1000);
  const controller = new AbortController();
  try {
    const pending = fetch(f.base + '/api/import-audio', { method: 'POST', signal: controller.signal,
      headers: { origin: f.base, 'content-type': 'application/json' }, body: JSON.stringify({ url }) }).catch(() => null);
    for (let i = 0; i < 100 && !(await f.heartbeat()).length; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok((await f.heartbeat()).length, 'descendant started');
    const busy = await f.post();
    assert.equal(busy.status, 429);
    assert.deepEqual(await busy.json(), { error: 'An import is already running. Try again when it finishes.' });
    controller.abort();
    await pending;
    await new Promise(resolve => setTimeout(resolve, 100));
    const stopped = await f.heartbeat();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await f.heartbeat(), stopped, 'descendant must stop on cancellation');
    assert.notEqual((await f.post()).status, 429);
  } finally { controller.abort(); await f.clean(); }
});

test('PATH-installed yt-dlp needs no project tools directory', async () => {
  const f = await fixture('path');
  try { assert.equal((await f.post()).status, 200); } finally { await f.clean(); }
});

test('out-of-range clip stops before download', async () => {
  const f = await fixture();
  try {
    const response = await f.post({ url, end: '31' });
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { error: 'Clip times must be within the video duration.' });
    assert.equal((await f.calls()).length, 1);
  } finally { await f.clean(); }
});

test('explicit trusted LAN opt-in retains origin check', async () => {
  const f = await fixture('ok', 3000, true);
  try {
    assert.equal((await f.post({ url }, { host: 'tapzi.lan', origin: 'http://tapzi.lan' })).status, 200);
    assert.equal((await f.post({ url }, { host: 'tapzi.lan', origin: 'http://evil.example' })).status, 403);
  } finally { await f.clean(); }
});
