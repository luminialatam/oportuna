# Correo de Oportuna

Oportuna desacopla el correo del proveedor mediante `sendEmail` en `server/src/emailService.ts`.

En desarrollo, el transporte predeterminado es simulado y conserva los enlaces en una bandeja en memoria accesible solo en la aplicación local. No se envía correo real. En producción el transporte predeterminado es SMTP; el modo simulado no está permitido.

Para configurar un proveedor SMTP, define las variables privadas en el entorno de ejecución, sin agregarlas al código fuente:

| Variable | Uso |
| --- | --- |
| `EMAIL_TRANSPORT` | `smtp` para envío real; `simulated` solo en desarrollo. |
| `SMTP_HOST` | Servidor SMTP del proveedor. |
| `SMTP_PORT` | Puerto SMTP; normalmente 465 o 587. |
| `SMTP_SECURE` | `true` para TLS implícito (465); `false` para STARTTLS (587). TLS se exige en ambos casos. |
| `SMTP_USERNAME` | Usuario SMTP. |
| `SMTP_PASSWORD` | Secreto SMTP. |
| `SMTP_FROM` | Dirección remitente autorizada, sin saltos de línea. |
| `SMTP_HELO_NAME` | Nombre opcional anunciado por EHLO. |
| `SMTP_TIMEOUT_MS` | Tiempo máximo de conexión/respuesta (2.000–60.000 ms). |

`SMTP_PORT` y `SMTP_SECURE` pueden omitirse para los puertos estándar: el puerto 465 usa TLS implícito y el 587 usa STARTTLS. Si se declaran, el servicio valida que la combinación no mezcle TLS implícito con STARTTLS. En un puerto personalizado, indica explícitamente `SMTP_SECURE=true` o `false`. Los valores inválidos hacen fallar el envío antes de abrir una conexión.

El remitente debe estar autorizado por el proveedor. No se ha configurado ningún proveedor ni secreto en este repositorio. En esta copia local faltan `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD` y `SMTP_FROM`; por eso el modo actual de desarrollo sigue siendo simulado. SMTP no se puede considerar validado con un proveedor real hasta recibir estos datos y ejecutar una prueba de entrega autorizada.

El modo simulado solo está disponible en `APP_ENV=development`. Un entorno `production` o `staging` nunca cae silenciosamente en la bandeja simulada; un valor desconocido de `EMAIL_TRANSPORT` también se rechaza. Los errores SMTP devuelven códigos genéricos y no registran contraseñas, tokens, destinatarios ni enlaces.

Un fallo al enviar verificación deja la cuenta sin verificar; un fallo al enviar invitación no acepta la invitación ni crea la membresía. El endpoint de recuperación mantiene una respuesta neutra aunque el proveedor falle. Los tokens siguen limitados por sus vencimientos y uso único existentes.
