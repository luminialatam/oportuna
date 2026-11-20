# Oportuna: production guardrails

## SharkASP / tailflow.pro

- Hosting site: `luminiadev-001-site5`; app root: `/Liciapp`.
- The Node startup file is `sharkasp-bootstrap.mjs`.
- Build with `npm run build:sharkasp`; the GitHub deployment start command is `node sharkasp-bootstrap.mjs`.
- SharkASP's GitHub deployment post-processing has been observed replacing the correct `web.config` with empty handlers and SPA rewrite rules. This produces HTTP 503 and sends API paths away from Node, even when the deployment history says “Éxito”.
- After every SharkASP deployment, inspect the live `/Liciapp/web.config`. It must contain the `httpPlatformHandler` mapping for `path="*"`, launch `sharkasp-bootstrap.mjs`, pass `%HTTP_PLATFORM_PORT%`, and contain no `rewrite` rules. If SharkASP rewrote it, restore the versioned root `web.config` / `deploy/sharkasp/web.config.production.template` in the hosting file manager.
- A successful build/copy is not a production health check. Before marking a deployment complete, verify externally that `/`, `/api/health`, and `/api/auth/email-mode` return HTTP 200, that health reports `mysql: true`, and that the root HTML references compiled hashed assets (never `/src/main.tsx`).
- Avoid another deployment while a SharkASP deployment is queued or compiling. Do not recycle the shared hosting pool as a routine recovery step.
- Do not send verification or recovery emails during deployment checks. SMTP connection probes are separate from message delivery and must not trigger a mail send.

## Admin account management

- Platform admins use `/usuarios` to list accounts and create client or platform-admin accounts.
- Never show password hashes or existing credentials in the UI or logs.
