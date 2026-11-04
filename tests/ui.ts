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
  $('.pad').click();
  $('#play-pause').click(); $('#play-pause').click(); $('#play-pause').click();
  await pause();
  check($('#playback-message').textContent === '' && !$('#mobile-transport').hidden, 'Immediate pause during pending play does not become an error');
  $('#play-pause').click();
  const audio = $<HTMLAudioElement>('#audio-player');
  await wait(() => audio.readyState >= 2 && !audio.paused, 'real trimmed audio playback');
  check(Math.abs(audio.duration - 2) < .05, 'Trimming produced an actual two-second file');
  check(!$('#mobile-transport').hidden, 'Persistent mobile stop control');
  $('#play-pause').click(); check(audio.paused, 'Compact transport pauses');
  await wait(() => $('#play-pause').getAttribute('aria-label') === 'Continuar reproducción', 'Pause exposes resume semantics');
  input('#playback-seek', '1'); check(Math.abs(audio.currentTime - 1) < .05, 'Seek changes real playback position');
  $('#replay-sound').click(); await wait(() => !audio.paused, 'restart');
  check(audio.currentTime < .5, 'Replay starts from the beginning');
  $('.stop-all').click(); check(audio.paused && !audio.hasAttribute('src'), 'Stop releases audio');
  $('.favorite-button').click(); await wait(() => $('.favorite-button').getAttribute('aria-pressed') === 'true', 'favorite commit');
  input('#search', 'epico'); check(doc().querySelectorAll('.pad').length === 1, 'Accent-insensitive search');
  input('#search', 'absent'); check(!$('#no-results').hidden, 'No results'); $('#clear-filter').click();
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

  open(); $<HTMLInputElement>('input[value="youtube"]').click(); input('#sound-name', 'Online'); input('#sound-url', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ'); submit();
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
  await wait(() => !$<HTMLAudioElement>('#audio-player').paused && $<HTMLAudioElement>('#audio-player').readyState >= 2, 'extracted video playback');
  check(Math.abs($<HTMLAudioElement>('#audio-player').duration - 1) < .05, 'Extracted video is exactly the chosen audio fragment');
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
  $('.pad').click(); await wait(() => $<HTMLAudioElement>('#audio-player').readyState >= 2, 'precise playback');
  check(Math.abs($<HTMLAudioElement>('#audio-player').duration - 9.95) < .005, 'A 50ms end trim is honored, not treated as full audio');
  $('.stop-all').click();
  open();
  const invalid = new editorRealm.DataTransfer(); invalid.items.add(new editorRealm.File(['html'], 'not-audio.html', { type: 'text/html' }));
  $<HTMLInputElement>('#sound-file').files = invalid.files; $('#sound-file').dispatchEvent(new editorRealm.Event('change'));
  check(!$('#form-error').hidden && $('#add-actions').hidden, 'Bad file gives an error without exposing save');
  $('#close-dialog').click();
  if (!$<HTMLElement>('#discard-prompt').hidden) $('#confirm-discard').click();
  check(!$<HTMLDialogElement>('#add-dialog').open, 'Discard returns to collection');
  passed.push('Progressive import / visual range handles / draft protection / file replacement / precision trimming / player controls');

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
