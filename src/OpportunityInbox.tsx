import { useCallback, useEffect, useState } from 'react';
import { Archive, ArrowRight, RotateCcw } from 'lucide-react';

type Filter = 'recommended' | 'unread' | 'discarded';
type Item = { codigo_externo: string; nombre: string | null; codigo_estado: number | null; fecha_cierre: string | null; organismo: string | null; monto_estimado: number | string | null; moneda: string | null; score?: number; level?: string; readAt?: string | null; dismissedAt?: string | null };
const filters: { id: Filter; label: string }[] = [{ id: 'recommended', label: 'Recomendadas' }, { id: 'unread', label: 'No leídas' }, { id: 'discarded', label: 'Descartadas' }];
const money = (value: Item['monto_estimado'], currency: string | null) => value == null || value === '' ? 'Monto no informado' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: currency || 'CLP', maximumFractionDigits: 0 }).format(Number(value));
const date = (value: string | null) => value ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium' }).format(new Date(value)) : 'Sin fecha de cierre';

export function OpportunityInbox({ csrfToken, onOpen }: { csrfToken: string; onOpen: (code: string) => void }) {
  const [filter, setFilter] = useState<Filter>('recommended');
  const [items, setItems] = useState<Item[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyCode, setBusyCode] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/company/opportunities?filter=${filter}`, { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las oportunidades.');
      setItems(data.items ?? []); setConfigured(data.configured !== false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las oportunidades.'); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const refresh = () => void load(); window.addEventListener('oportuna:refresh-opportunities', refresh); return () => window.removeEventListener('oportuna:refresh-opportunities', refresh); }, [load]);
  const setDiscarded = async (code: string, restore: boolean) => {
    setBusyCode(code); setError('');
    try {
      const response = await fetch(`/api/company/opportunities/${encodeURIComponent(code)}/discard`, { method: restore ? 'DELETE' : 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrfToken } });
      const data = response.status === 204 ? {} : await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo actualizar la oportunidad.');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la oportunidad.'); }
    finally { setBusyCode(''); }
  };
  return <div className="mx-auto w-full max-w-6xl space-y-5">
    <header className="border-b border-[#E1E4EA] pb-4"><div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[#5636D9]">Explorar</div><h1 className="text-2xl font-bold text-[#171A24]">Oportunidades</h1><p className="mt-1 text-sm text-[#5D6472]">Revisa tus recomendaciones y administra la lectura y los descartes.</p></header>
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtro de oportunidades">{filters.map(item => <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} onClick={() => setFilter(item.id)} className={`rounded-xl border px-4 py-2 text-sm font-semibold ${filter === item.id ? 'border-[#5636D9] bg-[#f0edff] text-[#5636D9]' : 'border-[#E1E4EA] bg-white text-[#5D6472]'}`}>{item.label}</button>)}</div>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {loading ? <div className="rounded-xl border border-[#E1E4EA] bg-white p-8 text-center text-sm text-[#5D6472]">Cargando oportunidades…</div> : !configured ? <div className="rounded-xl border border-[#E1E4EA] bg-white p-8 text-center text-sm text-[#5D6472]">Configura el catálogo de tu empresa para recibir recomendaciones.</div> : items.length === 0 ? <div className="rounded-xl border border-[#E1E4EA] bg-white p-8 text-center text-sm text-[#5D6472]">{filter === 'unread' ? 'No tienes oportunidades sin leer.' : filter === 'discarded' ? 'No has descartado oportunidades.' : 'No encontramos recomendaciones para el catálogo actual.'}</div> : <div className="grid gap-3 md:grid-cols-2">{items.map(item => <article key={item.codigo_externo} className="rounded-2xl border border-[#E1E4EA] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="line-clamp-2 font-bold text-[#171A24]">{item.nombre || 'Nombre no disponible'}</h2><p className="mt-1 text-xs text-[#737D91]">{item.codigo_externo}</p></div>{filter !== 'discarded' && <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${item.readAt ? 'bg-slate-100 text-slate-600' : 'bg-[#f0edff] text-[#5636D9]'}`}>{item.readAt ? 'Leída' : `${Number(item.score ?? 0)}% match`}</span>}</div>
      <div className="mt-3 space-y-1 text-xs text-[#5D6472]"><p>{item.organismo || 'Organismo no informado'}</p><p>{date(item.fecha_cierre)} · {money(item.monto_estimado, item.moneda)}</p></div>
      <div className="mt-4 flex items-center justify-between border-t border-[#E9ECF1] pt-3"><button disabled={busyCode === item.codigo_externo} onClick={() => void setDiscarded(item.codigo_externo, filter === 'discarded')} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5D6472] hover:text-[#5636D9] disabled:opacity-50">{filter === 'discarded' ? <><RotateCcw size={14} /> Recuperar</> : <><Archive size={14} /> Descartar</>}</button>{filter !== 'discarded' && <button onClick={() => onOpen(item.codigo_externo)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#5636D9] px-3 py-2 text-xs font-semibold text-white">Ver ficha <ArrowRight size={13} /></button>}</div>
    </article>)}</div>}
  </div>;
}
