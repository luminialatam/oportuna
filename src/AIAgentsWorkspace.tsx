import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleAlert, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import { calculateOfferEconomics, formatCLP } from './offerEconomics';
import type { PriceBookItem } from './PriceBookWorkspace';

type Opportunity = {
  codigo_externo: string; nombre: string | null; organismo: string | null; fecha_cierre: string | null;
  monto_estimado: number | string | null; moneda: string | null; matchReasons?: string[]; productName?: string | null;
  score?: number | null; level?: string; evidenceSources?: string[]; disclaimer?: string;
};
type Tracked = {
  id: number; codigo: string; estado: string; notes: string;
  listing: { nombre: string | null; fechaCierre: string | null; organismo: string | null };
  dates: { id: number; label: string; dueAt: string; notes: string; completed: boolean }[];
};
type Agent = 'match' | 'sheet' | 'margin' | 'followup';
type TenderItem = { NombreProducto?: string; Nombre?: string; Descripcion?: string; Categoria?: string; Cantidad?: number | string; UnidadMedida?: string };
type ListingDetail = { Nombre?: string; Descripcion?: string; Fechas?: { FechaCierre?: string }; Comprador?: { NombreOrganismo?: string }; Items?: { Listado?: TenderItem[] }; Documentos?: unknown[]; Anexos?: unknown[]; Archivos?: unknown[] };

const money = (value: number | string | null, currency: string | null) => {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return 'No informado';
  const code = currency?.trim().toUpperCase();
  return code && /^[A-Z]{3}$/.test(code) ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(Number(value)) : `${new Intl.NumberFormat('es-CL').format(Number(value))} (moneda no informada)`;
};
const date = (value: string | null) => {
  if (!value) return 'Sin fecha informada';
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? 'Sin fecha informada' : new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
};
const normalized = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-CL').replace(/[^a-z0-9]+/g, ' ').trim();
const title = (item: TenderItem) => item.NombreProducto || item.Nombre || item.Descripcion || 'Partida sin nombre informado';
const priceMatch = (item: TenderItem, rates: PriceBookItem[]) => {
  const query = normalized(title(item));
  if (!query) return undefined;
  const candidates = rates.filter(rate => rate.active && normalized(rate.name) &&
    (query === normalized(rate.name) || query.includes(` ${normalized(rate.name)} `) || query.startsWith(`${normalized(rate.name)} `)));
  return candidates.sort((a, b) => normalized(b.name).length - normalized(a.name).length)[0];
};
const normalizedUnit = (value: unknown) => {
  const unit = normalized(value).replace(/\s+/g, '');
  if (['un', 'und', 'unidad', 'unidades', 'u'].includes(unit)) return 'unidad';
  if (['m2', 'mt2', 'metrocuadrado', 'metroscuadrados'].includes(unit)) return 'm2';
  if (['hr', 'hrs', 'hora', 'horas'].includes(unit)) return 'hora';
  if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos'].includes(unit)) return 'kg';
  if (['km', 'kms', 'kilometro', 'kilometros'].includes(unit)) return 'km';
  return unit;
};

export function AIAgentsWorkspace({ companyName, companyId, onOpen, onSave, onNavigate }: {
  companyName: string | null; companyId: number | null; onOpen: (code: string) => void;
  onSave: (code: string) => Promise<boolean>; onNavigate: (section: string) => void;
}) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [tracked, setTracked] = useState<Tracked[]>([]);
  const [rates, setRates] = useState<PriceBookItem[]>([]);
  const [details, setDetails] = useState<Record<string, ListingDetail>>({});
  const [loading, setLoading] = useState(true);
  const [detailBusy, setDetailBusy] = useState('');
  const [error, setError] = useState('');
  const [active, setActive] = useState<Agent>('match');

  const load = useCallback(async () => {
    if (!companyId || !companyName) { setOpportunities([]); setTracked([]); setRates([]); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const responses = await Promise.all([
        fetch('/api/company/matches?view=board', { credentials: 'same-origin', cache: 'no-store' }),
        fetch('/api/company/tracking', { credentials: 'same-origin', cache: 'no-store' }),
        fetch('/api/company/price-book', { credentials: 'same-origin', cache: 'no-store' }),
      ]);
      const data = await Promise.all(responses.map(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'No se pudieron cargar los datos del espacio de trabajo.');
        return body;
      }));
      setOpportunities(Array.isArray(data[0].items) ? data[0].items : []);
      setTracked(Array.isArray(data[1].items) ? data[1].items : []);
      setRates(Array.isArray(data[2].items) ? data[2].items : []);
      setDetails({});
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los datos.'); }
    finally { setLoading(false); }
  }, [companyId, companyName]);
  useEffect(() => { void load(); }, [load]);

  const loadDetail = async (code: string) => {
    setDetailBusy(code); setError('');
    try {
      const response = await fetch(`/api/licitaciones/${encodeURIComponent(code)}/local`, { credentials: 'same-origin', cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudo leer la ficha local.');
      setDetails(current => ({ ...current, [code]: body.listing as ListingDetail }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo analizar la ficha.'); }
    finally { setDetailBusy(''); }
  };

  const agents: { id: Agent; name: string; description: string; action: string }[] = [
    { id: 'match', name: 'Calificador comercial', description: 'Explica las coincidencias de las oportunidades calculadas para la empresa activa.', action: 'Ver coincidencias' },
    { id: 'sheet', name: 'Analista de ficha', description: 'Resume la solicitud local, identifica datos faltantes y lista requisitos por verificar.', action: 'Analizar fichas' },
    { id: 'margin', name: 'Evaluador de margen', description: 'Cruza partidas con Precios base y calcula costos y margen solo con tarifa y cantidad compatibles.', action: 'Evaluar margen' },
    { id: 'followup', name: 'Seguimiento comercial', description: 'Muestra hitos y fechas guardadas; deja visible si el responsable no está registrado.', action: 'Ver próximos pasos' },
  ];
  const selected = agents.find(agent => agent.id === active)!;
  const visible = useMemo(() => opportunities.slice(0, active === 'margin' ? 8 : 12), [opportunities, active]);

  if (!companyId || !companyName) return <div className="rounded-xl border border-[#E1E4EA] bg-white p-8 text-center"><CircleAlert className="mx-auto mb-3 text-[#8065F5]"/><h2 className="font-semibold">Selecciona una empresa</h2><p className="mt-2 text-sm text-[#737D91]">Los agentes consultan Oportunidades, Seguimiento y Precios base de la empresa activa.</p><button className="button mt-4" onClick={() => onNavigate('Mi empresa')}>Ir a Mi empresa</button></div>;

  const listingCard = (opportunity: Opportunity, agent: Agent) => {
    const detail = details[opportunity.codigo_externo];
    const items = Array.isArray(detail?.Items?.Listado) ? detail.Items.Listado : [];
    const missing = [
      !detail?.Descripcion ? 'descripción completa' : '',
      !(detail?.Fechas?.FechaCierre || opportunity.fecha_cierre) ? 'fecha de cierre' : '',
      !(detail?.Comprador?.NombreOrganismo || opportunity.organismo) ? 'organismo comprador' : '',
      !items.length ? 'partidas y cantidades' : '',
      !(detail?.Documentos?.length || detail?.Anexos?.length || detail?.Archivos?.length) ? 'anexos y requisitos documentales' : '',
    ].filter(Boolean);
    return <article key={opportunity.codigo_externo} className="rounded-lg border border-[#E8EAED] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{opportunity.nombre || opportunity.codigo_externo}</h3><p className="text-sm text-[#737D91]">{opportunity.codigo_externo} · {opportunity.organismo || 'Organismo no informado'}</p></div><button type="button" className="text-sm font-semibold text-[#5636D9]" onClick={() => onOpen(opportunity.codigo_externo)}>Abrir licitación <ArrowRight size={14} className="inline"/></button></div>
      {agent === 'match' && <><p className="mt-2 text-sm">{opportunity.matchReasons?.length ? opportunity.matchReasons.join(' ') : 'La ficha fue incluida por el análisis de coincidencias de la empresa activa.'}</p><p className="mt-1 text-xs text-[#737D91]">Producto relacionado: {opportunity.productName || 'No identificado'} · Evidencia: {opportunity.evidenceSources?.join(', ') || 'ver detalle local'} · Puntaje: {opportunity.score ?? 'No informado'} pts</p><p className="mt-1 text-xs text-[#737D91]">{opportunity.disclaimer || 'La coincidencia no confirma elegibilidad ni probabilidad de adjudicación.'}</p><button type="button" className="mt-3 rounded-lg bg-[#5636D9] px-3 py-2 text-sm font-semibold text-white" onClick={() => void onSave(opportunity.codigo_externo)}>Guardar en Seguimiento</button></>}
      {agent === 'sheet' && <><p className="mt-2 text-sm"><b>Solicitud:</b> {detail?.Descripcion || 'Descripción no disponible en la copia local.'}</p>{detail && <><p className="mt-2 text-sm"><b>Partidas disponibles:</b> {items.length ? items.slice(0, 5).map(title).join('; ') : 'No informadas en la copia local.'}</p><p className="mt-1 text-sm text-amber-800"><b>Faltan por verificar:</b> {missing.length ? missing.join(', ') : 'No se detectaron faltantes básicos en los datos locales; revisa las bases originales.'}</p></>}<p className="mt-1 text-xs text-[#737D91]">No se infieren requisitos a partir del título. Confirma las condiciones en las bases originales y anexos.</p><button type="button" disabled={detailBusy === opportunity.codigo_externo} className="mt-3 rounded-lg bg-[#5636D9] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60" onClick={() => detail ? onOpen(opportunity.codigo_externo) : void loadDetail(opportunity.codigo_externo)}>{detailBusy === opportunity.codigo_externo ? 'Analizando…' : detail ? 'Abrir ficha y verificar bases' : 'Leer ficha local y extraer faltantes'}</button></>}
      {agent === 'margin' && <><p className="mt-2 text-sm">Monto de la licitación: {money(opportunity.monto_estimado, opportunity.moneda)}. El monto publicado no se usa como tarifa del proveedor.</p>{!detail && <button type="button" disabled={detailBusy === opportunity.codigo_externo} className="mt-3 rounded-lg border border-[#D8DDE6] px-3 py-2 text-sm font-semibold text-[#5636D9] disabled:opacity-60" onClick={() => void loadDetail(opportunity.codigo_externo)}>{detailBusy === opportunity.codigo_externo ? 'Leyendo partidas…' : 'Leer partidas de la ficha'}</button>}{detail && <div className="mt-3 space-y-2">{items.length ? items.map((item, index) => {
        const rate = priceMatch(item, rates); const quantity = Number(item.Cantidad); const qtyKnown = Number.isFinite(quantity) && quantity > 0;
        const unit = normalizedUnit(item.UnidadMedida);
        const rateUnit = rate?.chargeUnit;
        const dimensions = rate?.chargeUnit === 'm2' ? Number(rate.widthM) * Number(rate.heightM) : 1;
        const measureKnown = rate?.chargeUnit !== 'm2' || (Number(rate?.widthM) > 0 && Number(rate?.heightM) > 0 && Number.isFinite(dimensions));
        const compatible = Boolean(rate && qtyKnown && unit && rateUnit === unit && measureKnown);
        const measure = compatible && rate ? dimensions : 0;
        const fixedSurcharges = rate?.surcharges.filter(charge => charge.kind === 'fixed').reduce((sum, charge) => sum + charge.amount, 0) ?? 0;
        const percentSurcharges = rate?.surcharges.filter(charge => charge.kind === 'percent').reduce((sum, charge) => sum + charge.amount, 0) ?? 0;
        const economics = compatible && rate ? calculateOfferEconomics({ unitPrice: (rate.basePrice * measure + fixedSurcharges) * quantity * (1 + percentSurcharges / 100), unitCost: (rate.baseCost * measure + fixedSurcharges) * quantity * (1 + percentSurcharges / 100), quantity: 1, minimumMarginPercent: '' }) : null;
        return <div key={`${opportunity.codigo_externo}-${index}`} className="rounded-md bg-[#FAFAFC] p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><b>{title(item)}</b><strong className={rate ? 'text-emerald-700' : 'text-amber-700'}>{rate ? rate.name : 'Sin tarifa'}</strong></div><p className="mt-1 text-xs text-[#737D91]">Cantidad: {qtyKnown ? `${quantity} ${item.UnidadMedida || ''}`.trim() : 'no informada'}{rate ? ` · Precios base: venta ${formatCLP(rate.basePrice)}, costo ${formatCLP(rate.baseCost)} por ${rate.chargeUnit}${rate.surcharges.length ? ` · ${rate.surcharges.length} recargo(s)` : ''}` : ''}</p><p className="mt-1 text-xs">{economics ? `Costo estimado: ${formatCLP(economics.unitCost)} · Precio sugerido (tarifa base + recargos): ${formatCLP(economics.unitPrice)} · Margen bruto: ${economics.grossMarginPercent?.toFixed(1)}%` : `Sin tarifa compatible para esta partida. ${rate ? 'Revisa que la unidad y dimensiones estén informadas en la ficha.' : 'Agrega una tarifa identificable en Precios base.'} No se estima costo ni margen.`}</p></div>;
      }) : <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">La copia local no contiene partidas. No es posible cruzar tarifas.</p>}<button type="button" className="text-sm font-semibold text-[#5636D9]" onClick={() => onNavigate('Precios base')}>Revisar tarifas en Precios base</button></div>}</>}
    </article>;
  };

  const content = active === 'followup'
    ? tracked.length ? tracked.map(item => <article key={item.id} className="rounded-lg border border-[#E8EAED] p-4"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold">{item.listing.nombre || item.codigo}</h3><p className="text-sm text-[#737D91]">{item.codigo} · {item.listing.organismo || 'Organismo no informado'} · {item.estado}</p></div><button type="button" className="text-sm font-semibold text-[#5636D9]" onClick={() => onOpen(item.codigo)}>Abrir licitación <ArrowRight size={14} className="inline"/></button></div><ul className="mt-3 space-y-2 text-sm">{item.dates.length ? item.dates.map(step => <li key={step.id} className="flex gap-2"><CheckCircle2 size={15} className={step.completed ? 'text-emerald-600' : 'text-[#A0A5AC]'}/><span>{step.label} · {date(step.dueAt)} · Responsable: no registrado{step.notes ? ` · ${step.notes}` : ''}</span></li>) : <li className="text-[#737D91]">No hay próximo hito registrado. Acción siguiente: asigna responsable y fecha en Seguimiento.</li>}</ul><button type="button" className="mt-3 text-sm font-semibold text-[#5636D9]" onClick={() => onNavigate('Seguimiento')}>Gestionar responsables y fechas</button></article>) : <p className="rounded-lg border border-dashed p-6 text-center text-sm text-[#737D91]">No hay oportunidades guardadas en Seguimiento.</p>
    : active === 'margin' && !opportunities.length ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-[#737D91]">No hay oportunidades recomendadas para evaluar.</p>
    : visible.length ? visible.map(item => listingCard(item, active)) : <p className="rounded-lg border border-dashed p-6 text-center text-sm text-[#737D91]">No hay coincidencias disponibles para esta empresa.</p>;

  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#5636D9]"><Sparkles size={15}/> Empresa activa · {companyName}</p><h1 className="mt-1 text-3xl font-bold">Agentes IA</h1><p className="mt-2 text-[#667085]">Acciones basadas en coincidencias, fichas, tarifas y oportunidades guardadas de esta empresa.</p></div></header>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{agents.map(agent => <button key={agent.id} type="button" onClick={() => setActive(agent.id)} aria-pressed={active === agent.id} className={`rounded-xl border p-4 text-left transition-colors ${active === agent.id ? 'border-[#8065F5] bg-[#FAF8FF]' : 'border-[#E1E4EA] bg-white hover:border-[#C5B8FF]'}`}><b>{agent.name}</b><p className="mt-2 text-sm leading-5 text-[#737D91]">{agent.description}</p><span className="mt-3 inline-flex text-sm font-semibold text-[#5636D9]">{agent.action} <ArrowRight size={14} className="ml-1"/></span></button>)}</div>
    <section className="space-y-3 rounded-xl border border-[#E1E4EA] bg-white p-4 sm:p-5"><header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">{selected.name}</h2><p className="text-sm text-[#737D91]">Fuentes: Oportunidades, Seguimiento y Precios base · {companyName}</p></div><button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold"><RefreshCw size={14}/> Actualizar</button></header>
      {active === 'margin' && <div className="rounded-lg bg-[#FAFAFC] p-3 text-sm text-[#5D6472]">Precios base: {rates.length} tarifas encontradas en la empresa activa; {rates.filter(rate => rate.active).length} activas. El margen es bruto y se calcula con tarifa base y cantidad/unidad compatibles.</div>}
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error} <button className="ml-2 underline" onClick={() => void load()}>Reintentar</button></div>}
      {loading ? <div role="status" className="flex justify-center gap-2 p-8 text-sm text-[#737D91]"><LoaderCircle className="animate-spin" size={17}/> Cargando datos de la empresa…</div> : !error && <div className="space-y-3">{content}</div>}
    </section>
  </div>;
}
