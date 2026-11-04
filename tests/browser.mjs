import { createServer, preview } from 'vite';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Chromium's native DevTools protocol avoids another test dependency.
// Run with real timers: virtual time can outrun Vite's module transforms and IDB.
await mkdir('.cache', { recursive: true });
const profile = await mkdtemp(path.resolve('.cache/browser-'));
const server = await createServer({ server: { host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const address = server.httpServer.address();
const origin = `http://127.0.0.1:${address.port}`;
let socket;
let browser;
let browserExited = Promise.resolve();
let deadline;
let production;
try {
  const devtools = await new Promise((resolve, reject) => {
    browser = spawn(process.env.CHROMIUM || 'chromium', [
      '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--no-first-run', '--disable-background-networking', '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${profile}`,
      '--remote-debugging-port=0', 'about:blank',
    ]);
    browserExited = new Promise(resolve => browser.once('exit', resolve));
    let stderr = '';
    deadline = setTimeout(() => { browser.kill('SIGKILL'); reject(new Error('Chromium startup timed out')); }, 15000);
    browser.stderr.on('data', chunk => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(deadline); resolve(match[1]); }
    });
    browser.on('error', reject);
  });
  socket = new WebSocket(devtools);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  const events = new Map();
  socket.onclose = () => { for (const call of pending.values()) call.reject(new Error('Chromium connection closed')); pending.clear(); };
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const call = pending.get(message.id);
      if (call) { pending.delete(message.id); if (message.error) call.reject(new Error(message.error.message)); else call.resolve(message.result); }
    } else {
      const key = `${message.sessionId}:${message.method}`;
      if (events.has(key)) { events.get(key)(message.params); events.delete(key); }
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const nextEvent = (method, session) => new Promise(resolve => events.set(`${session}:${method}`, resolve));
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  await call('Page.enable');
  await call('Runtime.enable');
  deadline = setTimeout(() => { console.error('Browser check timed out'); process.exitCode = 1; browser.kill('SIGKILL'); socket.close(); }, 60000);
  const loaded = nextEvent('Page.loadEventFired', sessionId);
  await call('Page.navigate', { url: `${origin}/tests/browser.html` });
  await loaded;
  const report = await call('Runtime.evaluate', {
    expression: `new Promise(resolve => {
      const check = () => {
        const output = document.querySelector('#results');
        if (output && output.dataset.result !== 'running') resolve({status: output.dataset.result, text: output.textContent});
        else setTimeout(check, 50);
      }; check();
    })`,
    awaitPromise: true, returnByValue: true,
  });
  const result = report.result.value;
  console.log(result.text);
  await writeFile('.cache/browser-results.json', JSON.stringify(result, null, 2));
  if (result.status !== 'passed') process.exitCode = 1;
  else {
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const mobileLoaded = nextEvent('Page.loadEventFired', sessionId);
    await call('Page.navigate', { url: origin });
    await mobileLoaded;
    await call('Runtime.evaluate', {
      expression: `new Promise(resolve => { const check = () => { if (document.querySelector('#board')?.getAttribute('aria-busy') === 'false') resolve(true); else setTimeout(check, 20); }; check(); })`, awaitPromise: true,
    });
    // A separate production origin exercises the built worker, not Vite dev caching.
    production = await preview({ preview: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
    const prodOrigin = `http://127.0.0.1:${production.httpServer.address().port}`;
    await call('Network.enable');
    const prodLoaded = nextEvent('Page.loadEventFired', sessionId);
    await call('Page.navigate', { url: prodOrigin }); await prodLoaded;
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    await evaluate(`new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker did not take control')), 10000);
      const check = () => { if (navigator.serviceWorker.controller && document.querySelector('#board').getAttribute('aria-busy') === 'false') { clearTimeout(timeout); resolve(true); } else setTimeout(check, 25); }; check();
    })`);
    await evaluate(`document.querySelector('#demo-trigger').click()`);
    await evaluate(`new Promise(resolve => { const check = () => document.querySelector('#total').textContent === '3' ? resolve(true) : setTimeout(check, 25); check(); })`);
    const cacheHasHTML = await evaluate(`caches.keys().then(async keys => Boolean(await (await caches.open(keys.find(k => k.startsWith('tapzi-shell-')))).match('/index.html')))`);
    if (!cacheHasHTML) throw new Error('Production worker did not cache the HTML entry point');
    await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    // Leave the app entirely, then reopen it with the network disabled.
    const blankLoaded = nextEvent('Page.loadEventFired', sessionId);
    await call('Page.navigate', { url: 'about:blank' }); await blankLoaded;
    const offlineLoaded = nextEvent('Page.loadEventFired', sessionId);
    await call('Page.navigate', { url: prodOrigin }); await offlineLoaded;
    await evaluate(`new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Offline reopen failed')), 7000); const check = () => { if (document.querySelector('#total')?.textContent === '3') { clearTimeout(timer); resolve(true); } else setTimeout(check, 25); }; check(); })`);
    await evaluate(`document.querySelector('.pad').click()`);
    await evaluate(`new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Offline audio failed')), 4000); const check = () => { const audio = document.querySelector('#audio-player'); if (audio && !audio.paused && audio.readyState >= 2) { clearTimeout(timer); resolve(true); } else setTimeout(check, 15); }; check(); })`);
    console.log('PASS production PWA: shell precache / leave and reopen offline / persistent collection / actual offline audio');
    await evaluate(`document.querySelector('.stop-all').click()`);
    const screenshot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile('.cache/tapzi-mobile.png', Buffer.from(screenshot.data, 'base64'));
  }
} finally {
  clearTimeout(deadline);
  socket?.close();
  if (browser && browser.exitCode === null && browser.signalCode === null) browser.kill('SIGTERM');
  const cleanupTimeout = setTimeout(() => browser?.kill('SIGKILL'), 3000);
  await browserExited;
  clearTimeout(cleanupTimeout);
  server.httpServer?.closeAllConnections();
  await server.close();
  if (production) { production.httpServer.closeAllConnections(); await new Promise(resolve => production.httpServer.close(resolve)); }
  await rm(profile, { recursive: true, force: true });
}
