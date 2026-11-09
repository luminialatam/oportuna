import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || process.env.HTTP_PLATFORM_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('HTTP_PLATFORM_PORT o PORT debe contener el puerto asignado por IIS.');
}

const entryDirectory = dirname(fileURLToPath(import.meta.url));
const frontendDirectory = [
  join(process.cwd(), 'dist'),
  join(entryDirectory, '../../dist'),
  join(entryDirectory, '../../../dist'),
].find((candidate) => existsSync(join(candidate, 'index.html')));
if (!frontendDirectory) throw new Error('No se encontró dist/index.html para la prueba de IIS.');

const app = express();
app.disable('x-powered-by');
app.get('/api/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, mode: 'iis-smoke', database: 'not-connected', credentials: 'not-used' });
});
app.use('/api', (_req, res) => res.status(503).json({ error: 'API completa desactivada durante la prueba inicial.' }));
app.use(express.static(frontendDirectory, { index: false }));
app.get('*', (_req, res) => res.sendFile(join(frontendDirectory, 'index.html')));

const server = app.listen(port, '127.0.0.1');
const shutdown = () => server.close(() => process.exit(0));
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
