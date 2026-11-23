export type OfferEconomics = {
  unitPrice: number | null;
  unitCost: number | null;
  unitGrossProfit: number | null;
  grossMarginPercent: number | null;
  quantity: number | null;
  revenue: number | null;
  directCost: number | null;
  grossProfit: number | null;
  target: 'not-set' | 'incomplete' | 'met' | 'below';
};

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function calculateOfferEconomics(input: {
  unitPrice: unknown;
  unitCost: unknown;
  quantity: unknown;
  minimumMarginPercent: unknown;
}): OfferEconomics {
  const unitPrice = finiteNumber(input.unitPrice);
  const unitCost = finiteNumber(input.unitCost);
  const parsedQuantity = finiteNumber(input.quantity);
  const quantity = parsedQuantity != null && parsedQuantity > 0 ? parsedQuantity : null;
  const unitGrossProfit = unitPrice != null && unitCost != null ? unitPrice - unitCost : null;
  const grossMarginPercent = unitGrossProfit != null && unitPrice != null && unitPrice > 0
    ? unitGrossProfit / unitPrice * 100
    : null;
  const revenue = quantity != null && unitPrice != null ? quantity * unitPrice : null;
  const directCost = quantity != null && unitCost != null ? quantity * unitCost : null;
  const grossProfit = quantity != null && unitGrossProfit != null ? quantity * unitGrossProfit : null;
  const rawMarginTarget = finiteNumber(input.minimumMarginPercent);
  const minimumMarginPercent = rawMarginTarget != null && rawMarginTarget <= 100 ? rawMarginTarget : null;
  const target = minimumMarginPercent == null
    ? 'not-set'
    : grossMarginPercent == null
      ? 'incomplete'
      : grossMarginPercent >= minimumMarginPercent ? 'met' : 'below';

  return { unitPrice, unitCost, unitGrossProfit, grossMarginPercent, quantity, revenue, directCost, grossProfit, target };
}

export function formatCLP(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(value);
}
