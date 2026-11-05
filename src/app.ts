import { COLORS, createSound, matchesSound, formatTime } from './sounds.ts';
import type { Sound, SoundColor } from './sounds.ts';
import { allSounds, saveSound, removeSound, restoreSounds } from './storage.ts';
import { createPlayer } from './player.ts';
import { prepareAudio, encodeWav } from './media.ts';
import { makeBackup, readBackup } from './backup.ts';
import { setupOffline } from './offline.ts';
import { createClipEditor } from './clip-editor.ts';
import { createYouTubeImport } from './youtube-import.ts';

function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing interface element: ${selector}`);
  return element;
}
const message = (error: unknown): string => error instanceof Error ? error.message : 'Algo salió mal. Intentá otra vez.';
const dialog = $<HTMLDialogElement>('#add-dialog');
const form = $<HTMLFormElement>('#add-form');
const editDialog = $<HTMLDialogElement>('#edit-dialog');
const settings = $<HTMLDialogElement>('#settings-dialog');
const search = $<HTMLInputElement>('#search');
const input = (id: string): HTMLInputElement => $<HTMLInputElement>(id);
const source = (): string => input('input[name="source"]:checked').value;
let sounds: Sound[] = [];
let favoritesOnly = false;
let activeId: string | null = null;
let saving = false;
let editing: string | null = null;
let deleted: Sound | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let storageReady = false;
const pending = new Set<string>();
function focusSound(id?: string): void {
  const pad = [...document.querySelectorAll<HTMLButtonElement>('.pad')].find(node => node.dataset.soundId === id);
  (pad ?? document.querySelector<HTMLButtonElement>('.pad') ?? [...document.querySelectorAll<HTMLButtonElement>('.add-trigger')].find(node => node.checkVisibility()))?.focus();
}

function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon'); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', `#i-${name}`); svg.append(use); return svg;
}
function text<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, content: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.className = className; element.textContent = content; return element;
}
function errorAt(id: string, error: unknown): void {
  const node = $(id); node.textContent = error ? message(error) : ''; node.hidden = !error;
}
function formError(error: unknown, field?: string): void {
  errorAt('#form-error', error);
  form.querySelectorAll('[aria-invalid]').forEach(node => node.removeAttribute('aria-invalid'));
  if (error && field) { $(field).setAttribute('aria-invalid', 'true'); $(field).focus(); }
}

function toast(content: string, undo = false): void {
  clearTimeout(toastTimer); $('#toast-message').textContent = content; $('#undo-delete').hidden = !undo; $('#toast').hidden = false;
  if (!undo) toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000);
}
function chosenColor(name: string): SoundColor { const color = input(`input[name="${name}"]:checked`).value; return COLORS.includes(color as SoundColor) ? color as SoundColor : 'lavender'; }
function setBusy(target: HTMLElement, busy: boolean): void {
  target.setAttribute('aria-busy', String(busy));
  target.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach(node => { node.disabled = busy; });
}
function render(): void {
  const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusId = focus?.dataset.soundId; const action = focus?.dataset.action;
  const board = $('#board'); board.replaceChildren();
  const visible = sounds.filter(sound => (!favoritesOnly || sound.favorite) && matchesSound(sound, search.value));
  $('#total').textContent = String(sounds.length);
  $('#empty').hidden = sounds.length !== 0;
  $('.library-footer').hidden = !sounds.length;
  $('#no-results-title').textContent = favoritesOnly && !search.value.trim() ? 'Tus favoritos van aquí' : 'No encontramos ese sonido';
  $('#no-results-description').textContent = favoritesOnly && !search.value.trim() ? 'Toca la estrella de un sonido para tenerlo siempre a mano.' : 'Prueba con otro nombre o vuelve a verlos todos.'; $('#no-results').hidden = sounds.length === 0 || visible.length !== 0;
  board.hidden = visible.length === 0; board.setAttribute('aria-busy', 'false');
  for (const [id, selected] of [['#all-filter', !favoritesOnly], ['#favorite-filter', favoritesOnly]] as const) { $(id).setAttribute('aria-pressed', String(selected)); $(id).classList.toggle('selected', selected); }
  const positions = new Map(sounds.map((sound, index) => [sound.id, String(index + 1).padStart(2, '0')]));
  for (const sound of visible) {
    const card = document.createElement('li'); card.className = `sound-card${sound.id === activeId ? ' is-playing' : ''}`; card.dataset.color = sound.color ?? 'lavender';
    const pad = document.createElement('button'); pad.className = 'pad'; pad.dataset.soundId = sound.id; pad.dataset.action = 'play';
    pad.setAttribute('aria-label', `${sound.id === activeId ? 'Detener' : 'Reproducir'} ${sound.name}`); pad.setAttribute('aria-pressed', String(sound.id === activeId));
    const top = text('span', 'pad-top', ''); const playIcon = text('span', 'pad-icon', ''); playIcon.append(icon(sound.id === activeId ? 'stop' : 'wave'));
    const position = text('span', 'pad-index', positions.get(sound.id) ?? ''); position.setAttribute('aria-hidden', 'true');
    top.append(playIcon, position);
    const detail = sound.id === activeId ? (sound.source === 'local' && $<HTMLAudioElement>('#audio-player').paused ? 'En pausa' : 'Sonando ahora') : sound.source === 'youtube' ? 'YouTube · online' : sound.duration ? formatTime(sound.duration) : 'Audio';
    pad.append(top, text('span', 'pad-name', sound.name), text('span', 'pad-meta', detail));
    pad.addEventListener('click', () => { clipEditor.pause(); if (activeId === sound.id) player.stop(); else void player.play(sound); });
    const favorite = document.createElement('button'); favorite.className = `favorite-button${sound.favorite ? ' is-favorite' : ''}`;
    favorite.dataset.soundId = sound.id; favorite.dataset.action = 'favorite'; favorite.disabled = pending.has(sound.id);
    favorite.setAttribute('aria-label', `${sound.favorite ? 'Quitar de' : 'Agregar a'} favoritos: ${sound.name}`); favorite.setAttribute('aria-pressed', String(sound.favorite)); favorite.append(icon('star'));
    favorite.addEventListener('click', () => void toggleFavorite(sound.id));
    const more = document.createElement('button'); more.className = 'icon-button more-button'; more.dataset.soundId = sound.id; more.dataset.action = 'edit'; more.disabled = pending.has(sound.id);
    more.setAttribute('aria-label', `Editar ${sound.name}`); more.append(icon('more')); more.addEventListener('click', () => openEdit(sound.id));
    card.append(pad, favorite, more); board.append(card);
  }
  if (focusId) [...board.querySelectorAll('button')].find(button => button.dataset.soundId === focusId && button.dataset.action === action)?.focus({ preventScroll: true });
}
const player = createPlayer(id => {
  activeId = id; render(); $('#mobile-transport').hidden = !id;
  document.body.classList.toggle('has-playback', !!id);
});
document.querySelectorAll('.stop-all').forEach(button => button.addEventListener('click', player.stop));
for (const event of ['pause', 'playing']) $('#audio-player').addEventListener(event, () => {
  const label = document.querySelector<HTMLElement>('.is-playing .pad-meta');
  if (label && sounds.find(sound => sound.id === activeId)?.source === 'local') label.textContent = $<HTMLAudioElement>('#audio-player').paused ? 'En pausa' : 'Sonando ahora';
});
async function toggleFavorite(id: string): Promise<void> {
  if (pending.has(id)) return;
  const sound = sounds.find(item => item.id === id); if (!sound) return;
  pending.add(id); render();
  try { const updated = await saveSound({ ...sound, favorite: !sound.favorite }); sounds = sounds.map(item => item.id === id ? updated : item); }
  catch (error) { errorAt('#app-error', error); }
  finally { pending.delete(id); render(); }
}
function updateSource(): void {
  const local = source() === 'local';
  const online = input('#youtube-online').checked;
  $('#local-fields').hidden = !local; $('#youtube-fields').hidden = local;
  $('#youtube-import-controls').hidden = online;
  $('#trim-options').hidden = !online;
  const showDetails = local ? clipEditor.ready() : online;
  $('#sound-details').hidden = !showDetails; $('#add-actions').hidden = !showDetails;
  $('.source-options').hidden = local && clipEditor.ready();
  $('#dialog-title').textContent = local && showDetails ? 'Ya casi es tuyo.' : local ? 'Dale un lugar a ese audio.' : online ? 'Guarda el enlace.' : 'De enlace a sonido.';
  $('#dialog-description').textContent = local && showDetails ? 'Escúchalo, ponle un nombre y guárdalo.' : local ? 'Elige un audio o video de tu dispositivo.' : online ? 'Necesitarás internet para reproducirlo con YouTube.' : 'Pega el enlace. Después podrás escucharlo y recortarlo.';
  $('#youtube-help').textContent = online ? 'Solo guarda el enlace. No descarga audio.' : 'El audio se guardará en tu dispositivo cuando confirmes.';
  $('#add-step').textContent = showDetails ? 'DALE TU TOQUE' : 'NUEVO SONIDO';
}
const clipEditor = createClipEditor({ onReady: updateSource, onError: formError });
const youtubeImport = createYouTubeImport({
  onFile(file) { input('input[name="source"][value="local"]').checked = true; clipEditor.loadFile(file); updateSource(); },
  onError: formError,
});
function openAdd(): void {
  youtubeImport.reset();
  form.reset(); form.querySelectorAll('details').forEach(details => { details.open = false; });
  clipEditor.reset(); updateSource(); player.stop(); formError(null);
  $('#discard-prompt').hidden = true; form.inert = false;
  dialog.showModal(); input('#sound-file').focus({ preventScroll: true });
}
document.querySelectorAll<HTMLButtonElement>('.add-trigger').forEach(button => { button.disabled = true; button.addEventListener('click', openAdd); });
function closeAdd(): void {
  if (saving) return;
  youtubeImport.cancel();
  if (!clipEditor.getFile() && !input('#sound-name').value.trim() && !input('#sound-url').value.trim()) { dialog.close(); return; }
  clipEditor.pause(); $('#discard-prompt').hidden = false; form.inert = true; $('#keep-editing').focus();
}
for (const id of ['#close-dialog', '#cancel-dialog']) $(id).addEventListener('click', closeAdd);
$('#keep-editing').addEventListener('click', () => { $('#discard-prompt').hidden = true; form.inert = false; ($('#sound-details').hidden ? source() === 'youtube' ? $('#sound-url') : clipEditor.getFile() ? $('#change-file') : $('#sound-file') : $('#sound-name')).focus(); });
$('#confirm-discard').addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => { event.preventDefault(); closeAdd(); });
dialog.addEventListener('close', () => {
  // Native close events are queued. A rapid reopen already initialized a new draft.
  if (dialog.open) return;
  youtubeImport.reset(); clipEditor.reset(); form.inert = false;
});
form.addEventListener('change', event => {
  if (event.target instanceof HTMLInputElement && event.target.name === 'source') {
    youtubeImport.cancel(); clipEditor.pause(); updateSource(); formError(null);
    if (source() === 'youtube') { void youtubeImport.refresh(); input('#sound-url').focus(); }
  }
  if (event.target === input('#youtube-online')) { updateSource(); formError(null); }
});
form.addEventListener('input', () => formError(null));
form.addEventListener('submit', async event => {
  event.preventDefault(); if (saving) return;
  if (source() === 'youtube' && !input('#youtube-online').checked) { await youtubeImport.start(); return; }
  formError(null);
  const name = input('#sound-name').value.trim();
  if (!name || name.length > 60) { formError(new Error('Ponle un nombre de hasta 60 caracteres.'), '#sound-name'); return; }
  saving = true; setBusy(dialog, true); $('#import-progress').hidden = false; clipEditor.pause();
  $('#save-sound').firstChild!.textContent = 'Guardando… ';
  try {
    let sound: Sound;
    if (source() === 'local') {
      const file = clipEditor.getFile(); if (!file) throw new Error('Elige un archivo primero.');
      const range = clipEditor.selection();
      const audio = await prepareAudio(file, range.start, range.end, range.duration);
      sound = createSound({ name, source: 'local', file: audio });
      if (sound.source === 'local') sound.duration = range.end - range.start;
    } else sound = createSound({ name, source: 'youtube', url: input('#sound-url').value, start: input('#clip-start').value, end: input('#clip-end').value });
    sound.color = chosenColor('color'); await saveSound(sound); sounds.unshift(sound);
    favoritesOnly = false; search.value = ''; render(); dialog.close(); focusSound(sound.id); toast('Listo. Toca tu nuevo sonido para escucharlo.');
    void navigator.storage?.persist?.().catch(() => false);
  } catch (error) { formError(error); }
  finally { saving = false; setBusy(dialog, false); $('#import-progress').hidden = true; $('#save-sound').firstChild!.textContent = 'Guardar sonido '; }
});
function openEdit(id: string): void {
  const sound = sounds.find(item => item.id === id); if (!sound) return;
  editing = id; input('#edit-name').value = sound.name;
  input(`input[name="edit-color"][value="${sound.color ?? 'lavender'}"]`).checked = true;
  $('#export-sound').hidden = sound.source !== 'local'; errorAt('#edit-error', null); editDialog.showModal(); input('#edit-name').focus();
}
let editBusy = false;
editDialog.addEventListener('cancel', event => { if (editBusy) event.preventDefault(); });
$('#edit-form').addEventListener('submit', async event => {
  event.preventDefault(); if (editBusy || !editing) return;
  const sound = sounds.find(item => item.id === editing); if (!sound) return;
  const name = input('#edit-name').value.trim(); if (!name || name.length > 60) { errorAt('#edit-error', new Error('Ponle un nombre de hasta 60 caracteres.')); return; }
  editBusy = true; setBusy(editDialog, true);
  try { const updated = await saveSound({ ...sound, name, color: chosenColor('edit-color') }); sounds = sounds.map(item => item.id === sound.id ? updated : item); if (activeId === sound.id) player.stop(); render(); editDialog.close(); focusSound(sound.id); toast('Cambios guardados.'); }
  catch (error) { errorAt('#edit-error', error); }
  finally { editBusy = false; setBusy(editDialog, false); }
});
$('#delete-sound').addEventListener('click', async () => {
  if (editBusy) return;
  const sound = sounds.find(item => item.id === editing); if (!sound) return;
  editBusy = true; setBusy(editDialog, true);
  try { await removeSound(sound.id); if (activeId === sound.id) player.stop(); sounds = sounds.filter(item => item.id !== sound.id); deleted = sound; render(); editDialog.close(); focusSound(); toast(`«${sound.name}» eliminado.`, true); }
  catch (error) { errorAt('#edit-error', error); }
  finally { editBusy = false; setBusy(editDialog, false); }
});
$('#undo-delete').addEventListener('click', async () => {
  const sound = deleted; if (!sound) return;
  const button = $<HTMLButtonElement>('#undo-delete'); button.disabled = true;
  try { await saveSound(sound); sounds = await allSounds(); deleted = null; render(); focusSound(sound.id); toast('Sonido recuperado.'); }
  catch (error) { errorAt('#app-error', error); }
  finally { button.disabled = false; }
});
$('#close-toast').addEventListener('click', () => { $('#toast').hidden = true; });
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(button => button.addEventListener('click', () => $<HTMLDialogElement>(`#${button.dataset.close}`).close()));

function download(file: File): void {
  const url = URL.createObjectURL(file); const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.name; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function shareOrDownload(file: File): Promise<void> {
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) throw error; }
  } else download(file);
}
$('#export-sound').addEventListener('click', () => {
  const sound = sounds.find(item => item.id === editing); if (sound?.source !== 'local') return;
  const ext = sound.fileName.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'mp3';
  void shareOrDownload(new File([sound.blob], `${sound.name.replace(/[^\p{L}\p{N} _-]/gu, '') || 'tapzi'}.${ext}`, { type: sound.blob.type })).catch(error => errorAt('#edit-error', error));
});
$('#settings-trigger').addEventListener('click', () => {
  const bytes = sounds.reduce((sum, s) => sum + (s.source === 'local' ? s.blob.size : 0), 0);
  $('#storage-info').textContent = `${sounds.length} sonidos · ${(bytes / 1024 / 1024).toFixed(1)} MB de audio`;
  $('#settings-message').textContent = ''; $<HTMLButtonElement>('#backup-export').disabled = !storageReady || !sounds.length; $<HTMLButtonElement>('#backup-import').disabled = !storageReady; settings.showModal();
});
$('#backup-export').addEventListener('click', () => {
  try { const file = new File([makeBackup(sounds)], `tapzi-${new Date().toISOString().slice(0, 10)}.tapzi`, { type: 'application/octet-stream' }); void shareOrDownload(file).catch(error => { $('#settings-message').textContent = message(error); }); }
  catch (error) { $('#settings-message').textContent = message(error); }
});
$('#backup-import').addEventListener('click', () => input('#backup-file').click());
let restoring = false;
settings.addEventListener('cancel', event => { if (restoring) event.preventDefault(); });
input('#backup-file').addEventListener('change', async () => {
  const file = input('#backup-file').files?.[0]; if (!file || restoring) return;
  restoring = true; setBusy(settings, true); $('#settings-message').textContent = 'Revisando la copia…';
  try {
    const restored = await readBackup(file); const before = sounds.length; await restoreSounds(restored); sounds = await allSounds(); render();
    void navigator.storage?.persist?.().catch(() => false);
    $('#settings-message').textContent = `${sounds.length - before} sonidos agregados. Tu colección anterior se conservó.`;
    $('#storage-info').textContent = `${sounds.length} sonidos en este dispositivo`;
  } catch (error) { $('#settings-message').textContent = message(error); }
  finally { restoring = false; setBusy(settings, false); input('#backup-file').value = ''; }
});
$('#all-filter').addEventListener('click', () => { favoritesOnly = false; render(); });
$('#favorite-filter').addEventListener('click', () => { favoritesOnly = true; render(); });
search.addEventListener('input', render);
$('#clear-filter').addEventListener('click', () => { favoritesOnly = false; search.value = ''; render(); search.focus(); });
$('#demo-trigger').addEventListener('click', async () => {
  const button = $<HTMLButtonElement>('#demo-trigger'); button.disabled = true;
  try {
    const demos = [['Redoble digital', 180, 'lavender'], ['Momento de suspenso', 330, 'peach'], ['Pequeña victoria', 660, 'mint']] as const;
    const newSounds = demos.map(([name, hz, color], index) => {
      const rate = 22050, length = rate * 1.2; const samples = new Float32Array(length);
      for (let i = 0; i < length; i++) { const t = i / rate; const envelope = Math.min(1, t * 80) * Math.pow(1 - i / length, 2); const freq = hz * (index === 2 ? [1, 1.25, 1.5][Math.min(2, Math.floor(t * 3))] : 1); samples[i] = Math.sin(2 * Math.PI * freq * t) * envelope * .25 * (index === 0 ? Math.sin(t * 70) ** 2 : 1); }
      const file = new File([encodeWav([samples], rate)], 'tapzi-demo.wav', { type: 'audio/wav' });
      return { ...createSound({ name, source: 'local', file }), color, duration: 1.2 };
    });
    await restoreSounds(newSounds); sounds = await allSounds(); render(); toast('Tres sonidos originales para probar. Puedes editarlos o borrarlos.');
  } catch (error) { errorAt('#app-error', error); }
  finally { button.disabled = false; }
});
// Refresh after another tab changes the collection, without discarding an open form.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && storageReady && !document.querySelector('dialog[open]')) void allSounds().then(items => { sounds = items; render(); }).catch(error => errorAt('#app-error', error)); });
try {
  sounds = await allSounds(); storageReady = true; render();
  document.querySelectorAll<HTMLButtonElement>('.add-trigger').forEach(button => { button.disabled = false; });
} catch (error) { errorAt('#app-error', error); $('#board').setAttribute('aria-busy', 'false'); }
setupOffline(() => !document.querySelector('dialog[open]') && !activeId);
