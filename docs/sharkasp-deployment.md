# Despliegue de Oportuna en SharkASP

## Dos runtimes distintos

El Node App que existe para `luminiadev-001-site5` es el proceso de Node bajo IIS: el archivo de inicio esperado es `sharkasp-bootstrap.mjs`. Ese bootstrap y `argon2` requieren Windows x64. El workflow de preparación usa un runner `windows-2022`, instala dependencias una vez con `npm ci`, compila y prueba el módulo nativo Argon2 en Windows. No ejecuta `npm ci` después de un `npm install` de Railpack.

El intento de GitHub Deploy mostrado en la evidencia ejecutó Railpack en Linux/Node 22. Ese entorno no es el runtime del Node App IIS; el build terminó además con `EBUSY` al retirar `.vite`. No se debe volver a usar Railpack para este sitio. Desactiva o desconecta GitHub Deploy/Railpack en el panel antes de enlazar `main` a otro flujo. La guía oficial del proveedor para Node GitHub Deploy describe **Deploy Now**; no documenta un trigger push de Actions ni una API Node específica ([GitHub Deploy de Node.js](https://www.sharkasp.net/support/kb/a2332/how-to-deploy-node_js-to-our-server-from-a-github-repository.aspx)).

La guía oficial de Express usa IIS con `httpPlatformHandler`, y la guía de Node permite seleccionar la carpeta desde **Websites → Manage Website → Node.js** ([Express en IIS](https://www.sharkasp.net/support/kb/a2228/how-to-publish-an-expressjs-application-to-your-hosting-account.aspx), [habilitar Node.js](https://www.sharkasp.net/support/kb/a2383/how-to-enable-node_js-to-certain-folders-from-your-hosting-account.aspx)). El artículo genérico de Actions presenta FTP y Web Deploy, pero el ejemplo Web Deploy es para ASP.NET; no confirma que una operación `msdeploy` recicle este Node App ([GitHub Actions genérico](https://www.sharkasp.net/support/kb/a2275/how-to-use-github-actions-to-auto-publish-your-website-file-to-our-server_.aspx)). La opción Windows x64 y Web Deploy es la única que coincide con el runtime del repositorio; la publicación automática queda apagada hasta que SharkASP confirme ese contrato para este sitio.

## Qué automatiza el repositorio

1. `CI` corre en pull requests y pushes a `main`, con verificaciones Linux existentes y una segunda compilación en Windows x64 que valida Argon2 nativo.
2. Al terminar con éxito `CI` en `main`, `Oportuna SharkASP Windows release preparation` vuelve a comprobar tipos, pruebas y build sobre el mismo commit, instala dependencias una vez en Windows, poda las dependencias de desarrollo y prepara el artefacto Windows. El artefacto excluye `web.config`, `.env`, archivos de base de datos y archivos de secretos.
3. La preparación no transfiere archivos, no reinicia Node, no consulta ni migra MySQL y no reporta que producción fue publicada.

El workflow usa el build exitoso de `CI` como condición, y solo toma el SHA exacto de un push propio de `main`. No se deben conectar los pasos del build a una publicación Railpack.

## Bloqueo pendiente antes de habilitar publicación

El repositorio ya contiene credenciales Web Deploy de SharkASP. Se comprobó únicamente que existen; sus valores no se leyeron ni se imprimirán. El workflow previo de reparación intentó una simulación Web Deploy para `luminiadev-001-site5` y recibió un error genérico del servidor remoto antes de cualquier escritura. Por lo tanto, no está confirmado que la operación de publicación funcione con el proveedor `iisApp`/ruta de este sitio.

La documentación oficial aclara que **Advanced Tools → Pool Manager → Environment Variables** configura variables a nivel del IIS Application Pool; todos los sitios que comparten ese pool pueden leerlas. El historial local de Oportuna identifica que cinco sitios comparten `luminiadev-001`. Por eso no se deben añadir secretos de Oportuna a ese pool compartido. SharkASP documenta que un pool dedicado aísla un sitio y puede tener sus propias variables y reciclarse desde **Advanced Tools → Pool Manager** ([variables de entorno](https://www.sharkasp.net/support/kb/a2437/how-to-set-environment-variable-for-your-account.aspx), [pool dedicado](https://www.sharkasp.net/support/kb/a2440/why-use-a-dedicated-application-pool-for-each-website.aspx)).

La documentación oficial de Node confirma que el proceso se ejecuta mediante IIS `httpPlatformHandler` ([Node.js ejecutable/IIS](https://www.sharkasp.net/support/kb/a2471/how-to-use-a-custom-node_js-executable.aspx)). **Inferencia:** reciclar el pool dedicado debería detener/reiniciar el worker IIS y su proceso Node hijo. No se va a automatizar desde Actions hasta que SharkASP confirme que la cuenta puede reciclar el pool correcto sin afectar otros sitios y se valide el reinicio para este Node App. La versión Node x64 del proceso IIS tampoco queda confirmada; Node 22 en la evidencia es Railpack/Linux.

Antes de añadir una etapa que escriba, soporte SharkASP debe confirmar para `luminiadev-001-site5`:

- una operación de publicación por Web Deploy compatible con este Node App y su ruta física, probada con `-whatif` exitoso;
- confirmación de que el Node App puede asignarse a un pool dedicado y que reciclar ese pool reinicia `httpPlatformHandler` sin interrumpir los otros sitios;
- Node.js y arquitectura instalados en ese Node App;
- confirmación de las variables que sobreviven a un recycle/redeploy en ese pool dedicado.

Hasta entonces, un error en una prueba de publicación no puede llevar a un estado verde ni a una falsa afirmación de éxito. No se añadió un workflow que sincronice archivos a ciegas.

## Configuración requerida cuando el proveedor confirme el contrato

- Crea **Settings → Environments → `production`**, restringe despliegues a `main` y exige revisión humana. El environment `production` no existe actualmente en GitHub.
- Mantén las credenciales existentes `SHARKASP_LICIAPP_WEBDEPLOY_USERNAME` y `SHARKASP_LICIAPP_WEBDEPLOY_PASSWORD`; no es necesario recrearlas mientras el proveedor confirme que están limitadas al sitio.
- Asigna el sitio a un pool dedicado desde **Advanced Tools → Pool Manager** antes de añadir variables runtime. No uses el pool actual compartido para credenciales. La configuración de variables se hace en **Advanced Tools → Pool Manager → Actions → Environment Variables**; el bootstrap reporta nombres faltantes sin revelar valores. La validación espera `APP_ENV`, `NODE_ENV`, `PROCESS_ROLE`, `HOST`, `CLIENT_ORIGIN`, `TRUST_PROXY_HOPS`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`, `DB_SSL_MODE`, `DB_SSL_CA`, `DB_SSL_CA_SHA256`, `MERCADOPUBLICO_TICKET`, `SYNC_API_TOKEN`, `EMAIL_TRANSPORT`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_HELO_NAME` y `SMTP_TIMEOUT_MS` según el modo TLS y correo.
- El Node App debe seguir usando `sharkasp-bootstrap.mjs` como archivo de inicio. No reemplaces `web.config` desde el paquete. El despliegue preparado incluye una validación de arranque que falla cerrada si faltan variables o si el runtime no es Windows x64.

Los nombres y ejemplos ficticios están en [`.env.example`](../.env.example). Ese archivo sirve para desarrollo; no se debe subir al hosting ni tratarlo como almacén de secretos.

## Smoke y recuperación

Después de confirmar publicación y reinicio, el smoke debe exigir HTTPS, HTML React y los bundles JS/CSS referenciados por `/`, una ruta SPA, y JSON válido en `/api/health` con MySQL saludable. Si falla, se debe devolver fallo en Actions y restaurar únicamente los archivos de la aplicación respaldados antes del deploy. No se debe ejecutar ni revertir migraciones. La comprobación real de esos pasos requiere el contrato del proveedor; no se ha ejecutado contra producción en este cambio.

Para la intervención manual en SharkASP, abre el Hosting Control Panel → **Advanced Tools → Pool Manager**, selecciona el pool dedicado que se asigne a `luminiadev-001-site5` y usa su acción **Recycle**; si debes revisar el archivo de inicio, abre **Websites → Manage Website → Node.js** y conserva `sharkasp-bootstrap.mjs`. No uses el recycle del pool compartido. El proveedor debe confirmar el nombre/alcance del pool dedicado de este sitio antes de una publicación.
