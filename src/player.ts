import { formatTime } from './sounds.ts';
import type { Sound } from './sounds.ts';
import type { Playback, SoundEngine } from './sound-engine.ts';

interface VideoClip { videoId: string; startSeconds: number; endSeconds?: number }
interface YouTubePlayer {
  destroy(): void;
  getDuration(): number;
  loadVideoById(clip: VideoClip): void;
}
interface PlayerEvent { target: YouTubePlayer }
interface YouTubeOptions {
  width: string;
  height: string;
  videoId: string;
  playerVars: { playsinline: number; controls: number; origin: string };
  events: {
    onReady(event: PlayerEvent): void;
    onStateChange(event: PlayerEvent & { data: number }): void;
    onAutoplayBlocked(): void;
    onError(): void;
  };
}
interface YouTubeAPI { Player: new (element: string, options: YouTubeOptions) => YouTubePlayer }
declare global {
  interface Window { YT?: YouTubeAPI; onYouTubeIframeAPIReady?: () => void }
}

let api: Promise<YouTubeAPI> | null = null;
function youtubeAPI(): Promise<YouTubeAPI> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!api) api = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => fail(), 12000);
    const fail = (): void => {
      clearTimeout(timeout);
      script.remove();
      api = null;
      reject(new Error('YouTube no pudo cargar. Revisá tu conexión y volvé a tocar el sonido.'));
    };
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      if (window.YT) resolve(window.YT);
      else fail();
    };
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = fail;
    document.head.append(script);
  });
  return api;
}

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing player element: ${selector}`);
  return found;
}
export function createPlayer(onChange: (id: string | null) => void, engine: SoundEngine | null = null, onProgress: (fraction: number, paused: boolean) => void = () => undefined): { play(sound: Sound): Promise<void>; stop(): void } {
  const audio = element<HTMLAudioElement>('#audio-player');
  const wrapper = element('#youtube-wrap');
  const idle = element('#idle-player');
  const state = element('#player-state');
  const message = element('#playback-message');
  let player: YouTubePlayer | null = null;
  let objectURL: string | null = null;
  let request = 0;
  let current: Sound | null = null;
  let voice: Playback | null = null; // set while a decoded sound plays; otherwise the media element does
  let loading = false; // a tap is waiting for its sound to decode
  let holdPaused = false; // pause was pressed during that wait
  let ticker = 0;
  const interrupted = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';
  const pauseButton = element<HTMLButtonElement>('#play-pause');
  const seek = element<HTMLInputElement>('#playback-seek');
  const timeline = element('#playback-timeline');
  const replayButton = element<HTMLButtonElement>('#replay-sound');
  const isPaused = (): boolean => voice ? voice.paused : loading ? holdPaused : audio.paused;
  const progress = (): void => {
    if (current?.source !== 'local') return;
    const duration = voice ? voice.duration : Number.isFinite(audio.duration) ? audio.duration : 0;
    const now = voice ? voice.position() : audio.currentTime;
    seek.max = String(duration || 1); seek.value = String(now);
    seek.disabled = !duration;
    seek.setAttribute('aria-valuetext', `${formatTime(now)} de ${formatTime(duration)}`);
    element('#playback-current').textContent = formatTime(now);
    element('#playback-total').textContent = formatTime(duration);
    onProgress(duration ? Math.min(1, now / duration) : 0, isPaused());
  };
  const pauseState = (): void => {
    pauseButton.setAttribute('aria-label', isPaused() ? 'Continuar reproducción' : 'Pausar');
    pauseButton.querySelector('use')!.setAttribute('href', isPaused() ? '#i-play' : '#i-pause');
    progress();
  };
  // Decoded playback raises no media events, so the transport is refreshed after each action and on a short timer.
  const voiceChanged = (): void => {
    clearInterval(ticker);
    if (voice && !voice.paused) ticker = window.setInterval(progress, 100);
    progress(); pauseState();
    state.textContent = voice?.paused ? 'En pausa' : 'Reproduciendo';
  };
  /** Plays the current local sound again from the top, keeping everything already loaded. */
  const restart = (): void => {
    if (loading) { holdPaused = false; pauseState(); state.textContent = 'Cargando'; return; }
    if (voice) { voice.seek(0); voice.play(); voiceChanged(); return; }
    const token = request; audio.currentTime = 0;
    void audio.play().catch(error => { if (token === request && !interrupted(error)) fail(new Error('No se pudo repetir el audio.')); });
  };
  pauseButton.addEventListener('click', () => {
    if (current?.source !== 'local') return;
    if (loading) { holdPaused = !holdPaused; pauseState(); state.textContent = holdPaused ? 'En pausa' : 'Cargando'; return; }
    if (voice) { if (voice.paused) voice.play(); else voice.pause(); voiceChanged(); return; }
    if (!audio.paused) audio.pause();
    else { const token = request; void audio.play().catch(error => { if (token === request && !interrupted(error)) fail(new Error('No se pudo continuar el audio. Toca el sonido para intentarlo otra vez.')); }); }
  });
  replayButton.addEventListener('click', () => {
    if (current?.source === 'local') restart();
  });
  seek.addEventListener('input', () => {
    if (voice) { voice.seek(Number(seek.value)); voiceChanged(); return; }
    if (current?.source === 'local' && Number.isFinite(audio.duration)) audio.currentTime = Number(seek.value);
  });
  for (const event of ['timeupdate', 'durationchange', 'loadedmetadata']) audio.addEventListener(event, progress);
  for (const event of ['playing', 'pause', 'ended']) audio.addEventListener(event, pauseState);


  /** Stops whatever is playing without touching the interface, so a new sound can start first. */
  function release(): void {
    request++;
    current = null;
    clearInterval(ticker);
    voice?.stop(); voice = null;
    loading = false; holdPaused = false;
    if (!audio.paused) audio.pause();
    if (audio.hasAttribute('src')) { audio.removeAttribute('src'); audio.load(); }
    audio.hidden = true;
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null;
    if (player || !wrapper.hidden) {
      if (player) { player.destroy(); player = null; }
      wrapper.replaceChildren(Object.assign(document.createElement('div'), { id: 'youtube-player' }));
      wrapper.hidden = true;
    }
  }

  function stop(): void {
    release();
    idle.hidden = false;
    state.textContent = 'En pausa';
    message.textContent = '';
    element('#track-name').textContent = 'Selecciona un sonido';
    seek.value = '0'; seek.disabled = true; pauseState();
    element('#track-detail').textContent = 'Uno a la vez, para que se escuche bien.';
    document.querySelectorAll<HTMLButtonElement>('.stop-all').forEach(button => { button.disabled = true; });
    onChange(null);
  }

  function fail(error: Error): void {
    stop();
    state.textContent = 'No se pudo reproducir';
    message.textContent = error.message;
  }

  audio.addEventListener('ended', () => { if (!voice) stop(); });
  audio.addEventListener('error', () => {
    if (current?.source === 'local' && !voice) fail(new Error('Este formato no se puede reproducir aquí. Probá MP3 o WAV.'));
  });
  audio.addEventListener('playing', () => {
    if (current?.source === 'local' && !voice) state.textContent = 'Reproduciendo';
  });
  audio.addEventListener('pause', () => {
    if (current?.source === 'local' && !voice && !loading) state.textContent = 'En pausa';
  });

  /** The media element loads on demand, which is slower but handles any length and needs no decoded memory. */
  async function playElement(sound: Extract<Sound, { source: 'local' }>, token: number, from = 0): Promise<void> {
    objectURL = URL.createObjectURL(sound.blob);
    audio.src = objectURL;
    audio.hidden = false;
    if (from) audio.currentTime = from;
    if (holdPaused) { holdPaused = false; pauseState(); return; } // paused while it loaded; the transport continues it
    try {
      await audio.play();
      if (token === request) void engine?.prepare(sound); // the next tap on this sound will be instant
    } catch (error) {
      if (token !== request || interrupted(error)) return;
      // A fallback that starts after a wait may have lost the gesture. The sound is ready for the next tap.
      const blocked = error instanceof DOMException && error.name === 'NotAllowedError';
      fail(blocked ? new Error('No se pudo iniciar el audio. Toca el sonido otra vez.') : error instanceof Error ? error : new Error('No se pudo iniciar la reproducción. Intentá otra vez.'));
    }
  }
  function playDecoded(sound: Extract<Sound, { source: 'local' }>, buffer: AudioBuffer, token: number): void {
    voice = engine!.open(buffer, () => { if (token === request) stop(); }, () => {
      if (token !== request) return;
      const from = voice?.position() ?? 0;
      clearInterval(ticker); voice = null;
      void playElement(sound, token, from);
    });
    if (!holdPaused) voice.play();
  }

  async function play(sound: Sound): Promise<void> {
    // Pressing the playing sound again starts it over, so a pad can be spammed.
    if (current?.id === sound.id && current.source === 'local') { restart(); return; }
    const warm = sound.source === 'local' ? engine?.cached(sound) : undefined;
    release();
    if (sound.source === 'local') engine?.wake();
    const token = request;
    current = sound;
    // Sound first, interface second: this is the delay the user can feel.
    if (warm && sound.source === 'local') playDecoded(sound, warm, token);
    onChange(sound.id);
    idle.hidden = true;
    state.textContent = 'Cargando';
    timeline.hidden = sound.source !== 'local'; pauseButton.hidden = sound.source !== 'local'; replayButton.hidden = sound.source !== 'local';
    element('#track-name').textContent = sound.name;
    element('#track-detail').textContent = sound.source === 'youtube'
      ? `YouTube · ${formatTime(sound.start)} → ${sound.end === null ? 'final' : formatTime(sound.end)}`
      : 'Audio local · Guardado en este dispositivo';
    message.textContent = '';
    document.querySelectorAll<HTMLButtonElement>('.stop-all').forEach(button => { button.disabled = false; });
    try {
      if (voice) voiceChanged();
      else if (sound.source === 'local') {
        // Decoding is quicker than loading a media element and leaves the sound ready to spam.
        if (engine?.decodesQuickly(sound)) {
          loading = true; pauseState();
          const buffer = await engine.decoded(sound);
          if (token !== request) return;
          loading = false;
          if (buffer) { playDecoded(sound, buffer, token); voiceChanged(); return; }
        }
        await playElement(sound, token);
      } else {
        if (!navigator.onLine) throw new Error('Este sonido es un enlace de YouTube y necesita internet. Los audios locales siguen disponibles.');
        wrapper.hidden = false;
        message.textContent = 'YouTube necesita internet. Si no comienza, tocá reproducir en el video.';
        const YT = await youtubeAPI();
        if (token !== request) return;
        player = new YT.Player('youtube-player', {
          width: '100%', height: '220',
          videoId: sound.videoId,
          playerVars: { playsinline: 1, controls: 1, origin: window.location.origin },
          events: {
            onReady(event) {
              if (token !== request) return;
              const clip: VideoClip = { videoId: sound.videoId, startSeconds: sound.start };
              if (sound.end !== null) clip.endSeconds = sound.end;
              event.target.loadVideoById(clip);
            },
            onStateChange(event) {
              if (token !== request) return;
              if (event.data === 0) stop();
              else if (event.data === 1) {
                const duration = event.target.getDuration();
                if (duration && sound.start >= duration) {
                  fail(new Error('El fragmento empieza después del final del video. Agregalo con otro inicio.'));
                  return;
                }
                state.textContent = 'Reproduciendo';
                message.textContent = 'YouTube usa internet y puede incluir anuncios.';
              } else if (event.data === 2 || event.data === 5) state.textContent = 'En pausa';
              else if (event.data === 3) state.textContent = 'Cargando';
            },
            onAutoplayBlocked() { if (token === request) { state.textContent = 'Listo'; message.textContent = 'Tocá reproducir en el video para empezar.'; } },
            onError() { if (token === request) fail(new Error('YouTube no permite reproducir este video aquí. Puede ser privado, haber sido eliminado o tener restricciones.')); },
          },
        });
      }
    } catch (error) {
      if (token === request && !interrupted(error)) fail(error instanceof Error ? error : new Error('No se pudo iniciar la reproducción. Intentá otra vez.'));
    }
  }
  return { play, stop };
}
