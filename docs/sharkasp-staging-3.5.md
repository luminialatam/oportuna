# Oportuna — preparación de staging en SharkASP (Fase 3.5)

> Addendum Fase 3.6: la carpeta `/Liciapp`, los entrypoints compilados, smoke sin credenciales y paquete Windows se detallan en [sharkasp-staging-3.6.md](./sharkasp-staging-3.6.md), que reemplaza las indicaciones iniciales de plantilla/paquete de este informe.

Estado: preparación local, sin acceso al panel, publicación ni importación de datos. HTTPS del dominio provisional se verificó de forma pública; no se usó el dominio HTTP con credenciales.

## Arquitectura objetivo

```text
Navegador HTTPS (origen único)
          │
          ▼
IIS / HTTP Platform Handler
          │ reenvía la solicitud y el puerto dinámico
          ▼
Node.js — PROCESS_ROLE=web
  ├── /api/* → rutas Express existentes
  ├── /api/health → estado sin secretos
  └── / y rutas SPA → dist/index.html y assets React
          │ TLS MySQL
          ▼
MySQL de staging independiente
```

Se mantiene frontend y API bajo el mismo origen. Eso conserva `fetch` con credenciales `same-origin`, cookies `__Host-`, y la validación actual de Origin/CSRF. Vite conserva su proxy local para desarrollo; no interviene en el sitio publicado.

En este proyecto no se debe configurar React en un alojamiento estático separado ni usar un `VITE_API_URL` cross-origin como atajo. La API debe ir exactamente bajo `/api/` en el mismo HTTPS origin que la aplicación. El proceso web Express sirve el build React y deja las rutas `/api/` a sus handlers.

## SharkASP: documentación pública consultada

La guía de SharkASP para Control Panel V10 explica cómo habilitar Node.js y configurar IIS `httpPlatform` para lanzar un ejecutable Node, usar un `PORT` dinámico (`HTTP_PLATFORM_PORT`) y reenviar el tráfico al proceso. La guía ilustra `node.exe` guardado en una carpeta protegida como `App_Data`; la versión y ruta deben obtenerse/confirmarse para la cuenta concreta. Esto da una vía técnicamente compatible con el servidor Express persistente para tráfico web, pendiente de comprobar en este sitio y su plan: [Node.js executable and HTTP Platform Handler](https://www.sharkasp.net/support/kb/a2471/how-to-use-a-custom-node_js-executable.aspx).

SharkASP anuncia soporte para Node.js, MySQL y SSL, pero esas afirmaciones de producto no confirman qué versiones, límites, certificado o facultades tiene el plan asociado a `luminiadev-001-site5`: [SharkASP hosting](https://www.sharkasp.net/).

La documentación pública indica publicación mediante Git, Web Deploy, FTP o Visual Studio y describe los datos para Web Deploy/FTP. No especifica un flujo Git de Node.js en esta cuenta; hace falta comprobar las opciones habilitadas en su panel. Las guías públicas son [Quick Start](https://sharkasp.net/support/kb/a1699/quick-start-guide.aspx) y [publicación con GitHub Actions, FTP o Web Deploy](https://www.sharkasp.net/support/kb/a2275/how-to-use-github-actions-to-auto-publish-your-website-file-to-our-server_.aspx). No existe repositorio Git local en este directorio, así que Git no es un canal disponible para este proyecto hasta que se configure por separado con autorización.

La programación simple de tareas del panel documentada por SharkASP llama una URL por GET, está disponible desde cierto plan, tiene frecuencia mínima de 15 minutos y cuota predeterminada; la tarea dedicada también llama una URL y tiene condiciones propias. Oportuna no dispone de endpoint GET de activación segura de workers y sus roles deben ejecutar procesos Node dedicados. Por ello, no se debe traducir el scheduler de Oportuna a una URL GET con secreto en query string ni activar esa función tal cual: [Schedule Tasks](https://www.sharkasp.net/support/kb/a2385/how-to-schedule-a-task.aspx), [Dedicated Task](https://www.sharkasp.net/support/kb/a2366/dedicated-task-add-on.aspx).

SharkASP anuncia SSL y Let's Encrypt, pero el certificado para el URL temporal no está confirmado. Parte de su documentación de SSL especifica que un certificado debe coincidir con un dominio registrado. No se presume que el temporal `*.ltempurl.com` sea elegible ni que el sitio tenga HTTPS activo. Confirmar certificado, nombre cubierto, redirección y renovación en el panel/proveedor: [Let's Encrypt hosting information](https://www.sharkasp.net/free_lets_encrypt_ssl_hosting), [SSL requirements](https://www.sharkasp.net/support/kb/a2433/how-to-order-an-ssl-certificate.aspx).

## Cambios locales de esta fase

- `npm run build` genera el bundle React (`dist`) y JavaScript compilado del backend (`dist-server`).
- `npm run start:server:compiled` ejecuta el backend compilado, evitando necesitar `tsx` de desarrollo al ejecutar la aplicación.
- El backend acepta `HTTP_PLATFORM_PORT` como respaldo de `PORT`. La plantilla de IIS pasa `%HTTP_PLATFORM_PORT%` a `PORT` siguiendo el ejemplo de SharkASP.
- En `APP_ENV=staging|production` con `PROCESS_ROLE=web`, Express sirve los assets de `dist`, responde las rutas de la SPA con su `index.html`, y mantiene `/api/*` en Express. El proceso falla al inicio si falta el build React.
- La búsqueda de `dist/` considera el cwd del sitio y rutas relativas al entrypoint compilado.
- La ruta de estáticos solo se activa para el rol web no-development. En desarrollo, Vite y su proxy se mantienen como estaban.
- Se excluye `dist-server` de `.gitignore` junto con `dist`.
- Se agregó inicialmente `deploy/sharkasp/web.config.template`, con handler `httpPlatform`, puerto dinámico, un proceso web y logs stdout desactivados. La Fase 3.6 separa el smoke inicial y la configuración de operación; ambas usan entrypoints relativos a `/Liciapp` y evitan inventar la ruta física de Node.
- Microsoft documenta que HttpPlatformHandler inicia y administra el proceso y actúa como proxy; SharkASP documenta que se puede mapear `HTTP_PLATFORM_PORT` a `PORT`. La plantilla sigue ese esquema: [referencia HttpPlatformHandler](https://learn.microsoft.com/en-us/iis/extensions/httpplatformhandler/httpplatformhandler-configuration-reference), [guía Node de SharkASP](https://www.sharkasp.net/support/kb/a2471/how-to-use-a-custom-node_js-executable.aspx).

## Compilación y publicación previstas (no ejecutadas en SharkASP)

1. En un entorno de build compatible, ejecutar `npm ci`, `npm run build`, `npm run typecheck` y `npm run test`.
2. Paquete web mínimo: `dist/`, `dist-server/`, `package.json`, `package-lock.json`, `web.config` final e instalación Windows x64 de dependencias de producción (`express`, `cors`, `zod`, `mysql2`, `argon2`, `dotenv`). `tsx` es solo necesario para desarrollo/pruebas. No copiar `.env`, respaldos, dumps ni la base local.
3. En el panel, habilitar Node.js para el sitio, confirmar Node Windows x64 compatible y registrar el handler/proceso Node. Configurar su argumento de inicio como el entrypoint compilado y pasar el puerto que IIS asigne vía `HTTP_PLATFORM_PORT` a `PORT`. Configurar explícitamente `HOST` a loopback para la conexión proxy-local; no publicar el puerto Node directamente.
4. Configurar variables de entorno en el mecanismo privado del panel/hosting, nunca en frontend ni archivos incluidos en la publicación.
5. Publicar solo después de contar con HTTPS válido y conocer el plan de reversión. SharkASP anuncia Git, Web Deploy y FTP: para el repositorio actual, el panel debe confirmar qué método acepta archivos estáticos más aplicación Node y si FTP/SFTP/Web Deploy respeta `web.config`, archivos ocultos, estructura y permisos. Sin Git local, FTP o Web Deploy serían candidatos manuales; no se eligió ni utilizó ninguno.

## Variables requeridas

Nombres únicamente; los valores deben cargarse en el almacén privado del hosting después de recibir la confirmación de HTTPS y base aislada. `.env` local no se leyó ni modificó.

- Servidor: `APP_ENV`, `NODE_ENV`, `PROCESS_ROLE`, `HOST`, `PORT`, `TRUST_PROXY_HOPS`, `CLIENT_ORIGIN`.
- MySQL/TLS: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL`, `DB_SSL_CA`.
- Mercado Público y sync: `MERCADOPUBLICO_TICKET`, `SYNC_API_TOKEN`, `MERCADOPUBLICO_TIMEOUT_MS`, `MERCADOPUBLICO_MIN_INTERVAL_MS`, `MERCADOPUBLICO_MAX_RETRIES`, `SYNC_SCHEDULER_ENABLED`.
- IA: `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_TIMEOUT_MS`.
- Workers: `ENRICHMENT_WORKER_ENABLED`, `ALERT_SCHEDULER_ENABLED`.
- Rate limiting compartido: `RATE_LIMIT_SHARED` (staging requiere almacenamiento MySQL compartido y migración 013).

El handler de IIS debe proporcionar `HTTP_PLATFORM_PORT` como valor de `PORT`; no fijar un número público o asumir que el puerto local 4000 está disponible. El nombre exacto de las variables configurables y su precedencia con variables del proceso IIS deben validarse en el panel. Mantener los tres flags de trabajos programados desactivados hasta aprobar el proceso worker y su coordinación.

## Seguridad de origen, cookies y proxy

- Usar exclusivamente HTTPS para el hostname que tenga certificado válido. La URL temporal indicada por el usuario comienza con HTTP: el middleware actual de Oportuna devuelve 426 en staging/producción si Express no reconoce una conexión HTTPS. Mientras no se confirme HTTPS, no iniciar sesión, enviar contraseñas/cookies, probar formularios privados ni introducir secretos en ese sitio.
- Verificación pública actual (sin cookies ni credenciales): `https://luminiadev-001-site5.ltempurl.com/` respondió HTTP 200; `curl` reportó verificación TLS 0 y `openssl s_client -verify_hostname` confirmó `Verification: OK`, certificado `CN=*.ltempurl.com` y TLS 1.3. El contenido servido es el HTML actual de IIS; no se comprobó Oportuna ni Node en el hosting.
- La misma comprobación observó que `http://luminiadev-001-site5.ltempurl.com/` respondió 200 sin redirigir a HTTPS. Antes de autenticar, configurar y probar una redirección/denegación HTTP en IIS/panel. Hasta entonces, no usar HTTP para credenciales.
- `CLIENT_ORIGIN` debe ser el origen HTTPS exacto (esquema y host, sin ruta). Aunque frontend y API comparten origen, mutaciones autenticadas exigen Origin validado, cookie CSRF y cabecera `X-CSRF-Token`. No abrir CORS con `*` ni habilitar otros orígenes.
- La sesión usa cookie `__Host-` `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`; la cookie CSRF es `Secure`, `SameSite=Lax`, `Path=/`. HTTPS termina en IIS/proxy. El número `TRUST_PROXY_HOPS` debe corresponder a los proxies reales; la configuración acepta 1–5 fuera de development. Confirmar que IIS reemplaza/canoniza las cabeceras forwarded y que el backend no es accesible por una vía que permita falsificarlas.
- La guía Node de SharkASP demuestra `HTTP_PLATFORM_PORT`, pero no documenta si `httpPlatform` reenvía `X-Forwarded-Proto` con el esquema público. Oportuna requiere que el proxy fiable indique HTTPS; si la cabecera falta o IIS permite que el cliente la suplante, el middleware rechaza la solicitud (426) o la configuración no es segura. Comprobar mediante petición HTTPS real que Node recibe el esquema correcto y mediante intento HTTP/`X-Forwarded-Proto: https` que el proxy lo reemplaza. No activar inicio de sesión hasta pasar ambas pruebas.
- No registrar cabeceras Cookie, Authorization, query de sincronización ni cuerpo de login. Mantener las claves solo en backend. Revisar logs de IIS y Node para excluir secretos y desactivar logs stdout de diagnóstico una vez verificado el arranque. La guía Node muestra stdout logging como ejemplo; no copiarlo sin definir ubicación y rotación segura.

## Workers y sincronización

La aplicación permite iniciar roles separados: `web`, `sync-worker`, `enrichment-worker`, `alert-worker`. El rol `web` no ejecuta estos loops. Los tres roles worker no escuchan HTTP y necesitan un supervisor que arranque, mantenga y reinicie un proceso Node con entorno y acceso persistente a MySQL.

- Sincronización Mercado Público diaria: solo `sync-worker` y solo cuando se habilite expresamente `SYNC_SCHEDULER_ENABLED`.
- Enriquecimiento de partidas: `enrichment-worker`, controlado por su flag y cola; mantener deshabilitado inicialmente.
- Alertas: `alert-worker`, controlado por su flag; mantener deshabilitado inicialmente.
- Los locks persistentes MySQL reducen duplicaciones entre instancias, pero no reemplazan a un supervisor ni garantizan que SharkASP mantenga workers vivos. Verificar soporte de procesos Node persistentes fuera de una solicitud web, reinicio tras reciclado y acceso a MySQL desde el proceso.
- No activar el Schedule Tasks del panel como sustituto directo: el mecanismo documentado envía GET, mientras Oportuna espera workers y no expone un endpoint GET firmado/idempotente para dispararlos.
- Si el plan compartido no ofrece procesos persistentes/supervisor, mantener los workers fuera de SharkASP o elegir un hosting que los soporte. No convertir los flags de scheduler en un endpoint público.

## MySQL de staging

Crear una base distinta de la local, con usuario exclusivo de privilegio mínimo y TLS verificado. No importar el dump ni registros locales; la base comienza sin usuarios, empresas ni licitaciones. Aplicar las migraciones del proyecto en orden (001–013) desde un proceso controlado, con respaldo del schema de staging y registro del resultado. No habilitar sincronización hasta revisar presupuesto/consumo de la API y aprobar explícitamente poblar staging desde la fuente oficial. La migración 013 se requiere por los límites compartidos en entornos no-development.

Confirmar con SharkASP: versión/compatibilidad MySQL 8, host y puerto, acceso de red desde la aplicación, TLS obligatorio, certificado CA que debe usarse en `DB_SSL_CA`, límites de conexiones, cuotas/espacio, backups y procedimiento de restauración probado. `DB_SSL=true` en Oportuna valida el certificado; no usar `rejectUnauthorized=false` para ocultar un problema de CA.

## Requisitos del plan y preguntas para confirmar en el panel

1. Producto/plan exacto de `luminiadev-001-site5`, versión de Control Panel y si la cuenta permite Node.js en ese sitio (no solo en VPS).
2. Node.js soportado o procedimiento de `node.exe` propio; arquitectura x64, versión mínima/máxima, ruta protegida y política de actualización.
3. Disponibilidad de IIS HTTP Platform Handler, configuración `web.config` permitida, `HTTP_PLATFORM_PORT`, timeout de arranque, límite de memoria y comportamiento ante idle timeout/reciclado/crash.
4. Si el proceso web Node puede mantenerse vivo y si es compatible con el backend compilado ES modules.
5. Cómo provisionar y proteger variables de entorno; si pueden definirse por sitio y por proceso/rol y si sobreviven a reciclados.
6. Si se permite más de un proceso Node bajo el plan (roles worker separados), supervisor/AlwaysRunning/Startup Task, reinicios tras mantenimiento y límites de workers. Si no, confirmar alternativa de VPS/plan o ejecutar workers fuera del hosting.
7. Estado de certificado del hostname temporal exacto, HTTPS, redirección HTTP→HTTPS, renovación y cookies detrás de IIS. No asumir certificado por el hecho de que SharkASP ofrezca SSL.
8. Disponibilidad de Git deployment específicamente para Node y su integración con la compilación React/backend; Web Deploy y FTP disponibles para el sitio, protocolo cifrado, ruta raíz, exclusiones/no-delete y permisos de `web.config`.
9. MySQL asignable para staging, versión, SSL/TLS y CA, host/puerto, acceso desde Node, `GET_LOCK()`/`RELEASE_LOCK()` habilitados, capacidad de 8 conexiones por proceso, copias y restauraciones.
10. Límites del hosting: disco, memoria, CPU, conexiones y logs. El MySQL pool de cada proceso puede abrir hasta 8 conexiones; dimensionar el número total de roles/procesos.

## Plan de staging y rollback

1. Confirmar los puntos anteriores y HTTPS antes de crear credenciales de staging. Aprovisionar un hostname/base MySQL vacíos y aislados.
2. Ejecutar migraciones 001–013 en la base de staging, verificando cada versión y restauración de prueba. Crear/activar administrador de staging solo con procedimiento autorizado y datos de prueba.
3. Construir el paquete; desplegar web con flags de scheduler desactivados. Verificar `/`, recarga de rutas de React, `/api/health`, cookies, sesión, CSRF, CORS, MySQL TLS y ausencia de secretos en assets/logs.
4. Validar staging con datos mínimos autorizados. Habilitar la primera sincronización solo después de una autorización separada. Activar workers únicamente cuando el hosting confirme su supervisión y hayan pasado pruebas idempotentes.
5. Rollback: detener/revertir proceso web a la versión anterior (mantener paquete de build anterior fuera de la raíz activa); no revertir migraciones con pérdida de datos. Respaldar antes de cada migración; preferir migraciones aditivas hacia adelante. Si la app no inicia, mantener workers apagados y no iniciar sync. Restaurar exclusivamente la base de staging desde su backup, nunca sustituir la base local.

## Estado

La ruta same-origin quedó preparada en código; el build del backend acepta el puerto dinámico de IIS. La Fase 3.6 reemplazó el ZIP previo por un empaquetador PowerShell para Windows x64, ya que Argon2 debe instalarse para la arquitectura y versión Node del hosting. No se modificó/subió el index predeterminado de SharkASP.

No se configuró el panel, no se subieron archivos, no se eligió método de publicación y no se conectó MySQL SharkASP. El HTTPS del hostname temporal tiene certificado válido, pero el sitio todavía no está confirmado como ejecutando Node/Oportuna. Staging no está listo para desplegar hasta completar rutas físicas, Node/handler, variables privadas, proxy HTTPS y MySQL de staging.

## Validaciones locales ejecutadas

- `npm run build`: pasó; generó `dist/` y `dist-server/`.
- `npm run typecheck`: pasó.
- `npm run test`: pasó; los casos de autenticación, CSRF, CORS, límites compartidos, locks y módulos funcionales limpiaron sus registros temporales.
- Backend compilado en modo staging local, con `PORT` vacío y `HTTP_PLATFORM_PORT` establecido: el proceso escuchó en el puerto dinámico; HTTPS reenviado respondió 200 para `/`, una ruta SPA y `/api/health`; HTTP directo respondió 426. Esto comprueba la ruta de configuración local, no el handler ni las cabeceras reales de SharkASP.
- La validación de plantillas IIS y smoke sin datos reales está en `docs/sharkasp-staging-3.6.md`; el artefacto ZIP se genera en Windows después de confirmar Node x64 del hosting.
- MySQL local: 19.608 licitaciones y 19.608 códigos únicos.
- El bundle frontend no contiene patrones de claves/tickets/token ni variables de configuración privada. El único nombre de variable encontrado fue `MERCADOPUBLICO_TICKET` en texto de ayuda de Configuración; es una etiqueta informativa, no un valor ni una credencial.
- Se detuvieron las instancias temporales de prueba. No se realizaron llamadas a Mercado Público/Groq ni se transfirió la base.
