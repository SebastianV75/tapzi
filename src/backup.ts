import { createSound, MAX_AUDIO_BYTES } from './sounds.ts';
import type { Sound } from './sounds.ts';

// Versioned binary container: 8-byte magic, uint32 JSON length, JSON, then raw audio blobs.
// No base64 expansion, remote upload, or decompression of untrusted archives.
const MAGIC = 'TAPZI001';
const MAX_BACKUP_BYTES = 200 * 1024 * 1024;
const MAX_ENTRIES = 1000;
export function makeBackup(sounds: Sound[]): Blob {
  if (sounds.length > MAX_ENTRIES) throw new Error('La copia admite hasta 1000 sonidos.');
  const blobs: Blob[] = [];
  const records = sounds.map(sound => {
    if (sound.source === 'youtube') return sound;
    const { blob, ...record } = sound;
    blobs.push(blob);
    return { ...record, bytes: blob.size, mime: blob.type };
  });
  const manifest = new TextEncoder().encode(JSON.stringify({ version: 1, sounds: records }));
  const header = new Uint8Array(12);
  header.set(new TextEncoder().encode(MAGIC));
  new DataView(header.buffer).setUint32(8, manifest.length, true);
  const backup = new Blob([header, manifest, ...blobs], { type: 'application/octet-stream' });
  if (backup.size > MAX_BACKUP_BYTES) throw new Error('La colección supera el límite de 200 MB por copia.');
  return backup;
}
export async function readBackup(file: Blob): Promise<Sound[]> {
  const invalid = (): never => { throw new Error('Esta copia de Tapzi no es válida o está incompleta.'); };
  if (file.size < 12 || file.size > MAX_BACKUP_BYTES) invalid();
  const header = await file.slice(0, 12).arrayBuffer();
  if (new TextDecoder().decode(header.slice(0, 8)) !== MAGIC) invalid();
  const length = new DataView(header).getUint32(8, true);
  if (!length || length > 2 * 1024 * 1024 || length + 12 > file.size) invalid();
  let data;
  try { data = JSON.parse(await file.slice(12, 12 + length).text()); } catch { invalid(); }
  if (!data || data.version !== 1 || !Array.isArray(data.sounds) || data.sounds.length > MAX_ENTRIES) invalid();
  let offset = 12 + length;
  const seen = new Set<string>();
  const sounds: Sound[] = [];
  for (const item of data.sounds) {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(item.id) || seen.has(item.id) || typeof item.name !== 'string' || typeof item.favorite !== 'boolean' || !Number.isFinite(item.createdAt) || item.createdAt < 0) invalid();
    seen.add(item.id);
    let sound: Sound;
    if (item.source === 'local') {
      if (!Number.isSafeInteger(item.bytes) || item.bytes <= 0 || item.bytes > MAX_AUDIO_BYTES || offset + item.bytes > file.size || typeof item.mime !== 'string' || !item.mime.startsWith('audio/') || typeof item.fileName !== 'string') invalid();
      const audio = new File([file.slice(offset, offset + item.bytes)], item.fileName.slice(0, 200), { type: item.mime });
      offset += item.bytes;
      sound = createSound({ name: item.name, source: 'local', file: audio });
      if (sound.source === 'local' && Number.isFinite(item.duration) && item.duration > 0) sound.duration = item.duration;
    } else if (item.source === 'youtube') {
      if (!Number.isSafeInteger(item.start) || item.start < 0 || (item.end !== null && (!Number.isSafeInteger(item.end) || item.end <= item.start))) invalid();
      sound = createSound({ name: item.name, source: 'youtube', url: `https://youtu.be/${item.videoId}`, start: String(item.start), end: item.end === null ? '' : String(item.end) });
    } else invalid();
    sounds.push({ ...sound!, id: item.id, favorite: item.favorite, createdAt: item.createdAt, color: ['lavender','peach','mint','blue'].includes(item.color) ? item.color : 'lavender' });
  }
  if (offset !== file.size) invalid();
  return sounds;
}
