# Oportuna — Configuración Node.js SharkASP (Fase 3.6)

Estado: configuración preparada y validada localmente. No se activó Node en el panel, no se subieron archivos y no se desplegó.

## Valores de aplicación

| Campo | Valor |
|---|---|
| Sitio | `luminiadev-001-site5` |
| Carpeta de aplicación | `/Liciapp` |
| Módulo | `Node.JS + httpPlatforma` |
| Entry inicial (smoke) | `dist-server\server\src\sharkAspSmokeServer.js` |
| Entry Oportuna completa | `dist-server\server\src\index.js` |
| Puerto | No fijar número. `web.config` asigna `PORT=%HTTP_PLATFORM_PORT%`. |
| Host del proceso | `127.0.0.1` |

SharkASP documenta crear la aplicación Node al seleccionar la carpeta objetivo en **Hosting Control Panel → Websites → Manage Website → Node.js**. Para httpPlatform, el ejecutable se indica en `processPath` y el archivo de inicio en `arguments`; la guía usa un argumento relativo como `app.js`. La guía de control panel confirma el selector de carpeta: [activar Node.js en carpetas](https://www.sharkasp.net/support/kb/a2383/how-to-enable-node_js-to-certain-folders-from-your-hosting-account.aspx). La guía de Node confirma `%HTTP_PLATFORM_PORT%` mapeado a `PORT` y una ruta de ejecutable Node: [Node.js + HttpPlatform](https://www.sharkasp.net/support/kb/a2471/how-to-use-a-custom-node_js-executable.aspx).

La documentación confirma que Node se habilita sobre la carpeta seleccionada, pero no demuestra si esta cuenta expone esa carpeta en `/` o en una ruta URL `/Liciapp`. Oportuna y Vite usan rutas desde raíz (`/assets`, `/api`), por lo que **la aplicación debe quedar mapeada al origen raíz** `https://luminiadev-001-site5.ltempurl.com/`. Confirmar que `/Liciapp` es la raíz física del sitio y no un subdirectorio virtual. Si el panel la expone como `/Liciapp`, no activar todavía; esa ruta no coincide con el base path actual.

En este build el archivo real **no** está en `dist-server/index.js`. `tsconfig.server.build.json` conserva las carpetas fuente bajo `dist-server`, así que el path correcto relativo a `/Liciapp` es `dist-server\server\src\index.js`. No hace falta launcher adicional: `package.json` declara ES modules y el archivo compilado es `.js`.

## Archivos de configuración

- [web.config.template](/Users/stef/Documents/Documentos%20-%20MacBook%20Pro%20de%20Stef/Stef/oportuna/deploy/sharkasp/web.config.template): modo smoke inicial sin base ni credenciales; solo React y `/api/health`.
- [web.config.production.template](/Users/stef/Documents/Documentos%20-%20MacBook%20Pro%20de%20Stef/Stef/oportuna/deploy/sharkasp/web.config.production.template): entrypoint de Express completo, cookies seguras y variables de staging; conserva placeholders para path de `node.exe` y cantidad de proxies.
- [Prepare-Windows-Package.ps1](/Users/stef/Documents/Documentos%20-%20MacBook%20Pro%20de%20Stef/Stef/oportuna/deploy/sharkasp/Prepare-Windows-Package.ps1): empaqueta desde Windows x64, instala dependencias de producción nativas en ese sistema y crea el ZIP.

Ambas configuraciones usan `httpPlatformHandler`, una sola instancia, salida stdout desactivada y puerto dinámico. El placeholder de `processPath` debe cambiarse por la ruta proporcionada por SharkASP o por el `web.config` generado por su panel. No se inventa una ruta física. La configuración production conserva `TRUST_PROXY_HOPS` sin resolver hasta confirmar qué proxies y cabeceras procesa la cuenta.

## Orden de activación en SharkASP

1. Antes de entrar en modo operativo, conservar intacta la página `index.html` actual; el paquete deja el `index.html` de React en `dist/index.html`, no en la raíz.
2. En **Websites → Manage Website → Node.js**, elegir `luminiadev-001-site5`, seleccionar `/Liciapp` y crear/habilitar una aplicación Node. Confirmar en el panel que su URL efectiva es `/`.
3. Elegir `Node.JS + httpPlatforma`.
4. Usar la configuración de smoke para el primer arranque. Sustituir `processPath` con el Node executable path exacto que muestre el panel; o conservar el archivo de configuración que el panel genere si contiene el handler requerido y adaptar sus `arguments` a `dist-server\server\src\sharkAspSmokeServer.js`.
5. Subir/extractar el paquete smoke dentro de `/Liciapp`, no sobre el root del sitio. El ZIP final se debe generar en Windows x64 con Node major igual al que SharkASP confirma. No se preparó ni subió el ZIP Windows porque este equipo es macOS arm64 y falta la versión Node del hosting.
6. Configurar el root HTTPS en navegador y hacer las pruebas smoke indicadas abajo. No escribir credenciales.
7. Solo tras aprobar smoke, certificado/proxy y MySQL staging independiente, se podría sustituir el entrypoint por `dist-server\server\src\index.js`, aplicar `web.config.production.template`, cargar variables privadas en el panel y reciclar la aplicación. Esta fase no hace ese cambio ni activa la aplicación completa.

## Smoke inicial — sin secretos ni MySQL

El entry `sharkAspSmokeServer.js` usa Express, escucha en `PORT` o `HTTP_PLATFORM_PORT`, sirve el React compilado desde `/Liciapp/dist` y no importa `db.ts` ni servicios de autenticación. Solo permite:

- `GET /` y rutas del frontend → React.
- `GET /api/health` → `{"ok":true,"mode":"iis-smoke","database":"not-connected","credentials":"not-used"}`.
- Otros `/api/*` → 503 mientras dura la prueba.

Al probar el host HTTPS, se espera HTTP 200 en raíz y health y HTTP 503 en otra ruta API. Este modo confirma que IIS inicia Node, el puerto dinámico funciona y React/Express comparten origen; no valida DB, login, proxy de cookies, Groq ni Mercado Público. Al acabar, detener la app o cambiar a configuración completa únicamente en una fase autorizada posterior.

## Paquete Windows y Argon2

El backend requiere Node 18 o superior (usa `fetch` global) e importa Argon2 nativo. El entorno local observado es Node `v24.16.0`, `darwin arm64`; no es compatible para copiar su `node_modules` a Windows x64 ni se conoce el Node major instalado en SharkASP. Por eso el ZIP final no se generó en Mac. El script PowerShell exige correr en Windows x64, instalar dependencias con `npm ci --omit=dev` allí y coincidir con el Node major confirmado en el panel. Incluye `dist`, `dist-server`, package manifests, `web.config` final y dependencias de producción. No incluye `.env`, base de datos, secretos o archivos de respaldo. No ejecuté ni probé el script PowerShell porque no hay PowerShell/Windows en este entorno.

## HTTPS observado

Comprobación pública sin cookies ni credenciales el 2026-10-30: HTTPS respondió 200 y la validación de certificado de `curl` fue 0. HTTP respondió 200 y no redirigió. El modo smoke no envía datos sensibles; aun así, antes del login debe configurarse una redirección o bloqueo HTTP en el panel y confirmar que el proxy proporciona `X-Forwarded-Proto` confiable a Express.

## Datos pendientes del panel (no enviar secretos por chat)

1. Versión/major exacto Node.js x64 y path de `node.exe` que se usará con httpPlatform.
2. Confirmar si crear Node app en `/Liciapp` define ese directorio como root físico y cwd para argumentos relativos; obtener el path solo si el panel lo requiere.
3. Confirmar que la aplicación Node creada para `/Liciapp` se monta en el URL `/` y no en `/Liciapp`.
4. Confirmar que el panel acepta el `web.config` generado/manual y habilita `httpPlatformHandler` en esa carpeta.
5. Confirmar el número de proxies confiables y saneamiento de `X-Forwarded-Proto`; producción no arranca sin `TRUST_PROXY_HOPS` válido.
6. Confirmar el almacenamiento privado de variables por sitio/proceso y límites/reinicio de aplicación.
7. Confirmar permisos, memoria, archivos y que la instalación nativa de Argon2 (o su prebuild) funciona con su Node.
8. Para el modo completo: aprovisionar DB staging vacía con TLS antes de proveer `DB_*`; no copiar MySQL local.

## Validación local de esta fase

- El build generó `dist-server/server/src/index.js` y `dist-server/server/src/sharkAspSmokeServer.js`.
- El smoke compilado usó `HTTP_PLATFORM_PORT` sin `PORT` configurado: `/api/health` devolvió `ok:true`, `database:not-connected`, `credentials:not-used`; `/` respondió 200 y otras rutas `/api/*` 503.
- `npm run build` y `npm run typecheck` pasaron.
- No se modificó `.env`, no hubo conexiones a proveedores ni MySQL de staging y no se subió contenido.
