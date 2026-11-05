import type { Sound } from './sounds.ts';

const RECEIPT_KEY = 'tapzi:last-export';
interface ExportReceipt { signature: string; exportedAt: number }
// Audio is immutable under its ID in Tapzi. Include all exported metadata and byte lengths.
export function collectionSignature(sounds: Sound[]): string {
  return JSON.stringify([...sounds].sort((a, b) => a.id.localeCompare(b.id)).map(sound => [
    sound.id, sound.name, sound.favorite, sound.color ?? 'lavender', sound.createdAt, sound.source,
    sound.source === 'local'
      ? [sound.fileName, sound.duration ?? null, sound.blob.size, sound.blob.type]
      : [sound.videoId, sound.start, sound.end],
  ]));
}
export function recordExport(signature: string): void {
  try { localStorage.setItem(RECEIPT_KEY, JSON.stringify({ signature, exportedAt: Date.now() })); }
  catch { /* Exporting must still work when optional bookkeeping storage is unavailable. */ }
}
export function exportStatus(sounds: Sound[]): string {
  if (!sounds.length) return 'Agrega sonidos para crear tu primera copia.';
  let receipt: ExportReceipt;
  try {
    receipt = JSON.parse(localStorage.getItem(RECEIPT_KEY) ?? 'null') as ExportReceipt;
    if (!receipt || typeof receipt.signature !== 'string' || !Number.isFinite(receipt.exportedAt) || receipt.exportedAt <= 0) throw new Error();
  } catch { return 'Todavía no hay una exportación registrada en este dispositivo.'; }
  const date = new Date(receipt.exportedAt).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
  return receipt.signature === collectionSignature(sounds)
    ? `Última exportación: ${date}. Comprueba que el archivo esté guardado en Archivos.`
    : `Hay cambios desde la última exportación (${date}). Guarda una nueva copia.`;
}
export async function persistenceStatus(request = false): Promise<{ text: string; canRequest: boolean }> {
  const storage = navigator.storage;
  if (!storage?.persisted) return { text: 'Este navegador no permite comprobar la protección del almacenamiento. Guarda una copia en Archivos.', canRequest: false };
  try {
    const persistent = request && storage.persist ? await storage.persist() : await storage.persisted();
    return {
      text: persistent
        ? 'Protección del almacenamiento activada. Borrar los datos del sitio también borra tus sonidos; conserva una copia en Archivos.'
        : 'Protección del almacenamiento no concedida. El navegador puede liberar estos datos; guarda una copia en Archivos.',
      canRequest: !persistent && typeof storage.persist === 'function',
    };
  } catch { return { text: 'No se pudo comprobar la protección. Tus sonidos no se han modificado. Guarda una copia en Archivos.', canRequest: typeof storage.persist === 'function' }; }
}
