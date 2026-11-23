# Publicación: búsqueda proactiva de oportunidades

## Alcance de la migración 022

`server/migrations/022_proactive_opportunity_search.sql` crea exactamente dos tablas; no agrega columnas ni modifica datos existentes:

- `company_proactive_search_preferences`: `company_id` (PK/FK a `companies.id`), `enabled`, `frequency` (`hourly`, `daily`, `weekly`), `last_checked_at`, `last_error_code`, `updated_at`; índice `idx_proactive_search_due(enabled,last_checked_at)`.
- `company_proactive_matches`: `id` (PK), `company_id` (FK a `companies.id`), `listing_code` (FK a `licitaciones.codigo_externo`), `listing_name`, `match_level`, `match_score`, `match_reasons` (JSON), `read_at`, `dismissed_at`, `created_at`, `updated_at`; índice único `uq_proactive_match_company_listing(company_id,listing_code)` e índice `idx_proactive_match_unread(company_id,dismissed_at,read_at,created_at)`.

La 022 **no requiere la migración 020**. Obtiene criterios del perfil comercial y del catálogo de productos que ya existen en `commercial_profiles` y `company_products`; la deduplicación y las preferencias nuevas usan las dos tablas anteriores. Antes de aplicarla, confirma que estén las tablas `companies`, `licitaciones`, `commercial_profiles` y `company_products` de las migraciones existentes.

## Aplicación y comprobación

1. Confirma en el panel que no haya una compilación o despliegue SharkASP activo. Exporta un respaldo reciente de la base productiva.
2. En el administrador MySQL del hosting, selecciona la base productiva configurada para Oportuna. Confirma los prerequisitos y tipos: `companies.id`, `licitaciones.codigo_externo`, `commercial_profiles.company_id` y `company_products.company_id`.
3. Ejecuta `server/migrations/022_proactive_opportunity_search.sql` una vez en esa base, antes del despliegue del código. No ejecutes migraciones en una base distinta.
4. Verifica `SHOW CREATE TABLE company_proactive_search_preferences;` y `SHOW CREATE TABLE company_proactive_matches;`. Comprueba también `SELECT COUNT(*) FROM company_proactive_search_preferences;` y `SELECT COUNT(*) FROM company_proactive_matches;`; ambas tablas deben estar vacías al terminar la migración.
5. Si ya existía alguna tabla y la definición no coincide, detente: `CREATE TABLE IF NOT EXISTS` no repara una estructura distinta.
6. Despliega desde el panel después de la comprobación. Revisa que la API inicie y que la sección Alertas pueda leer la preferencia. No se crean preferencias activas al migrar.

## Scheduler externo

El worker existente solo ejecuta búsquedas si `PROCESS_ROLE` es `all` o `alert-worker` y `ALERT_SCHEDULER_ENABLED=true`. La configuración actual de SharkASP mantiene apagado ese worker, por lo que no se debe contar con él.

Alternativa compatible: configura un cron externo con la solicitud siguiente:

- URL: `https://tailflow.pro/api/internal/proactive-search/run`
- Frecuencia: cada 5 minutos.
- Método: `POST`, sin cuerpo.
- Autenticación: encabezado `Authorization: Bearer <SYNC_API_TOKEN>`. Guarda el valor existente de `SYNC_API_TOKEN` en el almacén de secretos del scheduler; nunca lo pegues en el repositorio, la URL ni los registros del job.

Deja el job pausado hasta que el despliegue haya publicado la ruta. Luego realiza una invocación controlada desde el scheduler y confirma HTTP 200, `failed: 0` y que el resultado no indique `locked: true`. Activa la recurrencia solo después de esa comprobación. La ruta usa el token de servicio existente, limita invocaciones, coordina rondas con un lock MySQL y procesa únicamente las empresas cuyo intervalo ya venció.

Las preferencias nacen apagadas. La interfaz puede guardar activación y frecuencia, pero advierte que no habrá búsquedas mientras no se ejecute un proceso programado. Hasta verificar migración, ruta y cron, mantén pausado el job y no anuncies la búsqueda proactiva como funcional. El proceso compara el perfil comercial y productos con el índice local existente; no consulta Mercado Público en vivo. La sincronización ya configurada debe mantener actualizado ese índice.
