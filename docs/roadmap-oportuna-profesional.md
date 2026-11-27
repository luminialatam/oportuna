# Oportuna: plan de evolución profesional

## Tesis de producto

Oportuna debe ayudar a una pyme a **encontrar, evaluar, preparar, presentar y aprender de oportunidades públicas rentables**. Su valor no se mide por cantidad de pantallas ni por puntajes llamativos, sino por tiempo ahorrado, decisiones mejor fundamentadas, ofertas presentadas a tiempo y margen real protegido.

La app ya cuenta con búsqueda, perfil y catálogo de empresa, coincidencias, seguimiento, calendario, alertas, preparación económica de ofertas, analítica y controles multiempresa. La prioridad es convertir esas capacidades en un flujo continuo y confiable, con evidencia visible y resultados registrados.

## Principios no negociables

- Distinguir siempre dato oficial, dato calculado por Oportuna, estimación del comprador y dato ingresado por la empresa.
- No mostrar puntaje textual como probabilidad de ganar. No llamar venta o ingreso a un presupuesto referencial.
- Cada recomendación de IA debe indicar fuente, fragmento/página cuando exista, fecha de consulta y qué falta confirmar.
- La empresa mantiene la decisión final y presenta su oferta en el canal oficial mientras no exista integración formal que permita otra cosa.
- El pipeline, los permisos y las métricas respetan empresa, usuario y rol. No se mezclan espacios.
- Cada mejora se despliega desde GitHub Actions. Sin cargas manuales de archivos al hosting.

## Roadmap por etapas

### 1. Cockpit de gestión diaria — en curso

Convertir el inicio en una vista de acción: próximos cierres de oportunidades guardadas, ofertas en preparación, pendientes de decisión y alertas. Cada bloque debe abrir directamente la licitación o etapa correspondiente. Los números deben provenir del seguimiento real y explicitar el período y la fuente.

**Resultado esperado:** el usuario entiende qué requiere atención hoy en menos de un minuto.

### 2. Bandeja de oportunidades con decisión explicable

Unificar coincidencias nuevas y guardadas en una bandeja con estados claros: nueva, por revisar, en evaluación, preparar oferta, presentada, resultado conocido y descartada. Para cada oportunidad mostrar:

- Razones de encaje ligadas al perfil/catálogo y a evidencia de la ficha.
- Estado oficial, comprador, fecha de cierre, moneda y fecha de última verificación.
- Lista de datos faltantes y alertas de plazo.
- Acción recomendada y siguiente paso, sin decidir automáticamente por el usuario.
- Filtros útiles: fecha de cierre, región, tipo de proceso si la fuente lo permite, comprador y estado.

**Resultado esperado:** menos oportunidades irrelevantes y menos tiempo perdido revisando fichas incompletas.

### 3. Evaluación comercial y rentabilidad antes de ofertar

Extender el cálculo existente por partida para incluir costos directos, logística, instalación, impuestos/costos aplicables, garantías, costos financieros y contingencia, según los datos que la empresa ingrese. Permitir comparar escenarios de precio, margen mínimo, capacidad/stock y plazo de entrega. Mostrar qué supuestos faltan y sensibilidad del margen.

**Resultado esperado:** evaluar si participar antes de dedicar horas a preparar documentos y evitar ofertas que destruyen margen.

### 4. Asistente de bases con trazabilidad

Procesar bases y anexos admitidos, extraer requisitos obligatorios, criterios/puntajes, fechas, garantías y documentos. Cada dato debe enlazar al archivo y página de origen. Separar “requisito detectado”, “revisión humana pendiente” y “cumplido según dato de empresa”. Producir checklist editable y borrador de respuesta usando documentos autorizados de la empresa, con control de versiones.

**Resultado esperado:** convertir documentos extensos en trabajo verificable, sin inventar requisitos o declarar cumplimiento por inferencia.

### 5. Trabajo colaborativo y automatizaciones útiles

Asignar responsable y suplente, comentarios con menciones, tareas con vencimientos, historial de cambios y notificaciones configurables. Agregar vistas guardadas por línea de negocio y reglas automáticas transparentes (por ejemplo, avisar cuando una coincidencia alta cierre pronto). Exportar o conectar por API/webhooks solo después de resolver permisos, límites y soporte.

**Resultado esperado:** un equipo sabe quién hace qué y qué está atrasado sin perseguirse por mensajes.

### 6. Resultados, aprendizaje y analítica de ventas

Registrar resultado oficial (adjudicada, no adjudicada, desierta/revocada, retirada/no presentada), monto adjudicado cuando esté disponible, oferta propia y costos/margen real ingresados por la empresa. Comparar por producto, comprador, proceso, región y período. Marcar cobertura de datos y no publicar tasas cuando la muestra sea insuficiente.

**Resultado esperado:** responder “qué ofertas nos dejan margen y dónde conviene competir” usando historial real, no montos estimados.

### 7. Producto SaaS y crecimiento sostenible

Onboarding guiado basado en calidad del perfil/catálogo, importación asistida, permisos por rol, límites de plan visibles, historial/auditoría, soporte contextual y facturación cuando las capacidades base sean confiables. Ofrecer módulos por valor entregado (búsqueda, equipo, análisis, preparación) en vez de bloquear acciones esenciales de forma confusa.

**Resultado esperado:** que una empresa pueda llegar a su primera decisión útil sin asistencia y entienda qué obtiene por su plan.

## Secuencia recomendada

1. Mejorar la página de inicio con prioridades del seguimiento y cierres cercanos.
2. Cerrar la trazabilidad del estado y de la última verificación en oportunidades.
3. Completar el ciclo de resultado de una postulación y registrar economía real.
4. Construir la decisión comercial por oportunidad y evaluación económica ampliada.
5. Agregar lectura de bases con evidencia, checklist y revisión humana.
6. Escalar colaboración, automatizaciones y analítica de resultados con datos suficientes.

No conviene empezar por chatbot general, predicciones de adjudicación ni integraciones numerosas: sin fuentes limpias y resultados de empresa, producen una experiencia vistosa pero poco confiable.

## Indicadores de producto

- Tiempo desde detectar una oportunidad hasta decidir si se evalúa.
- Porcentaje de oportunidades guardadas con responsable, decisión y siguiente acción.
- Cierres vencidos sin actividad y tareas completadas a tiempo.
- Ofertas presentadas con costos y margen revisados antes de enviar.
- Resultados de postulaciones registrados y proporción con dato oficial verificable.
- Margen real por categoría/comprador, solo cuando el usuario haya ingresado costos y resultado.
- Tasa de errores de extracción y requisitos corregidos por revisión humana.

Los indicadores deben tener denominador, período, filtros y cobertura de datos a la vista.

## Referencias de mercado

La documentación pública de LicitaLAB describe un dashboard con feed de cambios y reportes, negocio sugerido, actividad de seguimiento, fechas próximas y distintos análisis de mercado. Sus planes también presentan flujo de preparación/postulación, coordinación de equipo, IA, historial comercial e integración de datos. Son referencias funcionales observadas en material público del proveedor, no una evaluación independiente de sus resultados: [Inicio: feed y reportes](https://help.licitalab.cl/es-cl/articles/43-inicio-feed-y-reportes), [planes y características](https://www.licitalab.cl/planes), [LIA](https://www.licitalab.cl/lia).

La oportunidad para Oportuna es competir con una experiencia más clara para pymes: datos verificables, criterio de rentabilidad visible, foco por empresa y un recorrido simple desde la coincidencia hasta el resultado.
