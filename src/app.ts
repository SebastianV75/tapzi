import { createSound, matchesSound, formatTime } from './sounds.ts';
import type { Sound } from './sounds.ts';
import { allSounds, saveSound } from './storage.ts';
import { createPlayer } from './player.ts';
import { downloadSound } from './import-audio.ts';

function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing interface element: ${selector}`);
  return element;
}
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : 'Something went wrong. Try again.';
const source = (): string => $<HTMLInputElement>('input[name="source"]:checked').value;
const dialog = $<HTMLDialogElement>('#add-dialog');
const form = $<HTMLFormElement>('#add-form');
const search = $<HTMLInputElement>('#search');
let sounds: Sound[] = [];
let favoritesOnly = false;
let activeId: string | null = null;
let saving = false;
const favoritePending = new Set<string>();

function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(svg.namespaceURI, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
function text<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, content: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
}
function showError(element: HTMLElement, message: string): void {
  element.textContent = message;
  element.hidden = !message;
}
function announce(message: string): void { $('#announcement').textContent = message; }

function render(): void {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusId = focused?.dataset.soundId;
  const focusAction = focused?.dataset.action;
  const board = $('#board');
  board.replaceChildren();
  const visible = sounds.filter(sound => (!favoritesOnly || sound.favorite) && matchesSound(sound, search.value));
  $('#total').textContent = String(sounds.length);
  $('#empty').hidden = sounds.length !== 0;
  $('#no-results').hidden = sounds.length === 0 || visible.length !== 0;
  board.hidden = visible.length === 0;
  board.setAttribute('aria-busy', 'false');
  $('#all-filter').setAttribute('aria-pressed', String(!favoritesOnly));
  $('#favorite-filter').setAttribute('aria-pressed', String(favoritesOnly));
  $('#all-filter').classList.toggle('selected', !favoritesOnly);
  $('#favorite-filter').classList.toggle('selected', favoritesOnly);
  visible.forEach(sound => {
    const card = document.createElement('li');
    card.className = `sound-card${sound.id === activeId ? ' is-playing' : ''}`;
    const pad = document.createElement('button');
    pad.className = 'pad';
    pad.dataset.soundId = sound.id;
    pad.dataset.action = 'play';
    pad.setAttribute('aria-label', `${sound.id === activeId ? 'Stop' : 'Play'} ${sound.name}`);
    pad.setAttribute('aria-pressed', String(sound.id === activeId));
    const top = document.createElement('span');
    top.className = 'pad-top';
    const number = String(sounds.length - sounds.indexOf(sound)).padStart(2, '0');
    const playIcon = document.createElement('span');
    playIcon.className = 'pad-icon';
    playIcon.append(icon(sound.id === activeId ? 'stop' : 'play'));
    top.append(text('span', 'pad-number', number), playIcon);
    const detail = sound.source === 'youtube'
      ? `YouTube / ${formatTime(sound.start)}${sound.end === null ? '' : `–${formatTime(sound.end)}`}`
      : 'Audio / on device';
    pad.append(top, text('span', 'pad-name', sound.name), text('span', 'pad-meta', detail));
    pad.addEventListener('click', () => { if (activeId === sound.id) player.stop(); else void player.play(sound); });
    const favorite = document.createElement('button');
    favorite.className = `favorite-button${sound.favorite ? ' is-favorite' : ''}`;
    favorite.dataset.soundId = sound.id;
    favorite.dataset.action = 'favorite';
    favorite.setAttribute('aria-label', `${sound.favorite ? 'Unfavorite' : 'Favorite'} ${sound.name}`);
    favorite.setAttribute('aria-pressed', String(sound.favorite));
    favorite.disabled = favoritePending.has(sound.id);
    favorite.append(icon('star'));
    favorite.addEventListener('click', () => void toggleFavorite(sound));
    card.append(pad, favorite);
    board.append(card);
  });
  if (focusId) {
    [...board.querySelectorAll('button')].find(button => button.dataset.soundId === focusId && button.dataset.action === focusAction)?.focus({ preventScroll: true });
  }
}

const player = createPlayer(id => { activeId = id; render(); });
document.querySelectorAll('.stop-all').forEach(button => button.addEventListener('click', player.stop));

async function toggleFavorite(sound: Sound): Promise<void> {
  if (favoritePending.has(sound.id)) return;
  favoritePending.add(sound.id);
  render();
  try {
    const updated = await saveSound({ ...sound, favorite: !sound.favorite });
    sounds = sounds.map(item => item.id === updated.id ? updated : item);
    showError($('#app-error'), '');
    announce(`${sound.name} ${updated.favorite ? 'added to' : 'removed from'} favorites`);
  } catch (error) { showError($('#app-error'), errorMessage(error)); }
  finally { favoritePending.delete(sound.id); render(); }
}

function clearErrors(): void {
  showError($('#form-error'), '');
  form.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
}
function updateSource(): void {
  const local = source() === 'local';
  $('#local-fields').hidden = !local;
  $('#youtube-fields').hidden = local;
  $<HTMLInputElement>('#sound-file').disabled = !local;
  for (const id of ['#sound-url', '#clip-start', '#clip-end']) $<HTMLInputElement>(id).disabled = local;
  clearErrors();
}
document.querySelectorAll<HTMLButtonElement>('.add-trigger').forEach(button => {
  button.disabled = true;
  button.addEventListener('click', () => {
    form.reset();
    updateSource();
    dialog.showModal();
    $('#sound-name').focus();
  });
});
$('#close-dialog').addEventListener('click', () => dialog.close());
$('#cancel-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
form.addEventListener('change', event => { if (event.target instanceof HTMLInputElement && event.target.name === 'source') updateSource(); });
form.addEventListener('input', clearErrors);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving) return;
  clearErrors();
  let sound: Sound;
  try {
    sound = createSound({
      name: $<HTMLInputElement>('#sound-name').value,
      source: source(),
      url: $<HTMLInputElement>('#sound-url').value,
      start: $<HTMLInputElement>('#clip-start').value,
      end: $<HTMLInputElement>('#clip-end').value,
      file: $<HTMLInputElement>('#sound-file').files?.[0],
    });
  } catch (error) {
    showError($('#form-error'), errorMessage(error));
    const visibleInputs = [...form.querySelectorAll<HTMLInputElement>('input:not([type="radio"]):not(:disabled)')];
    visibleInputs.forEach(input => input.setAttribute('aria-invalid', 'true'));
    visibleInputs[0]?.focus();
    return;
  }
  saving = true;
  const downloading = sound.source === 'youtube' && $<HTMLInputElement>('#download-audio').checked;
  const controls = [...dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')]
    .map(element => ({ element, disabled: element.disabled }));
  controls.forEach(({ element }) => { element.disabled = true; });
  $('#save-sound').firstChild!.textContent = downloading ? 'Importing audio…' : 'Saving…';
  $('#import-progress').hidden = !downloading;
  form.setAttribute('aria-busy', 'true');
  try {
    if (downloading && sound.source === 'youtube') sound = await downloadSound(sound);
    await saveSound(sound);
    sounds.unshift(sound);
    favoritesOnly = false;
    search.value = '';
    render();
    dialog.close();
    announce(`${sound.name} added to your soundboard`);
  } catch (error) { showError($('#form-error'), errorMessage(error)); }
  finally {
    saving = false;
    controls.forEach(({ element, disabled }) => { element.disabled = disabled; });
    $('#import-progress').hidden = true;
    $('#save-sound').firstChild!.textContent = 'Add to soundboard';
    form.setAttribute('aria-busy', 'false');
  }
});
$('#all-filter').addEventListener('click', () => { favoritesOnly = false; render(); });
$('#favorite-filter').addEventListener('click', () => { favoritesOnly = true; render(); });
search.addEventListener('input', render);
$('#clear-filter').addEventListener('click', () => { favoritesOnly = false; search.value = ''; render(); search.focus(); });

try {
  sounds = await allSounds();
  render();
  document.querySelectorAll<HTMLButtonElement>('.add-trigger').forEach(button => { button.disabled = false; });
} catch (error) {
  showError($('#app-error'), errorMessage(error));
  $('#board').setAttribute('aria-busy', 'false');
}
