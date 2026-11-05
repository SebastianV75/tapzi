# Comprobación en tu iPhone

Estado: **pendiente de prueba física**. Chromium verifica los flujos y simula fallos, pero no demuestra el comportamiento del altavoz, Safari, Bluetooth ni la hoja de Archivos en un iPhone.

Usa la versión HTTPS que incluya estos cambios. Antes de empezar, exporta una copia de tu colección actual y comprueba que el archivo `.tapzi` aparezca en Archivos. No borres datos del sitio para hacer estas pruebas.

1. **Guardar y volver.** Agrega un audio real, escúchalo y cambia nombre/color. Cierra Tapzi y ábrela otra vez: el sonido y los cambios deben seguir allí. Tras actualizar, «Cargando tus sonidos…» debe resolverse sin tener que cerrar la app. Si la lectura falla, comprueba el reintento automático y el botón para volver a cargar la colección.
2. **Sin conexión.** Espera «Lista sin conexión», activa modo avión, cierra y vuelve a abrir Tapzi. Reproduce varios sonidos locales. Los enlaces de YouTube no forman parte de esta prueba.
3. **Bloqueo y cambio de app.** Reproduce, bloquea/desbloquea y vuelve. Repite cambiando a otra app. Si el sistema requiere interacción, Tapzi debe ofrecer Continuar conservando el sonido y la posición. Un sonido que pausaste debe seguir pausado al volver. No se promete reproducción continua en segundo plano.
4. **Salida de audio.** Prueba el altavoz con el interruptor de silencio en ambas posiciones. Si usas Bluetooth, prueba conectarlo/desconectarlo y vuelve a tocar un sonido. Verifica audio audible, no solo el indicador de reproducción.
5. **Exportación.** En ajustes, toca Guardar copia y cancela: la última exportación no debe cambiar. Repite y guarda en Archivos; comprueba nombre, tamaño y existencia del `.tapzi`. El estado de exportación no confirma que Archivos haya terminado de guardarlo.
6. **Cambios y restauración.** Edita un nombre: ajustes debe indicar cambios desde la exportación. Restaura la copia sin borrar nada: debe agregar solo IDs que falten, sin duplicar ni reemplazar los actuales. Para probar recuperar un eliminado, usa únicamente un sonido de prueba cuya copia ya hayas comprobado.
7. **Protección.** En ajustes → Acerca del almacenamiento, revisa el estado y solicita protección si está disponible. Una negativa debe mostrarse como tal y no impedir reproducir/exportar.

Registra versión de iOS, Safari o app instalada, tipo de archivo y paso exacto ante cualquier fallo. Safari y la app de pantalla de inicio pueden tener colecciones separadas; traslada la colección con exportar/restaurar.

La protección persistente reduce el borrado automático; borrar los datos del sitio sigue eliminando la colección. La copia externa es el respaldo. Referencias: [política de almacenamiento de WebKit](https://webkit.org/blog/14403/updates-to-storage-policy/) y [web apps de Apple](https://developer.apple.com/videos/play/wwdc2023/10120/).
