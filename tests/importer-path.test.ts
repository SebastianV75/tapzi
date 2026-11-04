import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';

test('normal startup exposes no import backend; explicit opt-in mounts it', async () => {
  const original = process.env.TAPZI_LOCAL_IMPORT;
  try {
    for (const enabled of [false, true]) {
      if (enabled) process.env.TAPZI_LOCAL_IMPORT = '1'; else delete process.env.TAPZI_LOCAL_IMPORT;
      const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
      try {
        await server.listen();
        const address = server.httpServer!.address(); assert.ok(address && typeof address === 'object');
        const origin = `http://127.0.0.1:${address.port}`;
        const response = await fetch(`${origin}/api/import-audio`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{' });
        if (enabled) { assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'Send valid JSON.' }); }
        else assert.equal(response.status, 404);
      } finally { await server.close(); }
    }
  } finally { if (original === undefined) delete process.env.TAPZI_LOCAL_IMPORT; else process.env.TAPZI_LOCAL_IMPORT = original; }
});
