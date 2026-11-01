import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeId, createSound, matchesSound, formatTime } from '../src/sounds.ts';

test('YouTube links become playable clips with explicit start and end', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?t=3',
    'https://youtube.com/shorts/dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
  ]) assert.equal(youtubeId(url), 'dQw4w9WgXcQ');
  const clip = createSound({ name: 'Tiny victory', source: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', start: '0:03', end: '0:08' });
  assert.ok(clip.source === 'youtube');
  assert.equal(clip.start, 3);
  assert.equal(clip.end, 8);
  assert.equal(clip.videoId, 'dQw4w9WgXcQ');
  assert.equal(clip.name, 'Tiny victory');
  assert.equal(clip.source, 'youtube');
  for (const url of ['https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', 'https://youtu.be/invalid', 'http://youtu.be/dQw4w9WgXcQ']) {
    assert.throws(() => createSound({ name: 'Bad', source: 'youtube', url }));
  }
  for (const [start, end] of [['4', '2'], ['-1', '4'], ['0:99', ''], ['NaN', '5'], ['0', '0']]) {
    assert.throws(() => createSound({ name: 'Bad', source: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', start, end }));
  }
});

test('local audio remains a local Blob and rejects unsupported uploads', () => {
  const file = new File(['audio'], 'victory.wav', { type: 'audio/wav' });
  const sound = createSound({ name: 'Victory', source: 'local', file });
  assert.ok(sound.source === 'local');
  assert.equal(sound.blob, file);
  assert.equal(sound.source, 'local');
  assert.equal(sound.fileName, 'victory.wav');
  assert.throws(() => createSound({ name: 'Bad', source: 'local', file: new File(['x'], 'x.html', { type: 'text/html' }) }));
  assert.throws(() => createSound({ name: 'Bad', source: 'local' }));
});

test('names are required, search is case and accent insensitive', () => {
  assert.throws(() => createSound({ name: ' ', source: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ' }));
  assert.equal(matchesSound({ name: 'Épico final' }, 'epico'), true);
  assert.equal(matchesSound({ name: 'Épico final' }, 'nothing'), false);
  assert.equal(formatTime(65), '1:05');
});
