import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownToLine, BarChart3, BookmarkPlus, Building2, CalendarDays, Check, ChevronDown, CircleHelp, Layers3, LoaderCircle, MapPin, PackageSearch, RefreshCw, Search, Trash2, Trophy } from 'lucide-react';
import './AnalyticsWorkspace.css';

type Filters = { dateFrom: string; dateTo: string; modality: string; product: string; organism: string; region: string; state: string };
type Request = <T>(url: string, options?: RequestInit) => Promise<T>;
type Row = { label: string; total?: number; listings?: number; items?: number; awards?: number };
type Analytics = {
  generatedAt: string;
  filters: Filters;
  coverage: { total: number; withBuyer: number; withRegion: number; withDeclaredAmount: number; listingsWithItems: number; amountClpRecords: number; amountNotComparable: number };
  summary: { total: number; buyers: number; openListings: number; amountClp: number; amountClpRecords: number; amountComparable: boolean };
  states: { state: number | null; total: number }[];
  modalities: Row[];
  buyers: Row[];
  regions: Row[];
  categories: Row[];
  trend: { month: string; listings: number; amountClp: number; amountClpRecords: number }[];
  competitors: { label: string; awards: number }[];
  pipeline: Record<string, { total: number; amountClp: number; amountClpRecords: number }>;
  methodology: { source: string; period: string; amount: string; categories: string; competitors: string; performance: string };
};
type SavedView = { id: number; name: string; filters: Filters; createdAt: string; updatedAt: string };

const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const initialFilters = (): Filters => ({ dateFrom: `${new Date().getFullYear()}-01-01`, dateTo: today(), modality: '', product: '', organism: '', region: '', state: '' });
const fmt = (value: number) => new Intl.NumberFormat('es-CL').format(value || 0);
const money = (value: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(value || 0);
const stateNames: Record<number, string> = { 5: 'Publicada', 6: 'Cerrada', 7: 'Desierta', 8: 'Adjudicada', 15: 'Revocada', 18: 'Revocada', 19: 'Suspendida' };
const pipelineNames: Record<string, string> = { saved: 'Guardadas', evaluating: 'En evaluación', preparing_offer: 'Preparando oferta', submitted: 'Oferta presentada', discarded: 'Descartadas' };
const tabs = [
  { id: 'market', label: 'Mercado', icon: BarChart3 },
  { id: 'buyers', label: 'Compradores', icon: Building2 },
  { id: 'products', label: 'Productos', icon: PackageSearch },
  { id: 'competitors', label: 'Competidores', icon: Trophy },
  { id: 'performance', label: 'Mi desempeño', icon: Activity },
  { id: 'custom', label: 'Personalizado', icon: Layers3 },
] as const;

function queryString(filters: Filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  return params.toString();
}

function BarList({ rows, countKey = 'total', empty = 'No hay registros para esta combinación de filtros.' }: { rows: Row[]; countKey?: 'total' | 'listings' | 'items' | 'awards'; empty?: string }) {
  const max = Math.max(1, ...rows.map((row) => Number(row[countKey] ?? 0)));
  if (!rows.length) return <div className="analytics-empty">{empty}</div>;
  return <div className="analytics-bar-list">{rows.map((row) => {
    const amount = Number(row[countKey] ?? 0);
    return <div className="analytics-bar-row" key={row.label}>
      <div className="analytics-bar-label" title={row.label}>{row.label}</div>
      <div className="analytics-bar-track"><span style={{ width: `${Math.max(3, amount / max * 100)}%` }} /></div>
      <strong>{fmt(amount)}</strong>
    </div>;
  })}</div>;
}

function TrendChart({ rows }: { rows: Analytics['trend'] }) {
  if (!rows.length) return <div className="analytics-empty">No hay datos del período seleccionado.</div>;
  const width = 760; const height = 230; const pad = { left: 42, right: 18, top: 16, bottom: 34 };
  const max = Math.max(1, ...rows.map((row) => row.listings));
  const x = (index: number) => pad.left + (rows.length < 2 ? 0 : index * (width - pad.left - pad.right) / (rows.length - 1));
  const y = (value: number) => height - pad.bottom - value / max * (height - pad.top - pad.bottom);
  const path = rows.map((row, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(row.listings)}`).join(' ');
  return <div className="analytics-chart-scroll"><svg className="analytics-trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Fichas indexadas por mes">
    {[0, 0.5, 1].map((fraction) => { const yPos = pad.top + fraction * (height - pad.top - pad.bottom); return <g key={fraction}><line x1={pad.left} x2={width - pad.right} y1={yPos} y2={yPos} className="analytics-chart-grid" /><text x={pad.left - 9} y={yPos + 4} textAnchor="end" className="analytics-chart-axis">{fmt(Math.round(max * (1 - fraction)))}</text></g>; })}
    <path d={path} className="analytics-trend-line" />
    {rows.map((row, index) => <g key={row.month}><circle cx={x(index)} cy={y(row.listings)} r="4" className="analytics-trend-point"><title>{row.month}: {fmt(row.listings)} fichas</title></circle><text x={x(index)} y={height - 9} textAnchor="middle" className="analytics-chart-axis">{row.month.slice(5)}</text></g>)}
  </svg></div>;
}

function DataPanel({ title, subtitle, icon: Icon, children }: { title: string; subtitle?: string; icon: typeof BarChart3; children: React.ReactNode }) {
  return <section className="analytics-panel"><header><div className="analytics-panel-icon"><Icon size={17} /></div><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></header>{children}</section>;
}

export function AnalyticsWorkspace({ request, csrfToken }: { request: Request; csrfToken: string }) {
  const [draft, setDraft] = useState<Filters>(initialFilters);
  const [applied, setApplied] = useState<Filters>(initialFilters);
  const [data, setData] = useState<Analytics | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [viewName, setViewName] = useState('');
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('market');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    request<Analytics>(`/api/analytics?${queryString(applied)}`).then((result) => { if (active) setData(result); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'No fue posible cargar la analítica.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applied, request]);

  useEffect(() => { void request<{ items: SavedView[] }>('/api/analytics/views').then((result) => setViews(result.items)).catch(() => setViews([])); }, [request]);

  const currentStateRows = useMemo(() => (data?.states ?? []).map((row) => ({ label: row.state == null ? 'Sin estado' : stateNames[row.state] ?? `Estado ${row.state}`, total: row.total })), [data]);
  const modalityOptions = data?.modalities ?? [];
  const regionOptions = data?.regions ?? [];

  const updateDraft = (field: keyof Filters, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const applyFilters = (event: React.FormEvent) => { event.preventDefault(); setNotice(''); setApplied({ ...draft }); };

  const saveView = async () => {
    const name = viewName.trim();
    if (name.length < 2) { setError('Escribe un nombre de al menos 2 caracteres para guardar la vista.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      await request('/api/analytics/views', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ name, filters: applied }) });
      const result = await request<{ items: SavedView[] }>('/api/analytics/views');
      setViews(result.items); setViewName(''); setNotice(`Vista «${name}» guardada para tu usuario y empresa.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible guardar la vista.'); }
    finally { setSaving(false); }
  };

  const loadView = (view: SavedView) => { setDraft({ ...initialFilters(), ...view.filters }); setApplied({ ...initialFilters(), ...view.filters }); setTab('custom'); setNotice(`Vista «${view.name}» cargada.`); };
  const deleteView = async (view: SavedView) => {
    setError(''); setNotice('');
    try { await request(`/api/analytics/views/${view.id}`, { method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken } }); setViews((current) => current.filter((item) => item.id !== view.id)); setNotice(`Vista «${view.name}» eliminada.`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible eliminar la vista.'); }
  };

  const exportCsv = async () => {
    setExporting(true); setError('');
    try {
      const response = await fetch(`/api/analytics/export.csv?${queryString(applied)}`, { credentials: 'same-origin' });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || 'No fue posible exportar los datos.'); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = 'oportuna-analitica.csv'; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      const exported = response.headers.get('X-Oportuna-Exported-Rows'); setNotice(`CSV exportado${exported ? ` con ${fmt(Number(exported))} fichas` : ''}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible exportar los datos.'); }
    finally { setExporting(false); }
  };

  const amountHeadline = data?.summary.amountComparable ? money(data.summary.amountClp) : 'No comparable';
  const monthCoverageText = data ? `${fmt(data.coverage.total)} fichas • ${fmt(data.coverage.listingsWithItems)} con partidas` : '';

  return <main className="analytics-workspace">
    <div className="analytics-heading">
      <div><div className="analytics-eyebrow"><BarChart3 size={15} /> Inteligencia de mercado</div><h1>Analítica para decidir</h1><p>Entiende quién compra, qué categorías se mueven y cómo avanza tu equipo. Cada cifra indica su cobertura y fuente.</p></div>
      <button className="analytics-export" type="button" title="Exporta hasta 20.000 fichas que cumplen los filtros actuales" onClick={() => void exportCsv()} disabled={exporting || loading}><ArrowDownToLine size={16} />{exporting ? 'Preparando CSV…' : 'Exportar CSV'}</button>
    </div>

    <form className="analytics-filter-card" onSubmit={applyFilters}>
      <div className="analytics-filter-title"><div><h2>Filtrar análisis</h2><p>El período usa la fecha de publicación; si no está disponible, usa la última sincronización local.</p></div><button type="button" className="analytics-reset" onClick={() => { const fresh = initialFilters(); setDraft(fresh); setApplied(fresh); }}>Restablecer</button></div>
      <div className="analytics-filters-grid">
        <label>Desde<input type="date" value={draft.dateFrom} max={draft.dateTo} onChange={(event) => updateDraft('dateFrom', event.target.value)} /></label>
        <label>Hasta<input type="date" value={draft.dateTo} min={draft.dateFrom} onChange={(event) => updateDraft('dateTo', event.target.value)} /></label>
        <label>Modalidad<select value={draft.modality} onChange={(event) => updateDraft('modality', event.target.value)}><option value="">Todas</option>{modalityOptions.map((row) => <option key={row.label} value={row.label}>{row.label}</option>)}</select></label>
        <label>Región<select value={draft.region} onChange={(event) => updateDraft('region', event.target.value)}><option value="">Todas</option>{regionOptions.map((row) => <option key={row.label} value={row.label}>{row.label}</option>)}</select></label>
        <label>Organismo<input value={draft.organism} onChange={(event) => updateDraft('organism', event.target.value)} placeholder="Buscar comprador" /></label>
        <label>Producto o categoría<input value={draft.product} onChange={(event) => updateDraft('product', event.target.value)} placeholder="Texto en partidas indexadas" /></label>
        <label>Estado<select value={draft.state} onChange={(event) => updateDraft('state', event.target.value)}><option value="">Todos</option>{Object.entries(stateNames).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <button className="analytics-apply" type="submit"><Search size={16} /> Aplicar filtros</button>
      </div>
    </form>

    <div className="analytics-tabs" role="tablist" aria-label="Vistas de analítica">{tabs.map(({ id,label,icon: Icon }) => <button type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} key={id} onClick={() => setTab(id)}><Icon size={16} />{label}</button>)}</div>

    {error && <div className="analytics-message is-error" role="alert">{error}<button type="button" onClick={() => setApplied({ ...applied })}><RefreshCw size={14} /> Reintentar</button></div>}
    {notice && <div className="analytics-message is-success" role="status"><Check size={15} />{notice}</div>}
    {loading && <div className="analytics-loading"><LoaderCircle size={20} className="analytics-spin" /> Actualizando las fichas que cumplen estos filtros…</div>}

    {data && <>
      <div className="analytics-kpis">
        <article><span>Fichas del análisis</span><strong>{fmt(data.summary.total)}</strong><small>Coinciden con los filtros activos.</small></article>
        <article><span>Compradores identificados</span><strong>{fmt(data.summary.buyers)}</strong><small>{fmt(data.coverage.withBuyer)} fichas tienen organismo.</small></article>
        <article><span>Procesos publicados abiertos</span><strong>{fmt(data.summary.openListings)}</strong><small>Estado publicado y cierre vigente o sin fecha.</small></article>
        <article><span>Presupuesto estimado en CLP</span><strong className={data.summary.amountComparable ? '' : 'is-muted'}>{amountHeadline}</strong><small>{fmt(data.summary.amountClpRecords)} de {fmt(data.summary.total)} fichas con monto CLP explícito; no se convierten monedas.</small></article>
      </div>
      <div className="analytics-source-line"><span><DatabaseIcon /> Datos indexados por Oportuna · {applied.dateFrom} a {applied.dateTo}</span><span>Actualizado {new Intl.DateTimeFormat('es-CL',{dateStyle:'short',timeStyle:'short'}).format(new Date(data.generatedAt))}</span></div>

      {tab === 'market' && <div className="analytics-dashboard-grid">
        <DataPanel title="Actividad del mercado" subtitle={`Fichas observadas por mes · ${monthCoverageText}`} icon={CalendarDays}><TrendChart rows={data.trend} /><p className="analytics-caption">Cuenta procesos publicados; si falta esa fecha se toma la última sincronización. No es una serie de ventas.</p></DataPanel>
        <DataPanel title="Modalidades observadas" subtitle="Cantidad de fichas por modalidad informada o código del proceso" icon={Layers3}><BarList rows={data.modalities} /><p className="analytics-caption">El código de modalidad se extrae del identificador si la fuente no entrega un nombre.</p></DataPanel>
        <DataPanel title="Estados oficiales" subtitle="Distribución de las fichas del período filtrado" icon={Activity}><BarList rows={currentStateRows} /></DataPanel>
        <DataPanel title="Actividad por región" subtitle={`${fmt(data.coverage.withRegion)} fichas con región identificable`} icon={MapPin}><BarList rows={data.regions} /></DataPanel>
      </div>}

      {tab === 'buyers' && <div className="analytics-dashboard-grid analytics-dashboard-grid-single">
        <DataPanel title="Compradores más activos" subtitle="Procesos publicados en el índice local para el período y filtros seleccionados" icon={Building2}>
          <div className="analytics-ranking-table"><div className="analytics-table-head"><span>Organismo comprador</span><span>Fichas</span></div>{data.buyers.length ? data.buyers.map((row,index) => <div className="analytics-table-row" key={row.label}><span><b className="analytics-rank">{String(index+1).padStart(2,'0')}</b>{row.label}</span><strong>{fmt(row.total ?? 0)}</strong></div>) : <div className="analytics-empty">No hay compradores identificados para estos filtros.</div>}</div>
          <p className="analytics-caption">El ranking refleja la cobertura del índice de Oportuna. No equivale al gasto total de cada organismo.</p>
        </DataPanel>
        <DataPanel title="Distribución de compradores" subtitle="Principales organismos por cantidad de procesos" icon={BarChart3}><BarList rows={data.buyers} /></DataPanel>
      </div>}

      {tab === 'products' && <div className="analytics-dashboard-grid analytics-dashboard-grid-single">
        <DataPanel title="Productos y categorías presentes" subtitle={`${fmt(data.coverage.listingsWithItems)} fichas contienen partidas indexadas`} icon={PackageSearch}>
          <div className="analytics-ranking-table"><div className="analytics-table-head"><span>Categoría o descripción de partida</span><span>Fichas / partidas</span></div>{data.categories.length ? data.categories.map((row,index) => <div className="analytics-table-row" key={row.label}><span><b className="analytics-rank">{String(index+1).padStart(2,'0')}</b>{row.label}</span><strong>{fmt(row.listings ?? 0)} / {fmt(row.items ?? 0)}</strong></div>) : <div className="analytics-empty">No hay partidas indexadas para estos filtros.</div>}</div>
          <div className="analytics-limit-note"><CircleHelp size={16} /><p><b>Cómo leerlo:</b> cada fila cuenta fichas y partidas donde aparece el texto de la categoría o producto. No calcula ventas ni precio por producto, porque las partidas no contienen precios comparables completos.</p></div>
        </DataPanel>
        <DataPanel title="Regiones con mayor actividad" subtitle="Procesos con ubicación presente en la ficha indexada" icon={MapPin}><BarList rows={data.regions} /></DataPanel>
      </div>}

      {tab === 'competitors' && <div className="analytics-dashboard-grid analytics-dashboard-grid-single">
        <DataPanel title="Adjudicatarios identificados en el detalle oficial" subtitle="Conteo de procesos adjudicados con proveedor explícito en el payload indexado" icon={Trophy}>
          {data.competitors.length ? <><div className="analytics-ranking-table"><div className="analytics-table-head"><span>Proveedor adjudicatario</span><span>Procesos</span></div>{data.competitors.map((row,index) => <div className="analytics-table-row" key={row.label}><span><b className="analytics-rank">{String(index+1).padStart(2,'0')}</b>{row.label}</span><strong>{fmt(row.awards)}</strong></div>)}</div><p className="analytics-caption">Muestra proveedores observados en adjudicaciones detalladas. No representa todas las adjudicaciones, ventas, participación de mercado ni tasa de éxito.</p></> : <div className="analytics-no-data"><Trophy size={20} /><div><b>Aún no hay adjudicatarios detallados para estos filtros</b><p>Las fichas resumidas no bastan para atribuir un proceso a un proveedor. Esta vista solo contará nombres explícitos guardados en detalles oficiales indexados.</p></div></div>}
        </DataPanel>
        <DataPanel title="Estados adjudicados" subtitle="El conteo usa estado oficial, no inferencias de coincidencia" icon={Activity}><BarList rows={currentStateRows.filter((row) => row.label === 'Adjudicada')} /></DataPanel>
      </div>}

      {tab === 'performance' && <div className="analytics-dashboard-grid analytics-dashboard-grid-single">
        <DataPanel title="Pipeline de Andes Organics" subtitle="Oportunidades guardadas por la empresa activa, filtradas por el período y los criterios de arriba" icon={Activity}>
          <div className="analytics-pipeline">{Object.entries(pipelineNames).map(([key,label]) => { const value=data.pipeline[key]?.total ?? 0; const max=Math.max(1,...Object.values(data.pipeline).map((entry) => entry.total)); return <div className="analytics-pipeline-row" key={key}><div><span>{label}</span><b>{fmt(value)}</b></div><div className="analytics-bar-track"><span style={{width:`${value ? Math.max(3,value/max*100) : 0}%`}} /></div></div>; })}</div>
          <div className="analytics-limit-note"><CircleHelp size={16} /><p>Este es un embudo operativo de Seguimiento, no una tasa de éxito ni una proyección de ventas. Oportuna todavía no mide adjudicaciones rentables ni margen real en esta vista.</p></div>
        </DataPanel>
        <DataPanel title="Presupuesto estimado asociado al pipeline" subtitle="Solo montos con moneda CLP explícita; importe estimado, no ingresos" icon={Building2}>
          <div className="analytics-pipeline-values">{Object.entries(pipelineNames).map(([key,label]) => { const item=data.pipeline[key]; return <div key={key}><span>{label}</span><strong>{item?.amountClpRecords ? money(item.amountClp) : 'Sin CLP informado'}</strong><small>{fmt(item?.amountClpRecords ?? 0)} fichas con monto CLP</small></div>; })}</div>
        </DataPanel>
      </div>}

      {tab === 'custom' && <div className="analytics-dashboard-grid analytics-dashboard-grid-single">
        <DataPanel title="Vista personalizada" subtitle="Guarda esta combinación de filtros para volver a analizarla en un clic" icon={Layers3}>
          <div className="analytics-custom-summary"><span>Período <b>{applied.dateFrom} → {applied.dateTo}</b></span><span>Modalidad <b>{applied.modality || 'Todas'}</b></span><span>Región <b>{applied.region || 'Todas'}</b></span><span>Estado <b>{applied.state ? stateNames[Number(applied.state)] ?? applied.state : 'Todos'}</b></span><span>Organismo <b>{applied.organism || 'Todos'}</b></span><span>Producto <b>{applied.product || 'Todos'}</b></span></div>
          <div className="analytics-save-form"><label htmlFor="analytics-view-name">Nombre de la vista</label><div><input id="analytics-view-name" value={viewName} maxLength={80} onChange={(event) => setViewName(event.target.value)} placeholder="Ej.: Compras de equipamiento médico" /><button type="button" onClick={() => void saveView()} disabled={saving}><BookmarkPlus size={15} />{saving ? 'Guardando…' : 'Guardar vista'}</button></div><small>La vista queda disponible solo para tu usuario dentro de la empresa activa.</small></div>
          <div className="analytics-saved-views"><h3>Mis vistas guardadas</h3>{views.length ? views.map((view) => <div className="analytics-saved-view" key={view.id}><button type="button" onClick={() => loadView(view)}><b>{view.name}</b><span>{view.filters.dateFrom} → {view.filters.dateTo}{view.filters.region ? ` · ${view.filters.region}` : ''}{view.filters.product ? ` · ${view.filters.product}` : ''}</span></button><button type="button" className="analytics-delete-view" aria-label={`Eliminar vista ${view.name}`} title="Eliminar vista" onClick={() => void deleteView(view)}><Trash2 size={15} /></button></div>) : <div className="analytics-empty">Todavía no has guardado vistas personalizadas.</div>}</div>
        </DataPanel>
        <DataPanel title="Resumen de la selección" subtitle="Indicadores recalculados con los filtros actuales" icon={BarChart3}><BarList rows={data.buyers.slice(0,8)} /><p className="analytics-caption">Fuente: {data.methodology.source}</p></DataPanel>
      </div>}

      <footer className="analytics-methodology"><InfoIcon /><div><b>Fuente y alcance</b><p>{data.methodology.source} La cobertura de este análisis es de {fmt(data.coverage.total)} fichas en el período. {data.methodology.amount}</p></div><details><summary>Ver criterios de lectura <ChevronDown size={14} /></summary><ul><li>{data.methodology.categories}</li><li>{data.methodology.competitors}</li><li>{data.methodology.performance}</li></ul></details></footer>
    </>}
  </main>;
}

function DatabaseIcon() { return <span className="analytics-source-dot" aria-hidden="true" />; }
function InfoIcon() { return <CircleHelp size={17} aria-hidden="true" />; }
