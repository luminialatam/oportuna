import { useEffect, useMemo, useState } from 'react';
import { Circle, FileText, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { calculateOfferEconomics, formatCLP } from './offerEconomics.js';

type OfferItem = {
  enabled: boolean;
  unitPrice: string;
  directUnitCost: string;
  specification: string;
  comment: string;
};
type OfferDraft = {
  quoteName: string;
  details: string;
  responsible: string;
  deadline: string;
  minimumMarginPercent: string;
  declarationReviewed: boolean;
  items: Record<string, OfferItem>;
  documents: { name: string; url: string }[];
};

const emptyDraft: OfferDraft = {
  quoteName: '', details: '', responsible: '', deadline: '', minimumMarginPercent: '', declarationReviewed: false, items: {}, documents: [],
};

function itemCode(item: any, index: number) {
  return String(item.CodigoProducto ?? item.Codigo ?? item.codigo ?? index + 1);
}

export function OfferPreparationPanel({
  listing, companyId, userId, csrfToken,
}: {
  listing: any;
  companyId: number | string;
  userId: number | string;
  csrfToken: string;
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
  const [draft, setDraft] = useState<OfferDraft>(emptyDraft);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoaded(false);
    setError('');
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
          enabled: true, unitPrice: '', directUnitCost: '', specification: '', comment: '', ...(item as object),
        }]));
        setDraft(savedDraft ? { ...emptyDraft, ...savedDraft, items } : emptyDraft);
        setSavedAt(data.updatedAt ?? null);
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setDraft(emptyDraft);
        setSavedAt(null);
        setError(cause instanceof Error ? cause.message : 'No se pudo cargar el borrador.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoaded(true); });
    return () => controller.abort();
  }, [companyId, userId, code]);

  const patchDraft = (patch: Partial<OfferDraft>) => {
    setSavedAt(null);
    setDraft((current) => ({ ...current, ...patch }));
  };
  const patchItem = (id: string, patch: Partial<OfferItem>) => {
    setSavedAt(null);
    setDraft((current) => {
      const nextItem: OfferItem = Object.assign(
        { enabled: true, unitPrice: '', directUnitCost: '', specification: '', comment: '' },
        current.items[id],
        patch,
      );
      return { ...current, items: { ...current.items, [id]: nextItem } };
    });
  };
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/company/offer-drafts/${encodeURIComponent(code)}`, {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify(draft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar el borrador.');
      setSavedAt(data.updatedAt ?? new Date().toISOString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el borrador.');
    } finally {
      setSaving(false);
    }
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

  const activeItems = products.filter((item: any, index: number) => draft.items[itemCode(item, index)]?.enabled !== false);
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

  if (!loaded) return <div className="p-6 text-sm text-[#667085]">Cargando borrador…</div>;

  return (
    <section className="space-y-5" aria-label="Preparación interna de oferta">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <strong className="block">Preparación interna; no envía una postulación</strong>
        Esta herramienta organiza la cotización de tu empresa. La presentación oficial y la carga de documentos se realizan en Mercado Público.
      </div>
      {closedStatusMessage && <div role="status" className="rounded-xl border border-amber-300 bg-[#fffaf0] p-4 text-sm text-amber-900"><strong className="mr-1">Estado de la ficha:</strong>{closedStatusMessage}</div>}

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
            const entry = draft.items[id] ?? { enabled: true, unitPrice: '', directUnitCost: '', specification: '', comment: '' };
            const economics = calculateOfferEconomics({ unitPrice: entry.unitPrice, unitCost: entry.directUnitCost, quantity: item.Cantidad ?? item.cantidad, minimumMarginPercent: draft.minimumMarginPercent });
            return <article key={`${id}-${index}`} className="rounded-xl border border-[#E1E4EA] p-4">
              <div className="mb-4 flex items-start gap-3">
                <input aria-label={`Incluir partida ${index + 1}`} type="checkbox" className="mt-1 h-4 w-4 accent-[#5636D9]" checked={entry.enabled} onChange={(e) => patchItem(id, { enabled: e.target.checked })} />
                <div className="min-w-0 flex-1">
                  <h4 className="font-semibold text-[#171A24]">{item.NombreProducto || item.Nombre || item.nombre || `Partida ${index + 1}`}</h4>
                  <p className="mt-1 text-sm text-[#667085]">Código {item.CodigoProducto ?? item.Codigo ?? '—'} · Cantidad {item.Cantidad ?? 'No informada'} {item.UnidadMedida || item.unidad_medida || ''}</p>
                  {(item.Descripcion || item.descripcion) && <p className="mt-2 text-sm leading-6 text-[#475467]">{item.Descripcion || item.descripcion}</p>}
                </div>
              </div>
              {entry.enabled && <div className="grid gap-3 md:grid-cols-2">
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
        <p className="mt-1 text-sm text-[#667085]">Registra referencias para encontrarlos. Oportuna no almacena ni sube los archivos desde este panel.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input id={`offer-document-name-${code}`} className="min-w-0 flex-1 rounded-lg border border-[#D0D5DD] px-3 py-2.5 text-base" placeholder="Nombre del documento" />
          <input id={`offer-document-url-${code}`} type="url" className="min-w-0 flex-1 rounded-lg border border-[#D0D5DD] px-3 py-2.5 text-base" placeholder="https://… (opcional)" />
          <button type="button" className="rounded-lg border border-[#D0D5DD] px-4 py-2.5 text-sm font-semibold" onClick={() => {
            const name = (document.getElementById(`offer-document-name-${code}`) as HTMLInputElement)?.value.trim();
            const url = (document.getElementById(`offer-document-url-${code}`) as HTMLInputElement)?.value.trim();
            if (!name) return;
            patchDraft({ documents: [...draft.documents, { name, url }] });
            (document.getElementById(`offer-document-name-${code}`) as HTMLInputElement).value = '';
            (document.getElementById(`offer-document-url-${code}`) as HTMLInputElement).value = '';
          }}>Agregar referencia</button>
        </div>
        {draft.documents.length > 0 && <ul className="mt-3 divide-y divide-[#EAECF0]">{draft.documents.map((doc, index) => <li key={`${doc.name}-${index}`} className="flex items-center gap-2 py-2 text-sm">
          <FileText size={16} className="shrink-0 text-[#667085]" />
          {doc.url ? <a href={doc.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[#5636D9] underline">{doc.name}</a> : <span className="min-w-0 flex-1 truncate">{doc.name}</span>}
          <button type="button" aria-label={`Quitar ${doc.name}`} onClick={() => patchDraft({ documents: draft.documents.filter((_, i) => i !== index) })} className="text-[#667085]"><Trash2 size={16} /></button>
        </li>)}</ul>}
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg bg-[#F8F9FA] p-3 text-sm text-[#344054]">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#5636D9]" checked={draft.declarationReviewed} onChange={(e) => patchDraft({ declarationReviewed: e.target.checked })} />
          <span><strong className="flex items-center gap-2"><ShieldCheck size={16} />Revisé los requisitos y declaraciones en la fuente oficial</strong><span className="mt-1 block text-[#667085]">Esta marca es una lista de control interna; no certifica cumplimiento ni completa declaraciones.</span></span>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E1E4EA] bg-white p-4">
        <div className="text-sm text-[#667085]" aria-live="polite">{savedAt ? `Borrador guardado en tu cuenta · ${new Date(savedAt).toLocaleString('es-CL')}` : 'Este borrador aún no se ha guardado.'}</div>
        <div className="flex gap-2">
          {savedAt && <button type="button" onClick={() => void reset()} className="rounded-lg px-3 py-2 text-sm text-[#667085] hover:bg-gray-50">Eliminar borrador</button>}
          <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-[#5636D9] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#4829C8] disabled:opacity-60"><Save size={16} />{saving ? 'Guardando…' : 'Guardar borrador'}</button>
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

      <p className="flex items-start gap-2 text-sm text-[#667085]"><Circle size={15} className="mt-0.5 shrink-0" />El progreso solo refleja los campos de esta preparación. El margen es bruto y usa los costos que ingresaste; revisa bases, impuestos, garantías, cantidades y vigencia antes de presentar la oferta en el portal oficial.</p>
    </section>
  );
}
