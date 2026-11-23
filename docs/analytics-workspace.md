# Analítica de Oportuna

La vista `/inteligencia-mercado/analitica` presenta análisis sobre las fichas y partidas que Oportuna tiene indexadas localmente. No usa cifras simuladas ni convierte presupuestos estimados en ventas.

## Vistas

- **Mercado:** actividad mensual, modalidades observadas, estados oficiales y actividad regional.
- **Compradores:** organismos ordenados por fichas indexadas en el período.
- **Productos:** categorías y partidas encontradas. Los importes por producto no se calculan mientras las partidas no tengan precios comparables.
- **Competidores:** solo adjudicatarios explícitos detectados en payloads oficiales detallados de procesos adjudicados.
- **Mi desempeño:** distribución de oportunidades de la empresa activa según su estado en Seguimiento.
- **Personalizado:** filtros reutilizables guardados por empresa y usuario.

## Filtros y fuentes

Los filtros usan fecha de publicación y recurren a la última sincronización local si falta. Región proviene de `Comprador.RegionUnidad` o `Comprador.Region`; modalidad toma el campo disponible y, como último recurso, el código incluido en el identificador. El texto de producto busca en partidas indexadas. El API exporta hasta 20.000 fichas a CSV con las mismas condiciones.

El presupuesto se muestra como total solo si todas las fichas filtradas tienen un monto y una moneda explícita CLP. En otro caso se indica «No comparable» y se informa cuántas fichas sí incluyen CLP. La serie mensual cuenta fichas, no ventas.

## Persistencia

La tabla `analytics_saved_views` requiere ejecutar `server/migrations/018_analytics_saved_views.sql` después de las migraciones previas. La clave única de vistas usa empresa, usuario y nombre; cada lectura, edición y eliminación vuelve a comprobar el propietario.

## Verificación local

`npm run test:analytics-filters` cubre fechas, filtros permitidos y parámetros SQL. `npm run build` valida los componentes frontend y backend.
