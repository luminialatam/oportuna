import assert from 'node:assert/strict';
import { classifyTransportError } from '../src/mercadoPublico.js';

assert.deepEqual(classifyTransportError(Object.assign(new Error('dns failed'), { code: 'ENOTFOUND' })), { code: 'ENOTFOUND', phase: 'dns' });
assert.deepEqual(classifyTransportError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })), { code: 'ECONNREFUSED', phase: 'tcp' });
assert.deepEqual(classifyTransportError(Object.assign(new Error('certificate rejected'), { code: 'CERT_HAS_EXPIRED' })), { code: 'CERT_HAS_EXPIRED', phase: 'tls' });
assert.deepEqual(classifyTransportError(Object.assign(new Error('connect timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' })), { code: 'ETIMEDOUT', phase: 'tcp' });
assert.deepEqual(classifyTransportError(Object.assign(new Error('reset'), { code: 'ECONNRESET' })), { code: 'ECONNRESET', phase: 'transport' });
assert.deepEqual(classifyTransportError(new TypeError('fetch failed', { cause: Object.assign(new Error('lookup failed'), { code: 'EAI_AGAIN' }) })), { code: 'EAI_AGAIN', phase: 'dns' });
assert.deepEqual(classifyTransportError(new Error('request failed for https://host/path?ticket=secret')), { code: 'NETWORK_ERROR', phase: 'transport' });

console.log('PASS Mercado Público transport errors classify DNS, TCP, TLS, timeout and reset codes without returning messages or request URLs.');
