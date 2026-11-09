export type ListingAvailability = 'open' | 'expired' | 'closed' | 'awarded' | 'cancelled' | 'suspended' | 'unknown';

export function listingAvailability(code: unknown, closeAt: unknown, now = Date.now()) {
  const state = Number(code);
  let close: number | null = null;
  if (closeAt instanceof Date) close = closeAt.getTime();
  else if (typeof closeAt === 'string' && closeAt.trim()) {
    const value = closeAt.trim();
    const sqlDate = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(value);
    const normalized = sqlDate ? `${value.replace(' ', 'T')}${value.includes('Z') ? '' : 'Z'}` : value;
    const parsed = Date.parse(normalized);
    if (Number.isFinite(parsed)) close = parsed;
  }
  if (state === 5) {
    if (close == null) return { status: 'unknown' as ListingAvailability, label: 'Publicada; fecha de cierre no disponible', isOpen: null };
    if (close <= now) return { status: 'expired' as ListingAvailability, label: 'Plazo vencido; verificar estado actualizado', isOpen: false };
    return { status: 'open' as ListingAvailability, label: 'Publicada y dentro del plazo informado', isOpen: true };
  }
  if (state === 6) return { status: 'closed' as ListingAvailability, label: 'Cerrada', isOpen: false };
  if (state === 7) return { status: 'closed' as ListingAvailability, label: 'Desierta', isOpen: false };
  if (state === 8) return { status: 'awarded' as ListingAvailability, label: 'Adjudicada', isOpen: false };
  if ([15, 18].includes(state)) return { status: 'cancelled' as ListingAvailability, label: 'Revocada', isOpen: false };
  if (state === 19) return { status: 'suspended' as ListingAvailability, label: 'Suspendida', isOpen: false };
  return { status: 'unknown' as ListingAvailability, label: 'Estado no verificado', isOpen: null };
}
