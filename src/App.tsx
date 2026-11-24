import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  Clock3,
  Database,
  ExternalLink,
  FileSearch,
  Filter,
  FlaskConical,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  MailPlus,
  Menu,
  Search,
  Settings,
  Sparkles,
  Star,
  Shield,
  UserRound,
  Users,
  X,
} from 'lucide-react';

import { CompanyOpportunities, CompanyWorkspace } from './CompanyWorkspace';
import { TrackingWorkspace } from './TrackingWorkspace';
import { AlertNotificationPanel, AlertsPage, type AlertItem } from './AlertCenter';
import { AuthGate, EmailVerificationGate, LegacyClaim, type AuthResult } from './AuthGate';
import { CompanyTeamManagement, NoCompanyOnboarding } from './Onboarding';
import { MarketAnalytics } from './MarketAnalytics';
import { SandboxCenter } from './SandboxCenter';
import { ProfilePage, SecurityPage } from './AccountSettings';
import { PlatformUsers } from './PlatformUsers';
import { OfferPreparationPanel } from './OfferPreparationPanel';
import { CommercialAgents } from './CommercialAgents';
import { AnalyticsWorkspace } from './AnalyticsWorkspace';
import { useLocation, useNavigate } from 'react-router';

type Listing = {
  codigo_externo: string;
  nombre: string | null;
  codigo_estado: number | null;
  fecha_cierre: string | null;
  fecha_publicacion?: string | null;
  organismo: string | null;
  monto_estimado: string | number | null;
  moneda: string | null;
};

type Health = { ok: boolean; apiConfigured: boolean; mysql: boolean };
type Summary = {
  total: number;
  estados: { codigoEstado: number | null; total: number }[];
  ultimaSincronizacion: any;
  ultimasLicitaciones: Listing[];
};

const statusNames: Record<number, string> = {
  5: 'Publicada',
  6: 'Cerrada',
  7: 'Desierta',
  8: 'Adjudicada',
  15: 'Revocada',
  18: 'Revocada',
  19: 'Suspendida',
};

const ALERT_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_SEEN_KEY = 'oportuna.sessionSeen';
const SECTION_PATHS: Record<string, string> = {
  Resumen: '/',
  'Buscar oportunidades': '/buscar',
  Oportunidades: '/oportunidades',
  'Agentes IA': '/agentes',
  'Inteligencia de mercado': '/inteligencia-mercado',
  'Analítica': '/inteligencia-mercado/analitica',
  Seguimiento: '/seguimiento',
  Calendario: '/calendario',
  Alertas: '/alertas',
  'Mi empresa': '/empresa',
  'Equipo y accesos': '/equipo',
  'Cuentas de usuario': '/usuarios',
  Configuración: '/configuracion',
  'Mi perfil': '/perfil',
  Seguridad: '/seguridad',
  'Centro de Pruebas': '/centro-de-pruebas',
};
const PATH_SECTIONS = Object.fromEntries(
  Object.entries(SECTION_PATHS).map(([name, path]) => [path, name])
) as Record<string, string>;
let csrfToken = '';

function hasStoredSessionMarker() {
  try { return window.localStorage.getItem(SESSION_SEEN_KEY) === 'true'; } catch { return false; }
}
function setStoredSessionMarker(active: boolean) {
  try {
    if (active) window.localStorage.setItem(SESSION_SEEN_KEY, 'true');
    else window.localStorage.removeItem(SESSION_SEEN_KEY);
  } catch { /* Browser storage can be disabled; the server cookie remains authoritative. */ }
}
type AuthState = AuthResult;

const money = (value: Listing['monto_estimado'], currency: string | null) =>
  value == null || value === ''
    ? '—'
    : new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: currency || 'CLP',
        maximumFractionDigits: 0,
      }).format(Number(value));

const dateFmt = (value?: string | null) => {
  if (!value) return '—';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return Number.isNaN(parsed.getTime())
    ? '—'
    : new Intl.DateTimeFormat('es-CL', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(parsed);
};

const dateTimeFmt = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat('es-CL', {
        timeZone: 'America/Santiago',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : '—';

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  const method = (options?.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No fue posible completar la solicitud.');
  return data as T;
}

function hasListingValue(value: any) {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object' && !Array.isArray(value)) return Object.keys(value).length > 0;
  return true;
}

function mergeListingDetails(official: any, local: any) {
  const merged = { ...local, ...official };
  for (const [key, value] of Object.entries(local ?? {})) {
    if (!hasListingValue(official?.[key])) (merged as any)[key] = value;
  }
  const mergeSection = (officialSection: any, localSection: any) => {
    const section = { ...(localSection ?? {}), ...(officialSection ?? {}) };
    for (const [key, value] of Object.entries(localSection ?? {})) {
      if (!hasListingValue(officialSection?.[key])) section[key] = value;
    }
    return section;
  };
  merged.Comprador = mergeSection(official?.Comprador, local?.Comprador);
  merged.Fechas = mergeSection(official?.Fechas, local?.Fechas);
  const buyerName = [
    merged.Comprador?.NombreOrganismo,
    merged.NombreOrganismo,
    merged.OrganismoComprador,
    merged.Organismo,
    local?.organismo,
  ].find((value) => typeof value === 'string' && value.trim());
  if (buyerName && !hasListingValue(merged.Comprador?.NombreOrganismo)) {
    merged.Comprador = { ...merged.Comprador, NombreOrganismo: buyerName };
  }
  const officialItems = official?.Items?.Listado;
  const localItems = local?.Items?.Listado;
  if (!hasListingValue(officialItems) && hasListingValue(localItems)) merged.Items = local.Items;
  if ([0, '0', false].includes(merged.VisibilidadMonto)) merged.MontoEstimado = null;
  return merged;
}

function StatusBadge({ state }: { state: number | null }) {
  const name = state == null ? 'Sin estado' : statusNames[state] ?? `Estado ${state}`;
  const style =
    state === 5
      ? 'bg-[#f0edff] text-[#5636D9]'
      : state === 8
      ? 'bg-gray-100 text-[#5D6472]'
      : state === 7
      ? 'bg-[#FFF8E1] text-[#A85B08]'
      : state === 18 || state === 19 || state === 15
      ? 'bg-[#FFEBEE] text-[#B42332]'
      : 'bg-gray-100 text-[#5D6472]';

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${style}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
      {name}
    </span>
  );
}

function ListingDetailModal({
  listing,
  companyId,
  userId,
  csrfToken,
  loading = false,
  saved,
  saving,
  onAnalyze,
  onSave,
  analysis,
  analysisLoading,
  onGoToCompany,
  onClose,
}: {
  listing: any;
  companyId: number;
  userId: number;
  csrfToken: string;
  loading?: boolean;
  saved: boolean | null;
  saving: boolean;
  onAnalyze: () => void;
  onSave: () => void;
  analysis: any;
  analysisLoading: boolean;
  onGoToCompany: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'resumen' | 'items' | 'requisitos' | 'cronograma' | 'analisis' | 'oferta'>('resumen');
  useEffect(() => {
    if (analysis && !analysis.error) setTab('analisis');
  }, [analysis]);
  const buyer = listing.Comprador ?? {};
  const dates = listing.Fechas ?? {};
  const listedItems = Array.isArray(listing.Items?.Listado) ? listing.Items.Listado : [];
  const knownRequirements = [
    ['Prohibición de contratación', listing.ProhibicionContratacion],
    ['Subcontratación', listing.SubContratacion],
    ['Toma de razón', listing.TomaRazon],
    ['Renovable', listing.EsRenovable],
    ['Duración del contrato', listing.TipoDuracionContrato],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');

  const documentKeys = ['Documentos', 'Archivos', 'Anexos', 'Adjuntos'];
  const documents = documentKeys.flatMap((key) =>
    Array.isArray(listing[key]) ? listing[key].map((item: any) => ({ item, source: key })) : []
  );
  const relevanceLevel = String(analysis?.commercialRelevance?.level ?? '');
  const relevanceLabels: Record<string, string> = {
    high: 'Alta', medium: 'Media', exploratory: 'Exploratoria', none: 'Sin coincidencia',
    excluded: 'Excluida', unavailable: 'No disponible',
  };
  const procurementCode = [listing.CodigoTipo, listing.Tipo, listing.CodigoExterno, listing.codigo_externo]
    .map((value) => String(value ?? '').match(/(?:^|-)(L1|LE|LP|LQ|LR|E2|CO|B2|H2|I2)\d{0,2}$/i)?.[1]?.toUpperCase())
    .find(Boolean) ?? null;
  const procurementRanges: Record<string, string> = {
    L1: 'Menos de 100 UTM',
    LE: 'Desde 100 y menos de 1.000 UTM',
    LP: 'Desde 1.000 y menos de 5.000 UTM',
    LQ: 'Desde 5.000 y menos de 10.000 UTM',
    LR: '10.000 UTM o más',
  };
  const procurementRange = procurementCode ? procurementRanges[procurementCode] : null;
  const amountDisplay = listing.MontoEstimado != null
    ? money(listing.MontoEstimado, listing.Moneda || null)
    : [0, '0', false].includes(listing.VisibilidadMonto)
      ? 'No publicado en la ficha oficial'
      : procurementRange
        ? 'Monto exacto no informado'
        : 'Monto no informado';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-[#E1E4EA] flex items-start justify-between gap-4 bg-white">
          <div className="space-y-1 min-w-0">
            <div className="text-[11px] font-bold text-[#5636D9] uppercase tracking-wider">
              Buscar oportunidades / Ficha
            </div>
            <h2 className="font-bold text-lg text-[#171A24] leading-snug">
              {listing.Nombre || listing.nombre || listing.CodigoExterno || 'Licitación'}
            </h2>
            <div className="flex items-center gap-2 flex-wrap text-xs text-[#5D6472]">
              <span className="font-mono font-semibold text-[#171A24]">{listing.CodigoExterno}</span>
              <span>•</span>
              <span className="truncate max-w-xs">{buyer.NombreOrganismo || listing.organismo || listing.NombreOrganismo || listing.OrganismoComprador || 'Organismo no informado'}</span>
              <span>•</span>
              <StatusBadge state={listing.CodigoEstado != null ? Number(listing.CodigoEstado) : null} />
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-[#5D6472] hover:bg-gray-100 flex items-center justify-center shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="flex items-center gap-1 px-5 border-b border-[#E1E4EA] bg-[#F8F9FA] overflow-x-auto">
          {[
            { id: 'resumen', label: 'Resumen' },
            { id: 'items', label: `Partidas (${listedItems.length})` },
            { id: 'requisitos', label: 'Requisitos & Docs' },
            { id: 'cronograma', label: 'Cronograma' },
            { id: 'analisis', label: 'Compatibilidad IA' },
            { id: 'oferta', label: 'Preparar oferta' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as any)}
              className={`py-3 px-3 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
                tab === t.id
                  ? 'border-[#5636D9] text-[#5636D9]'
                  : 'border-transparent text-[#5D6472] hover:text-[#171A24]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="py-20 text-center text-sm text-[#5D6472]">
              <LoaderCircle size={24} className="spin mx-auto text-[#5636D9] mb-2" />
              Cargando información oficial…
            </div>
          ) : (
            <>
              {listing._source !== 'mercadopublico' && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                  No se pudo cargar el detalle oficial desde Mercado Público. Se muestran los datos resumidos guardados en Oportuna.
                  {listing._detailError ? <span className="block mt-1 text-amber-800">{listing._detailError}</span> : null}
                </div>
              )}
              {tab === 'resumen' && (
            <div className="space-y-5 text-xs">
              <div className="p-4 rounded-xl bg-[#F8F9FA] border border-[#E1E4EA] space-y-2">
                <span className="font-bold text-[#5D6472] uppercase text-[10px] tracking-wider">
                  Descripción Oficial
                </span>
                <p className="text-[#171A24] leading-relaxed text-xs">
                  {listing.Descripcion || 'Mercado Público no informó una descripción para esta licitación.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3.5 rounded-xl border border-[#E1E4EA] space-y-1">
                  <span className="text-[#8A92A6]">Monto Estimado</span>
                  <div className="font-bold text-sm text-[#171A24]">
                    {amountDisplay}
                  </div>
                  {listing.MontoEstimado == null && procurementRange && (
                    <small className="block text-xs leading-relaxed text-[#5D6472]">
                      Tramo del proceso {procurementCode}: {procurementRange}. No equivale a un monto publicado.
                    </small>
                  )}
                </div>
                <div className="p-3.5 rounded-xl border border-[#E1E4EA] space-y-1">
                  <span className="text-[#8A92A6]">Fecha de Cierre</span>
                  <div className="font-bold text-sm text-[#171A24]">
                    {dateFmt(dates.FechaCierre ?? listing.FechaCierre)}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-[#E1E4EA] space-y-3">
                <h4 className="font-bold text-[#171A24]">Organismo Comprador</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <span className="text-[#8A92A6] block">Organismo</span>
                    <b className="text-[#171A24]">{buyer.NombreOrganismo || listing.organismo || listing.NombreOrganismo || listing.OrganismoComprador || 'No informado'}</b>
                  </div>
                  <div>
                    <span className="text-[#8A92A6] block">Unidad de Compra</span>
                    <b className="text-[#171A24]">{buyer.NombreUnidad || listing.NombreUnidad || 'No informado'}</b>
                  </div>
                  <div>
                    <span className="text-[#8A92A6] block">Región</span>
                    <b className="text-[#171A24]">{buyer.RegionUnidad || 'No informada'}</b>
                  </div>
                  <div>
                    <span className="text-[#8A92A6] block">Comuna</span>
                    <b className="text-[#171A24]">{buyer.ComunaUnidad || 'No informada'}</b>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'items' && (
            <div className="space-y-3 text-xs">
              <span className="font-bold text-[#5D6472] uppercase text-[10px] tracking-wider block">
                Partidas Solicitadas ({listedItems.length})
              </span>
              {listedItems.length ? (
                listedItems.map((item: any, idx: number) => (
                  <div key={idx} className="p-3.5 rounded-xl border border-[#E1E4EA] bg-white space-y-1.5">
                    <div className="flex items-center justify-between">
                      <b className="text-[#171A24] font-bold">{item.NombreProducto || item.Nombre || 'Partida'}</b>
                      <span className="px-2 py-0.5 rounded-md bg-[#F5F6F8] font-semibold text-[#5D6472]">
                        {item.Cantidad} {item.UnidadMedida || 'unidades'}
                      </span>
                    </div>
                    {item.Descripcion && <p className="text-[#5D6472]">{item.Descripcion}</p>}
                    {item.Categoria && <span className="text-[10px] text-[#8A92A6] block">Categoría: {item.Categoria}</span>}
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-[#8A92A6] border border-dashed border-[#E1E4EA] rounded-xl">
                  Mercado Público no informó partidas para esta licitación.
                </div>
              )}
            </div>
          )}

          {tab === 'requisitos' && (
            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-xl border border-[#E1E4EA] space-y-2">
                <h4 className="font-bold text-[#171A24]">Requisitos Administrativos Estructurados</h4>
                {knownRequirements.length ? (
                  <div className="space-y-1.5 divide-y divide-[#E1E4EA]">
                    {knownRequirements.map(([label, val]) => (
                      <div key={label} className="pt-1.5 flex justify-between">
                        <span className="text-[#5D6472]">{label}</span>
                        <b className="text-[#171A24]">{String(val)}</b>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[#8A92A6]">No se detectaron requisitos administrativos estructurados.</p>
                )}
              </div>

              <div className="p-4 rounded-xl border border-[#E1E4EA] space-y-2">
                <h4 className="font-bold text-[#171A24]">Documentos y Bases Adjuntas</h4>
                {documents.length ? (
                  <div className="space-y-1.5">
                    {documents.map(({ item, source }: any, idx: number) => {
                      const name = item.Nombre ?? item.NombreArchivo ?? item.Descripcion ?? `${source} ${idx + 1}`;
                      const url = item.Url ?? item.URL ?? item.Link ?? item.UrlDocumento;
                      return (
                        <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-[#F8F9FA]">
                          <span className="truncate max-w-sm font-medium">{String(name)}</span>
                          {url && (
                            <a href={String(url)} target="_blank" rel="noreferrer" className="text-[#5636D9] font-semibold hover:underline flex items-center gap-1">
                              Abrir <ExternalLink size={12} />
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[#8A92A6]">Las bases y anexos deben consultarse directamente en Mercado Público.</p>
                )}
              </div>
            </div>
          )}

          {tab === 'cronograma' && (
            <div className="space-y-4 text-xs">
              <h4 className="font-bold text-[#171A24]">Hitos Críticos del Proceso</h4>
              <div className="space-y-3 relative pl-4 border-l-2 border-[#5636D9]/30">
                {[
                  { label: 'Fecha de Publicación', val: dates.FechaPublicacion },
                  { label: 'Fecha de Inicio', val: dates.FechaInicio },
                  { label: 'Fecha de Cierre (Límite de Ofertas)', val: dates.FechaCierre ?? listing.FechaCierre, urgent: true },
                  { label: 'Fecha Estimada de Adjudicación', val: dates.FechaEstimadaAdjudicacion },
                ].map((item, idx) => (
                  <div key={idx} className="relative space-y-0.5">
                    <span className={`w-2.5 h-2.5 rounded-full absolute -left-[21px] top-1 ${item.urgent ? 'bg-[#5636D9]' : 'bg-gray-300'}`} />
                    <span className="font-semibold text-[#171A24]">{item.label}</span>
                    <p className="text-[#5D6472]">{item.val ? dateTimeFmt(item.val) : 'No informada'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'analisis' && (
            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-[#171A24] flex items-center gap-2">
                    <Sparkles size={16} className="text-[#5636D9]" /> Asistente comercial Oportuna
                  </h4>
                  <p className="text-[#5D6472]">Cruza el catálogo con la ficha disponible y propone el siguiente paso comercial.</p>
                </div>
                <button
                  onClick={onAnalyze}
                  disabled={analysisLoading}
                  className="h-8 px-3 bg-[#5636D9] hover:bg-[#4b2ec7] text-white font-semibold rounded-lg flex items-center gap-1.5"
                >
                  {analysisLoading ? <LoaderCircle size={13} className="spin" /> : <Sparkles size={13} />}
                  {analysisLoading ? 'Evaluando…' : 'Evaluar oportunidad'}
                </button>
              </div>

              {analysisLoading ? (
                <div className="p-8 text-center text-[#5D6472] bg-[#F8F9FA] rounded-xl border border-[#E1E4EA]">
                  <LoaderCircle size={20} className="spin mx-auto text-[#5636D9] mb-2" />
                  Revisando coincidencia del catálogo, plazo y datos disponibles…
                </div>
              ) : analysis?.error ? (
                <div role="alert" className="p-4 text-red-800 bg-red-50 rounded-xl border border-red-200">
                  {analysis.error}
                </div>
              ) : analysis ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-[#f0edff]/30 border border-[#5636D9]/20">
                      <span className="text-[#5D6472] block">Puntaje de coincidencia textual</span>
                      <b className="text-xl text-[#5636D9] font-bold">{analysis.commercialRelevance?.score ?? '—'}{analysis.commercialRelevance?.score != null ? ' / 100' : ''}</b>
                      <small className="text-[#5D6472] block mt-0.5">
                        {relevanceLabels[relevanceLevel] ?? (relevanceLevel || 'No evaluado')} · no es probabilidad de adjudicación
                      </small>
                    </div>
                    <div className="p-3 rounded-xl bg-gray-50 border border-[#E1E4EA]">
                      <span className="text-[#5D6472] block">Cobertura de la ficha</span>
                      <b className="text-xl text-[#171A24] font-bold">
                        {analysis.coverage?.score ?? 0}%
                      </b>
                      <small className="text-[#5D6472] block mt-0.5">
                        {analysis.coverage?.present ?? 0} de {analysis.coverage?.total ?? 0} campos
                      </small>
                    </div>
                  </div>

                  {analysis.decision && (
                    <section className={`rounded-xl border p-4 ${analysis.decision.tone === 'positive' ? 'border-emerald-200 bg-emerald-50/60' : analysis.decision.tone === 'caution' ? 'border-amber-200 bg-amber-50/70' : 'border-[#E1E4EA] bg-[#F8F9FA]'}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h5 className="font-bold text-[#171A24]">Decisión comercial sugerida</h5>
                        <span className="rounded-full bg-white/80 px-2.5 py-1 font-semibold text-[#344054]">{analysis.decision.label}</span>
                      </div>
                      <p className="mt-2 text-[#344054] leading-relaxed">{analysis.decision.summary}</p>

                      {analysis.decision.evidence?.length > 0 && <div className="mt-3">
                        <h6 className="font-bold text-[#171A24]">Evidencia utilizada</h6>
                        <ul className="mt-1 list-disc space-y-1 pl-4 text-[#475467]">
                          {analysis.decision.evidence.map((item: string, idx: number) => <li key={idx}>{item}</li>)}
                        </ul>
                      </div>}

                      {analysis.decision.toConfirm?.length > 0 && <div className="mt-3">
                        <h6 className="font-bold text-[#171A24]">Antes de decidir, confirma</h6>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {analysis.decision.toConfirm.slice(0, 8).map((item: string) => <span key={item} className="rounded-full border border-amber-200 bg-white px-2 py-1 text-amber-900">{item}</span>)}
                        </div>
                      </div>}

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-black/5 pt-3">
                        <div className="min-w-0 flex-1">
                          <strong className="block text-[#171A24]">Siguiente paso recomendado</strong>
                          <span className="mt-0.5 block text-[#5D6472]">{analysis.decision.nextAction.reason}</span>
                        </div>
                        <button type="button" onClick={() => analysis.decision.nextAction.tab === 'catalogo' ? onGoToCompany() : setTab(analysis.decision.nextAction.tab)} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[#5636D9] px-3 py-2 font-semibold text-white hover:bg-[#4b2ec7]">
                          {analysis.decision.nextAction.label}<ArrowRight size={14} />
                        </button>
                      </div>
                    </section>
                  )}

                  {analysis.interpretation?.executiveSummary && (
                    <div className="p-3.5 rounded-xl bg-white border border-[#E1E4EA] space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold text-[#171A24]">Resumen de la ficha</span>
                        <small className="rounded-full bg-[#F2F0FF] px-2 py-1 text-[#5636D9]">{analysis.provider === 'groq' ? 'Redactado con IA' : 'Resumen local automático'}</small>
                      </div>
                      <p className="text-[#5D6472] leading-relaxed">{analysis.interpretation.executiveSummary}</p>
                    </div>
                  )}

                  <div className="rounded-lg border border-[#E1E4EA] bg-white px-3.5 py-3 text-[#5D6472] leading-relaxed">
                    El puntaje proviene de reglas de coincidencia entre el catálogo y el texto de la ficha. El resumen puede usar IA generativa; las bases y anexos no se consideran revisados por Oportuna.
                  </div>

                  {(analysis.interpretation?.technicalNotes?.length > 0 || analysis.interpretation?.administrativeNotes?.length > 0) && (
                    <details className="rounded-lg border border-[#E1E4EA] bg-white p-3.5">
                      <summary className="cursor-pointer font-bold text-[#171A24]">Notas técnicas y administrativas de la ficha</summary>
                      {analysis.interpretation?.technicalNotes?.length > 0 && <div className="mt-3"><strong>Aspectos técnicos</strong><ul className="mt-1 list-disc space-y-1 pl-4 text-[#5D6472]">{analysis.interpretation.technicalNotes.map((note: string, idx: number) => <li key={`t-${idx}`}>{note}</li>)}</ul></div>}
                      {analysis.interpretation?.administrativeNotes?.length > 0 && <div className="mt-3"><strong>Aspectos administrativos</strong><ul className="mt-1 list-disc space-y-1 pl-4 text-[#5D6472]">{analysis.interpretation.administrativeNotes.map((note: string, idx: number) => <li key={`a-${idx}`}>{note}</li>)}</ul></div>}
                    </details>
                  )}

                  {analysis.interpretation?.risks?.length > 0 && (
                    <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-1">
                      <span className="font-bold text-amber-900">Riesgos y Consideraciones</span>
                      <ul className="list-disc pl-4 text-amber-800 space-y-0.5">
                        {analysis.interpretation.risks.map((r: string, idx: number) => (
                          <li key={idx}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-8 text-center text-[#8A92A6] bg-[#F8F9FA] rounded-xl border border-[#E1E4EA]">
                  Evalúa el encaje con el catálogo, los datos de la ficha y qué conviene revisar antes de cotizar.
                </div>
              )}
            </div>
          )}

          {tab === 'oferta' && (
            <OfferPreparationPanel
              listing={listing}
              companyId={companyId}
              userId={userId}
              csrfToken={csrfToken}
            />
          )}
            </>
          )}
        </div>

        {/* Modal Bottom Actions Fixed (Stitch 3) */}
        <div className="p-4 border-t border-[#E1E4EA] bg-white flex items-center justify-between gap-3">
          <button
            onClick={onSave}
            disabled={saved === true || saving}
            className={`h-10 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              saved
                ? 'bg-[#f0edff] text-[#5636D9] border border-[#5636D9]/30'
                : 'bg-white border border-[#E1E4EA] text-[#171A24] hover:bg-gray-50'
            }`}
          >
            {/* Green star ONLY for favorites/saved as explicitly requested by prompt */}
            <Star
              size={15}
              className={saved ? 'text-[#16845B] fill-[#16845B]' : 'text-[#8A92A6]'}
            />
            {saved ? 'Guardada en Seguimiento' : saving ? 'Guardando…' : 'Guardar en Seguimiento'}
          </button>

          <a
            href={`https://www.mercadopublico.cl/fichaLicitacion.html?idLicitacion=${encodeURIComponent(listing.CodigoExterno || '')}`}
            target="_blank"
            rel="noreferrer"
            className="h-10 px-4 bg-[#5636D9] hover:bg-[#4b2ec7] text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors shadow-sm"
          >
            Ver en Mercado Público <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </div>
  );
}

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [authState, setAuthState] = useState<'loading' | 'anonymous' | 'authenticated' | 'unavailable'>('loading');
  const [sessionNotice, setSessionNotice] = useState('');
  const [sessionCheck, setSessionCheck] = useState(0);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [pendingLegacy, setPendingLegacy] = useState<{ id: number; name: string } | null | undefined>(undefined);
  const [claimError, setClaimError] = useState('');
  const [claimBusy, setClaimBusy] = useState(false);

  const [section, setSection] = useState(() => PATH_SECTIONS[location.pathname] ?? 'Resumen');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  useEffect(() => {
    if (!userMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.profile-menu-wrap')) setUserMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setUserMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [userMenuOpen]);
  const [health, setHealth] = useState<Health | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [config, setConfig] = useState<any>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Search State
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [matchLevelFilter, setMatchLevelFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [modalityFilter, setModalityFilter] = useState('');
  const [closeAfterFilter, setCloseAfterFilter] = useState('');
  const [closeBeforeFilter, setCloseBeforeFilter] = useState('');
  const [searchView, setSearchView] = useState<'table' | 'cards'>('table');
  const [page, setPage] = useState(1);
  const [searchResults, setSearchResults] = useState<any>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  // Selected Detail Modal
  const [selected, setSelected] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedSaved, setSelectedSaved] = useState<boolean | null>(null);
  const [detailSaving, setDetailSaving] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  // Alerts State
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [alertCounts, setAlertCounts] = useState({ total: 0, unread: 0 });
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState('');
  const [alertsFilter, setAlertsFilter] = useState('all');

  const isAdmin = auth?.platformRole === 'admin' || auth?.role === 'admin';
  const isPlatformAdmin = auth?.platformRole === 'admin';
  const isCompanySetup = authState === 'authenticated' && Boolean(auth?.emailVerified) && !auth?.activeCompanyId && auth?.platformRole !== 'admin';
  const detailRouteMatch = location.pathname.match(/^\/oportunidades\/([^/]+)$/);
  const detailRouteCode = detailRouteMatch ? decodeURIComponent(detailRouteMatch[1]) : '';

  const goToSection = (name: string) => {
    const path = SECTION_PATHS[name];
    if (!path) return;
    setSection(name);
    setMobileOpen(false);
    setUserMenuOpen(false);
    setAlertsOpen(false);
    if (location.pathname !== path) navigate(path, { state: null });
  };

  useEffect(() => {
    if (authState === 'loading' || authState === 'unavailable') return;
    if (isCompanySetup) {
      if (location.pathname !== '/onboarding') navigate('/onboarding', { replace: true });
      return;
    }
    if (auth?.platformRole === 'admin' && !auth.activeCompanyId && pendingLegacy === null) {
      if (location.pathname !== '/usuarios') navigate('/usuarios', { replace: true });
      return;
    }
    if (location.pathname === '/onboarding') {
      navigate('/', { replace: true });
      return;
    }
    if (detailRouteCode) return;
    const routeSection = PATH_SECTIONS[location.pathname];
    if (!routeSection || ((routeSection === 'Equipo y accesos' || routeSection === 'Configuración') && !isAdmin) || ((routeSection === 'Cuentas de usuario' || routeSection === 'Centro de Pruebas') && !isPlatformAdmin)) {
      navigate('/', { replace: true });
      return;
    }
    if (section !== routeSection) setSection(routeSection);
  }, [authState, auth?.activeCompanyId, auth?.platformRole, detailRouteCode, isAdmin, isPlatformAdmin, isCompanySetup, location.pathname, navigate, pendingLegacy, section]);

  // Restore server-backed sessions after reloads. A temporary backend restart must not
  // be mistaken for an anonymous session or turn a valid cookie into a blank login.
  useEffect(() => {
    let mounted = true;
    const retryDelays = [0, 400, 900, 1800, 3200];
    const restoreSession = async () => {
      setAuthState('loading');
      setSessionNotice('');
      for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
        if (retryDelays[attempt]) {
          await new Promise((resolve) => window.setTimeout(resolve, retryDelays[attempt]));
        }
        if (!mounted) return;
        try {
          const session = await api<{ authenticated: boolean; csrfToken?: string; sessionExpired?: boolean } & Partial<AuthState>>(
            '/api/auth/session',
            { cache: 'no-store' }
          );
          if (!mounted) return;
          if (session.authenticated && session.csrfToken) {
            csrfToken = session.csrfToken;
            setStoredSessionMarker(true);
            setAuth(session as AuthState);
            setAuthState('authenticated');
          } else {
            setSessionNotice(session.sessionExpired || hasStoredSessionMarker() ? 'Tu sesión expiró o dejó de ser válida. Inicia sesión nuevamente.' : '');
            setAuthState('anonymous');
          }
          return;
        } catch {
          if (attempt === retryDelays.length - 1) {
            setAuthState('unavailable');
            return;
          }
        }
      }
    };
    void restoreSession();
    return () => {
      mounted = false;
    };
  }, [sessionCheck]);

  const acceptAuth = (session: AuthState) => {
    csrfToken = session.csrfToken;
    setStoredSessionMarker(true);
    setAuth(session);
    setAuthState('authenticated');
    setError('');
    setSessionNotice('');
  };

  const signOut = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      setToast('No se pudo confirmar el cierre de sesión. Comprueba la conexión e inténtalo de nuevo.');
      return;
    }
    csrfToken = '';
    setStoredSessionMarker(false);
    setAuth(null);
    setAuthState('anonymous');
    setConfig(null);
    setSummary(null);
    goToSection('Resumen');
  };

  const claimLegacy = async () => {
    if (!pendingLegacy) return;
    setClaimBusy(true);
    setClaimError('');
    try {
      const result = await api<{ csrfToken: string }>('/api/platform/legacy-company/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: pendingLegacy.id }),
      });
      csrfToken = result.csrfToken;
      const session = await api<AuthState & { authenticated: boolean }>('/api/auth/session');
      acceptAuth(session);
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : 'No se pudo vincular la empresa local.');
    } finally {
      setClaimBusy(false);
    }
  };

  useEffect(() => {
    if (authState !== 'authenticated' || auth?.platformRole !== 'admin' || auth.activeCompanyId) return;
    void api<{ available: boolean; company: { id: number; name: string } | null }>(
      '/api/platform/legacy-company/pending'
    )
      .then((res) => setPendingLegacy(res.available ? res.company : null))
      .catch((e) => setClaimError(e instanceof Error ? e.message : 'No se pudo revisar empresa pendiente.'));
  }, [authState, auth?.platformRole, auth?.activeCompanyId]);

  const refresh = useCallback(async () => {
    if (authState !== 'authenticated') return;
    try {
      const [h, s] = await Promise.all([api<Health>('/api/health'), api<Summary>('/api/resumen')]);
      setHealth(h);
      setSummary(s);
      if (section === 'Configuración' && auth?.activeCompanyId && isAdmin) {
        setConfig(await api<any>('/api/configuracion'));
      }
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo conectar con el servidor.');
    }
  }, [authState, auth?.activeCompanyId, isAdmin, section]);

  useEffect(() => {
    if (authState === 'authenticated') void refresh();
  }, [authState, refresh]);

  // Load Alerts
  const loadAlerts = useCallback(async (f = 'all') => {
    setAlertsLoading(true);
    setAlertsError('');
    try {
      await api('/api/alerts/evaluate', { method: 'POST' });
      const res = await api<{ items: AlertItem[]; counts: { total: number; unread: number } }>(
        `/api/alerts?filter=${f}`
      );
      setAlerts(res.items);
      setAlertCounts(res.counts);
    } catch (e) {
      setAlertsError(e instanceof Error ? e.message : 'No se pudieron cargar las alertas.');
    } finally {
      setAlertsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (section === 'Alertas' && authState === 'authenticated' && auth?.activeCompanyId) {
      void loadAlerts(alertsFilter);
    }
  }, [section, authState, auth?.activeCompanyId, alertsFilter, loadAlerts]);

  const refreshAlertCounts = useCallback(async () => {
    if (authState !== 'authenticated' || !auth?.activeCompanyId) return;
    try {
      const counts = await api<{ total: number; unread: number }>('/api/alerts/count');
      setAlertCounts(counts);
    } catch {
      /* ignore */
    }
  }, [authState, auth?.activeCompanyId]);

  useEffect(() => {
    if (authState !== 'authenticated' || !auth?.activeCompanyId) return;
    void refreshAlertCounts();
    const timer = window.setInterval(() => {
      void api('/api/alerts/evaluate', { method: 'POST' }).then(refreshAlertCounts).catch(() => {});
    }, ALERT_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [authState, auth?.activeCompanyId, refreshAlertCounts]);

  const openDetail = async (code: string, updateRoute = true) => {
    const targetPath = `/oportunidades/${encodeURIComponent(code)}`;
    const returnTo = detailRouteCode
      ? (location.state as { returnTo?: string } | null)?.returnTo ?? '/buscar'
      : location.pathname;
    if (updateRoute && location.pathname !== targetPath) {
      navigate(targetPath, { state: { returnTo } });
    }
    setSelected({ loading: true, _requestedCode: code });
    setSelectedSaved(null);
    setDetailSaving(false);
    setDetailLoading(true);
    setAnalysis(null);
    try {
      const [data, tracking] = await Promise.all([
        (async () => {
          const [officialResult, localResult] = await Promise.all([
            api<{ listing: any; source: string }>(`/api/licitaciones/${encodeURIComponent(code)}/oficial`)
              .then((value) => ({ value, error: null as unknown }))
              .catch((error: unknown) => ({ value: null, error })),
            api<{ listing: any; detailAvailable: boolean }>(`/api/licitaciones/${encodeURIComponent(code)}/local`)
              .catch(() => null),
          ]);
          if (officialResult.value) {
            return {
              listing: mergeListingDetails(officialResult.value.listing, localResult?.listing),
              source: officialResult.value.source,
            };
          }
          if (localResult) return {
            ...localResult,
            source: 'local-fallback',
            detailError: officialResult.error instanceof Error ? officialResult.error.message : 'No se pudo consultar Mercado Público; se muestran los datos locales disponibles.',
          };
          throw officialResult.error ?? new Error('No se pudo cargar la ficha.');
        })(),
        api<{ saved: boolean }>(`/api/company/tracking/lookup?codigo=${encodeURIComponent(code)}`).catch(() => ({
          saved: false,
        })),
      ]);
      setSelected({ ...data.listing, _source: data.source, _detailError: (data as any).detailError });
      setSelectedSaved(tracking.saved);
    } catch (e) {
      setSelected({ error: e instanceof Error ? e.message : 'No se encontró el detalle local.' });
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (authState !== 'authenticated' || !auth?.activeCompanyId || !detailRouteCode) return;
    if (
      selected?._requestedCode === detailRouteCode ||
      selected?.CodigoExterno === detailRouteCode ||
      selected?.codigo_externo === detailRouteCode
    ) return;
    void openDetail(detailRouteCode, false);
  }, [authState, auth?.activeCompanyId, detailRouteCode]);

  useEffect(() => {
    if (!detailRouteCode && selected) {
      setSelected(null);
      setSelectedSaved(null);
      setAnalysis(null);
    }
  }, [detailRouteCode]);

  const closeDetail = () => {
    setSelected(null);
    setSelectedSaved(null);
    setAnalysis(null);
    if (detailRouteCode) {
      const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
      navigate(returnTo && PATH_SECTIONS[returnTo] ? returnTo : '/buscar');
    }
  };

  const analyzeListing = async (code: string) => {
    setAnalysisLoading(true);
    try {
      const res = await api<any>(`/api/buscador/analysis/${encodeURIComponent(code)}`, { method: 'POST' });
      setAnalysis(res);
    } catch (e) {
      setAnalysis({ error: e instanceof Error ? e.message : 'No se pudo analizar esta licitación.' });
    } finally {
      setAnalysisLoading(false);
    }
  };

  const saveOpportunity = async (code: string) => {
    try {
      const res = await api<{ estado: string; created: boolean }>(`/api/company/tracking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: code }),
      });
      setToast(
        res.created ? `Licitación ${code} guardada en Seguimiento.` : `Licitación ${code} ya estaba en Seguimiento.`
      );
      void refreshAlertCounts();
      setSelectedSaved(true);
      return true;
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'No se pudo guardar.');
      return false;
    }
  };

  const runSearch = async (q = search, p = 1) => {
    if (q.trim().length < 2) {
      setToast('Escribe al menos 2 caracteres para buscar oportunidades.');
      return;
    }
    setSearchLoading(true);
    try {
      const res = await api<any>('/api/buscador/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: q,
          page: p,
          pageSize: 10,
          states: stateFilter ? [Number(stateFilter)] : [],
          matchLevel: matchLevelFilter || undefined,
          region: regionFilter || null,
          modality: modalityFilter || null,
          closeAfter: closeAfterFilter || null,
          closeBefore: closeBeforeFilter || null,
        }),
      });
      setSearch(q);
      setPage(p);
      setSearchResults(res);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Error al buscar.');
    } finally {
      setSearchLoading(false);
    }
  };

  const beginSummarySearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = search.trim();
    if (query.length < 2) {
      setToast('Escribe al menos 2 caracteres para buscar oportunidades.');
      return;
    }
    setSearch(query);
    setSearchResults(null);
    goToSection('Buscar oportunidades');
  };

  useEffect(() => {
    if (authState === 'authenticated' && section === 'Buscar oportunidades' && !searchResults && search.trim().length >= 2) {
      void runSearch(search, 1);
    }
  }, [authState, section, searchResults]);

  const changeCompany = async (companyId: number) => {
    try {
      const next = await api<AuthState>('/api/auth/company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });
      csrfToken = next.csrfToken;
      setAuth(next);
      setAlerts([]);
      setAlertCounts({ total: 0, unread: 0 });
      setAlertsOpen(false);
      goToSection('Resumen');
      void refreshAlertCounts();
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'No se pudo cambiar de empresa.');
    }
  };

  const acceptInvitationPrompt = async () => {
    const token = window.prompt('Pega el token de invitación recibido por el Administrador:');
    if (!token?.trim()) return;
    try {
      const next = await api<AuthState>('/api/auth/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitationToken: token.trim() }),
      });
      csrfToken = next.csrfToken;
      setAuth(next);
      goToSection('Resumen');
      setToast('Invitación aceptada. Ya puedes acceder a la nueva empresa.');
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'No se pudo aceptar la invitación.');
    }
  };

  const todayLabel = useMemo(
    () => new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()),
    []
  );
  const greetingName = auth?.firstName?.trim()
    || auth?.email.split('@')[0].split(/[._-]/)[0].replace(/^./, (letter) => letter.toLocaleUpperCase('es-CL'))
    || 'Hola';

  if (authState === 'loading') {
    return (
      <main className="min-h-screen bg-[#F5F6F8] flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-2xl border border-[#E1E4EA] shadow-sm flex items-center gap-3 text-sm text-[#171A24]">
          <LoaderCircle className="spin text-[#5636D9]" size={20} />
          Verificando tu sesión en Oportuna…
        </div>
      </main>
    );
  }

  if (authState === 'unavailable') {
    return (
      <main className="min-h-screen bg-[#F5F6F8] flex items-center justify-center p-4">
        <section className="w-full max-w-md bg-white p-6 rounded-2xl border border-[#E1E4EA] shadow-sm text-center space-y-4" aria-live="polite">
          <h1 className="text-lg font-bold text-[#171A24]">No pudimos comprobar tu sesión</h1>
          <p className="text-sm text-[#5D6472]">El servidor de Oportuna no respondió. Tu sesión no se ha cerrado. Comprueba que la aplicación esté iniciada y vuelve a intentarlo.</p>
          <button type="button" onClick={() => setSessionCheck((value) => value + 1)} className="w-full h-11 bg-[#5636D9] hover:bg-[#4b2ec7] text-white font-semibold rounded-xl text-sm">Volver a comprobar</button>
        </section>
      </main>
    );
  }

  if (authState === 'anonymous') {
    return <AuthGate onAuthenticated={acceptAuth} initialError={sessionNotice} />;
  }

  if (auth && !auth.emailVerified) {
    return <EmailVerificationGate session={auth} onAuthenticated={acceptAuth} />;
  }

  if (auth?.platformRole === 'admin' && !auth.activeCompanyId && pendingLegacy !== null) {
    return pendingLegacy === undefined ? (
      <main className="min-h-screen bg-[#F5F6F8] flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-2xl border border-[#E1E4EA] shadow-sm flex items-center gap-3 text-sm text-[#171A24]">
          <LoaderCircle className="spin text-[#5636D9]" size={20} />
          Revisando espacio local…
        </div>
      </main>
    ) : (
      <LegacyClaim company={pendingLegacy} onClaim={() => void claimLegacy()} busy={claimBusy} error={claimError} />
    );
  }

  if (!auth?.activeCompanyId && auth?.platformRole !== 'admin') {
    return <NoCompanyOnboarding session={auth!} onAuthenticated={acceptAuth} />;
  }

  const navGroups = [
    {
      label: 'Explorar',
      items: [
        { name: 'Resumen', icon: LayoutDashboard },
        { name: 'Buscar oportunidades', icon: Search },
        { name: 'Oportunidades', icon: Sparkles },
        { name: 'Agentes IA', icon: FileSearch },
        { name: 'Inteligencia de mercado', icon: BarChart3 },
        { name: 'Analítica', icon: BarChart3, subItem: true },
      ],
    },
    {
      label: 'Gestionar',
      items: [
        { name: 'Seguimiento', icon: Activity },
        { name: 'Calendario', icon: CalendarDays },
        { name: 'Alertas', icon: Bell },
      ],
    },
    {
      label: 'Espacio de trabajo',
      items: [
        { name: 'Mi empresa', icon: Building2 },
        ...(isAdmin ? [{ name: 'Equipo y accesos', icon: Users }] : []),
        ...(isPlatformAdmin ? [{ name: 'Cuentas de usuario', icon: Users }] : []),
        ...(isAdmin ? [{ name: 'Configuración', icon: Settings }] : []),
      ],
    },
    ...(isPlatformAdmin ? [{ label: 'Herramientas internas', items: [{ name: 'Centro de Pruebas', icon: FlaskConical, isSandbox: true }] }] : []),
  ];

  return (
    <div className="min-h-screen bg-[#F5F6F8] text-[#171A24] antialiased flex flex-col lg:flex-row">
      {/* SIDEBAR NAVIGATION (Desktop fixed / Mobile drawer conforming to Stitch) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-[#E1E4EA] p-5 flex flex-col justify-between gap-4 overflow-y-auto transition-transform duration-200 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        }`}
      >
        <div className="space-y-6">
          {/* Brand header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#5636D9] text-white flex items-center justify-center font-black text-sm tracking-tight shadow-sm">
                O
              </div>
              <div>
                <strong className="font-bold text-base text-[#171A24] tracking-tight block">Oportuna</strong>
                <span className="text-[10px] text-[#8A92A6] block leading-none">Mercado Público</span>
              </div>
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              className="lg:hidden p-1 text-[#5D6472] hover:bg-gray-100 rounded-lg"
            >
              <X size={18} />
            </button>
          </div>

          {/* Active Company Selector Pill */}
          <div className="p-2.5 rounded-xl bg-[#F8F9FA] border border-[#E1E4EA] flex flex-col items-stretch">
            <div className="flex items-center gap-2 min-w-0">
              <Building2 size={16} className="text-[#5636D9] shrink-0" />
              <div className="min-w-0">
                <span className="text-[10px] uppercase font-bold text-[#8A92A6] block">Empresa activa</span>
                <span className="font-semibold text-xs text-[#171A24] truncate block">
                  {auth.memberships.find((m) => m.companyId === auth.activeCompanyId)?.companyName || 'Mi Empresa'}
                </span>
              </div>
            </div>
            {auth.memberships.length > 1 && (
              <select
                aria-label="Empresa activa"
                value={auth.activeCompanyId ?? ''}
                onChange={(e) => void changeCompany(Number(e.target.value))}
                className="lg:hidden mt-2 h-8 w-full min-w-0 px-2 rounded-lg border border-[#E1E4EA] text-xs text-[#171A24] bg-white"
              >
                {auth.memberships.map((membership) => (
                  <option key={membership.companyId} value={membership.companyId}>{membership.companyName}</option>
                ))}
              </select>
            )}
          </div>

          {/* Primary navigation, grouped by the work each section supports */}
          <nav aria-label="Navegación principal" className="space-y-4">
            {navGroups.map((group) => (
              <div key={group.label} className="space-y-1">
                <span className="text-[10px] uppercase font-bold text-[#8A92A6] px-3 tracking-wider block mb-1">
                  {group.label}
                </span>
                {group.items.map((item) => {
                  const active = section === item.name;
                  return (
                    <button
                      key={item.name}
                      onClick={() => goToSection(item.name)}
                      aria-current={active ? 'page' : undefined}
                      className={`w-full h-10 px-3 rounded-xl flex items-center justify-between text-xs font-semibold transition-colors ${'subItem' in item && item.subItem ? 'pl-8 h-9 text-[11px]' : ''} ${
                        active
                          ? 'bg-[#f0edff] text-[#5636D9]'
                          : 'text-[#5D6472] hover:bg-[#F8F9FA] hover:text-[#171A24]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <item.icon size={17} className={active ? 'text-[#5636D9]' : 'text-[#8A92A6]'} />
                        <span>{item.name}</span>
                      </div>
                      {'isSandbox' in item && item.isSandbox && (
                        <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                          Aislado
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>

        {/* Sidebar Bottom Profile */}
        <div className="pt-4 border-t border-[#E1E4EA] space-y-3">
          <div className="grid grid-cols-2 gap-2 lg:hidden">
            <button type="button" onClick={() => goToSection('Mi perfil')} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#E1E4EA] bg-white text-xs font-semibold text-[#5D6472] hover:bg-[#F8F9FA]">
              <UserRound size={14} /> Mi perfil
            </button>
            <button type="button" onClick={() => goToSection('Seguridad')} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#E1E4EA] bg-white text-xs font-semibold text-[#5D6472] hover:bg-[#F8F9FA]">
              <Shield size={14} /> Seguridad
            </button>
          </div>
          <div className="flex items-center justify-between p-2 rounded-xl bg-[#F8F9FA] border border-[#E1E4EA]">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-[#f0edff] text-[#5636D9] font-bold text-xs flex items-center justify-center shrink-0">
                {auth.firstName ? auth.firstName[0].toUpperCase() : auth.email[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-xs text-[#171A24] truncate block">
                  {auth.firstName ? `${auth.firstName} ${auth.lastName}` : auth.email}
                </span>
                <span className="text-[10px] text-[#8A92A6] block truncate">
                  {auth.platformRole === 'admin' ? 'Administrador de plataforma' : 'Cliente'}
                </span>
              </div>
            </div>
            <button
              onClick={() => void signOut()}
              title="Cerrar sesión"
              className="p-1.5 text-[#8A92A6] hover:text-red-600 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 lg:hidden backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* MAIN CONTENT AREA */}
      <div className="min-w-0 flex-1 lg:ml-64 flex flex-col min-h-screen">
        {/* TOPBAR */}
        <header className={`summary-topbar h-14 bg-white border-b border-[#E1E4EA] px-4 sm:px-8 flex items-center justify-between sticky top-0 z-30 shadow-sm ${section === 'Resumen' ? 'summary-topbar-home' : ''}`}>
          <div className="summary-topbar-identity flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 text-[#5D6472] hover:bg-gray-100 rounded-lg"
              aria-label="Abrir navegación"
            >
              <Menu size={18} />
            </button>
            <div className="flex items-center gap-2 text-xs text-[#5D6472]">
              <span className="font-bold text-[#171A24]">Oportuna</span>
              <span>/</span>
              <span className="font-semibold text-[#5636D9]">{section}</span>
            </div>
          </div>

          <form className="summary-topbar-search" onSubmit={beginSummarySearch} role="search">
            <Search size={17} aria-hidden="true" />
            <input
              id="global-opportunity-search"
              name="globalSearch"
              aria-label="Búsqueda global de oportunidades"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar licitaciones, compras ágiles o palabras clave…"
            />
          </form>

          <div className="summary-topbar-actions flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={() => goToSection('Buscar oportunidades')}
              aria-label="Buscar oportunidades"
              className="summary-mobile-search lg:hidden h-8 w-8 rounded-lg border border-[#E1E4EA] text-[#5D6472] hover:bg-[#F8F9FA] flex items-center justify-center"
            >
              <Search size={16} />
            </button>
            <span className="summary-topbar-date hidden 2xl:flex items-center gap-1.5 text-[#5D6472] bg-[#F8F9FA] px-3 py-1 rounded-full border border-[#E1E4EA]">
              <Clock3 size={13} className="text-[#8A92A6]" />
              {todayLabel}
            </span>

            {auth.memberships.length > 1 && (
              <select
                aria-label="Empresa activa"
                value={auth.activeCompanyId ?? ''}
                onChange={(e) => void changeCompany(Number(e.target.value))}
                className="hidden sm:block h-8 w-16 min-w-0 px-1 rounded-lg border border-[#E1E4EA] text-xs text-[#171A24] bg-white sm:w-auto sm:max-w-[160px]"
              >
                {auth.memberships.map((m) => (
                  <option key={m.companyId} value={m.companyId}>
                    {m.companyName}
                  </option>
                ))}
              </select>
            )}

            <button
              onClick={() => void acceptInvitationPrompt()}
              type="button"
              aria-label="Aceptar invitación"
              title="Aceptar invitación"
              className="hidden md:flex w-8 items-center justify-center gap-1.5 h-8 px-0 rounded-lg border border-[#E1E4EA] text-[#5D6472] hover:bg-[#F8F9FA] transition-colors 2xl:w-auto 2xl:px-3"
            >
              <MailPlus size={14} />
              <span className="hidden 2xl:inline">Aceptar invitación</span>
            </button>

            {/* Notification Bell */}
            <AlertNotificationPanel
              items={alerts}
              unread={alertCounts.unread}
              open={alertsOpen}
              loading={alertsLoading}
              error={alertsError}
              onToggle={() => {
                const next = !alertsOpen;
                setAlertsOpen(next);
                if (next) void loadAlerts('all');
              }}
              onNavigate={() => {
                setAlertsOpen(false);
                setAlertsFilter('all');
                goToSection('Alertas');
              }}
              onRead={(id) => {
                void api(`/api/alerts/${id}/read`, { method: 'POST' }).then(() => {
                  setAlerts((curr) => alertsFilter === 'unread'
                    ? curr.filter((item) => item.id !== id)
                    : curr.map((item) => (item.id === id ? { ...item, readAt: new Date().toISOString() } : item)));
                  void refreshAlertCounts();
                });
              }}
              onDismiss={(id) => {
                void api(`/api/alerts/${id}/dismiss`, { method: 'POST' }).then(() => {
                  setAlerts((curr) => curr.filter((it) => it.id !== id));
                  void refreshAlertCounts();
                });
              }}
              onOpen={(item) => {
                setAlertsOpen(false);
                void openDetail(item.code);
              }}
            />
            <div className="profile-menu-wrap relative hidden lg:block">
              <button
                type="button"
                className="summary-topbar-profile flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-[#F8F9FA]"
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                aria-controls="account-profile-menu"
                onClick={() => setUserMenuOpen((open) => !open)}
              >
                <span className="summary-topbar-avatar">
                  {auth.firstName ? auth.firstName[0].toUpperCase() : auth.email[0].toUpperCase()}
                </span>
                <span className="min-w-0">
                  <b>{greetingName}</b>
                  <small>{auth.platformRole === 'admin' ? 'Administrador de plataforma' : 'Cliente'}</small>
                </span>
              </button>
              {userMenuOpen && (
                <div id="account-profile-menu" role="menu" aria-label="Menú de perfil" className="profile-menu absolute right-0 top-full z-50 mt-2 w-60 rounded-xl border border-[#E1E4EA] bg-white p-2 shadow-lg">
                  <div className="px-3 py-2">
                    <b className="block truncate text-xs text-[#171A24]">{greetingName}</b>
                    <span className="block truncate text-xs text-[#8A92A6]">{auth.email}</span>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setUserMenuOpen(false); goToSection('Mi perfil'); }}
                    className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold text-[#5D6472] hover:bg-[#F8F9FA]"
                  >
                    <UserRound size={15} /> Mi perfil
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setUserMenuOpen(false); goToSection('Seguridad'); }}
                    className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold text-[#5D6472] hover:bg-[#F8F9FA]"
                  >
                    <Shield size={15} /> Seguridad
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setUserMenuOpen(false); void signOut(); }}
                    className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold text-[#5D6472] hover:bg-[#F8F9FA]"
                  >
                    <LogOut size={15} /> Cerrar sesión
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* BODY CONTAINER */}
        <main className="min-w-0 flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto space-y-6">
          {/* SECTION: RESUMEN (Stitch screen 1) */}
          {section === 'Mi perfil' && (
            <ProfilePage
              session={auth}
              onProfileUpdated={(fields) => setAuth((current) => current ? { ...current, ...fields } : current)}
              onNavigateSecurity={() => goToSection('Seguridad')}
            />
          )}
          {section === 'Seguridad' && <SecurityPage session={auth} />}

          {section === 'Resumen' && (
            <div className="summary-page space-y-6">
              <section className="summary-welcome flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="min-w-0">
                  <div className="summary-context flex flex-wrap items-center gap-2 mb-2">
                    <span className="summary-company-chip">
                      <Building2 size={14} />
                      {auth.memberships.find((membership) => membership.companyId === auth.activeCompanyId)?.companyName || 'Empresa activa'}
                    </span>
                    <span className="summary-date-chip"><Clock3 size={13} /> {todayLabel}</span>
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-[#171A24] tracking-tight flex items-center gap-2">
                    Buenos días, {greetingName}
                    <span role="img" aria-label="saludo" className="text-2xl select-none">👋</span>
                  </h1>
                  <p className="text-sm text-[#5D6472] mt-1">
                    Aquí tienes el estado de las licitaciones indexadas y las coincidencias para tu empresa.
                  </p>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => goToSection('Configuración')}
                    className="summary-config-link shrink-0"
                  >
                    <Settings size={15} /> Gestionar integraciones
                  </button>
                )}
              </section>

              <section className="summary-metric-grid grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" aria-label="Métricas del índice">
                <article className="summary-metric-card">
                  <div className="summary-metric-top"><span className="summary-metric-icon"><Database size={18} /></span><span className="summary-metric-tag">Índice local</span></div>
                  <strong>{summary ? summary.total.toLocaleString('es-CL') : '—'}</strong>
                  <span>Licitaciones registradas</span>
                </article>
                <article className="summary-metric-card">
                  <div className="summary-metric-top"><span className="summary-metric-icon"><Activity size={18} /></span><span className="summary-metric-tag">Publicada</span></div>
                  <strong>{summary?.estados?.find((state) => state.codigoEstado === 5)?.total.toLocaleString('es-CL') ?? '—'}</strong>
                  <span>En el índice local</span>
                </article>
                <article className="summary-metric-card">
                  <div className="summary-metric-top"><span className="summary-metric-icon"><Sparkles size={18} /></span><span className="summary-metric-tag">Última ejecución</span></div>
                  <strong>{summary?.ultimaSincronizacion?.totalInsertados?.toLocaleString('es-CL') ?? '—'}</strong>
                  <span>Registros incorporados</span>
                </article>
                <article className="summary-metric-card">
                  <div className="summary-metric-top"><span className="summary-metric-icon"><Clock3 size={18} /></span><span className="summary-metric-tag">ChileCompra</span></div>
                  <strong className="summary-metric-date">{summary?.ultimaSincronizacion?.fechaConsultada ? dateFmt(summary.ultimaSincronizacion.fechaConsultada) : '—'}</strong>
                  <span>Último período consultado</span>
                </article>
              </section>

              <section className="summary-search-feature">
                <div className="summary-search-copy">
                  <span className="summary-search-eyebrow"><Sparkles size={14} /> Búsqueda en Mercado Público</span>
                  <h2>Encuentra oportunidades para tu negocio</h2>
                  <p>Busca licitaciones y compras ágiles con los filtros y criterios disponibles en Oportuna.</p>
                </div>
                <form className="summary-feature-search" onSubmit={beginSummarySearch} role="search">
                  <Search size={18} aria-hidden="true" />
                  <input
                    aria-label="Buscar licitaciones"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Describe qué ofrece tu empresa…"
                  />
                  <button type="submit"><Search size={15} /> Buscar licitaciones</button>
                </form>
              </section>

              <section className="summary-insight-grid grid grid-cols-1 xl:grid-cols-12 gap-5">
                <article className="summary-activity-panel xl:col-span-5">
                  <div className="summary-section-heading">
                    <div>
                      <h2>Actividad reciente</h2>
                      <p>Sincronizaciones y registros más recientes del índice local</p>
                    </div>
                    <button onClick={() => goToSection('Buscar oportunidades')} className="summary-text-link">Ver licitaciones <ArrowRight size={14} /></button>
                  </div>
                  {summary?.ultimaSincronizacion ? (
                    <div className="summary-sync-card">
                      <div className="summary-sync-icon"><Database size={17} /></div>
                      <div className="min-w-0 flex-1">
                        <div className="summary-sync-title-row">
                          <strong>Última sincronización</strong>
                          <span className={`summary-run-status ${summary.ultimaSincronizacion.estado === 'completada' ? 'is-complete' : 'is-pending'}`}>
                            {summary.ultimaSincronizacion.estado || 'Sin estado'}
                          </span>
                        </div>
                        <span>{summary.ultimaSincronizacion.startedAt ? dateTimeFmt(summary.ultimaSincronizacion.startedAt) : 'Fecha no disponible'}</span>
                        <div className="summary-sync-stats">
                          <span><b>{summary.ultimaSincronizacion.totalRecibidos ?? '—'}</b> recibidos</span>
                          <span><b>{summary.ultimaSincronizacion.totalInsertados ?? '—'}</b> incorporados</span>
                          <span><b>{summary.ultimaSincronizacion.totalActualizados ?? '—'}</b> actualizados</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="summary-empty-state">Aún no hay sincronizaciones registradas para mostrar.</div>
                  )}
                  <div className="summary-recent-list">
                    {(summary?.ultimasLicitaciones ?? []).slice(0, 3).map((item) => (
                      <button key={item.codigo_externo} onClick={() => void openDetail(item.codigo_externo)} className="summary-recent-item">
                        <span className="summary-recent-marker"><FileSearch size={15} /></span>
                        <span className="summary-recent-copy">
                          <b>{item.nombre || 'Nombre no disponible'}</b>
                          <small>{item.codigo_externo} · {item.organismo || 'Organismo no informado'}</small>
                        </span>
                        <ArrowRight size={14} className="summary-recent-arrow" />
                      </button>
                    ))}
                    {!summary?.ultimasLicitaciones?.length && <div className="summary-empty-state">No hay licitaciones recientes en el índice.</div>}
                  </div>
                </article>

                <article className="summary-evolution-panel xl:col-span-7">
                  <div className="summary-section-heading">
                    <div>
                      <h2>Evolución de oportunidades</h2>
                      <p>Distribución actual por estado en el índice local</p>
                    </div>
                    <button onClick={() => goToSection('Inteligencia de mercado')} className="summary-text-link">Ver analítica <ArrowRight size={14} /></button>
                  </div>
                  {summary?.estados?.length ? (
                    <div className="summary-state-chart" aria-label="Licitaciones actuales por estado">
                      {summary.estados.map((state) => {
                        const denominator = summary.estados.reduce((sum, entry) => sum + Number(entry.total || 0), 0);
                        const share = denominator ? Math.round((Number(state.total || 0) / denominator) * 100) : 0;
                        const label = state.codigoEstado == null ? 'Sin estado' : statusNames[state.codigoEstado] || `Estado ${state.codigoEstado}`;
                        return (
                          <div className="summary-state-row" key={state.codigoEstado ?? 'unknown'}>
                            <div className="summary-state-label"><span>{label}</span><b>{Number(state.total || 0).toLocaleString('es-CL')}</b></div>
                            <div className="summary-state-track" role="img" aria-label={`${label}: ${share}%`}><span style={{ width: `${share}%` }} /></div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="summary-empty-state">No hay distribución por estado disponible.</div>
                  )}
                  <p className="summary-chart-note">Esta vista muestra el estado actual. El endpoint de Resumen todavía no entrega una serie histórica por mes.</p>
                </article>
              </section>

              <CompanyOpportunities
                onConfigure={() => goToSection('Mi empresa')}
                onOpenListing={(code) => void openDetail(code)}
                onViewAll={() => goToSection('Oportunidades')}
              />
            </div>
          )}

          {/* SECTION: BUSCAR OPORTUNIDADES (Stitch 2 screen) */}
          {section === 'Buscar oportunidades' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                  <div className="text-[11px] font-bold text-[#5636D9] uppercase tracking-wider mb-1">
                    Mercado Público
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-[#171A24] tracking-tight">
                    Buscar Oportunidades
                  </h1>
                  <p className="text-sm text-[#5D6472] mt-1">
                    Encuentra licitaciones y compras ágiles mediante búsqueda semántica asistida y filtros combinables.
                  </p>
                </div>

                <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-[#E1E4EA] shadow-sm">
                  <button
                    onClick={() => setSearchView('table')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                      searchView === 'table' ? 'bg-[#5636D9] text-white shadow-sm' : 'text-[#5D6472] hover:bg-gray-100'
                    }`}
                  >
                    Tabla
                  </button>
                  <button
                    onClick={() => setSearchView('cards')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                      searchView === 'cards' ? 'bg-[#5636D9] text-white shadow-sm' : 'text-[#5D6472] hover:bg-gray-100'
                    }`}
                  >
                    Tarjetas
                  </button>
                </div>
              </div>

              {/* Search and filters */}
              <div className="opportunity-search-panel">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runSearch(search, 1);
                  }}
                  className="opportunity-search-form"
                >
                  <div className="opportunity-query-wrap">
                    <Search size={21} aria-hidden="true" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Describe qué ofrece tu empresa... Ej: Insumos de laboratorio en Santiago o Mantención de transformadores"
                      aria-label="Describe qué oportunidad buscas"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={searchLoading}
                    className="opportunity-search-submit"
                  >
                    {searchLoading ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}
                    Buscar
                  </button>
                </form>

                {/* Example query chips */}
                <div className="opportunity-search-examples">
                  <span>Prueba buscar:</span>
                  {[
                    'Equipamiento médico y quirúrgico',
                    'Servicios de aseo en hospitales',
                    'Molinos y maquinaria industrial',
                    'Obras civiles y edificación',
                  ].map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => {
                        setSearch(ex);
                        void runSearch(ex, 1);
                      }}
                      className="opportunity-example-chip"
                    >
                      {ex}
                    </button>
                  ))}
                </div>

                <div className="opportunity-filter-heading">
                  <div className="opportunity-filter-title">
                    <strong>Filtros</strong>
                    <span>Combina criterios admitidos por el buscador</span>
                    {(Number(Boolean(matchLevelFilter)) + Number(Boolean(stateFilter)) + Number(Boolean(regionFilter.trim())) + Number(Boolean(modalityFilter)) + Number(Boolean(closeAfterFilter)) + Number(Boolean(closeBeforeFilter))) > 0 && (
                      <span className="opportunity-active-count">
                        {Number(Boolean(matchLevelFilter)) + Number(Boolean(stateFilter)) + Number(Boolean(regionFilter.trim())) + Number(Boolean(modalityFilter)) + Number(Boolean(closeAfterFilter)) + Number(Boolean(closeBeforeFilter))} filtros activos
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="opportunity-clear-filters"
                    disabled={!matchLevelFilter && !stateFilter && !regionFilter && !modalityFilter && !closeAfterFilter && !closeBeforeFilter}
                    onClick={() => {
                      setMatchLevelFilter('');
                      setStateFilter('');
                      setRegionFilter('');
                      setModalityFilter('');
                      setCloseAfterFilter('');
                      setCloseBeforeFilter('');
                    }}
                  >
                    Limpiar filtros
                  </button>
                </div>

                <div className="opportunity-filter-grid">
                  <div className="opportunity-filter-field">
                    <label htmlFor="opportunity-match-level">Nivel de coincidencia</label>
                    <select
                      id="opportunity-match-level"
                      value={matchLevelFilter}
                      onChange={(e) => setMatchLevelFilter(e.target.value)}
                    >
                      <option value="">Todos los niveles</option>
                      <option value="high">Alta</option>
                      <option value="medium">Media</option>
                      <option value="exploratory">Exploratoria</option>
                    </select>
                  </div>
                  <div className="opportunity-filter-field">
                    <label htmlFor="opportunity-status">Estado</label>
                    <select
                      id="opportunity-status"
                      value={stateFilter}
                      onChange={(e) => setStateFilter(e.target.value)}
                    >
                      <option value="">Todos los estados</option>
                      <option value="5">Publicada</option>
                      <option value="6">Cerrada</option>
                      <option value="8">Adjudicada</option>
                      <option value="7">Desierta</option>
                    </select>
                  </div>
                  <div className="opportunity-filter-field">
                    <label htmlFor="opportunity-region">Región</label>
                    <input
                      id="opportunity-region"
                      value={regionFilter}
                      onChange={(e) => setRegionFilter(e.target.value)}
                      placeholder="Ej. Metropolitana"
                    />
                  </div>
                  <div className="opportunity-filter-field">
                    <label htmlFor="opportunity-modality">Tipo de proceso</label>
                    <select id="opportunity-modality" value={modalityFilter} onChange={(e) => setModalityFilter(e.target.value)}>
                      <option value="">Todos los tipos</option>
                      <option value="public">Licitación pública</option>
                      <option value="private">Licitación privada</option>
                      <option value="agile">Compra Ágil</option>
                    </select>
                  </div>
                  <div className="opportunity-filter-field">
                    <label htmlFor="opportunity-close-after">Cierre desde</label>
                    <input id="opportunity-close-after" type="date" value={closeAfterFilter} onChange={(e) => setCloseAfterFilter(e.target.value)} />
                  </div>
                  <div className="opportunity-filter-field">
                    <label htmlFor="opportunity-close-before">Cierre hasta</label>
                    <input id="opportunity-close-before" type="date" value={closeBeforeFilter} onChange={(e) => setCloseBeforeFilter(e.target.value)} />
                  </div>
                </div>

                <div className="opportunity-filter-footer">
                  <span><span className="opportunity-info-mark">i</span> El tipo de proceso y el rango de cierre se aplican al buscar.</span>
                  <button
                    type="button"
                    onClick={() => void runSearch(search, 1)}
                    disabled={searchLoading || search.trim().length < 2}
                    className="opportunity-apply-filters"
                  >
                    <Filter size={16} /> Aplicar filtros
                  </button>
                </div>
              </div>

              {/* Search Results Summary */}
              {searchResults && (
                <div className="flex items-center justify-between text-xs text-[#5D6472]">
                  <span>
                    Encontradas <b>{searchResults.total.toLocaleString('es-CL')}</b> licitaciones reales (Página {page})
                  </span>
                  <span className="text-[11px] text-[#8A92A6]">
                    Relevancia calculada con base en catálogo e inferencia contextual
                  </span>
                </div>
              )}

              {/* Search Results View */}
              {searchLoading ? (
                <div className="p-12 text-center text-sm text-[#5D6472] bg-white rounded-xl border border-[#E1E4EA]">
                  <LoaderCircle size={24} className="spin mx-auto text-[#5636D9] mb-2" />
                  Buscando oportunidades en Mercado Público…
                </div>
              ) : !searchResults?.items?.length ? (
                <div className="p-12 text-center bg-white rounded-2xl border border-[#E1E4EA] space-y-3">
                  <FileSearch size={24} className="mx-auto text-[#8A92A6]" />
                  <h3 className="font-bold text-base text-[#171A24]">
                    {search.trim().length < 2 ? 'Describe qué oportunidad buscas' : 'No se encontraron licitaciones'}
                  </h3>
                  <p className="text-xs text-[#5D6472]">
                    {search.trim().length < 2
                      ? 'Escribe al menos 2 caracteres o elige uno de los ejemplos para iniciar la búsqueda.'
                      : 'Prueba ajustando los términos o limpiando los filtros aplicados.'}
                  </p>
                </div>
              ) : searchView === 'table' ? (
                <div className="bg-white rounded-xl border border-[#E1E4EA] shadow-sm overflow-hidden">
                  <div className="search-results-table-wrap" role="region" aria-label="Resultados de búsqueda" tabIndex={0}>
                    <table className="search-results-table text-left text-xs">
                      <colgroup>
                        <col style={{ width: '270px' }} />
                        <col style={{ width: '190px' }} />
                        <col style={{ width: '140px' }} />
                        <col style={{ width: '120px' }} />
                        <col style={{ width: '110px' }} />
                        <col style={{ width: '90px' }} />
                        <col style={{ width: '160px' }} />
                      </colgroup>
                      <thead className="bg-[#F8F9FA] border-b border-[#E1E4EA] text-[#5D6472] font-semibold">
                        <tr>
                          <th className="py-3 px-4">OPORTUNIDAD</th>
                          <th className="py-3 px-4">ORGANISMO</th>
                          <th className="py-3 px-4">MONTO ESTIMADO</th>
                          <th className="py-3 px-4">CIERRE</th>
                          <th className="py-3 px-4">ESTADO</th>
                          <th className="py-3 px-4">MATCH</th>
                          <th className="py-3 px-4 text-right">ACCIONES</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E1E4EA]">
                        {searchResults.items.map((item: any) => (
                          <tr key={item.codigo_externo} className="hover:bg-gray-50 transition-colors">
                            <td className="search-col-opportunity py-3 px-4">
                              <button
                                onClick={() => void openDetail(item.codigo_externo)}
                                className="search-opportunity-title font-bold text-[#171A24] hover:text-[#5636D9] text-left"
                                title={item.nombre || 'Nombre no disponible'}
                                aria-label={`Abrir ficha: ${item.nombre || 'Nombre no disponible'}`}
                              >
                                {item.nombre || 'Nombre no disponible'}
                              </button>
                              <span className="font-mono text-[11px] text-[#8A92A6]">{item.codigo_externo}</span>
                            </td>
                            <td className="search-col-organism py-3 px-4 text-[#5D6472]">
                              <span title={item.organismo || 'Organismo no informado'}>{item.organismo || '—'}</span>
                            </td>
                            <td className="search-col-amount py-3 px-4 font-semibold text-[#171A24]" title={money(item.monto_estimado, item.moneda)}>{money(item.monto_estimado, item.moneda)}</td>
                            <td className="search-col-close py-3 px-4 text-[#5D6472]">{dateFmt(item.fecha_cierre)}</td>
                            <td className="search-col-status py-3 px-4">
                              <StatusBadge state={item.codigo_estado} />
                            </td>
                            <td className="search-col-match py-3 px-4">
                              <span className="font-bold text-xs text-[#5636D9] bg-[#f0edff] px-2 py-0.5 rounded-full">
                                {item.compatibility ?? 50}%
                              </span>
                            </td>
                            <td className="search-col-actions py-3 px-4">
                              <div>
                                <button
                                  onClick={() => void saveOpportunity(item.codigo_externo)}
                                  className="text-xs text-[#5D6472] hover:text-[#5636D9] font-medium"
                                  title="Guardar en seguimiento"
                                >
                                  Guardar
                                </button>
                                <button
                                  onClick={() => void openDetail(item.codigo_externo)}
                                  className="text-xs text-[#5636D9] font-semibold hover:underline"
                                >
                                  Ver ficha
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {searchResults.items.map((item: any) => (
                    <div
                      key={item.codigo_externo}
                      className="bg-white rounded-xl border border-[#E1E4EA] p-5 shadow-sm space-y-3 flex flex-col justify-between"
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <button
                            onClick={() => void openDetail(item.codigo_externo)}
                            className="font-bold text-sm text-[#171A24] hover:text-[#5636D9] text-left line-clamp-2"
                          >
                            {item.nombre || 'Nombre no disponible'}
                          </button>
                          <span className="text-xs font-bold text-[#5636D9] bg-[#f0edff] px-2.5 py-1 rounded-lg shrink-0">
                            {item.compatibility ?? 50}% match
                          </span>
                        </div>
                        <p className="text-xs text-[#5D6472] truncate">{item.organismo || 'Organismo no informado'}</p>
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          <StatusBadge state={item.codigo_estado} />
                          <span className="text-[#8A92A6]">Cierre: {dateFmt(item.fecha_cierre)}</span>
                          <span className="font-semibold text-[#171A24]">{money(item.monto_estimado, item.moneda)}</span>
                        </div>
                        {item.matchReasons?.length > 0 && (
                          <p className="text-[11px] text-[#5636D9] bg-[#f0edff]/40 p-2 rounded-lg">
                            {item.matchReasons.join(' · ')}
                          </p>
                        )}
                      </div>

                      <div className="pt-3 border-t border-[#E1E4EA] flex items-center justify-between">
                        <button
                          onClick={() => void saveOpportunity(item.codigo_externo)}
                          className="text-xs text-[#5D6472] hover:text-[#5636D9] font-medium"
                        >
                          + Guardar en seguimiento
                        </button>
                        <button
                          onClick={() => void openDetail(item.codigo_externo)}
                          className="h-8 px-3 bg-[#5636D9] hover:bg-[#4b2ec7] text-white text-xs font-semibold rounded-lg flex items-center gap-1"
                        >
                          Ver ficha <ArrowRight size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Pagination */}
              {searchResults?.pages > 1 && (
                <div className="flex items-center justify-between text-xs text-[#5D6472] pt-3">
                  <span>Página {page} de {searchResults.pages}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={page <= 1 || searchLoading}
                      onClick={() => void runSearch(search, page - 1)}
                      className="px-3 py-1.5 rounded-lg border border-[#E1E4EA] bg-white hover:bg-gray-50 disabled:opacity-50"
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      disabled={page >= searchResults.pages || searchLoading}
                      onClick={() => void runSearch(search, page + 1)}
                      className="px-3 py-1.5 rounded-lg border border-[#E1E4EA] bg-white hover:bg-gray-50 disabled:opacity-50"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {section === 'Oportunidades' && (
            <div className="space-y-6">
              <header>
                <h1 className="text-2xl sm:text-3xl font-bold text-[#171A24] tracking-tight">Oportunidades</h1>
                <p className="text-sm text-[#5D6472] mt-1">Revisa las licitaciones que coinciden con el catálogo de tu empresa.</p>
              </header>
              <CompanyOpportunities
                key={auth.activeCompanyId}
                board
                onConfigure={() => goToSection('Mi empresa')}
                onOpenListing={(code) => void openDetail(code)}
              />
            </div>
          )}

          {section === 'Agentes IA' && (
            <CommercialAgents
              companyName={auth.memberships.find((membership) => membership.companyId === auth.activeCompanyId)?.companyName ?? 'tu empresa'}
              onConfigure={() => goToSection('Mi empresa')}
              onAnalyzeListing={(code) => { void openDetail(code); void analyzeListing(code); }}
            />
          )}

          {/* SECTION: INTELIGENCIA DE MERCADO (Stitch 4) */}
          {section === 'Inteligencia de mercado' && (
            <MarketAnalytics
              summary={summary}
              health={health}
              error={error}
              onOpenListing={(code) => void openDetail(code)}
              onViewListings={() => goToSection('Buscar oportunidades')}
              onOpenAnalytics={() => goToSection('Analítica')}
              onRetry={() => void refresh()}
            />
          )}

          {section === 'Analítica' && (
            <AnalyticsWorkspace
              key={auth.activeCompanyId}
              request={api}
              csrfToken={auth.csrfToken}
            />
          )}

          {/* SECTION: SEGUIMIENTO (Stitch 5) */}
          {(section === 'Seguimiento' || section === 'Calendario') && (
            <TrackingWorkspace
              key={`${auth.activeCompanyId}:${section}`}
              calendar={section === 'Calendario'}
              onOpen={(code) => void openDetail(code)}
              onChanged={() => void refreshAlertCounts()}
              csrfToken={auth.csrfToken}
            />
          )}

          {/* SECTION: ALERTAS & BUSQUEDAS GUARDADAS (Stitch 6) */}
          {section === 'Alertas' && (
            <AlertsPage
              items={alerts}
              filter={alertsFilter}
              onFilter={(val) => setAlertsFilter(val)}
              onRead={(id) => {
                void api(`/api/alerts/${id}/read`, { method: 'POST' }).then(() => {
                  setAlerts((curr) => alertsFilter === 'unread'
                    ? curr.filter((item) => item.id !== id)
                    : curr.map((item) => (item.id === id ? { ...item, readAt: new Date().toISOString() } : item)));
                  void refreshAlertCounts();
                });
              }}
              onDismiss={(id) => {
                void api(`/api/alerts/${id}/dismiss`, { method: 'POST' }).then(() => {
                  setAlerts((curr) => curr.filter((it) => it.id !== id));
                  void refreshAlertCounts();
                });
              }}
              onOpen={(item) => void openDetail(item.code)}
              loading={alertsLoading}
              error={alertsError}
              csrfToken={auth.csrfToken}
              canManageCompany={auth.role === 'admin'}
            />
          )}

          {/* SECTION: MI EMPRESA (Stitch 7 & 8) */}
          {section === 'Mi empresa' && (
            <CompanyWorkspace
              onSaved={() => void refresh()}
              csrfToken={auth.csrfToken}
              canEdit={auth.role === 'admin'}
              accessRole={auth.role}
            />
          )}

          {/* SECTION: EQUIPO Y ACCESOS (Stitch 7 RBAC) */}
          {section === 'Equipo y accesos' && (
            <CompanyTeamManagement role={auth.role} csrfToken={auth.csrfToken} />
          )}

          {section === 'Cuentas de usuario' && isPlatformAdmin && (
            <PlatformUsers csrfToken={auth.csrfToken} />
          )}

          {/* SECTION: CONFIGURACION GENERAL */}
          {section === 'Configuración' && (
            <div className="space-y-6">
              <div className="border-b border-[#E1E4EA] pb-3">
                <div className="text-[11px] font-bold text-[#5636D9] uppercase tracking-wider mb-1">
                  Operación del Servidor
                </div>
                <h1 className="text-2xl font-bold text-[#171A24]">Configuración de Sincronización</h1>
                <p className="text-xs text-[#5D6472] mt-0.5">
                  Gestión del recolector diario y conexión oficial a ChileCompra.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white rounded-xl border border-[#E1E4EA] p-5 shadow-sm space-y-3">
                  <h3 className="font-bold text-sm text-[#171A24] flex items-center gap-2">
                    <Clock3 size={17} className="text-[#5636D9]" /> Sincronizador Diario
                  </h3>
                  <div className="space-y-2 text-xs text-[#5D6472]">
                    <p>Horario de Chile: America/Santiago. Procesa las licitaciones por fecha.</p>
                    <div className="p-3 rounded-lg bg-[#F8F9FA] border border-[#E1E4EA] space-y-1">
                      <div className="flex justify-between">
                        <span>Última sincronización exitosa:</span>
                        <b className="text-[#171A24]">
                          {config?.ultimaFechaExitosa ? dateTimeFmt(config.ultimaFechaExitosa) : 'Sin fecha registrada'}
                        </b>
                      </div>
                      <div className="flex justify-between">
                        <span>Fechas pendientes:</span>
                        <b className="text-[#171A24]">{config?.dailySync?.pendingDays ?? 0}</b>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-[#E1E4EA] p-5 shadow-sm space-y-3">
                  <h3 className="font-bold text-sm text-[#171A24] flex items-center gap-2">
                    <Database size={17} className="text-[#5636D9]" /> Base de Datos y API
                  </h3>
                  <div className="space-y-2 text-xs text-[#5D6472]">
                    <p>Las credenciales del ticket API de Mercado Público residen en el archivo .env del servidor.</p>
                    <div className="p-3 rounded-lg bg-[#F8F9FA] border border-[#E1E4EA] space-y-1">
                      <div className="flex justify-between">
                        <span>Conexión MySQL:</span>
                        <b className="text-[#5636D9]">Conectada</b>
                      </div>
                      <div className="flex justify-between">
                        <span>Ticket API Mercado Público:</span>
                        <b className={health?.apiConfigured ? 'text-[#5636D9]' : 'text-amber-700'}>
                          {health?.apiConfigured ? 'Válido' : 'Requiere ticket en .env'}
                        </b>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION: CENTRO DE PRUEBAS (Isolated Sandbox, Stitch screen) */}
          {section === 'Centro de Pruebas' && isPlatformAdmin && (
            <SandboxCenter onBackToApp={() => goToSection('Resumen')} />
          )}
        </main>
      </div>

      {/* Fixed Toast Banner */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 bg-[#171A24] text-white text-xs px-4 py-3 rounded-xl shadow-xl flex items-center gap-3">
          <span>{toast}</span>
          <button onClick={() => setToast('')} className="text-gray-400 hover:text-white">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Listing Detail Drawer/Modal */}
      {selected && (
        <ListingDetailModal
          listing={selected}
          companyId={auth.activeCompanyId ?? 0}
          userId={auth.userId}
          csrfToken={auth.csrfToken}
          loading={detailLoading}
          saved={selectedSaved}
          saving={detailSaving}
          onAnalyze={() => void analyzeListing(selected.CodigoExterno)}
          onSave={() => {
            setDetailSaving(true);
            void saveOpportunity(selected.CodigoExterno).finally(() => setDetailSaving(false));
          }}
          analysis={analysis}
          analysisLoading={analysisLoading}
          onGoToCompany={() => goToSection('Mi empresa')}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}

export default App;
