import { youtubeId } from './sounds.ts';

const LIMIT = 4 * 1024 * 1024;
const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const CODE_KEY = 'tapzi-import-access';
function storedCode(): string { try { return sessionStorage.getItem(CODE_KEY) ?? ''; } catch { return ''; } }
function rememberCode(code: string): void { try { if (code) sessionStorage.setItem(CODE_KEY, code); else sessionStorage.removeItem(CODE_KEY); } catch { /* Import still works without session storage. */ } }

export function createYouTubeImport(options: { onFile(file: File): void; onError(error: unknown, field?: string): void }) {
  const button = $<HTMLButtonElement>('#fetch-youtube');
  const code = $<HTMLInputElement>('#import-access-code');
  const status = $('#youtube-status');
  let request: AbortController | null = null;
  let configRequest: AbortController | null = null;
  let enabled = false;
  let generation = 0;
  const codeValue = () => code.value.trim() || storedCode();
  const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${codeValue()}` });
  function busy(value: boolean): void {
    $('#youtube-import-progress').hidden = !value;
    button.disabled = value || !enabled;
    $<HTMLInputElement>('#sound-url').disabled = value; code.disabled = value;
    $<HTMLInputElement>('#youtube-online').disabled = value;
    document.querySelectorAll<HTMLInputElement>('input[name="source"]').forEach(input => { input.disabled = value; });
    button.textContent = value ? 'Obteniendo audio…' : 'Obtener audio';
  }
  function cancel(): void {
    if (!request) return;
    generation++; request.abort(); request = null; busy(false);
    status.textContent = 'Importación cancelada. El enlace sigue aquí por si quieres intentarlo otra vez.';
  }
  function reset(): void {
    cancel(); generation++; configRequest?.abort(); configRequest = null;
    enabled = false; button.disabled = true; code.value = '';
    $('#import-access').hidden = true; status.textContent = '';
  }
  async function refresh(): Promise<void> {
    configRequest?.abort(); const controller = new AbortController(); configRequest = controller;
    const token = generation;
    enabled = false; button.disabled = true; status.textContent = 'Comprobando la importación…';
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch('/api/youtube', { headers: headers(), cache: 'no-store', signal: controller.signal });
      if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error();
      const data = await response.json() as { enabled?: unknown; authorized?: unknown };
      if (token !== generation || controller !== configRequest) return;
      enabled = data.enabled === true;
      $('#import-access').hidden = !enabled || data.authorized === true;
      status.textContent = enabled ? 'Obtén el audio y luego elige el fragmento. Videos de hasta 10 minutos; audio de hasta 4 MB.' : 'La importación no está activada en esta instalación. Puedes agregar un archivo o guardar solo el enlace.';
    } catch {
      if (token !== generation || controller !== configRequest) return;
      status.textContent = navigator.onLine ? 'La importación no está disponible aquí. Puedes agregar un archivo o guardar solo el enlace.' : 'Necesitas conexión para obtener el audio. Tus sonidos guardados siguen disponibles.';
    } finally { clearTimeout(timer); if (token === generation && controller === configRequest) { configRequest = null; button.disabled = !enabled; } }
  }
  async function start(): Promise<void> {
    if (request) return;
    options.onError(null);
    try { youtubeId($<HTMLInputElement>('#sound-url').value); }
    catch { options.onError(new Error('Pega un enlace de YouTube válido.'), '#sound-url'); return; }
    if (!enabled) { options.onError(new Error('La importación no está disponible. Puedes agregar un archivo o guardar solo el enlace.')); return; }
    if (!codeValue()) { $('#import-access').hidden = false; options.onError(new Error('Introduce tu código de acceso para importar.'), '#import-access-code'); return; }
    const controller = new AbortController(); request = controller;
    const token = generation;
    const timer = setTimeout(() => controller.abort(new Error('timeout')), 110_000);
    busy(true);
    try {
      const response = await fetch('/api/youtube', { method: 'POST', headers: headers(),
        body: JSON.stringify({ url: $<HTMLInputElement>('#sound-url').value }), signal: controller.signal });
      if (!response.ok) {
        if (response.status === 401) { rememberCode(''); $('#import-access').hidden = false; }
        let message = 'No pudimos obtener el audio. No se guardó ningún sonido.';
        try { const data = await response.json() as { error?: unknown }; if (typeof data.error === 'string') message = data.error; } catch { /* Static hosts can respond with HTML. */ }
        throw new Error(message);
      }
      if (!response.headers.get('Content-Type')?.startsWith('audio/mpeg') || !response.body) throw new Error('La importación no devolvió un archivo de audio válido.');
      if (Number(response.headers.get('Content-Length')) > LIMIT) { await response.body.cancel(); throw new Error('El audio supera 4 MB. Prueba con un video más corto.'); }
      const reader = response.body.getReader(); const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length; if (size > LIMIT) throw new Error('El audio supera 4 MB. Prueba con un video más corto.');
          chunks.push(new Uint8Array(value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (!size) throw new Error('El archivo llegó vacío. Prueba con otro enlace.');
      if (token !== generation || controller.signal.aborted) return;
      let name = 'Sonido de YouTube';
      try { name = decodeURIComponent(response.headers.get('X-Tapzi-Title') ?? name).slice(0, 60); } catch { /* Keep the fallback name. */ }
      rememberCode(codeValue()); options.onFile(new File(chunks, `${name}.mp3`, { type: 'audio/mpeg' }));
    } catch (error) {
      if (token === generation) options.onError(controller.signal.aborted ? new Error('La importación tardó demasiado. Inténtalo más tarde; no se guardó ningún sonido.') :
        error instanceof TypeError ? new Error('Se perdió la conexión. No se guardó ningún sonido; puedes volver a intentarlo.') : error);
    } finally { clearTimeout(timer); if (token === generation) { request = null; busy(false); } }
  }
  button.addEventListener('click', () => void start());
  $('#cancel-youtube-import').addEventListener('click', cancel);
  return { reset, cancel, refresh, start };
}
