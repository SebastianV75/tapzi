import type { Sound } from './sounds.ts';

let opening: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open('tapzi', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sounds', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Browser storage is unavailable. Check private browsing or storage permissions.'));
    request.onblocked = () => reject(new Error('Close other Tapzi tabs and try again.'));
  });
  return opening;
}

export async function allSounds(): Promise<Sound[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('sounds', 'readonly');
    const request: IDBRequest<Sound[]> = transaction.objectStore('sounds').getAll();
    transaction.oncomplete = () => resolve(request.result.sort((a, b) => b.createdAt - a.createdAt));
    transaction.onerror = () => reject(new Error('Could not read your sounds. Reload to try again.'));
    transaction.onabort = transaction.onerror;
  });
}

export async function saveSound(sound: Sound): Promise<Sound> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('sounds', 'readwrite');
    transaction.objectStore('sounds').put(sound);
    transaction.oncomplete = () => resolve(sound);
    transaction.onerror = () => reject(new Error('Could not save. Your browser storage may be full. Nothing was added.'));
    transaction.onabort = transaction.onerror;
  });
}
