import { createSound, MAX_AUDIO_BYTES } from './sounds.ts';
import type { LocalSound, YouTubeSound } from './sounds.ts';

const unavailable = 'Audio import is unavailable. Run Tapzi with npm run dev or npm run preview on the machine with yt-dlp and FFmpeg.';

export async function downloadSound(sound: YouTubeSound): Promise<LocalSound> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 130_000);
  try {
    const response = await fetch('/api/import-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${sound.videoId}`,
        start: String(sound.start), ...(sound.end === null ? {} : { end: String(sound.end) }) }),
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = response.status === 404 ? unavailable : 'Audio import failed. No sound was added.';
      try {
        const data = await response.json() as { error?: unknown };
        if (typeof data.error === 'string') message = data.error;
      } catch { /* Static hosting may return HTML instead of the local endpoint. */ }
      throw new Error(message);
    }
    if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('audio/mpeg')) throw new Error(unavailable);
    if (Number(response.headers.get('Content-Length')) > MAX_AUDIO_BYTES) throw new Error('Imported audio exceeds 25 MB. Try a shorter clip.');
    const audio = await response.blob();
    const local = createSound({ name: sound.name, source: 'local',
      file: new File([audio], `tapzi-${sound.videoId}.mp3`, { type: 'audio/mpeg' }) });
    if (local.source !== 'local') throw new Error('Audio import failed. No sound was added.');
    return local;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Import timed out. No sound was added; try again later.');
    if (error instanceof TypeError) throw new Error('Could not reach the local importer. Check that Tapzi is running on your computer.');
    throw error;
  } finally { clearTimeout(timer); }
}
