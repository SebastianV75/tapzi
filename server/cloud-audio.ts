import { lookup } from 'node:dns/promises';
import { isIPv4 } from 'node:net';
import { request } from 'node:https';
import type { Readable } from 'node:stream';

// Below Vercel's 4.5 MB response limit. Never buffer an unlimited provider file.
export const MAX_REMOTE_BYTES = 4 * 1024 * 1024;
export class CloudError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const unavailable = () => new CloudError(502, 'No pudimos obtener el audio de ese video. Prueba con otro enlace o agrega un archivo.');

export function publicIPv4(address: string): boolean {
  if (!isIPv4(address)) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
export function downloadURL(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 8192) throw unavailable();
  let url: URL;
  try { url = new URL(value); } catch { throw unavailable(); }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password ||
    url.hostname.includes(':') || !url.hostname.includes('.') ||
    (isIPv4(url.hostname) && !publicIPv4(url.hostname))) throw unavailable();
  url.hash = '';
  return url;
}
type Resolve = (hostname: string) => Promise<{ address: string; family: number }[]>;
export async function publicAddress(hostname: string, resolve: Resolve = name => lookup(name, { all: true, family: 4 })): Promise<string> {
  const addresses = await resolve(hostname);
  if (!addresses.length || addresses.some(item => item.family !== 4 || !publicIPv4(item.address))) throw unavailable();
  return addresses[0].address;
}
export interface AudioResponse {
  status: number;
  location?: string;
  type?: string;
  length?: string;
  encoding?: string;
  body: Readable;
}
export type AudioTransport = (url: URL, signal: AbortSignal) => Promise<AudioResponse>;
// Resolve once and pin the connection, retaining hostname-based TLS validation.
// A separate DNS preflight followed by fetch would permit DNS rebinding.
const publicRequest: AudioTransport = async (url, signal) => {
  const address = await publicAddress(url.hostname);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'GET', signal, agent: false, family: 4,
      headers: { Accept: 'audio/mpeg, application/octet-stream', 'Accept-Encoding': 'identity' },
      lookup: (_hostname, _options, callback) => callback(null, address, 4),
    }, response => resolve({ status: response.statusCode ?? 502, location: response.headers.location,
      type: response.headers['content-type'], length: response.headers['content-length'],
      encoding: response.headers['content-encoding'], body: response }));
    req.once('error', reject); req.end();
  });
};
export async function downloadAudio(value: string, signal: AbortSignal, transport: AudioTransport = publicRequest): Promise<Buffer> {
  let url = downloadURL(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted();
    const response = await transport(url, signal);
    try {
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.location || redirects === 3) throw unavailable();
        url = downloadURL(new URL(response.location, url).href); continue;
      }
      if (response.status !== 200 || !/^(audio\/(mpeg|mp3)|application\/octet-stream)(;|$)/i.test(response.type ?? '') ||
        (response.encoding && response.encoding !== 'identity')) throw unavailable();
      if (Number(response.length) > MAX_REMOTE_BYTES) throw new CloudError(413, 'Este audio es demasiado grande. Prueba un video más corto (hasta 4 MB de audio).');
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of response.body) {
        signal.throwIfAborted();
        size += chunk.length;
        if (size > MAX_REMOTE_BYTES) throw new CloudError(413, 'Este audio supera 4 MB. Prueba con un video más corto.');
        chunks.push(Buffer.from(chunk));
      }
      const audio = Buffer.concat(chunks);
      if (audio.length < 4 || !(audio.subarray(0, 3).toString() === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0))) throw unavailable();
      return audio;
    } finally { response.body.destroy(); }
  }
  throw unavailable();
}
async function boundedJSON(response: Response): Promise<unknown> {
  if (!response.body) throw unavailable();
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 128 * 1024) throw unavailable(); chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw unavailable(); }
  } finally { await reader.cancel().catch(() => {}); }
}
export interface RemoteAudio { title: string; url: string }
export async function tubeMP3(videoId: string, key: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<RemoteAudio> {
  const response = await fetcher('https://tube-mp31.p.rapidapi.com/api/json', {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'tube-mp31.p.rapidapi.com' },
    body: JSON.stringify({ videoId }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 429) throw new CloudError(429, 'La importación alcanzó su límite. Inténtalo más tarde; no se guardó ningún sonido.');
    if (response.status === 401 || response.status === 403) throw new CloudError(503, 'La importación necesita revisar su configuración. Puedes agregar un archivo mientras tanto.');
    throw unavailable();
  }
  const data = await boundedJSON(response) as { status?: unknown; result?: unknown } | null;
  if (data?.status !== 'success' || !Array.isArray(data.result)) throw unavailable();
  const item = data.result.find((entry: unknown) => entry && typeof entry === 'object' && (entry as { videoId?: unknown }).videoId === videoId) as Record<string, unknown> | undefined;
  if (!item) throw unavailable();
  const duration = Number(item.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 600) throw new CloudError(422, 'Elige un video de hasta 10 minutos. Después podrás recortar el audio.');
  const url = downloadURL(item.dlurl).href;
  const title = typeof item.title === 'string' ? item.title.replace(/[\x00-\x1f\x7f/\\]/g, ' ').trim().slice(0, 60) : '';
  return { url, title: title || 'Sonido de YouTube' };
}
