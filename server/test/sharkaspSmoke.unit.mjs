import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { checkSharkaspSite } from '../../scripts/sharkaspSmoke.mjs';

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try { await run(`https://127.0.0.1:${address.port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

await assert.rejects(checkSharkaspSite('http://localhost'), /debe usar HTTPS/);

await withServer((request, response) => {
  response.setHeader('server', 'Microsoft-IIS/10.0');
  response.setHeader('retry-after', '3600');
  response.statusCode = 503;
  response.end();
}, async (url) => {
  await assert.rejects(checkSharkaspSite(url, async (input) => {
    const localUrl = new URL(input);
    return fetch(`http://127.0.0.1:${localUrl.port}${localUrl.pathname}`);
  }), /GET \/ respondió HTTP 503 \(respuesta de IIS; la solicitud no alcanzó Express\)/);
});

await withServer((request, response) => {
  response.setHeader('server', 'Microsoft-IIS/10.0');
  if (request.url === '/') {
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><html><link href="/assets/app.css"><script src="/assets/app.js"></script></html>');
  } else if (request.url === '/api/health') {
    response.statusCode = 503;
    response.end();
  } else {
    response.end('asset');
  }
}, async (url) => {
  await assert.rejects(checkSharkaspSite(url, async (input) => {
    const localUrl = new URL(input);
    return fetch(`http://127.0.0.1:${localUrl.port}${localUrl.pathname}`);
  }), /GET \/api\/health respondió HTTP 503/);
});

await withServer((request, response) => {
  if (request.url === '/') {
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><html><head><link href="/assets/app.css" rel="stylesheet"></head><body><script src="/assets/app.js"></script></body></html>');
  } else if (request.url === '/api/health') {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ ok: true, mysql: false }));
  } else {
    response.setHeader('content-type', request.url.endsWith('.css') ? 'text/css' : 'application/javascript');
    response.end('/* fixture */');
  }
}, async (url) => {
  const result = await checkSharkaspSite(url, async (input) => {
    const localUrl = new URL(input);
    return fetch(`http://127.0.0.1:${localUrl.port}${localUrl.pathname}`);
  });
  assert.deepEqual(result, { ok: true, mysql: false, assets: 2 });
});

process.stdout.write('PASS SharkASP smoke: HTTP 503 de IIS rechazado en / y /api/health; HTML/assets/API sanos aceptados; no se contacta producción.\n');
