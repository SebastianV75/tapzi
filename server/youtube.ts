import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { youtubeId } from '../src/sounds.ts';
import { CloudError, downloadAudio, tubeMP3 } from './cloud-audio.ts';
import type { RemoteAudio } from './cloud-audio.ts';

type Request = IncomingMessage & { body?: unknown };
interface Dependencies {
  provider?(id: string, key: string, signal: AbortSignal): Promise<RemoteAudio>;
  download?(url: string, signal: AbortSignal): Promise<Buffer>;
}
function authorized(req: IncomingMessage, code: string): boolean {
  const supplied = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
  return !!supplied && timingSafeEqual(createHash('sha256').update(supplied).digest(), createHash('sha256').update(code).digest());
}
function checkOrigin(req: IncomingMessage, env: NodeJS.ProcessEnv): void {
  const allowed = [env.TAPZI_APP_ORIGIN, env.VERCEL_URL && `https://${env.VERCEL_URL}`,
    env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`].filter(Boolean);
  // Local development only. Forwarded headers cannot opt a public server into this path.
  if (env.VERCEL !== '1' && /^127\.|^::ffff:127\.|^::1$/.test(req.socket.remoteAddress ?? '') &&
    /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host ?? '')) allowed.push(`http://${req.headers.host}`);
  if (typeof req.headers.origin !== 'string' || !allowed.includes(req.headers.origin) || req.headers['sec-fetch-site'] === 'cross-site') {
    throw new CloudError(403, 'Abre Tapzi desde su dirección habitual para importar.');
  }
}
async function readInput(req: Request, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) throw new CloudError(415, 'Solicitud no válida.');
  if (Number(req.headers['content-length']) > 4096) throw new CloudError(413, 'El enlace es demasiado largo.');
  let input: unknown;
  if (req.body !== undefined) {
    // Vercel may parse JSON before invoking the handler; Vite supplies a stream.
    if (Buffer.byteLength(JSON.stringify(req.body)) > 4096) throw new CloudError(413, 'El enlace es demasiado largo.');
    input = req.body;
  } else {
    const chunks: Buffer[] = []; let size = 0;
    const cancel = () => req.destroy();
    signal.throwIfAborted(); signal.addEventListener('abort', cancel, { once: true });
    try {
      for await (const chunk of req) {
        size += chunk.length; if (size > 4096) throw new CloudError(413, 'El enlace es demasiado largo.');
        chunks.push(Buffer.from(chunk));
      }
    } finally { signal.removeEventListener('abort', cancel); }
    try { input = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new CloudError(400, 'Solicitud no válida.'); }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'url') || typeof (input as { url?: unknown }).url !== 'string') throw new CloudError(400, 'Pega un enlace de YouTube válido.');
  return input as Record<string, unknown>;
}
export function createYouTubeHandler(env: NodeJS.ProcessEnv = process.env, deps: Dependencies = {}) {
  let busy = false;
  // Best-effort per-instance pacing. Provider-side quotas remain the spending limit.
  const attempts: number[] = [];
  return async (req: Request, res: ServerResponse): Promise<void> => {
    const reply = (status: number, value: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const key = env.RAPIDAPI_KEY ?? '', code = env.TAPZI_IMPORT_ACCESS_CODE ?? '';
    const enabled = !!key && code.length >= 32;
    if (req.method === 'GET') { reply(200, { enabled, authorized: enabled && authorized(req, code) }); return; }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); reply(405, { error: 'Método no permitido.' }); return; }
    const controller = new AbortController();
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', disconnect);
    const timer = setTimeout(() => controller.abort(), 100_000);
    let acquired = false;
    try {
      checkOrigin(req, env);
      if (!enabled) throw new CloudError(503, 'La importación de enlaces aún no está activada. Puedes agregar un archivo o guardar solo el enlace.');
      if (!authorized(req, code)) throw new CloudError(401, 'Introduce tu código de acceso para importar.');
      const input = await readInput(req, controller.signal);
      let videoId: string;
      try {
        videoId = youtubeId(input.url as string);
      } catch { throw new CloudError(400, 'Pega un enlace de YouTube válido.'); }
      if (busy) throw new CloudError(429, 'Ya hay una importación en curso. Espera a que termine.');
      const now = Date.now(); while (attempts.length && attempts[0] <= now - 60_000) attempts.shift();
      if (attempts.length >= 5) throw new CloudError(429, 'Espera un minuto antes de importar otro sonido.');
      attempts.push(now); busy = true; acquired = true;
      const remote = await (deps.provider ?? tubeMP3)(videoId, key, controller.signal);
      const audio = await (deps.download ?? downloadAudio)(remote.url, controller.signal);
      controller.signal.throwIfAborted();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'audio/mpeg'); res.setHeader('Content-Length', audio.length);
      res.setHeader('Content-Disposition', `attachment; filename="tapzi-${videoId}.mp3"`);
      res.setHeader('X-Tapzi-Title', encodeURIComponent(remote.title));
      res.end(audio);
    } catch (error) {
      if (!res.destroyed) {
        if (controller.signal.aborted) reply(504, { error: 'La importación tardó demasiado. No se guardó ningún sonido.' });
        else if (error instanceof CloudError) reply(error.status, { error: error.message });
        else reply(502, { error: 'No pudimos obtener este audio. Prueba más tarde o agrega un archivo.' });
      }
    } finally { if (acquired) busy = false; clearTimeout(timer); res.off('close', disconnect); }
  };
}
