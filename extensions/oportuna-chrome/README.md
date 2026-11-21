# Extensión local de Oportuna para Mercado Público

La extensión funciona con la aplicación local en `http://127.0.0.1:5180` y `http://localhost:5180`.

1. En Chrome, abre `chrome://extensions` y activa **Modo de desarrollador**.
2. Pulsa **Cargar extensión sin empaquetar** y selecciona esta carpeta.
3. Abre una ficha pública de Mercado Público, pulsa el icono de la extensión y revisa el código detectado.
4. Pulsa **Abrir en Oportuna**, inicia sesión si se solicita, confirma la empresa activa y elige **Guardar en Seguimiento**.

La extensión solo inspecciona el contenido visible de la ficha pública de la pestaña activa cuando el usuario abre el popup. No accede a credenciales, cookies ni postulaciones. No incluye claves de API ni permisos para leer cookies.
