import type { IncomingMessage, ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSound, MAX_AUDIO_BYTES } from '../src/sounds.ts';

const errors = {
  setup: 'Install current yt-dlp with EJS and a JavaScript runtime; put yt-dlp on PATH or set TAPZI_YTDLP_PATH.',
  ffmpeg: 'Install FFmpeg (including ffprobe) on PATH or set TAPZI_FFMPEG_PATH.',
  failed: 'Audio extraction failed. Check your local tools and video availability; no audio was saved.',
  bot: 'YouTube blocked this request with a sign-in/bot check. Try on your local network later; no audio was saved.',
  timeout: 'Import timed out. Try a shorter clip or retry later; no audio was saved.',
  limits: 'Use a non-live video with a known duration up to 600 seconds and source size up to 25 MB.',
};
class ImportError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const failure = () => new ImportError(502, errors.failed);
const loopback = (address: string) => address === '::1' || /^127(?:\.\d{1,3}){3}$/.test(address.replace(/^::ffff:/i, ''));

function authorize(req: IncomingMessage, env: NodeJS.ProcessEnv): void {
  const host = req.headers.host;
  const protocol = 'encrypted' in req.socket && req.socket.encrypted ? 'https:' : 'http:';
  let served: URL;
  try {
    served = new URL(`${protocol}//${host}`);
    if (!host || served.host !== host || served.username || served.password) throw new Error();
  } catch { throw new ImportError(403, 'Import requires a same-origin request.'); }
  if (env.TAPZI_ALLOW_LAN_IMPORT !== '1' &&
      (!loopback(req.socket.remoteAddress ?? '') ||
       !(served.hostname === 'localhost' || loopback(served.hostname.replace(/^\[|\]$/g, ''))))) {
    throw new ImportError(403, 'Import is loopback-only. Use TAPZI_ALLOW_LAN_IMPORT=1 only on a trusted network.');
  }
  if (req.headers.origin !== served.origin || req.headers['sec-fetch-site'] === 'cross-site') {
    throw new ImportError(403, 'Import requires a same-origin request.');
  }
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) {
    throw new ImportError(415, 'Send application/json.');
  }
}

async function body(req: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  const text = await new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const finish = (error?: Error) => {
      req.off('data', data); req.off('end', end); req.off('error', fail);
      signal.removeEventListener('abort', abort);
      if (error) { req.resume(); reject(error); }
      else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4096) finish(new ImportError(413, 'Import JSON must be at most 4 KB.'));
      else chunks.push(chunk);
    };
    const end = () => finish();
    const fail = () => finish(failure());
    const abort = () => finish(signal.reason as Error);
    req.on('data', data); req.once('end', end); req.once('error', fail);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try { return JSON.parse(text) as unknown; } catch { throw new ImportError(400, 'Send valid JSON.'); }
}

function validate(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ImportError(400, 'Use JSON with url and optional start/end strings.');
  }
  const input = value as Record<string, unknown>;
  if (typeof input.url !== 'string' || ['start', 'end'].some(key => input[key] !== undefined && typeof input[key] !== 'string') ||
      Object.keys(input).some(key => !['url', 'start', 'end'].includes(key))) {
    throw new ImportError(400, 'Use JSON with url and optional start/end strings.');
  }
  try {
    const sound = createSound({ name: 'Imported audio', source: 'youtube', url: input.url,
      start: input.start as string | undefined, end: input.end as string | undefined });
    if (sound.source !== 'youtube') throw failure();
    return sound;
  } catch (error) { throw new ImportError(400, (error as Error).message); }
}

// Each process owns a POSIX process group, including yt-dlp's FFmpeg descendants.
async function execute(args: string[], env: NodeJS.ProcessEnv, signal: AbortSignal, cwd: string): Promise<string> {
  if (signal.aborted) throw signal.reason;
  return new Promise((resolve, reject) => {
    const child = spawn(env.TAPZI_YTDLP_PATH || 'yt-dlp', args, {
      env, cwd, detached: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let stopped: Error | undefined;
    const kill = () => {
      if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } }
    };
    const abort = () => { stopped = signal.reason as Error; kill(); };
    signal.addEventListener('abort', abort, { once: true });
    const capture = (chunk: Buffer, output: boolean) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) { stopped = failure(); kill(); return; }
      if (output) stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', (chunk: Buffer) => capture(chunk, true));
    child.stderr.on('data', (chunk: Buffer) => capture(chunk, false));
    child.once('error', (error: NodeJS.ErrnoException) => {
      stopped = new ImportError(503, error.code === 'ENOENT' ? errors.setup : errors.failed);
    });
    child.once('close', code => {
      signal.removeEventListener('abort', abort);
      kill();
      if (stopped) reject(stopped);
      else if (code !== 0) {
        const message = /sign in|not a bot/i.test(stderr) ? errors.bot :
          /(?:ffmpeg|ffprobe).*?(?:not found|not installed|not available|could not find)/i.test(stderr) ? errors.ffmpeg : errors.failed;
        reject(new ImportError(message === errors.ffmpeg ? 503 : 502, message));
      } else resolve(stdout);
    });
    if (signal.aborted) abort();
  });
}

export function createImporter(options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}) {
  const env = options.env ?? process.env;
  let busy = false;
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    if (req.url !== '/api/import-audio') { next(); return; }
    res.setHeader('Cache-Control', 'no-store');
    const sendError = (error: unknown) => {
      if (res.destroyed) return;
      const safe = error instanceof ImportError ? error : failure();
      res.statusCode = safe.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: safe.message }));
    };
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST'); sendError(new ImportError(405, 'Use POST /api/import-audio.')); return;
    }
    void (async () => {
      const controller = new AbortController();
      const abort = () => controller.abort(failure());
      req.once('aborted', abort);
      const closed = () => { if (!res.writableEnded) abort(); };
      res.once('close', closed);
      const timer = setTimeout(() => controller.abort(new ImportError(504, errors.timeout)), options.timeoutMs ?? 120_000);
      let directory: string | undefined;
      let monitor: ReturnType<typeof setInterval> | undefined;
      let ownsBusy = false;
      let audio: Buffer | undefined;
      let videoId = '';
      let caught: unknown;
      try {
        authorize(req, env);
        const sound = validate(await body(req, controller.signal));
        if (busy) throw new ImportError(429, 'An import is already running. Try again when it finishes.');
        if (process.platform === 'win32') throw new ImportError(503, 'Import requires a POSIX host (for example Linux, macOS or WSL) to safely stop downloader processes.');
        if (controller.signal.aborted) throw controller.signal.reason;
        busy = true; ownsBusy = true;
        directory = await mkdtemp(join(tmpdir(), 'tapzi-import-'));
        const workdir = directory;
        monitor = setInterval(() => {
          void readdir(workdir).then(async names => {
            const sizes = await Promise.all(names.map(name => stat(join(workdir, name)).then(info => info.size)));
            if (sizes.reduce((a, b) => a + b, 0) > MAX_AUDIO_BYTES) controller.abort(new ImportError(422, errors.limits));
          }).catch(() => { /* Files can disappear during conversion/cleanup. */ });
        }, 25);
        const common = ['--ignore-config', '--no-plugin-dirs', '--no-playlist', '--no-cache-dir',
          '--js-runtimes', 'node', '--retries', '0', '--fragment-retries', '0', '--extractor-retries', '0',
          '--file-access-retries', '0', '--socket-timeout', '15', '--no-progress', '--format', 'bestaudio/best',
          '--max-filesize', String(MAX_AUDIO_BYTES)];
        if (env.TAPZI_FFMPEG_PATH) common.push('--ffmpeg-location', env.TAPZI_FFMPEG_PATH);
        videoId = sound.videoId;
        const target = ['--', `https://www.youtube.com/watch?v=${videoId}`];
        const metadata = JSON.parse(await execute([...common, '--dump-single-json', '--skip-download', ...target], env, controller.signal, directory)) as Record<string, unknown>;
        const size = metadata.filesize ?? metadata.filesize_approx;
        if (typeof metadata.duration !== 'number' || !Number.isFinite(metadata.duration) || metadata.duration <= 0 ||
            metadata.duration > 600 || metadata.is_live || metadata.live_status === 'is_live' ||
            (typeof size === 'number' && size > MAX_AUDIO_BYTES)) throw new ImportError(422, errors.limits);
        if (sound.start >= metadata.duration || (sound.end !== null && sound.end > metadata.duration)) {
          throw new ImportError(422, 'Clip times must be within the video duration.');
        }
        const clip = sound.start || sound.end !== null ? ['--download-sections', `*${sound.start}-${sound.end ?? metadata.duration}`] : [];
        await execute([...common, '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '5',
          '--output', join(directory, 'audio.%(ext)s'), ...clip, ...target], env, controller.signal, directory);
        if (controller.signal.aborted) throw controller.signal.reason;
        const output = join(directory, 'audio.mp3');
        const info = await stat(output);
        if (!info.isFile() || info.size === 0) throw failure();
        if (info.size > MAX_AUDIO_BYTES) throw new ImportError(422, errors.limits);
        audio = await readFile(output);
        if (controller.signal.aborted) throw controller.signal.reason;
      } catch (error) { caught = error; }
      finally {
        clearTimeout(timer); clearInterval(monitor);
        if (directory) { try { await rm(directory, { recursive: true, force: true }); } catch { caught = failure(); } }
        if (ownsBusy) busy = false;
        req.off('aborted', abort); res.off('close', closed);
      }
      if (caught || !audio) { sendError(caught); return; }
      if (!res.destroyed) {
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', `attachment; filename="tapzi-${videoId}.mp3"`);
        res.setHeader('Content-Length', audio.length);
        res.end(audio);
      }
    })().catch(sendError);
  };
}
