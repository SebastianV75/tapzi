import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionSignature, exportStatus, recordExport, persistenceStatus } from '../src/collection-safety.ts';
import { createSound } from '../src/sounds.ts';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
} });
const clip = createSound({ name: 'Clip', source: 'local', file: new File(['audio'], 'clip.wav', { type: 'audio/wav' }) });

test('export receipt survives object reconstruction and ignores collection order', () => {
  values.clear();
  const other = { ...clip, id: 'second' };
  recordExport(collectionSignature([clip, other]));
  const { name, ...rest } = clip;
  assert.match(exportStatus([other, { name, ...rest }]), /Última exportación/);
  assert.match(exportStatus([{ ...clip, name: 'Renamed' }, other]), /Hay cambios/);
  assert.match(exportStatus([clip]), /Hay cambios/);
  assert.match(exportStatus([{ ...clip, favorite: true }, other]), /Hay cambios/);
});
test('absent or damaged export metadata never claims there is a copy', () => {
  values.clear(); assert.match(exportStatus([clip]), /no hay una exportación/);
  values.set('tapzi:last-export', '{broken'); assert.match(exportStatus([clip]), /no hay una exportación/);
  values.set('tapzi:last-export', 'null'); assert.match(exportStatus([clip]), /no hay una exportación/);
  assert.match(exportStatus([]), /primera copia/);
});
test('optional export bookkeeping failure does not prevent exporting', () => {
  const original = localStorage.setItem;
  localStorage.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  try { assert.doesNotThrow(() => recordExport(collectionSignature([clip]))); }
  finally { localStorage.setItem = original; }
});
test('persistence reports denial, grant, missing APIs and errors honestly', async () => {
  const setStorage = (value: unknown): void => { Object.defineProperty(navigator, 'storage', { configurable: true, value }); };
  setStorage({ persisted: async () => false, persist: async () => false });
  assert.match((await persistenceStatus(true)).text, /no concedida/);
  setStorage({ persisted: async () => true });
  assert.deepEqual((await persistenceStatus()).canRequest, false);
  assert.match((await persistenceStatus()).text, /activada/);
  setStorage(undefined);
  assert.match((await persistenceStatus()).text, /no permite comprobar/);
  setStorage({ persisted: async () => { throw new Error('Unavailable'); } });
  assert.match((await persistenceStatus()).text, /No se pudo comprobar/);
});
