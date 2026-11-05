import { sliceMp3 } from '../src/mp3-slice.ts';
export {};
const frame = document.querySelector<HTMLIFrameElement>('#app')!;
const results = document.querySelector<HTMLElement>('#results')!;
const passed: string[] = [];
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const pause = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 20));
async function wait(predicate: () => unknown, name: string): Promise<void> {
  const deadline = Date.now() + 6000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error(`Timed out: ${name}`); await pause(); }
}
function doc(): Document { return frame.contentDocument!; }
// Playback is read from the transport, so tests hold whether a decoded sound or the media element is playing it.
const slider = (): HTMLInputElement => doc().querySelector<HTMLInputElement>('#playback-seek')!;
const isPlaying = (): boolean => doc().querySelector('#play-pause')!.getAttribute('aria-label') === 'Pausar' && !slider().disabled;
const usesMediaElement = (): boolean => doc().querySelector('#audio-player')!.hasAttribute('src');
function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = doc().querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}
function input(selector: string, value: string): void {
  const element = $<HTMLInputElement>(selector);
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
async function ready(): Promise<void> {
  await wait(() => doc().querySelector('#board')?.getAttribute('aria-busy') === 'false', 'app ready');
  check($('#app-error').hidden, `Storage error: ${$('#app-error').textContent}`);
}
async function reload(): Promise<void> {
  await new Promise<void>(resolve => { frame.onload = () => resolve(); frame.contentWindow!.location.reload(); });
  await ready();
}
function open(): void { const button = [...doc().querySelectorAll<HTMLButtonElement>('.add-trigger')].find(node => node.checkVisibility()); check(button, 'Visible add action'); button.click(); check($<HTMLDialogElement>('#add-dialog').open, 'Dialog opens'); }
function openTrim(): void {
  const trim = $<HTMLDetailsElement>('#trim-options');
  if (!trim.open) $<HTMLElement>('#trim-options > summary').click();
  check($('#clip-start').checkVisibility() && $('#clip-end').checkVisibility(), 'Opening Trim audio exposes both time fields');
}
function submit(): void { $<HTMLFormElement>('#add-form').requestSubmit(); }
function count(): string | null { return $('#total').textContent; }
const clips: { videoId: string; startSeconds: number; endSeconds?: number }[] = [];
type API = NonNullable<Window['YT']>;
type Options = ConstructorParameters<API['Player']>[1];
let lastOptions: Options | undefined;
let destroys = 0;
function fakeYouTube(): void {
  frame.contentWindow!.YT = { Player: class {
    options: Options;
    node: HTMLIFrameElement;
    constructor(id: string, options: Options) {
      this.options = options;
      lastOptions = options;
      this.node = doc().createElement('iframe');
      this.node.id = id;
      this.node.title = 'YouTube deterministic test double';
      $("#" + id).replaceWith(this.node);
      queueMicrotask(() => options.events.onReady({ target: this }));
    }
    loadVideoById(clip: (typeof clips)[number]): void {
      clips.push(clip);
      this.options.events.onStateChange({ target: this, data: 1 });
    }
    getDuration(): number { return 180; }
    destroy(): void { destroys++; this.node.remove(); }
  } };
}
function wav(): File {
  const samples = 16000 * 10;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const string = (offset: number, value: string): void => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  string(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); string(8, 'WAVE'); string(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  string(36, 'data'); view.setUint32(40, samples * 2, true);
  const realm = frame.contentWindow as Window & typeof globalThis;
  return new realm.File([buffer], 'reaction.wav', { type: 'audio/wav' });
}
try {
  await ready();
  check(count() === '0' && !$('#empty').hidden, 'Empty first run');
  open();
  check($<HTMLInputElement>('input[value="local"]').checked, 'Local-first by default');
  check($('#youtube-fields').hidden, 'Online option is secondary');
  check($('#sound-details').hidden && $('#add-actions').hidden, 'Choose a file before showing naming and saving');
  check($('#sound-file').checkVisibility(), 'File chooser is the primary visible action');
  const realm = frame.contentWindow as Window & typeof globalThis;
  const transfer = new realm.DataTransfer(); transfer.items.add(wav());
  const fileInput = $<HTMLInputElement>('#sound-file'); fileInput.files = transfer.files;
  fileInput.dispatchEvent(new realm.Event('change', { bubbles: true }));
  await wait(() => Number($<HTMLInputElement>('#local-end').value) > 0, 'media metadata');
  check($<HTMLInputElement>('#sound-name').value === 'reaction', 'Filename suggests a name');
  check($('#sound-name').checkVisibility() && $('#save-sound').checkVisibility(), 'Metadata reveals the next actions');
  check($('#trim-editor').hidden, 'Trimming is optional, not mandatory');
  check(!$<HTMLDetailsElement>('.personalize').open, 'Color starts out of the way');
  input('#sound-name', 'Épico final');
  $('#toggle-trim').click();
  check($('#toggle-trim').getAttribute('aria-expanded') === 'true', 'Trim toggle announces expansion');
  input('#trim-start', '1'); input('#trim-end', '3');
  check($<HTMLInputElement>('#local-start').value === '1' && $<HTMLInputElement>('#local-end').value === '3', 'Visual handles update exact clip boundaries');
  check($('#media-duration').textContent?.includes('0:02 seleccionados'), 'Selected duration updates immediately');
  $('#close-dialog').click();
  check(!$('#discard-prompt').hidden && $<HTMLFormElement>('#add-form').inert, 'Closing a draft asks before discarding');
  $('#keep-editing').click();
  check($<HTMLInputElement>('#sound-name').value === 'Épico final' && $<HTMLInputElement>('#local-start').value === '1', 'Continue editing keeps name and clip');
  $('#preview-clip').click(); $('#preview-clip').click(); await pause();
  check($('#form-error').hidden, 'Rapid preview pause is not treated as a media error');
  $('#preview-clip').click();
  await wait(() => !$<HTMLVideoElement>('#media-preview').paused, 'preview fragment');
  submit();
  await wait(() => !$<HTMLDialogElement>('#add-dialog').open, 'trim and persist real WAV');
  check(count() === '1', 'Local clip saved');
  await reload();
  check(count() === '1' && $('.pad-name').textContent === 'Épico final', 'Clip persists across reload');
  // The cached IndexedDB connection may close while the app remains open.
  const storageRealm = frame.contentWindow as Window & typeof globalThis;
  const storageModule = await storageRealm.eval(`import('/src/storage.ts')`) as typeof import('../src/storage.ts');
  const nativeTransaction = storageRealm.IDBDatabase.prototype.transaction;
  let capturedDB: IDBDatabase | undefined;
  storageRealm.IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
    capturedDB = this; return nativeTransaction.apply(this, args);
  };
  const beforeClose = await storageModule.allSounds();
  storageRealm.IDBDatabase.prototype.transaction = nativeTransaction;
  capturedDB!.close();
  await storageModule.saveSound(beforeClose[0]);
  const afterClose = await storageModule.allSounds();
  check(afterClose.length === beforeClose.length, 'Saving after a closed connection reopens storage without duplication');
  const oldClip = beforeClose[0], newClip = afterClose[0];
  check(oldClip.source === 'local' && newClip.source === 'local', 'Recovered local records');
  const oldBytes = new Uint8Array(await oldClip.blob.arrayBuffer()), newBytes = new Uint8Array(await newClip.blob.arrayBuffer());
  check(oldBytes.length === newBytes.length && oldBytes.every((byte, i) => byte === newBytes[i]), 'Reopening storage preserves exact audio bytes');
  passed.push('Closed database recovery / no duplicate write / exact audio preservation');

  $('.pad').click();
  $('#play-pause').click(); $('#play-pause').click(); $('#play-pause').click();
  await pause();
  check($('#playback-message').textContent === '' && !$('#mobile-transport').hidden, 'Immediate pause during pending play does not become an error');
  $('#play-pause').click();
  await wait(isPlaying, 'real trimmed audio playback');
  check(Math.abs(Number(slider().max) - 2) < .05, 'Trimming produced an actual two-second file');
  check(!$('#mobile-transport').hidden, 'Persistent mobile stop control');
  $('#play-pause').click();
  await wait(() => $('#play-pause').getAttribute('aria-label') === 'Continuar reproducción', 'Pause exposes resume semantics');
  input('#playback-seek', '1'); await pause(); await pause();
  check(Math.abs(Number(slider().value) - 1) < .05, 'Seek changes real playback position');
  $('#replay-sound').click(); await wait(() => isPlaying() && Number(slider().value) < .5, 'Replay starts from the beginning');
  $('.stop-all').click();
  check($('#mobile-transport').hidden && $<HTMLAudioElement>('#audio-player').paused && !usesMediaElement(), 'Stop releases audio');
  // Cold sounds start on the media element immediately; prepared sounds use memory.
  const tapOnce = async (): Promise<boolean> => { $('.pad').click(); await wait(isPlaying, 'tap starts playback'); const element = usesMediaElement(); $('.stop-all').click(); return element; };
  async function openApp(search: string): Promise<void> {
    await new Promise<void>(resolve => { frame.onload = () => resolve(); frame.contentWindow!.location.search = search; });
    await ready();
  }
  await openApp('?audio=compat');
  check(await tapOnce() && await tapOnce(), 'Compatibility mode plays through the media element');
  await openApp('');
  let decoded = false;
  for (let attempt = 0; attempt < 40 && !decoded; attempt++) { decoded = !(await tapOnce()); await pause(); }
  check(decoded, 'A tap plays the sound from memory without loading a media element');
  $('.pad').click(); $('#play-pause').click(); await pause();
  check($('#player-state').textContent === 'En pausa', 'Paused decoded sound is reflected in the transport');
  const pausedRealm = frame.contentWindow as Window & typeof globalThis;
  pausedRealm.dispatchEvent(new pausedRealm.PageTransitionEvent('pageshow', { persisted: true }));
  await pause();
  check($('#play-pause').getAttribute('aria-label') === 'Continuar reproducción', 'Returning to the app does not autoplay a paused sound');
  $('#play-pause').click(); await wait(isPlaying, 'resume decoded sound'); $('.stop-all').click();
  passed.push('Decoded playback from memory / media-element fallback / compatibility mode / transport');

  // Spamming: every press sounds, however fast, and the sound starts over rather than toggling off.
  $('.pad').click(); await wait(isPlaying, 'first press');
  await wait(() => Number(slider().value) > .2, 'sound advances');
  const board = $('#board'), firstPad = $('.pad');
  for (let press = 0; press < 7; press++) $('.pad').click();
  check(isPlaying() && !!doc().querySelector('.sound-card.is-playing'), 'Repeated presses keep the sound playing');
  check(Number(slider().value) < .15, 'A repeated press starts the sound over');
  check(doc().querySelectorAll('.pad .ripple').length === 1, 'Ripples do not pile up while spamming');
  check($('#board') === board && $('.pad') === firstPad, 'Pressing a pad does not rebuild the board under the finger');
  check($('.pad').getAttribute('aria-label')!.startsWith('Reiniciar'), 'The pad announces what pressing it does now');
  $('.stop-all').click();
  check(!doc().querySelector('.sound-card.is-playing') && $('.pad').getAttribute('aria-label')!.startsWith('Reproducir'), 'Stopping clears the pad');
  // A pointer press and the click browsers send after it are one press.
  const pressRealm = frame.contentWindow as Window & typeof globalThis;
  const pointer = (type: string, target: Element): boolean => target.dispatchEvent(new pressRealm.PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', button: 0, clientX: 40, clientY: 40 }));
  pointer('pointerdown', $('.pad'));
  check($('#mobile-transport').hidden, 'A finger coming down does not fire, since it may be a scroll');
  pointer('pointerup', $('.pad')); check(!$('#mobile-transport').hidden, 'Lifting the finger fires');
  $('.stop-all').click(); $('.pad').dispatchEvent(new pressRealm.MouseEvent('click', { bubbles: true, detail: 1 }));
  check($('#mobile-transport').hidden, 'The trailing click does not fire a second time');
  pointer('pointerdown', $('.pad')); pointer('pointercancel', $('.pad')); pointer('pointerup', $('.pad'));
  check($('#mobile-transport').hidden, 'A touch that became a scroll stays silent');
  $('.pad').click(); check(!$('#mobile-transport').hidden, 'A keyboard press right after a pointer press still counts'); $('.stop-all').click();
  passed.push('Spam restarts instead of toggling / no board rebuild / touch release and scroll');

  // An audio context can stop responding without any error. The sound must still come out another way.
  await reload();
  const stuck = frame.contentWindow as Window & typeof globalThis;
  Object.defineProperty(stuck.BaseAudioContext.prototype, 'state', { get: () => 'interrupted' });
  stuck.AudioContext.prototype.resume = () => new Promise<void>(() => undefined);
  $('.pad').click();
  await wait(() => usesMediaElement() && isPlaying(), 'stuck audio context falls back to the media element');
  $('.stop-all').click();
  await reload();
  // The fallback continues from where the sound was, not from the top.
  const seekStuck = frame.contentWindow as Window & typeof globalThis;
  Object.defineProperty(seekStuck.BaseAudioContext.prototype, 'state', { get: () => 'interrupted' });
  seekStuck.AudioContext.prototype.resume = () => new Promise<void>(() => undefined);
  $('.pad').click(); $('#play-pause').click();
  await wait(() => !slider().disabled, 'paused decoded sound');
  const mediaPlay = seekStuck.HTMLMediaElement.prototype.play;
  seekStuck.HTMLMediaElement.prototype.play = function () { return Promise.reject(new seekStuck.DOMException('Gesture required', 'NotAllowedError')); };
  input('#playback-seek', '1'); $('#play-pause').click();
  await wait(() => $('#playback-message').textContent?.includes('Continuar'), 'blocked recovery asks for a gesture');
  check(!$('#mobile-transport').hidden && $<HTMLAudioElement>('#audio-player').currentTime >= 1, 'Blocked recovery preserves the selected sound and position');
  seekStuck.HTMLMediaElement.prototype.play = mediaPlay;
  $('#play-pause').click();
  await wait(() => usesMediaElement() && isPlaying(), 'stalled resume falls back');
  check($<HTMLAudioElement>('#audio-player').currentTime >= 1, 'The fallback keeps the playback position');
  $('.stop-all').click();
  await reload();
  // An output that is slow to open is not a stuck context.
  const slow = frame.contentWindow as Window & typeof globalThis;
  const openedAt = Date.now() + 1000;
  const realState = Object.getOwnPropertyDescriptor(slow.BaseAudioContext.prototype, 'state')!.get!;
  Object.defineProperty(slow.BaseAudioContext.prototype, 'state', { configurable: true, get(this: BaseAudioContext) { return Date.now() < openedAt ? 'suspended' : realState.call(this); } });
  const realResume = slow.AudioContext.prototype.resume;
  slow.AudioContext.prototype.resume = function (this: AudioContext) { return new slow.Promise<void>(resolve => { slow.setTimeout(() => { void realResume.call(this).then(resolve); }, Math.max(0, openedAt - Date.now())); }); };
  $('.pad').click();
  const slowUntil = Date.now() + 2700;
  while (Date.now() < slowUntil) { check(!usesMediaElement() && $('#playback-message').textContent === '', 'A slow first start is left alone'); await pause(); }
  $('.stop-all').click();
  await reload();
  // Touching the screen during an interruption must not end the sound in progress.
  const calls = frame.contentWindow as Window & typeof globalThis;
  let interrupted = false, hang = false, closes = 0;
  const liveState = Object.getOwnPropertyDescriptor(calls.BaseAudioContext.prototype, 'state')!.get!;
  Object.defineProperty(calls.BaseAudioContext.prototype, 'state', { configurable: true, get(this: BaseAudioContext) { return interrupted ? 'interrupted' : liveState.call(this); } });
  const liveResume = calls.AudioContext.prototype.resume, liveClose = calls.AudioContext.prototype.close;
  calls.AudioContext.prototype.resume = function (this: AudioContext) { if (hang) return new calls.Promise<void>(() => undefined); interrupted = false; return liveResume.call(this); };
  calls.AudioContext.prototype.close = function (this: AudioContext) { closes++; return liveClose.call(this); };
  $('.pad').click(); await wait(isPlaying, 'sound before interruption'); await new Promise(resolve => setTimeout(resolve, 150));
  interrupted = true;
  doc().dispatchEvent(new calls.PointerEvent('pointerdown', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 800));
  check(closes === 0 && !usesMediaElement() && isPlaying(), 'A resumable context keeps its sound through a gesture');
  interrupted = true; hang = true;
  calls.dispatchEvent(new calls.PageTransitionEvent('pageshow', { persisted: true }));
  await wait(() => closes === 1 && usesMediaElement(), 'Returning from the background recovers a stalled sound without another tap');
  $('.stop-all').click();
  await reload();
  // Decoding that cannot finish or succeed. The sound is added after the patch so it cannot already be in memory.
  const addUndecoded = async (patchDecode: () => Promise<AudioBuffer>, duration: number): Promise<{ id: string; remove: (id: string) => Promise<void> }> => {
    const live = frame.contentWindow as Window & typeof globalThis;
    live.OfflineAudioContext.prototype.decodeAudioData = patchDecode;
    const store = await live.eval(`import('/src/storage.ts')`) as typeof import('../src/storage.ts');
    const made = await live.eval(`import('/src/sounds.ts')`) as typeof import('../src/sounds.ts');
    const sound = { ...made.createSound({ name: 'Sin decodificar', source: 'local', file: wav() }), duration } as import('../src/sounds.ts').Sound;
    await store.saveSound(sound);
    doc().dispatchEvent(new live.Event('visibilitychange'));
    await wait(() => $('.pad-name').textContent === 'Sin decodificar', 'undecoded sound listed');
    return { id: sound.id, remove: store.removeSound };
  };
  const long = await addUndecoded(() => new Promise<AudioBuffer>(() => undefined), 60);
  $('.pad').click();
  check(usesMediaElement(), 'A long sound starts on the media element within the gesture, without waiting to decode');
  $('.stop-all').click(); await long.remove(long.id); await reload();
  const cold = await addUndecoded(() => new Promise<AudioBuffer>(() => undefined), 5);
  $('.pad').click();
  check(usesMediaElement(), 'Even a short sound starts synchronously when decoding hangs');
  await wait(isPlaying, 'cold short audio plays without decoding');
  $('.stop-all').click(); await cold.remove(cold.id); await reload();
  const held = await addUndecoded(() => Promise.reject(new Error('Unreadable')), 5);
  $('.pad').click(); $('#play-pause').click();
  await wait(usesMediaElement, 'failed decode falls back');
  await pause(); await pause();
  check($<HTMLAudioElement>('#audio-player').paused && $('#play-pause').getAttribute('aria-label') === 'Continuar reproducción', 'A pause pressed while loading survives the fallback');
  $('#play-pause').click(); await wait(() => !$<HTMLAudioElement>('#audio-player').paused, 'continue after the fallback');
  $('.stop-all').click(); await held.remove(held.id); await reload();
  passed.push('Stuck context fallback keeps position / slow start tolerated / interruption survives a gesture / long sounds keep the gesture / pause while loading');

  // Motion carries information: newcomers arrive once, the playing sound fills as it progresses, and every press answers.
  await reload();
  check(doc().querySelectorAll('.sound-card.is-new').length === doc().querySelectorAll('.sound-card').length, 'Sounds animate in on first load');
  const stablePad = $('.pad');
  input('#search', 'a'); input('#search', '');
  check($('.pad') === stablePad, 'Search preserves pad identity');
  check(doc().querySelectorAll('.sound-card.is-new').length === 0, 'Searching does not replay the entrance');
  check(getComputedStyle($('.toolbar')).position === 'sticky', 'Search and filters stay reachable while scrolling');
  const playingCard = (): HTMLElement | null => doc().querySelector<HTMLElement>('.sound-card.is-playing');
  $('.pad').click();
  check(doc().querySelectorAll('.pad .ripple').length === 1, 'A press leaves a ripple on the pad');
  await wait(isPlaying, 'motion playback');
  check(!!playingCard()?.querySelector('.eq') && playingCard()!.style.getPropertyValue('--p') !== '', 'The playing sound shows an equalizer and a progress fill');
  await wait(() => Number(playingCard()?.style.getPropertyValue('--p')) > .05, 'Progress fill advances with playback');
  $('#play-pause').click(); await wait(() => !!doc().querySelector('.sound-card.is-playing.is-paused'), 'Pausing freezes the equalizer');
  const pausedCard = playingCard()!, fill = pausedCard.style.getPropertyValue('--p');
  input('#search', 'epico');
  check(playingCard() === pausedCard && pausedCard.style.getPropertyValue('--p') === fill && pausedCard.classList.contains('is-paused'), 'Filtering preserves paused progress and card identity');
  input('#search', '');

  $('#play-pause').click(); await wait(() => !!playingCard() && !playingCard()!.classList.contains('is-paused'), 'Resuming restarts it');
  $('.stop-all').click();
  await wait(() => doc().querySelectorAll('.pad .ripple').length === 0, 'The ripple cleans itself up');
  const stableStar = $('.favorite-button'); stableStar.focus();
  $('.favorite-button').click(); await wait(() => $('.favorite-button').getAttribute('aria-pressed') === 'true', 'star on');
  check($('.pad') === stablePad && $('.favorite-button') === stableStar, 'Favorite changes preserve card controls');
  check(doc().activeElement === stableStar, 'Favorite changes preserve keyboard focus');
  check(!!doc().querySelector('.favorite-button.pop'), 'A new favourite pops');
  $('.favorite-button').click(); await wait(() => $('.favorite-button').getAttribute('aria-pressed') === 'false', 'star off');
  check(!doc().querySelector('.favorite-button.pop'), 'Removing a favourite does not pop');
  passed.push('Entrance only for newcomers / progress fill / equalizer pause / press ripple / favourite pop / sticky toolbar');
  $('.favorite-button').click(); await wait(() => $('.favorite-button').getAttribute('aria-pressed') === 'true', 'favorite commit');
  input('#search', 'epico'); check(doc().querySelectorAll('.pad').length === 1, 'Accent-insensitive search');
  input('#search', 'absent'); check(!$('#no-results').hidden, 'No results'); $('#clear-filter').click();
  check($('.pad') === stablePad, 'A filtered-out pad is reused when shown again');
  passed.push('Local import / actual audio trim / preview / persistence / playback / favorites / search');

  $('.more-button').click(); input('#edit-name', '<b>Mi sonido</b>');
  $<HTMLInputElement>('input[name="edit-color"][value="mint"]').click();
  $<HTMLFormElement>('#edit-form').requestSubmit();
  await wait(() => !$<HTMLDialogElement>('#edit-dialog').open, 'edit save');
  check($('.pad-name').textContent === '<b>Mi sonido</b>' && !doc().querySelector('.pad-name b'), 'Names are text, not HTML');
  check($('.sound-card').dataset.color === 'mint', 'Color saved');
  $('.more-button').click(); $('#delete-sound').click();
  await wait(() => count() === '0', 'delete commit');
  $('#undo-delete').click(); await wait(() => count() === '1', 'undo commit');
  await reload(); check(count() === '1' && $('.sound-card').dataset.color === 'mint', 'Undo and edit persist');
  passed.push('Rename / color / safe text / delete / undo');
  // A failed write leaves both the committed record and the visible name unchanged.
  const failureRealm = frame.contentWindow as Window & typeof globalThis;
  const failureStorage = await failureRealm.eval(`import('/src/storage.ts')`) as typeof import('../src/storage.ts');
  const committed = await failureStorage.allSounds();
  const put = failureRealm.IDBObjectStore.prototype.put;
  failureRealm.IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
    const result = put.apply(this, args); this.transaction.abort(); return result;
  };
  $('.more-button').click(); input('#edit-name', 'Must not commit'); $<HTMLFormElement>('#edit-form').requestSubmit();
  await wait(() => !$('#edit-error').hidden, 'aborted save');
  check($('.pad-name').textContent === committed[0].name && (await failureStorage.allSounds())[0].name === committed[0].name, 'Aborted storage write leaves the previous record intact');
  failureRealm.IDBObjectStore.prototype.put = put;
  $('[data-close="edit-dialog"]').click();

  // Hold one return-to-app read until a newer favorite write has committed.
  const complete = Object.getOwnPropertyDescriptor(failureRealm.IDBTransaction.prototype, 'oncomplete')!;
  let finishRead: (() => void) | undefined, intercept = true;
  Object.defineProperty(failureRealm.IDBTransaction.prototype, 'oncomplete', { ...complete,
    set(this: IDBTransaction, callback: (event: Event) => void) {
      if (intercept && this.mode === 'readonly') {
        intercept = false;
        complete.set!.call(this, (event: Event) => { finishRead = () => callback.call(this, event); });
      } else complete.set!.call(this, callback);
    },
  });
  failureRealm.dispatchEvent(new failureRealm.PageTransitionEvent('pageshow', { persisted: true }));
  await wait(() => !!finishRead, 'delayed collection read');
  const oldFavorite = $('.favorite-button').getAttribute('aria-pressed');
  $('.favorite-button').click();
  await wait(() => $('.favorite-button').getAttribute('aria-pressed') !== oldFavorite, 'newer favorite commit');
  finishRead!(); await pause();
  check($('.favorite-button').getAttribute('aria-pressed') !== oldFavorite, 'A stale return-to-app read cannot overwrite a committed edit');
  Object.defineProperty(failureRealm.IDBTransaction.prototype, 'oncomplete', complete);
  passed.push('Aborted write preserves collection / stale foreground read cannot undo edits');
  const getAll = failureRealm.IDBObjectStore.prototype.getAll;
  let abortRead = true, reads = 0;
  failureRealm.IDBObjectStore.prototype.getAll = function (...args: Parameters<IDBObjectStore['getAll']>) {
    reads++; const result = getAll.apply(this, args);
    if (abortRead) { abortRead = false; this.transaction.abort(); }
    return result;
  };
  const retainedPad = $('.pad');
  failureRealm.dispatchEvent(new failureRealm.PageTransitionEvent('pageshow', { persisted: true }));
  check($('.pad') === retainedPad && !$('#collection-loading').hidden, 'Refreshing retains existing cards while reading');
  await wait(() => reads >= 2 && $('#collection-loading').hidden, 'automatic retry after aborted read');
  check($('#app-error').hidden && $('.pad') === retainedPad, 'A transient read failure recovers without clearing the library');
  failureRealm.IDBObjectStore.prototype.getAll = getAll;
  passed.push('Transient read failure automatically reconnects without clearing cards');


  open(); $<HTMLInputElement>('input[value="youtube"]').click(); $<HTMLInputElement>('#youtube-online').click(); input('#sound-name', 'Online'); input('#sound-url', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ'); submit();
  await wait(() => !$('#form-error').hidden, 'invalid URL error');
  check(count() === '1', 'Invalid link did not persist');
  input('#sound-url', 'https://youtu.be/dQw4w9WgXcQ'); openTrim(); input('#clip-start', '3'); input('#clip-end', '8'); submit();
  await wait(() => !$<HTMLDialogElement>('#add-dialog').open, 'save online link');
  fakeYouTube(); $('.pad').click(); await wait(() => clips.length === 1, 'YT adapter');
  check(JSON.stringify(clips[0]) === JSON.stringify({ videoId: 'dQw4w9WgXcQ', startSeconds: 3, endSeconds: 8 }), 'Official player gets bounds');
  check(!$('#youtube-wrap').hidden, 'Online player is visible');
  lastOptions!.events.onError(); check($('#playback-message').textContent!.includes('no permite'), 'Online restrictions explained');
  check(count() === '2', 'Playback error leaves collection intact');
  passed.push('Optional online link / host validation / player bounds / embed error (test double)');

  $('#settings-trigger').click();
  const currentRealm = frame.contentWindow as Window & typeof globalThis;
  // Exercise real backup encode/decode and the actual file-input restore transaction.
  const modules = await (currentRealm.eval(`Promise.all([import('/src/backup.ts'), import('/src/storage.ts')])`) as Promise<[typeof import('../src/backup.ts'), typeof import('../src/storage.ts')]>);
  const original = await modules[1].allSounds(); const backup = modules[0].makeBackup(original);
  // A cancelled native sheet must not be recorded as a saved copy.
  currentRealm.localStorage.removeItem('tapzi:last-export');
  Object.defineProperty(currentRealm.navigator, 'canShare', { configurable: true, value: () => true });
  Object.defineProperty(currentRealm.navigator, 'share', { configurable: true, value: () => Promise.reject(new currentRealm.DOMException('Cancelled', 'AbortError')) });
  $('#backup-export').click();
  await wait(() => $('#settings-message').textContent?.includes('cancelada'), 'cancelled share');
  check(!currentRealm.localStorage.getItem('tapzi:last-export'), 'Cancelled sharing creates no export receipt');
  let sharedCopy: File | undefined;
  Object.defineProperty(currentRealm.navigator, 'share', { configurable: true, value: async (data: ShareData) => { sharedCopy = data.files?.[0]; } });
  $('#backup-export').click();
  await wait(() => !!currentRealm.localStorage.getItem('tapzi:last-export'), 'export receipt');
  check(!!sharedCopy && (await modules[0].readBackup(sharedCopy)).length === original.length, 'Shared backup includes the whole collection');
  check($('#backup-status').textContent?.includes('Última exportación'), 'Settings show the exported snapshot');
  const restoreAdd = currentRealm.IDBObjectStore.prototype.add;
  let additions = 0;
  currentRealm.IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
    const result = restoreAdd.apply(this, args);
    if (++additions === 2) this.transaction.abort();
    return result;
  };
  let aborted = false;
  try { await modules[1].restoreSounds(original.map((sound, i) => ({ ...sound, id: `rollback-${i}` }))); }
  catch { aborted = true; }
  finally { currentRealm.IDBObjectStore.prototype.add = restoreAdd; }
  check(aborted && (await modules[1].allSounds()).length === original.length, 'An interrupted restore rolls back every inserted sound');
  Object.defineProperty(currentRealm.navigator, 'storage', { configurable: true, value: { persisted: async () => false, persist: async () => false } });
  $('[data-close="settings-dialog"]').click(); $('#settings-trigger').click();
  await wait(() => !$('#protect-storage').hidden, 'protection can be requested');
  $('#protect-storage').click();
  await wait(() => !$<HTMLButtonElement>('#protect-storage').disabled, 'protection denial');
  check($('#persistence-status').textContent?.includes('no concedida'), 'Denied persistence is never shown as protected');
  Object.defineProperty(currentRealm.navigator, 'storage', { configurable: true, value: { persisted: async () => true, persist: async () => true } });
  $('#protect-storage').click();
  await wait(() => $('#persistence-status').textContent?.includes('activada'), 'protection granted');
  check($('#protect-storage').hidden, 'Granted persistence hides redundant request');
  passed.push('Backup sharing cancellation / exported snapshot / persistence granted and denied');

  await modules[1].removeSound(original[0].id);
  const restore = new currentRealm.DataTransfer(); restore.items.add(new currentRealm.File([backup], 'collection.tapzi'));
  $<HTMLInputElement>('#backup-file').files = restore.files; $('#backup-file').dispatchEvent(new currentRealm.Event('change'));
  await wait(() => $('#settings-message').textContent?.includes('sonidos agregados'), 'restore');
  check((await modules[1].allSounds()).length === 2, 'Restore adds missing and skips existing IDs');
  const bad = new currentRealm.DataTransfer(); bad.items.add(new currentRealm.File(['invalid'], 'bad.tapzi'));
  $<HTMLInputElement>('#backup-file').files = bad.files; $('#backup-file').dispatchEvent(new currentRealm.Event('change'));
  await wait(() => $('#settings-message').textContent?.includes('no es válida'), 'corrupt backup');
  check((await modules[1].allSounds()).length === 2, 'Corrupt backup preserves existing data');
  $('[data-close="settings-dialog"]').click(); await reload(); check(count() === '2', 'Restored collection persists');
  passed.push('Backup roundtrip / atomic merge / duplicate protection / corrupt file rejection');

  open();
  const videoRealm = frame.contentWindow as Window & typeof globalThis;
  const videoBytes = await (await fetch('/tests/fixtures/tone.mp4')).arrayBuffer();
  const videoTransfer = new videoRealm.DataTransfer(); videoTransfer.items.add(new videoRealm.File([videoBytes], 'video.mp4', { type: 'video/mp4' }));
  $<HTMLInputElement>('#sound-file').files = videoTransfer.files;
  $('#sound-file').dispatchEvent(new videoRealm.Event('change', { bubbles: true }));
  await wait(() => Number($<HTMLInputElement>('#local-end').value) > 0, 'MP4 metadata');
  input('#local-start', '0.5'); input('#local-end', '1.5'); input('#sound-name', 'Extracted video'); submit();
  await wait(() => !$<HTMLDialogElement>('#add-dialog').open, 'MP4 AAC audio extraction');
  check(count() === '3', 'Video becomes one local sound');
  $('.pad').click();
  await wait(isPlaying, 'extracted video playback');
  check(Math.abs(Number(slider().max) - 1) < .05, 'Extracted video is exactly the chosen audio fragment');
  $('.stop-all').click();
  passed.push('Real MP4/AAC video import / local WAV extraction / actual trimmed playback');

  open();
  const editorRealm = frame.contentWindow as Window & typeof globalThis;
  const draft = new editorRealm.DataTransfer(); draft.items.add(wav());
  $<HTMLInputElement>('#sound-file').files = draft.files; $('#sound-file').dispatchEvent(new editorRealm.Event('change'));
  await wait(() => !$('#sound-details').hidden, 'draft ready');
  input('#sound-name', 'Nombre propio');
  const replacement = new editorRealm.DataTransfer(); replacement.items.add(new editorRealm.File([wav()], 'different.wav', { type: 'audio/wav' }));
  $<HTMLInputElement>('#sound-file').files = replacement.files; $('#sound-file').dispatchEvent(new editorRealm.Event('change'));
  await wait(() => !$('#sound-details').hidden, 'replacement ready');
  check($<HTMLInputElement>('#sound-name').value === 'Nombre propio', 'Changing a file preserves a custom name');
  $('#toggle-trim').click();
  input('#trim-start', '9.99'); input('#trim-end', '1');
  check(Number($<HTMLInputElement>('#local-end').value) > Number($<HTMLInputElement>('#local-start').value), 'Handles cannot cross');
  $('#reset-trim').click();
  check($<HTMLInputElement>('#local-start').value === '0' && Number($<HTMLInputElement>('#local-end').value) === 10, 'Reset restores full clip');
  input('#trim-end', '9.95');
  submit(); await wait(() => !$<HTMLDialogElement>('#add-dialog').open, 'precise trim');
  $('.pad').click(); await wait(() => !slider().disabled, 'precise playback');
  check(Math.abs(Number(slider().max) - 9.95) < .005, 'A 50ms end trim is honored, not treated as full audio');
  $('.stop-all').click();
  open();
  const invalid = new editorRealm.DataTransfer(); invalid.items.add(new editorRealm.File(['html'], 'not-audio.html', { type: 'text/html' }));
  $<HTMLInputElement>('#sound-file').files = invalid.files; $('#sound-file').dispatchEvent(new editorRealm.Event('change'));
  check(!$('#form-error').hidden && $('#add-actions').hidden, 'Bad file gives an error without exposing save');
  $('#close-dialog').click();
  if (!$<HTMLElement>('#discard-prompt').hidden) $('#confirm-discard').click();
  check(!$<HTMLDialogElement>('#add-dialog').open, 'Discard returns to collection');
  passed.push('Progressive import / visual range handles / draft protection / file replacement / precision trimming / player controls');

  // Exercise real MP3 metadata, trimming, storage and playback with a provider double.
  // No paid endpoint or credentials are used by browser tests.
  const cloudRealm = frame.contentWindow as Window & typeof globalThis;
  const originalFetch = cloudRealm.fetch.bind(cloudRealm);
  const mp3 = await (await fetch('/tests/fixtures/tone.mp3')).arrayBuffer();
  let imports = 0, cloudMode = 'success';
  let lateResponse: ((response: Response) => void) | undefined;
  const cloudAudio = () => new cloudRealm.Response(mp3.slice(0), { headers: { 'Content-Type': 'audio/mpeg', 'X-Tapzi-Title': encodeURIComponent('Desde YouTube') } });
  cloudRealm.fetch = (async (resource, init) => {
    if (String(resource) !== '/api/youtube') return originalFetch(resource, init);
    if (init?.method !== 'POST') return cloudRealm.Response.json({ enabled: cloudMode !== 'disabled', authorized: !!cloudRealm.sessionStorage.getItem('tapzi-import-access') });
    imports++;
    if (cloudMode === 'late') return new Promise<Response>(resolve => { lateResponse = resolve; });
    if (cloudMode === 'failure') return cloudRealm.Response.json({ error: 'El proveedor no pudo obtener el audio.' }, { status: 502 });
    if (cloudMode === 'unauthorized') return cloudRealm.Response.json({ error: 'Código de acceso incorrecto.' }, { status: 401 });
    if (cloudMode === 'html') return new cloudRealm.Response('<html>Error</html>', { headers: { 'Content-Type': 'text/html' } });
    check(new Headers(init?.headers).get('Authorization') === 'Bearer test-access-code', 'Access code is a request header');
    check(JSON.parse(String(init?.body)).url === 'https://youtu.be/dQw4w9WgXcQ', 'Only the link is submitted');
    return cloudAudio();
  }) as typeof fetch;
  const beforeCloud = Number(count());
  open(); $<HTMLInputElement>('input[value="youtube"]').click();
  await wait(() => $('#youtube-status').textContent !== 'Comprobando la importación…', 'cloud configuration');
  check(!$('#import-access').hidden, `Cloud access form: ${$('#youtube-status').textContent}; source=${$<HTMLInputElement>('input[name="source"]:checked').value}`);
  check($('#sound-details').hidden && $('#add-actions').hidden, 'YouTube starts with a link, without premature save/name fields');
  input('#sound-url', 'https://youtu.be/dQw4w9WgXcQ'); input('#import-access-code', 'test-access-code');
  $('#fetch-youtube').click(); submit();
  await wait(() => !$('#sound-details').hidden, 'downloaded MP3 opens editor');
  check(imports === 1, 'Double submission does not consume another conversion');
  check(Number(count()) === beforeCloud, 'Downloading alone never saves a pad');
  check($<HTMLInputElement>('input[value="local"]').checked && $<HTMLInputElement>('#sound-name').value === 'Desde YouTube', 'Downloaded audio enters local editor with its title');
  $('#toggle-trim').click(); input('#trim-start', '.25'); input('#trim-end', '1.25'); submit();
  await wait(() => !$<HTMLDialogElement>('#add-dialog').open, 'save imported clip');
  check(Number(count()) === beforeCloud + 1, 'Import saved once');
  const cloudStorage = await cloudRealm.eval(`import('/src/storage.ts')`) as typeof import('../src/storage.ts');
  const imported = (await cloudStorage.allSounds()).find(sound => sound.name === 'Desde YouTube');
  check(imported?.source === 'local' && imported.blob.size > 44, 'Imported bytes are stored, not a temporary download URL');
  $('.pad').click(); await wait(isPlaying, 'imported clip playback');
  check(Math.abs(Number(slider().max) - 1) < .05, 'Real MP3 was decoded and trimmed to one second'); $('.stop-all').click();
  for (const mode of ['failure', 'html', 'unauthorized']) {
    cloudMode = mode; open(); $<HTMLInputElement>('input[value="youtube"]').click();
    await wait(() => !$<HTMLButtonElement>('#fetch-youtube').disabled, `import ready: ${mode}`);
    input('#sound-url', 'https://youtu.be/dQw4w9WgXcQ'); input('#import-access-code', 'test-access-code'); $('#fetch-youtube').click();
    await wait(() => !$('#form-error').hidden && !$<HTMLButtonElement>('#fetch-youtube').disabled, 'import failure');
    check(Number(count()) === beforeCloud + 1 && $('#add-actions').hidden, 'Failed import preserves collection and cannot be saved');
    if (mode === 'unauthorized') check(!$('#import-access').hidden && !cloudRealm.sessionStorage.getItem('tapzi-import-access'), 'Rejected access code is forgotten');
    $('#close-dialog').click(); $('#confirm-discard').click();
  }
  cloudMode = 'late'; open(); $<HTMLInputElement>('input[value="youtube"]').click();
  await wait(() => !$<HTMLButtonElement>('#fetch-youtube').disabled, 'cancellable import ready');
  input('#sound-url', 'https://youtu.be/dQw4w9WgXcQ'); input('#import-access-code', 'test-access-code'); $('#fetch-youtube').click();
  await wait(() => !!lateResponse, 'pending import'); $('#cancel-youtube-import').click();
  check(!$('#youtube-import-progress').checkVisibility() && !$<HTMLButtonElement>('#fetch-youtube').disabled, 'Cancellation immediately restores controls');
  lateResponse!(cloudAudio()); await pause(); await pause();
  check($('#sound-details').hidden && Number(count()) === beforeCloud + 1, 'Late response after cancellation cannot populate or save a draft');
  $('#close-dialog').click(); $('#confirm-discard').click();
  cloudMode = 'disabled'; open(); $<HTMLInputElement>('input[value="youtube"]').click();
  await wait(() => $('#youtube-status').textContent?.includes('no está activada'), 'unconfigured deployment');
  check($<HTMLButtonElement>('#fetch-youtube').disabled, 'Unconfigured deployment never promises a working importer');
  $<HTMLInputElement>('#youtube-online').click(); check(!$('#add-actions').hidden, 'Saving an online link remains available');
  $('#close-dialog').click();
  cloudRealm.fetch = originalFetch;
  await reload(); check(Number(count()) === beforeCloud + 1, 'Imported audio survives reload');
  passed.push('YouTube cloud flow / real MP3 trim and persistence / access / failure / cancellation / no duplicate conversion / offline-link fallback');

  // A file over ten minutes cannot be decoded whole on a phone, yet a short fragment of it must still save.
  const toneBytes = new Uint8Array(await (await fetch('/tests/fixtures/tone.mp3')).arrayBuffer());
  const toneAudio = sliceMp3(toneBytes, 0, 1000)!;
  const longRealm = frame.contentWindow as Window & typeof globalThis;
  const longFile = new longRealm.File(Array.from({ length: 320 }, () => toneBytes.slice(toneAudio.from, toneAudio.to)), 'conferencia.mp3', { type: 'audio/mpeg' });
  const beforeLong = Number(count());
  open();
  const longTransfer = new longRealm.DataTransfer(); longTransfer.items.add(longFile);
  $<HTMLInputElement>('#sound-file').files = longTransfer.files;
  $('#sound-file').dispatchEvent(new longRealm.Event('change', { bubbles: true }));
  await wait(() => Number($<HTMLInputElement>('#local-end').value) > 0, 'long MP3 metadata');
  check(Number($<HTMLInputElement>('#local-start').max) > 600, 'The test file is longer than ten minutes');
  input('#local-start', '400'); input('#local-end', '402'); input('#sound-name', 'Largo'); submit();
  await wait(() => !$<HTMLDialogElement>('#add-dialog').open, 'trim a long MP3');
  check(Number(count()) === beforeLong + 1, 'A fragment of a long MP3 saves');
  $('.pad').click(); await wait(isPlaying, 'long MP3 fragment playback');
  check(Math.abs(Number(slider().max) - 2) < .1, 'Only the chosen two seconds were kept');
  $('.stop-all').click();
  passed.push('Fragment of an MP3 longer than ten minutes decoded without loading the whole file');

  for (const width of [320, 360, 390, 1280]) {
    frame.style.width = `${width}px`; await pause();
    check(doc().documentElement.scrollWidth <= width, `No overflow at ${width}px: ${[...doc().querySelectorAll<HTMLElement>('body *')].filter(el => el.getBoundingClientRect().right > width).map(el => el.tagName + '.' + el.className + ':' + el.getBoundingClientRect().right).slice(0, 8).join(', ')}`);
    for (const node of doc().querySelectorAll<HTMLElement>('.pad,.favorite-button,.more-button,.add-trigger')) if (node.checkVisibility()) check(node.getBoundingClientRect().height >= 44, '44px targets');
    open(); check($<HTMLDialogElement>('#add-dialog').getBoundingClientRect().right <= width, 'Dialog fits');
    check(parseFloat(frame.contentWindow!.getComputedStyle($('#sound-name')).fontSize) >= 16, 'No small input zoom');
    $('#close-dialog').click();
  }
  passed.push('320/360/390/1280px layout / touch targets / input sizing');
  results.dataset.result = 'passed'; results.textContent = `PASS (${passed.length} groups)\n${passed.join('\n')}`;
} catch (error) { results.dataset.result = 'failed'; results.textContent = `FAIL\n${error instanceof Error ? error.stack : String(error)}\nPassed: ${passed.join(', ')}`; }
