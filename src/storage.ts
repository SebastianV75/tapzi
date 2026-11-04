import type { Sound } from './sounds.ts';

let opening: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open('tapzi', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sounds', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = undefined; reject(new Error('El almacenamiento no está disponible. Revisá los permisos o abrí Tapzi fuera del modo privado.')); };
    request.onblocked = () => reject(new Error('Cerrá las otras pestañas de Tapzi e intentá otra vez.'));
  });
  return opening;
}

export async function allSounds(): Promise<Sound[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('sounds', 'readonly');
    const request: IDBRequest<Sound[]> = transaction.objectStore('sounds').getAll();
    transaction.oncomplete = () => resolve(request.result.sort((a, b) => b.createdAt - a.createdAt));
    transaction.onerror = () => reject(new Error('No se pudo leer tu colección. Volvé a cargar Tapzi.'));
    transaction.onabort = transaction.onerror;
  });
}

export async function saveSound(sound: Sound): Promise<Sound> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('sounds', 'readwrite');
    transaction.objectStore('sounds').put(sound);
    transaction.oncomplete = () => resolve(sound);
    transaction.onerror = () => reject(new Error('No se pudo guardar. Puede faltar espacio en tu dispositivo. No se agregó el sonido.'));
    transaction.onabort = transaction.onerror;
  });
}

export async function removeSound(id: string): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sounds', 'readwrite');
    tx.objectStore('sounds').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error('No se pudo eliminar el sonido. Intentá otra vez.'));
  });
}

// One transaction: either all new entries are saved or none. Existing IDs win.
export async function restoreSounds(sounds: Sound[]): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sounds', 'readwrite');
    const store = tx.objectStore('sounds');
    for (const sound of sounds) {
      const request = store.getKey(sound.id);
      request.onsuccess = () => { if (request.result === undefined) store.add(sound); };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error('No se pudo restaurar la copia. Comprobá el espacio disponible; no se agregó ningún sonido.'));
  });
}
