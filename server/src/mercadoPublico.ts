import type { ApiListing } from './types.js';
import pool from './db.js';
import { performance } from 'node:perf_hooks';

const ENDPOINT = 'https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json';
export class MercadoPublicoError extends Error {
  constructor(message: string, readonly status = 502, readonly permanent = false) { super(message); }
}
function extractListings(data: unknown): ApiListing[] {
  if (!data || typeof data !== 'object') throw new MercadoPublicoError('La API devolvió una respuesta inválida.');
  const response = data as Record<string, any>;
  if (response.Codigo === 1 || response.Codigo === '1') {
    const message = String(response.Mensaje ?? 'Mercado Público informó un error.');
    const auth = /ticket|autentic|credencial|permiso/i.test(message);
    throw new MercadoPublicoError(auth ? 'Mercado Público rechazó la autenticación; revisa la configuración del servidor.' : 'Mercado Público informó un error en la consulta.', auth ? 401 : 502, auth);
  }
  const container = response.Licitaciones && typeof response.Licitaciones === 'object' ? response.Licitaciones : response;
  const list = container.Listado;
  if (list == null) return [];
  if (Array.isArray(list)) return list;
  if (typeof list === 'object') return [list as ApiListing];
  throw new MercadoPublicoError('El listado recibido no tiene el formato esperado.');
}
const timeoutMs = Math.max(1000, Number(process.env.MERCADOPUBLICO_TIMEOUT_MS) || 15000);
const minIntervalMs = Math.max(2000, Number(process.env.MERCADOPUBLICO_MIN_INTERVAL_MS) || 2000);
const maxRetries = Math.max(0, Math.min(6, Number(process.env.MERCADOPUBLICO_MAX_RETRIES ?? 3)));
let nextAllowedAt = 0;
let serial: Promise<unknown> = Promise.resolve();
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function retryAfter(response: Response): number {
  const raw = response.headers.get('retry-after');
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? 0 : Math.max(0, at - Date.now());
}
export function classifyTransportError(error: unknown): { code: string; phase: 'dns' | 'tcp' | 'tls' | 'transport' } {
  let current: any = error;
  let fallback = 'NETWORK_ERROR';
  for (let depth = 0; current && depth < 5; depth++, current = current.cause) {
    const rawCode = typeof current.code === 'string' ? current.code : '';
    const name = typeof current.name === 'string' ? current.name : '';
    if (rawCode && /^[A-Z0-9_]+$/.test(rawCode)) fallback = rawCode;
    if (['ENOTFOUND','EAI_AGAIN','EAI_FAIL','EAI_NONAME','ENODATA'].includes(rawCode)) return { code: rawCode, phase: 'dns' };
    if (/^(CERT_|ERR_TLS_|ERR_SSL_)/.test(rawCode) || /TLS|CERTIFICATE/.test(name)) return { code: rawCode || name, phase: 'tls' };
    if (rawCode === 'UND_ERR_CONNECT_TIMEOUT') return { code: 'ETIMEDOUT', phase: 'tcp' };
    if (rawCode === 'ECONNREFUSED' || rawCode === 'EHOSTUNREACH' || rawCode === 'ENETUNREACH') return { code: rawCode, phase: 'tcp' };
    if (rawCode === 'ETIMEDOUT' || name === 'TimeoutError') return { code: 'ETIMEDOUT', phase: 'transport' };
  }
  return { code: fallback, phase: 'transport' };
}
function logRequestFailure(phase: string, code: string, durationMs: number, httpStatus: number | null) {
  console.warn(`[mercado-publico] ${JSON.stringify({ code, phase, durationMs: Math.max(0, Math.round(durationMs)), httpStatus })}`);
}
async function execute(params: Record<string, string>): Promise<ApiListing[]> {
  const ticket = process.env.MERCADOPUBLICO_TICKET?.trim();
  if (!ticket) throw new MercadoPublicoError('Falta configurar el ticket de Mercado Público en el backend.', 503, true);
  const url = new URL(ENDPOINT);
  Object.entries({ ...params, ticket }).forEach(([key, value]) => url.searchParams.set(key, value));
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const delay = Math.max(0, nextAllowedAt - Date.now());
    if (delay) await wait(delay);
    nextAllowedAt = Date.now() + minIntervalMs;
    let response: Response | undefined;
    if (params.codigo) {
      try { await pool.execute('UPDATE mercado_publico_metrics SET detail_requests=detail_requests+1 WHERE id=1'); } catch { /* metrics must not block the official request */ }
    }
    const requestStartedAt = performance.now();
    let transportError: unknown;
    try { response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }); }
    catch (error) { transportError = error; }
    const requestDurationMs = performance.now() - requestStartedAt;
    if (transportError) {
      const failure = classifyTransportError(transportError);
      logRequestFailure(failure.phase, failure.code, requestDurationMs, null);
    } else if (response && !response.ok) {
      logRequestFailure('http', `HTTP_${response.status}`, requestDurationMs, response.status);
    }
    if (response?.ok) {
      let data: unknown;
      try { data = await response.json(); } catch { throw new MercadoPublicoError('Mercado Público devolvió contenido que no es JSON.'); }
      return extractListings(data);
    }
    const status = response?.status;
    if (status === 401 || status === 403 || (status != null && status >= 400 && status < 500 && status !== 408 && status !== 429)) {
      throw new MercadoPublicoError(`Mercado Público respondió HTTP ${status}; la consulta se detuvo.`, status === 429 ? 429 : 502, true);
    }
    if (attempt === maxRetries) throw new MercadoPublicoError(status ? `Mercado Público respondió HTTP ${status} después de agotar los reintentos.` : 'No fue posible conectar con la API de Mercado Público después de agotar los reintentos.');
    const exponential = Math.min(30000, 1000 * (2 ** attempt));
    const waitMs = Math.max(exponential, status === 429 && response ? retryAfter(response) : 0);
    nextAllowedAt = Date.now() + waitMs;
    // Failure details are emitted above without request parameters, credentials or response bodies.
  }
  throw new MercadoPublicoError('No fue posible completar la consulta.');
}
function query(params: Record<string, string>) {
  const result = serial.then(async () => {
    const connection = await pool.getConnection();
    let locked = false;
    try {
      const [locks] = await connection.query<any[]>("SELECT GET_LOCK('oportuna_mercado_publico_request',60) acquired");
      locked = Number(locks[0]?.acquired) === 1;
      if (!locked) throw new MercadoPublicoError('Mercado Público está ocupado por otra solicitud; inténtalo nuevamente.', 503);
      try { return await execute(params); }
      finally {
        // Keep the shared lock for the minimum gap so every process observes the same API pace.
        await wait(minIntervalMs);
      }
    } finally {
      if (locked) await connection.query("SELECT RELEASE_LOCK('oportuna_mercado_publico_request')");
      connection.release();
    }
  });
  serial = result.catch(() => undefined);
  return result;
}
export const listByDate = (fecha: string) => query({ fecha });
export const listActive = () => query({ estado: 'activas' });
export async function getByCode(codigo: string) {
  const rows = await query({ codigo });
  const found = rows.find((row) => row.CodigoExterno === codigo);
  if (!found) throw new MercadoPublicoError('No se encontró la licitación solicitada.', 404, true);
  return found;
}
