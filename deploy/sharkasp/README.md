# SharkASP — Oportuna

El sitio existente `luminiadev-001-site5` y la carpeta `/Liciapp` corresponden al entorno actual; el paquete nuevo de staging debe instalarse en un sitio separado con MySQL y secretos propios. El módulo SharkASP confirma `Node.JS + httpPlatforma` y `processPath=node` para ese hosting.

Para GitHub Deploy, configura el comando de build como `npm run build:sharkasp`. Este comando ejecuta el build normal y luego prepara el directorio raíz efímero que SharkASP publica: copia `dist/index.html` y `dist/assets/` a la raíz, valida los nombres hashed y exige que `web.config` dirija todas las rutas a `sharkasp-bootstrap.mjs` mediante `HTTP_PLATFORM_PORT`. `npm run build` por sí solo conserva el `index.html` fuente de Vite en la raíz.

## Paquetes

- `../../artifacts/oportuna-sharkasp-smoke.zip`: smoke autónomo.
- `../../artifacts/oportuna-sharkasp-staging.zip`: frontend/backend completos y dependencias runtime de producción para staging.

El smoke actualmente instalado en `/Liciapp` se mantiene intacto durante el QA. El paquete de staging nuevo incluye `web.config`, `dist/`, `dist-server/`, `node_modules/` (solo producción, Argon2 Windows x64), `package.json`, `package-lock.json`, `sharkasp-bootstrap.mjs` y `sharkasp-runtime-config.mjs`. Se publica solo en el sitio aislado de staging, no en `/Liciapp`.

## Arranque en SharkASP y archivo privado de credenciales

El panel Node.js regenera la configuración de `httpPlatform` al guardar el archivo de inicio. En staging se selecciona `sharkasp-bootstrap.mjs`; el proceso toma el puerto dinámico `HTTP_PLATFORM_PORT`, usa `PROCESS_ROLE=web` y mantiene desactivados sync, enriquecimiento y alertas. El runtime exige una base aislada, un origen HTTPS propio de staging y un archivo privado de secretos exclusivo; falla cerrado si detecta la base compartida actual o el archivo de secretos común. No se ejecuta sincronización ni se usan correos reales en la verificación inicial.

La configuración que ya opera en el sitio existente conserva su procedimiento histórico de archivo privado descrito en sus notas de operación. Para la nueva versión de staging, usa `OPORTUNA_PRIVATE_SECRETS_PATH` con un archivo dedicado diferente y fuera de la raíz web; el bootstrap de staging elimina secretos heredados del Pool y bloquea la ruta común del sitio actual. No coloques secretos en `/Liciapp`, frontend, `web.config` ni el ZIP.

**Límite de aislamiento:** según la configuración confirmada, cinco sitios comparten `luminiadev-001`. Una ACL para la identidad de ese Pool permite lectura a los procesos de todos esos sitios, por lo que el archivo queda fuera del alcance de una descarga HTTP directa, pero no está aislado frente a código comprometido de otro sitio del mismo Pool. Además, el proceso Node.js no puede comprobar por sí solo la ACL NTFS efectiva. No debe describirse esta alternativa como aislamiento completo ni considerarse una frontera adecuada para secretos de producción. Si el panel no permite un archivo fuera de `www` con ACL controlable, no subas credenciales: hace falta que SharkASP proporcione un almacén de secretos por sitio/proceso o una identidad de ejecución separada.

Ruta esperada dada la ruta física observada del sitio: `H:\root\home\luminiadev-001\oportuna-private\secrets.json`. Confirma en el panel que esa carpeta está fuera de `www`, que el proceso puede leer el archivo y que las ACL son las esperadas; no habilites descarga HTTP para probarlo. El bootstrap informa solo si el archivo es legible y qué variables están presentes, nunca sus valores. El modo `SHARKASP_STAGING_COMPAT` conserva TLS cifrado pero no valida la identidad del certificado y sigue limitado a staging.

El inicio imprime solo nombres/estados de configuración; nunca valores secretos. Para verificar el nuevo staging tras el arranque: `node deploy/sharkasp/smoke-test.mjs https://TU-ORIGEN-STAGING`, que consulta únicamente `/` y `/api/health`. No uses el valor predeterminado de ese script para esta comprobación.

### Diagnóstico MySQL sin datos sensibles

`/api/health` mantiene la respuesta pública `{ok, apiConfigured, mysql}`. Si `SELECT 1` falla, el proceso registra únicamente `[db] health_check_failed code=DB_…`; las barreras de base de otras rutas registran `request_guard_failed` con el mismo clasificador. No se registran el mensaje de mysql2, host, usuario, contraseña ni SQL. El bootstrap fija host, base, usuario y TLS desde `sharkasp-runtime-config.mjs`; `DB_PASSWORD`, `MERCADOPUBLICO_TICKET` y `SYNC_API_TOKEN` se cargan desde el JSON privado. El bootstrap borra primero esos nombres del entorno heredado del Pool, por lo que cambiar `DB_PASSWORD` únicamente en el Pool no cambia la contraseña que utiliza Oportuna.

Acción operativa según el código observado en el log:

| Código | Acción única |
| --- | --- |
| `DB_ACCESS_DENIED` | Actualizar `DB_PASSWORD` en el JSON privado para el usuario MySQL configurado; no cambiar la variable del Pool. |
| `DB_TLS` | Confirmar con SharkASP el modo TLS/CA compatible y configurar esa CA verificada; no desactivar la validación. |
| `DB_DNS` | Confirmar el nombre de host MySQL asignado en el panel y corregir `DB_HOST` en la configuración no secreta del bootstrap. |
| `DB_TIMEOUT` | Pedir al proveedor verificar accesibilidad del servidor MySQL y su puerto desde el proceso Node. |
| `DB_CONNECTION_REFUSED` | Confirmar con el proveedor que MySQL escucha en el host y puerto configurados. |
| `DB_SCHEMA` | Confirmar que `DB_NAME` existe y contiene el esquema/migraciones requeridos. |
| `DB_UNKNOWN` | Consultar el registro sanitizado del proceso para obtener un código más específico; no copiar mensajes crudos ni datos de conexión. |

Tras instalar, el smoke test sin autenticación ni secretos se ejecuta desde Node 18+: `node deploy/sharkasp/smoke-test.mjs`. Solo hace GET a `/` y `/api/health`, e informa si frontend, API y MySQL responden. Ejecutarlo una vez configuradas las variables privadas.

El paquete del sitio existente utiliza `web.config.production.template` y el runtime de ese entorno. El paquete nuevo de staging utiliza `web.config.staging.template`, `sharkasp-runtime-config.staging.mjs`, rol web y workers apagados. No mezcles sus archivos de configuración.

Para generar el paquete seguro de staging desde PowerShell en Windows x64, primero compilar (`npm ci`, `npm run build`) y ejecutar:

```powershell
.\deploy\sharkasp\Prepare-Windows-Package.ps1 `
  -Mode Staging `
  -ExpectedNodeMajor VERSION_NODE_INSTALADA_EN_ESTE_WINDOWS `
  -OutputZip '.\artifacts\oportuna-sharkasp-staging.zip'
```

El empaquetador exige Windows x64, Node 18+ y crea `node_modules` con dependencias de producción. El modo `Staging` empaqueta un runtime separado que exige su propio host/base/usuario MySQL, origen HTTPS y archivo de secretos dedicado; configura `PROCESS_ROLE=web` y deja desactivados sincronización y workers. Rechaza la identidad de base compartida y actual usada por el sitio existente. El prebuild de Argon2 incluido usa N-API y se empaca específicamente para `win32-x64` en el ZIP preparado. Nunca añadir `.env`, dumps o credenciales.

Despliega ese ZIP solo en un sitio y base aislados de staging, nunca en `/Liciapp`. El modo `Production` conserva una configuración distinta y requiere una revisión y autorización de producción separadas.

## Aplicación completa

Ver [docs/sharkasp-staging-3.7.md](../../docs/sharkasp-staging-3.7.md) para variables privadas, DB staging, migraciones, HTTPS/proxy, sustitución controlada y rollback. No desplegar hasta preparar la DB vacía y validar el proxy HTTPS.
