import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoundEngine } from '../src/sound-engine.ts';
import type { Sound } from '../src/sounds.ts';

// Decode order and memory policy, independent of device codec speed.
const decodedIds: number[] = [];
let decode: (id: number) => Promise<AudioBuffer>;
Object.defineProperties(globalThis, {
  location: { configurable: true, value: { search: '' } },
  document: { configurable: true, value: { addEventListener() {} } },
  AudioContext: { configurable: true, value: class {} },
  OfflineAudioContext: { configurable: true, value: class {
    decodeAudioData(bytes: ArrayBuffer) { const id = new Uint8Array(bytes)[0]; decodedIds.push(id); return decode(id); }
  } },
  requestIdleCallback: { configurable: true, value: (cb: () => void) => setTimeout(cb, 0) },
});
const buffer = (bytes = 400): AudioBuffer => ({ length: bytes / 4, numberOfChannels: 1 } as AudioBuffer);
const sound = (id: number, favorite = false, duration = 1): Sound => ({
  id: String(id), source: 'local', start: 0, end: null, name: String(id), favorite, createdAt: id,
  blob: new Blob([new Uint8Array([id])]), fileName: `${id}.wav`, duration,
});
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Background decode did not settle');
}

test('preload favors favorites and then short clips; a recent request jumps the remaining queue', async () => {
  decodedIds.length = 0;
  let finish!: (value: AudioBuffer) => void;
  decode = id => id === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(buffer());
  const engine = createSoundEngine()!;
  const sounds = [sound(4, false, 20), sound(3), sound(2), sound(1, true)];
  engine.sync(sounds);
  await until(() => decodedIds.length === 1);
  assert.deepEqual(decodedIds, [1]);
  engine.prioritize(sounds[0]);
  finish(buffer());
  await until(() => decodedIds.length === 4);
  assert.deepEqual(decodedIds, [1, 4, 3, 2]);
  engine.sync([]);
});

test('a new favorite displaces cold preload buffers when the warm budget is full', async () => {
  decodedIds.length = 0;
  decode = () => Promise.resolve(buffer(50 * 1024 * 1024));
  const engine = createSoundEngine()!;
  const sounds = [sound(1, false, 100), sound(2, false, 100), sound(3, false, 100)];
  engine.sync(sounds);
  await until(() => !!engine.cached(sounds[1]));
  assert.equal(engine.cached(sounds[0]), undefined);
  engine.sync(sounds.map(s => s.id === '1' ? { ...s, favorite: true } : s));
  await until(() => !!engine.cached(sounds[0]));
  assert.equal(engine.cached(sounds[1]), undefined);
  assert.ok(engine.cached(sounds[2]));
  engine.sync([]);
});

test('deleting during decode cannot repopulate the decoded cache', async () => {
  let finish!: (value: AudioBuffer) => void;
  decode = () => new Promise(resolve => { finish = resolve; });
  const engine = createSoundEngine()!, clip = sound(1);
  engine.sync([clip]);
  await until(() => !!finish);
  engine.sync([]);
  const pending = engine.prepare(clip);
  finish(buffer()); await pending;
  assert.equal(engine.cached(clip), undefined);
});
