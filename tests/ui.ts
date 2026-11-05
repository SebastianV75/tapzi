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
  // A sound that is not decoded yet still plays at once through the media element, and warms itself for the next tap.
  // Compatibility mode keeps every tap on the media element.
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
  check(decoded, 'After a tap warms it, the sound plays from memory without loading a media element');
  $('.pad').click(); $('#play-pause').click(); await pause();
  check($('#player-state').textContent === 'En pausa', 'Paused decoded sound is reflected in the transport');
  $('#play-pause').click(); await wait(isPlaying, 'resume decoded sound'); $('.stop-all').click();
  passed.push('Decoded playback from memory / media-element fallback / compatibility mode / transport');
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
