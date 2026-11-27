import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowRight, Check, Circle, LoaderCircle, RotateCcw, Search, Star } from 'lucide-react';

type Filter = 'recommended' | 'unread' | 'discarded';
type Item = {
  codigo_externo: string;
  nombre: string | null;
  codigo_estado: number | null;
  fecha_cierre: string | null;
  organismo: string | null;
  monto_estimado: number | string | null;
  moneda: string | null;
  region?: string | null;
  score?: number | null;
  level?: string | null;
  productName?: string | null;
  matchReasons?: string[];
  readAt?: string | null;
  dismissedAt?: string | null;
  firstRecommendedAt?: string | null;
};
type Feed = { configured: boolean; total: number; high?: number; medium?: number; closingSoon?: number; items: Item[] };
type Counts = Record<Filter, number | null>;
const filters: { id: Filter; label: string }[] = [
  { id: 'recommended', label: 'Recomendadas' },
  { id: 'unread', label: 'No leídas' },
  { id: 'discarded', label: 'Descartadas' },
];

const chileDate = (value: string | null) => {
  if (!value) return 'Cierre no informado';
  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(value);
  const parsed = new Date(dateOnly ? `${dateOnly[1]}T12:00:00Z` : value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? 'Cierre no informado' : new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
};
const money = (value: Item['monto_estimado'], currency: string | null) => {
  if (value == null || value === '') return 'Monto no informado';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Monto no informado';
  const isoCurrency = currency?.trim().toUpperCase();
  if (!isoCurrency || !/^[A-Z]{3}$/.test(isoCurrency)) {
    return `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(amount)} (moneda no informada)`;
  }
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: isoCurrency, maximumFractionDigits: 0 }).format(amount);
};
const matchLevelName: Record<string, string> = { high: 'Alta', medium: 'Media', exploratory: 'Exploratoria' };
const initialCounts: Counts = { recommended: null, unread: null, discarded: null };
const isRecentlyRecommended = (value: string | null | undefined) => {
  if (!value) return false;
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now() && Date.now() - timestamp <= 7 * 24 * 60 * 60 * 1000;
};

export function OpportunityInbox({
  csrfToken,
  onOpen,
  onSave,
}: {
  csrfToken: string;
  onOpen: (code: string) => void;
  onSave: (code: string) => Promise<boolean>;
}) {
  const [filter, setFilter] = useState<Filter>('recommended');
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Counts>(initialCounts);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyCode, setBusyCode] = useState('');
  const [savingCode, setSavingCode] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/company/opportunities?filter=${filter}`, { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json() as Feed;
      if (!response.ok) throw new Error((data as any).error || 'No se pudieron cargar las oportunidades.');
      if (currentRequest !== requestId.current) return;
      const loadedItems = Array.isArray(data.items) ? data.items : [];
      setItems(loadedItems);
      setConfigured(data.configured !== false);
      const total = Number.isFinite(Number(data.total)) ? Number(data.total) : loadedItems.length;
      setCounts(current => ({
        ...current,
        [filter]: total,
        ...(filter === 'recommended' ? { unread: loadedItems.filter(item => !item.readAt).length } : {}),
        ...(filter === 'unread' ? { unread: total } : {}),
        ...(filter === 'discarded' ? { discarded: total } : {}),
      }));
    } catch (cause) {
      if (currentRequest === requestId.current) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las oportunidades.');
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener('oportuna:refresh-opportunities', refresh);
    return () => window.removeEventListener('oportuna:refresh-opportunities', refresh);
  }, [load]);

  const visibleItems = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('es-CL');
    if (!term) return items;
    return items.filter(item => [item.nombre, item.codigo_externo, item.organismo].some(value => String(value ?? '').toLocaleLowerCase('es-CL').includes(term)));
  }, [items, query]);

  const updateKnownCounts = (item: Item, action: 'discard' | 'restore' | 'read') => {
    setCounts(current => {
      const next = { ...current };
      if (action === 'discard') {
        if (next.recommended != null) next.recommended = Math.max(0, next.recommended - 1);
        if (!item.readAt && next.unread != null) next.unread = Math.max(0, next.unread - 1);
        if (next.discarded != null) next.discarded += 1;
      } else if (action === 'restore') {
        if (next.discarded != null) next.discarded = Math.max(0, next.discarded - 1);
        if (next.recommended != null) next.recommended += 1;
        if (!item.readAt && next.unread != null) next.unread += 1;
      } else if (next.unread != null) next.unread = Math.max(0, next.unread - 1);
      return next;
    });
  };

  const setDiscarded = async (item: Item, restore: boolean) => {
    const code = item.codigo_externo;
    setBusyCode(code);
    setError('');
    try {
      const response = await fetch(`/api/company/opportunities/${encodeURIComponent(code)}/discard`, {
        method: restore ? 'DELETE' : 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': csrfToken },
      });
      const data = response.status === 204 ? {} : await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo actualizar la oportunidad.');
      updateKnownCounts(item, restore ? 'restore' : 'discard');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la oportunidad.');
    } finally {
      setBusyCode('');
    }
  };

  const markRead = async (item: Item) => {
    const code = item.codigo_externo;
    setBusyCode(code);
    setError('');
    try {
      const response = await fetch(`/api/company/opportunities/${encodeURIComponent(code)}/read`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': csrfToken },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo marcar como leída.');
      }
      updateKnownCounts(item, 'read');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo marcar como leída.');
    } finally {
      setBusyCode('');
    }
  };

  const save = async (code: string) => {
    setSavingCode(code);
    try { await onSave(code); }
    finally { setSavingCode(''); }
  };

  const levelFor = (item: Item) => matchLevelName[item.level ?? ''] ?? 'Coincidencia no informada';

  return <section className="opportunity-inbox" aria-labelledby="opportunities-title">
    <header className="opportunity-page-header">
      <div className="opportunity-page-copy"><p className="opportunity-eyebrow">Explorar</p><h1 id="opportunities-title">Oportunidades</h1><p>Revisa las oportunidades detectadas para tu empresa y decide cuáles seguir.</p></div>
      <label className="opportunity-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Buscar oportunidades</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nombre, código u organismo" /><button type="button" onClick={() => setQuery('')} disabled={!query} aria-label="Limpiar búsqueda">×</button></label>
    </header>

    <div className="opportunity-filter-tabs" role="tablist" aria-label="Filtrar oportunidades">
      {filters.map(option => <button key={option.id} type="button" role="tab" aria-selected={filter === option.id} onClick={() => setFilter(option.id)}>
        <span className="opportunity-tab-label">{option.label}</span><span className="opportunity-tab-count" aria-label={counts[option.id] == null ? 'Conteo aún no cargado' : `${counts[option.id]} oportunidades`}>{counts[option.id] == null ? '—' : counts[option.id]}</span>
      </button>)}
    </div>

    {error && <div role="alert" className="opportunity-alert">{error}<button type="button" onClick={() => void load()}>Reintentar</button></div>}
    {loading ? <div role="status" aria-live="polite" className="opportunity-state"><LoaderCircle className="spin" size={22} /><b>Cargando oportunidades…</b></div>
      : !configured && filter !== 'discarded' ? <div className="opportunity-state"><Star size={26} /><b>Configura el catálogo de tu empresa</b><span>Al agregar productos y servicios, Oportuna podrá buscar coincidencias reales en las licitaciones indexadas.</span></div>
      : items.length === 0 ? <div className="opportunity-state"><Circle size={26} /><b>{filter === 'unread' ? 'No tienes oportunidades pendientes de revisar' : filter === 'discarded' ? 'No has descartado oportunidades' : 'Aún no hay recomendaciones en tu bandeja'}</b><span>{filter === 'recommended' ? 'Cuando se detecten nuevas oportunidades para tu empresa, aparecerán aquí para que puedas revisarlas.' : filter === 'unread' ? 'Las oportunidades que todavía no hayas revisado aparecerán en esta pestaña.' : 'Las oportunidades que descartes aparecerán aquí y podrás recuperarlas.'}</span></div>
      : visibleItems.length === 0 ? <div className="opportunity-state"><Search size={26} /><b>No hay resultados para esta búsqueda</b><span>Prueba con otro nombre, código u organismo.</span><button type="button" onClick={() => setQuery('')}>Limpiar búsqueda</button></div>
      : <>
        <div className="opportunity-results-summary" aria-live="polite"><span>Mostrando <b>{visibleItems.length}</b> de <b>{counts[filter] ?? items.length}</b> oportunidades</span>{query && <span>La búsqueda solo filtra los resultados cargados y no modifica los estados.</span>}</div>
        <div className="opportunity-card-grid">
          {visibleItems.map(item => {
            const isUnread = !item.readAt;
            const isNew = isUnread && isRecentlyRecommended(item.firstRecommendedAt);
            const reasons = Array.isArray(item.matchReasons) ? item.matchReasons : [];
            return <article key={item.codigo_externo} className="opportunity-card">
              <div className="opportunity-card-heading">
                <div className="min-w-0"><h2>{item.nombre || 'Nombre no informado'}</h2><p>{item.codigo_externo || 'Código no informado'}</p></div>
                <div className="opportunity-card-badges">
                  {filter !== 'discarded' && <span className={`opportunity-read-badge${isUnread ? ' is-unread' : ''}`}>{isNew ? 'Nueva · no leída' : isUnread ? 'No leída' : 'Leída'}</span>}
                  {filter !== 'discarded' && typeof item.score === 'number' && <span className="opportunity-match-badge">{Math.round(item.score)}% · {levelFor(item)}</span>}
                  {filter !== 'discarded' && typeof item.score !== 'number' && <span className="opportunity-match-badge">{levelFor(item)}</span>}
                </div>
              </div>

              <dl className="opportunity-facts">
                <div><dt>Organismo</dt><dd>{item.organismo || 'Organismo no informado'}</dd></div>
                <div><dt>Cierre</dt><dd>{chileDate(item.fecha_cierre)}</dd></div>
                <div><dt>Monto estimado</dt><dd>{money(item.monto_estimado, item.moneda)}</dd></div>
                {item.region && <div><dt>Región</dt><dd>{item.region}</dd></div>}
              </dl>

              {filter !== 'discarded' && <div className="opportunity-reason"><b>Motivo de coincidencia</b>{reasons.length ? <ul>{reasons.slice(0, 4).map((reason, index) => <li key={`${item.codigo_externo}-${index}`}>{reason}</li>)}</ul> : <p>El backend no informó un motivo detallado para esta coincidencia.</p>}</div>}

              <div className="opportunity-card-actions">
                {filter === 'discarded' ? <button type="button" className="opportunity-secondary-action" disabled={busyCode === item.codigo_externo} onClick={() => void setDiscarded(item, true)}>{busyCode === item.codigo_externo ? <LoaderCircle size={14} className="spin" /> : <RotateCcw size={14} />} Recuperar</button> : <>
                  {isUnread && <button type="button" className="opportunity-secondary-action" disabled={busyCode === item.codigo_externo} onClick={() => void markRead(item)}>{busyCode === item.codigo_externo ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Marcar como leída</button>}
                  <button type="button" className="opportunity-secondary-action" disabled={busyCode === item.codigo_externo} onClick={() => void setDiscarded(item, false)}>{busyCode === item.codigo_externo ? <LoaderCircle size={14} className="spin" /> : <Archive size={14} />} Descartar</button>
                </>}
                <button type="button" className="opportunity-secondary-action" disabled={savingCode === item.codigo_externo} onClick={() => void save(item.codigo_externo)}>{savingCode === item.codigo_externo ? <LoaderCircle size={14} className="spin" /> : <ArrowRight size={14} />} Guardar en Seguimiento</button>
                <button type="button" className="opportunity-primary-action" onClick={() => onOpen(item.codigo_externo)}>Ver ficha <ArrowRight size={14} /></button>
              </div>
            </article>;
          })}
        </div>
      </>}
  </section>;
}
