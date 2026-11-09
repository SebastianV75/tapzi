import { COLORS, createSound, matchesSound, formatTime } from './sounds.ts';
import type { Sound, SoundColor } from './sounds.ts';
import { allSounds, saveSound, removeSound, restoreSounds } from './storage.ts';
import { createPlayer } from './player.ts';
import { createSoundEngine } from './sound-engine.ts';
import { prepareAudio, encodeWav } from './media.ts';
import { makeBackup, readBackup } from './backup.ts';
import { collectionSignature, recordExport, exportStatus, persistenceStatus } from './collection-safety.ts';
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
const engine = createSoundEngine();
let sounds: Sound[] = [];
const seen = new Set<string>(); // sounds already shown once, so only newcomers animate in
let popId: string | null = null; // the sound whose star was just switched on
const motionOK = matchMedia('(prefers-reduced-motion: no-preference)');
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
/** Shows whether a pad is the one playing. Pressing a playing local sound restarts it; a YouTube one has no such shortcut. */
function paintPad(card: HTMLElement, pad: HTMLElement, sound: Sound): void {
  const active = sound.id === activeId;
  card.classList.toggle('is-playing', active);
  if (active && sound.source === 'local') card.style.setProperty('--p', '0');
  else card.style.removeProperty('--p');
  if (!active) card.classList.remove('is-paused');
  pad.setAttribute('aria-label', `${!active ? 'Reproducir' : sound.source === 'local' ? 'Reiniciar' : 'Detener'} ${sound.name}`);
  pad.setAttribute('aria-pressed', String(active));
  pad.querySelector('.eq')?.remove();
  if (active) { const bars = text('span', 'eq', ''); bars.setAttribute('aria-hidden', 'true'); bars.append(...[0, 1, 2, 3].map(() => document.createElement('i'))); pad.append(bars); }
}
const cards = new Map<string, { card: HTMLLIElement; pad: HTMLButtonElement; name: HTMLSpanElement; favorite: HTMLButtonElement; more: HTMLButtonElement; sound: Sound; busy: boolean }>();
let syncedSounds: Sound[] | undefined;
function render(): void {
  if (syncedSounds !== sounds) { engine?.sync(sounds); syncedSounds = sounds; }
  const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusId = focus?.dataset.soundId; const action = focus?.dataset.action;
  const board = $('#board');
  const visible = sounds.filter(sound => (!favoritesOnly || sound.favorite) && matchesSound(sound, search.value));
  $('#total').textContent = String(sounds.length);
  $('#empty').hidden = !storageReady || sounds.length !== 0;
  $('#no-results-title').textContent = favoritesOnly && !search.value.trim() ? 'Tus favoritos van aquí' : 'No encontramos ese sonido';
  $('#no-results-description').textContent = favoritesOnly && !search.value.trim() ? 'Toca la estrella de un sonido para tenerlo siempre a mano.' : 'Prueba con otro nombre o vuelve a verlos todos.'; $('#no-results').hidden = sounds.length === 0 || visible.length !== 0;
  board.hidden = visible.length === 0; board.setAttribute('aria-busy', String(!storageReady));
  for (const [id, selected] of [['#all-filter', !favoritesOnly], ['#favorite-filter', favoritesOnly]] as const) { $(id).setAttribute('aria-pressed', String(selected)); $(id).classList.toggle('selected', selected); }
  const live = new Set(sounds.map(sound => sound.id));
  const shown = new Set(visible.map(sound => sound.id));
  for (const [id, view] of cards) {
    view.card.classList.remove('is-new');
    if (!shown.has(id)) view.card.remove();
    if (!live.has(id)) { cards.delete(id); seen.delete(id); }
  }
  let arrival = 0;
  let cursor = board.firstElementChild;
  for (const sound of visible) {
    let view = cards.get(sound.id);
    const busy = pending.has(sound.id);
    if (!view) {
      const card = document.createElement('li'); card.className = 'sound-card';
      if (!seen.has(sound.id)) { seen.add(sound.id); card.classList.add('is-new'); card.style.setProperty('--i', String(Math.min(arrival++, 14))); }
      const pad = document.createElement('button'); pad.className = 'pad'; pad.dataset.soundId = sound.id; pad.dataset.action = 'play';
      const name = text('span', 'pad-name', sound.name); pad.append(name);
      const favorite = document.createElement('button'); favorite.className = 'favorite-button';
      favorite.dataset.soundId = sound.id; favorite.dataset.action = 'favorite'; favorite.append(icon('star'));
      favorite.addEventListener('click', () => void toggleFavorite(sound.id));
      const more = document.createElement('button'); more.className = 'icon-button more-button'; more.dataset.soundId = sound.id; more.dataset.action = 'edit';
      more.append(icon('more')); more.addEventListener('click', () => { if (!pending.has(sound.id)) openEdit(sound.id); });
      card.append(pad, favorite, more);
      view = { card, pad, name, favorite, more, sound, busy };
      cards.set(sound.id, view);
      paintPad(card, pad, sound);
      // Initialize attributes below, just as for changed metadata.
      card.dataset.color = sound.color ?? 'lavender';
      favorite.setAttribute('aria-pressed', String(sound.favorite));
      favorite.setAttribute('aria-label', `${sound.favorite ? 'Quitar de' : 'Agregar a'} favoritos: ${sound.name}`);
      more.setAttribute('aria-label', `Editar ${sound.name}`);
      favorite.classList.toggle('is-favorite', sound.favorite);
      favorite.setAttribute('aria-disabled', String(busy)); more.setAttribute('aria-disabled', String(busy));
    }
    if (view.sound !== sound) {
      if (view.sound.name !== sound.name) {
        view.name.textContent = sound.name;
        view.more.setAttribute('aria-label', `Editar ${sound.name}`);
        view.pad.setAttribute('aria-label', `${sound.id !== activeId ? 'Reproducir' : sound.source === 'local' ? 'Reiniciar' : 'Detener'} ${sound.name}`);
      }
      if (view.sound.color !== sound.color) view.card.dataset.color = sound.color ?? 'lavender';
      if (view.sound.favorite !== sound.favorite || view.sound.name !== sound.name) {
        view.favorite.setAttribute('aria-label', `${sound.favorite ? 'Quitar de' : 'Agregar a'} favoritos: ${sound.name}`);
        view.favorite.setAttribute('aria-pressed', String(sound.favorite));
        view.favorite.classList.toggle('is-favorite', sound.favorite);
      }
      view.sound = sound;
    }
    if (view.busy !== busy) { view.favorite.setAttribute('aria-disabled', String(busy)); view.more.setAttribute('aria-disabled', String(busy)); view.busy = busy; }
    view.favorite.classList.toggle('pop', sound.id === popId);
    if (view.card.classList.contains('is-playing') !== (sound.id === activeId)) paintPad(view.card, view.pad, sound);
    // Keep nodes in place whenever possible, preserving focus, ripples and playback progress.
    if (view.card !== cursor) board.insertBefore(view.card, cursor);
    cursor = view.card.nextElementSibling;
  }
  popId = null;
  if (focusId && document.activeElement !== focus) [...board.querySelectorAll('button')].find(button => button.dataset.soundId === focusId && button.dataset.action === action)?.focus({ preventScroll: true });
}
const padFor = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`.pad[data-sound-id="${CSS.escape(id)}"]`);
const player = createPlayer(id => {
  // Only the two pads that changed are touched. Rebuilding the board here would cost every tap a full layout.
  const changed = [activeId, id]; activeId = id;
  for (const soundId of changed) {
    const pad = soundId && padFor(soundId), sound = sounds.find(item => item.id === soundId);
    if (pad && sound) paintPad(pad.closest<HTMLElement>('.sound-card')!, pad, sound);
  }
  $('#mobile-transport').hidden = !id;
  document.body.classList.toggle('has-playback', !!id);
}, engine, (fraction, paused) => {
  const card = document.querySelector<HTMLElement>('.sound-card.is-playing');
  if (!card) return;
  card.style.setProperty('--p', fraction.toFixed(3)); card.classList.toggle('is-paused', paused);
});
document.querySelectorAll('.stop-all').forEach(button => button.addEventListener('click', player.stop));
function pressPad(pad: HTMLElement, x: number, y: number): void {
  const sound = sounds.find(item => item.id === pad.dataset.soundId); if (!sound) return;
  clipEditor.pause();
  if (activeId === sound.id && sound.source === 'youtube') player.stop(); else void player.play(sound);
  navigator.vibrate?.(8); // Android only; iOS Safari has no vibration API
  if (!motionOK.matches) return;
  pad.querySelector('.ripple')?.remove(); // one at a time, however fast the pad is pressed
  const box = pad.getBoundingClientRect(), wave = text('span', 'ripple', ''); wave.setAttribute('aria-hidden', 'true'); wave.style.left = `${x - box.left}px`; wave.style.top = `${y - box.top}px`;
  wave.addEventListener('animationend', () => wave.remove(), { once: true }); pad.append(wave);
}
// Pads respond to the press itself rather than to `click`, which browsers delay and drop when fingers overlap.
// A mouse fires on the way down. A finger fires on touchend, because the same touch might be starting a scroll and
// because iOS accepts touchend, not pointerup, as permission to start a media element.
const SCROLL_SLOP = 12;
const presses = new Map<number, { pad: HTMLElement; x: number; y: number; fired: boolean }>();
const touches = new Map<number, { pad: HTMLElement; x: number; y: number; scroll: number }>();
let lastRelease = -Infinity;
const padAt = (target: EventTarget | null): HTMLElement | null => target instanceof Element ? target.closest<HTMLElement>('.pad') : null;
$('#board').addEventListener('pointerdown', event => {
  const pad = padAt(event.target); if (!pad || event.button !== 0) return;
  if (event.pointerType === 'touch' && 'ontouchstart' in window) return; // touch events below handle it
  const fired = event.pointerType === 'mouse';
  presses.set(event.pointerId, { pad, x: event.clientX, y: event.clientY, fired });
  if (fired) pressPad(pad, event.clientX, event.clientY);
});
document.addEventListener('pointerup', event => {
  const press = presses.get(event.pointerId); if (!press) return;
  presses.delete(event.pointerId); lastRelease = event.timeStamp;
  if (!press.fired && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= SCROLL_SLOP) pressPad(press.pad, event.clientX, event.clientY);
});
document.addEventListener('pointercancel', event => { presses.delete(event.pointerId); });
$('#board').addEventListener('touchstart', event => {
  for (const touch of event.changedTouches) {
    const pad = padAt(touch.target);
    if (pad) touches.set(touch.identifier, { pad, x: touch.clientX, y: touch.clientY, scroll: scrollY });
  }
}, { passive: true });
document.addEventListener('touchend', event => {
  for (const touch of event.changedTouches) {
    const press = touches.get(touch.identifier); if (!press) continue;
    touches.delete(touch.identifier); lastRelease = event.timeStamp;
    // The page having moved also catches a tap that only stops a scroll still gliding.
    if (Math.hypot(touch.clientX - press.x, touch.clientY - press.y) <= SCROLL_SLOP && Math.abs(scrollY - press.scroll) <= 2) pressPad(press.pad, touch.clientX, touch.clientY);
  }
}, { passive: true });
document.addEventListener('touchcancel', event => { for (const touch of event.changedTouches) touches.delete(touch.identifier); }, { passive: true });
// Keyboards and screen readers only send `click`. A click from a pointer is that same press arriving late.
$('#board').addEventListener('click', event => {
  const pad = padAt(event.target); if (!pad || (event.detail > 0 && event.timeStamp - lastRelease < 500)) return;
  const box = pad.getBoundingClientRect();
  pressPad(pad, event.detail === 0 ? box.left + box.width / 2 : event.clientX, event.detail === 0 ? box.top + box.height / 2 : event.clientY);
});
async function toggleFavorite(id: string): Promise<void> {
  if (pending.has(id)) return;
  const sound = sounds.find(item => item.id === id); if (!sound) return;
  pending.add(id); render();
  try { const updated = await saveSound({ ...sound, favorite: !sound.favorite }); sounds = sounds.map(item => item.id === id ? updated : item); popId = updated.favorite ? id : null; }
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
async function shareOrDownload(file: File): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return 'shared'; } catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'; throw error; }
  }
  download(file); return 'downloaded';
}
$('#export-sound').addEventListener('click', () => {
  const sound = sounds.find(item => item.id === editing); if (sound?.source !== 'local') return;
  const ext = sound.fileName.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'mp3';
  void shareOrDownload(new File([sound.blob], `${sound.name.replace(/[^\p{L}\p{N} _-]/gu, '') || 'tapzi'}.${ext}`, { type: sound.blob.type })).catch(error => errorAt('#edit-error', error));
});
let exporting = false;
let protectionCheck = 0;
function refreshSettings(): void {
  const bytes = sounds.reduce((sum, s) => sum + (s.source === 'local' ? s.blob.size : 0), 0);
  $('#storage-info').textContent = `${sounds.length} sonidos · ${(bytes / 1024 / 1024).toFixed(1)} MB de audio`;
  $('#backup-status').textContent = exportStatus(sounds);
  $<HTMLButtonElement>('#backup-export').disabled = !storageReady || !sounds.length || exporting || restoring;
  $<HTMLButtonElement>('#backup-import').disabled = !storageReady || exporting || restoring;
}
async function showProtection(request = false): Promise<void> {
  const token = ++protectionCheck;
  const button = $<HTMLButtonElement>('#protect-storage'); button.disabled = true;
  const result = await persistenceStatus(request);
  if (token !== protectionCheck) return;
  $('#persistence-status').textContent = result.text;
  button.hidden = !result.canRequest; button.disabled = false;
}
$('#protect-storage').addEventListener('click', () => void showProtection(true));
$('#settings-trigger').addEventListener('click', () => {
  refreshSettings(); void showProtection();
  $('#settings-message').textContent = ''; settings.showModal();
});
$('#backup-export').addEventListener('click', async () => {
  if (exporting || restoring || !storageReady || !sounds.length) return;
  exporting = true; refreshSettings();
  try {
    // Snapshot before opening the native sheet. Cancelled sharing is not a completed export.
    const signature = collectionSignature(sounds);
    const file = new File([makeBackup(sounds)], `tapzi-${new Date().toISOString().slice(0, 10)}.tapzi`, { type: 'application/octet-stream' });
    const result = await shareOrDownload(file);
    if (result === 'cancelled') { $('#settings-message').textContent = 'Exportación cancelada. Tu colección sigue aquí.'; return; }
    recordExport(signature);
    $('#settings-message').textContent = result === 'shared'
      ? 'Archivo entregado a la hoja de compartir. Comprueba que lo guardaste en Archivos.'
      : 'Descarga iniciada. Comprueba que el archivo .tapzi esté en tus descargas.';
  } catch (error) { $('#settings-message').textContent = message(error); }
  finally { exporting = false; refreshSettings(); }
});
$('#backup-import').addEventListener('click', () => input('#backup-file').click());
let restoring = false;
settings.addEventListener('cancel', event => { if (restoring) event.preventDefault(); });
input('#backup-file').addEventListener('change', async () => {
  const file = input('#backup-file').files?.[0]; if (!file || restoring || exporting) return;
  restoring = true; setBusy(settings, true); $('#settings-message').textContent = 'Revisando la copia…';
  try {
    const restored = await readBackup(file); const before = sounds.length; await restoreSounds(restored); sounds = await allSounds(); render();
    void navigator.storage?.persist?.().catch(() => false);
    $('#settings-message').textContent = `${sounds.length - before} sonidos agregados. Tu colección anterior se conservó.`;
    $('#storage-info').textContent = `${sounds.length} sonidos en este dispositivo`;
  } catch (error) { $('#settings-message').textContent = message(error); }
  finally { restoring = false; setBusy(settings, false); input('#backup-file').value = ''; refreshSettings(); void showProtection(); }
});
$('#all-filter').addEventListener('click', () => { favoritesOnly = false; render(); });
$('#favorite-filter').addEventListener('click', () => { favoritesOnly = true; render(); });
search.addEventListener('input', render);
$('#clear-filter').addEventListener('click', () => { favoritesOnly = false; search.value = ''; render(); search.focus(); });
$('#demo-trigger').addEventListener('click', async () => {
  const button = $<HTMLButtonElement>('#demo-trigger'); button.disabled = true; demoBusy = true;
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
  finally { button.disabled = false; demoBusy = false; }
});
// A return-to-app read must not overwrite an edit that completed while it was pending.
let refreshing = 0;
let demoBusy = false;
const collectionBusy = (): boolean => saving || editBusy || restoring || demoBusy || pending.size > 0;
/** Keeps the objects already on screen when storage returns the same data, so a refresh costs no re-render or re-planning. */
function reconcile(current: Sound[], items: Sound[]): Sound[] {
  const known = new Map(current.map(sound => [sound.id, sound]));
  const same = (a: Sound, b: Sound): boolean => a.name === b.name && a.favorite === b.favorite && a.color === b.color && a.createdAt === b.createdAt && a.source === b.source &&
    (a.source === 'local' && b.source === 'local' ? a.blob.size === b.blob.size && a.duration === b.duration && a.fileName === b.fileName : a.source === 'youtube' && b.source === 'youtube' && a.videoId === b.videoId && a.start === b.start && a.end === b.end);
  const merged = items.map(item => { const old = known.get(item.id); return old && same(old, item) ? old : item; });
  return merged.length === current.length && merged.every((sound, index) => sound === current[index]) ? current : merged;
}
async function refreshCollection(): Promise<void> {
  // Always load the initial collection, even if an update reloads a background tab.
  if ((storageReady && document.visibilityState === 'hidden') || collectionBusy() || document.querySelector('dialog[open]')) return;
  const token = ++refreshing, before = sounds;
  const current = (): boolean => token === refreshing && before === sounds && !collectionBusy() && !document.querySelector('dialog[open]');
  const status = $('#collection-loading');
  status.textContent = storageReady ? 'Actualizando tus sonidos…' : 'Cargando tus sonidos…'; status.hidden = false;
  $('#retry-storage').hidden = true;
  try {
    let items: Sound[];
    try { items = await allSounds(); }
    catch {
      if (!current()) return;
      status.textContent = 'Reconectando con tus sonidos…';
      await new Promise(resolve => setTimeout(resolve, 250));
      if (!current()) return;
      items = await allSounds(); // One bounded read retry. Never replay a write.
    }
    if (token !== refreshing || before !== sounds || collectionBusy() || document.querySelector('dialog[open]')) return;
    const firstLoad = !storageReady;
    sounds = reconcile(sounds, items); storageReady = true;
    if (!firstLoad && sounds === before) { errorAt('#app-error', null); return; } // nothing changed: leave the board, playback and decoded audio alone
    if (activeId && !items.some(item => item.id === activeId)) player.stop();
    render(); errorAt('#app-error', null); $('#retry-storage').hidden = true;
    document.querySelectorAll<HTMLButtonElement>('.add-trigger').forEach(button => { button.disabled = false; });
  } catch (error) {
    if (token !== refreshing || before !== sounds || collectionBusy()) return;
    errorAt('#app-error', error); $('#retry-storage').hidden = false; $('#board').setAttribute('aria-busy', 'false');
  } finally { if (token === refreshing) status.hidden = true; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshCollection(); });
window.addEventListener('pageshow', () => void refreshCollection());
// Our own edits already update memory, so closing a dialog only needs to read storage if the first load has not succeeded.
for (const modal of document.querySelectorAll('dialog')) modal.addEventListener('close', () => { if (!storageReady) void refreshCollection(); });
$('#retry-storage').addEventListener('click', () => void refreshCollection());
await refreshCollection();
setupOffline(() => !document.querySelector('dialog[open]') && !activeId);
