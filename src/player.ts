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
      reject(new Error('YouTube could not load. Check your connection or content blocker, then tap the pad to retry.'));
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
    state.textContent = 'Standby';
    message.textContent = '';
    element('#track-name').textContent = 'No sound selected';
    element('#track-detail').textContent = 'One sound at a time. All yours.';
    document.querySelectorAll<HTMLButtonElement>('.stop-all').forEach(button => { button.disabled = true; });
    onChange(null);
  }

  function fail(error: Error): void {
    stop();
    state.textContent = 'Could not play';
    message.textContent = error.message;
  }

  audio.addEventListener('ended', stop);
  audio.addEventListener('error', () => {
    if (current?.source === 'local') fail(new Error('This browser could not play that audio format. Try MP3 or WAV.'));
  });
  audio.addEventListener('playing', () => {
    if (current?.source === 'local') state.textContent = 'Playing';
  });
  audio.addEventListener('pause', () => {
    if (current?.source === 'local') state.textContent = 'Paused';
  });

  async function play(sound: Sound): Promise<void> {
    stop();
    const token = request;
    current = sound;
    onChange(sound.id);
    idle.hidden = true;
    state.textContent = 'Loading';
    element('#track-name').textContent = sound.name;
    element('#track-detail').textContent = sound.source === 'youtube'
      ? `YouTube · ${formatTime(sound.start)} → ${sound.end === null ? 'end' : formatTime(sound.end)}`
      : 'Local audio · Saved on this device';
    document.querySelectorAll<HTMLButtonElement>('.stop-all').forEach(button => { button.disabled = false; });
    try {
      if (sound.source === 'local') {
        objectURL = URL.createObjectURL(sound.blob);
        audio.src = objectURL;
        audio.hidden = false;
        await audio.play();
      } else {
        wrapper.hidden = false;
        message.textContent = 'YouTube needs internet. If playback does not start, tap Play in the visible player.';
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
                  fail(new Error('This clip starts after the video ends. Add it again with an earlier start.'));
                  return;
                }
                state.textContent = 'Playing';
                message.textContent = 'YouTube playback uses internet and may include ads';
              } else if (event.data === 2 || event.data === 5) state.textContent = 'Paused';
              else if (event.data === 3) state.textContent = 'Buffering';
            },
            onAutoplayBlocked() { if (token === request) { state.textContent = 'Ready'; message.textContent = 'Tap Play in the YouTube player to begin'; } },
            onError() { if (token === request) fail(new Error('YouTube cannot play this video here. It may be private, removed, or blocked from embedding.')); },
          },
        });
      }
    } catch (error) {
      if (token === request) fail(error instanceof Error ? error : new Error('Unable to start playback. Try again.'));
    }
  }
  return { play, stop };
}
