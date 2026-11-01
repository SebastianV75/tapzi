import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

// Integration uses the same plugin for development and preview; static builds do not
// include an HTTP backend. The behavior itself is exercised by importer.test.ts.
test('dev and preview both mount the importer', async () => {
  const config = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
  assert.match(config, /configureServer\(server\)\s*\{ server\.middlewares\.use\(createImporter\(\)\); \}/);
  assert.match(config, /configurePreviewServer\(server\)\s*\{ server\.middlewares\.use\(createImporter\(\)\); \}/);
});
