import test from 'node:test';
import assert from 'node:assert/strict';
import { createSound } from '../src/sounds.ts';

test('sound creation works on an HTTP LAN without secure-context randomUUID', () => {
  const original = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
  try {
    const youtube = createSound({ name: 'Reaction', source: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ' });
    const local = createSound({ name: 'Local', source: 'local', file: new File(['audio'], 'reaction.wav', { type: 'audio/wav' }) });
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    assert.match(youtube.id, uuid);
    assert.match(local.id, uuid);
    assert.notEqual(youtube.id, local.id);
  } finally {
    if (original) Object.defineProperty(crypto, 'randomUUID', original);
    else Reflect.deleteProperty(crypto, 'randomUUID');
  }
});
