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
  matchKind?: 'exact_phrase' | 'catalog_context' | 'term_match' | 'exploratory';
  explanation?: string;
  matchedTerms?: string[];
  matchedCategories?: string[];
  matchedProfileTerms?: string[];
  preferredRegion?: string | null;
  exclusionsChecked?: boolean;
  exclusionTermsChecked?: number;
  evidence?: Array<{ source: string; text: string; matchedTerms?: string[] }>;
  readAt?: string | null;
  dismissedAt?: string | null;
  firstRecommendedAt?: string | null;
  trackingCreatedAt?: string | null;
  trackingState?: string | null;
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
const matchKindName: Record<string, string> = { exact_phrase: 'Frase exacta', catalog_context: 'Catálogo y contexto', term_match: 'Términos del catálogo', exploratory: 'Coincidencia exploratoria' };
const initialCounts: Counts = { recommended: null, unread: null, discarded: null };
const isRecentlyRecommended = (value: string | null | undefined) => {
  if (!value) return false;
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now() && Date.now() - timestamp <= 7 * 24 * 60 * 60 * 1000;
};
const dateTime = (value: string | null | undefined) => {
  if (!value) return 'Fecha no disponible';
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'Fecha no disponible';
};

export function OpportunityInbox({
  csrfToken,
  onOpen,
  onSave,
  canManage = true,
}: {
  csrfToken: string;
  onOpen: (code: string) => void;
  onSave: (code: string) => Promise<boolean>;
  canManage?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>('recommended');
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Counts>(initialCounts);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyCode, setBusyCode] = useState('');
  const [savingCode, setSavingCode] = useState('');
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkReport, setBulkReport] = useState<Array<{ code: string; ok: boolean; error?: string }> | null>(null);
  const [teamMembers, setTeamMembers] = useState<Array<{ id: number; name: string }>>([]);
  const [assignmentUserId, setAssignmentUserId] = useState('');
  const [bulkError, setBulkError] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/company/opportunities?filter=${filter}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
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
      if (currentRequest === requestId.current) setError(cause instanceof DOMException && cause.name === 'AbortError'
        ? 'La consulta está tardando más de lo esperado. Puedes volver a intentarlo.'
        : cause instanceof Error ? cause.message : 'No se pudieron cargar las oportunidades.');
    } finally {
      window.clearTimeout(timeout);
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener('oportuna:refresh-opportunities', refresh);
    return () => window.removeEventListener('oportuna:refresh-opportunities', refresh);
  }, [load]);
  useEffect(() => { setSelectedCodes([]); setBulkReport(null); }, [filter, query]);

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
    try { if (await onSave(code)) await load(); }
    finally { setSavingCode(''); }
  };

  const runBulk = async (action: 'read' | 'discard' | 'restore' | 'assign') => {
    const codes = visibleItems.map(item => item.codigo_externo).filter(code => selectedCodes.includes(code));
    if (!codes.length) return;
    const actionLabel = { read: 'marcar como leídas', discard: 'descartar', restore: 'recuperar', assign: 'asignar responsable a' }[action];
    if (!window.confirm(`¿${actionLabel} ${codes.length} oportunidades seleccionadas?`)) return;
    setBulkBusy(true); setBulkError(''); setBulkReport(null);
    try {
      const response = await fetch('/api/company/opportunities/bulk', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ codes, action, ...(action === 'assign' ? { assignedUserId: assignmentUserId ? Number(assignmentUserId) : null } : {}) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudo completar la acción masiva.');
      setBulkReport(body.results ?? []); setSelectedCodes([]); await load();
    } catch (cause) { setBulkError(cause instanceof Error ? cause.message : 'No se pudo completar la acción masiva.'); }
    finally { setBulkBusy(false); }
  };
  const loadTeamMembers = async () => {
    setBulkError('');
    try { const response = await fetch('/api/company/team-members', { credentials: 'same-origin' }); const body = await response.json(); if (!response.ok) throw new Error(body.error || 'No se pudo cargar el equipo.'); setTeamMembers(body.members ?? []); }
    catch (cause) { setBulkError(cause instanceof Error ? cause.message : 'No se pudo cargar el equipo.'); }
  };

  const levelFor = (item: Item) => matchLevelName[item.level ?? ''] ?? 'Coincidencia no informada';

  return <section className="opportunity-inbox" aria-labelledby="opportunities-title">
    <header className="opportunity-page-header">
      <div className="opportunity-heading-copy">
        <p className="opportunity-eyebrow">Explorar</p>
        <h1 id="opportunities-title">Oportunidades</h1>
        <p>Revisa las coincidencias del catálogo de tu empresa y decide cuáles seguir.</p>
      </div>
      <label className="opportunity-search">
        <Search size={18} aria-hidden="true" />
        <span className="sr-only">Buscar oportunidades</span>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nombre, código u organismo" />
        <button type="button" onClick={() => setQuery('')} disabled={!query} aria-label="Limpiar búsqueda">×</button>
      </label>
    </header>

    <div className="opportunity-filter-tabs" role="group" aria-label="Filtrar oportunidades">
      {filters.map(option => <button key={option.id} type="button" aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>
        <span>{option.label}</span><span className="opportunity-tab-count" aria-label={counts[option.id] == null ? 'Conteo aún no cargado' : `${counts[option.id]} oportunidades`}>{counts[option.id] == null ? '—' : counts[option.id]}</span>
      </button>)}
    </div>

    {loading ? <div role="status" aria-live="polite" className="opportunity-state opportunity-state-loading"><LoaderCircle className="spin" size={22} /> Cargando oportunidades…</div>
      : error ? <div role="alert" className="opportunity-state opportunity-state-error"><Circle size={25} /><b>No pudimos cargar las oportunidades</b><span>{error}</span><button type="button" onClick={() => void load()}>Reintentar</button></div>
      : !configured && filter !== 'discarded' ? <div className="opportunity-state"><Star size={24} /><b>Configura el catálogo de tu empresa</b><span>Al agregar productos y servicios, Leasy podrá buscar coincidencias reales en las licitaciones indexadas.</span></div>
      : items.length === 0 ? <div className="opportunity-state opportunity-state-empty"><span className="opportunity-state-icon"><Circle size={24} /></span><b>{filter === 'unread' ? 'No tienes oportunidades sin leer' : filter === 'discarded' ? 'No hay oportunidades descartadas' : 'No hay recomendaciones disponibles'}</b><span>{filter === 'recommended' ? 'No encontramos coincidencias para el catálogo y las preferencias de tu empresa en este momento.' : 'Cuando cambie este estado, las oportunidades aparecerán aquí.'}</span></div>
      : visibleItems.length === 0 ? <div className="opportunity-state opportunity-state-empty"><span className="opportunity-state-icon"><Search size={24} /></span><b>No hay resultados para esta búsqueda</b><span>Prueba con otro nombre, código u organismo.</span><button type="button" onClick={() => setQuery('')}>Limpiar búsqueda</button></div>
      : <>
        <div className="opportunity-results-summary" aria-live="polite"><span>Mostrando <b>{visibleItems.length}</b> de <b>{counts[filter] ?? items.length}</b> oportunidades</span>{query && <span>La búsqueda solo filtra los resultados cargados y no modifica los estados.</span>}</div>
        {canManage && <div className="opportunity-bulk-toolbar" aria-label="Acciones masivas">
          <label><input type="checkbox" checked={visibleItems.length > 0 && visibleItems.slice(0, 100).every(item => selectedCodes.includes(item.codigo_externo))} onChange={event => setSelectedCodes(event.target.checked ? [...new Set([...selectedCodes, ...visibleItems.slice(0, 100).map(item => item.codigo_externo)])].slice(0, 100) : selectedCodes.filter(code => !visibleItems.slice(0, 100).some(item => item.codigo_externo === code)))}/> Seleccionar visibles, máx. 100 ({selectedCodes.filter(code => visibleItems.some(item => item.codigo_externo === code)).length})</label>
          <button type="button" disabled={!selectedCodes.length || bulkBusy} onClick={() => void runBulk('read')}>Marcar leídas</button>
          {filter === 'discarded' ? <button type="button" disabled={!selectedCodes.length || bulkBusy} onClick={() => void runBulk('restore')}>Recuperar</button> : <button type="button" disabled={!selectedCodes.length || bulkBusy} onClick={() => void runBulk('discard')}>Descartar</button>}
          <select aria-label="Responsable para asignación masiva" value={assignmentUserId} onFocus={() => { if (!teamMembers.length) void loadTeamMembers(); }} onChange={event => setAssignmentUserId(event.target.value)}><option value="">Sin responsable</option>{teamMembers.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
          <button type="button" disabled={!selectedCodes.length || bulkBusy} onClick={() => void runBulk('assign')}>Asignar</button>
          {bulkBusy && <span role="status">Procesando {selectedCodes.length} oportunidades…</span>}
          {bulkError && <span role="alert">{bulkError}</span>}
          {bulkReport && <span role="status">Resultado: {bulkReport.filter(row => row.ok).length} correctas y {bulkReport.filter(row => !row.ok).length} con error.{bulkReport.filter(row => !row.ok).map(row => <small key={row.code} className="block">{row.code}: {row.error}</small>)}</span>}
        </div>}
        <div className="opportunity-card-grid">
          {visibleItems.map(item => {
            const isUnread = !item.readAt;
            const isNew = isUnread && isRecentlyRecommended(item.firstRecommendedAt);
            const reasons = Array.isArray(item.matchReasons) ? item.matchReasons : [];
            return <article key={item.codigo_externo} className="opportunity-card">
              <div className="opportunity-card-heading">
                {canManage && <input type="checkbox" aria-label={`Seleccionar ${item.codigo_externo}`} disabled={!selectedCodes.includes(item.codigo_externo) && selectedCodes.length >= 100} checked={selectedCodes.includes(item.codigo_externo)} onChange={event => setSelectedCodes(current => event.target.checked ? [...new Set([...current, item.codigo_externo])] : current.filter(code => code !== item.codigo_externo))}/>}
                <div className="min-w-0"><h2>{item.nombre || 'Nombre no informado'}</h2><p>{item.codigo_externo || 'Código no informado'}</p></div>
                <div className="opportunity-card-badges">
                  {filter !== 'discarded' && <span className={`opportunity-read-badge${isUnread ? ' is-unread' : ''}`}>{isNew ? 'Nueva · no leída' : isUnread ? 'No leída' : 'Leída'}</span>}
                  {filter !== 'discarded' && typeof item.score === 'number' && <span className="opportunity-match-badge">{Math.round(item.score)} pts · {levelFor(item)}</span>}
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
              {filter !== 'discarded' && <div className="opportunity-match-explanation">
                <div className="opportunity-match-explanation-heading"><b>Por qué aparece</b><span>{matchKindName[item.matchKind ?? ''] ?? (item.level === 'exploratory' ? 'Coincidencia exploratoria' : 'Afinidad textual')}</span></div>
                <p>{item.explanation || (item.level === 'exploratory' ? 'La ficha contiene señales parciales. Revísala antes de considerar que coincide con tu oferta.' : `Afinidad ${levelFor(item).toLowerCase()} calculada con señales del perfil y texto indexado; no predice una adjudicación.`)}</p>
                {item.matchedTerms?.length ? <p><b>Términos encontrados:</b> {item.matchedTerms.join(', ')}</p> : null}
                {item.matchedCategories?.length ? <p><b>Categoría del catálogo:</b> {item.matchedCategories.join(', ')}</p> : null}
                {item.matchedProfileTerms?.length ? <p><b>Perfil:</b> {item.matchedProfileTerms.join(', ')}</p> : null}
                {item.preferredRegion ? <p><b>Región preferida:</b> {item.preferredRegion} <span>(contexto, no suma puntaje)</span></p> : null}
                {item.evidence?.length ? <ul className="opportunity-evidence" aria-label="Evidencia textual de la coincidencia">{item.evidence.map((entry, index) => <li key={`${item.codigo_externo}-${entry.source}-${index}`}><b>{entry.source}:</b> “{entry.text}”{entry.matchedTerms?.length ? <small>Término literal: {entry.matchedTerms.join(', ')}</small> : null}</li>)}</ul> : null}
                {item.exclusionsChecked ? <small className="opportunity-exclusion-check">{item.exclusionTermsChecked ? `Se revisaron ${item.exclusionTermsChecked} términos de exclusión; ninguno coincide con esta ficha.` : 'No hay términos de exclusión configurados para este match.'}</small> : null}
              </div>}
              <div className="opportunity-entry-meta"><span><b>Ingreso a Recomendadas:</b> automática · {dateTime(item.firstRecommendedAt)}</span>{item.trackingCreatedAt ? <span><b>En Seguimiento:</b> guardada manualmente · {dateTime(item.trackingCreatedAt)}</span> : null}</div>

              <div className="opportunity-card-actions">
                {filter === 'discarded' ? <button type="button" className="opportunity-secondary-action" disabled={busyCode === item.codigo_externo} onClick={() => void setDiscarded(item, true)}>{busyCode === item.codigo_externo ? <LoaderCircle size={14} className="spin" /> : <RotateCcw size={14} />} Recuperar</button> : <>
                  {isUnread && <button type="button" className="opportunity-secondary-action" disabled={busyCode === item.codigo_externo} onClick={() => void markRead(item)}>{busyCode === item.codigo_externo ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Marcar como leída</button>}
                  <button type="button" className="opportunity-secondary-action" disabled={busyCode === item.codigo_externo} onClick={() => void setDiscarded(item, false)}>{busyCode === item.codigo_externo ? <LoaderCircle size={14} className="spin" /> : <Archive size={14} />} Descartar</button>
                </>}
                <button type="button" className="opportunity-secondary-action" disabled={savingCode === item.codigo_externo || Boolean(item.trackingCreatedAt)} onClick={() => void save(item.codigo_externo)}>{savingCode === item.codigo_externo ? <LoaderCircle size={14} className="spin" /> : <ArrowRight size={14} />} {item.trackingCreatedAt ? 'En Seguimiento' : 'Guardar en Seguimiento'}</button>
                <button type="button" className="opportunity-primary-action" onClick={() => onOpen(item.codigo_externo)}>Ver ficha <ArrowRight size={14} /></button>
              </div>
            </article>;
          })}
        </div>
      </>}
  </section>;
}
