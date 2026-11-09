# Oportuna — preparación para producción (Fase 3.2B)

Auditoría de solo lectura realizada el 29-10-2026. No se modificaron infraestructura, `.env`, credenciales ni datos; no se crearon servicios externos.

## 1. Arquitectura recomendada

- **Frontend:** React/Vite como sitio estático en Vercel es compatible. Conviene servir `/api` bajo el mismo origen mediante proxy/rewrite hacia la API para conservar el modelo actual de cookies `same-origin`.
- **API:** proceso Node.js persistente en un contenedor o servicio de aplicaciones que soporte Express, conexiones salientes HTTPS, apagado gradual y variables secretas. Si se usa un dominio de API separado, hay que cambiar explícitamente el cliente para enviar credenciales, habilitar CORS con credenciales y validar cookies/CSRF entre orígenes.
- **Trabajos:** proceso worker/scheduler separado de la API, conectado a la misma MySQL. Ejecutar una sola instancia de scheduler/worker o asegurar cada trabajo con una concesión distribuida durable. No depender de un navegador abierto.
- **MySQL:** instancia administrada o servidor existente con TLS verificado, red privada/lista de IP permitidas, usuario de privilegio mínimo, límites de conexiones y backups con recuperación a un punto en el tiempo.
- **IIS tradicional:** no asumir que ofrece procesos Node persistentes. Solo sirve si el proveedor confirma soporte de servicio Node/Windows Service o contenedores, reinicio supervisado, tareas en background y salida de red.

## 2. Estado y requisitos del hosting

El backend escucha actualmente en `127.0.0.1` y no permite configurar el host de escucha. Para contenedor/servicio remoto deberá escuchar en la interfaz indicada por la plataforma (normalmente `0.0.0.0`) y recibir el puerto por entorno. Hay que conservar `trust proxy` limitado al número real de proxies confiables y aplicar HTTPS en el borde.

La integración actual del frontend usa `credentials: 'same-origin'`; un API en otro origen no recibirá automáticamente la sesión. La configuración CORS actual permite un origen único, pero no configura `credentials: true`. Las cookies pasan a `Secure` en producción; usan `SameSite=Lax`. Validar el dominio/origen elegido, CSRF, inicio/cierre de sesión y renovación bajo HTTPS en staging.

La conexión MySQL utiliza pool de 8, UTC y no configura TLS en el cliente. En producción requiere conexión TLS con verificación de certificado y usuario de base de datos no privilegiado. Ajustar el tamaño de pool a la cuota real de la base de datos y número máximo de réplicas.

## 3. Variables de entorno

Nombres identificados en `.env.example` o en el código; no se inspeccionaron valores del `.env`:

| Grupo | Variables actuales | Preparación adicional |
|---|---|---|
| Servidor | `PORT`, `CLIENT_ORIGIN`, `TRUST_PROXY_HOPS` | Añadir/documentar `NODE_ENV=production`; considerar `HOST` configurable (hoy el bind es fijo). Configurar origen exacto y hops del proxy real. |
| MySQL | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Implementar/configurar TLS verificado; usuario mínimo privilegio; no reutilizar credenciales locales. |
| Mercado Público | `MERCADOPUBLICO_TICKET`, `MERCADOPUBLICO_TIMEOUT_MS`, `MERCADOPUBLICO_MIN_INTERVAL_MS`, `MERCADOPUBLICO_MAX_RETRIES` | Mantener ticket solo en secret manager/backend. La petición externa lleva ticket en query string: redactar query strings en logs, proxy, tracing y APM. |
| Sincronización | `SYNC_API_TOKEN`, `SYNC_SCHEDULER_ENABLED` | Token solo en backend/secret manager; dejar scheduler desactivado hasta desplegar un único worker y autorizarlo. |
| Groq | `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_TIMEOUT_MS` | Solo backend; limitar entrada/salida y evitar registrar prompts sensibles o headers. |

No copiar el `.env` local a hosting. Aprovisionar secretos nuevos directamente en el secret manager del entorno; separar desarrollo, staging y producción.

## 4. Riesgos principales

1. **Bloqueante de hosting:** bind a `127.0.0.1` impide el acceso desde fuera del contenedor/host.
2. **Sesiones entre dominios:** el frontend asume `same-origin`; Vercel + API en dominio distinto requiere trabajo explícito de cookies, CORS y CSRF.
3. **Límites por proceso:** rate limits HTTP y login usan mapas en memoria; reinicios los reinician y múltiples réplicas no comparten contador.
4. **Worker de enriquecimiento:** usa un guard `worker` en memoria del proceso y no hay bloqueo MySQL distribuido alrededor de `processQueue`. Dos instancias podrían reclamar trabajos distintos a la vez; el `UPDATE ... WHERE estado='pending'` impide que ambas reclamen la misma fila, pero no impone una única solicitud global ni el intervalo común por proceso. La recuperación al iniciar restablece estados `running` a `pending`; no debe ejecutarse desde varias instancias sin lease/lock distribuido.
5. **Sync:** sí usa `GET_LOCK` MySQL para creación de trabajos y worker, pero el scheduler está dentro de cada proceso. El chequeo de duplicados diarios es vulnerable a ejecuciones repetidas tras reinicio porque no se encontró clave única idempotente para la fecha diaria.
6. **Alertas:** la evaluación periódica se dispara desde el navegador autenticado cada cinco minutos; sin usuarios conectados no es fiable. Llevar la evaluación a un worker único, conservando idempotencia.
7. **Migraciones:** scripts secuenciales, aplicados manualmente; no se encontró tabla de historial/checksum. Algunas migraciones `ALTER` no son idempotentes; `012_authentication.down.sql` elimina las tablas de autenticación y sus cuentas/sesiones. Requiere registro de versión, revisión y respaldo antes de aplicar.
8. **Operación:** no se encontró procedimiento documentado de backup/restauración ni apagado gradual de servidor/pool para `SIGTERM`.
9. **Ticket MP:** al estar en la URL de salida, debe eliminarse/redactarse de logs del proveedor y herramientas de observabilidad, aunque el código no lo imprima.

## 5. Staging propuesto

1. Crear staging sin servicios contratados desde esta auditoría. Usar base vacía y datos ficticios; no copiar las licitaciones, usuarios, sesiones, perfiles, catálogo ni seguimiento locales.
2. Configurar HTTPS y dominios staging; fijar `CLIENT_ORIGIN`, proxies confiables y cookies seguras. Usar secretos separados y de prueba.
3. Aplicar migraciones revisadas una por una sobre base vacía, guardando versión y checksum. Verificar índices, claves foráneas y plan de restauración antes de cargar nada.
4. Probar login/logout, CSRF, renovación/expiración, reinicio de API, aislamiento entre empresas temporales, límites compartidos, CORS y acceso sin sesión.
5. Probar Mercado Público/Groq con llamadas pequeñas y explícitas, límites conservadores y logging redactado. No ejecutar enriquecimiento masivo.
6. Verificar worker singleton, pausa/reanudación, recuperación de proceso y jobs idempotentes. Mantener scheduler apagado hasta aprobar esos casos.
7. Ejecutar recorrido visual desktop/tablet/móvil, análisis IA de ficha real en staging solo si los datos y privacidad están autorizados, y pruebas de cookies en HTTPS.

## 6. Checklist antes de despliegue

- [ ] Resolver bind configurable y ruta de API entre frontend y backend.
- [ ] Confirmar TLS MySQL con validación de certificado y usuario de mínimo privilegio.
- [ ] Definir dominios, CORS exacto, cookies, HTTPS, CSRF y `TRUST_PROXY_HOPS`.
- [ ] Mover límites de solicitudes/login a almacenamiento compartido con expiración y política definida.
- [ ] Separar API y worker; implementar lock/lease distribuido para enriquecimiento, sincronización diaria y alertas.
- [ ] Añadir idempotencia de calendario para trabajos diarios y evitar duplicados entre instancias/reinicios.
- [ ] Añadir apagado gradual: dejar de aceptar tráfico, terminar trabajos seguros, cerrar HTTP y pool MySQL.
- [ ] Añadir readiness de DB y worker sin exponer secretos; alertar por fallos, reintentos y cola detenida.
- [ ] Redactar tickets, tokens, cookies, contraseñas, query strings sensibles y datos personales de todos los logs/APM.
- [ ] Establecer backups cifrados, retención, PITR y ensayo de restauración con métricas RPO/RTO aprobadas.
- [ ] Crear historial/checksum de migraciones, revisar scripts en staging y respaldar antes de cada cambio.
- [ ] Verificar build, pruebas, análisis del bundle, pruebas de seguridad y navegación responsive en staging.
- [ ] Autorizar de forma explícita cualquier sincronización, scheduler o enriquecimiento; mantenerlos desactivados hasta entonces.

## 7. Rollback y recuperación

1. Mantener artefacto de aplicación anterior y configuración versionada sin secretos; rollback de aplicación independiente de rollback de datos.
2. Antes de migración: snapshot consistente y prueba de que puede restaurarse. Registrar versión/checksum y duración.
3. Preferir cambios de esquema compatibles hacia delante (expandir, desplegar, migrar datos de forma controlada, contraer en una versión posterior); no ejecutar automáticamente scripts `down` destructivos.
4. Ante fallo de aplicación, volver a la versión anterior si sigue siendo compatible con el esquema. Si hubo corrupción o migración incompatible, detener workers y escrituras, restaurar snapshot/PITR en instancia aislada, verificar integridad y recién entonces conmutar.
5. Reconciliar jobs pendientes después de recuperación; conservar estados idempotentes, evitar reintentos concurrentes y confirmar contadores antes de reactivar scheduler.
6. Documentar responsables, aprobación, RPO/RTO, ventana de mantenimiento y canal de comunicación antes del primer despliegue.

## Evidencia de esta auditoría

- Rutas de configuración revisadas: `server/src/index.ts`, `server/src/db.ts`, `server/src/authMiddleware.ts`, `server/src/authService.ts`, `server/src/mercadoPublico.ts`, `server/src/syncService.ts`, `server/src/listingEnrichment.ts`, `server/src/alertService.ts`, `src/App.tsx`.
- Migraciones presentes: `001`–`012`; no se halló runner ni historial de migraciones.
- La API de sincronización tiene locks MySQL; enriquecimiento usa coordinación en memoria y reclamación por fila; alertas periódicas dependen actualmente del navegador.
- No se modificó `.env`, no se inspeccionaron sus valores, no se alteró MySQL, no se transfirieron datos y no se creó ningún recurso externo.
