import { useState, type FormEvent } from 'react';
import { Check, FileCheck2, LoaderCircle } from 'lucide-react';

export type OpportunityOutcome = {
  outcome: 'awarded' | 'not_awarded' | 'deserted' | 'revoked' | 'withdrawn' | 'not_submitted';
  offerAmount: number | null;
  awardedAmount: number | null;
  actualCost: number | null;
  currency: 'CLP' | 'USD' | 'EUR' | 'UTM';
  sourceUrl: string | null;
  decidedAt: string | null;
  notes: string | null;
};

export const outcomeLabels: Record<OpportunityOutcome['outcome'], string> = {
  awarded: 'Adjudicada a mi empresa',
  not_awarded: 'Adjudicada a otra empresa',
  deserted: 'Desierta',
  revoked: 'Revocada',
  withdrawn: 'Retirada por mi empresa',
  not_submitted: 'No presentada',
};

const blank = { outcome: 'not_awarded' as OpportunityOutcome['outcome'], offerAmount: '', awardedAmount: '', actualCost: '', currency: 'CLP' as OpportunityOutcome['currency'], sourceUrl: '', decidedAt: '', notes: '' };
const moneyLabel = (amount: number, currency: OpportunityOutcome['currency']) => currency === 'UTM'
  ? `${new Intl.NumberFormat('es-CL',{maximumFractionDigits:2}).format(amount)} UTM`
  : new Intl.NumberFormat('es-CL',{style:'currency',currency,maximumFractionDigits:0}).format(amount);

export function OpportunityOutcomePanel({ trackingId, outcome, csrfToken, onSaved }: { trackingId: number; outcome: OpportunityOutcome | null; csrfToken: string; onSaved: () => void }) {
  const [form, setForm] = useState(() => outcome ? {
    outcome: outcome.outcome, offerAmount: outcome.offerAmount?.toString() ?? '', awardedAmount: outcome.awardedAmount?.toString() ?? '',
    actualCost: outcome.actualCost?.toString() ?? '', currency: outcome.currency, sourceUrl: outcome.sourceUrl ?? '',
    decidedAt: outcome.decidedAt?.slice(0, 10) ?? '', notes: outcome.notes ?? '',
  } : blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof typeof blank, value: string) => setForm(current => ({ ...current, [key]: value }));
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    const amount = (value: string) => value.trim() ? Number(value) : null;
    try {
      const response = await fetch(`/api/company/tracking/${trackingId}/result`, {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ outcome: form.outcome, offerAmount: amount(form.offerAmount), awardedAmount: amount(form.awardedAmount), actualCost: amount(form.actualCost), currency: form.currency, sourceUrl: form.sourceUrl.trim() || null, decidedAt: form.decidedAt || null, notes: form.notes.trim() || null }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudo guardar el resultado.');
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar el resultado.'); }
    finally { setBusy(false); }
  };
  const field = 'h-9 rounded-lg border border-[#D8DCE6] bg-white px-2.5 text-xs text-[#202534] focus:border-[#5636D9] focus:outline-none';
  return <form onSubmit={(event) => void save(event)} className="space-y-3 rounded-xl border border-[#DED8FF] bg-[#FAF9FF] p-3" aria-label="Registrar resultado comercial">
    <div className="flex items-center gap-2 text-xs font-bold text-[#34304B]"><FileCheck2 size={15} className="text-[#5636D9]" /> Resultado de la postulación</div>
    <p className="text-[11px] leading-4 text-[#687184]">Registra el resultado conocido y su fuente. El monto estimado del comprador no se usa como oferta ni como venta.</p>
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="grid gap-1 text-[11px] font-semibold text-[#596174]">Resultado<select className={field} value={form.outcome} onChange={event => set('outcome', event.target.value)}>{Object.entries(outcomeLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="grid gap-1 text-[11px] font-semibold text-[#596174]">Moneda<select className={field} value={form.currency} onChange={event => set('currency', event.target.value)}>{['CLP','USD','EUR','UTM'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="grid gap-1 text-[11px] font-semibold text-[#596174]">Monto ofertado<input className={field} type="number" min="0" step="0.01" value={form.offerAmount} onChange={event => set('offerAmount', event.target.value)} placeholder="Opcional" /></label>
      <label className="grid gap-1 text-[11px] font-semibold text-[#596174]">Monto adjudicado<input className={field} type="number" min="0" step="0.01" value={form.awardedAmount} onChange={event => set('awardedAmount', event.target.value)} placeholder="Opcional" /></label>
      <label className="grid gap-1 text-[11px] font-semibold text-[#596174]">Costo real registrado<input className={field} type="number" min="0" step="0.01" value={form.actualCost} onChange={event => set('actualCost', event.target.value)} placeholder="Opcional" /></label>
      <label className="grid gap-1 text-[11px] font-semibold text-[#596174]">Fecha del resultado<input className={field} type="date" value={form.decidedAt} onChange={event => set('decidedAt', event.target.value)} /></label>
    </div>
    <label className="grid gap-1 text-[11px] font-semibold text-[#596174]">Fuente oficial o respaldo (HTTPS)<input className={field} type="url" value={form.sourceUrl} onChange={event => set('sourceUrl', event.target.value)} placeholder="https://…" /></label>
    <label className="grid gap-1 text-[11px] font-semibold text-[#596174]">Notas<textarea className={`${field} h-auto min-h-16 py-2`} maxLength={2000} value={form.notes} onChange={event => set('notes', event.target.value)} placeholder="Dato útil para revisar el resultado después" /></label>
    {outcome && outcome.awardedAmount !== null && outcome.actualCost !== null && outcome.currency === form.currency && form.outcome === 'awarded' && <p className="text-[11px] text-[#475569]">Diferencia bruta registrada: {moneyLabel(outcome.awardedAmount-outcome.actualCost,form.currency)}. No equivale a utilidad neta.</p>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    <button type="submit" disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#5636D9] px-3 text-xs font-semibold text-white disabled:opacity-60">{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}{busy ? 'Guardando…' : outcome ? 'Actualizar resultado' : 'Guardar resultado'}</button>
  </form>;
}
