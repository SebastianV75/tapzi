import type { Sound } from './sounds.ts';

type LocalSound = Extract<Sound, { source: 'local' }>;

/** One sound being played from decoded memory. Mirrors the media-element controls the player needs. */
export interface Playback {
  readonly duration: number;
  readonly paused: boolean;
  position(): number;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  stop(): void;
}
export interface SoundEngine {
  /** The decoded sound, only if it is already in memory. Never waits. */
  cached(sound: Sound): AudioBuffer | undefined;
  /** Decodes in the background so the next tap is instant. Never rejects. */
  prepare(sound: Sound): Promise<void>;
  /** Keeps memory in step with the library and warms the newest sounds. */
  sync(sounds: Sound[]): void;
  open(buffer: AudioBuffer, onEnded: () => void, onError: () => void): Playback;
}

const BUDGET_BYTES = 64 * 1024 * 1024; // decoded PCM kept ready
const PRELOAD_LIMIT = BUDGET_BYTES * 0.75; // background warming stops here; taps may still fill the rest
const MAX_SECONDS = 120; // the longest clip the editor produces; longer files stream from the media element
const UNKNOWN_LENGTH_MAX_BYTES = 2 * 1024 * 1024;
const idle = (): Promise<void> => new Promise(resolve => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 500 }); else setTimeout(resolve, 30);
});

/**
 * Starting an <audio> element means fetching, parsing and buffering first, which on phones is the lag you feel.
 * A decoded AudioBuffer starts immediately. Returns null where Web Audio is unavailable, or with ?audio=compat,
 * and the player then uses the media element for everything.
 */
export function createSoundEngine(): SoundEngine | null {
  if (typeof AudioContext === 'undefined' || typeof OfflineAudioContext === 'undefined') return null;
  if (new URLSearchParams(location.search).get('audio') === 'compat') return null;
  // Without this iOS mutes Web Audio when the silent switch is on, unlike a media element.
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) try { session.type = 'playback'; } catch { /* Optional API. */ }

  let ctx: AudioContext | null = null;
  const context = (): AudioContext => ctx ??= new AudioContext();
  // Browsers only let audio start from a gesture; resuming on every one also recovers from iOS interruptions.
  const unlock = (): void => {
    try { const c = context(); if (c.state !== 'running') void c.resume().catch(() => undefined); } catch { /* Taps fall back to the media element. */ }
  };
  for (const type of ['pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(type, unlock, { capture: true, passive: true });

  const cache = new Map<string, AudioBuffer>(); // insertion order doubles as least-recently-used order
  const pending = new Map<string, Promise<void>>();
  const failed = new Set<string>();
  let used = 0;
  let queue: LocalSound[] = [];
  let draining = false;
  const sizeOf = (buffer: AudioBuffer): number => buffer.length * buffer.numberOfChannels * 4;
  const keyOf = (sound: LocalSound): string => `${sound.id}:${sound.blob.size}`;
  const eligible = (sound: LocalSound): boolean => sound.duration === undefined ? sound.blob.size <= UNKNOWN_LENGTH_MAX_BYTES : sound.duration <= MAX_SECONDS;

  function remember(key: string, buffer: AudioBuffer): void {
    const size = sizeOf(buffer);
    if (size > BUDGET_BYTES) return;
    cache.set(key, buffer); used += size;
    for (const [oldKey, old] of cache) {
      if (used <= BUDGET_BYTES) break;
      if (oldKey !== key) { cache.delete(oldKey); used -= sizeOf(old); }
    }
  }
  function cached(sound: Sound): AudioBuffer | undefined {
    if (sound.source !== 'local') return undefined;
    const key = keyOf(sound), buffer = cache.get(key);
    if (buffer) { cache.delete(key); cache.set(key, buffer); }
    return buffer;
  }
  function prepare(sound: Sound): Promise<void> {
    if (sound.source !== 'local' || !eligible(sound)) return Promise.resolve();
    const key = keyOf(sound);
    if (cache.has(key) || failed.has(key)) return Promise.resolve();
    let job = pending.get(key);
    if (!job) {
      // An offline context decodes without needing a gesture; the result plays on any context.
      job = sound.blob.arrayBuffer().then(data => new OfflineAudioContext(1, 1, 44100).decodeAudioData(data))
        .then(buffer => remember(key, buffer), () => { failed.add(key); })
        .finally(() => { pending.delete(key); });
      pending.set(key, job);
    }
    return job;
  }
  async function drain(): Promise<void> {
    draining = true;
    try {
      while (queue.length && used < PRELOAD_LIMIT) { await prepare(queue.shift()!); await idle(); }
    } finally { draining = false; }
  }
  function sync(sounds: Sound[]): void {
    const live = new Set<string>();
    queue = [];
    for (const sound of sounds) {
      if (sound.source !== 'local') continue;
      const key = keyOf(sound);
      live.add(key);
      if (!cache.has(key) && !pending.has(key) && !failed.has(key) && eligible(sound)) queue.push(sound);
    }
    for (const [key, buffer] of cache) if (!live.has(key)) { cache.delete(key); used -= sizeOf(buffer); }
    if (!draining && queue.length) void drain();
  }

  function open(buffer: AudioBuffer, onEnded: () => void, onError: () => void): Playback {
    let source: AudioBufferSourceNode | null = null;
    let offset = 0, startedAt = 0, paused = true;
    const position = (): number => paused || !source ? offset : Math.min(buffer.duration, offset + context().currentTime - startedAt);
    const detach = (): void => {
      const node = source; source = null;
      if (!node) return;
      node.onended = null;
      try { node.stop(); } catch { /* Already stopped. */ }
      node.disconnect();
    };
    const begin = (): void => {
      const c = context(), node = c.createBufferSource();
      node.buffer = buffer; node.connect(c.destination);
      node.onended = () => { if (source !== node) return; source = null; paused = true; offset = buffer.duration; onEnded(); };
      source = node; startedAt = c.currentTime;
      node.start(0, Math.min(offset, buffer.duration));
    };
    const play = (): void => {
      if (!paused) return;
      paused = false;
      const c = context();
      if (c.state === 'running') { begin(); return; }
      c.resume().then(() => { if (!paused && !source) begin(); }, () => { paused = true; onError(); });
    };
    return {
      duration: buffer.duration,
      get paused() { return paused; },
      position, play,
      pause() { if (paused) return; offset = position(); detach(); paused = true; },
      seek(seconds) { const again = !paused; detach(); paused = true; offset = Math.max(0, Math.min(seconds, buffer.duration)); if (again) play(); },
      stop() { detach(); paused = true; },
    };
  }

  return { cached, prepare, sync, open };
}
