# Importar YouTube en Vercel

Tapzi puede recibir un enlace, obtener un MP3 mediante TUBE MP3 y abrirlo en su editor. El usuario escucha, recorta si quiere y confirma **Guardar sonido**. Los bytes se guardan en IndexedDB; la reproducción posterior funciona sin conexión. No se conserva la URL temporal del proveedor como sonido.

La integración está implementada y comprobada con respuestas controladas y audio sintético real. **Todavía no se ha probado una conversión con una clave real del proveedor ni desplegado en Vercel.** La documentación de una API no garantiza que todos los videos se puedan descargar.

## Activar

1. Revisa [TUBE MP3 en RapidAPI](https://rapidapi.com/tubemp3-tubemp3-default/api/tube-mp31) y su [contrato documentado](https://www.apiyt.cc/dev/en/). Verifica precio, cuota y cargos por excedentes **antes** de activar. No se ha contratado ningún plan, y no se presupone que exista una cuota gratuita suficiente.
2. Importa este repositorio en Vercel como proyecto Vite. `vercel.json` configura el build, `dist/` y la función `api/youtube.ts`; no requiere Docker, Coolify, FFmpeg, yt-dlp ni una base de datos remota.
3. Añade las variables siguientes solo al entorno del servidor. Nunca deben llevar prefijo `VITE_` ni guardarse en Git:

| Variable | Valor |
| --- | --- |
| `RAPIDAPI_KEY` | Clave con acceso a **TUBE MP3** (`tube-mp31`); otra API de RapidAPI puede usar un contrato diferente. |
| `TAPZI_IMPORT_ACCESS_CODE` | Código privado aleatorio de al menos 32 caracteres. Protege el uso de la importación. |
| `TAPZI_APP_ORIGIN` | Origen exacto si usas dominio propio: `https://tapzi.example`, sin `/` final. Vercel aporta automáticamente sus URLs de despliegue y producción. |

Puedes generar el código privado con:

```sh
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

4. Despliega. Abre **Agregar sonido → Enlace de YouTube**, pega un enlace y tu código privado. Se recuerda en `sessionStorage` de esa pestaña; no es la clave de RapidAPI. Si el navegador elimina la sesión, vuelve a introducirlo.
5. Prueba un video corto: obtener → escuchar → guardar → volver a abrir → modo avión → reproducir. Comprueba además los contadores de cuota del proveedor. No consideres terminada la validación hasta obtener bytes reproducibles de un enlace real.

Si no tienes un plan compatible con tu presupuesto, deja `RAPIDAPI_KEY` vacía. La app explica que la importación está inactiva y mantiene **Guardar sin descargar**, los archivos locales y toda la colección existente.

## Desarrollo local

Copia `.env.example` a `.env.local`, configura las variables y reinicia `npm run dev`. Vite monta el mismo handler que Vercel, sin exponer variables al frontend. En `localhost` se acepta automáticamente el origen local; para un dominio o proxy HTTPS configura `TAPZI_APP_ORIGIN`.

El backend antiguo `/api/import-audio` con yt-dlp es independiente y sigue desactivado salvo opt-in explícito; ver [importing.md](importing.md).

## Límites y comportamiento

- Una solicitud explícita al proveedor por intento; no se convierte al pegar, escribir o previsualizar el formulario. No hay reintentos automáticos que puedan duplicar consumo.
- Videos con duración informada de hasta 10 minutos. El MP3 completo debe caber en **4 MiB**, por debajo del límite de respuesta de [Vercel Functions](https://vercel.com/docs/functions/limitations). La API elegida no documenta recorte remoto: primero se obtiene el archivo y luego se recorta en el teléfono. Un fragmento pequeño de un archivo demasiado grande no evita este límite.
- Hasta 100 segundos en el servidor y 110 en el cliente. La función tiene un máximo de 120 segundos. Cancelar aborta nuestras solicitudes y evita guardar resultados tardíos; el proveedor podría haber iniciado o contabilizado el trabajo.
- El recorte conserva los límites del editor existente (hasta 120 segundos por fragmento convertido). Guardar el archivo completo no requiere conversión.
- Un trabajo simultáneo y cinco intentos por minuto **por instancia**. Vercel puede crear varias instancias: esto no es un límite mensual ni una garantía de gasto. La cuota y el corte de excedentes deben configurarse con el proveedor.
- Solo se admiten enlaces YouTube validados. El servidor envía únicamente su ID a un endpoint fijo. Ni el endpoint del proveedor ni las URLs de descarga se aceptan desde el cliente.
- Las descargas verifican HTTPS, direcciones IPv4 públicas y cada redirección. La conexión fija la IP resuelta conservando la validación TLS del hostname, para evitar DNS rebinding. CDN solo IPv6 no soportado por este adaptador.
- JSON, tamaño descargado y tiempo están acotados. No se siguen redirecciones con credenciales del proveedor. Las respuestas no se cachean; los errores no exponen mensajes o claves del proveedor.
- Acceso privado por código, comparación de hashes en tiempo constante y comprobación de origen para POST. Las claves no forman parte del bundle ni de los backups.

El archivo estático `.cache/tapzi-web.zip` permite usar archivos y enlaces online en cualquier hosting. **Para activar esta importación en Vercel hay que desplegar el repositorio completo**, incluida la carpeta `api/`; subir solo `dist/` no instala la función.

## Verificación

`npm test` cubre contrato, errores, acceso, origen, límites, DNS, redirecciones, cancelación y concurrencia con proveedores simulados. `npm run test:browser` usa un MP3 sintético para comprobar descarga simulada, metadata real, recorte, guardado, reproducción y rechazo de respuestas tardías o fallidas. No consume cuotas de servicios externos. La validación física en Safari/iPhone sigue siendo necesaria.
