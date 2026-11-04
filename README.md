# Tapzi

Tu botonera personal de bolsillo. Web estática en TypeScript: **sin cuentas, API de conversión, servidor de audio ni suscripciones**. Diseñada para instalar en el iPhone y reproducir la colección sin conexión.

## Usarla

1. Toca **Agregar sonido → Seleccionar archivo** y elige un audio o video. También puedes arrastrarlo al selector desde una computadora.
2. El nombre se sugiere automáticamente. Escúchalo y guarda directamente, o abre **Recortar** para arrastrar inicio/final. Los segundos exactos y el color son opcionales.
3. Guarda y toca la tarjeta para reproducir. El reproductor inferior permite pausar, continuar, repetir y moverse por el audio. Otro toque en la tarjeta lo detiene.
4. La estrella lo agrega a favoritos; **···** permite editar, compartir o eliminar con deshacer. Cerrar un sonido sin guardar pregunta antes de descartar.
5. En **ajustes**, guardá una copia `.tapzi`. Incluye audios, nombres, colores y favoritos. Restaurar agrega lo que falta sin reemplazar los sonidos existentes.

La botonera comienza vacía. **Probar con tres sonidos** crea tres tonos originales localmente; no descarga contenido de terceros.

**YouTube** es una opción online separada: guarda un enlace y usa el reproductor visible. No descarga audio, necesita internet y algunos videos restringen su reproducción. Los sonidos guardados en versiones anteriores se conservan.

## Ejecutar y verificar

Node.js 22.18+ y npm:

```sh
npm ci
npm run dev
```

Para la versión instalable y offline:

```sh
npm run build
npm run preview
```

El modo offline se habilita en la compilación de producción, no en el servidor de desarrollo.

```sh
npm test                 # validación, backups, WAV y pruebas del importador heredado
npm run typecheck
npm run build
npm run test:browser     # requiere el build y Chromium
```

`CHROMIUM=/ruta/a/chromium` permite elegir el ejecutable. Las pruebas usan perfiles descartables, archivos sintéticos y un servidor local temporal. Verifican recorte real de WAV, extracción de audio AAC de un MP4, reproducción, persistencia, edición, borrado/deshacer, restauración, protección contra duplicados, y tamaños de 320 a 1280 px. También verifican el selector progresivo, límites que no se cruzan, protección del borrador, cambio de archivo conservando el nombre, recortes de 50 ms, pausa inmediata sin errores y controles de reproducción. En producción se comprueban el selector de archivos y el teclado nativo para recortar. El test de producción abandona la página y vuelve a abrirla con la red desactivada, verificando reproducción desde IndexedDB. YouTube usa un doble de prueba; no hay conversiones ni solicitudes a proveedores externos durante los tests.

## Publicar sin backend

El resultado completo está en **`dist/`**. Publicá su contenido en la raíz de cualquier alojamiento estático con **HTTPS**. No requiere Node, Docker, Coolify, Dokploy, variables secretas o una base de datos en el alojamiento. El sitio se necesita para la primera apertura y las actualizaciones; después de «Lista sin conexión», los audios guardados y la app funcionan offline.

- Servir `.js` con tipo JavaScript y `.webmanifest` como JSON/manifest.
- Evitar caché prolongada para `sw.js` e `index.html`; los archivos en `assets/` tienen nombres con hash y pueden usar caché inmutable.
- Publicar la carpeta completa de manera atómica. No agregar un fallback HTML para archivos JS faltantes.
- Esta configuración usa la raíz `/`, no un subdirectorio.
- No abrir `index.html` con `file://`. En el iPhone, HTTP por una IP local no habilita service workers; se necesita HTTPS. `localhost` sirve para las pruebas de escritorio.

No se ha publicado una nueva URL ni contratado servicios como parte de esta entrega.

## Instalar en iPhone

1. Abrí la URL HTTPS en Safari.
2. **Compartir → Agregar a pantalla de inicio → Agregar**.
3. Abrí Tapzi desde el icono y esperá **Lista sin conexión**.
4. Importá tus sonidos allí. Para mover una colección que ya estaba en Safari, exportá y restaurá una copia desde ajustes.
5. Probá modo avión: cerrá Tapzi, volvé a abrirla y reproducí un sonido local.

El almacenamiento pertenece al navegador/app instalada y al origen. iOS puede eliminar datos bajo presión de espacio; borrar datos del sitio también borra la colección. La app solicita persistencia cuando el navegador lo permite, pero **una copia en Archivos es el respaldo durable**. No hay sincronización automática.

## Archivos y límites

- Entradas de audio/video: hasta 50 MB. Audios guardados: hasta 25 MB por sonido.
- Un audio completo compatible se conserva sin conversión. Recortes y videos se decodifican en el dispositivo y se guardan como WAV, hasta 120 segundos; el archivo fuente para conversión debe durar como máximo 10 minutos.
- Soporte de formatos según el navegador: MP3, WAV, M4A y MP4 con AAC son los candidatos principales. Un contenedor de video no garantiza que su códec esté soportado. Un fallo muestra un mensaje y no guarda un registro incompleto.
- Backups: hasta 200 MB y 1000 sonidos. Formato binario versionado, sin base64 ni descompresión. Se valida antes de una única transacción de restauración.
- El service worker solo guarda los archivos de la interfaz. Los audios viven en IndexedDB; no se cachean YouTube ni APIs.
- Las actualizaciones se anuncian y se aplican cuando no hay reproducción ni editores abiertos. No borran la colección.

**Pendiente de aceptación física:** Safari/iPhone, audio audible, hoja de compartir/Archivos, instalación y formatos de los videos reales del usuario. Las pruebas de Chromium no sustituyen esa comprobación.

## Estructura

- `src/app.ts`: biblioteca, diálogos y gestión de colección.
- `src/clip-editor.ts`: selector progresivo, preescucha, límites visuales, reemplazo de archivo y forma de onda real opcional (archivos cortos de hasta 8 MB).
- `src/media.ts`: límites, extracción/recorte con Web Audio y codificador WAV.
- `src/storage.ts`: IndexedDB y restauración atómica.
- `src/backup.ts`: formato `.tapzi`, validación y empaquetado.
- `src/player.ts`: reproducción local y reproductor online opcional.
- `src/offline.ts`, `vite.config.ts`: instalación, actualizaciones y service worker generado.

El importador anterior con yt-dlp se conserva como herramienta de desarrollo **desactivada por defecto**. No forma parte del flujo de la app ni del bundle estático. Su documentación histórica está en [docs/importing.md](docs/importing.md).

## Dirección visual

**Dirección acordada: identidad visual de [Pond Linux](https://www.butterfly.so/pond) combinada con interacción de Apple/iPhone.** El usuario reafirmó esta mezcla el 4 de noviembre de 2026: la versión 0.3 había perdido demasiado del carácter de Pond. Esta decisión debe guiar las siguientes iteraciones.

- **Pond:** fondo azul pálido `#e1ebf6`, tinta `#29312f`, lavanda `#d8bdf5` y lima `#d1e661`; títulos serif, detalles monoespaciados, líneas finas, numeración discreta y controles circulares. Los números mantienen su posición dentro de la colección al filtrar. Tipografías locales, sin copiar fuentes o ilustraciones de la referencia.
- **iPhone:** tipografía de sistema en los controles, selector segmentado, hojas inferiores redondeadas, cierre circular, ajustes agrupados y acciones al alcance del pulgar. Material translúcido limitado a los controles flotantes, con alternativa opaca. Áreas táctiles de 44 px, campos de 16 px, safe areas y respuesta inmediata al pulsar.
- **Flujo:** biblioteca sencilla, importar archivo → escuchar/recortar si hace falta → guardar. Conservar la protección del borrador, los controles nativos accesibles, la navegación por teclado y las preferencias de movimiento/transparencia/contraste.

Mantener el color y la tipografía editorial al simplificar: no volver a una interfaz enteramente gris ni convertir la app en una imitación del sistema operativo. Las referencias adicionales de calidad siguen siendo [Unslop](https://github.com/heydamir/unslop), UI Skills y Emil Kowalski. Iconos [Lucide](https://lucide.dev), licencia ISC; ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
