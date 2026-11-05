import type { Sound } from './sounds.ts';

let opening: Promise<IDBDatabase> | undefined;
let connection: IDBDatabase | undefined;
function database(): Promise<IDBDatabase> {
  if (connection) return Promise.resolve(connection);
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open('tapzi', 1);
    let abandoned = false;
    const timer = setTimeout(() => fail('El almacenamiento tarda en responder. Intenta cargar la colección otra vez.'), 4000);
    const fail = (message: string): void => {
      if (abandoned) return;
      clearTimeout(timer); abandoned = true; opening = undefined; reject(new Error(message));
    };
    request.onupgradeneeded = () => request.result.createObjectStore('sounds', { keyPath: 'id' });
    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      if (abandoned) { db.close(); return; }
      connection = db; opening = undefined;
      const forget = (): void => { if (connection === db) connection = undefined; };
      db.onclose = forget;
      db.onversionchange = () => { forget(); db.close(); };
      resolve(db);
    };
    request.onerror = () => fail('El almacenamiento no está disponible. Revisá los permisos o abrí Tapzi fuera del modo privado.');
    request.onblocked = () => fail('Cerrá las otras pestañas de Tapzi e intentá otra vez.');
  });
  const attempt = opening;
  // indexedDB.open can throw synchronously (for example when access is denied).
  void attempt.catch(() => { if (opening === attempt) opening = undefined; });
  return attempt;
}

// Retry only opening a transaction: never replay a write whose outcome is unknown.
async function transaction(mode: IDBTransactionMode): Promise<IDBTransaction> {
  const db = await database();
  try { return db.transaction('sounds', mode); }
  catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'InvalidStateError') throw error;
    if (connection === db) connection = undefined;
    db.close();
    return (await database()).transaction('sounds', mode);
  }
}

export async function allSounds(): Promise<Sound[]> {
  const tx = await transaction('readonly');
  return new Promise((resolve, reject) => {
    const request: IDBRequest<Sound[]> = tx.objectStore('sounds').getAll();
    const fail = (): void => {
      clearTimeout(timer);
      if (connection === tx.db) connection = undefined;
      tx.db.close();
      reject(new Error('No se pudo leer tu colección. Tus sonidos no se han modificado. Intenta cargarla otra vez.'));
    };
    const timer = setTimeout(() => { try { tx.abort(); } catch { /* It may have just finished. */ } fail(); }, 4000);
    tx.oncomplete = () => { clearTimeout(timer); resolve(request.result.sort((a, b) => b.createdAt - a.createdAt)); };
    tx.onerror = tx.onabort = fail;
  });
}

export async function saveSound(sound: Sound): Promise<Sound> {
  const tx = await transaction('readwrite');
  return new Promise((resolve, reject) => {
    tx.objectStore('sounds').put(sound);
    tx.oncomplete = () => resolve(sound);
    tx.onerror = () => reject(new Error('No se pudo guardar. Puede faltar espacio en tu dispositivo. No se agregó el sonido.'));
    tx.onabort = tx.onerror;
  });
}

export async function removeSound(id: string): Promise<void> {
  const tx = await transaction('readwrite');
  return new Promise((resolve, reject) => {
    tx.objectStore('sounds').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error('No se pudo eliminar el sonido. Intentá otra vez.'));
  });
}

// One transaction: either all new entries are saved or none. Existing IDs win.
export async function restoreSounds(sounds: Sound[]): Promise<void> {
  const tx = await transaction('readwrite');
  return new Promise((resolve, reject) => {
    const store = tx.objectStore('sounds');
    for (const sound of sounds) {
      const request = store.getKey(sound.id);
      request.onsuccess = () => { if (request.result === undefined) store.add(sound); };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error('No se pudo restaurar la copia. Comprobá el espacio disponible; no se agregó ningún sonido.'));
  });
}
