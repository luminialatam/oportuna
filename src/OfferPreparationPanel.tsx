import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Circle, ExternalLink, FileText, Save, ShieldCheck, Sparkles, Trash2, UploadCloud } from 'lucide-react';
import { calculateOfferEconomics, formatCLP } from './offerEconomics.js';
import { loadPriceBook, type PriceBookItem } from './PriceBookWorkspace.js';
import { suggestCatalogMatches, type CatalogMatchItem } from './offerCatalogMatching.js';
import { OpportunityTeamPanel } from './OpportunityTeamPanel.js';

type OfferItem = {
  enabled: boolean;
  unitPrice: string;
  directUnitCost: string;
  specification: string;
  comment: string;
  catalogProductId: string;
};
type OfferDocumentFinding = {
  id: string; kind: 'requirement' | 'deadline' | 'document' | 'evaluation_criterion' | 'technical_condition' | 'risk';
  title: string; extractedText: string; interpretation: string; sourceLocation: string; sourceQuote: string;
  dueDate: string | null; reviewStatus: 'pending' | 'confirmed' | 'corrected' | 'discarded'; correction: string;
  relatedItemCode: string; relatedDocumentName: string;
};
type OfferDocument = {
  name: string; url: string; requirement: string; reviewStatus: 'pending' | 'reviewed' | 'covered'; reviewNotes: string;
  sourceKind?: 'official' | 'uploaded'; analysisStatus?: 'running' | 'completed' | 'failed'; analysisError?: string;
  analysisAt?: string; analysisProvider?: 'groq'; analysisPartial?: boolean; analysisWarnings?: string[];
  analysisOmittedUnverifiable?: number; analysisFindings?: OfferDocumentFinding[];
};
type OfferDraft = {
  quoteName: string;
  details: string;
  responsible: string;
  deadline: string;
  minimumMarginPercent: string;
  declarationReviewed: boolean;
  items: Record<string, OfferItem>;
  documents: OfferDocument[];
};

const emptyDraft: OfferDraft = {
  quoteName: '', details: '', responsible: '', deadline: '', minimumMarginPercent: '', declarationReviewed: false, items: {}, documents: [],
};

function itemCode(item: any, index: number) {
  return String(item.CodigoProducto ?? item.Codigo ?? item.codigo ?? index + 1);
}

export function OfferPreparationPanel({
  listing, companyId, userId, csrfToken, canEdit = true,
}: {
  listing: any;
  companyId: number | string;
  userId: number | string;
  csrfToken: string;
  canEdit?: boolean;
}) {
  const code = String(listing.CodigoExterno ?? listing.codigo_externo ?? '');
  const listingStatus = Number(listing.CodigoEstado ?? listing.codigo_estado);
  const closedStatusMessage = listingStatus === 6
    ? 'Este proceso aparece cerrado. Puedes conservar este borrador para registro interno, pero no representa una oferta presentable.'
    : listingStatus === 7 ? 'Este proceso aparece desierto. La preparación solo sirve como registro interno.'
      : listingStatus === 8 ? 'Este proceso ya aparece adjudicado. Usa la preparación solo para análisis interno.'
        : [15, 18].includes(listingStatus) ? 'Este proceso aparece revocado. La preparación solo sirve como registro interno.'
          : listingStatus === 19 ? 'Este proceso aparece suspendido. Confirma su situación en Mercado Público antes de continuar.' : '';
  const products = useMemo(() => {
    const value = listing.Items?.Listado;
    return Array.isArray(value) ? value : value ? [value] : [];
  }, [listing]);
  const officialDocuments: OfferDocument[] = useMemo(() => ['Documentos', 'Archivos', 'Anexos', 'Adjuntos'].flatMap(source => {
    const value = listing?.[source];
    return (Array.isArray(value) ? value : value ? [value] : []).map((item: any, index: number) => {
      const rawUrl = String(item.Url ?? item.URL ?? item.Link ?? item.UrlDocumento ?? '');
      return {
      name: String(item.Nombre ?? item.NombreArchivo ?? item.Descripcion ?? `${source} ${index + 1}`),
      url: /^https?:\/\//i.test(rawUrl) ? rawUrl : '',
      requirement: 'Documento publicado en la ficha oficial', reviewStatus: 'pending' as const, reviewNotes: '',
    };});
  }), [listing]);
  const [draft, setDraft] = useState<OfferDraft>(emptyDraft);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [priceBook, setPriceBook] = useState<PriceBookItem[]>([]);
  const [priceBookError, setPriceBookError] = useState('');
  const [catalog, setCatalog] = useState<CatalogMatchItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [selectedRates, setSelectedRates] = useState<Record<string, string>>({});
  const [dimensions, setDimensions] = useState<Record<string, { width: string; height: string }>>({});
  const [priceBookHint, setPriceBookHint] = useState('');
  const [selectedDocumentFile, setSelectedDocumentFile] = useState<File | null>(null);
  const [documentAnalysisIndex, setDocumentAnalysisIndex] = useState<number | null>(null);
  const [documentAnalysisError, setDocumentAnalysisError] = useState('');
  const [documentAnalysisConsent, setDocumentAnalysisConsent] = useState(false);
  const draftRef = useRef(draft);

  useEffect(() => { draftRef.current = draft; }, [draft]);

  const loadCatalog = async () => {
    setCatalogLoading(true); setCatalogError('');
    try {
      const response = await fetch('/api/company/catalog?q=', { credentials: 'same-origin' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudo cargar el catálogo de la empresa activa.');
      setCatalog(Array.isArray(body.items) ? body.items : []);
    } catch (cause) { setCatalogError(cause instanceof Error ? cause.message : 'No se pudo cargar el catálogo.'); }
    finally { setCatalogLoading(false); }
  };
  const loadRates = async () => {
    setPriceBookError('');
    try { setPriceBook(await loadPriceBook()); }
    catch (cause) { setPriceBookError(cause instanceof Error ? cause.message : 'No se pudo cargar Precios base.'); }
  };
  useEffect(() => { void loadRates(); void loadCatalog(); }, [companyId]);

  useEffect(() => {
    setLoaded(false);
    setError('');
    setLoadError('');
    const controller = new AbortController();
    void fetch(`/api/company/offer-drafts/${encodeURIComponent(code)}`, { credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'No se pudo cargar el borrador.');
        return body;
      })
      .then((data) => {
        const savedDraft = data.draft;
        const items = Object.fromEntries(Object.entries(savedDraft?.items ?? {}).map(([id, item]) => [id, {
          enabled: true, unitPrice: '', directUnitCost: '', specification: '', comment: '', catalogProductId: '', ...(item as object),
        }]));
        const savedDocuments = (savedDraft?.documents ?? []).map((doc: any) => ({ requirement: '', reviewStatus: 'pending', reviewNotes: '', ...doc }));
        const documents = [...officialDocuments.map(doc => savedDocuments.find((saved: OfferDocument) => saved.name === doc.name && saved.url === doc.url) ?? doc),
          ...savedDocuments.filter((saved: OfferDocument) => !officialDocuments.some(doc => doc.name === saved.name && doc.url === saved.url))];
        setDraft({ ...emptyDraft, ...(savedDraft ?? {}), items, documents });
        setSavedAt(data.updatedAt ?? null);
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setDraft(emptyDraft);
        setSavedAt(null);
        const message = cause instanceof Error ? cause.message : 'No se pudo cargar el borrador.';
        setLoadError(message); setError(message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoaded(true); });
    return () => controller.abort();
  }, [companyId, userId, code, officialDocuments, loadAttempt]);

  const patchDraft = (patch: Partial<OfferDraft>) => {
    setSavedAt(null);
    setDraft((current) => { const next = { ...current, ...patch }; draftRef.current = next; return next; });
  };
  const patchItem = (id: string, patch: Partial<OfferItem>) => {
    setSavedAt(null);
    setDraft((current) => {
      const nextItem: OfferItem = Object.assign(
        { enabled: true, unitPrice: '', directUnitCost: '', specification: '', comment: '', catalogProductId: '' },
        current.items[id],
        patch,
      );
      const next = { ...current, items: { ...current.items, [id]: nextItem } }; draftRef.current = next; return next;
    });
  };
  const saveDraftSnapshot = async (value: OfferDraft) => {
    const response = await fetch(`/api/company/offer-drafts/${encodeURIComponent(code)}`, {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(value),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar el borrador.');
    setSavedAt(data.updatedAt ?? new Date().toISOString());
  };
  const save = async () => {
    if (loadError) return;
    setSaving(true);
    setError('');
    try {
      await saveDraftSnapshot(draftRef.current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el borrador.');
    } finally {
      setSaving(false);
    }
  };
  const runDocumentAnalysis = async (documentIndex: number, file?: File) => {
    if (!documentAnalysisConsent) { setDocumentAnalysisError('Confirma que autorizas enviar el texto extraído al proveedor Groq configurado por Oportuna.'); return; }
    if (documentAnalysisIndex !== null) return;
    setDocumentAnalysisError('');
    setSaving(true);
    setDocumentAnalysisIndex(documentIndex);
    let index = documentIndex;
    try {
      let working = draftRef.current;
      if (file) {
        const found = working.documents.findIndex(doc => doc.name === file.name && doc.url === '');
        const uploaded: OfferDocument = found >= 0
          ? { ...working.documents[found], sourceKind: 'uploaded', analysisStatus: 'running', analysisError: '' }
          : { name: file.name.slice(0, 255), url: '', requirement: 'Archivo incorporado para revisión', reviewStatus: 'pending', reviewNotes: '', sourceKind: 'uploaded', analysisStatus: 'running', analysisError: '' };
        if (found >= 0) index = found;
        else index = working.documents.length;
        const documents = found >= 0 ? working.documents.map((doc, position) => position === index ? uploaded : doc) : [...working.documents, uploaded];
        working = { ...working, documents };
      } else {
        working = { ...working, documents: working.documents.map((doc, position) => position === index ? { ...doc, sourceKind: doc.sourceKind ?? 'official', analysisStatus: 'running', analysisError: '' } : doc) };
      }
      draftRef.current = working; setDraft(working);
      await saveDraftSnapshot(working);
    } catch (cause) {
      const message = cause instanceof Error ? `No se inició el análisis porque no se pudo guardar el borrador: ${cause.message}` : 'No se inició el análisis porque no se pudo guardar el borrador.';
      const latest = draftRef.current;
      const next = { ...latest, documents: latest.documents.map((doc, position) => position === index ? { ...doc, analysisStatus: 'failed' as const, analysisError: message } : doc) };
      draftRef.current = next; setDraft(next); setSavedAt(null); setDocumentAnalysisError(message);
      setDocumentAnalysisIndex(null); setSaving(false); return;
    }
    let data: any;
    try {
      const document = draftRef.current.documents[index];
      let response: Response;
      if (file) {
        const body = new FormData(); body.append('name', document.name); body.append('file', file);
        response = await fetch(`/api/company/offer-drafts/${encodeURIComponent(code)}/analyze-document`, { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrfToken }, body });
      } else {
        response = await fetch(`/api/company/offer-drafts/${encodeURIComponent(code)}/analyze-document`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ name: document.name, url: document.url }) });
      }
      data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo analizar el documento.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No se pudo analizar el documento.';
      const latest = draftRef.current;
      const next = { ...latest, documents: latest.documents.map((doc, position) => position === index ? { ...doc, analysisStatus: 'failed' as const, analysisError: message } : doc) };
      draftRef.current = next; setDraft(next); setSavedAt(null); setDocumentAnalysisError(message);
      try { await saveDraftSnapshot(next); } catch { setDocumentAnalysisError(`${message} El error quedó solo en esta pantalla porque no se pudo guardar el estado; vuelve a guardar el borrador cuando el servicio esté disponible.`); }
      setDocumentAnalysisIndex(null); setSaving(false); return;
    }
    const latest = draftRef.current;
    const next = { ...latest, documents: latest.documents.map((doc, position) => position === index ? { ...doc, analysisStatus: 'completed' as const, analysisError: '', analysisAt: data.analysisAt, analysisProvider: data.analysis.provider, analysisPartial: data.analysis.partial, analysisWarnings: data.analysis.warnings ?? [], analysisOmittedUnverifiable: data.analysis.omittedUnverifiable ?? 0, analysisFindings: data.analysis.findings ?? [] } : doc) };
    draftRef.current = next; setDraft(next);
    try { await saveDraftSnapshot(next); setError(''); setDocumentAnalysisError(''); }
    catch (cause) { setSavedAt(null); setDocumentAnalysisError(`El análisis terminó, pero no se pudo guardar en el servidor: ${cause instanceof Error ? cause.message : 'error de guardado'}. El resultado queda en esta pantalla; vuelve a guardar el borrador.`); }
    setDocumentAnalysisIndex(null); setSaving(false);
  };
  const patchDocumentFinding = (documentIndex: number, findingId: string, patch: Partial<OfferDocumentFinding>) => {
    const current = draftRef.current;
    const next = { ...current, documents: current.documents.map((doc, index) => index === documentIndex ? { ...doc, analysisFindings: (doc.analysisFindings ?? []).map(finding => finding.id === findingId ? { ...finding, ...patch } : finding) } : doc) };
    draftRef.current = next; setDraft(next); setSavedAt(null);
  };
  const reset = async () => {
    if (!window.confirm('¿Eliminar el borrador de preparación de esta licitación?')) return;
    setError('');
    try {
      const response = await fetch(`/api/company/offer-drafts/${encodeURIComponent(code)}`, {
        method: 'DELETE', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrfToken },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo eliminar el borrador.');
      setDraft(emptyDraft); setSavedAt(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo eliminar el borrador.');
    }
  };

  const applyBasePrice = (id: string) => {
    const rate = priceBook.find(entry => String(entry.id) === selectedRates[id]);
    if (!rate?.active) return;
    const dim = dimensions[id] ?? { width: String(rate.widthM || ''), height: String(rate.heightM || '') };
    const measure = rate.chargeUnit === 'm2' ? Number(dim.width) * Number(dim.height) : 1;
    if (rate.chargeUnit === 'm2' && (!Number(dim.width) || !Number(dim.height))) { setPriceBookHint('Ingresa ancho y alto en metros para calcular la tarifa por m².'); return; }
    const surchargeFixed = rate.surcharges.filter(charge => charge.kind === 'fixed').reduce((sum, charge) => sum + charge.amount, 0);
    const surchargePercent = rate.surcharges.filter(charge => charge.kind === 'percent').reduce((sum, charge) => sum + charge.amount, 0);
    const cost = (rate.baseCost * measure + surchargeFixed) * (1 + surchargePercent / 100);
    const price = (rate.basePrice * measure + surchargeFixed) * (1 + surchargePercent / 100);
    patchItem(id, { directUnitCost: String(Math.round(cost)), unitPrice: String(Math.round(price)), specification: [rate.specifications, rate.chargeUnit === 'm2' ? `${dim.width} × ${dim.height} m = ${measure.toFixed(2)} m²` : '', rate.surcharges.length ? `Incluye recargos: ${rate.surcharges.map(value => value.name).join(', ')}` : ''].filter(Boolean).join('\n') });
    setPriceBookHint(`Tarifa «${rate.name}» aplicada. Revisa los importes antes de guardar el borrador.`);
  };

  const activeItems = products.filter((item: any, index: number) => draft.items[itemCode(item, index)]?.enabled !== false);
  const activePriceBook = priceBook.filter(rate => rate.active);
  const officialRequirements = [
    ['Prohibición de contratación', listing.ProhibicionContratacion], ['Subcontratación', listing.SubContratacion],
    ['Toma de razón', listing.TomaRazon], ['Renovable', listing.EsRenovable], ['Duración del contrato', listing.TipoDuracionContrato],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');
  const risks = [
    ...(!draft.quoteName.trim() ? ['Falta el nombre interno de la oferta.'] : []),
    ...(!draft.responsible.trim() ? ['Falta asignar una persona responsable.'] : []),
    ...(!draft.deadline ? ['Falta definir una fecha límite interna.'] : []),
    ...((listing.Fechas?.FechaCierre ?? listing.FechaCierre) && new Date(listing.Fechas?.FechaCierre ?? listing.FechaCierre).getTime() < Date.now() ? ['La fecha de cierre informada ya pasó; confirma el estado en Mercado Público.'] : []),
    ...(!draft.declarationReviewed ? ['No está confirmada la revisión de bases y declaraciones oficiales.'] : []),
    ...(!officialRequirements.length ? ['La ficha no informó requisitos administrativos estructurados; deben verificarse en las bases.'] : []),
    ...(!officialDocuments.length ? ['La ficha no informó documentos estructurados; revisa las bases oficiales.'] : []),
    ...(activeItems.some((item: any, index: number) => !draft.items[itemCode(item, index)]?.catalogProductId) ? ['Hay partidas sin relación confirmada con un producto del catálogo.'] : []),
    ...(draft.documents.some(doc => doc.reviewStatus === 'pending') ? ['Hay documentos pendientes de revisión.'] : []),
  ];
  const completedItems = activeItems.filter((item: any, index: number) => {
    const entry = draft.items[itemCode(item, index)];
    return Boolean(entry?.unitPrice.trim() && entry?.directUnitCost.trim() && entry?.specification.trim());
  }).length;
  const completedFields = Number(Boolean(draft.quoteName.trim())) + Number(Boolean(draft.details.trim())) +
    Number(Boolean(draft.responsible.trim())) + Number(Boolean(draft.deadline)) +
    Number(draft.declarationReviewed) + completedItems;
  const totalFields = 5 + activeItems.length;
  const activeEconomics = activeItems.map((item: any, index: number) => {
    const entry = draft.items[itemCode(item, index)] ?? { unitPrice: '', directUnitCost: '' };
    return calculateOfferEconomics({
      unitPrice: entry.unitPrice,
      unitCost: entry.directUnitCost,
      quantity: item.Cantidad ?? item.cantidad,
      minimumMarginPercent: draft.minimumMarginPercent,
    });
  });
  const totalsAvailable = activeEconomics.length > 0 && activeEconomics.every(line => line.revenue != null && line.directCost != null && line.grossProfit != null);
  const totalRevenue = totalsAvailable ? activeEconomics.reduce((sum, line) => sum + (line.revenue ?? 0), 0) : null;
  const totalDirectCost = totalsAvailable ? activeEconomics.reduce((sum, line) => sum + (line.directCost ?? 0), 0) : null;
  const totalGrossProfit = totalsAvailable ? activeEconomics.reduce((sum, line) => sum + (line.grossProfit ?? 0), 0) : null;
  const totalGrossMargin = totalRevenue && totalGrossProfit != null ? totalGrossProfit / totalRevenue * 100 : null;
  const targetMargin = draft.minimumMarginPercent.trim() ? Number(draft.minimumMarginPercent) : null;

  if (!loaded) return <div className="p-6 text-sm text-[#667085]" role="status">Cargando borrador de preparación…</div>;

  return (
    <section className="space-y-5" aria-label="Preparación interna de oferta">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <strong className="block">Preparación interna; no envía una postulación</strong>
        Esta herramienta organiza la cotización de tu empresa. La presentación oficial y la carga de documentos se realizan en Mercado Público.
      </div>
      {loadError && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert"><span>No se pudo cargar el borrador: {loadError}. Para proteger el trabajo guardado, no se permite guardar hasta recuperar los datos.</span><button type="button" onClick={() => setLoadAttempt(value => value + 1)} className="font-semibold underline">Reintentar carga</button></div>}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E1E4EA] bg-white px-4 py-3 text-sm">
        <span className="text-[#475467]">Licitación <strong>{code || 'sin código'}</strong> · {listing.Nombre ?? listing.nombre ?? 'Nombre no informado'}</span>
        {code && <a className="inline-flex items-center gap-1 font-semibold text-[#5636D9]" href={`https://www.mercadopublico.cl/fichaLicitacion.html?idLicitacion=${encodeURIComponent(code)}`} target="_blank" rel="noreferrer">Abrir fuente oficial <ExternalLink size={14}/></a>}
      </div>
      <OpportunityTeamPanel code={code} csrfToken={csrfToken} canEdit={canEdit} />
      {closedStatusMessage && <div role="status" className="rounded-xl border border-amber-300 bg-[#fffaf0] p-4 text-sm text-amber-900"><strong className="mr-1">Estado de la ficha:</strong>{closedStatusMessage}</div>}

      <div className={`rounded-xl border p-4 text-sm ${risks.length ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
        <h3 className="flex items-center gap-2 font-semibold"><AlertTriangle size={17}/>{risks.length ? `${risks.length} puntos pendientes de revisión` : 'Sin pendientes internos detectados'}</h3>
        {risks.length ? <ul className="mt-2 list-disc space-y-1 pl-5">{risks.map(risk => <li key={risk}>{risk}</li>)}</ul> : <p className="mt-1">Este resumen revisa únicamente los campos de esta preparación; no certifica cumplimiento.</p>}
      </div>

      <div className="rounded-xl border border-[#E1E4EA] bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-[#171A24]">Información de la oferta</h3>
            <p className="mt-1 text-sm text-[#667085]">Completa los datos para preparar el trabajo de tu equipo.</p>
          </div>
          <span className="rounded-full bg-[#F2F0FF] px-3 py-1 text-sm font-medium text-[#5636D9]">
            {completedFields} de {totalFields} completados
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium text-[#344054]">
            Nombre de cotización
            <input className="w-full rounded-lg border border-[#D0D5DD] px-3 py-2.5 text-base" maxLength={255} value={draft.quoteName} onChange={(e) => patchDraft({ quoteName: e.target.value })} placeholder="Ej. Oferta equipos de frío" />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-[#344054]">
            Responsable
            <input className="w-full rounded-lg border border-[#D0D5DD] px-3 py-2.5 text-base" maxLength={160} value={draft.responsible} onChange={(e) => patchDraft({ responsible: e.target.value })} placeholder="Persona a cargo" />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-[#344054]">
            Fecha límite interna
            <input className="w-full rounded-lg border border-[#D0D5DD] px-3 py-2.5 text-base" type="date" value={draft.deadline} onChange={(e) => patchDraft({ deadline: e.target.value })} />
          </label>
          <div className="space-y-1.5 text-sm font-medium text-[#344054]">
            Cierre oficial informado
            <div className="rounded-lg border border-[#E1E4EA] bg-[#F8F9FA] px-3 py-2.5 text-base font-semibold">
              {listing.Fechas?.FechaCierre ?? listing.FechaCierre ?? 'No informado'}
            </div>
          </div>
          <label className="space-y-1.5 text-sm font-medium text-[#344054] md:col-span-2">
            Notas de la cotización
            <textarea className="min-h-24 w-full rounded-lg border border-[#D0D5DD] px-3 py-2.5 text-base" maxLength={5000} value={draft.details} onChange={(e) => patchDraft({ details: e.target.value })} placeholder="Alcance, supuestos, condiciones comerciales y coordinación interna" />
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-[#E1E4EA] bg-white p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-[#171A24]">Partidas y precios</h3>
            <p className="mt-1 text-sm text-[#667085]">Las partidas provienen de la ficha oficial cuando están disponibles.</p>
          </div>
          {products.length > 0 && <span className="text-sm text-[#667085]">{completedItems}/{activeItems.length} partidas cotizadas</span>}
        </div>
        {priceBookError && <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert"><span>Precios base no se pudo cargar: {priceBookError}</span><button type="button" onClick={() => void loadRates()} className="font-semibold underline">Reintentar</button></div>}
        {!priceBookError && !activePriceBook.length && <p className="mb-3 rounded-lg bg-[#F8F9FA] p-3 text-sm text-[#667085]">No hay tarifas activas de Precios base disponibles para sugerir importes. Los precios quedan sin informar hasta que los ingreses o elijas una tarifa existente.</p>}
        {products.length > 0 && <div className="mb-4 space-y-3 rounded-xl border border-[#DED8FF] bg-[#FAF9FF] p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h4 className="font-semibold text-[#171A24]">Control de margen de la oferta</h4>
              <p className="mt-1 text-sm text-[#667085]">Compara tus costos propios con el precio que planeas ofertar.</p>
            </div>
            <label className="grid gap-1 text-sm font-medium text-[#344054]">Margen bruto mínimo objetivo (opcional)
              <div className="flex items-center gap-2"><input aria-label="Margen bruto mínimo objetivo" type="number" min="0" max="100" step="0.1" className="w-28 rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 text-base" value={draft.minimumMarginPercent} onChange={(e) => patchDraft({ minimumMarginPercent: e.target.value })} placeholder="Ej. 25" /><span>%</span></div>
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { label: 'Venta proyectada', value: formatCLP(totalRevenue) },
              { label: 'Costos directos ingresados', value: formatCLP(totalDirectCost) },
              { label: 'Margen bruto ponderado', value: totalGrossProfit == null ? '—' : `${formatCLP(totalGrossProfit)}${totalGrossMargin == null ? '' : ` · ${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(totalGrossMargin)}%`}` },
            ].map(metric => <div key={metric.label} className="rounded-lg border border-[#E8E5F5] bg-white p-3">
              <span className="block text-xs text-[#667085]">{metric.label}</span>
              <strong className="mt-1 block text-base text-[#171A24]">{metric.value}</strong>
            </div>)}
          </div>
          <p className="text-xs leading-relaxed text-[#667085]">
            {totalsAvailable
              ? targetMargin == null ? 'Total calculado con las cantidades de la ficha y los valores que ingresaste. No equivale a utilidad neta.' : totalGrossMargin == null ? 'No hay venta total mayor que cero para calcular el porcentaje de margen.' : totalGrossMargin >= targetMargin ? `El escenario supera tu objetivo de ${targetMargin}% de margen bruto.` : `El escenario queda bajo tu objetivo de ${targetMargin}% de margen bruto.`
              : 'Ingresa costo y precio para todas las partidas seleccionadas. También se necesita la cantidad de cada partida para calcular los totales.'}
            {' '}El cálculo no incorpora impuestos, garantías, despacho ni otros costos, salvo que los incluyas en el costo unitario.
          </p>
        </div>}
        {products.length ? <div className="space-y-4">
          {products.map((item: any, index: number) => {
            const id = itemCode(item, index);
            const entry = draft.items[id] ?? { enabled: true, unitPrice: '', directUnitCost: '', specification: '', comment: '', catalogProductId: '' };
            const partName = String(item.NombreProducto || item.Nombre || item.nombre || '');
            const partDescription = String(item.Descripcion || item.descripcion || item.Especificacion || '');
            const suggestions = suggestCatalogMatches({ name: partName, description: partDescription, category: String(item.Categoria ?? '') }, catalog);
            const selectedCatalogItem = catalog.find(product => String(product.id) === entry.catalogProductId);
            const economics = calculateOfferEconomics({ unitPrice: entry.unitPrice, unitCost: entry.directUnitCost, quantity: item.Cantidad ?? item.cantidad, minimumMarginPercent: draft.minimumMarginPercent });
            return <article key={`${id}-${index}`} className="rounded-xl border border-[#E1E4EA] p-4">
              <div className="mb-4 flex items-start gap-3">
                <input aria-label={`Incluir partida ${index + 1}`} type="checkbox" className="mt-1 h-4 w-4 accent-[#5636D9]" checked={entry.enabled} onChange={(e) => patchItem(id, { enabled: e.target.checked })} />
                <div className="min-w-0 flex-1">
                  <h4 className="font-semibold text-[#171A24]">{item.NombreProducto || item.Nombre || item.nombre || `Partida ${index + 1}`}</h4>
                  <p className="mt-1 text-sm text-[#667085]">Código {item.CodigoProducto ?? item.Codigo ?? '—'} · Cantidad {item.Cantidad ?? 'No informada'} {item.UnidadMedida || item.unidad_medida || ''}</p>
                  {(item.Descripcion || item.descripcion) && <p className="mt-2 text-sm leading-6 text-[#475467]">{item.Descripcion || item.descripcion}</p>}
                  <div className="mt-3 rounded-lg border border-[#E1E4EA] bg-[#FAF9FF] p-3">
                    <label className="grid gap-1 text-sm font-medium text-[#344054]">Relacionar con producto o servicio del catálogo
                      <select className="w-full rounded-lg border border-[#D0D5DD] bg-white px-3 py-2.5" value={entry.catalogProductId} onChange={e => patchItem(id, { catalogProductId: e.target.value })} disabled={catalogLoading}>
                        <option value="">Sin relación confirmada</option>{catalog.filter(product => product.activo).map(product => <option key={product.id} value={String(product.id)}>{product.nombre}{product.categoria ? ` · ${product.categoria}` : ''}</option>)}
                      </select>
                    </label>
                    {catalogLoading && <p className="mt-2 text-xs text-[#667085]" role="status">Buscando sugerencias en el catálogo de la empresa activa…</p>}
                    {catalogError && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-red-700" role="alert"><span>{catalogError}</span><button type="button" onClick={() => void loadCatalog()} className="font-semibold underline">Reintentar</button></div>}
                    {!catalogLoading && !catalogError && catalog.length === 0 && <p className="mt-2 text-xs text-[#667085]">El catálogo de la empresa activa no tiene productos o servicios disponibles. No se propone una relación.</p>}
                    {!catalogLoading && !catalogError && catalog.length > 0 && !suggestions.length && !selectedCatalogItem && <p className="mt-2 text-xs text-[#667085]">Sin coincidencia fiable: no hay al menos dos términos significativos compartidos. Puedes elegir manualmente si conoces una relación.</p>}
                    {suggestions.length > 0 && <div className="mt-2 space-y-2 text-xs text-[#475467]">
                      <p className="font-semibold">Sugerencia basada en texto (requiere confirmación):</p>
                      {suggestions.slice(0, 2).map(match => <p key={match.item.id}><strong>{match.item.nombre}</strong> · Evidencia de la partida: {match.partEvidence.slice(0, 3).map(value => `“${value.text}” (${value.source})`).join('; ')}. Evidencia del catálogo: {match.evidence.slice(0, 3).map(value => `“${value.text}” (${value.source})`).join('; ')}.</p>)}
                    </div>}
                    {selectedCatalogItem && <p className="mt-2 text-xs text-emerald-800">Relación seleccionada por el usuario: {selectedCatalogItem.nombre}. Verifica que sus especificaciones respondan a la partida.</p>}
                  </div>
                </div>
              </div>
              {entry.enabled && <div className="grid gap-3 md:grid-cols-2">
                {activePriceBook.length > 0 && <div className="md:col-span-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-56 flex-1 space-y-1 text-sm font-medium text-[#344054]">Usar una tarifa de Precios base
                      <select className="w-full rounded-lg border border-[#D0D5DD] bg-white px-3 py-2.5" value={selectedRates[id] ?? ''} onChange={e=>{const value=e.target.value;setSelectedRates(old=>({...old,[id]:value}));const rate=priceBook.find(r=>String(r.id)===value);if(rate)setDimensions(old=>({...old,[id]:{width:String(rate.widthM||''),height:String(rate.heightM||'')}}));}}>
                        <option value="">Selecciona producto o servicio…</option>{activePriceBook.map(rate=><option key={rate.id} value={rate.id}>{rate.name} · {rate.chargeUnit==='m2'?'m²':rate.chargeUnit} · {formatCLP(rate.basePrice)}</option>)}
                      </select>
                    </label>
                    {selectedRates[id] && priceBook.find(r=>String(r.id)===selectedRates[id])?.chargeUnit==='m2' && <><label className="space-y-1 text-sm">Ancho (m)<input className="block w-28 rounded-lg border border-[#D0D5DD] bg-white px-3 py-2.5" type="number" min="0" step="0.001" value={(dimensions[id]??{width:'',height:''}).width} onChange={e=>setDimensions(old=>({...old,[id]:{...(old[id]??{height:''}),width:e.target.value}}))}/></label><label className="space-y-1 text-sm">Alto (m)<input className="block w-28 rounded-lg border border-[#D0D5DD] bg-white px-3 py-2.5" type="number" min="0" step="0.001" value={(dimensions[id]??{width:'',height:''}).height} onChange={e=>setDimensions(old=>({...old,[id]:{...(old[id]??{width:''}),height:e.target.value}}))}/></label></>}
                    <button type="button" disabled={!selectedRates[id]} onClick={()=>applyBasePrice(id)} className="rounded-lg bg-[#5636D9] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Calcular y aplicar</button>
                  </div>{priceBookHint&&<p className="mt-2 text-xs text-[#5636D9]" role="status">{priceBookHint}</p>}
                  <p className="mt-2 text-xs text-[#667085]">Importes sugeridos desde tus costos y precios; pueden editarse. No son el monto oficial ni se envían a Mercado Público.</p>
                </div>}
                <label className="space-y-1 text-sm font-medium text-[#344054]">Costo unitario total para tu empresa (CLP)
                  <input inputMode="numeric" type="number" min="0" step="1" className="w-full rounded-lg border border-[#D0D5DD] px-3 py-2.5 text-base" value={entry.directUnitCost} onChange={(e) => patchItem(id, { directUnitCost: e.target.value })} placeholder="Incluye los costos directos" />
                </label>
                <label className="space-y-1 text-sm font-medium text-[#344054]">Precio unitario ofertado (CLP)
                  <input inputMode="numeric" type="number" min="0" step="1" className="w-full rounded-lg border border-[#D0D5DD] px-3 py-2.5 text-base" value={entry.unitPrice} onChange={(e) => patchItem(id, { unitPrice: e.target.value })} placeholder="Ingresa un valor" />
                </label>
                <label className="space-y-1 text-sm font-medium text-[#344054] md:col-span-2">Especificación de tu empresa
                  <textarea className="min-h-20 w-full rounded-lg border border-[#D0D5DD] px-3 py-2.5 text-base" maxLength={2000} value={entry.specification} onChange={(e) => patchItem(id, { specification: e.target.value })} placeholder="Describe el producto o servicio que ofrecerás" />
                </label>
                <label className="space-y-1 text-sm font-medium text-[#344054] md:col-span-2">Comentario interno
                  <input className="w-full rounded-lg border border-[#D0D5DD] px-3 py-2.5 text-base" maxLength={500} value={entry.comment} onChange={(e) => patchItem(id, { comment: e.target.value })} placeholder="Nota para el equipo (no forma parte de una postulación)" />
                </label>
                <div className="md:col-span-2 rounded-lg border border-[#E1E4EA] bg-[#F8F9FA] p-3" aria-live="polite">
                  {economics.grossMarginPercent == null ? <p className="text-sm text-[#667085]">Ingresa costo y precio unitarios para revisar el margen bruto.</p> : <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
                    <div><span className="block text-[#667085]">Margen bruto unitario</span><strong className="mt-1 block text-[#171A24]">{formatCLP(economics.unitGrossProfit)} · {new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(economics.grossMarginPercent)}%</strong>{economics.grossProfit != null && <small className="mt-1 block text-[#667085]">Margen estimado de esta partida: {formatCLP(economics.grossProfit)} para {economics.quantity} unidades.</small>}{economics.quantity == null && <small className="mt-1 block text-amber-800">Cantidad no informada: solo se muestra margen unitario.</small>}</div>
                    {economics.target !== 'not-set' && <span className={`rounded-full px-2.5 py-1 font-semibold ${economics.target === 'met' ? 'bg-emerald-100 text-emerald-800' : economics.target === 'below' ? 'bg-amber-100 text-amber-900' : 'bg-gray-200 text-gray-700'}`}>{economics.target === 'met' ? 'Sobre el margen objetivo' : economics.target === 'below' ? 'Bajo el margen objetivo' : 'Faltan costo o precio'}</span>}
                  </div>}
                </div>
              </div>}
            </article>;
          })}
        </div> : <div className="rounded-lg bg-[#F8F9FA] p-4 text-sm text-[#667085]">Esta ficha no trae partidas estructuradas. Revisa las bases oficiales antes de preparar precios.</div>}
      </div>

      <div className="rounded-xl border border-[#E1E4EA] bg-white p-5">
        <h3 className="text-lg font-semibold text-[#171A24]">Documentos y revisión</h3>
        <p className="mt-1 text-sm text-[#667085]">Los campos de la ficha son datos oficiales estructurados. El análisis documental extrae texto de PDF y DOCX y propone hallazgos para revisión humana; no confirma cumplimiento ni prepara o envía una oferta.</p>
        <div className="mt-4 rounded-lg border border-[#E1E4EA] bg-[#F8F9FA] p-3">
          <h4 className="font-semibold text-[#344054]">Requisitos informados por la ficha</h4>
          {officialRequirements.length ? <dl className="mt-2 grid gap-2 sm:grid-cols-2">{officialRequirements.map(([label, value]) => <div key={String(label)} className="rounded-md bg-white p-2 text-sm"><dt className="text-xs text-[#667085]">{label}</dt><dd className="mt-1 font-medium text-[#344054]">{String(value)}</dd></div>)}</dl> : <p className="mt-2 text-sm text-[#667085]">La ficha no entregó requisitos administrativos estructurados. Debes revisar las bases oficiales.</p>}
          <p className="mt-2 text-xs text-[#667085]">Dato de la ficha; no equivale a una conclusión de cumplimiento.</p>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input id={`offer-document-name-${code}`} className="min-w-0 flex-1 rounded-lg border border-[#D0D5DD] px-3 py-2.5 text-base" placeholder="Nombre del documento" />
          <input id={`offer-document-url-${code}`} type="url" className="min-w-0 flex-1 rounded-lg border border-[#D0D5DD] px-3 py-2.5 text-base" placeholder="https://… (opcional)" />
          <button type="button" className="rounded-lg border border-[#D0D5DD] px-4 py-2.5 text-sm font-semibold" onClick={() => {
            const name = (document.getElementById(`offer-document-name-${code}`) as HTMLInputElement)?.value.trim();
            const url = (document.getElementById(`offer-document-url-${code}`) as HTMLInputElement)?.value.trim();
            if (!name) return;
            patchDraft({ documents: [...draft.documents, { name, url, requirement: '', reviewStatus: 'pending', reviewNotes: '' }] });
            (document.getElementById(`offer-document-name-${code}`) as HTMLInputElement).value = '';
            (document.getElementById(`offer-document-url-${code}`) as HTMLInputElement).value = '';
          }}>Agregar referencia</button>
        </div>
        <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50/60 p-3">
          <label className="flex items-start gap-2 text-sm text-[#344054]"><input type="checkbox" className="mt-1 h-4 w-4 accent-[#5636D9]" checked={documentAnalysisConsent} onChange={event => setDocumentAnalysisConsent(event.target.checked)} /><span><strong>Autorizar análisis con IA</strong><span className="mt-1 block text-[#667085]">El texto extraído se enviará al proveedor Groq configurado por Oportuna. Solo se guarda el resultado con sus citas, no el archivo ni el texto completo.</span></span></label>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 text-sm font-medium text-[#344054]">Analizar archivo local
              <input type="file" accept=".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={!canEdit || documentAnalysisIndex !== null} onChange={event => { setSelectedDocumentFile(event.target.files?.[0] ?? null); setDocumentAnalysisError(''); }} className="mt-1 block w-full rounded-md border border-[#D0D5DD] bg-white px-2 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-[#F2F0FF] file:px-2 file:py-1 file:text-[#5636D9]" />
            </label>
            <button type="button" disabled={!canEdit || !selectedDocumentFile || documentAnalysisIndex !== null || draft.documents.length >= 100} onClick={() => selectedDocumentFile && void runDocumentAnalysis(draft.documents.length, selectedDocumentFile)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#5636D9] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><UploadCloud size={16}/>{documentAnalysisIndex !== null ? 'Analizando…' : 'Analizar archivo'}</button>
          </div>
          {selectedDocumentFile && <p className="mt-2 text-xs text-[#667085]">{selectedDocumentFile.name} · {(selectedDocumentFile.size / 1024 / 1024).toFixed(1)} MB · máximo 10 MB. El archivo solo se procesa en memoria y no queda guardado.</p>}
          {documentAnalysisError && <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">{documentAnalysisError}</p>}
        </div>
        {draft.documents.length > 0 ? <div className="mt-3 space-y-3">{draft.documents.map((doc, index) => <article key={`${doc.name}-${index}`} className="rounded-lg border border-[#E1E4EA] p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm"><FileText size={16} className="shrink-0 text-[#667085]" />{doc.url ? <a href={doc.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium text-[#5636D9] underline">{doc.name}</a> : <span className="min-w-0 flex-1 truncate font-medium">{doc.name}</span>}<span className="text-xs text-[#667085]">{doc.sourceKind === 'uploaded' ? 'Archivo local · no almacenado' : doc.url ? 'Referencia de la ficha' : 'Referencia manual'}</span><button type="button" disabled={!canEdit || saving} aria-label={`Quitar ${doc.name}`} onClick={() => patchDraft({ documents: draft.documents.filter((_, i) => i !== index) })} className="text-[#667085] disabled:opacity-50"><Trash2 size={16} /></button></div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="grid gap-1 text-xs font-medium text-[#475467]">Requisito que debe cubrir<input maxLength={500} value={doc.requirement} onChange={e => patchDraft({ documents: draft.documents.map((item, i) => i === index ? { ...item, requirement: e.target.value } : item) })} className="rounded-md border border-[#D0D5DD] px-2.5 py-2 text-sm" placeholder="Indica el requisito relacionado" /></label><label className="grid gap-1 text-xs font-medium text-[#475467]">Estado de revisión<select value={doc.reviewStatus} onChange={e => patchDraft({ documents: draft.documents.map((item, i) => i === index ? { ...item, reviewStatus: e.target.value as OfferDocument['reviewStatus'] } : item) })} className="rounded-md border border-[#D0D5DD] bg-white px-2.5 py-2 text-sm"><option value="pending">Pendiente de revisar</option><option value="reviewed">Revisado, falta confirmar cobertura</option><option value="covered">Cobertura confirmada por el usuario</option></select></label></div>
          <label className="mt-2 grid gap-1 text-xs font-medium text-[#475467]">Notas de revisión (manuales)<textarea maxLength={1000} value={doc.reviewNotes} onChange={e => patchDraft({ documents: draft.documents.map((item, i) => i === index ? { ...item, reviewNotes: e.target.value } : item) })} className="min-h-16 rounded-md border border-[#D0D5DD] px-2.5 py-2 text-sm" placeholder="Anota qué falta verificar" /></label>
          {doc.url && <button type="button" disabled={!canEdit || saving || documentAnalysisIndex !== null} onClick={() => void runDocumentAnalysis(index)} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-[#5636D9] disabled:opacity-50"><Sparkles size={15}/>{doc.analysisStatus === 'completed' ? 'Volver a analizar' : 'Analizar documento con IA'}</button>}
          {doc.analysisStatus === 'running' && <p className="mt-3 text-sm text-[#5636D9]" role="status">Extrayendo texto y consultando Groq…</p>}
          {doc.analysisStatus === 'failed' && <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900" role="alert">No se completó el análisis: {doc.analysisError || 'Error sin detalle.'}{doc.url ? ' El enlace a la fuente permanece disponible.' : ' Para volver a intentar, selecciona otra vez el archivo local.'}</p>}
          {doc.analysisStatus === 'completed' && <div className="mt-4 border-t border-[#E1E4EA] pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="inline-flex items-center gap-2 font-semibold text-[#344054]"><Sparkles size={16} className="text-[#5636D9]"/>Hallazgos sugeridos por IA</h4><span className="text-xs text-[#667085]">Proveedor: Groq · {doc.analysisAt ? new Date(doc.analysisAt).toLocaleString('es-CL') : 'fecha no disponible'}</span></div>
            {doc.analysisPartial && <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">Análisis parcial: revisa el documento completo en la fuente original.</p>}
            {(doc.analysisWarnings ?? []).map((warning, warningIndex) => <p key={warningIndex} className="mt-2 text-xs text-[#667085]">{warning}</p>)}
            {!!doc.analysisOmittedUnverifiable && <p className="mt-2 text-sm text-amber-900">Se omitieron {doc.analysisOmittedUnverifiable} sugerencias sin cita literal comprobable.</p>}
            {!doc.analysisFindings?.length ? <p className="mt-3 rounded-md bg-[#F8F9FA] p-3 text-sm text-[#667085]">La IA no identificó hallazgos con evidencia literal verificable. Esto no demuestra que el documento no tenga requisitos; revísalo completo.</p> : <div className="mt-3 space-y-3">{doc.analysisFindings.map(finding => <article key={finding.id} className="rounded-lg border border-[#E1E4EA] bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><span className="text-xs font-semibold uppercase tracking-wide text-[#667085]">{({requirement:'Requisito',deadline:'Plazo',document:'Documento solicitado',evaluation_criterion:'Criterio de evaluación',technical_condition:'Condición técnica',risk:'Señal de riesgo'} as Record<string,string>)[finding.kind]}</span><h5 className="mt-1 font-semibold text-[#171A24]">{finding.title}</h5></div>{finding.dueDate && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">Fecha detectada: {finding.dueDate}</span>}</div>
              <div className="mt-3 rounded-md bg-[#F8F9FA] p-3"><p className="text-xs font-semibold text-[#475467]">Texto extraído · {finding.sourceLocation}</p><blockquote className="mt-1 border-l-2 border-[#A89BEF] pl-3 text-sm leading-6 text-[#344054]">{finding.extractedText}</blockquote></div>
              <div className="mt-2 rounded-md border border-violet-100 bg-violet-50/50 p-3"><p className="text-xs font-semibold text-[#5636D9]">Interpretación de IA · requiere revisión</p><p className="mt-1 text-sm leading-6 text-[#344054]">{finding.interpretation}</p></div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="grid gap-1 text-xs font-medium text-[#475467]">Vincular a una partida<select value={finding.relatedItemCode} onChange={event => patchDocumentFinding(index, finding.id, { relatedItemCode: event.target.value })} className="rounded-md border border-[#D0D5DD] bg-white px-2 py-2 text-sm"><option value="">Sin vincular</option>{products.map((item: any, itemIndex: number) => <option key={itemCode(item,itemIndex)} value={itemCode(item,itemIndex)}>{item.Cantidad ? `${item.Cantidad} × ` : ''}{item.NombreProducto ?? item.Nombre ?? item.nombre ?? `Partida ${itemIndex + 1}`}</option>)}</select></label><label className="grid gap-1 text-xs font-medium text-[#475467]">Vincular a otro documento<select value={finding.relatedDocumentName} onChange={event => patchDocumentFinding(index, finding.id, { relatedDocumentName: event.target.value })} className="rounded-md border border-[#D0D5DD] bg-white px-2 py-2 text-sm"><option value="">Sin vincular</option>{draft.documents.filter((_, otherIndex) => otherIndex !== index).map((other, otherIndex) => <option key={`${other.name}-${otherIndex}`} value={other.name}>{other.name}</option>)}</select></label></div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(180px,0.7fr)_minmax(0,1.3fr)]"><label className="grid gap-1 text-xs font-medium text-[#475467]">Estado de revisión humana<select value={finding.reviewStatus} onChange={event => patchDocumentFinding(index, finding.id, { reviewStatus: event.target.value as OfferDocumentFinding['reviewStatus'] })} className="rounded-md border border-[#D0D5DD] bg-white px-2 py-2 text-sm"><option value="pending">Pendiente</option><option value="confirmed">Confirmado por mí</option><option value="corrected">Corregido por mí</option><option value="discarded">Descartado por mí</option></select></label>{finding.reviewStatus === 'corrected' && <label className="grid gap-1 text-xs font-medium text-[#475467]">Corrección de la persona<textarea maxLength={800} value={finding.correction} onChange={event => patchDocumentFinding(index, finding.id, { correction: event.target.value })} className="min-h-16 rounded-md border border-[#D0D5DD] px-2.5 py-2 text-sm" placeholder="Escribe la corrección basada en la fuente" /></label>}</div>
            </article>)}</div>}
          </div>}
        </article>)}</div> : <p className="mt-3 rounded-lg bg-[#F8F9FA] p-3 text-sm text-[#667085]">La ficha no incluye documentos estructurados. Consulta directamente las bases y agrega referencias cuando las tengas.</p>}
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg bg-[#F8F9FA] p-3 text-sm text-[#344054]">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#5636D9]" checked={draft.declarationReviewed} onChange={(e) => patchDraft({ declarationReviewed: e.target.checked })} />
          <span><strong className="flex items-center gap-2"><ShieldCheck size={16} />Revisé los requisitos y declaraciones en la fuente oficial</strong><span className="mt-1 block text-[#667085]">Esta marca es una lista de control interna; no certifica cumplimiento ni completa declaraciones.</span></span>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E1E4EA] bg-white p-4">
        <div className="text-sm text-[#667085]" aria-live="polite">{savedAt ? `Borrador guardado en tu cuenta · ${new Date(savedAt).toLocaleString('es-CL')}` : 'Este borrador aún no se ha guardado.'}</div>
        <div className="flex gap-2">
          {savedAt && <button type="button" onClick={() => void reset()} className="rounded-lg px-3 py-2 text-sm text-[#667085] hover:bg-gray-50">Eliminar borrador</button>}
          <button type="button" disabled={saving || Boolean(loadError)} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-[#5636D9] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#4829C8] disabled:opacity-60"><Save size={16} />{saving ? 'Guardando…' : 'Guardar borrador'}</button>
        </div>
      </div>

      {error && !loadError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

      <p className="flex items-start gap-2 text-sm text-[#667085]"><Circle size={15} className="mt-0.5 shrink-0" />El progreso solo refleja los campos de esta preparación. El margen es bruto y usa los costos que ingresaste; revisa bases, impuestos, garantías, cantidades y vigencia antes de presentar la oferta en el portal oficial.</p>
    </section>
  );
}
