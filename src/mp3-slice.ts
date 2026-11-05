// An MP3 is a run of independent frames, so a few seconds can be cut out by byte range and decoded
// alone. Decoding a whole long file would need hundreds of MB, more than a phone tab can keep.
export interface Mp3Slice {
  /** Byte range of whole frames to decode. */
  from: number;
  to: number;
  /** Where the range starts in the original audio, in seconds. */
  offset: number;
}

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
// The decoder needs the frames before the first one it should output (the bit reservoir), so start early.
const LEAD_IN_SECONDS = 0.5;
const TAIL_SECONDS = 0.1;

function afterId3(bytes: Uint8Array): number {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  return 10 + size + (bytes[5] & 0x10 ? 10 : 0);
}
// Xing/Info frames only describe the file and carry no audio, so they must not count towards time.
function isInfoFrame(bytes: Uint8Array, at: number, length: number): boolean {
  return [13, 21, 36].some(offset => offset + 4 <= length && ['Xing', 'Info'].includes(String.fromCharCode(...bytes.subarray(at + offset, at + offset + 4))));
}

/** Returns null for anything but plain Layer III audio, so the caller can say the file is unsupported. */
export function sliceMp3(bytes: Uint8Array, start: number, end: number): Mp3Slice | null {
  let position = afterId3(bytes);
  let rate = 0, perFrame = 0, first = 0, last = 0;
  let index = 0, from = -1, offset = 0, tail = 0, firstFrame = true;
  while (position + 4 <= bytes.length) {
    const b1 = bytes[position + 1], b2 = bytes[position + 2];
    const version = (b1 >> 3) & 3, layer = (b1 >> 1) & 3, bitrateIndex = b2 >> 4, rateIndex = (b2 >> 2) & 3;
    if (bytes[position] !== 0xff || (b1 & 0xe0) !== 0xe0 || version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) { position++; continue; }
    const hz = RATES[version][rateIndex];
    const length = Math.floor((version === 3 ? 144000 : 72000) * (version === 3 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex] / hz) + ((b2 >> 1) & 1);
    if (position + length > bytes.length) break;
    if (!rate) {
      rate = hz; perFrame = version === 3 ? 1152 : 576;
      first = Math.max(0, Math.floor((start - LEAD_IN_SECONDS) * rate / perFrame));
      last = Math.ceil((end + TAIL_SECONDS) * rate / perFrame);
    }
    if (firstFrame) { firstFrame = false; if (isInfoFrame(bytes, position, length)) { position += length; continue; } }
    if (index === first) { from = position; offset = index * perFrame / rate; }
    tail = position + length;
    if (from >= 0 && index >= last) break;
    index++; position += length;
  }
  // If the file ends inside the wanted range, keep what is there.
  return from >= 0 && tail > from ? { from, to: tail, offset } : null;
}
