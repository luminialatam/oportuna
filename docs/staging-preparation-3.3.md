# Oportuna — preparación técnica local para staging (Fase 3.3)

Esta entrega prepara el código, pero no despliega, no ejecuta migraciones, no crea servicios y no activa trabajos automáticos.

## Configuración

- `APP_ENV=development|staging|production` separa el comportamiento local del publicado. Desarrollo conserva `HOST=127.0.0.1`, no confía proxies y no marca cookies `Secure`.
- Staging/producción exigen `NODE_ENV=production`, un `PROCESS_ROLE` dedicado, host/puerto, orígenes HTTPS explícitos, número acotado de proxies confiables, MySQL con TLS y credenciales/ticket/token requeridos. Los errores nombran variables faltantes, nunca valores.
- `TRUST_PROXY_HOPS` es el número exacto de saltos confiables de Express. La red del backend debe aceptar tráfico únicamente desde esos proxies; configurar un número incorrecto puede invalidar la protección HTTPS o permitir cabeceras reenviadas falsas.
- CORS valida orígenes explícitos y habilita credenciales solo para ellos; no permite `*`. Mutaciones autenticadas siguen exigiendo origen configurado, cookie CSRF y encabezado `X-CSRF-Token`.
- En staging/producción las cookies usan prefijo `__Host-`, `Secure`, `HttpOnly` para sesión, `SameSite=Lax` y `Path=/`. Para conservar el modelo actual, usar rewrite/proxy para servir API y frontend bajo el mismo origen. Un API cross-site requiere diseño y pruebas adicionales de cookies y `credentials` del frontend.
- `DB_SSL=true` valida el certificado; `DB_SSL_CA` es opcional para la CA privada del proveedor.

## Límites compartidos y migración

- Desarrollo usa un almacenamiento en memoria para límites locales. Staging/producción usan una tabla compartida MySQL y fallan cerrados si no está disponible.
- El cambio requiere aplicar manualmente y revisar `server/migrations/013_shared_rate_limits.sql` en un entorno autorizado. **No fue aplicado** en esta fase.
- Se aplican límites a login por IP y cuenta, registro/invitación, búsquedas y análisis Groq, enriquecimiento, consultas de fichas y operaciones de sincronización. La tabla guarda hashes de claves, no correos ni direcciones IP en claro.
- La tabla elimina hasta 1.000 filas vencidas por minuto bajo carga; revisar retención y volumen en staging.

## Procesos

- `PROCESS_ROLE=web` sirve la API y no inicia recuperación ni workers.
- `PROCESS_ROLE=sync-worker`, `enrichment-worker` y `alert-worker` no abren puerto HTTP; ejecutan únicamente su función designada.
- `PROCESS_ROLE=all` conserva la ejecución local integrada y no está permitido fuera de development.
- Sync usa locks MySQL para creación, calendario diario y worker. Enriquecimiento y evaluación programada de alertas usan locks MySQL globales. El cliente Mercado Público serializa solicitudes entre procesos y conserva el intervalo mínimo mediante un lock de MySQL. Solo debe existir una instancia activa por rol; los locks son defensa adicional.
- `SYNC_SCHEDULER_ENABLED`, `ENRICHMENT_WORKER_ENABLED` y `ALERT_SCHEDULER_ENABLED` permanecen desactivados en `.env.example`. La evaluación de alertas del navegador sigue disponible; el scheduler del worker solo corre con su flag explícito.
- El servidor API hace apagado gradual y cierra el pool al recibir SIGTERM/SIGINT. El worker cierra el pool ante señales.

## Migración de configuración local

El `.env` local no se leyó ni modificó. Los nombres nuevos están documentados en `.env.example`: `APP_ENV`, `NODE_ENV`, `PROCESS_ROLE`, `HOST`, `TRUST_PROXY_HOPS`, `DB_SSL`, `DB_SSL_CA`, `ENRICHMENT_WORKER_ENABLED`, `ALERT_SCHEDULER_ENABLED` y `RATE_LIMIT_SHARED`, junto a las variables existentes.

`.gitignore` ya existe; se reforzaron exclusiones de entornos, artefactos, logs, respaldos, temporales, datos privados y credenciales. No se ejecutó `git init`. La carpeta actual no contiene `.git`, así que no se pudo revisar estado/seguimiento Git.

## Validación local

Ejecutar `npm run build`, `npm run typecheck:server` y `npm run test`. La suite temporal valida configuración, cookies, CORS, CSRF, límites locales, autenticación, módulos y aislamiento; comprueba que los 19.608 códigos de licitaciones siguen únicos. También se inició una instancia local temporal con configuración ficticia de staging: rechazó HTTP directo y `X-Forwarded-Proto: http`, aceptó HTTPS reenviado por un salto confiable y limitó CORS al origen permitido. El handshake real de cookies `Secure` no se probó sobre un certificado HTTPS real. En staging será necesario repetir con el proxy real y el almacenamiento compartido habilitado. La migración de rate limits, TLS de MySQL del proveedor y limitación compartida no se verifican contra el MySQL local porque no se aplicaron cambios de esquema.

No existe endpoint HTTP para solicitar recuperación de contraseña; la capa de servicio tiene funciones, pero no hay ruta pública que requiera limitación en este momento. No se añadió una nueva ruta en esta fase.

## Pendientes antes de staging

1. Aprobar y aplicar la migración 013 en una base de staging vacía, nunca en producción sin ensayo de respaldo/restauración.
2. Definir dominios same-origin/rewrite y comprobar cookies `__Host-` sobre HTTPS real.
3. Aprovisionar MySQL con TLS, usuario mínimo privilegio, backup/PITR y restore probado.
4. Configurar procesos separados (`web`, `sync-worker`, `enrichment-worker`, `alert-worker`), manteniendo flags automáticos apagados hasta una aprobación operativa posterior.
5. Probar failover, reinicio de procesos, límites compartidos entre réplicas y respuesta segura cuando MySQL o API no están disponibles.
