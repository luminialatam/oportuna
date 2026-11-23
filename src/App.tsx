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
  'AnalÃ­tica': '/inteligencia-mercado/analitica',
  Seguimiento: '/seguimiento',
  Calendario: '/calendario',
  Alertas: '/alertas',
  'Mi empresa': '/empresa',
  'Equipo y accesos': '/equipo',
  'Cuentas de usuario': '/usuarios',
  ConfiguraciÃ³n: '/configuracion',
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
    ? 'â€”'
    : new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: currency || 'CLP',
        maximumFractionDigits: 0,
      }).format(Number(value));

const dateFmt = (value?: string | null) => {
  if (!value) return 'â€”';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'â€”'
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
    : 'â€”';

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
    ['ProhibiciÃ³n de contrataciÃ³n', listing.ProhibicionContratacion],
    ['SubcontrataciÃ³n', listing.SubContratacion],
    ['Toma de razÃ³n', listing.TomaRazon],
    ['Renovable', listing.EsRenovable],
    ['DuraciÃ³n del contrato', listing.TipoDuracionContrato],
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
    LR: '10.000 UTM o mÃ¡s',
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
              {listing.Nombre || listing.nombre || listing.CodigoExterno || 'LicitaciÃ³n'}
            </h2>
            <div className="flex items-center gap-2 flex-wrap text-xs text-[#5D6472]">
              <span className="font-mono font-semibold text-[#171A24]">{listing.CodigoExterno}</span>
              <span>â€¢</span>
              <span className="truncate max-w-xs">{buyer.NombreOrganismo || listing.organismo || listing.NombreOrganismo || listing.OrganismoComprador || 'Organismo no informado'}</span>
              <span>â€¢</span>
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
              Cargando informaciÃ³n oficialâ€¦
            </div>
          ) : (
            <>
              {listing._source !== 'mercadopublico' && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                  No se pudo cargar el detalle oficial desde Mercado PÃºblico. Se muestran los datos resumidos guardados en Oportuna.
                  {listing._detailError ? <span className="block mt-1 text-amber-800">{listing._detailError}</span> : null}
                </div>
              )}
              {tab === 'resumen' && (
            <div className="space-y-5 text-xs">
              <div className="p-4 rounded-xl bg-[#F8F9FA] border border-[#E1E4EA] space-y-2">
                <span className="font-bold text-[#5D6472] uppercase text-[10px] tracking-wider">
                  DescripciÃ³n Oficial
                </span>
                <p className="text-[#171A24] leading-relaxed text-xs">
                  {listing.Descripcion || 'Mercado PÃºblico no informÃ³ una descripciÃ³n para esta licitaciÃ³n.'}
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
                    <span className="text-[#8A92A6] block">RegiÃ³n</span>
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
                    {item.Categoria && <span className="text-[10px] text-[#8A92A6] block">CategorÃ­a: {item.Categoria}</span>}
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-[#8A92A6] border border-dashed border-[#E1E4EA] rounded-xl">
                  Mercado PÃºblico no informÃ³ partidas para esta licitaciÃ³n.
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
                  <p className="text-[#8A92A6]">Las bases y anexos deben consultarse directamente en Mercado PÃºblico.</p>
                )}
              </div>
            </div>
          )}

          {tab === 'cronograma' && (
            <div className="space-y-4 text-xs">
              <h4 className="font-bold text-[#171A24]">Hitos CrÃ­ticos del Proceso</h4>
              <div className="space-y-3 relative pl-4 border-l-2 border-[#5636D9]/30">
                {[
                  { label: 'Fecha de PublicaciÃ³n', val: dates.FechaPublicacion },
                  { label: 'Fecha de Inicio', val: dates.FechaInicio },
                  { label: 'Fecha de Cierre (LÃ­mite de Ofertas)', val: dates.FechaCierre ?? listing.FechaCierre, urgent: true },
                  { label: 'Fecha Estimada de AdjudicaciÃ³n', val: dates.FechaEstimadaAdjudicacion },
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
                  <p className="text-[#5D6472]">Cruza el catÃ¡logo con la ficha disponible y propone el siguiente paso comercial.</p>
                </div>
                <button
                  onClick={onAnalyze}
                  disabled={analysisLoading}
                  className="h-8 px-3 bg-[#5636D9] hover:bg-[#4b2ec7] text-white font-semibold rounded-lg flex items-center gap-1.5"
                >
                  {analysisLoading ? <LoaderCircle size={13} className="spin" /> : <Sparkles size={13} />}
                  {analysisLoading ? 'Evaluandoâ€¦' : 'Evaluar oportunidad'}
                </button>
              </div>

              {analysisLoading ? (
                <div className="p-8 text-center text-[#5D6472] bg-[#F8F9FA] rounded-xl border border-[#E1E4EA]">
                  <LoaderCircle size={20} className="spin mx-auto text-[#5636D9] mb-2" />
                  Revisando coincidencia del catÃ¡logo, plazo y datos disponiblesâ€¦
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
                      <b className="text-xl text-[#5636D9] font-bold">{analysis.commercialRelevance?.score ?? 'â€”'}{analysis.commercialRelevance?.score != null ? ' / 100' : ''}</b>
                      <small className="text-[#5D6472] block mt-0.5">
                        {relevanceLabels[relevanceLevel] ?? (relevanceLevel || 'No evaluado')} Â· no es probabilidad de adjudicaciÃ³n
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
                        <h5 className="font-bold text-[#171A24]">DecisiÃ³n comercial sugerida</h5>
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
                        <small className="rounded-full bg-[#F2F0FF] px-2 py-1 text-[#5636D9]">{analysis.provider === 'groq' ? 'Redactado con IA' : 'Resumen local automÃ¡tico'}</small>
                      </div>
                      <p className="text-[#5D6472] leading-relaxed">{analysis.interpretation.executiveSummary}</p>
                    </div>
                  )}

                  <div className="rounded-lg border border-[#E1E4EA] bg-white px-3.5 py-3 text-[#5D6472] leading-relaxed">
                    El puntaje proviene de reglas de coincidencia entre el catÃ¡logo y el texto de la ficha. El resumen puede usar IA generativa; las bases y anexos no se consideran revisados por Oportuna.
                  </div>

                  {(analysis.interpretation?.technicalNotes?.length > 0 || analysis.interpretation?.administrativeNotes?.length > 0) && (
                    <details className="rounded-lg border border-[#E1E4EA] bg-white p-3.5">
                      <summary className="cursor-pointer font-bold text-[#171A24]">Notas tÃ©cnicas y administrativas de la ficha</summary>
                      {analysis.interpretation?.technicalNotes?.length > 0 && <div className="mt-3"><strong>Aspectos tÃ©cnicos</strong><ul className="mt-1 list-disc space-y-1 pl-4 text-[#5D6472]">{analysis.interpretation.technicalNotes.map((note: string, idx: number) => <li key={`t-${idx}`}>{note}</li>)}</ul></div>}
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
                  EvalÃºa el encaje con el catÃ¡logo, los datos de la ficha y quÃ© conviene revisar antes de cotizar.
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
            {saved ? 'Guardada en Seguimiento' : saving ? 'Guardandoâ€¦' : 'Guardar en Seguimiento'}
          </button>

          <a
            href={`https://www.mercadopublico.cl/fichaLicitacion.html?idLicitacion=${encodeURIComponent(listing.CodigoExterno || '')}`}
            target="_blank"
            rel="noreferrer"
            className="h-10 px-4 bg-[#5636D9] hover:bg-[#4b2ec7] text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors shadow-sm"
          >
            Ver en Mercado PÃºblico <ExternalLink size={14} />
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
    if (!routeSection || ((routeSection === 'Equipo y accesos' || routeSection === 'ConfiguraciÃ³n') && !isAdmin) || (routeSection === 'Cuentas de usuario' && !isPlatformAdmin)) {
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
            setSessionNotice(session.sessionExpired || hasStoredSessionMarker() ? 'Tu sesiÃ³n expirÃ³ o dejÃ³ de ser vÃ¡lida. Inicia sesiÃ³n nuevamente.' : '');
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
      setToast('No se pudo confirmar el cierre de sesiÃ³n. Comprueba la conexiÃ³n e intÃ©ntalo de nuevo.');
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
      if (section === 'ConfiguraciÃ³n' && auth?.activeCompanyId && isAdmin) {
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
            detailError: officialResult.error instanceof Error ? officialResult.error.message : 'No se pudo consultar Mercado PÃºblico; se muestran los datos locales disponibles.',
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
      setSelected({ error: e instanceof Error ? e.message : 'No se encontrÃ³ el detalle local.' });
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
    setAnalysiãßv¶‰Ëkºwµç[ÛÛXÚÏ^Ê
HOˆÙ][Øš[SÜ[ŠYJ_BˆÛ\ÜÓ˜[YOH›ÎšY[ˆLˆ^VÈÍQÌ—Hİ™\˜™ËYÜ˜^KLL›İ[™Y[È‚ˆ\šXK[X™[HXœš\ˆ˜]™YØXÚpìÛˆ‚ˆ‚ˆY[HÚ^™O^ÌNHÏ‚ˆØ]Û‚ˆ]ˆÛ\ÜÓ˜[YOH™›^][\ËXÙ[\ˆØ\Lˆ^^È^VÈÍQÌ—H‚ˆÜ[ˆÛ\ÜÓ˜[YOH™›ÛX›Û^VÈÌMÌPLH“ÜÜ[˜OÜÜ[‚ˆÜ[‹ÏÜÜ[‚ˆÜ[ˆÛ\ÜÓ˜[YOH™›Û\Ù[ZX›Û^VÈÍMŒÍ‘WHÜÙXİ[ÛŸOÜÜ[‚ˆÙ]‚ˆÙ]‚‚ˆ›Ü›HÛ\ÜÓ˜[YOHœİ[[X\K]Ü˜\‹\ÙX\˜ÚˆÛ”İX›Z]^Ø™YÚ[”İ[[X\TÙX\˜ÚH›ÛOHœÙX\˜Ú‚ˆÙX\˜ÚÚ^™O^ÌMßH\šXKZY[HYHˆÏ‚ˆ[œ]ˆYH™ÛØ˜[[ÜÜ[š]K\ÙX\˜Ú‚ˆ˜[YOH™ÛØ˜[ÙX\˜Ú‚ˆ\šXK[X™[H°îœÜ]YYHÛØ˜[HÜÜ[šYY\È‚ˆ˜[YO^ÜÙX\˜ÚBˆÛÚ[™ÙO^Ê]™[
HOˆÙ]ÙX\˜Ú
]™[\™Ù]˜[YJ_BˆXÙZÛ\H\ØØ\ˆXÚ]XÚ[Û™\ËÛÛ\˜\È0èYÚ[\ÈÈ[Xœ˜\ÈÛ]™x )ˆ‚ˆÏ‚ˆÙ›Ü›O‚‚ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\K]Ü˜\‹XXİ[ÛœÈ›^][\ËXÙ[\ˆØ\LÈ^^È‚ˆ]Û‚ˆ\OH˜]Ûˆ‚ˆÛÛXÚÏ^Ê
HOˆÛÕÔÙXİ[ÛŠ	Ğ\ØØ\ˆÜÜ[šYY\ÉÊ_Bˆ\šXK[X™[H\ØØ\ˆÜÜ[šYY\È‚ˆÛ\ÜÓ˜[YOHœİ[[X\K[[Øš[K\ÙX\˜ÚÎšY[ˆNËN›İ[™Y[È›Ü™\ˆ›Ü™\‹VÈÑLQMPWH^VÈÍQÌ—Hİ™\˜™ËVÈÑQWH›^][\ËXÙ[\ˆ\İYKXÙ[\ˆ‚ˆ‚ˆÙX\˜ÚÚ^™O^ÌMŸHÏ‚ˆØ]Û‚ˆÜ[ˆÛ\ÜÓ˜[YOHœİ[[X\K]Ü˜\‹Y]HY[ˆ™›^][\ËXÙ[\ˆØ\LKH^VÈÍQÌ—H™ËVÈÑQWHLÈKLH›İ[™YY[›Ü™\ˆ›Ü™\‹VÈÑLQMPWH‚ˆÛØÚÌÈÚ^™O^ÌLßHÛ\ÜÓ˜[YOH^VÈÎNLM—HˆÏ‚ˆİÙ^SX™[BˆÜÜ[‚‚ˆØ]]›Y[X™\œÚ\Ë›[™İˆH	‰ˆ
ˆÙ[Xİˆ\šXK[X™[H‘[\™\ØHXİ]˜H‚ˆ˜[YO^Ø]]˜Xİ]™PÛÛ\[RYÏÈ	ÉßBˆÛÚ[™ÙO^ÊJHOˆ›ÚYÚ[™ÙPÛÛ\[J[X™\ŠK\™Ù]˜[YJJ_BˆÛ\ÜÓ˜[YOHšY[ˆÛN˜›ØÚÈNËLMˆZ[‹]ËLLH›İ[™Y[È›Ü™\ˆ›Ü™\‹VÈÑLQMPWH^^È^VÈÌMÌPLH™Ë]Ú]HÛNËX]]ÈÛN›X^]ËVÌMŒH‚ˆ‚ˆØ]]›Y[X™\œÚ\Ë›X\

JHOˆ
ˆÜ[ÛˆÙ^O^ÛK˜ÛÛ\[RYH˜[YO^ÛK˜ÛÛ\[RYO‚ˆÛK˜ÛÛ\[S˜[Y_BˆÛÜ[Û‚ˆ
J_BˆÜÙ[Xİ‚ˆ
_B‚ˆ]Û‚ˆÛÛXÚÏ^Ê
HOˆ›ÚYXØÙ\[š]][Û”›Û\

_Bˆ\OH˜]Ûˆ‚ˆ\šXK[X™[HXÙ\\ˆ[š]XÚpìÛˆ‚ˆ]OHXÙ\\ˆ[š]XÚpìÛˆ‚ˆÛ\ÜÓ˜[YOHšY[ˆY™›^ËN][\ËXÙ[\ˆ\İYKXÙ[\ˆØ\LKHNL›İ[™Y[È›Ü™\ˆ›Ü™\‹VÈÑLQMPWH^VÈÍQÌ—Hİ™\˜™ËVÈÑQWH˜[œÚ][Û‹XÛÛÜœÈËX]]ÈœLÈ‚ˆ‚ˆXZ[\ÈÚ^™O^ÌMHÏ‚ˆÜ[ˆÛ\ÜÓ˜[YOHšY[ˆš[›[™HXÙ\\ˆ[š]XÚpìÛÜÜ[‚ˆØ]Û‚‚ˆËÊˆ›İYšXØ][Ûˆ™[
‹ßBˆ[\›İYšXØ][Û”[™[ˆ][\Ï^Ø[\ßBˆ[œ™XY^Ø[\Ûİ[Ë[œ™XYBˆÜ[^Ø[\ÓÜ[ŸBˆØY[™Ï^Ø[\ÓØY[™ßBˆ\œ›Ü^Ø[\Ñ\œ›ÜŸBˆÛ•ÙÙÛO^Ê
HOˆÂˆÛÛœİ™^HX[\ÓÜ[ÂˆÙ][\ÓÜ[Š™^
NÂˆYˆ
™^
H›ÚYØY[\Ê	Ø[	ÊNÂˆ_BˆÛ“˜]šYØ]O^Ê
HOˆÂˆÙ][\ÓÜ[Š˜[ÙJNÂˆÙ][\Ñš[\Š	Ø[	ÊNÂˆÛÕÔÙXİ[ÛŠ	Ğ[\\ÉÊNÂˆ_BˆÛ”™XY^ÊY
HOˆÂˆ›ÚY\JØ\KØ[\ËÉÚYKÜ™XYÈY]Ùˆ	ÔÔÕ	ÈJK[Š

HOˆÂˆÙ][\Ê
İ\œŠHOˆ[\Ñš[\ˆOOH	İ[œ™XY	ÂˆÈİ\œ‹™š[\Š
][JHOˆ][KšYOOHY
Bˆˆİ\œ‹›X\

][JHOˆ
][KšYOOHYÈÈ‹‹š][K™XY]ˆ™]È]J
KÒTÓÔİš[™Ê
HHˆ][JJJNÂˆ›ÚY™Yœ™\Ú[\Ûİ[Ê
NÂˆJNÂˆ_BˆÛ‘\ÛZ\ÜÏ^ÊY
HOˆÂˆ›ÚY\JØ\KØ[\ËÉÚYKÙ\ÛZ\ÜØÈY]Ùˆ	ÔÔÕ	ÈJK[Š

HOˆÂˆÙ][\Ê
İ\œŠHOˆİ\œ‹™š[\Š
]
HOˆ]šYOOHY
JNÂˆ›ÚY™Yœ™\Ú[\Ûİ[Ê
NÂˆJNÂˆ_BˆÛ“Ü[^Ê][JHOˆÂˆÙ][\ÓÜ[Š˜[ÙJNÂˆ›ÚYÜ[‘]Z[
][K˜ÛÙJNÂˆ_BˆÏ‚ˆ]ˆÛ\ÜÓ˜[YOHœ›Ùš[K[Y[K]Ü˜\™[]]™HY[ˆÎ˜›ØÚÈ‚ˆ]Û‚ˆ\OH˜]Ûˆ‚ˆÛ\ÜÓ˜[YOHœİ[[X\K]Ü˜\‹\›Ùš[H›^][\ËXÙ[\ˆØ\Lˆ›İ[™Y^LˆKLHİ™\˜™ËVÈÑQWH‚ˆ\šXKZ\ÜÜ\H›Y[H‚ˆ\šXKY^[™Y^İ\Ù\“Y[SÜ[ŸBˆ\šXKXÛÛ›ÛÏH˜XØÛİ[\›Ùš[K[Y[H‚ˆÛÛXÚÏ^Ê
HOˆÙ]\Ù\“Y[SÜ[Š
Ü[ŠHOˆ[Ü[Š_Bˆ‚ˆÜ[ˆÛ\ÜÓ˜[YOHœİ[[X\K]Ü˜\‹X]˜]\ˆ‚ˆØ]]™š\œİ˜[YHÈ]]™š\œİ˜[YVÌKÕ\\Ø\ÙJ
Hˆ]]™[XZ[ÌKÕ\\Ø\ÙJ
_BˆÜÜ[‚ˆÜ[ˆÛ\ÜÓ˜[YOH›Z[‹]ËL‚ˆÙÜ™Y][™Ó˜[Y_OØ‚ˆÛX[Ø]]œ›ÛHOOH	ØYZ[‰ÈÈ	ĞYZ[š\İ˜YÜ‰Èˆ	ĞÛÛX›Ü˜YÜ‰ßOÜÛX[‚ˆÜÜ[‚ˆØ]Û‚ˆİ\Ù\“Y[SÜ[ˆ	‰ˆ
ˆ]ˆYH˜XØÛİ[\›Ùš[K[Y[Hˆ›ÛOH›Y[Hˆ\šXK[X™[H“Y[°îˆH\™š[ˆÛ\ÜÓ˜[YOHœ›Ùš[K[Y[HXœÛÛ]HšYÚLÜY[‹ML]LˆËMŒ›İ[™Y^›Ü™\ˆ›Ü™\‹VÈÑLQMPWH™Ë]Ú]HLˆÚYİË[È‚ˆ]ˆÛ\ÜÓ˜[YOHœLÈKLˆ‚ˆˆÛ\ÜÓ˜[YOH˜›ØÚÈ[˜Ø]H^^È^VÈÌMÌPLHÙÜ™Y][™Ó˜[Y_OØ‚ˆÜ[ˆÛ\ÜÓ˜[YOH˜›ØÚÈ[˜Ø]H^^È^VÈÎNLM—HØ]]™[XZ[OÜÜ[‚ˆÙ]‚ˆ]Û‚ˆ\OH˜]Ûˆ‚ˆ›ÛOH›Y[Z][H‚ˆÛÛXÚÏ^Ê
HOˆÈÙ]\Ù\“Y[SÜ[Š˜[ÙJNÈÛÕÔÙXİ[ÛŠ	ÓZH\™š[	ÊNÈ_BˆÛ\ÜÓ˜[YOH™›^NHËY[][\ËXÙ[\ˆØ\Lˆ›İ[™Y[ÈLÈ^[Y^^È›Û\Ù[ZX›Û^VÈÍQÌ—Hİ™\˜™ËVÈÑQWH‚ˆ‚ˆ\Ù\”›İ[™Ú^™O^ÌM_HÏˆZH\™š[ˆØ]Û‚ˆ]Û‚ˆ\OH˜]Ûˆ‚ˆ›ÛOH›Y[Z][H‚ˆÛÛXÚÏ^Ê
HOˆÈÙ]\Ù\“Y[SÜ[Š˜[ÙJNÈÛÕÔÙXİ[ÛŠ	ÔÙYİ\šYY	ÊNÈ_BˆÛ\ÜÓ˜[YOH™›^NHËY[][\ËXÙ[\ˆØ\Lˆ›İ[™Y[ÈLÈ^[Y^^È›Û\Ù[ZX›Û^VÈÍQÌ—Hİ™\˜™ËVÈÑQWH‚ˆ‚ˆÚY[Ú^™O^ÌM_HÏˆÙYİ\šYYˆØ]Û‚ˆ]Û‚ˆ\OH˜]Ûˆ‚ˆ›ÛOH›Y[Z][H‚ˆÛÛXÚÏ^Ê
HOˆÈÙ]\Ù\“Y[SÜ[Š˜[ÙJNÈ›ÚYÚYÛ“İ]

NÈ_BˆÛ\ÜÓ˜[YOH™›^NHËY[][\ËXÙ[\ˆØ\Lˆ›İ[™Y[ÈLÈ^[Y^^È›Û\Ù[ZX›Û^VÈÍQÌ—Hİ™\˜™ËVÈÑQWH‚ˆ‚ˆÙÓİ]Ú^™O^ÌM_HÏˆÙ\œ˜\ˆÙ\ÚpìÛ‚ˆØ]Û‚ˆÙ]‚ˆ
_BˆÙ]‚ˆÙ]‚ˆÚXY\‚‚ˆËÊˆ“ÑHÓÓ•RS‘Tˆ
‹ßBˆXZ[ˆÛ\ÜÓ˜[YOH›Z[‹]ËL›^LHMÛNœNX^]ËMŞËY[^X]]ÈÜXÙK^KMˆ‚ˆËÊˆÑPÕSÓˆ‘TÕSQSˆ
İ]ÚØÜ™Y[ˆJH
‹ßBˆÜÙXİ[ÛˆOOH	ÓZH\™š[	È	‰ˆ
ˆ›Ùš[TYÙBˆÙ\ÜÚ[Û^Ø]]BˆÛ”›Ùš[U\]Y^ÊšY[ÊHOˆÙ]]]

İ\œ™[
HOˆİ\œ™[ÈÈ‹‹˜İ\œ™[‹‹™šY[ÈHˆİ\œ™[
_BˆÛ“˜]šYØ]TÙXİ\š]O^Ê
HOˆÛÕÔÙXİ[ÛŠ	ÔÙYİ\šYY	Ê_BˆÏ‚ˆ
_BˆÜÙXİ[ÛˆOOH	ÔÙYİ\šYY	È	‰ˆÙXİ\š]TYÙHÙ\ÜÚ[Û^Ø]]HÏŸB‚ˆÜÙXİ[ÛˆOOH	Ô™\İ[Y[‰È	‰ˆ
ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\K\YÙHÜXÙK^KMˆ‚ˆÙXİ[ÛˆÛ\ÜÓ˜[YOHœİ[[X\K]Ù[ÛÛYH›^›^XÛÛÛN™›^\›İÈÛNš][\ËY[™\İYKX™]ÙY[ˆØ\M‚ˆ]ˆÛ\ÜÓ˜[YOH›Z[‹]ËL‚ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\KXÛÛ^›^›^]Ü˜\][\ËXÙ[\ˆØ\LˆX‹Lˆ‚ˆÜ[ˆÛ\ÜÓ˜[YOHœİ[[X\KXÛÛ\[KXÚ\‚ˆZ[[™ÌˆÚ^™O^ÌMHÏ‚ˆØ]]›Y[X™\œÚ\Ë™š[™

Y[X™\œÚ\
HOˆY[X™\œÚ\˜ÛÛ\[RYOOH]]˜Xİ]™PÛÛ\[RY
OË˜ÛÛ\[S˜[YH	Ñ[\™\ØHXİ]˜IßBˆÜÜ[‚ˆÜ[ˆÛ\ÜÓ˜[YOHœİ[[X\KY]KXÚ\ÛØÚÌÈÚ^™O^ÌLßHÏˆİÙ^SX™[OÜÜ[‚ˆÙ]‚ˆHÛ\ÜÓ˜[YOH^LÛN^LŞ›ÛX›Û^VÈÌMÌPLH˜XÚÚ[™Ë]YÚ›^][\ËXÙ[\ˆØ\Lˆ‚ˆY[›ÜÈ0ëX\ËÙÜ™Y][™Ó˜[Y_BˆÜ[ˆ›ÛOHš[YÈˆ\šXK[X™[HœØ[YÈˆÛ\ÜÓ˜[YOH^LÙ[Xİ[›Û™H¼'äbÏÜÜ[‚ˆÚO‚ˆÛ\ÜÓ˜[YOH^\ÛH^VÈÍQÌ—H]LH‚ˆ\]pëHY[™\È[\İYÈH\ÈXÚ]XÚ[Û™\È[™^Y\ÈH\ÈÛÚ[˜ÚY[˜ÚX\È\˜HH[\™\ØK‚ˆÜ‚ˆÙ]‚ˆÚ\ĞYZ[ˆ	‰ˆ
ˆ]Û‚ˆÛÛXÚÏ^Ê
HOˆÛÕÔÙXİ[ÛŠ	ĞÛÛ™šYİ\˜XÚpìÛ‰Ê_BˆÛ\ÜÓ˜[YOHœİ[[X\KXÛÛ™šYË[[šÈÚš[šËL‚ˆ‚ˆÙ][™ÜÈÚ^™O^ÌM_HÏˆÙ\İ[Û˜\ˆ[YÜ˜XÚ[Û™\ÂˆØ]Û‚ˆ
_BˆÜÙXİ[Û‚‚ˆÙXİ[ÛˆÛ\ÜÓ˜[YOHœİ[[X\K[Y]šXËYÜšYÜšYÜšYXÛÛËLHÛN™ÜšYXÛÛËLˆ™ÜšYXÛÛËMØ\Mˆ\šXK[X™[H“pê]šXØ\È[0ë[™XÙH‚ˆ\XÛHÛ\ÜÓ˜[YOHœİ[[X\K[Y]šXËXØ\™‚ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\K[Y]šXË]ÜÜ[ˆÛ\ÜÓ˜[YOHœİ[[X\K[Y]šXËZXÛÛˆ]X˜\ÙHÚ^™O^ÌNHÏÜÜ[Ü[ˆÛ\ÜÓ˜[YOHœİ[[X\K[Y]šXË]YÈ°ã[™XÙHØØ[ÜÜ[Ù]‚ˆİ›Û™ÏÜİ[[X\HÈİ[[X\Kİ[ÓØØ[Tİš[™Ê	Ù\ËPÓ	ÊHˆ	ø %	ßOÜİ›Û™Ï‚ˆÜ[“XÚ]XÚ[Û™\È™YÚ\İ˜Y\ÏÜÜ[‚ˆØ\XÛO‚ˆ\XÛHÛ\ÜÓ˜[YOHœİ[[X\K[Y]šXËXØ\™‚ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\K[Y]šXË]ÜÜ[ˆÛ\ÜÓ˜[YOHœİ[[X\K[Y]šXËZXÛÛˆXİ]š]HÚ^™O^ÌNHÏÜÜ[Ü[ˆÛ\ÜÓ˜[YOHœİ[[X\K[Y]šXË]YÈ”X›XØYOÜÜ[Ù]‚ˆİ›Û™ÏÜİ[[X\OË™\İYÜÏË™š[™

İ]JHOˆİ]K˜ÛÙYÛÑ\İYÈOOHJOËİ[ÓØØ[Tİš[™Ê	Ù\ËPÓ	ÊHÏÈ	ø %	ßOÜİ›Û™Ï‚ˆÜ[‘[ˆ[0ë[™XÙHØØ[ÜÜ[‚ˆØ\XÛO‚ˆ\XÛHÛ\ÜÓ˜[YOHœİ[[X\K[Y]šXËXØ\™‚ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\K[Y]šXË]ÜÜ[ˆÛ\ÜÓ˜[YOHœİ[[X\K[Y]šXËZXÛÛˆÜ\šÛ\ÈÚ^™O^ÌNHÏÜÜ[Ü[ˆÛ\ÜÓ˜[YOHœİ[[X\K[Y]šXË]YÈ°æ›[XHZ™XİXÚpìÛÜÜ[Ù]‚ˆİ›Û™ÏÜİ[[X\OË[[XTÚ[˜Ü›Ûš^˜XÚ[ÛËİ[[œÙ\YÜÏËÓØØ[Tİš[™Ê	Ù\ËPÓ	ÊHÏÈ	ø %	ßOÜİ›Û™Ï‚ˆÜ[”™YÚ\İ›ÜÈ[˜ÛÜœÜ˜YÜÏÜÜ[‚ˆØ\XÛO‚ˆ\XÛHÛ\ÜÓ˜[YOHœİ[[X\K[Y]šXËXØ\™‚ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\K[Y]šXË]ÜÜ[ˆÛ\ÜÓ˜[YOHœİ[[X\K[Y]šXËZXÛÛˆÛØÚÌÈÚ^™O^ÌNHÏÜÜ[Ü[ˆÛ\ÜÓ˜[YOHœİ[[X\K[Y]šXË]YÈÚ[PÛÛ\˜OÜÜ[Ù]‚ˆİ›Û™ÈÛ\ÜÓ˜[YOHœİ[[X\K[Y]šXËY]HÜİ[[X\OË[[XTÚ[˜Ü›Ûš^˜XÚ[ÛË™™XÚPÛÛœİ[YHÈ]Q›]
İ[[X\K[[XTÚ[˜Ü›Ûš^˜XÚ[Û‹™™XÚPÛÛœİ[YJHˆ	ø %	ßOÜİ›Û™Ï‚ˆÜ[°æ›[[È\°ë[ÙÈÛÛœİ[YÏÜÜ[‚ˆØ\XÛO‚ˆÜÙXİ[Û‚‚ˆÙXİ[ÛˆÛ\ÜÓ˜[YOHœİ[[X\K\ÙX\˜ÚY™X]\™H‚ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\K\ÙX\˜ÚXÛÜH‚ˆÜ[ˆÛ\ÜÓ˜[YOHœİ[[X\K\ÙX\˜ÚY^YXœ›İÈÜ\šÛ\ÈÚ^™O^ÌMHÏˆ°îœÜ]YYH[ˆY\˜ØYÈ0î˜›XÛÏÜÜ[‚ˆ‘[˜İY[˜HÜÜ[šYY\È\˜HH™YÛØÚ[ÏÚ‚ˆ\ØØHXÚ]XÚ[Û™\ÈHÛÛ\˜\È0èYÚ[\ÈÛÛˆÜÈš[›ÜÈHÜš]\š[ÜÈ\ÜÛšX›\È[ˆÜÜ[˜KÜ‚ˆÙ]‚ˆ›Ü›HÛ\ÜÓ˜[YOHœİ[[X\KY™X]\™K\ÙX\˜ÚˆÛ”İX›Z]^Ø™YÚ[”İ[[X\TÙX\˜ÚH›ÛOHœÙX\˜Ú‚ˆÙX\˜ÚÚ^™O^ÌNH\šXKZY[HYHˆÏ‚ˆ[œ]ˆ\šXK[X™[H\ØØ\ˆXÚ]XÚ[Û™\È‚ˆ˜[YO^ÜÙX\˜ÚBˆÛÚ[™ÙO^Ê]™[
HOˆÙ]ÙX\˜Ú
]™[\™Ù]˜[YJ_BˆXÙZÛ\H‘\ØÜšX™H]pêHÙœ™XÙHH[\™\Øx )ˆ‚ˆÏ‚ˆ]Ûˆ\OHœİX›Z]ÙX\˜ÚÚ^™O^ÌM_HÏˆ\ØØ\ˆXÚ]XÚ[Û™\ÏØ]Û‚ˆÙ›Ü›O‚ˆÜÙXİ[Û‚‚ˆÙXİ[ÛˆÛ\ÜÓ˜[YOHœİ[[X\KZ[œÚYÚYÜšYÜšYÜšYXÛÛËLH™ÜšYXÛÛËLLˆØ\MH‚ˆ\XÛHÛ\ÜÓ˜[YOHœİ[[X\KXXİ]š]K\[™[˜ÛÛ\Ü[‹MH‚ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\K\ÙXİ[Û‹ZXY[™È‚ˆ]‚ˆXİ]šYY™XÚY[OÚ‚ˆ”Ú[˜Ü›Ûš^˜XÚ[Û™\ÈH™YÚ\İ›ÜÈpè\È™XÚY[\È[0ë[™XÙHØØ[Ü‚ˆÙ]‚ˆ]ÛˆÛÛXÚÏ^Ê
HOˆÛÕÔÙXİ[ÛŠ	Ğ\ØØ\ˆÜÜ[šYY\ÉÊ_HÛ\ÜÓ˜[YOHœİ[[X\K]^[[šÈ•™\ˆXÚ]XÚ[Û™\È\œ›İÔšYÚÚ^™O^ÌMHÏØ]Û‚ˆÙ]‚ˆÜİ[[X\OË[[XTÚ[˜Ü›Ûš^˜XÚ[ÛˆÈ
ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\K\Ş[˜ËXØ\™‚ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\K\Ş[˜ËZXÛÛˆ]X˜\ÙHÚ^™O^ÌMßHÏÙ]‚ˆ]ˆÛ\ÜÓ˜[YOH›Z[‹]ËL›^LH‚ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\K\Ş[˜Ë]]K\›İÈ‚ˆİ›Û™Ï°æ›[XHÚ[˜Ü›Ûš^˜XÚpìÛÜİ›Û™Ï‚ˆÜ[ˆÛ\ÜÓ˜[YO^Øİ[[X\K\[‹\İ]\È	Üİ[[X\K[[XTÚ[˜Ü›Ûš^˜XÚ[Û‹™\İYÈOOH	ØÛÛ\]YIÈÈ	Ú\ËXÛÛ\]IÈˆ	Ú\Ë\[™[™ÉßXO‚ˆÜİ[[X\K[[XTÚ[˜Ü›Ûš^˜XÚ[Û‹™\İYÈ	ÔÚ[ˆ\İYÉßBˆÜÜ[‚ˆÙ]‚ˆÜ[Üİ[[X\K[[XTÚ[˜Ü›Ûš^˜XÚ[Û‹œİ\Y]È]U[YQ›]
İ[[X\K[[XTÚ[˜Ü›Ûš^˜XÚ[Û‹œİ\Y]
Hˆ	Ñ™XÚH›È\ÜÛšX›IßOÜÜ[‚ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\K\Ş[˜Ë\İ]È‚ˆÜ[Üİ[[X\K[[XTÚ[˜Ü›Ûš^˜XÚ[Û‹İ[™XÚXšYÜÈÏÈ	ø %	ßOØˆ™XÚXšYÜÏÜÜ[‚ˆÜ[Üİ[[X\K[[XTÚ[˜Ü›Ûš^˜XÚ[Û‹İ[[œÙ\YÜÈÏÈ	ø %	ßOØˆ[˜ÛÜœÜ˜YÜÏÜÜ[‚ˆÜ[Üİ[[X\K[[XTÚ[˜Ü›Ûš^˜XÚ[Û‹İ[XİX[^˜YÜÈÏÈ	ø %	ßOØˆXİX[^˜YÜÏÜÜ[‚ˆÙ]‚ˆÙ]‚ˆÙ]‚ˆ
Hˆ
ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\KY[\K\İ]Hpî›ˆ›È^HÚ[˜Ü›Ûš^˜XÚ[Û™\È™YÚ\İ˜Y\È\˜H[Üİ˜\‹Ù]‚ˆ
_Bˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\K\™XÙ[[\İ‚ˆÊİ[[X\OË[[X\ÓXÚ]XÚ[Û™\ÈÏÈ×JKœÛXÙJÊK›X\

][JHOˆ
ˆ]ÛˆÙ^O^Ú][K˜ÛÙYÛ×Ù^\››ßHÛÛXÚÏ^Ê
HOˆ›ÚYÜ[‘]Z[
][K˜ÛÙYÛ×Ù^\››Ê_HÛ\ÜÓ˜[YOHœİ[[X\K\™XÙ[Z][H‚ˆÜ[ˆÛ\ÜÓ˜[YOHœİ[[X\K\™XÙ[[X\šÙ\ˆš[TÙX\˜ÚÚ^™O^ÌM_HÏÜÜ[‚ˆÜ[ˆÛ\ÜÓ˜[YOHœİ[[X\K\™XÙ[XÛÜH‚ˆÚ][K››ÛXœ™H	Ó›ÛXœ™H›È\ÜÛšX›IßOØ‚ˆÛX[Ú][K˜ÛÙYÛ×Ù^\››ßH0­ÈÚ][K›Ü™Ø[š\Û[È	ÓÜ™Ø[š\Û[È›È[™›Ü›XYÉßOÜÛX[‚ˆÜÜ[‚ˆ\œ›İÔšYÚÚ^™O^ÌMHÛ\ÜÓ˜[YOHœİ[[X\K\™XÙ[X\œ›İÈˆÏ‚ˆØ]Û‚ˆ
J_BˆÈ\İ[[X\OË[[X\ÓXÚ]XÚ[Û™\ÏË›[™İ	‰ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\KY[\K\İ]H“›È^HXÚ]XÚ[Û™\È™XÚY[\È[ˆ[0ë[™XÙKÙ]ŸBˆÙ]‚ˆØ\XÛO‚‚ˆ\XÛHÛ\ÜÓ˜[YOHœİ[[X\KY]›Û][Û‹\[™[˜ÛÛ\Ü[‹MÈ‚ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\K\ÙXİ[Û‹ZXY[™È‚ˆ]‚ˆ‘]›ÛXÚpìÛˆHÜÜ[šYY\ÏÚ‚ˆ‘\İšXXÚpìÛˆXİX[Üˆ\İYÈ[ˆ[0ë[™XÙHØØ[Ü‚ˆÙ]‚ˆ]ÛˆÛÛXÚÏ^Ê
HOˆÛÕÔÙXİ[ÛŠ	Ò[[YÙ[˜ÚXHHY\˜ØYÉÊ_HÛ\ÜÓ˜[YOHœİ[[X\K]^[[šÈ•™\ˆ[˜[0ë]XØH\œ›İÔšYÚÚ^™O^ÌMHÏØ]Û‚ˆÙ]‚ˆÜİ[[X\OË™\İYÜÏË›[™İÈ
ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\K\İ]KXÚ\ˆ\šXK[X™[H“XÚ]XÚ[Û™\ÈXİX[\ÈÜˆ\İYÈ‚ˆÜİ[[X\K™\İYÜË›X\

İ]JHOˆÂˆÛÛœİ[›ÛZ[˜]ÜˆHİ[[X\K™\İYÜËœ™YXÙJ
İ[K[JHOˆİ[H
È[X™\Š[Kİ[
K
NÂˆÛÛœİÚ\™HH[›ÛZ[˜]ÜˆÈX]œ›İ[™

[X™\Šİ]Kİ[
HÈ[›ÛZ[˜]ÜŠH
ˆL
HˆÂˆÛÛœİX™[Hİ]K˜ÛÙYÛÑ\İYÈOH[È	ÔÚ[ˆ\İYÉÈˆİ]\Ó˜[Y\ÖÜİ]K˜ÛÙYÛÑ\İY×H\İYÈ	Üİ]K˜ÛÙYÛÑ\İYßXÂˆ™]\›ˆ
ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\K\İ]K\›İÈˆÙ^O^Üİ]K˜ÛÙYÛÑ\İYÈÏÈ	İ[šÛ›İÛ‰ßO‚ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\K\İ]K[X™[Ü[ÛX™[OÜÜ[Ó[X™\Šİ]Kİ[
KÓØØ[Tİš[™Ê	Ù\ËPÓ	Ê_OØÙ]‚ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\K\İ]K]˜XÚÈˆ›ÛOHš[YÈˆ\šXK[X™[^Ø	ÛX™[Nˆ	ÜÚ\™_IXOÜ[ˆİ[O^ŞÈÚYˆ	ÜÚ\™_IX_HÏÙ]‚ˆÙ]‚ˆ
NÂˆJ_BˆÙ]‚ˆ
Hˆ
ˆ]ˆÛ\ÜÓ˜[YOHœİ[[X\KY[\K\İ]H“›È^H\İšXXÚpìÛˆÜˆ\İYÈ\ÜÛšX›KÙ]‚ˆ
_BˆÛ\ÜÓ˜[YOHœİ[[X\KXÚ\[›İH‘\İHš\İH]Y\İ˜H[\İYÈXİX[ˆ[[™Ú[H™\İ[Y[ˆÙ]°ëXH›È[™YØH[˜HÙ\šYH\İ0ìÜšXØHÜˆY\ËÜ‚ˆØ\XÛO‚ˆÜÙXİ[Û‚‚ˆÛÛ\[SÜÜ[š]Y\ÂˆÛÛÛ™šYİ\™O^Ê
HOˆÛÕÔÙXİ[ÛŠ	ÓZH[\™\ØIÊ_BˆÛ“Ü[“\İ[™Ï^ÊÛÙJHOˆ›ÚYÜ[‘]Z[
ÛÙJ_BˆÛ•šY]Ğ[^Ê
HOˆÛÕÔÙXİ[ÛŠ	ÓÜÜ[šYY\ÉÊ_BˆÏ‚ˆÙ]‚ˆ
_B‚ˆËÊˆÑPÕSÓˆ•TĞĞTˆÔÔ•S’QQTÈ
İ]ÚˆØÜ™Y[ŠH
‹ßBˆÜÙXİ[ÛˆOOH	Ğ\ØØ\ˆÜÜ[šYY\ÉÈ	‰ˆ
ˆ]ˆÛ\ÜÓ˜[YOHœÜXÙK^KMˆ‚ˆ]ˆÛ\ÜÓ˜[YOH™›^›^XÛÛÛN™›^\›İÈÛNš][\ËY[™\İYKX™]ÙY[ˆØ\M‚ˆ]‚ˆ]ˆÛ\ÜÓ˜[YOH^VÌL\H›ÛX›Û^VÈÍMŒÍ‘WH\\˜Ø\ÙH˜XÚÚ[™Ë]ÚY\ˆX‹LH‚ˆY\˜ØYÈ0î˜›XÛÂˆÙ]‚ˆHÛ\ÜÓ˜[YOH^LÛN^LŞ›ÛX›Û^VÈÌMÌPLH˜XÚÚ[™Ë]YÚ‚ˆ\ØØ\ˆÜÜ[šYY\ÂˆÚO‚ˆÛ\ÜÓ˜[YOH^\ÛH^VÈÍQÌ—H]LH‚ˆ[˜İY[˜HXÚ]XÚ[Û™\ÈHÛÛ\˜\È0èYÚ[\ÈYYX[H°îœÜ]YYHÙ[pè[XØH\Ú\İYHHš[›ÜÈÛÛXš[˜X›\Ë‚ˆÜ‚ˆÙ]‚‚ˆ]ˆÛ\ÜÓ˜[YOH™›^][\ËXÙ[\ˆØ\LH™Ë]Ú]HLH›İ[™Y^›Ü™\ˆ›Ü™\‹VÈÑLQMPWHÚYİË\ÛH‚ˆ]Û‚ˆÛÛXÚÏ^Ê
HOˆÙ]ÙX\˜ÚšY]Ê	İX›IÊ_BˆÛ\ÜÓ˜[YO^ØLÈKLKH›İ[™Y[È^^È›Û\Ù[ZX›Û	ÂˆÙX\˜ÚšY]ÈOOH	İX›IÈÈ	Ø™ËVÈÍMŒÍ‘WH^]Ú]HÚYİË\ÛIÈˆ	İ^VÈÍQÌ—Hİ™\˜™ËYÜ˜^KLL	ÂˆXBˆ‚ˆX›BˆØ]Û‚ˆ]Û‚ˆÛÛXÚÏ^Ê
HOˆÙ]ÙX\˜ÚšY]Ê	ØØ\™ÉÊ_BˆÛ\ÜÓ˜[YO^ØLÈKLKH›İ[™Y[È^^È›Û\Ù[ZX›Û	ÂˆÙX\˜ÚšY]ÈOOH	ØØ\™ÉÈÈ	Ø™ËVÈÍMŒÍ‘WH^]Ú]HÚYİË\ÛIÈˆ	İ^VÈÍQÌ—Hİ™\˜™ËYÜ˜^KLL	ÂˆXBˆ‚ˆ\š™]\ÂˆØ]Û‚ˆÙ]‚ˆÙ]‚‚ˆËÊˆÙX\˜Ú[™š[\œÈ
‹ßBˆ]ˆÛ\ÜÓ˜[YOH›ÜÜ[š]K\ÙX\˜Ú\[™[‚ˆ›Ü›BˆÛ”İX›Z]^ÊJHOˆÂˆKœ™]™[Y˜][

NÂˆ›ÚY[”ÙX\˜Ú
ÙX\˜ÚJNÂˆ_BˆÛ\ÜÓ˜[YOH›ÜÜ[š]K\ÙX\˜ÚY›Ü›H‚ˆ‚ˆ]ˆÛ\ÜÓ˜[YOH›ÜÜ[š]K\]Y\K]Ü˜\‚ˆÙX\˜ÚÚ^™O^ÌŒ_H\šXKZY[HYHˆÏ‚ˆ[œ]ˆ\OH^‚ˆ˜[YO^ÜÙX\˜ÚBˆÛÚ[™ÙO^ÊJHOˆÙ]ÙX\˜Ú
K\™Ù]˜[YJ_BˆXÙZÛ\H‘\ØÜšX™H]pêHÙœ™XÙHH[\™\ØK‹‹ˆZˆ[œİ[[ÜÈHX›Ü˜]Üš[È[ˆØ[XYÛÈÈX[[˜ÚpìÛˆH˜[œÙ›Ü›XYÜ™\È‚ˆ\šXK[X™[H‘\ØÜšX™H]pêHÜÜ[šYY\ØØ\È‚ˆÏ‚ˆÙ]‚ˆ]Û‚ˆ\OHœİX›Z]‚ˆ\ØX›Y^ÜÙX\˜ÚØY[™ßBˆÛ\ÜÓ˜[YOH›ÜÜ[š]K\ÙX\˜Ú\İX›Z]‚ˆ‚ˆÜÙX\˜ÚØY[™ÈÈØY\Ú\˜ÛHÚ^™O^ÌMŸHÛ\ÜÓ˜[YOHœÜ[ˆˆÏˆˆÙX\˜ÚÚ^™O^ÌMŸHÏŸBˆ\ØØ\‚ˆØ]Û‚ˆÙ›Ü›O‚‚ˆËÊˆ^[\H]Y\HÚ\È
‹ßBˆ]ˆÛ\ÜÓ˜[YOH›ÜÜ[š]K\ÙX\˜ÚY^[\\È‚ˆÜ[”YX˜H\ØØ\ÜÜ[‚ˆÖÂˆ	Ñ\]Z\[ZY[ÈpêYXÛÈH]Z\°îœ™ÚXÛÉËˆ	ÔÙ\šXÚ[ÜÈH\Ù[È[ˆÜÜ][\ÉËˆ	Ó[Û[›ÜÈHX\]Z[˜\šXH[™\İšX[	Ëˆ	ÓØœ˜\ÈÚ]š[\ÈHYYšXØXÚpìÛ‰ËˆK›X\

^
HOˆ
ˆ]Û‚ˆÙ^O^Ù^Bˆ\OH˜]Ûˆ‚ˆÛÛXÚÏ^Ê
HOˆÂˆÙ]ÙX\˜Ú
^
NÂˆ›ÚY[”ÙX\˜Ú
^JNÂˆ_BˆÛ\ÜÓ˜[YOH›ÜÜ[š]KY^[\KXÚ\‚ˆ‚ˆÙ^BˆØ]Û‚ˆ
J_BˆÙ]‚‚ˆ]ˆÛ\ÜÓ˜[YOH›ÜÜ[š]KYš[\‹ZXY[™È‚ˆ]ˆÛ\ÜÓ˜[YOH›ÜÜ[š]KYš[\‹]]H‚ˆİ›Û™Ï‘š[›ÜÏÜİ›Û™Ï‚ˆÜ[ÛÛXš[˜HÜš]\š[ÜÈYZ]YÜÈÜˆ[\ØØYÜÜÜ[‚ˆÊ[X™\Š›ÛÛX[ŠX]Ú]™[š[\ŠJH
È[X™\Š›ÛÛX[Šİ]Qš[\ŠJH
È[X™\Š›ÛÛX[Š™YÚ[Û‘š[\‹š[J
JJJHˆ	‰ˆ
ˆÜ[ˆÛ\ÜÓ˜[YOH›ÜÜ[š]KXXİ]™KXÛİ[‚ˆÓ[X™\Š›ÛÛX[ŠX]Ú]™[š[\ŠJH
È[X™\Š›ÛÛX[Šİ]Qš[\ŠJH
È[X™\Š›ÛÛX[Š™YÚ[Û‘š[\‹š[J
JJ_Hš[›ÜÈXİ]›ÜÂˆÜÜ[‚ˆ
_BˆÙ]‚ˆ]Û‚ˆ\OH˜]Ûˆ‚ˆÛ\ÜÓ˜[YOH›ÜÜ[š]KXÛX\‹Yš[\œÈ‚ˆ\ØX›Y^È[X]Ú]™[š[\ˆ	‰ˆ\İ]Qš[\ˆ	‰ˆ\™YÚ[Û‘š[\ŸBˆÛÛXÚÏ^Ê
HOˆÂˆÙ]X]Ú]™[š[\Š	ÉÊNÂˆÙ]İ]Qš[\Š	ÉÊNÂˆÙ]™YÚ[Û‘š[\Š	ÉÊNÂˆ_Bˆ‚ˆ[\X\ˆš[›ÜÂˆØ]Û‚ˆÙ]‚‚ˆ]ˆÛ\ÜÓ˜[YOH›ÜÜ[š]KYš[\‹YÜšY‚ˆ]ˆÛ\ÜÓ˜[YOH›ÜÜ[š]KYš[\‹YšY[‚ˆX™[[›ÜH›ÜÜ[š]K[X]Ú[]™[“š]™[HÛÚ[˜ÚY[˜ÚXOÛX™[‚ˆÙ[XİˆYH›ÜÜ[š]K[X]Ú[]™[‚ˆ˜[YO^ÛX]Ú]™[š[\ŸBˆÛÚ[™ÙO^ÊJHOˆÙ]X]Ú]™[š[\ŠK\™Ù]˜[YJ_Bˆ‚ˆÜ[Ûˆ˜[YOHˆ•ÙÜÈÜÈš]™[\ÏÛÜ[Û‚ˆÜ[Ûˆ˜[YOHšYÚ[OÛÜ[Û‚ˆÜ[Ûˆ˜[YOH›YY][H“YYXOÛÜ[Û‚ˆÜ[Ûˆ˜[YOH™^Ü˜]ÜH‘^Ü˜]ÜšXOÛÜ[Û‚ˆÜÙ[Xİ‚ˆÙ]‚ˆ]ˆÛ\ÜÓ˜[YOH›ÜÜ[š]KYš[\‹YšY[‚ˆX™[[›ÜH›ÜÜ[š]K\İ]\È‘\İYÏÛX™[‚ˆÙ[XİˆYH›ÜÜ[š]K\İ]\È‚ˆ˜[YO^Üİ]Qš[\ŸBˆÛÚ[™ÙO^ÊJHOˆÙ]İ]Qš[\ŠK\™Ù]˜[YJ_Bˆ‚ˆÜ[Ûˆ˜[YOHˆ•ÙÜÈÜÈ\İYÜÏÛÜ[Û‚ˆÜ[Ûˆ˜[YOHH”X›XØYOÛÜ[Û‚ˆÜ[Ûˆ˜[YOHˆÙ\œ˜YOÛÜ[Û‚ˆÜ[Ûˆ˜[YOHYYXØYOÛÜ[Û‚ˆÜ[Ûˆ˜[YOHÈ‘\ÚY\OÛÜ[Û‚ˆÜÙ[Xİ‚ˆÙ]‚ˆ]ˆÛ\ÜÓ˜[YOH›ÜÜ[š]KYš[\‹YšY[‚ˆX™[[›ÜH›ÜÜ[š]K\™YÚ[Ûˆ”™YÚpìÛÛX™[‚ˆ[œ]ˆYH›ÜÜ[š]K\™YÚ[Ûˆ‚ˆ˜[YO^Ü™YÚ[Û‘š[\ŸBˆÛÚ[™ÙO^ÊJHOˆÙ]™YÚ[Û‘š[\ŠK\™Ù]˜[YJ_BˆXÙZÛ\H‘Z‹ˆY]›ÜÛ][˜H‚ˆÏ‚ˆÙ]‚ˆ]ˆÛ\ÜÓ˜[YOH›ÜÜ[š]KYš[\‹YšY[ÜÜ[š]KYš[\‹Y\ØX›Y‚ˆX™[[›ÜH›ÜÜ[š]K[[Ù[]H“[Ù[YYÜ[TOÜÜ[ÛX™[‚ˆÙ[XİYH›ÜÜ[š]K[[Ù[]Hˆ\ØX›Y˜[YOHˆ‚ˆÜ[Ûˆ˜[YOHˆ“›È\ÜÛšX›H[ˆ\İH\ØØYÜÛÜ[Û‚ˆÜÙ[Xİ‚ˆÙ]‚ˆÙ]‚‚ˆ]ˆÛ\ÜÓ˜[YOH›ÜÜ[š]KYš[\‹Y›Ûİ\ˆ‚ˆÜ[Ü[ˆÛ\ÜÓ˜[YOH›ÜÜ[š]KZ[™›Ë[X\šÈšOÜÜ[ˆH[Ù[YY›È\İ0èH\ÜÛšX›H[ˆ[Ù\šXÚ[ÈH°îœÜ]YYHXİX[ÜÜ[‚ˆ]Û‚ˆ\OH˜]Ûˆ‚ˆÛÛXÚÏ^Ê
HOˆ›ÚY[”ÙX\˜Ú
ÙX\˜ÚJ_Bˆ\ØX›Y^ÜÙX\˜ÚØY[™ÈÙX\˜Úš[J
K›[™İŸBˆÛ\ÜÓ˜[YOH›ÜÜ[š]KX\KYš[\œÈ‚ˆ‚ˆš[\ˆÚ^™O^ÌMŸHÏˆ\XØ\ˆš[›ÜÂˆØ]Û‚ˆÙ]‚ˆÙ]‚‚ˆËÊˆÙX\˜Ú™\İ[Èİ[[X\H
‹ßBˆÜÙX\˜Ú™\İ[È	‰ˆ
ˆ]ˆÛ\ÜÓ˜[YOH™›^][\ËXÙ[\ˆ\İYKX™]ÙY[ˆ^^È^VÈÍQÌ—H‚ˆÜ[‚ˆ[˜ÛÛ˜Y\ÈÜÙX\˜Ú™\İ[Ëİ[ÓØØ[Tİš[™Ê	Ù\ËPÓ	Ê_OØˆXÚ]XÚ[Û™\È™X[\È
0èYÚ[˜HÜYÙ_JBˆÜÜ[‚ˆÜ[ˆÛ\ÜÓ˜[YOH^VÌL\H^VÈÎNLM—H‚ˆ™[]˜[˜ÚXHØ[İ[YHÛÛˆ˜\ÙH[ˆØ]0è[ÙÛÈH[™™\™[˜ÚXHÛÛ^X[ˆÜÜ[‚ˆÙ]‚ˆ
_B‚ˆËÊˆÙX\˜Ú™\İ[ÈšY]È
‹ßBˆÜÙX\˜ÚØY[™ÈÈ
ˆ]ˆÛ\ÜÓ˜[YOHœLLˆ^XÙ[\ˆ^\ÛH^VÈÍQÌ—H™Ë]Ú]H›İ[™Y^›Ü™\ˆ›Ü™\‹VÈÑLQMPWH‚ˆØY\Ú\˜ÛHÚ^™O^ÌHÛ\ÜÓ˜[YOHœÜ[ˆ^X]]È^VÈÍMŒÍ‘WHX‹LˆˆÏ‚ˆ\ØØ[™ÈÜÜ[šYY\È[ˆY\˜ØYÈ0î˜›XÛø )‚ˆÙ]‚ˆ
Hˆ\ÙX\˜Ú™\İ[ÏËš][\ÏË›[™İÈ
ˆ]ˆÛ\ÜÓ˜[YOHœLLˆ^XÙ[\ˆ™Ë]Ú]H›İ[™YL›Ü™\ˆ›Ü™\‹VÈÑLQMPWHÜXÙK^KLÈ‚ˆš[TÙX\˜ÚÚ^™O^ÌHÛ\ÜÓ˜[YOH›^X]]È^VÈÎNLM—HˆÏ‚ˆÈÛ\ÜÓ˜[YOH™›ÛX›Û^X˜\ÙH^VÈÌMÌPLH‚ˆÜÙX\˜Úš[J
K›[™İˆÈ	Ñ\ØÜšX™H]pêHÜÜ[šYY\ØØ\ÉÈˆ	Ó›ÈÙH[˜ÛÛ˜\›ÛˆXÚ]XÚ[Û™\ÉßBˆÚÏ‚ˆÛ\ÜÓ˜[YOH^^È^VÈÍQÌ—H‚ˆÜÙX\˜Úš[J
K›[™İ‚ˆÈ	Ñ\ØÜšX™H[Y[›ÜÈˆØ\˜Xİ\™\ÈÈ[YÙH[›ÈHÜÈZ™[\ÜÈ\˜H[šXÚX\ˆH°îœÜ]YYK‰Âˆˆ	ÔYX˜HZ\İ[™ÈÜÈ0ê\›Z[›ÜÈÈ[\X[™ÈÜÈš[›ÜÈ\XØYÜË‰ßBˆÜ‚ˆÙ]‚ˆ
HˆÙX\˜ÚšY]ÈOOH	İX›IÈÈ
ˆ]ˆÛ\ÜÓ˜[YOH˜™Ë]Ú]H›İ[™Y^›Ü™\ˆ›Ü™\‹VÈÑLQMPWHÚYİË\ÛHİ™\™›İËZY[ˆ‚ˆ]ˆÛ\ÜÓ˜[YOHœÙX\˜Ú\™\İ[Ë]X›K]Ü˜\ˆ›ÛOHœ™YÚ[Ûˆˆ\šXK[X™[H”™\İ[YÜÈH°îœÜ]YYHˆX’[™^^ÌO‚ˆX›HÛ\ÜÓ˜[YOHœÙX\˜Ú\™\İ[Ë]X›H^[Y^^È‚ˆÛÛÜ›İ\‚ˆÛÛİ[O^ŞÈÚYˆ	ÌÌ	È_HÏ‚ˆÛÛİ[O^ŞÈÚYˆ	ÌNL	È_HÏ‚ˆÛÛİ[O^ŞÈÚYˆ	ÌM	È_HÏ‚ˆÛÛİ[O^ŞÈÚYˆ	ÌLŒ	È_HÏ‚ˆÛÛİ[O^ŞÈÚYˆ	ÌLL	È_HÏ‚ˆÛÛİ[O^ŞÈÚYˆ	ÎL	È_HÏ‚ˆÛÛİ[O^ŞÈÚYˆ	ÌMŒ	È_HÏ‚ˆØÛÛÜ›İ\‚ˆXYÛ\ÜÓ˜[YOH˜™ËVÈÑQWH›Ü™\‹Xˆ›Ü™\‹VÈÑLQMPWH^VÈÍQÌ—H›Û\Ù[ZX›Û‚ˆ‚ˆÛ\ÜÓ˜[YOHœKLÈM“ÔÔ•S’QQİ‚ˆÛ\ÜÓ˜[YOHœKLÈM“Ô‘ĞS’TÓSÏİ‚ˆÛ\ÜÓ˜[YOHœKLÈM“SÓ•ÈTÕSPQÏİ‚ˆÛ\ÜÓ˜[YOHœKLÈMÒQT”‘Oİ‚ˆÛ\ÜÓ˜[YOHœKLÈM‘TÕQÏİ‚ˆÛ\ÜÓ˜[YOHœKLÈM“PUÒİ‚ˆÛ\ÜÓ˜[YOHœKLÈM^\šYÚPĞÒSÓ‘TÏİ‚ˆİ‚ˆİXY‚ˆ›ÙHÛ\ÜÓ˜[YOH™]šYK^H]šYKVÈÑLQMPWH‚ˆÜÙX\˜Ú™\İ[Ëš][\Ë›X\

][Nˆ[JHOˆ
ˆˆÙ^O^Ú][K˜ÛÙYÛ×Ù^\››ßHÛ\ÜÓ˜[YOHšİ™\˜™ËYÜ˜^KML˜[œÚ][Û‹XÛÛÜœÈ‚ˆÛ\ÜÓ˜[YOHœÙX\˜ÚXÛÛ[ÜÜ[š]HKLÈM‚ˆ]Û‚ˆÛÛXÚÏ^Ê
HOˆ›ÚYÜ[‘]Z[
][K˜ÛÙYÛ×Ù^\››Ê_BˆÛ\ÜÓ˜[YOHœÙX\˜Ú[ÜÜ[š]K]]H›ÛX›Û^VÈÌMÌPLHİ™\^VÈÍMŒÍ‘WH^[Y‚ˆ]O^Ú][K››ÛXœ™H	Ó›ÛXœ™H›È\ÜÛšX›IßBˆ\šXK[X™[^ØXœš\ˆšXÚNˆ	Ú][K››ÛXœ™H	Ó›ÛXœ™H›È\ÜÛšX›IßXBˆ‚ˆÚ][K››ÛXœ™H	Ó›ÛXœ™H›È\ÜÛšX›IßBˆØ]Û‚ˆÜ[ˆÛ\ÜÓ˜[YOH™›Û[[Û›È^VÌL\H^VÈÎNLM—HÚ][K˜ÛÙYÛ×Ù^\››ßOÜÜ[‚ˆİ‚ˆÛ\ÜÓ˜[YOHœÙX\˜ÚXÛÛ[Ü™Ø[š\ÛHKLÈM^VÈÍQÌ—H‚ˆÜ[ˆ]O^Ú][K›Ü™Ø[š\Û[È	ÓÜ™Ø[š\Û[È›È[™›Ü›XYÉßOÚ][K›Ü™Ø[š\Û[È	ø %	ßOÜÜ[‚ˆİ‚ˆÛ\ÜÓ˜[YOHœÙX\˜ÚXÛÛX[[İ[KLÈM›Û\Ù[ZX›Û^VÈÌMÌPLHˆ]O^Û[Û™^J][K›[Û×Ù\İ[XYË][K›[Û™YJ_OÛ[Û™^J][K›[Û×Ù\İ[XYË][K›[Û™YJ_Oİ‚ˆÛ\ÜÓ˜[YOHœÙX\˜ÚXÛÛXÛÜÙHKLÈM^VÈÍQÌ—HÙ]Q›]
][K™™XÚWØÚY\œ™J_Oİ‚ˆÛ\ÜÓ˜[YOHœÙX\˜ÚXÛÛ\İ]\ÈKLÈM‚ˆİ]\Ğ˜YÙHİ]O^Ú][K˜ÛÙYÛ×Ù\İYßHÏ‚ˆİ‚ˆÛ\ÜÓ˜[YOHœÙX\˜ÚXÛÛ[X]ÚKLÈM‚ˆÜ[ˆÛ\ÜÓ˜[YOH™›ÛX›Û^^È^VÈÍMŒÍ‘WH™ËVÈÙŒY™—HLˆKLH›İ[™YY[‚ˆÚ][K˜ÛÛ\]Xš[]HÏÈLIBˆÜÜ[‚ˆİ‚ˆÛ\ÜÓ˜[YOHœÙX\˜ÚXÛÛXXİ[ÛœÈKLÈM‚ˆ]‚ˆ]Û‚ˆÛÛXÚÏ^Ê
HOˆ›ÚYØ]™SÜÜ[š]J][K˜ÛÙYÛ×Ù^\››Ê_BˆÛ\ÜÓ˜[YOH^^È^VÈÍQÌ—Hİ™\^VÈÍMŒÍ‘WH›Û[YY][H‚ˆ]OH‘İX\™\ˆ[ˆÙYİZ[ZY[È‚ˆ‚ˆİX\™\‚ˆØ]Û‚ˆ]Û‚ˆÛÛXÚÏ^Ê
HOˆ›ÚYÜ[‘]Z[
][K˜ÛÙYÛ×Ù^\››Ê_BˆÛ\ÜÓ˜[YOH^^È^VÈÍMŒÍ‘WH›Û\Ù[ZX›Ûİ™\[™\›[™H‚ˆ‚ˆ™\ˆšXÚBˆØ]Û‚ˆÙ]‚ˆİ‚ˆİ‚ˆ
J_Bˆİ›ÙO‚ˆİX›O‚ˆÙ]‚ˆÙ]‚ˆ
Hˆ
ˆ]ˆÛ\ÜÓ˜[YOH™ÜšYÜšYXÛÛËLHY™ÜšYXÛÛËLˆØ\M‚ˆÜÙX\˜Ú™\İ[Ëš][\Ë›X\

][Nˆ[JHOˆ
ˆ]‚ˆÙ^O^Ú][K˜ÛÙYÛ×Ù^\››ßBˆÛ\ÜÓ˜[YOH˜™Ë]Ú]H›İ[™Y^›Ü™\ˆ›Ü™\‹VÈÑLQMPWHMHÚYİË\ÛHÜXÙK^KLÈ›^›^XÛÛ\İYKX™]ÙY[ˆ‚ˆ‚ˆ]ˆÛ\ÜÓ˜[YOHœÜXÙK^KLˆ‚ˆ]ˆÛ\ÜÓ˜[YOH™›^][\Ë\İ\\İYKX™]ÙY[ˆØ\LÈ‚ˆ]Û‚ˆÛÛXÚÏ^Ê
HOˆ›ÚYÜ[‘]Z[
][K˜ÛÙYÛ×Ù^\››Ê_BˆÛ\ÜÓ˜[YOH™›ÛX›Û^\ÛH^VÈÌMÌPLHİ™\^VÈÍMŒÍ‘WH^[Y[™KXÛ[\Lˆ‚ˆ‚ˆÚ][K››ÛXœ™H	Ó›ÛXœ™H›È\ÜÛšX›IßBˆØ]Û‚ˆÜ[ˆÛ\ÜÓ˜[YOH^^È›ÛX›Û^VÈÍMŒÍ‘WH™ËVÈÙŒY™—HL‹HKLH›İ[™Y[ÈÚš[šËL‚ˆÚ][K˜ÛÛ\]Xš[]HÏÈLIHX]ÚˆÜÜ[‚ˆÙ]‚ˆÛ\ÜÓ˜[YOH^^È^VÈÍQÌ—H[˜Ø]HÚ][K›Ü™Ø[š\Û[È	ÓÜ™Ø[š\Û[È›È[™›Ü›XYÉßOÜ‚ˆ]ˆÛ\ÜÓ˜[YOH™›^][\ËXÙ[\ˆØ\Lˆ›^]Ü˜\^^È‚ˆİ]\Ğ˜YÙHİ]O^Ú][K˜ÛÙYÛ×Ù\İYßHÏ‚ˆÜ[ˆÛ\ÜÓ˜[YOH^VÈÎNLM—HÚY\œ™NˆÙ]Q›]
][K™™XÚWØÚY\œ™J_OÜÜ[‚ˆÜ[ˆÛ\ÜÓ˜[YOH™›Û\Ù[ZX›Û^VÈÌMÌPLHÛ[Û™^J][K›[Û×Ù\İ[XYË][K›[Û™YJ_OÜÜ[‚ˆÙ]‚ˆÚ][K›X]Ú™X\ÛÛœÏË›[™İˆ	‰ˆ
ˆÛ\ÜÓ˜[YOH^VÌL\H^VÈÍMŒÍ‘WH™ËVÈÙŒY™—KÍLˆ›İ[™Y[È‚ˆÚ][K›X]Ú™X\ÛÛœËš›Ú[Š	È0­È	Ê_BˆÜ‚ˆ
_BˆÙ]‚‚ˆ]ˆÛ\ÜÓ˜[YOHœLÈ›Ü™\‹]›Ü™\‹VÈÑLQMPWH›^][\ËXÙ[\ˆ\İYKX™]ÙY[ˆ‚ˆ]Û‚ˆÛÛXÚÏ^Ê
HOˆ›ÚYØ]™SÜÜ[š]J][K˜ÛÙYÛ×Ù^\››Ê_BˆÛ\ÜÓ˜[YOH^^È^VÈÍQÌ—Hİ™\^VÈÍMŒÍ‘WH›Û[YY][H‚ˆ‚ˆ
ÈİX\™\ˆ[ˆÙYİZ[ZY[ÂˆØ]Û‚ˆ]Û‚ˆÛÛXÚÏ^Ê
HOˆ›ÚYÜ[‘]Z[
][K˜ÛÙYÛ×Ù^\››Ê_BˆÛ\ÜÓ˜[YOHšNLÈ™ËVÈÍMŒÍ‘WHİ™\˜™ËVÈÍŒ™XÍ×H^]Ú]H^^È›Û\Ù[ZX›Û›İ[™Y[È›^][\ËXÙ[\ˆØ\LH‚ˆ‚ˆ™\ˆšXÚH\œ›İÔšYÚÚ^™O^ÌLßHÏ‚ˆØ]Û‚ˆÙ]‚ˆÙ]‚ˆ
J_BˆÙ]‚ˆ
_B‚ˆËÊˆYÚ[˜][Ûˆ
‹ßBˆÜÙX\˜Ú™\İ[ÏËœYÙ\ÈˆH	‰ˆ
ˆ]ˆÛ\ÜÓ˜[YOH™›^][\ËXÙ[\ˆ\İYKX™]ÙY[ˆ^^È^VÈÍQÌ—HLÈ‚ˆÜ[”0èYÚ[˜HÜYÙ_HHÜÙX\˜Ú™\İ[ËœYÙ\ßOÜÜ[‚ˆ]ˆÛ\ÜÓ˜[YOH™›^][\ËXÙ[\ˆØ\Lˆ‚ˆ]Û‚ˆ\OH˜]Ûˆ‚ˆ\ØX›Y^ÜYÙHHHÙX\˜ÚØY[™ßBˆÛÛXÚÏ^Ê
HOˆ›ÚY[”ÙX\˜Ú
ÙX\˜ÚYÙHHJ_BˆÛ\ÜÓ˜[YOHœLÈKLKH›İ[™Y[È›Ü™\ˆ›Ü™\‹VÈÑLQMPWH™Ë]Ú]Hİ™\˜™ËYÜ˜^KML\ØX›Y›ÜXÚ]KML‚ˆ‚ˆ[\š[Ü‚ˆØ]Û‚ˆ]Û‚ˆ\OH˜]Ûˆ‚ˆ\ØX›Y^ÜYÙHHÙX\˜Ú™\İ[ËœYÙ\ÈÙX\˜ÚØY[™ßBˆÛÛXÚÏ^Ê
HOˆ›ÚY[”ÙX\˜Ú
ÙX\˜ÚYÙH
ÈJ_BˆÛ\ÜÓ˜[YOHœLÈKLKH›İ[™Y[È›Ü™\ˆ›Ü™\‹VÈÑLQMPWH™Ë]Ú]Hİ™\˜™ËYÜ˜^KML\ØX›Y›ÜXÚ]KML‚ˆ‚ˆÚYİZY[BˆØ]Û‚ˆÙ]‚ˆÙ]‚ˆ
_BˆÙ]‚ˆ
_B‚ˆÜÙXİ[ÛˆOOH	ÓÜÜ[šYY\ÉÈ	‰ˆ
ˆ]ˆÛ\ÜÓ˜[YOHœÜXÙK^KMˆ‚ˆXY\‚ˆHÛ\ÜÓ˜[YOH^LÛN^LŞ›ÛX›Û^VÈÌMÌPLH˜XÚÚ[™Ë]YÚ“ÜÜ[šYY\ÏÚO‚ˆÛ\ÜÓ˜[YOH^\ÛH^VÈÍQÌ—H]LH”™]š\ØH\ÈXÚ]XÚ[Û™\È]YHÛÚ[˜ÚY[ˆÛÛˆ[Ø]0è[ÙÛÈHH[\™\ØKÜ‚ˆÚXY\‚ˆÛÛ\[SÜÜ[š]Y\ÂˆÙ^O^Ø]]˜Xİ]™PÛÛ\[RYBˆ›Ø\™ˆÛÛÛ™šYİ\™O^Ê
HOˆÛÕÔÙXİ[ÛŠ	ÓZH[\™\ØIÊ_BˆÛ“Ü[“\İ[™Ï^ÊÛÙJHOˆ›ÚYÜ[‘]Z[
ÛÙJ_BˆÏ‚ˆÙ]‚ˆ
_B‚ˆÜÙXİ[ÛˆOOH	ĞYÙ[\ÈPIÈ	‰ˆ
ˆÛÛ[Y\˜ÚX[YÙ[ÂˆÛÛ\[S˜[YO^Ø]]›Y[X™\œÚ\Ë™š[™

Y[X™\œÚ\
HOˆY[X™\œÚ\˜ÛÛ\[RYOOH]]˜Xİ]™PÛÛ\[RY
OË˜ÛÛ\[S˜[YHÏÈ	İH[\™\ØIßBˆÛÛÛ™šYİ\™O^Ê
HOˆÛÕÔÙXİ[ÛŠ	ÓZH[\™\ØIÊ_BˆÛ[˜[^™S\İ[™Ï^ÊÛÙJHOˆÈ›ÚYÜ[‘]Z[
ÛÙJNÈ›ÚY[˜[^™S\İ[™ÊÛÙJNÈ_BˆÏ‚ˆ
_B‚ˆËÊˆÑPÕSÓˆS•SQÑSÒPHHQTĞQÈ
İ]Ú
H
‹ßBˆÜÙXİ[ÛˆOOH	Ò[[YÙ[˜ÚXHHY\˜ØYÉÈ	‰ˆ
ˆX\šÙ][˜[]XÜÂˆİ[[X\O^Üİ[[X\_BˆX[^ÚX[Bˆ\œ›Ü^Ù\œ›ÜŸBˆÛ“Ü[“\İ[™Ï^ÊÛÙJHOˆ›ÚYÜ[‘]Z[
ÛÙJ_BˆÛ•šY]Ó\İ[™ÜÏ^Ê
HOˆÛÕÔÙXİ[ÛŠ	Ğ\ØØ\ˆÜÜ[šYY\ÉÊ_BˆÛ“Ü[[˜[]XÜÏ^Ê
HOˆÛÕÔÙXİ[ÛŠ	Ğ[˜[0ë]XØIÊ_BˆÛ”™]O^Ê
HOˆ›ÚY™Yœ™\Ú

_BˆÏ‚ˆ
_B‚ˆÜÙXİ[ÛˆOOH	Ğ[˜[0ë]XØIÈ	‰ˆ
ˆ[˜[]XÜÕÛÜšÜÜXÙBˆÙ^O^Ø]]˜Xİ]™PÛÛ\[RYBˆ™\]Y\İ^Ø\_BˆÜÜ™•ÚÙ[^Ø]]˜ÜÜ™•ÚÙ[ŸBˆÏ‚ˆ
_B‚ˆËÊˆÑPÕSÓˆÑQÕRSRQS•È
İ]ÚJH
‹ßBˆÊÙXİ[ÛˆOOH	ÔÙYİZ[ZY[ÉÈÙXİ[ÛˆOOH	ĞØ[[™\š[ÉÊH	‰ˆ
ˆ˜XÚÚ[™ÕÛÜšÜÜXÙBˆÙ^O^Ø	Ø]]˜Xİ]™PÛÛ\[RYN‰ÜÙXİ[ÛŸXBˆØ[[™\^ÜÙXİ[ÛˆOOH	ĞØ[[™\š[ÉßBˆÛ“Ü[^ÊÛÙJHOˆ›ÚYÜ[‘]Z[
ÛÙJ_BˆÛÚ[™ÙY^Ê
HOˆ›ÚY™Yœ™\Ú[\Ûİ[Ê
_BˆÜÜ™•ÚÙ[^Ø]]˜ÜÜ™•ÚÙ[ŸBˆÏ‚ˆ
_B‚ˆËÊˆÑPÕSÓˆST•TÈ	ˆ•TÔUQQTÈÕPT‘QTÈ
İ]ÚŠH
‹ßBˆÜÙXİ[ÛˆOOH	Ğ[\\ÉÈ	‰ˆ
ˆ[\ÔYÙBˆ][\Ï^Ø[\ßBˆš[\^Ø[\Ñš[\ŸBˆÛ‘š[\^Ê˜[
HOˆÙ][\Ñš[\Š˜[
_BˆÛ”™XY^ÊY
HOˆÂˆ›ÚY\JØ\KØ[\ËÉÚYKÜ™XYÈY]Ùˆ	ÔÔÕ	ÈJK[Š

HOˆÂˆÙ][\Ê
İ\œŠHOˆ[\Ñš[\ˆOOH	İ[œ™XY	ÂˆÈİ\œ‹™š[\Š
][JHOˆ][KšYOOHY
Bˆˆİ\œ‹›X\

][JHOˆ
][KšYOOHYÈÈ‹‹š][K™XY]ˆ™]È]J
KÒTÓÔİš[™Ê
HHˆ][JJJNÂˆ›ÚY™Yœ™\Ú[\Ûİ[Ê
NÂˆJNÂˆ_BˆÛ‘\ÛZ\ÜÏ^ÊY
HOˆÂˆ›ÚY\JØ\KØ[\ËÉÚYKÙ\ÛZ\ÜØÈY]Ùˆ	ÔÔÕ	ÈJK[Š

HOˆÂˆÙ][\Ê
İ\œŠHOˆİ\œ‹™š[\Š
]
HOˆ]šYOOHY
JNÂˆ›ÚY™Yœ™\Ú[\Ûİ[Ê
NÂˆJNÂˆ_BˆÛ“Ü[^Ê][JHOˆ›ÚYÜ[‘]Z[
][K˜ÛÙJ_BˆØY[™Ï^Ø[\ÓØY[™ßBˆ\œ›Ü^Ø[\Ñ\œ›ÜŸBˆÏ‚ˆ
_B‚ˆËÊˆÑPÕSÓˆRHST‘TĞH
İ]ÚÈ	ˆ
H
‹ßBˆÜÙXİ[ÛˆOOH	ÓZH[\™\ØIÈ	‰ˆ
ˆÛÛ\[UÛÜšÜÜXÙBˆÛ”Ø]™Y^Ê
HOˆ›ÚY™Yœ™\Ú

_BˆÜÜ™•ÚÙ[^Ø]]˜ÜÜ™•ÚÙ[ŸBˆØ[‘Y]^Ø]]œ›ÛHOOH	ØYZ[‰ßBˆXØÙ\ÜÔ›ÛO^Ø]]œ›Û_BˆÏ‚ˆ
_B‚ˆËÊˆÑPÕSÓˆTURTÈHPĞÑTÓÔÈ
İ]ÚÈPÊH
‹ßBˆÜÙXİ[ÛˆOOH	Ñ\]Z\ÈHXØÙ\ÛÜÉÈ	‰ˆ
ˆÛÛ\[UX[SX[˜YÙ[Y[›ÛO^Ø]]œ›Û_HÜÜ™•ÚÙ[^Ø]]˜ÜÜ™•ÚÙ[ŸHÏ‚ˆ
_B‚ˆÜÙXİ[ÛˆOOH	ĞİY[\ÈH\İX\š[ÉÈ	‰ˆ\Ô]›Ü›PYZ[ˆ	‰ˆ
ˆ]›Ü›U\Ù\œÈÜÜ™•ÚÙ[^Ø]]˜ÜÜ™•ÚÙ[ŸHÏ‚ˆ
_B‚ˆËÊˆÑPÕSÓˆÓÓ‘’QÕTPÒSÓˆÑS‘TS
‹ßBˆÜÙXİ[ÛˆOOH	ĞÛÛ™šYİ\˜XÚpìÛ‰È	‰ˆ
ˆ]ˆÛ\ÜÓ˜[YOHœÜXÙK^KMˆ‚ˆ]ˆÛ\ÜÓ˜[YOH˜›Ü™\‹Xˆ›Ü™\‹VÈÑLQMPWH‹LÈ‚ˆ]ˆÛ\ÜÓ˜[YOH^VÌL\H›ÛX›Û^VÈÍMŒÍ‘WH\\˜Ø\ÙH˜XÚÚ[™Ë]ÚY\ˆX‹LH‚ˆÜ\˜XÚpìÛˆ[Ù\šYÜ‚ˆÙ]‚ˆHÛ\ÜÓ˜[YOH^L›ÛX›Û^VÈÌMÌPLHÛÛ™šYİ\˜XÚpìÛˆHÚ[˜Ü›Ûš^˜XÚpìÛÚO‚ˆÛ\ÜÓ˜[YOH^^È^VÈÍQÌ—H]LH‚ˆÙ\İpìÛˆ[™XÛÛXİÜˆX\š[ÈHÛÛ™^pìÛˆÙšXÚX[HÚ[PÛÛ\˜K‚ˆÜ‚ˆÙ]‚‚ˆ]ˆÛ\ÜÓ˜[YOH™ÜšYÜšYXÛÛËLHY™ÜšYXÛÛËLˆØ\Mˆ‚ˆ]ˆÛ\ÜÓ˜[YOH˜™Ë]Ú]H›İ[™Y^›Ü™\ˆ›Ü™\‹VÈÑLQMPWHMHÚYİË\ÛHÜXÙK^KLÈ‚ˆÈÛ\ÜÓ˜[YOH™›ÛX›Û^\ÛH^VÈÌMÌPLH›^][\ËXÙ[\ˆØ\Lˆ‚ˆÛØÚÌÈÚ^™O^ÌMßHÛ\ÜÓ˜[YOH^VÈÍMŒÍ‘WHˆÏˆÚ[˜Ü›Ûš^˜YÜˆX\š[ÂˆÚÏ‚ˆ]ˆÛ\ÜÓ˜[YOHœÜXÙK^KLˆ^^È^VÈÍQÌ—H‚ˆ’Ü˜\š[ÈHÚ[Nˆ[Y\šXØKÔØ[XYÛËˆ›ØÙ\ØH\ÈXÚ]XÚ[Û™\ÈÜˆ™XÚKÜ‚ˆ]ˆÛ\ÜÓ˜[YOHœLÈ›İ[™Y[È™ËVÈÑQWH›Ü™\ˆ›Ü™\‹VÈÑLQMPWHÜXÙK^KLH‚ˆ]ˆÛ\ÜÓ˜[YOH™›^\İYKX™]ÙY[ˆ‚ˆÜ[°æ›[XHÚ[˜Ü›Ûš^˜XÚpìÛˆ^]ÜØNÜÜ[‚ˆˆÛ\ÜÓ˜[YOH^VÈÌMÌPLH‚ˆØÛÛ™šYÏË[[XQ™XÚQ^]ÜØHÈ]U[YQ›]
ÛÛ™šYË[[XQ™XÚQ^]ÜØJHˆ	ÔÚ[ˆ™XÚH™YÚ\İ˜YIßBˆØ‚ˆÙ]‚ˆ]ˆÛ\ÜÓ˜[YOH™›^\İYKX™]ÙY[ˆ‚ˆÜ[‘™XÚ\È[™Y[\ÎÜÜ[‚ˆˆÛ\ÜÓ˜[YOH^VÈÌMÌPLHØÛÛ™šYÏË™Z[TŞ[˜ÏËœ[™[™Ñ^\ÈÏÈOØ‚ˆÙ]‚ˆÙ]‚ˆÙ]‚ˆÙ]‚‚ˆ]ˆÛ\ÜÓ˜[YOH˜™Ë]Ú]H›İ[™Y^›Ü™\ˆ›Ü™\‹VÈÑLQMPWHMHÚYİË\ÛHÜXÙK^KLÈ‚ˆÈÛ\ÜÓ˜[YOH™›ÛX›Û^\ÛH^VÈÌMÌPLH›^][\ËXÙ[\ˆØ\Lˆ‚ˆ]X˜\ÙHÚ^™O^ÌMßHÛ\ÜÓ˜[YOH^VÈÍMŒÍ‘WHˆÏˆ˜\ÙHH]ÜÈHTBˆÚÏ‚ˆ]ˆÛ\ÜÓ˜[YOHœÜXÙK^KLˆ^^È^VÈÍQÌ—H‚ˆ“\ÈÜ™Y[˜ÚX[\È[XÚÙ]THHY\˜ØYÈ0î˜›XÛÈ™\ÚY[ˆ[ˆ[\˜Ú]›È™[ˆ[Ù\šYÜ‹Ü‚ˆ]ˆÛ\ÜÓ˜[YOHœLÈ›İ[™Y[È™ËVÈÑQWH›Ü™\ˆ›Ü™\‹VÈÑLQMPWHÜXÙK^KLH‚ˆ]ˆÛ\ÜÓ˜[YOH™›^\İYKX™]ÙY[ˆ‚ˆÜ[ÛÛ™^pìÛˆ^TÔSÜÜ[‚ˆˆÛ\ÜÓ˜[YOH^VÈÍMŒÍ‘WHÛÛ™XİYOØ‚ˆÙ]‚ˆ]ˆÛ\ÜÓ˜[YOH™›^\İYKX™]ÙY[ˆ‚ˆÜ[•XÚÙ]THY\˜ØYÈ0î˜›XÛÎÜÜ[‚ˆˆÛ\ÜÓ˜[YO^ÚX[Ë˜\PÛÛ™šYİ\™YÈ	İ^VÈÍMŒÍ‘WIÈˆ	İ^X[X™\‹MÌ	ßO‚ˆÚX[Ë˜\PÛÛ™šYİ\™YÈ	Õ°è[YÉÈˆ	Ô™\]ZY\™HXÚÙ][ˆ™[‰ßBˆØ‚ˆÙ]‚ˆÙ]‚ˆÙ]‚ˆÙ]‚ˆÙ]‚ˆÙ]‚ˆ
_B‚ˆËÊˆÑPÕSÓˆÑS•“ÈH•QPTÈ
\ÛÛ]YØ[™›Şİ]ÚØÜ™Y[ŠH
‹ßBˆÜÙXİ[ÛˆOOH	ĞÙ[›ÈHYX˜\ÉÈ	‰ˆ
ˆØ[™›ŞÙ[\ˆÛ˜XÚÕĞ\^Ê
HOˆÛÕÔÙXİ[ÛŠ	Ô™\İ[Y[‰Ê_HÏ‚ˆ
_BˆÛXZ[‚ˆÙ]‚‚ˆËÊˆš^YØ\İ˜[›™\ˆ
‹ßBˆİØ\İ	‰ˆ
ˆ]ˆÛ\ÜÓ˜[YOH™š^Y›İÛKMHšYÚMH‹ML™ËVÈÌMÌPLH^]Ú]H^^ÈMKLÈ›İ[™Y^ÚYİË^›^][\ËXÙ[\ˆØ\LÈ‚ˆÜ[İØ\İOÜÜ[‚ˆ]ÛˆÛÛXÚÏ^Ê
HOˆÙ]Ø\İ
	ÉÊ_HÛ\ÜÓ˜[YOH^YÜ˜^KMİ™\^]Ú]H‚ˆÚ^™O^ÌM_HÏ‚ˆØ]Û‚ˆÙ]‚ˆ
_B‚ˆËÊˆ\İ[™È]Z[˜]Ù\‹Ó[Ù[
‹ßBˆÜÙ[XİY	‰ˆ
ˆ\İ[™Ñ]Z[[Ù[ˆ\İ[™Ï^ÜÙ[XİYBˆÛÛ\[RY^Ø]]˜Xİ]™PÛÛ\[RYÏÈBˆ\Ù\’Y^Ø]]\Ù\’YBˆÜÜ™•ÚÙ[^Ø]]˜ÜÜ™•ÚÙ[ŸBˆØY[™Ï^Ù]Z[ØY[™ßBˆØ]™Y^ÜÙ[XİYØ]™YBˆØ]š[™Ï^Ù]Z[Ø]š[™ßBˆÛ[˜[^™O^Ê
HOˆ›ÚY[˜[^™S\İ[™ÊÙ[XİYÛÙYÛÑ^\››Ê_BˆÛ”Ø]™O^Ê
HOˆÂˆÙ]]Z[Ø]š[™ÊYJNÂˆ›ÚYØ]™SÜÜ[š]JÙ[XİYÛÙYÛÑ^\››ÊK™š[˜[J

HOˆÙ]]Z[Ø]š[™Ê˜[ÙJJNÂˆ_Bˆ[˜[\Ú\Ï^Ø[˜[\Ú\ßBˆ[˜[\Ú\ÓØY[™Ï^Ø[˜[\Ú\ÓØY[™ßBˆÛ‘ÛÕĞÛÛ\[O^Ê
HOˆÛÕÔÙXİ[ÛŠ	ÓZH[\™\ØIÊ_BˆÛÛÜÙO^ØÛÜÙQ]Z[BˆÏ‚ˆ
_BˆÙ]‚ˆ
NÂŸB‚™^ÜY˜][\Â