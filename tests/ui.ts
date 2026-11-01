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
function open(): void { $('.add-trigger').click(); check($<HTMLDialogElement>('#add-dialog').open, 'Dialog opens'); }
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
  check(count() === '0' && !$('#empty').hidden, 'Fresh browser has an empty board');
  open();
  check(doc().activeElement?.id === 'sound-name', 'Dialog places focus in the name');
  input('#sound-name', 'Épico final');
  input('#sound-url', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ');
  submit();
  check($('#form-error').textContent === 'Use a YouTube video, Shorts, or youtu.be link.', 'Invalid host has exact visible error');
  check(count() === '0' && doc().querySelectorAll('.sound-card').length === 0, 'Rejected link leaves board and count unchanged');
  $('#cancel-dialog').click();
  await reload();
  check(count() === '0', 'Rejected link was not persisted');
  open();
  input('#sound-name', 'Épico final');
  input('#sound-url', 'https://youtu.be/dQw4w9WgXcQ');
  input('#clip-start', '0:03'); input('#clip-end', '0:08');
  submit();
  await wait(() => !$<HTMLDialogElement>('#add-dialog').open, 'save YouTube clip');
  check(count() === '1' && $('.pad-name').textContent === 'Épico final', 'YouTube clip added with its name');
  check($('.pad-meta').textContent === 'YouTube / 0:03–0:08', 'Clip bounds shown');
  $('.favorite-button').click();
  await wait(() => $('.favorite-button').getAttribute('aria-pressed') === 'true', 'favorite commit');
  await reload();
  check(count() === '1' && $('.favorite-button').getAttribute('aria-pressed') === 'true', 'Clip and favorite survive reload');
  input('#search', 'epico');
  check(doc().querySelectorAll('.pad').length === 1, 'Accent-insensitive search');
  input('#search', 'missing');
  check(!$('#no-results').hidden && count() === '1', 'Search empty state retains total');
  $('#clear-filter').click();
  passed.push('YouTube add / validation / persistence / favorites / search');

  fakeYouTube();
  $('.pad').click();
  await wait(() => clips.length === 1, 'YouTube adapter ready');
  check(JSON.stringify(clips[0]) === JSON.stringify({ videoId: 'dQw4w9WgXcQ', startSeconds: 3, endSeconds: 8 }), 'Official player receives exact clip bounds');
  check(lastOptions?.playerVars.playsinline === 1 && lastOptions.playerVars.controls === 1, 'Inline official controls enabled');
  const playerRect = $('#youtube-player').getBoundingClientRect();
  check(!$('#youtube-wrap').hidden && playerRect.width >= 200 && playerRect.height >= 200, 'YouTube player remains visibly sized');
  check($('#player-state').textContent === 'Playing', 'Playback status is visible');
  $('.stop-all').click();
  check(destroys === 1 && $('#youtube-wrap').hidden && !doc().querySelector('.is-playing'), 'Stop removes video and active state');
  $('.pad').click();
  await wait(() => clips.length === 2, 'second YouTube start');
  lastOptions!.events.onError();
  check($('#player-state').textContent === 'Could not play' && $('#playback-message').textContent!.includes('blocked from embedding'), 'Embed errors are explained without losing the clip');
  check(count() === '1', 'Playback error leaves saved collection unchanged');
  passed.push('YouTube adapter / visible player / stop / embed errors (test double)');

  open();
  input('#sound-name', 'Local reaction');
  $<HTMLInputElement>('input[value="local"]').click();
  const realm = frame.contentWindow as Window & typeof globalThis;
  const transfer = new realm.DataTransfer();
  transfer.items.add(wav());
  $<HTMLInputElement>('#sound-file').files = transfer.files;
  submit();
  await wait(() => !$<HTMLDialogElement>('#add-dialog').open, 'local save');
  check(count() === '2', 'Audio file added');
  await reload();
  check(count() === '2', 'Local audio survives reload');
  const localPad = [...doc().querySelectorAll<HTMLButtonElement>('.pad')].find(pad => pad.textContent?.includes('Local reaction'))!;
  localPad.click();
  const audio = $<HTMLAudioElement>('#audio-player');
  await wait(() => audio.readyState >= 2 && !audio.paused, 'real local audio playback');
  check(!audio.hidden && audio.src.startsWith('blob:'), 'Local audio plays from browser storage, not a server');
  $('.stop-all').click();
  check(audio.paused && !audio.hasAttribute('src') && audio.hidden, 'Stop clears local source');
  $('#favorite-filter').click();
  check(doc().querySelectorAll('.pad').length === 1 && $('.pad-name').textContent === 'Épico final', 'Favorites filter excludes unfavorited local sound');
  $('#all-filter').click();
  passed.push('Local WAV upload / persistent Blob / real playback / stop');

  check(doc().documentElement.scrollWidth <= 360, 'No horizontal overflow at 360px');
  for (const button of doc().querySelectorAll<HTMLButtonElement>('.pad, .favorite-button, .add-trigger')) {
    if (button.getClientRects().length) check(button.getBoundingClientRect().height >= 44, 'Visible touch targets are at least 44px');
  }
  open();
  check($<HTMLDialogElement>('#add-dialog').getBoundingClientRect().right <= 360, 'Dialog fits mobile viewport');
  $('#cancel-dialog').click();
  frame.style.width = '1280px';
  await pause();
  check(doc().documentElement.scrollWidth <= 1280, 'No desktop horizontal overflow');
  passed.push('360px and 1280px layout / touch targets / dialog focus');
  results.dataset.result = 'passed';
  results.textContent = `PASS (${passed.length} groups)\n${passed.join('\n')}`;
} catch (error) {
  results.dataset.result = 'failed';
  results.textContent = `FAIL\n${error instanceof Error ? error.stack : String(error)}\nPassed: ${passed.join(', ')}`;
}
