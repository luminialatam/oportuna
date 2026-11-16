# Despliegue de Oportuna con SharkASP GitHub Deploy / Railpack

## Ruta compatible

Para el sitio `luminiadev-001-site5`, la ruta de este PR es GitHub Deploy con Railpack en Linux, Node.js 22. El último intento observado ejecutó Railpack en Linux/Node 22. El artefacto Windows/IIS del PR anterior no correspondía a ese runtime y se retiró: no se debe configurar ni ejecutar `sharkasp-bootstrap.mjs` como comando de inicio de Railpack. Los workflows de diagnóstico/reparación Web Deploy que ya existen son operaciones IIS separadas y no forman parte de esta ruta.

La instalación de dependencias la realiza Railpack antes del comando de construcción. El fallo `EBUSY` se produjo porque `npm ci` volvió a borrar `node_modules/.vite` después de aquella instalación. No se debe repetir `npm ci` ni `npm install` en el campo de construcción.

## Campos del panel

En GitHub Deploy/Railpack del sitio:

| Campo | Valor |
| --- | --- |
| Versión de Node.js | `22` (el `engines.node` del proyecto fija `22.x`) |
| Comando de construcción / Build Command | `npm run build` |
| Comando de inicio / Start Command | `npm start` |

`npm start` ejecuta `node dist-server/server/src/index.js`; ese archivo se genera junto con `dist/` mediante el build. Express sirve el frontend compilado y la API en el mismo proceso/origen. Railpack asigna `PORT`; Express lo consume y, si no se define `HOST`, escucha en `0.0.0.0`. El soporte de `HTTP_PLATFORM_PORT` y el loopback de IIS se conservan en la configuración común, pero no se usa ningún bootstrap ni paquete Windows en esta ruta.

No añadas `npm ci &&` al comando de construcción. Railpack ya instala una vez las dependencias; CI reproduce explícitamente `npm install` seguido de `npm run build`.

## Variables del proceso

Configura las variables existentes del proceso Railpack en la sección **Variables** del servicio de GitHub Deploy. No pongas secretos en el repositorio, comandos, logs ni artefactos. El arranque en staging/producción exige estos nombres:

- `APP_ENV=production`, `NODE_ENV=production`, `PROCESS_ROLE=web`
- `PORT` lo asigna Railpack; `HOST` se puede omitir (por defecto `0.0.0.0`).
- `CLIENT_ORIGIN` con el origen HTTPS exacto de la aplicación (por ejemplo, el dominio asignado al sitio).
- `TRUST_PROXY_HOPS` con el número real de proxies confiables delante del contenedor (entre 1 y 5).
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL=true`; opcionalmente `DB_SSL_MODE`, `DB_SSL_CA` y `DB_SSL_CA_SHA256` según la configuración TLS disponible. El modo predeterminado es `VERIFY_IDENTITY`.
- `MERCADOPUBLICO_TICKET` y `SYNC_API_TOKEN` (este último debe tener al menos 32 caracteres).

La app no lee secretos desde el archivo externo del bootstrap IIS al iniciar con `npm start`; el proveedor debe inyectarlos al proceso. El checkout local solo confirmó que existen nombres de secretos Web Deploy para IIS, no que Railpack tenga disponibles sus variables de runtime. No hace falta crear claves nuevas si el almacén seguro actual ya contiene los valores requeridos; hay que asociar esos valores al proceso Railpack bajo los nombres que espera Oportuna.

El correo de verificación, invitación y recuperación usa SMTP en producción. Para habilitar esos flujos, configura `EMAIL_TRANSPORT=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, `SMTP_PASSWORD` y `SMTP_FROM`; `SMTP_HELO_NAME` y `SMTP_TIMEOUT_MS` son opcionales. Sin esa configuración el proceso puede arrancar, pero no podrá entregar esos correos. `GROQ_API_KEY` solo es necesaria para las funciones de análisis que la usan.

## CI y límites

El workflow `CI` mantiene la suite existente en un job aislado y agrega otro job Linux que ejecuta, en orden, `npm install --no-audit --no-fund`, `npm run build` y `npm run test:railpack-runtime`. El test inicia el comando real `npm start` con datos de configuración ficticios, verifica Argon2id en el runtime Linux x64, el binding `0.0.0.0`/puerto, `/`, los assets y `/api/health`. El endpoint de salud intenta una conexión solo a `127.0.0.1:1`; espera `mysql:false`. No contacta una base real, ChileCompra, SMTP ni Groq.

CI no publica ni reinicia el sitio. No ejecuta migraciones. No informa que producción funciona sin un smoke test posterior al despliegue real.

## Referencias de configuración

- [Railpack: Node.js](https://railpack.com/languages/node/) describe instalación automática, selección de versión y detección del comando de inicio.
- [Railpack: configuración de build y deploy](https://railpack.com/config/file) documenta comandos explícitos para build e inicio.
- [Railway: Build Configuration](https://docs.railway.com/builds/build-configuration) explica que el build command personalizado corre después de instalar dependencias.

La página de SharkASP observada para GitHub Deploy termina en **Deploy Now**; este repositorio no ha confirmado una API propia de SharkASP para invocar el deploy desde Actions ni un mecanismo seguro para reciclar el servicio. Este PR se limita al flujo Railpack que el panel ya ejecuta y a validarlo en CI; no intenta publicar ni reiniciar producción.
