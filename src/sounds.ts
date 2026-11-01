const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

interface SoundBase {
  id: string;
  name: string;
  favorite: boolean;
  createdAt: number;
}
export interface YouTubeSound extends SoundBase {
  source: 'youtube';
  videoId: string;
  start: number;
  end: number | null;
}
export interface LocalSound extends SoundBase {
  source: 'local';
  blob: Blob;
  fileName: string;
  start: 0;
  end: null;
}
export type Sound = YouTubeSound | LocalSound;
export interface SoundInput {
  name: string;
  source: string;
  url?: string;
  start?: string;
  end?: string;
  file?: File;
}

export function youtubeId(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Paste a valid YouTube link.'); }
  if (url.protocol !== 'https:') throw new Error('Use a secure https:// YouTube link.');
  const host = url.hostname;
  let id: string | null | undefined;
  if (host === 'youtu.be') id = url.pathname.slice(1);
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
    const parts = url.pathname.split('/');
    id = url.pathname === '/watch' ? url.searchParams.get('v') : ['shorts', 'embed', 'live'].includes(parts[1]) ? parts[2] : null;
  }
  if (!id || !VIDEO_ID.test(id)) throw new Error('Use a YouTube video, Shorts, or youtu.be link.');
  return id;
}

function seconds(value: string | undefined, fallback: number): number;
function seconds(value: string | undefined, fallback: null): number | null;
function seconds(value: string | undefined, fallback: number | null): number | null {
  if (value === '' || value == null) return fallback;
  const text = value.trim();
  if (!/^\d+(?::[0-5]\d){0,2}$/.test(text)) throw new Error('Use seconds or a time like 0:12.');
  const result = text.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
  if (!Number.isSafeInteger(result)) throw new Error('That time is too large.');
  return result;
}

function soundId(): string {
  // getRandomValues is also available on HTTP LAN origins; randomUUID is not.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createSound(input: SoundInput): Sound {
  const name = input.name.trim();
  if (!name || name.length > 60) throw new Error('Give your sound a name (up to 60 characters).');
  const base: SoundBase = { id: soundId(), name, favorite: false, createdAt: Date.now() };
  if (input.source === 'youtube') {
    const videoId = youtubeId(input.url ?? '');
    const start = seconds(input.start, 0);
    const end = seconds(input.end, null);
    if (end !== null && end <= start) throw new Error('The end must come after the start.');
    return { ...base, source: 'youtube', videoId, start, end };
  }
  if (input.source === 'local') {
    const file = input.file;
    if (!(file instanceof Blob) || !file.type.startsWith('audio/') || !file.size) throw new Error('Choose a non-empty audio file, such as MP3, WAV, or M4A.');
    if (file.size > MAX_AUDIO_BYTES) throw new Error('Choose an audio file up to 25 MB.');
    return { ...base, source: 'local', blob: file, fileName: file.name, start: 0, end: null };
  }
  throw new Error('Choose YouTube or an audio file.');
}

export function matchesSound(sound: Pick<Sound, 'name'>, query: string): boolean {
  const normalize = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return normalize(sound.name).includes(normalize(query.trim()));
}

export function formatTime(value: number): string {
  const time = Math.max(0, Math.floor(value || 0));
  return `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`;
}
