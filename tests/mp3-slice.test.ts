import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sliceMp3 } from '../src/mp3-slice.ts';

// MPEG-1 Layer III, 44.1 kHz, 128 kbps: 1152 samples per frame, 417 or 418 bytes depending on padding.
const SAMPLES = 1152, RATE = 44100;
function frame(padded: boolean, info = false): Uint8Array {
  const bytes = new Uint8Array(padded ? 418 : 417);
  bytes.set([0xff, 0xfb, 0x90 | (padded ? 2 : 0), 0x00]);
  if (info) bytes.set(new TextEncoder().encode('Info'), 36);
  return bytes;
}
function build(count: number, options: { id3?: number; info?: boolean; tail?: Uint8Array } = {}): { bytes: Uint8Array; starts: number[]; ends: number[] } {
  const parts: Uint8Array[] = [], starts: number[] = [], ends: number[] = [];
  let size = 0;
  const add = (part: Uint8Array): void => { parts.push(part); size += part.length; };
  if (options.id3) {
    const header = new Uint8Array(10); header.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, options.id3 >> 7, options.id3 & 0x7f]);
    add(header); add(new Uint8Array(options.id3));
  }
  if (options.info) add(frame(false, true));
  for (let i = 0; i < count; i++) { const part = frame(i % 22 < 21 ? i % 2 === 1 : true); starts.push(size); add(part); ends.push(size); }
  if (options.tail) add(options.tail);
  const bytes = new Uint8Array(size); let at = 0;
  for (const part of parts) { bytes.set(part, at); at += part.length; }
  return { bytes, starts, ends };
}
const startIndex = (start: number): number => Math.floor((start - 0.5) * RATE / SAMPLES);
const endIndex = (end: number): number => Math.ceil((end + 0.1) * RATE / SAMPLES);

test('cuts whole frames around the range, starting early for the decoder', () => {
  const { bytes, starts, ends } = build(1500);
  const slice = sliceMp3(bytes, 10, 12);
  assert.ok(slice);
  assert.equal(slice.from, starts[startIndex(10)]);
  assert.equal(slice.to, ends[endIndex(12)]);
  assert.ok(Math.abs(slice.offset - startIndex(10) * SAMPLES / RATE) < 1e-9);
  assert.ok(slice.offset <= 10 - 0.4 && slice.offset >= 10 - 0.6);
  assert.ok(slice.to - slice.from < bytes.length / 10);
});

test('starts at the beginning when the range starts early', () => {
  const { bytes, starts } = build(300);
  const slice = sliceMp3(bytes, 0.2, 1);
  assert.equal(slice?.from, starts[0]);
  assert.equal(slice?.offset, 0);
});

test('skips an ID3 tag and the Xing/Info frame without shifting time', () => {
  const plain = sliceMp3(build(1500).bytes, 10, 12)!;
  const tagged = build(1500, { id3: 300, info: true });
  const slice = sliceMp3(tagged.bytes, 10, 12)!;
  assert.equal(slice.from, tagged.starts[startIndex(10)]);
  assert.equal(slice.offset, plain.offset);
});

test('does not include trailing tags', () => {
  const tail = new Uint8Array(128); tail.set([0x54, 0x41, 0x47]);
  const { bytes, ends } = build(200, { tail });
  assert.equal(sliceMp3(bytes, 0, 1000)?.to, ends[199]);
});

test('keeps what exists when the file ends inside the range', () => {
  const { bytes, starts, ends } = build(100);
  const slice = sliceMp3(bytes, 2, 60);
  assert.equal(slice?.from, starts[startIndex(2)]);
  assert.equal(slice?.to, ends[99]);
});

test('rejects data that is not Layer III audio', () => {
  assert.equal(sliceMp3(new Uint8Array(0), 0, 1), null);
  assert.equal(sliceMp3(new TextEncoder().encode('this is not audio at all'.repeat(40)), 0, 1), null);
  const layer2 = build(50).bytes.map((value, index, all) => (index > 0 && all[index - 1] === 0xff && value === 0xfb ? 0xfd : value));
  assert.equal(sliceMp3(layer2, 0, 1), null);
});

test('reads a real encoded file', () => {
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/tone.mp3', import.meta.url)));
  const slice = sliceMp3(bytes, 0, 100);
  assert.ok(slice && slice.offset === 0 && slice.to <= bytes.length && slice.to > bytes.length - 300);
  assert.equal(bytes[slice.from], 0xff);
});
