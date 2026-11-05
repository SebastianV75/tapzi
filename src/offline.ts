interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
export function setupOffline(canUpdate: () => boolean): void {
  const status = document.querySelector<HTMLElement>('#offline-status')!;
  const install = document.querySelector<HTMLButtonElement>('#install-app')!;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); install.hidden = false;
    install.onclick = () => { void (event as InstallEvent).prompt(); };
  });
  window.addEventListener('appinstalled', () => { install.hidden = true; });
  if (!import.meta.env.PROD) { status.textContent = 'Modo de desarrollo. La versión publicada habilita el uso sin conexión.'; return; }
  if (!window.isSecureContext || !('serviceWorker' in navigator)) { status.textContent = 'Para instalar y abrir sin conexión, abrí Tapzi desde una dirección HTTPS.'; return; }
  void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(async registration => {
    const offerUpdate = (): void => {
      // A first install also passes through `waiting`; only an existing controller means there is an older version to replace.
      if (!registration.waiting || !navigator.serviceWorker.controller) return;
      document.querySelector<HTMLElement>('#update-banner')!.hidden = false;
      document.querySelector<HTMLButtonElement>('#apply-update')!.onclick = () => {
        if (!canUpdate()) { status.textContent = 'Terminá de editar o detené la reproducción antes de actualizar.'; document.querySelector<HTMLElement>('#update-banner')!.firstChild!.textContent = 'Cerrá el editor y detené la reproducción para actualizar. '; return; }
        // Another tab may have already applied this update.
        if (!registration.waiting) { location.reload(); return; }
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
        registration.waiting.postMessage('SKIP_WAITING');
      };
    };
    offerUpdate(); registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', offerUpdate);
    });
    await navigator.serviceWorker.ready;
    status.textContent = 'Lista sin conexión. Los audios guardados funcionan sin internet; YouTube necesita conexión.';
  }).catch(() => { status.textContent = 'No se pudo preparar el modo sin conexión. Revisá tu conexión y volvé a abrir Tapzi.'; });
}
