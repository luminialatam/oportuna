# Oportuna — validación de rate limits y coordinación (Fase 3.4)

Validación local. No se cambiaron `.env` ni credenciales, no hubo llamadas a Mercado Público/Groq, trabajos programados, sincronizaciones, enriquecimientos reales, cambios de perfil ni cambios en usuarios reales.

## Migración 013

- MySQL reportó versión 9.7.1.
- Antes de aplicar, `app_rate_limits` no existía. La migración contiene únicamente `CREATE TABLE IF NOT EXISTS`; no modifica otras tablas, por lo que no había tabla preexistente afectada que respaldar.
- Se aplicó y luego se volvió a ejecutar para validar idempotencia. La segunda ejecución conservó engine, collation y columnas.
- Resultado: InnoDB, `utf8mb4_unicode_ci`, clave primaria compuesta (`key_hash`,`window_start_ms`) e índice de expiración `expires_at`.
- La tabla quedó con cero filas después de limpiar todos los contadores temporales de prueba.

## Rate limits

`npm run test:shared` ejercitó los mismos espacios de claves que usan login, búsqueda, análisis, sincronización y enriquecimiento desde dos procesos Node separados. El segundo proceso observó los contadores del primero. También comprobó incrementos concurrentes, cambio de ventana, pruning de una fila vencida y limpieza de filas temporales.

`npm run test:api-shared` levantó dos instancias Express locales contra la tabla compartida. Validó las respuestas de límite en login (10 fallos por cuenta), búsqueda (30), análisis (8), creación de sync (2) y enriquecimiento (5). Las peticiones de búsqueda y sincronización fueron inválidas deliberadamente; análisis usó un código local inexistente y Groq quedó desactivado. No se creó ningún job ni se llamó a proveedor externo.

## Locks y procesos

`npm run test:coordination` comprobó exclusión mutua interproceso para los locks de sync, enrichment, alertas y solicitudes Mercado Público. Al detener al proceso propietario del lock, otro proceso lo adquirió inmediatamente. Las dos API de prueba también cerraron con SIGTERM y salida normal.

No se ejecutaron handlers de workers ni reintentos de jobs. La prueba valida los locks MySQL usados por esos handlers y la recuperación al liberar; una prueba de retry del proceso de negocio debe realizarse con fixtures de job aislados antes de activar workers en staging.

## Seguridad e integridad

- `npm run test` pasó: configuración, rate limits, coordinación, CORS, CSRF, cookies HttpOnly/SameSite, autenticación y QA funcional.
- Las pruebas funcionales apuntaron a una API local con Groq desactivado. Las solicitudes de análisis usaron códigos inexistentes para no llamar a Mercado Público.
- `npm run build` y `npm run typecheck` pasaron. El bundle no mostró patrones de credenciales.
- MySQL terminó con 19.608 licitaciones y 19.608 códigos únicos; no quedaron empresas/usuarios temporales, jobs de test, filas temporales de rate limit ni locks ocupados.
- La configuración de cookies `Secure` se valida en el modo staging, pero no se hizo handshake TLS con certificado real en esta validación local.

## Estado

El almacenamiento compartido y los locks quedan validados localmente entre procesos. Staging sigue pendiente de HTTPS/cookies con certificado real, MySQL TLS del hosting y una ejecución de reintento de job con fixtures aislados. No se desplegó nada ni se inició Git.
