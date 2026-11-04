import { formatTime } from './sounds.ts';
import type { Sound } from './sounds.ts';

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
export function createPlayer(onChange: (id: string | null) => void): { play(sound: Sound): Promise<void>; stop(): void } {
  const audio = element<HTMLAudioElement>('#audio-player');
  const wrapper = element('#youtube-wrap');
  const idle = element('#idle-player');
  const state = element('#player-state');
  const message = element('#playback-message');
  let player: YouTubePlayer | null = null;
  let objectURL: string | null = null;
  let request = 0;
  let current: Sound | null = null;

  function stop(): void {
    request++;
    current = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio.hidden = true;
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null;
    if (player) { player.destroy(); player = null; }
    wrapper.replaceChildren(Object.assign(document.createElement('div'), { id: 'youtube-player' }));
    wrapper.hidden = true;
    idle.hidden = false;
    state.textContent = 'En pausa';
    message.textContent = '';
    element('#track-name').textContent = 'Tocá cualquier sonido';
    element('#track-detail').textContent = 'Uno a la vez, para que se escuche bien.';
    document.querySelectorAll<HTMLButtonElement>('.stop-all').forEach(button => { button.disabled = true; });
    onChange(null);
  }

  function fail(error: Error): void {
    stop();
    state.textContent = 'No se pudo reproducir';
    message.textContent = error.message;
  }

  audio.addEventListener('ended', stop);
  audio.addEventListener('error', () => {
    if (current?.source === 'local') fail(new Error('Este formato no se puede reproducir aquí. Probá MP3 o WAV.'));
  });
  audio.addEventListener('playing', () => {
    if (current?.source === 'local') state.textContent = 'Reproduciendo';
  });
  audio.addEventListener('pause', () => {
    if (current?.source === 'local') state.textContent = 'En pausa';
  });

  async function play(sound: Sound): Promise<void> {
    stop();
    const token = request;
    current = sound;
    onChange(sound.id);
    idle.hidden = true;
    state.textContent = 'Cargando';
    element('#track-name').textContent = sound.name;
    element('#track-detail').textContent = sound.source === 'youtube'
      ? `YouTube · ${formatTime(sound.start)} → ${sound.end === null ? 'end' : formatTime(sound.end)}`
      : 'Audio local · Guardado en este dispositivo';
    document.querySelectorAll<HTMLButtonElement>('.stop-all').forEach(button => { button.disabled = false; });
    try {
      if (sound.source === 'local') {
        objectURL = URL.createObjectURL(sound.blob);
        audio.src = objectURL;
        audio.hidden = false;
        await audio.play();
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
      if (token === request) fail(error instanceof Error ? error : new Error('No se pudo iniciar la reproducción. Intentá otra vez.'));
    }
  }
  return { play, stop };
}
