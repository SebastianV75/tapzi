import { build } from 'vite';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

// Exercises the real install and update lifecycle against a production build.
await mkdir('.cache', { recursive: true });
const outDir = path.resolve('.cache/sw-dist');
const profile = await mkdtemp(path.resolve('.cache/browser-sw-'));
await build({ logLevel: 'error', build: { outDir, emptyOutDir: true } });

let version = 1;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const site = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://local').pathname;
  try {
    let body = await readFile(path.join(outDir, pathname === '/' ? 'index.html' : path.normalize(pathname)));
    if (pathname === '/sw.js') body = Buffer.from(body.toString().replace(/const CACHE = '([^']+)'/, (_, cache) => `const CACHE = '${cache}-release-${version}'`));
    res.writeHead(200, { 'Content-Type': types[path.extname(pathname) || '.html'] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${site.address().port}/`;

const browser = spawn(process.env.CHROMIUM || 'chromium', [
  '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
  '--disable-background-networking', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
]);
const browserExited = new Promise(resolve => browser.once('exit', resolve));
let socket;
try {
  const devtools = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chromium startup timed out')), 15000);
    let stderr = '';
    browser.on('error', reject);
    browser.stderr.on('data', chunk => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(devtools);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const call = message.id && pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error.message)); else call.resolve(message.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const openTab = async () => {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const evaluate = async expression => {
      const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    };
    const waitFor = async (expression, label) => {
      const end = Date.now() + 10000;
      while (Date.now() < end) {
        try { if (await evaluate(expression)) return; } catch { /* The page may be reloading. */ }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(`Timed out: ${label}`);
    };
    await send('Page.navigate', { url: origin }, sessionId);
    await waitFor(`document.readyState === 'complete' && !!document.querySelector('#update-banner')`, 'page load');
    return { evaluate, waitFor };
  };
  const bannerVisible = `!document.querySelector('#update-banner').hidden`;
  const controlled = `!!navigator.serviceWorker.controller`;
  const clickUpdate = `window.beforeUpdate = true; document.querySelector('#apply-update').click()`;
  const reloaded = `document.readyState === 'complete' && !window.beforeUpdate`;
  const findUpdate = `navigator.serviceWorker.getRegistration().then(r => r.update()).then(() => true)`;

  const first = await openTab();
  await first.waitFor(controlled, 'first install takes control');
  await new Promise(resolve => setTimeout(resolve, 500));
  if (await first.evaluate(bannerVisible)) throw new Error('First install offered an update that does not exist');
  console.log('PASS first install does not offer an update');

  await first.waitFor(`document.querySelector('#board').getAttribute('aria-busy') === 'false'`, 'collection ready');
  await first.evaluate(`document.querySelector('#demo-trigger').click()`);
  await first.waitFor(`document.querySelector('#total').textContent === '3'`, 'saved audio before update');
  const collectionSnapshot = `new Promise((resolve, reject) => {
    const request = indexedDB.open('tapzi', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('sounds'), rows = tx.objectStore('sounds').getAll();
      tx.oncomplete = async () => {
        db.close();
        try {
          const records = await Promise.all(rows.result.map(async sound => ({ ...sound,
            blob: sound.source === 'local' ? Array.from(new Uint8Array(await sound.blob.arrayBuffer())) : null,
          })));
          resolve(JSON.stringify(records.sort((a, b) => a.id.localeCompare(b.id))));
        } catch (error) { reject(error); }
      };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  })`;
  const beforeCollection = await first.evaluate(collectionSnapshot);
  const beforeCaches = await first.evaluate(`caches.keys()`);

  const second = await openTab();
  await second.waitFor(controlled, 'second tab is controlled');
  version += 1;
  await first.evaluate(findUpdate);
  await first.waitFor(bannerVisible, 'first tab offers the real update');
  await second.waitFor(bannerVisible, 'second tab offers the real update');
  console.log('PASS a new release offers the update in every open tab');

  await first.evaluate(clickUpdate);
  await first.waitFor(reloaded, 'update reloads the tab that applied it');
  await first.waitFor(`!${bannerVisible}`, 'banner clears after updating');
  console.log('PASS updating activates the new version and reloads');
  const afterCollection = await first.evaluate(collectionSnapshot);
  if (beforeCollection !== afterCollection) throw new Error('Updating changed the saved audio bytes or metadata');
  await first.waitFor(`document.querySelector('#total')?.textContent === '3'`, 'collection is loaded after update even in a background tab');
  const afterCaches = await first.evaluate(`caches.keys()`);
  if (beforeCaches.some(key => key.startsWith('tapzi-shell-') && afterCaches.includes(key))) throw new Error('Old shell cache was not removed');
  console.log('PASS new release deletes the old shell cache but preserves every audio byte and record');


  await second.waitFor(`navigator.serviceWorker.getRegistration().then(r => !r.waiting)`, 'other tab sees no waiting worker');
  if (!(await second.evaluate(bannerVisible))) {
    console.log('PASS other open tab follows the update on its own');
  } else {
    await second.evaluate(clickUpdate);
    await second.waitFor(reloaded, 'stale banner reloads when clicked');
    await second.waitFor(`!${bannerVisible}`, 'stale banner clears');
    console.log('PASS a stale banner in another tab still responds');
  }
} finally {
  socket?.close();
  if (browser.exitCode === null && browser.signalCode === null) browser.kill('SIGTERM');
  const cleanup = setTimeout(() => browser.kill('SIGKILL'), 3000);
  await browserExited;
  clearTimeout(cleanup);
  site.closeAllConnections();
  await new Promise(resolve => site.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  await rm(outDir, { recursive: true, force: true });
}
