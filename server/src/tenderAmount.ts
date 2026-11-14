export type TenderAmountStatus = 'published' | 'not_public' | 'source_missing' | 'unverified';

export const tenderAmountUpsertSql = `monto_estimado=CASE
  WHEN VALUES(monto_estimado) IS NOT NULL THEN VALUES(monto_estimado)
  WHEN JSON_UNQUOTE(JSON_EXTRACT(VALUES(payload_json),'$.VisibilidadMonto'))='0' THEN NULL
  ELSE monto_estimado
END`;

export function parseTenderAmount(value: unknown): number | null {
  if (value == null || value === '') return null;
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export function tenderAmountStatus(amount: unknown, visibility: unknown): TenderAmountStatus {
  if (parseTenderAmount(amount) != null) return 'published';
  if (visibility === 0 || visibility === '0' || visibility === false) return 'not_public';
  if (visibility === 1 || visibility === '1' || visibility === true) return 'source_missing';
  return 'unverified';
}

/**
 * A detail response is authoritative when it supplies an amount. An explicit
 * non-public flag clears a stale previously published value; absent fields in
 * summary responses preserve a known amount.
 */
export function officialAmountWrite(detail: Record<string, unknown>) {
  const amount = parseTenderAmount(detail.MontoEstimado);
  if (amount != null) return { mode: 'replace' as const, amount };
  if (detail.VisibilidadMonto === 0 || detail.VisibilidadMonto === '0' || detail.VisibilidadMonto === false) {
    return { mode: 'clear' as const, amount: null };
  }
  return { mode: 'preserve' as const, amount: null };
}
