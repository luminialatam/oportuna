# Worker local de sincronización para macOS

El LaunchAgent ejecuta únicamente `PROCESS_ROLE=sync-worker`. Mantiene activo el scheduler existente mediante `SYNC_SCHEDULER_ENABLED=true`; no declara `StartCalendarInterval` y, por tanto, no crea un segundo reloj. El horario sigue siendo el scheduler de Oportuna: 08:00 en `America/Santiago`.

El plist no contiene credenciales. El proceso carga la configuración privada del backend desde el entorno local existente. Enrichment y alertas quedan explícitamente desactivados. `RunAtLoad` inicia la recuperación al iniciar sesión y `KeepAlive` vuelve a arrancar el worker tras una caída, con espera de 30 segundos.

## Comandos

Desde la raíz del proyecto:

```sh
bash scripts/launchd/oportuna-sync-worker status
bash scripts/launchd/oportuna-sync-worker start
bash scripts/launchd/oportuna-sync-worker replace
bash scripts/launchd/oportuna-sync-worker stop
```

`start` no inicia un segundo worker si detecta uno ya activo. `replace` es la transición controlada para sustituir el worker iniciado desde una terminal: verifica MySQL local y exige cero trabajos en cola, activos o pausados; luego detiene ese único proceso y carga el LaunchAgent. Si hay trabajo pendiente, no interrumpe el proceso. `stop` descarga el servicio (y quita su plist de `~/Library/LaunchAgents`) o detiene un worker de terminal, solo después de verificar que no hay trabajos pendientes/activos/pausados. `status` muestra el proceso, estado del scheduler, próxima ejecución, últimas fechas y progreso.

El comando de consulta de launchd subyacente es:

```sh
launchctl print "gui/$(id -u)/com.oportuna.sync-worker"
```

## Logs y rutas

El supervisor escribe en `~/Library/Logs/Oportuna/sync-worker.log`, con rotación de 5 MiB y cuatro archivos archivados (máximo aproximado 25 MiB). Los errores de SMTP nunca incluyen credenciales o tokens.

El plist usa las rutas absolutas de esta copia local y Node `v24.16.0` bajo `~/.nvm`. Si el proyecto o Node se mueve/actualiza, valida y corrige el plist antes de ejecutar `replace`. No se instaló ni cargó el LaunchAgent al preparar este documento.
