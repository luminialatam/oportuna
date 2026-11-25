import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarClock, CircleAlert, ClipboardCheck, Layers3, LoaderCircle, TrendingUp } from 'lucide-react';

type TrackingItem = {
  id: number;
  codigo: string;
  estado: string;
  listing: { nombre: string | null; organismo: string | null; fechaCierre: string | null };
};

const stageLabels: Record<string, string> = {
  saved: 'Guardada', evaluating: 'En evaluación', preparing_offer: 'Preparando oferta', submitted: 'Presentada', discarded: 'Descartada',
};

function closeDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysUntil(value: Date, now: Date) {
  return Math.ceil((value.getTime() - now.getTime()) / 86_400_000);
}

export function RevenueDesk({ onOpen, onViewAll }: { onOpen: (code: string) => void; onViewAll: () => void }) {
  const [items, setItems] = useState<TrackingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/company/tracking', { credentials: 'same-origin', signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'No se pudo cargar el seguimiento.');
        return body as { items: TrackingItem[] };
      })
      .then(body => setItems(body.items ?? []))
      .catch(cause => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'No se pudo cargar el seguimiento.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const now = new Date();
  const active = useMemo(() => items.filter(item => !['discarded', 'submitted'].includes(item.estado)), [items]);
  const closing = useMemo(() => active.flatMap(item => {
    const date = closeDate(item.listing.fechaCierre);
    return date && date >= now ? [{ item, date }] : [];
  }).sort((a, b) => a.date.getTime() - b.date.getTime()), [active]);
  const urgent = closing.filter(row => daysUntil(row.date, now) <= 7);
  const preparing = active.filter(item => item.estado === 'preparing_offer');
  const needsDecision = active.filter(item => item.estado === 'saved' || item.estado === 'evaluating');
  const next = closing.slice(0, 3);

  return (
    <section className="revenue-desk" aria-labelledby="revenue-desk-title">
      <div className="revenue-desk-header">
        <div>
          <span className="revenue-desk-eyebrow"><TrendingUp size={14} /> Centro de acción comercial</span>
          <h2 id="revenue-desk-title">Prioriza tus oportunidades reales</h2>
          <p>El tablero usa las fechas y etapas de Seguimiento. Los montos estimados no se cuentan como ventas.</p>
        </div>
        <button type="button" onClick={onViewAll} className="revenue-desk-link">Abrir seguimiento <ArrowRight size={15} /></button>
      </div>

      {loading ? <div className="revenue-desk-loading"><LoaderCircle size={18} className="spin" /> Cargando tu pipeline…</div> : error ? (
        <div className="revenue-desk-error"><CircleAlert size={17} /> {error}</div>
      ) : (
        <>
          <div className="revenue-desk-metrics">
            <div><span><Layers3 size={15} /> Oportunidades activas</span><strong>{active.length}</strong><small>En evaluación o preparación</small></div>
            <div className={urgent.length ? 'is-urgent' : ''}><span><CalendarClock size={15} /> Cierres en 7 días</span><strong>{urgent.length}</strong><small>Revisa las fechas oficiales</small></div>
            <div><span><ClipboardCheck size={15} /> Ofertas en preparación</span><strong>{preparing.length}</strong><small>Etapa registrada por tu equipo</small></div>
            <div><span><CircleAlert size={15} /> Pendientes de decisión</span><strong>{needsDecision.length}</strong><small>Guardadas o en evaluación</small></div>
          </div>
          <div className="revenue-desk-next">
            <div className="revenue-desk-next-title"><b>Próximos cierres en seguimiento</b><span>Ordenados por fecha de cierre</span></div>
            {next.length ? next.map(({ item, date }) => {
              const days = daysUntil(date, now);
              return <button key={item.id} type="button" className="revenue-desk-row" onClick={() => onOpen(item.codigo)}>
                <span className="revenue-desk-row-copy"><b>{item.listing.nombre || 'Licitación sin nombre'}</b><small>{item.listing.organismo || 'Organismo no informado'} · {stageLabels[item.estado] || 'En seguimiento'} · {item.codigo}</small></span>
                <span className={`revenue-desk-deadline ${days <= 2 ? 'is-critical' : days <= 7 ? 'is-soon' : ''}`}>{days <= 0 ? 'Cierra hoy' : days === 1 ? '1 día' : `${days} días`}</span>
                <ArrowRight size={15} />
              </button>;
            }) : <div className="revenue-desk-empty">No hay cierres futuros en tu seguimiento. Guarda una oportunidad para que aparezca aquí.</div>}
          </div>
        </>
      )}
    </section>
  );
}
