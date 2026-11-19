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

El remitente debe estar autorizado por el proveedor. No se ha configurado ningún proveedor ni secreto en este repositorio. En esta copia local faltan `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD` y `SMTP_FROM`; por eso el modo actual de desarrollo sigue siendo simulado. SMTP no se puede considerar validado con un proveedor real hasta ejecutar la comprobación administrativa y confirmar una entrega autorizada.

El modo simulado solo está disponible en `APP_ENV=development`. Un entorno `production` o `staging` nunca cae silenciosamente en la bandeja simulada; un valor desconocido de `EMAIL_TRANSPORT` también se rechaza. Los errores SMTP se reducen a códigos como `SMTP_TIMEOUT`, `SMTP_CONNECTION_FAILED`, `SMTP_4xx` o `SMTP_5xx`. El log registra solo el propósito del correo y ese código; nunca incluye contraseña, token, destinatario, asunto ni contenido.

El endpoint administrativo `POST /api/platform/email/smtp-check` requiere sesión, CSRF y rol administrador de plataforma. Abre una conexión TLS, ejecuta EHLO y autenticación SMTP y cierra la sesión sin enviar un correo. Devuelve solo `SMTP_AUTHENTICATED` o un código de fallo sanitizado; no devuelve ni registra configuración, credenciales, direcciones ni tokens. Una comprobación exitosa valida la conexión/autenticación, pero no prueba que un mensaje llegue a la bandeja del usuario. No ejecutar este chequeo desde una ruta pública.

### Comprobación puntual al iniciar en producción

Para una comprobación única cuando ninguna persona administradora puede iniciar sesión, configura temporalmente `SMTP_STARTUP_PROBE_ONCE=true` en las variables de entorno del proceso Node de este sitio (no en `secrets.json`: el bootstrap solo permite allí las claves privadas enumeradas). Al iniciar, después de que el servidor HTTP ya está escuchando, Oportuna llama una vez a `probeSmtp()` con la misma configuración que usa el envío normal. La comprobación se ejecuta en segundo plano, autentica y cierra la conexión sin enviar correo; un fallo no impide que la aplicación arranque.

Busca exactamente uno de estos registros: `[email] startup_smtp_probe result=success` o `[email] startup_smtp_probe result=failed code=SMTP_…`. No incluyen host, puerto, usuario, remitente, respuesta SMTP cruda ni secretos. Después de obtener el resultado, quita `SMTP_STARTUP_PROBE_ONCE` o configúralo como `false` en el entorno del proceso para que un reinicio futuro no vuelva a ejecutar la comprobación. Si el panel requiere reiniciar el proceso para aplicar el cambio, reinicia solo la aplicación Node de este sitio, nunca el pool compartido.

Esta comprobación confirma únicamente conexión y autenticación SMTP. No envía un mensaje y no prueba la aceptación de un mensaje por el relay ni su llegada al buzón. No la confundas con la prueba de reenvío de verificación.

Si falla SMTP durante el registro, Oportuna conserva la cuenta pendiente, inicia una sesión y muestra que no se confirmó el envío. La persona puede entrar con la contraseña que eligió y usar **Reenviar enlace**; el reenvío rota el token anterior incluso si el nuevo envío falla. Repetir el registro no crea duplicados y ofrece iniciar sesión si ya se había comenzado.

Un fallo al enviar invitación no acepta la invitación ni crea la membresía. Recuperación de contraseña conserva una respuesta pública neutral para cuentas existentes y no existentes. La interfaz informa que recibió la solicitud y condiciona la llegada del enlace a que la cuenta exista y el correo funcione; el servidor registra el código SMTP solo si intentó el envío. Los tokens siguen limitados por sus vencimientos y uso único existentes.

Para recuperar una cuenta que pudiera haberse creado en un intento previo, no se consulta ni modifica producción: intenta iniciar sesión con la contraseña elegida. Si la cuenta quedó pendiente, aparecerá la pantalla de verificación con **Reenviar enlace**. El acceso a correo no se confirma hasta que el SMTP acepte el mensaje; su llegada a la bandeja requiere confirmación externa.
