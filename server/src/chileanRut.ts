export function normalizeChileanRut(input: string): string | null {
  const compact = input.trim().toUpperCase().replace(/[.\-\s]/g, '');
  const match = /^(\d{1,8})([0-9K])$/.exec(compact);
  if (!match) return null;
  const body = match[1].replace(/^0+(?=\d)/, '');
  if (Number(body) === 0) return null;
  let sum = 0;
  let factor = 2;
  for (let index = body.length - 1; index >= 0; index--) {
    sum += Number(body[index]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
  return expected === match[2] ? `${body}${expected}` : null;
}

export function formatChileanRut(normalized: string): string {
  const body = normalized.slice(0, -1);
  const dv = normalized.slice(-1);
  return `${Number(body).toLocaleString('es-CL')}-${dv}`;
}
