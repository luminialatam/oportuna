export type ListingAmountStatus = 'published' | 'not_public' | 'source_missing' | 'unverified';

export function listingAmountDisplay(
  amount: string | number | null | undefined,
  status: ListingAmountStatus | string | null | undefined,
  format: (value: string | number) => string,
): string {
  if (amount != null && amount !== '' && Number.isFinite(Number(amount))) return format(amount);
  switch (status) {
    case 'not_public': return 'No publicado';
    case 'source_missing': return 'La fuente no devolvió el monto';
    case 'unverified': return 'Pendiente de consulta oficial';
    default: return 'Monto no disponible';
  }
}
