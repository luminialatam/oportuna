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
