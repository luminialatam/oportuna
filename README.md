# Oportuna

Aplicación local para consultar, organizar y sincronizar licitaciones de Mercado Público. La autenticación local usa usuarios, membresías de empresa y sesiones de servidor.

## Requisitos

- Node.js 20 o superior
- MySQL 8
- Ticket API de Mercado Público solicitado a través de ChileCompra

## Preparar entorno

1. Instala dependencias con `npm install`.
2. Configura las variables de servidor en `.env` usando `.env.example` como referencia. No se requieren credenciales en el frontend.
3. Ejecuta en orden las migraciones base e incrementales documentadas en `server/migrations/`. Revisa los prerequisitos de cada función; las migraciones 022 y 023 agregan búsqueda proactiva y avisos por email; la 024 agrega el libro de precios base por empresa.
4. Inicia ambos servicios con `npm run dev` y abre `http://127.0.0.1:5173`.

Para el primer acceso, crea **un** administrador de plataforma con `npm run auth:bootstrap` desde una Terminal interactiva. La contraseña se ingresa oculta. Esta cuenta no queda asignada a ninguna empresa. El administrador puede revisar y reclamar explícitamente el espacio local heredado una sola vez; no se realiza un vínculo automático. No ejecutes el bootstrap si ya existe un administrador.

## Autenticación y seguridad

- Contraseñas hasheadas con Argon2id; las sesiones son tokens aleatorios cuyo hash se guarda en MySQL.
- Cookie de sesión `HttpOnly`, `SameSite=Lax`; cookies `Secure` y prefijo `__Host-` en producción HTTPS.
- Las mutaciones desde la aplicación exigen origen permitido y token CSRF ligado a la sesión.
- La sesión determina la empresa activa; perfiles, catálogo, seguimiento y alertas operan bajo el contexto autorizado del servidor.
- Administradores de empresa gestionan perfil, catálogo, miembros e invitaciones. Colaboradores acceden a búsqueda y seguimiento.
- Las rutas `/api/sync/*` aceptan el token de servicio existente o una sesión administradora con CSRF. El token de sincronización no se usa como sesión de usuario.
- Las invitaciones son de un solo uso y se entregan manualmente por ahora. No hay correo de invitación configurado.
- Se prepararon tablas y servicios internos de recuperación de contraseña, pero la recuperación pública permanece deshabilitada hasta configurar un canal seguro de entrega.
- El primer administrador de plataforma se crea desde la consola local. Protege el acceso al host y usa HTTPS confiable antes de publicar.

## API

- `GET /api/health`: estado general, sin revelar credenciales.
- `POST /api/auth/login`, `GET /api/auth/session`, `POST /api/auth/logout`: sesión de usuario.
- `POST /api/auth/register`: registro únicamente con invitación válida.
- `POST /api/auth/company`: cambia a una membresía activa autorizada.
- `GET /api/licitaciones` y `GET /api/licitaciones/:codigo/local`: lectura de datos públicos almacenados; la ficha local no llama a Mercado Público.
- `POST /api/licitaciones/:codigo/refresh`: actualización oficial explícita, solo para administración de empresa.
- `POST /api/sync/licitaciones` y demás `/api/sync/*`: sincronización autorizada por token de servicio o administrador.
- `/api/company/*`, `/api/alerts/*`, `/api/buscador/search` y `/api/buscador/analysis/*`: requieren sesión, empresa activa y protección CSRF para mutaciones.
- `/api/analytics`: agrega las fichas locales con filtros de período, modalidad, producto, comprador, región y estado; incluye exportación CSV y vistas guardadas por empresa y usuario.

## Proyecto

- `src/`: interfaz React + TypeScript, Tailwind y Lucide.
- `server/src/`: API Express, autorización y servicios de Mercado Público.
- `server/migrations/`: esquema inicial y migraciones incrementales.
- `.env.example`: plantilla sin credenciales.

No se ejecutan migraciones, se crean usuarios ni se vincula la empresa heredada automáticamente al arrancar el servidor.
