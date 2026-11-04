import { clipRange, isVideo, MAX_CLIP_SECONDS, validateMedia } from './media.ts';
import { formatTime, MAX_AUDIO_BYTES } from './sounds.ts';

interface Options {
  onReady(): void;
  onError(error: unknown, field?: string): void;
}
const $ = <T extends Element = HTMLElement>(id: string): T => document.querySelector<T>(id)!;
const number = (id: string): HTMLInputElement => $<HTMLInputElement>(id);
const clock = (seconds: number): string => `${formatTime(seconds)}${seconds % 1 > .005 ? `.${Math.floor((seconds % 1) * 10)}` : ''}`;

export function createClipEditor(options: Options) {
  const preview = $<HTMLVideoElement>('#media-preview');
  const picker = $<HTMLInputElement>('#sound-file');
  const listen = $<HTMLButtonElement>('#preview-clip');
  let file: File | null = null;
  let objectURL: string | null = null;
  let duration = 0;
  let endPreview: number | null = null;
  let suggestedName = '';
  let generation = 0;
  let metadataTimer: ReturnType<typeof setTimeout> | undefined;

  function pause(): void { preview.pause(); endPreview = null; }
  function trimOpen(open: boolean): void {
    $('#trim-editor').hidden = !open;
    $('#toggle-trim').setAttribute('aria-expanded', String(open));
  }
  function selection(): { start: number; end: number; duration: number } {
    if (!number('#local-start').value || !number('#local-end').value) throw new Error('Completa el inicio y el final del fragmento.');
    const start = Number(number('#local-start').value), end = Number(number('#local-end').value);
    clipRange(start, end, duration);
    return { start, end, duration };
  }
  function sync(): void {
    const start = Number(number('#local-start').value), end = Number(number('#local-end').value);
    number('#trim-start').value = String(start); number('#trim-end').value = String(end);
    number('#trim-start').setAttribute('aria-valuetext', clock(start)); number('#trim-end').setAttribute('aria-valuetext', clock(end));
    $('#start-label').textContent = clock(start); $('#end-label').textContent = clock(end);
    $('#trim-track').style.setProperty('--start', `${Math.min(100, Math.max(0, start / duration * 100))}%`);
    $('#trim-track').style.setProperty('--end', `${Math.min(100, Math.max(0, end / duration * 100))}%`);
    const full = start === 0 && Math.abs(end - duration) < .01;
    $('#media-duration').textContent = full ? `${clock(duration)} · Audio completo` : `${clock(Math.max(0, end - start))} seleccionados de ${clock(duration)}`;
    listen.setAttribute('aria-label', full ? 'Escuchar audio' : 'Escuchar fragmento');
  }
  function reset(): void {
    generation++; clearTimeout(metadataTimer); pause();
    preview.removeAttribute('src'); preview.load();
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null; file = null; duration = 0; suggestedName = ''; picker.value = '';
    $('#file-picker').hidden = false; $('#selected-file').hidden = true;
    $('#media-editor').hidden = true; $('#media-loading').hidden = true; trimOpen(false);
    $<HTMLDetailsElement>('#video-preview-wrap').open = false;
    $<SVGPathElement>('#waveform path').setAttribute('d', 'M0 28H300');
    options.onReady();
  }
  // Optional actual waveform for short clips; large inputs keep a neutral timeline.
  // Never manufacture waveform data or make decoding a requirement for saving full audio.
  async function waveform(selected: File, token: number): Promise<void> {
    if (selected.size > 8 * 1024 * 1024 || duration > 120) return;
    const context = new AudioContext();
    try {
      const audio = await context.decodeAudioData(await selected.arrayBuffer());
      if (token !== generation) return;
      const data = audio.getChannelData(0), count = 75;
      let path = '';
      for (let bar = 0; bar < count; bar++) {
        const start = Math.floor(bar / count * data.length), stop = Math.floor((bar + 1) / count * data.length);
        let peak = 0;
        for (let i = start; i < stop; i += 8) peak = Math.max(peak, Math.abs(data[i]));
        const height = Math.max(.5, Math.min(24, Math.sqrt(peak) * 24));
        path += `M${bar * 4 + 2} ${28 - height}v${height * 2}`;
      }
      $<SVGPathElement>('#waveform path').setAttribute('d', path);
    } catch { /* The trim controls still work without a waveform. */ }
    finally { await context.close(); }
  }
  function choose(selected: File): void {
    const previousSuggestion = suggestedName;
    reset();
    options.onError(null);
    try {
      validateMedia(selected); file = selected;
      suggestedName = selected.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 60);
      const name = number('#sound-name');
      if (!name.value.trim() || name.value === previousSuggestion) name.value = suggestedName;
      $('#file-picker').hidden = true; $('#selected-file').hidden = false; $('#media-loading').hidden = false;
      $('#file-name').textContent = selected.name;
      $('#file-detail').textContent = `${isVideo(selected) ? 'Video' : 'Audio'} · ${selected.size < 1024 * 1024 ? Math.max(1, Math.round(selected.size / 1024)) + ' KB' : (selected.size / 1024 / 1024).toFixed(1) + ' MB'}`;
      objectURL = URL.createObjectURL(selected); preview.src = objectURL;
      preview.classList.toggle('audio-only', !isVideo(selected));
      $('#video-preview-wrap').hidden = !isVideo(selected);
      metadataTimer = setTimeout(() => { if (!duration) { $('#media-loading').hidden = true; options.onError(new Error('El archivo está tardando en abrir. Prueba elegirlo otra vez o usar un MP3 o M4A.')); } }, 15000);
    } catch (error) { options.onError(error, '#sound-file'); }
  }
  picker.addEventListener('change', () => { const selected = picker.files?.[0]; if (selected) choose(selected); });
  $('#change-file').addEventListener('click', () => picker.click());
  const dropzone = $('#file-picker');
  for (const type of ['dragenter', 'dragover']) dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.add('is-dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
  dropzone.addEventListener('drop', event => {
    event.preventDefault(); dropzone.classList.remove('is-dragover');
    const files = (event as DragEvent).dataTransfer?.files;
    if (files?.length !== 1) { options.onError(new Error('Agrega un archivo a la vez.')); return; }
    choose(files[0]);
  });
  preview.addEventListener('loadedmetadata', () => {
    if (!file || !objectURL || preview.currentSrc !== objectURL) return;
    clearTimeout(metadataTimer); $('#media-loading').hidden = true;
    if (!Number.isFinite(preview.duration) || preview.duration <= 0) { options.onError(new Error('No pudimos leer la duración. Prueba con otro archivo.')); return; }
    duration = preview.duration;
    const needsShortClip = (isVideo(file) || file.size > MAX_AUDIO_BYTES) && duration > MAX_CLIP_SECONDS;
    const end = needsShortClip ? MAX_CLIP_SECONDS : duration;
    number('#local-start').value = '0'; number('#local-end').value = String(end);
    for (const id of ['#local-start', '#local-end', '#trim-start', '#trim-end']) number(id).max = String(duration);
    $('#media-editor').hidden = false; trimOpen(needsShortClip); sync(); options.onReady();
    if (needsShortClip) $('#trim-help').textContent = 'Seleccionamos los primeros 2 minutos. Mueve los extremos para elegir otro momento.';
    else $('#trim-help').textContent = 'Arrastra los extremos. Puedes guardar hasta 2 minutos.';
    // Waveform is optional and never blocks the primary action.
    void waveform(file, generation);
  });
  preview.addEventListener('error', () => {
    if (!objectURL) return;
    clearTimeout(metadataTimer); duration = 0; $('#media-loading').hidden = true; $('#media-editor').hidden = true; options.onReady();
    options.onError(new Error('No pudimos abrir este formato. Prueba con MP3, M4A o un MP4 con audio AAC.'));
  });
  const updatePreviewState = (): void => {
    const playing = !preview.paused;
    listen.querySelector('use')!.setAttribute('href', playing ? '#i-pause' : '#i-play');
    listen.setAttribute('aria-label', playing ? 'Pausar preescucha' : 'Escuchar fragmento');
    $('#preview-title').textContent = playing ? 'Así suena' : 'Escucha cómo queda';
  };
  for (const event of ['playing', 'pause', 'ended']) preview.addEventListener(event, updatePreviewState);
  preview.addEventListener('timeupdate', () => { if (endPreview !== null && preview.currentTime >= endPreview) pause(); });
  listen.addEventListener('click', () => {
    if (!preview.paused) { pause(); return; }
    try { const { start, end } = selection(); preview.currentTime = start; endPreview = end; const token = generation; void preview.play().catch(error => { if (token === generation && !(error instanceof DOMException && error.name === 'AbortError')) options.onError(new Error('No pudimos reproducir este archivo. Prueba con otro formato.')); }); }
    catch (error) { options.onError(error); }
  });
  $('#toggle-trim').addEventListener('click', () => { const open = $('#trim-editor').hidden; trimOpen(open);  });
  $('#reset-trim').addEventListener('click', () => {
    pause(); number('#local-start').value = '0'; number('#local-end').value = String(duration); sync(); options.onError(null);
  });
  for (const edge of ['start', 'end'] as const) {
    number(`#trim-${edge}`).addEventListener('input', () => {
      pause();
      const start = Number(number('#local-start').value), end = Number(number('#local-end').value);
      const value = Number(number(`#trim-${edge}`).value);
      number(`#local-${edge}`).value = String(edge === 'start' ? Math.max(0, Math.min(value, end - .01)) : Math.min(duration, Math.max(value, start + .01)));
      sync(); options.onError(null);
    });
    number(`#local-${edge}`).addEventListener('input', () => { pause(); sync(); });
  }
  return { reset, pause, selection, getFile: () => file, ready: () => !!file && duration > 0 };
}
