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
    let connected = false;
    deadline = setTimeout(() => { browser.kill('SIGKILL'); reject(new Error('Chromium startup timed out')); }, 15000);
    browser.stderr.on('data', chunk => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match && !connected) { connected = true; clearTimeout(deadline); resolve(match[1]); }
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
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await writeFile('.cache/tapzi-empty.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
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
    await evaluate(`new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Offline audio failed')), 4000); const check = () => { if (document.querySelector('#play-pause')?.getAttribute('aria-label') === 'Pausar' && !document.querySelector('#playback-seek').disabled) { clearTimeout(timer); resolve(true); } else setTimeout(check, 15); }; check(); })`);
    console.log('PASS production PWA: shell precache / leave and reopen offline / persistent collection / actual offline audio');
    await evaluate(`document.querySelector('.stop-all').click()`);
    const screenshot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile('.cache/tapzi-mobile.png', Buffer.from(screenshot.data, 'base64'));
    await evaluate(`document.querySelector('.pad').click(); document.querySelector('#play-pause').click()`);
    await evaluate(`new Promise(resolve => setTimeout(resolve, 100))`);
    if (await evaluate(`document.querySelector('#mobile-transport').hidden || Boolean(document.querySelector('#playback-message').textContent)`)) throw new Error('Rapid pause hid the player or displayed an error');
    await writeFile('.cache/tapzi-player.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await evaluate(`document.querySelector('.stop-all').click()`);
    await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await writeFile('.cache/tapzi-desktop.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(`[...document.querySelectorAll('.add-trigger')].find(node => node.checkVisibility()).click()`);
    await writeFile('.cache/tapzi-choose-file.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    const { root } = await call('DOM.getDocument');
    const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector: '#sound-file' });
    await call('DOM.setFileInputFiles', { nodeId, files: [path.resolve('tests/fixtures/tone.mp4')] });
    await evaluate(`new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Production file picker did not prepare the editor')), 7000); const check = () => { if (!document.querySelector('#sound-details').hidden) { clearTimeout(timer); resolve(true); } else setTimeout(check, 25); }; check(); })`);
    await evaluate(`document.querySelector('#toggle-trim').click()`);
    await writeFile('.cache/tapzi-editor.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    // A real keyboard event, rather than assigning a value, verifies native range access.
    await evaluate(`document.querySelector('#trim-start').focus()`);
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    if (!(await evaluate(`Number(document.querySelector('#local-start').value) > 0`))) throw new Error('Keyboard range selection did not update the clip');
    await evaluate(`document.querySelector('#close-dialog').click(); document.querySelector('#confirm-discard').click()`);
    console.log('PASS production file chooser / native keyboard trim / mobile and desktop visual captures');
    await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await evaluate(`[...document.querySelectorAll('.add-trigger')].find(node => node.checkVisibility()).click(); document.querySelector('input[value="youtube"]').click()`);
    await evaluate(`new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('YouTube status did not settle')), 8000); const check = () => { if (!document.querySelector('#youtube-status').textContent.includes('Comprobando')) { clearTimeout(timer); resolve(true); } else setTimeout(check, 25); }; check(); })`);
    if (!(await evaluate(`document.querySelector('#fetch-youtube').disabled && document.querySelector('#youtube-status').textContent.includes('no está activada')`))) throw new Error('Unconfigured production importer must stay disabled');
    await writeFile('.cache/tapzi-youtube.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await evaluate(`document.querySelector('#close-dialog').click()`);
    console.log('PASS production importer configuration / no credentials required for local-only use');
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
