import { defineConfig } from 'vite';
import { createImporter } from './server/importer.ts';

export default defineConfig({
  plugins: [{
    name: 'tapzi-audio-import',
    configureServer(server) { server.middlewares.use(createImporter()); },
    configurePreviewServer(server) { server.middlewares.use(createImporter()); },
  }],
});
