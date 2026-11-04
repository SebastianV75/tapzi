import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createImporter } from './server/importer.ts';

export default defineConfig({
  plugins: [
    // Optional legacy developer tool. The shipped app never calls this endpoint.
    ...(process.env.TAPZI_LOCAL_IMPORT === '1' ? [{
      name: 'tapzi-audio-import',
      configureServer(server: import('vite').ViteDevServer) { server.middlewares.use(createImporter()); },
      configurePreviewServer(server: import('vite').PreviewServer) { server.middlewares.use(createImporter()); },
    }] : []),
    {
      name: 'tapzi-offline-shell',
      enforce: 'post',
      apply: 'build',
      generateBundle(_options, bundle) {
        const publicFiles = ['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'manifest.webmanifest'];
        const assets = [...new Set(['index.html', ...Object.keys(bundle).filter(name => !name.endsWith('.map')), ...publicFiles])];
        const hash = createHash('sha256');
        for (const output of Object.values(bundle)) hash.update(output.type === 'chunk' ? output.code : output.source);
        for (const name of publicFiles) hash.update(readFileSync(new URL(`./public/${name}`, import.meta.url)));
        const version = hash.digest('hex').slice(0, 16);
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: `
const CACHE = 'tapzi-shell-${version}';
const ASSETS = ${JSON.stringify(assets.map(name => '/' + name))};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('tapzi-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const path = request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html') ? '/index.html' : url.pathname;
  if (!ASSETS.includes(path)) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(path)) || fetch(request)));
});
` });
      },
    },
  ],
});
