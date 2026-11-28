export const trackingOutcomes = ['awarded', 'not_awarded', 'deserted', 'revoked', 'withdrawn', 'not_submitted'] as const;
export const trackingCurrencies = ['CLP', 'USD', 'EUR', 'UTM'] as const;

export type TrackingOutcome = typeof trackingOutcomes[number];
export type TrackingCurrency = typeof trackingCurrencies[number];
export type TrackingOutcomeInput = {
  outcome: TrackingOutcome;
  offerAmount: number | null;
  awardedAmount: number | null;
  actualCost: number | null;
  currency: TrackingCurrency;
  sourceType: 'official' | 'company';
  sourceUrl: string | null;
  decidedAt: string | null;
  notes: string | null;
};

export function validateTrackingOutcome(input: TrackingOutcomeInput): TrackingOutcomeInput {
  if (!trackingOutcomes.includes(input.outcome)) throw new Error('Selecciona un resultado válido.');
  if (!trackingCurrencies.includes(input.currency)) throw new Error('Selecciona una moneda válida.');
  if (!['official','company'].includes(input.sourceType)) throw new Error('Selecciona un origen válido para el resultado.');
  for (const [label, value] of [['ofertado', input.offerAmount], ['adjudicado', input.awardedAmount], ['costo real', input.actualCost]] as const) {
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 9999999999999999)) {
      throw new Error(`El monto ${label} debe ser un número no negativo válido.`);
    }
  }
  if (input.sourceUrl !== null) {
    let parsed: URL;
    try { parsed = new URL(input.sourceUrl); } catch { throw new Error('La fuente debe ser una URL válida de HTTPS.'); }
    if (parsed.protocol !== 'https:') throw new Error('La fuente debe ser una URL válida de HTTPS.');
  }
  if (input.decidedAt !== null) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.decidedAt);
    if (!match) throw new Error('La fecha del resultado debe tener el formato AAAA-MM-DD.');
    const [, year, month, day] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) throw new Error('La fecha del resultado no es válida.');
  }
  return input;
}

export function outcomeSummary(input: Pick<TrackingOutcomeInput, 'outcome' | 'awardedAmount' | 'actualCost' | 'currency'>) {
  const grossDifference = input.outcome === 'awarded' && input.awardedAmount !== null && input.actualCost !== null
    ? input.awardedAmount - input.actualCost
    : null;
  return { grossDifference, currency: input.currency };
}
