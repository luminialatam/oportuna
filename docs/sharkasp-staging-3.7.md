# Oportuna — aplicación completa en staging SharkASP (Fase 3.7)

Estado: build local validado y paquete de staging preparado; no se subió ni activó. El smoke continúa siendo la aplicación activa hasta una sustitución autorizada.

## Paquete preparado

`artifacts/oportuna-sharkasp-staging.zip` contiene únicamente:

- `dist/` (frontend compilado)
- `dist-server/` (backend compilado; entry `server/src/index.js`)
- `node_modules/` de dependencias de producción
- `package.json` y `package-lock.json`
- `web.config` adaptado del generado y probado por SharkASP

No contiene `.env`, secretos, SQL dumps, respaldos, logs ni registros locales. Argon2 0.45.1 distribuye binarios N-API precompilados; el paquete incluye y verifica el binario PE `win32-x64`. El backend requiere Node 18+ por `fetch` global; Argon2 usa N-API 8. La configuración de SharkASP confirmó `processPath="node"`, así que no se inventa una ruta física.

## IIS y ejecución

El `web.config` mantiene un único `httpPlatformHandler`, `processPath=node`, inicio `dist-server\server\src\index.js`, puerto dinámico `%HTTP_PLATFORM_PORT%`, loopback, un proceso, arranque/reintento de la configuración funcional y stdout logging apagado. Sirve React y API desde el mismo origen. `APP_ENV=staging` hace que cookies de sesión/CSRF sean Secure; el middleware exige HTTPS reenviado y Express confía solo los saltos definidos por `TRUST_PROXY_HOPS`.

El valor `TRUST_PROXY_HOPS` no se fija en el archivo: debe estar definido en el entorno privado del sitio entre 1 y 5, tras confirmar la cadena y saneamiento del proxy SharkASP. No iniciar sesión mientras esta variable o el forwarding HTTPS no estén verificados.

Roles/flags en el `web.config`: `PROCESS_ROLE=web`, `SYNC_SCHEDULER_ENABLED=false`, `ENRICHMENT_WORKER_ENABLED=false`, `ALERT_SCHEDULER_ENABLED=false`. El servicio web no inicia workers; no se activa ningún scheduler.

## Variables privadas de staging

Configurar en el panel/entorno privado del proceso, nunca en el ZIP ni en frontend:

- App: `APP_ENV`, `NODE_ENV`, `PROCESS_ROLE`, `HOST`, `PORT`, `CLIENT_ORIGIN`, `TRUST_PROXY_HOPS`.
- MySQL: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL=true`, `DB_SSL_MODE`. El modo predeterminado `VERIFY_IDENTITY` valida cadena y hostname. `VERIFY_CA` se permite solo con PEM y huella SHA-256 del proveedor verificada de forma independiente.
- Integraciones requeridas por el validador de staging: `MERCADOPUBLICO_TICKET`, `SYNC_API_TOKEN` (>=32 caracteres). Groq es opcional: `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_TIMEOUT_MS`.
- Controles: `SYNC_SCHEDULER_ENABLED=false`, `ENRICHMENT_WORKER_ENABLED=false`, `ALERT_SCHEDULER_ENABLED=false`, `RATE_LIMIT_SHARED=true`.
- Mercado Público, si se configura: `MERCADOPUBLICO_TIMEOUT_MS`, `MERCADOPUBLICO_MIN_INTERVAL_MS`, `MERCADOPUBLICO_MAX_RETRIES`.

`PORT` debe recibir el puerto asignado por HTTP Platform. Nunca copiar valores del `.env` local. El administrador de staging y los datos de prueba se crearán solo en una etapa autorizada, separados de la cuenta real.

El script `server/scripts/applySharkAspStagingMigrations.mjs --check` utiliza la misma configuración TLS que el backend y solo consulta conexión, versión, esquema y nombres de tablas; no migra. Para `VERIFY_CA`, configura variables en el proceso de Terminal (sin cambiar `.env`), guarda el PEM fuera del proyecto y compara su huella con la confirmada por soporte.

Excepción temporal SharkASP: `DB_SSL_MODE=SHARKASP_STAGING_COMPAT` junto con `DB_SSL_SHARKASP_COMPAT=true` permite cifrado TLS sin autenticar el certificado. El código lo restringe a `APP_ENV=staging`, `PROCESS_ROLE=web`, `mysql1002.site4now.net:3306`, `db_ac9392_licitapp` y `ac9392_licitapp`. Mantiene desactivada la verificación del certificado solo en esa conexión mysql2; no cambia la validación TLS global de Node.js. La conexión queda expuesta a un intermediario activo que suplante el MySQL, aunque el tráfico siga cifrado. Usar solo temporalmente y retirar el modo en cuanto SharkASP publique un certificado/CA verificable. Nunca usar en producción ni con otro host, base o usuario.

## Base MySQL de staging y migraciones

Se requiere MySQL 8 independiente, vacío y con TLS verificado. Crear una base `oportuna` en el host/cuenta de staging (las migraciones actuales usan `USE oportuna`); no reutilizar el servidor local ni importar sus licitaciones, empresas, usuarios o perfiles. Crear un usuario de migración temporal con permisos para crear/alterar tablas y un usuario runtime de privilegio mínimo. Al terminar migraciones, retirar el usuario temporal.

Ejecutar una sola vez, en este orden: `001_initial.sql` hasta `013_shared_rate_limits.sql`. No ejecutar `012_authentication.down.sql`. Las migraciones `002`, `003`, `004` y `008` contienen `ALTER TABLE` no idempotentes; un fallo parcial requiere inspeccionar el esquema y continuar con un plan revisado, nunca repetir el lote completo a ciegas. La aplicación no las ejecuta automáticamente. `001` declara la base y hace `USE oportuna`; si se crea desde panel, usar una cuenta autorizada para esa declaración o adaptar solo una copia temporal de migración retirando esas dos instrucciones tras seleccionar la base correcta.

Después, comprobar las 13 versiones/resultados y `GET /api/health` desde HTTPS; inicialmente MySQL estará sin usuarios ni licitaciones. Mantener sync desactivada. Poblar staging desde fuentes oficiales requerirá autorización separada.

## HTTPS, cookies y proxy

La URL de origen configurada es `https://luminiadev-001-site5.ltempurl.com`. Cookies usan `Secure` fuera de development; Origin/CSRF siguen activos. El smoke correcto verifica Node y HTTP Platform, pero no demuestra por sí solo que `X-Forwarded-Proto` sea confiable, que HTTP redirija/bloquee a HTTPS ni el conteo de proxies. Antes de usar credenciales de staging, verificar esas propiedades y `TRUST_PROXY_HOPS` de extremo a extremo. No pasar por HTTP credenciales ni cookies.

## Sustitución y reversión (no ejecutadas)

1. Conservar el paquete smoke actual y una copia de los archivos existentes en `/Liciapp` antes de cambios.
2. Confirmar staging MySQL vacío/migrado, variables privadas, proxy HTTPS y aplicación Node configurada con `web.config` del paquete.
3. Publicar el ZIP completo en una carpeta de staging aislada o ventana controlada; no sobrescribir `index.html` del sitio ni descomprimir con opción de borrado masivo.
4. Cambiar la aplicación a `dist-server\server\src\index.js`, reciclar y comprobar `/`, una ruta SPA y `/api/health` por HTTPS. Sin admin real, usuarios reales ni sincronización.
5. Reversión: detener/reciclar Node, restaurar el `web.config` y archivos del smoke guardados; no restaurar ni alterar la base local. La DB de staging se recupera solo desde su respaldo de staging.

## Validación local

- `npm run build` y `npm run typecheck`.
- XML parseado; una sola declaración del handler, proceso `node`, entrypoint compilado válido.
- ZIP inspeccionado: sin `.env`, secretos, dumps, respaldos o logs; contiene únicamente artefactos de build, manifests, dependencias de producción y `web.config`.
- Argon2 Windows x64 comprobado como PE x86-64 y N-API 8; no ejecutable en macOS. Su carga efectiva en el hosting se valida tras la instalación, antes de cualquier prueba de login.
- No se ejecutó migración, conexión a base remota, sincronización, enriquecimiento, ni despliegue.

## Pendientes antes de activar

- Aprovisionar la base de staging y ejecutar las migraciones controladas.
- Configurar secretos y `TRUST_PROXY_HOPS` en el panel, nunca en archivos públicos.
- Verificar forwarding HTTPS y bloqueo/redirección HTTP antes de credenciales.
- Confirmar límites de almacenamiento/memoria del hosting para el tamaño del ZIP.
- El paquete preparado no se publicó.
