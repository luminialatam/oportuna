# Diagnóstico de errores HTTP 503/502 en SharkASP

## Evidencia histórica del 503 en deploy #3987942

El registro de GitHub Deploy muestra Railpack 0.35 / Node 22 como **constructor**: ejecuta instalación, `npm run build` y el comando de deploy `npm start`, crea el artefacto y lo copia por SCP a `H:\root\home\luminiadev-001\www\liciapp`. Después informa que recicló el pool IIS `luminiadev-001` y marca el paso de copia como exitoso. El registro no demuestra que Node iniciara ni que una solicitud llegara a Express. Por eso “Éxito” aquí significa deploy/copia, no disponibilidad.

La inspección de solo lectura del sitio encontró:

- `/Liciapp/app_offline.htm` presente, vacío (0 bytes), fechado al terminar ese deploy.
- **Node.js Application** habilitado, pero el campo **Application startup file** estaba vacío.
- El `web.config` instalado solo contiene reglas SPA y un bloque `<handlers>` vacío; no enruta solicitudes a Node.
- `GET /` y `GET /api/health` en ambos dominios responden `503`, `Retry-After: 3600`, `Server: Microsoft-IIS/10.0`, cuerpo vacío. La API real devuelve JSON; no se observó que la solicitud alcanzara Express.
- El editor de variables `.env` de GitHub Deploy estaba vacío. Esto no confirma si hay configuración en un almacén distinto del panel, y no explica el 503 actual mientras las solicitudes no alcanzan Node. No se leyeron valores secretos.
- El registro IIS HTTP detallado no estaba copiado al espacio de archivos y no se pudo consultar el subestado IIS. No se hizo ninguna acción de arranque, recicle, edición o despliegue para aislarlo.

**Conclusión con límite explícito:** la causa inmediata comprobada es que el 503 sale de IIS antes de Express. Hay dos bloqueos visibles compatibles con ello: el archivo offline vacío en la raíz IIS y la aplicación Node sin archivo de inicio/ruta de handler configurados. No puede afirmarse cuál de los dos produce el subestado 503 exacto sin los logs IIS o una reactivación controlada. La documentación de Microsoft confirma que `app_offline.htm` detiene y reemplaza las respuestas de una app cuando lo procesa ASP.NET Core Module; el sitio observado es Node/IIS y no se confirmó que ese módulo sea el que atiende este sitio, por lo que esa semántica no se da por demostrada aquí. [Referencia Microsoft](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/aspnet-core-module?view=aspnetcore-10.0).

MySQL, Argon2 y las variables de `runtimeConfig` no son causas probadas del 503 observado: todavía no hay evidencia de una ejecución de Express. El endpoint `/api/health` responde JSON desde Express aun cuando MySQL no está disponible; la respuesta vacía de IIS descarta que se haya observado ese handler.

## Ruta de ejecución respaldada por la evidencia

Railpack Linux/Node 22 sí aparece en los logs, pero como constructor. El mismo registro copia los archivos a una ruta física Windows y recicla un app pool IIS. En el sitio existente, el runtime que debe recibir tráfico es **Node.js Application bajo IIS**, no un contenedor Linux. El build de este PR sigue ejecutándose en Linux; sus dependencias Argon2 incluyen el prebuild N-API para Windows x64 y CI ahora comprueba que esté presente. El bootstrap comprueba Windows x64, carga el archivo privado externo ya previsto y arranca `dist-server/server/src/index.js` con el puerto IIS.

El campo **Comando de construcción / Build Command** de GitHub Deploy debe ser `npm run build` (no ejecutar `npm ci` ni reinstalar dependencias ahí). El valor observado de **Comando de inicio / Start Command** es `npm start`, pero el deploy log no prueba que este proceso atienda IIS. En **Websites → luminiadev-001-site5 → More Features → Node.js Application**, el campo separado **Application startup file** debe ser `sharkasp-bootstrap.mjs` en la raíz de `/Liciapp`. El bootstrap de la raíz es la entrada real de IIS; no redirige a `deploy/sharkasp/sharkasp-bootstrap.mjs`, que conserva un propósito de staging independiente.

Al guardar el campo, SharkASP debe generar el handler de `httpPlatform` en `web.config`; el template esperado está en `deploy/sharkasp/web.config.production.template`. El `web.config` leído durante este diagnóstico solo tenía reglas SPA y handlers vacíos, por lo que no conectaba IIS con Node. No editar ni forzar el `web.config` de producción desde este PR.

El bootstrap de `deploy/sharkasp/sharkasp-bootstrap.mjs` fija parámetros de *staging* y lee un archivo externo de secretos; no debe usarse como arranque de producción. `sharkasp-bootstrap.mjs` en la raíz no fija destino de base de datos ni lee ese archivo: valida `runtimeConfig` y utiliza el entorno inyectado al Node App. Entre los nombres requeridos por el runtime están `APP_ENV`, `NODE_ENV`, `PROCESS_ROLE`, `CLIENT_ORIGIN`, `TRUST_PROXY_HOPS`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL`, `MERCADOPUBLICO_TICKET` y `SYNC_API_TOKEN`. El modal `.env` de GitHub Deploy no mostraba entradas; no se deben asumir como disponibles ni imprimir valores. No se cambian variables desde este PR.

## Smoke test de solo lectura

La prueba automatizada `npm run test:sharkasp-smoke` usa servidores HTTP locales y verifica que:

- rechace el `503` con cabeceras IIS observado tanto en `/` como en `/api/health`;
- solo considere saludable HTML, los bundles compilados y `/api/health` en JSON con el contrato esperado.

Para una futura comprobación real, después de una activación autorizada, definir `SHARKASP_SMOKE_URL` con el origen HTTPS y ejecutar `npm run smoke:sharkasp`. Hace únicamente GET a `/`, assets y `/api/health`; no autentica, modifica datos ni migra. El `mysql:false` del endpoint se informa por separado y no se confunde con que Node esté disponible.

## Estado y siguiente paso

No se desplegó, reinició, recicló ni modificó el sitio en este diagnóstico. La activación del proceso no puede automatizarse con la evidencia disponible: GitHub Deploy solo registró el recycle del pool y el campo Node startup está fuera del repositorio. El único paso manual de recuperación será una intervención en [SharkASP Control Panel](https://member10.sharkasp.net/panel_cp?section=websites) → **Websites → luminiadev-001-site5 → More Features → Node.js Application**: configurar `sharkasp-bootstrap.mjs` en **Application startup file**, asociar al proceso los nombres de variables requeridas indicados arriba desde la configuración segura existente y retirar el archivo vacío `/Liciapp/app_offline.htm`. Esto puede iniciar el proceso, por lo que no se hizo bajo la restricción de esta tarea. Luego ejecutar el smoke HTTPS. No afirmar disponibilidad antes de obtener HTTP 200 de `/`, los assets y `/api/health`.

No se debe volver a desplegar desde una receta que mezcle el artefacto Windows/IIS con un comando de inicio Railpack Linux. El comando de build `npm run build` sí evita la doble instalación; el arranque de IIS lo controla el campo **Application startup file**, no el comando `npm start` del constructor.

## Diagnóstico de correo

El proceso necesita `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD` y `SMTP_FROM`; `SMTP_PORT`/`SMTP_SECURE` deben concordar (465/TLS o 587/STARTTLS). No guardes esos valores en el repositorio o logs. El endpoint administrativo `POST /api/platform/email/smtp-check` requiere una sesión de administrador de plataforma y CSRF; prueba conexión y autenticación sin enviar correo, y devuelve únicamente un estado/código sanitizado. Un resultado correcto no demuestra entrega a una bandeja.

Si el registro concluyó en error en una versión anterior, la fila de usuario pudo haberse confirmado antes de fallar SMTP. No se inspeccionó ni modificó la base productiva para averiguarlo. Con el flujo corregido, si esa cuenta está pendiente, la persona inicia sesión con la contraseña que eligió; recibe una sesión limitada a verificación y puede pulsar **Reenviar enlace**. La repetición del registro no duplica la cuenta. La recuperación de contraseña conserva respuesta neutral, aunque el log operativo registra solo `purpose` y un código como `SMTP_TIMEOUT`, `SMTP_CONNECTION_FAILED` o `SMTP_5xx`.

## Diagnóstico reproducible del 502 en Node.js Application

El log de deploy `#3988392` confirma recycle, extracción del artefacto y actualización de `web.config`; no registra que el proceso Node haya iniciado ni que el health check haya pasado. HTTP Platform Handler exige que el proceso hijo escuche el puerto asignado en `HTTP_PLATFORM_PORT` y que IIS pueda conectarse a ese listener. La app usa `PORT` como alias; el bootstrap de la raíz copia primero `HTTP_PLATFORM_PORT` a `PORT` y fija el bind en `127.0.0.1`. [La referencia oficial de IIS](https://learn.microsoft.com/en-us/iis/extensions/httpplatformhandler/httpplatformhandler-configuration-reference) documenta este módulo como gestor de procesos HTTP que también proxya las solicitudes al listener administrado.

`sharkasp-bootstrap.mjs` ahora emite etapas de inicio sanitizadas y códigos concretos para puerto dinámico inválido, archivos de build faltantes, `runtimeConfig` inválido, carga de Argon2 e importación del servidor. No imprime variables ni sus valores. `server/test/iisRuntime.integration.mjs` arranca el artefacto realmente producido por la instalación Linux sobre un runner Windows x64, comprueba que el prebuild Argon2 funcione en ese runtime, da a `HTTP_PLATFORM_PORT` un puerto distinto de `PORT`, y verifica el listener, HTML, bundles y `/api/health`. Usa configuración ficticia y MySQL solamente en `127.0.0.1:1` (sin datos ni servidor productivo).

CI materializa la raíz del sitio desde ese artefacto Linux y aplica como `web.config` el template versionado `deploy/sharkasp/web.config.production.template`; valida XML, handler, archivo de inicio, puerto y bind antes de iniciar Node. El template reserva 60 segundos para el arranque y enruta todas las solicitudes a `sharkasp-bootstrap.mjs`.

Límite de la reproducción: GitHub no ejecuta el HttpPlatformHandler instalado en SharkASP ni captura el `web.config` final que el panel genera. El CI prueba el contrato versionado y hace la misma solicitud HTTP al puerto local dinámico; no afirma que el IIS de producción ya pueda alcanzar el proceso. Para confirmar o descartar que el proveedor sobrescriba un atributo distinto del template hace falta el archivo final o un smoke HTTPS posterior a una publicación autorizada. El estado SUCCESS de copia no es ese smoke.

La corrida CI `43983422158` pasó los tres jobs. En particular, el artefacto instalado en Linux ejecutó Argon2id y el bootstrap sobre Windows Server 2025 x64, y atendió `/`, bundles y `/api/health` en un puerto dinámico distinto de `PORT`. Esto descarta, para el artefacto reproducido, que la instalación Linux por sí sola vuelva incompatible el prebuild Argon2 Windows o que el bootstrap ignore el puerto dinámico. No se obtuvo el artefacto exacto de `#3988392` ni el `web.config` final generado por SharkASP, así que el 502 de producción sigue sin causa inequívoca: la diferencia de runtime/configuración del panel sigue siendo posible y no se puede afirmar corregida sin un smoke HTTPS real.
