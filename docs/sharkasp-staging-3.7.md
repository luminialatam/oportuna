# Oportuna — aplicación completa en staging SharkASP (Fase 3.7)

Estado: build local validado; el ZIP de staging aún debe generarse en Windows x64. No se desplegó. La candidata requiere un sitio SharkASP, MySQL y secretos aislados, independientes del sitio existente `/Liciapp`.

## Paquete de staging previsto

Al ejecutar el empaquetador en Windows x64 con `-Mode Staging`, `artifacts/oportuna-sharkasp-staging.zip` contendrá únicamente:

- `dist/` (frontend compilado)
- `dist-server/` (backend compilado; entry `server/src/index.js`)
- `node_modules/` de dependencias de producción
- `package.json` y `package-lock.json`
- `sharkasp-bootstrap.mjs` y el runtime específico de staging `sharkasp-runtime-config.mjs`
- `web.config` de staging con rol web y workers desactivados

No contiene `.env`, secretos, SQL dumps, respaldos, logs ni registros locales. Argon2 0.45.1 distribuye binarios N-API precompilados; el paquete incluye y verifica el binario PE `win32-x64`. El backend requiere Node 18+ por `fetch` global; Argon2 usa N-API 8. La configuración de SharkASP confirmó `processPath="node"`, así que no se inventa una ruta física.

## IIS y ejecución

El `web.config` usa un único `httpPlatformHandler`, `processPath=node`, inicio `sharkasp-bootstrap.mjs`, puerto dinámico `%HTTP_PLATFORM_PORT%`, loopback, un proceso y stdout logging apagado. El bootstrap importa `dist-server/server/src/index.js` y sirve React/API desde el mismo origen. `APP_ENV=staging` hace que cookies de sesión/CSRF sean Secure; el middleware exige HTTPS reenviado y Express confía solo los saltos definidos por `TRUST_PROXY_HOPS`.

El runtime de staging no incluye host/base/usuario MySQL ni dominio público fijos. El modo de staging rechaza la identidad de la base compartida del sitio existente y exige que `TRUST_PROXY_HOPS` y el origen HTTPS de staging se definan en el entorno privado del sitio. No iniciar sesión mientras la ruta privada de secretos, el proxy HTTPS y la base aislada no estén verificados.

Roles/flags en el `web.config`: `PROCESS_ROLE=web`, `SYNC_SCHEDULER_ENABLED=false`, `ENRICHMENT_WORKER_ENABLED=false`, `ALERT_SCHEDULER_ENABLED=false`. El servicio web no inicia workers; no se activa ningún scheduler.

## Variables privadas de staging

Configurar en el panel/entorno privado del proceso, nunca en el ZIP ni en frontend:

- App: `APP_ENV=staging`, `NODE_ENV=production`, `PROCESS_ROLE=web`, `HOST`, `PORT`, `CLIENT_ORIGIN`, `TRUST_PROXY_HOPS`, `OPORTUNA_PRIVATE_SECRETS_PATH`.
- MySQL de staging: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL=true`, `DB_SSL_MODE`. El modo predeterminado `VERIFY_IDENTITY` valida cadena y hostname. `VERIFY_CA` se permite solo con PEM y huella SHA-256 del proveedor verificada de forma independiente. El host, esquema y usuario deben ser propios de staging; se bloquea la identidad compartida actual.
- Integraciones requeridas por el validador de staging: `MERCADOPUBLICO_TICKET`, `SYNC_API_TOKEN` (>=32 caracteres). Groq es opcional: `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_TIMEOUT_MS`.
- Controles fijos por el paquete: `SYNC_SCHEDULER_ENABLED=false`, `ENRICHMENT_WORKER_ENABLED=false`, `ALERT_SCHEDULER_ENABLED=false`, `RATE_LIMIT_SHARED=true`, `PROCESS_ROLE=web`.
- Mercado Público, si se configura: `MERCADOPUBLICO_TIMEOUT_MS`, `MERCADOPUBLICO_MIN_INTERVAL_MS`, `MERCADOPUBLICO_MAX_RETRIES`.

`PORT` debe recibir el puerto asignado por HTTP Platform. `OPORTUNA_PRIVATE_SECRETS_PATH` debe apuntar a un archivo JSON exclusivo para staging, fuera de la raíz web y distinto del archivo usado por el sitio actual. Ese archivo incluye solo credenciales de staging; el bootstrap elimina cualquier secreto heredado del Pool antes de leerlo. Nunca copiar valores del `.env` local. El administrador de staging y los datos de prueba se crearán solo en una etapa autorizada, separados de la cuenta real.

El script `server/scripts/applySharkAspStagingMigrations.mjs --plan` revisa offline el orden de archivos, sin leer credenciales ni conectarse. `--check` y `--inspect` son de solo lectura y usan `STAGING_DB_HOST`, `STAGING_DB_PORT`, `STAGING_DB_NAME`, `STAGING_DB_USER` y `STAGING_DB_SSL_MODE`, con la misma validación TLS que el backend. La contraseña se solicita de forma interactiva y oculta; no se guarda en el repositorio ni se imprime. Para `VERIFY_CA`, configura `STAGING_DB_SSL_CA` y `STAGING_DB_SSL_CA_SHA256` en el entorno privado del proceso, guarda el PEM fuera del proyecto y compara su huella con la confirmada por soporte.

### Confirmar destino y conexión de migración

Antes de establecer conexión, obtiene del panel/administrador de staging el hostname MySQL dedicado, el nombre exacto del esquema, el puerto y el usuario temporal de migración. Compara esos cuatro valores con el entorno privado del proceso y verifica que no sean el host compartido `mysql1002.site4now.net` ni la base productiva `db_ac9392_licitapp`. El verificador bloquea ambos identificadores conocidos de producción aunque solo uno coincida; no tiene fallback a `.env`, a la base local ni a otra conexión.

Ejemplo **ficticio** para una Terminal controlada (el host `.invalid` no existe):

```sh
export STAGING_DB_HOST='mysql-stage.example.invalid'
export STAGING_DB_PORT='3306'
export STAGING_DB_NAME='oportuna_stage_qa'
export STAGING_DB_USER='oportuna_stage_migrator'
export STAGING_DB_SSL_MODE='VERIFY_IDENTITY'
```

El verificador solicita la contraseña de forma oculta cuando inicia una comprobación remota; no definas ni copies contraseñas en comandos, archivos versionados o logs. `VERIFY_IDENTITY` es el modo predeterminado y verifica CA y hostname. Si el proveedor solo admite `VERIFY_CA`, se requieren además `STAGING_DB_SSL_CA` (ruta a un PEM guardado fuera del repositorio) y `STAGING_DB_SSL_CA_SHA256` (huella confirmada por un canal independiente). No uses el modo de compatibilidad sin verificación TLS.

Solo después de cotejar la identidad provista por el administrador, ejecuta `node server/scripts/applySharkAspStagingMigrations.mjs --check`. Confirma en su salida host, esquema, versión MySQL, TLS y permisos. Luego `--inspect` muestra tablas, columnas, índices y claves foráneas para revisar el estado real. Ambos modos son de lectura. Si faltan `STAGING_DB_HOST`, `STAGING_DB_NAME` o `STAGING_DB_USER`, falla antes de pedir contraseña; el puerto predeterminado es 3306 y el modo TLS predeterminado es `VERIFY_IDENTITY`. Si host o esquema coinciden con los identificadores conocidos de producción, bloquea antes de abrir conexión. Un `--plan` exitoso no confirma ni identifica un servidor remoto.

El modo TLS temporal `SHARKASP_STAGING_COMPAT` pertenece a la configuración del sitio existente y no se acepta en el nuevo paquete de staging. Staging exige validar la identidad del servidor con `VERIFY_IDENTITY` o usar una CA verificada con `VERIFY_CA`.

## Base MySQL de staging y migraciones

Se requiere MySQL 8 aislado y TLS verificado. El plan vigente contiene 25 archivos ascendentes hasta `025_team_activity_automation.sql`; los números repetidos 017 y 018 y los saltos históricos son intencionales en el árbol actual. `--plan` enumera ese lote completo. Aplicar el lote completo prepara **un esquema nuevo y vacío**; el modo de aplicación del script rechaza una base que ya tenga tablas. No ejecutes el lote de 25 archivos sobre una base poblada ni lo uses para “ponerse al día” automáticamente: varias migraciones previas contienen operaciones no idempotentes.

Para una base staging **existente**, primero ejecuta `--check` y `--inspect` y revisa el esquema; no uses el modo de aplicación del lote completo. Luego compara los objetos de la migración 025 con el esquema inspeccionado y aplica **únicamente** `server/migrations/025_team_activity_automation.sql` si sus objetos faltan y todos los prerrequisitos/estructuras son compatibles. La migración define siete tablas (`company_opportunity_teams`, `company_opportunity_team_members`, `company_activity_events`, `company_offer_workspaces`, `company_automation_rules`, `company_automation_runs`, `company_automation_notifications`) con índices y claves foráneas. Referencia `companies(id)`, `licitaciones(codigo_externo)`, `app_users(id)` y `company_memberships(user_id,company_id)`; confirma que esas tablas, columnas, tipos y claves referidas existan. También inspecciona primero cada uno de los siete nombres destino.

`CREATE TABLE IF NOT EXISTS` evita un error por nombre existente, pero **no valida** que la estructura ya existente sea compatible. Compara `SHOW CREATE TABLE`/columnas, índices y claves foráneas de cualquier tabla destino existente con la definición de 025. Si una tabla existente difiere, falta un prerrequisito o la migración falla parcialmente, detente y prepara un plan revisado; no repitas el archivo a ciegas. La migración 025 es aditiva y no contiene `USE`, `DROP`, `TRUNCATE` ni sentencias DML. Sus claves foráneas declaran `CASCADE`, `SET NULL` o `RESTRICT` para futuras operaciones sobre filas padre; crear las tablas no ejecuta esas acciones. Debe ejecutarse con el esquema staging ya seleccionado y confirmado. No se ejecuta automáticamente al iniciar Oportuna.

Después de aplicar, verifica las siete tablas, sus índices y relaciones foráneas, junto con los permisos de la aplicación runtime y la cuenta de migración. Mantén la sincronización apagada. Poblar staging desde fuentes oficiales requiere autorización separada.

## HTTPS, cookies y proxy

`CLIENT_ORIGIN` debe contener solo el origen HTTPS dedicado de staging. No incluir `tailflow.pro` ni el dominio del sitio real en esa lista: los enlaces de correo y los controles Origin/CSRF usarán ese valor. Cookies usan `Secure` fuera de development. El smoke local verifica Node y HTTP Platform, pero no demuestra que `X-Forwarded-Proto` sea confiable, que HTTP redirija/bloquee a HTTPS ni el conteo de proxies. Antes de usar credenciales, verificar el proxy HTTPS y `TRUST_PROXY_HOPS` de extremo a extremo.

El bootstrap de staging recibe los parámetros no secretos del entorno privado y las credenciales desde el archivo indicado por `OPORTUNA_PRIVATE_SECRETS_PATH`. Rechaza el archivo compartido con el sitio actual y elimina secretos heredados del Pool antes de leer el archivo dedicado. El pool de `mysql2` recibe `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` y las opciones TLS creadas por `createMysqlTlsOptions`. `GET /api/health` ejecuta `SELECT 1`; el fallo deja `mysql:false` sin ampliar el JSON. El log muestra solo un código genérico `DB_ACCESS_DENIED`, `DB_TLS`, `DB_DNS`, `DB_TIMEOUT`, `DB_CONNECTION_REFUSED`, `DB_SCHEMA` o `DB_UNKNOWN`.

## Sustitución y reversión (no ejecutadas)

1. Usar un sitio SharkASP separado del sitio productivo `/Liciapp`; conservar intacto el paquete smoke actual.
2. Confirmar staging MySQL vacío/migrado, secretos exclusivos, proxy HTTPS y aplicación Node configurada con `web.config` del paquete.
3. Publicar el ZIP completo únicamente en el sitio de staging separado.
4. Seleccionar `sharkasp-bootstrap.mjs` como entrypoint y comprobar `/`, una ruta SPA y `/api/health` por HTTPS. Usar solo cuenta y datos de prueba; la sincronización permanece apagada.
5. Reversión: detener/reciclar Node, restaurar el `web.config` y archivos del smoke guardados; no restaurar ni alterar la base local. La DB de staging se recupera solo desde su respaldo de staging.

## Validación local

- `npm run build` y `npm run typecheck`.
- `npm run test:sharkasp-staging-config`, `npm run test:sharkasp-artifact`, `npm run test:sharkasp-smoke` y `npm run test:sharkasp-runtime-config` pasaron localmente.
- El ZIP Windows x64 todavía no se generó ni inspeccionó. El empaquetador verifica su estructura, dependencias de producción y prebuild Argon2; el arranque efectivo de Argon2 se comprobará en el sitio de staging antes de probar login.
- No se ejecutó migración, conexión a base remota, sincronización, enriquecimiento, ni despliegue.

## Pendientes antes de QA de staging

- Aprovisionar el sitio, la base y el archivo de secretos aislados de staging; ejecutar las migraciones controladas.
- Configurar secretos y `TRUST_PROXY_HOPS` en el panel, nunca en archivos públicos.
- Verificar forwarding HTTPS y bloqueo/redirección HTTP antes de credenciales.
- Confirmar límites de almacenamiento/memoria del hosting para el tamaño del ZIP.
- Generar el paquete Windows x64 y revisar su contenido antes de subirlo al sitio aislado.
- Corregir y verificar la divergencia visible entre el estado de Notificaciones y el canal de correo antes del piloto comercial.
