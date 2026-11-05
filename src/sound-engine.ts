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
  /** Favors recently requested sounds when preparing the library. */
  prioritize(sound: Sound): void;
  /** Call from a gesture: replaces a context that stopped responding while the browser still allows starting a new one. */
  wake(): void;
  /** Keeps memory in step with the library and warms recent sounds and favorites first. */
  sync(sounds: Sound[]): void;
  /** `onStalled` means no sound is coming out, so the caller should play it another way. */
  open(buffer: AudioBuffer, onEnded: () => void, onStalled: () => void): Playback;
}

const BUDGET_BYTES = 128 * 1024 * 1024; // decoded PCM kept ready: about six minutes of stereo audio
const PRELOAD_LIMIT = BUDGET_BYTES * 0.75; // background warming stops here; taps may still fill the rest
const MAX_SECONDS = 120; // the longest clip the editor produces; longer files stream from the media element
const UNKNOWN_LENGTH_MAX_BYTES = 2 * 1024 * 1024;
const DECODE_TIMEOUT_MS = 15000; // a stuck decode must not hold up the sounds queued behind it
const MAX_ATTEMPTS = 3; // reading a stored file can fail for a moment, so one failure is not final
const STALL_MS = 600; // a context that has played before and whose clock has not moved by now is stuck
const FIRST_START_MS = 2500; // a new context can be this slow to open the output, as with Bluetooth
const FADE_SECONDS = 0.006; // cutting a waveform dead clicks, and spamming a pad would make that constant
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
  let ran = false; // whether the current context has ever produced audio
  const context = (): AudioContext => {
    if (ctx) return ctx;
    const created = new AudioContext();
    created.addEventListener('statechange', () => {
      if (ctx !== created) return;
      if (created.state === 'running') ran = true;
      else if (document.visibilityState !== 'hidden') recheck?.();
    });
    if (created.state === 'running') ran = true;
    return ctx = created;
  };
  const discard = (old: AudioContext): void => {
    if (ctx === old) { ctx = null; ran = false; }
    void old.close().catch(() => undefined);
  };
  let lifecycle: (() => void) | null = null;
  let recheck: (() => void) | null = null; // re-arms the stall check of the sound in progress
  // Browsers only let audio start from a gesture. Any gesture may be a scroll, so this only asks the context to
  // continue, which also lets a sound interrupted by a call carry on. If it does not, that sound's check reports it.
  const unlock = (): void => {
    try {
      const c = context();
      if (c.state === 'running') return;
      void c.resume().catch(() => undefined);
      recheck?.();
    } catch { /* Taps fall back to the media element. */ }
  };
  // After a call or the lock screen iOS can leave a context whose resume() never settles.
  const wake = (): void => {
    try {
      const c = context();
      if (c.state === 'running' || !ran) return;
      discard(c);
      void context().resume().catch(() => undefined);
    } catch { /* Taps fall back to the media element. */ }
  };
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(type, unlock, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => lifecycle?.());
  document.defaultView?.addEventListener('pageshow', () => lifecycle?.());

  const cache = new Map<string, AudioBuffer>(); // insertion order doubles as least-recently-used order
  const pending = new Map<string, Promise<void>>();
  const attempts = new Map<string, number>();
  let used = 0;
  let queue: LocalSound[] = [];
  let draining = false;
  let library: Sound[] = [];
  const recent = new Map<string, number>();
  let sequence = 0;
  let targets = new Set<string>();
  let liveKeys: Set<string> | undefined;
  const sizeOf = (buffer: AudioBuffer): number => buffer.length * buffer.numberOfChannels * 4;
  const keyOf = (sound: LocalSound): string => `${sound.id}:${sound.blob.size}`;
  const eligible = (sound: LocalSound): boolean => sound.duration === undefined ? sound.blob.size <= UNKNOWN_LENGTH_MAX_BYTES : sound.duration <= MAX_SECONDS;
  const canDecode = (sound: Sound): boolean => sound.source === 'local' && eligible(sound) && (attempts.get(keyOf(sound)) ?? 0) < MAX_ATTEMPTS;

  function remember(key: string, buffer: AudioBuffer): void {
    if (liveKeys && !liveKeys.has(key)) return; // deleted while its decode was in flight
    const size = sizeOf(buffer);
    if (size > BUDGET_BYTES) { attempts.set(key, MAX_ATTEMPTS); return; } // it will never fit, so do not decode it again
    if (cache.has(key)) return; // a decode that outlived its timeout can arrive after the retry
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
    if (sound.source !== 'local' || !canDecode(sound)) return Promise.resolve();
    const key = keyOf(sound);
    if (cache.has(key)) return Promise.resolve();
    let job = pending.get(key);
    if (!job) {
      // An offline context decodes without needing a gesture; the result plays on any context.
      const decode = sound.blob.arrayBuffer().then(data => new OfflineAudioContext(1, 1, 44100).decodeAudioData(data)).then(buffer => remember(key, buffer));
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error('Decode timed out')), DECODE_TIMEOUT_MS); });
      job = Promise.race([decode, timeout])
        .catch((error: unknown) => {
          const bad = error instanceof DOMException && error.name === 'EncodingError'; // the file itself, so retrying cannot help
          attempts.set(key, bad ? MAX_ATTEMPTS : (attempts.get(key) ?? 0) + 1);
        })
        .finally(() => { clearTimeout(timer); pending.delete(key); });
      pending.set(key, job);
    }
    return job;
  }
  async function drain(): Promise<void> {
    draining = true;
    try {
      while (queue.length) {
        // A newly favored sound may displace cold buffers, but never the current warm set.
        if (used >= PRELOAD_LIMIT) {
          for (const [key, buffer] of cache) {
            if (targets.has(key)) continue;
            cache.delete(key); used -= sizeOf(buffer);
            if (used < PRELOAD_LIMIT) break;
          }
          if (used >= PRELOAD_LIMIT) break;
        }
        await prepare(queue.shift()!); await idle();
      }
    } finally { draining = false; }
  }
  function sync(sounds: Sound[]): void {
    library = sounds;
    const live = new Set(sounds.filter((s): s is LocalSound => s.source === 'local').map(keyOf));
    liveKeys = live;
    for (const key of attempts.keys()) if (!live.has(key)) attempts.delete(key);
    for (const [key, buffer] of cache) if (!live.has(key)) { cache.delete(key); used -= sizeOf(buffer); }
    for (const key of recent.keys()) if (!sounds.some(sound => sound.id === key)) recent.delete(key);
    const ranked = sounds.filter((s): s is LocalSound => s.source === 'local' && canDecode(s)).sort((a, b) =>
      (recent.get(b.id) ?? 0) - (recent.get(a.id) ?? 0) || Number(b.favorite) - Number(a.favorite) ||
      (a.duration ?? MAX_SECONDS) - (b.duration ?? MAX_SECONDS) || b.createdAt - a.createdAt);
    let planned = 0;
    targets = new Set(); queue = [];
    for (const sound of ranked) {
      const key = keyOf(sound);
      const bytes = cache.has(key) ? sizeOf(cache.get(key)!) : (sound.duration ?? MAX_SECONDS) * 48000 * 2 * 4;
      if (planned + bytes > PRELOAD_LIMIT) continue;
      planned += bytes; targets.add(key);
      if (!cache.has(key) && !pending.has(key)) queue.push(sound);
    }
    if (!draining && queue.length) void drain();
  }
  function prioritize(sound: Sound): void {
    if (sound.source !== 'local') return;
    recent.set(sound.id, ++sequence);
    sync(library);
  }

  function open(buffer: AudioBuffer, onEnded: () => void, onStalled: () => void): Playback {
    let source: AudioBufferSourceNode | null = null;
    let host: AudioContext | null = null; // the context this sound is on, which may no longer be the current one
    let output: GainNode | null = null;
    let offset = 0, startedAt = 0, paused = true, checks = 0, watching = false;
    const position = (): number => paused || !source || !host ? offset : Math.min(buffer.duration, offset + host.currentTime - startedAt);
    const again = (): void => { if (!watching && host && !paused) watch(host); };
    const returned = (): void => {
      // Timers may have been frozen in the background. Start a fresh check on return.
      checks++; watching = false;
      if (document.visibilityState === 'hidden' || paused) return;
      unlock(); again();
    };
    const detach = (): void => {
      checks++; watching = false;
      if (recheck === again) recheck = null;
      if (lifecycle === returned) lifecycle = null;
      const node = source, gain = output, c = host; source = null; output = null;
      if (!node || !gain || !c) return;
      node.onended = () => { node.disconnect(); gain.disconnect(); };
      try {
        const end = c.currentTime + FADE_SECONDS;
        gain.gain.setValueAtTime(1, c.currentTime); gain.gain.linearRampToValueAtTime(0, end);
        node.stop(end);
      } catch { node.disconnect(); gain.disconnect(); } // Already stopped, or its context is closed.
    };
    const begin = (): void => {
      const c = context(), node = c.createBufferSource(), gain = c.createGain();
      node.buffer = buffer; node.connect(gain); gain.connect(c.destination);
      node.onended = () => { if (source !== node) return; detach(); paused = true; offset = buffer.duration; onEnded(); };
      source = node; output = gain; host = c; startedAt = c.currentTime;
      node.start(0, Math.min(offset, buffer.duration));
    };
    // resume() can stay pending forever and iOS can report "running" with a frozen clock. Both are silence with no error.
    function watch(c: AudioContext): void {
      const check = ++checks, before = c.currentTime;
      watching = true;
      setTimeout(() => {
        if (check !== checks) return;
        watching = false;
        if (document.visibilityState === 'hidden' || paused || (c.state === 'running' && c.currentTime > before)) return;
        offset = position(); discard(c); detach(); paused = true; onStalled();
      }, ran && c === ctx ? STALL_MS : FIRST_START_MS);
    }
    const play = (): void => {
      if (!paused) return;
      paused = false;
      wake();
      const c = context();
      host = c; watch(c); recheck = again; lifecycle = returned;
      if (c.state === 'running') { begin(); return; }
      c.resume().then(() => { if (!paused && !source) begin(); }, () => undefined); // a refusal is left for the watch to report
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

  return { cached, prepare, prioritize, wake, sync, open };
}
