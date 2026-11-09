import { MAX_AUDIO_BYTES } from './sounds.ts';
import { sliceMp3 } from './mp3-slice.ts';

export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
export const MAX_CLIP_SECONDS = 120;
const MAX_DECODE_SECONDS = 600;
export function isVideo(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
}
export function mediaType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ({ mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', webm: 'video/webm' } as Record<string, string>)[ext] ?? '';
}
export function validateMedia(file: File): void {
  if (!file.size || !/^(audio|video)\//.test(mediaType(file))) throw new Error('Elegí un archivo de audio o video, como MP3, M4A o MP4.');
  if (file.size > MAX_MEDIA_BYTES) throw new Error('Elegí un archivo de hasta 50 MB.');
}
export function clipRange(start: number, end: number, duration: number): void {
  if (![start, end, duration].every(Number.isFinite) || start < 0 || end <= start || end > duration + 0.1) throw new Error('El final debe ser posterior al inicio y estar dentro del archivo.');
}

// PCM WAV is playable without codecs or a conversion service. Encode only the selected fragment.
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const frames = channels[0]?.length ?? 0;
  const size = frames * channels.length * 2;
  if (!frames || channels.length < 1 || channels.length > 2 || channels.some(c => c.length !== frames) || size + 44 > MAX_AUDIO_BYTES) throw new Error('El fragmento es demasiado grande. Elegí uno más corto.');
  const buffer = new ArrayBuffer(44 + size);
  const view = new DataView(buffer);
  const word = (offset: number, value: string): void => { [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0))); };
  word(0, 'RIFF'); view.setUint32(4, 36 + size, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels.length * 2, true);
  view.setUint16(32, channels.length * 2, true); view.setUint16(34, 16, true); word(36, 'data'); view.setUint32(40, size, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) for (const channel of channels) {
    const value = Math.max(-1, Math.min(1, channel[i]));
    view.setInt16(offset, value < 0 ? value * 32768 : value * 32767, true); offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** True when both channels are the same signal (within one 16-bit step), so one channel sounds identical. */
export function identicalChannels(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1 / 32768) return false;
  return true;
}

export async function prepareAudio(file: File, start: number, end: number, duration: number): Promise<File> {
  validateMedia(file);
  clipRange(start, end, duration);
  if (!isVideo(file) && start === 0 && Math.abs(end - duration) < 0.000001) {
    if (file.size > MAX_AUDIO_BYTES) throw new Error('El audio supera 25 MB. Seleccioná un fragmento.');
    return new File([file], file.name, { type: mediaType(file) });
  }
  if (end - start > MAX_CLIP_SECONDS) throw new Error('Para extraer o recortar, elegí hasta 2 minutos.');
  // Decoding a long file whole would not fit in a phone's memory. An MP3 can be cut by frames first; other formats cannot.
  let source: Blob = file, offset = 0;
  if (duration > MAX_DECODE_SECONDS) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const slice = mediaType(file) === 'audio/mpeg' ? sliceMp3(bytes, start, end) : null;
    if (!slice) throw new Error('Este formato solo se puede recortar si dura hasta 10 minutos. Prueba con un MP3.');
    source = new Blob([bytes.subarray(slice.from, slice.to)], { type: 'audio/mpeg' }); offset = slice.offset;
  }
  const context = new AudioContext({ sampleRate: 44100 });
  try {
    const decoded = await context.decodeAudioData(await source.arrayBuffer());
    clipRange(start - offset, end - offset, decoded.duration);
    const first = Math.floor((start - offset) * decoded.sampleRate);
    const last = Math.min(decoded.length, Math.floor((end - offset) * decoded.sampleRate));
    let channels = Array.from({ length: Math.min(2, decoded.numberOfChannels) }, (_, i) => decoded.getChannelData(i).subarray(first, last));
    if (channels.length === 2 && identicalChannels(channels[0], channels[1])) channels = [channels[0]]; // dual-mono saves half the space, losslessly
    const wav = encodeWav(channels, decoded.sampleRate);
    return new File([wav], `${file.name.replace(/\.[^.]+$/, '')}.wav`, { type: 'audio/wav' });
  } catch (error) {
    if (error instanceof DOMException) throw new Error('Este formato no permite extraer audio en este navegador. Probá con MP3, M4A o un MP4 con audio AAC.');
    throw error;
  } finally { await context.close(); }
}
