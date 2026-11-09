# SharkASP — Oportuna

El smoke y la aplicación completa usan el sitio `luminiadev-001-site5`, carpeta `/Liciapp`, módulo `Node.JS + httpPlatforma` y el proceso `node` confirmado por el `web.config` funcional.

## Paquetes

- `../../artifacts/oportuna-sharkasp-smoke.zip`: smoke autónomo.
- `../../artifacts/oportuna-sharkasp-staging.zip`: frontend/backend completos y dependencias runtime de producción para staging.

El ZIP staging actualmente instalado contiene en su raíz `web.config`, `dist/`, `dist-server/`, `node_modules/` (solo producción, Argon2 Windows x64), `package.json` y `package-lock.json`. Para corregir el inicio existente no se reemplaza el ZIP: se agrega únicamente `sharkasp-bootstrap.mjs` a `/Liciapp`. Los próximos ZIP que genere el empaquetador incluirán el bootstrap. Para instalaciones nuevas se publica el contenido del ZIP en `/Liciapp`; no se sube el ZIP como un archivo dentro de esa carpeta.

## Arranque en SharkASP y archivo privado de credenciales

El panel Node.js regenera la configuración de `httpPlatform` al guardar el archivo de inicio. Selecciona `sharkasp-bootstrap.mjs` como archivo de inicio. El bootstrap fija la configuración no secreta de staging, usa el puerto dinámico `HTTP_PLATFORM_PORT` (o `PORT`), fuerza `PROCESS_ROLE=web`, apaga los workers, desactiva la lectura de `.env` e importa después `dist-server/server/src/index.js`.

El bootstrap carga las credenciales desde `../../oportuna-private/secrets.json`, resuelto desde la raíz de `/Liciapp` (fuera de `www`). El archivo es JSON UTF-8, objeto plano con `DB_PASSWORD`, `MERCADOPUBLICO_TICKET`, `SYNC_API_TOKEN` y opcionalmente `GROQ_API_KEY`. No se leen esos valores desde el entorno heredado del Pool: antes de abrir el archivo el bootstrap borra esas variables del proceso. Crea el directorio y archivo desde el administrador de archivos o mecanismo privado del hosting y concede lectura únicamente a la identidad del Pool `luminiadev-001`; el bootstrap verifica que sea un archivo regular, no un symlink, que esté fuera de la raíz web y, en sistemas POSIX, que tenga permisos `0600`. Nunca guardes el archivo en `/Liciapp`, en frontend, en `web.config` ni dentro del ZIP.

**Límite de aislamiento:** según la configuración confirmada, cinco sitios comparten `luminiadev-001`. Una ACL para la identidad de ese Pool permite lectura a los procesos de todos esos sitios, por lo que el archivo queda fuera del alcance de una descarga HTTP directa, pero no está aislado frente a código comprometido de otro sitio del mismo Pool. Además, el proceso Node.js no puede comprobar por sí solo la ACL NTFS efectiva. No debe describirse esta alternativa como aislamiento completo ni considerarse una frontera adecuada para secretos de producción. Si el panel no permite un archivo fuera de `www` con ACL controlable, no subas credenciales: hace falta que SharkASP proporcione un almacén de secretos por sitio/proceso o una identidad de ejecución separada.

Ruta esperada dada la ruta física observada del sitio: `H:\root\home\luminiadev-001\oportuna-private\secrets.json`. Confirma en el panel que esa carpeta está fuera de `www`, que el proceso puede leer el archivo y que las ACL son las esperadas; no habilites descarga HTTP para probarlo. El bootstrap informa solo si el archivo es legible y qué variables están presentes, nunca sus valores. El modo `SHARKASP_STAGING_COMPAT` conserva TLS cifrado pero no valida la identidad del certificado y sigue limitado a staging.

El inicio imprime solo nombres/estados de configuración; nunca valores secretos. Para ejecutar el diagnóstico sin iniciar Express: `node sharkasp-bootstrap.mjs --diagnose`. Para verificar tras el arranque: `node deploy/sharkasp/smoke-test.mjs`, que consulta únicamente `/` y `/api/health`.

Tras instalar, el smoke test sin autenticación ni secretos se ejecuta desde Node 18+: `node deploy/sharkasp/smoke-test.mjs`. Solo hace GET a `/` y `/api/health`, e informa si frontend, API y MySQL responden. Ejecutarlo una vez configuradas las variables privadas.

El paquete completo se prepara con `web.config.production.template`; la entrada estable es `sharkasp-bootstrap.mjs`, y el bootstrap importa el entrypoint real `dist-server/server/src/index.js` tras fijar la configuración. El panel puede conservar su `web.config` reducido a `PORT` y `NODE_ENV`.

Para repetir el empaquetado desde PowerShell en Windows x64, primero compilar (`npm ci`, `npm run build`) y ejecutar:

```powershell
.\deploy\sharkasp\Prepare-Windows-Package.ps1 `
  -Mode Production `
  -ExpectedNodeMajor VERSION_NODE_INSTALADA_EN_ESTE_WINDOWS `
  -OutputZip '.\artifacts\oportuna-sharkasp-staging.zip'
```

El empaquetador exige Windows x64, Node 18+ y crea `node_modules` con dependencias de producción. El prebuild de Argon2 incluido usa N-API y se empaca específicamente para `win32-x64` en el ZIP preparado. Nunca añadir `.env`, dumps o credenciales.

## Aplicación completa

Ver [docs/sharkasp-staging-3.7.md](../../docs/sharkasp-staging-3.7.md) para variables privadas, DB staging, migraciones, HTTPS/proxy, sustitución controlada y rollback. No desplegar hasta preparar la DB vacía y validar el proxy HTTPS.
