import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBackup, readBackup } from '../src/backup.ts';
import { createSound } from '../src/sounds.ts';
import { encodeWav, clipRange, validateMedia } from '../src/media.ts';

test('backup preserves exact audio bytes, metadata and online clips', async () => {
  const audio = { ...createSound({ name: 'Ñam 🎉', source: 'local', file: new File([new Uint8Array([0, 1, 255, 64])], 'a.wav', { type: 'audio/wav' }) }), favorite: true, color: 'mint' as const };
  const youtube = createSound({ name: 'Online', source: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', start: '4', end: '9' });
  const restored = await readBackup(makeBackup([audio, youtube]));
  assert.equal(restored[0].id, audio.id); assert.equal(restored[0].name, audio.name); assert.equal(restored[0].favorite, true); assert.equal(restored[0].color, 'mint');
  assert.ok(restored[0].source === 'local'); assert.deepEqual(new Uint8Array(await restored[0].blob.arrayBuffer()), new Uint8Array([0, 1, 255, 64]));
  assert.deepEqual(restored[1], { ...youtube, color: 'lavender' });
});
test('reject malformed, truncated, duplicate and oversized backup metadata before saving', async () => {
  await assert.rejects(readBackup(new Blob(['not a backup'])));
  const sound = createSound({ name: 'Audio', source: 'local', file: new File(['abcd'], 'a.wav', { type: 'audio/wav' }) });
  const blob = makeBackup([sound]);
  await assert.rejects(readBackup(blob.slice(0, blob.size - 1)));
  await assert.rejects(readBackup(new Blob([blob, 'extra'])));
  await assert.rejects(readBackup(makeBackup([sound, sound])));
  const bytes = new Uint8Array(await blob.arrayBuffer()); new DataView(bytes.buffer).setUint32(8, 0xffffffff, true);
  await assert.rejects(readBackup(new Blob([bytes])));
  assert.deepEqual(await readBackup(makeBackup([])), []);
});
test('PCM encoder writes a valid interleaved WAV with clipped amplitudes', async () => {
  const wav = encodeWav([new Float32Array([-2, 0, 2]), new Float32Array([.5, -.5, 0])], 44100);
  const buffer = await wav.arrayBuffer(), view = new DataView(buffer);
  assert.equal(wav.size, 56); assert.equal(view.getUint16(22, true), 2); assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getInt16(44, true), -32768); assert.equal(view.getInt16(46, true), 16383); assert.equal(view.getInt16(52, true), 32767);
  assert.throws(() => encodeWav([], 44100));
});
test('local clip bounds and media formats reject invalid input', () => {
  clipRange(0, 1.2, 1.2);
  for (const range of [[2, 1, 3], [0, 4, 2], [-1, 1, 2], [NaN, 1, 2], [0, 1, Infinity]]) assert.throws(() => clipRange(...range as [number, number, number]));
  validateMedia(new File(['mp4'], 'video.mp4'));
  assert.throws(() => validateMedia(new File(['html'], 'evil.html', { type: 'text/html' })));
});
