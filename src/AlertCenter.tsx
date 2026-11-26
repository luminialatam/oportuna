import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  LoaderCircle,
  Search,
  Sparkles,
  CalendarDays,
  ClipboardList,
  X,
} from 'lucide-react';
import { ProactiveSearchControls } from './ProactiveSearchControls';

export type AlertItem = {
  id: number;
  opportunityId: number;
  type: string;
  title: string;
  message: string;
  dueAt: string;
  readAt: string | null;
  createdAt: string;
  code: string;
  listingName: string | null;
  matchLevel?: 'high' | 'medium' | 'exploratory';
  matchScore?: number | null;
};

export type AlertOverview = {
  trackedActive: number;
  closingIn7Days: number;
  overdueTasks: number;
  tasksIn7Days: number;
  newMatches: number;
  nextClosings: { id: number; code: string; title: string; buyer: string | null; dueAt: string; state: number | null }[];
  nextTasks: { id: number; trackingId: number; code: string; title: string; label: string; dueAt: string; overdue: boolean }[];
  recentMatches: AlertItem[];
  generatedAt: string;
};

const timeLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('es-CL', {
        timeZone: 'America/Santiago',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
};

export function AlertNotificationPanel({
  items,
  unread,
  pendingMatches,
  open,
  loading,
  error,
  onToggle,
  onNavigate,
  onPending,
  onRead,
  onDismiss,
  onOpen,
}: {
  items: AlertItem[];
  unread: number;
  pendingMatches: number;
  open: boolean;
  loading: boolean;
  error: string;
  onToggle: () => void;
  onNavigate: () => void;
  onPending: () => void;
  onRead: (id: number) => void;
  onDismiss: (id: number) => void;
  onOpen: (item: AlertItem) => void;
}) {
  return (
    <div className="relative">
      <button
        className="w-9 h-9 rounded-lg border border-[#E1E4EA] bg-white text-[#5D6472] hover:bg-[#F8F9FA] flex items-center justify-center relative transition-colors shadow-sm"
        aria-label={`Notificaciones${unread ? `, ${unread} sin leer` : ''}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <Bell size={17} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-[#5636D9] text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-sm">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/10 backdrop-blur-[1px]"
            onClick={onToggle}
          />
          <section className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl border border-[#E1E4EA] shadow-xl z-50 overflow-hidden flex flex-col">
            <header className="p-4 border-b border-[#E1E4EA] flex items-center justify-between bg-white">
              <div className="flex items-center gap-2">
                <Bell size={16} className="text-[#5636D9]" />
                <h3 className="font-bold text-sm text-[#171A24]">Notificaciones</h3>
                {unread > 0 && (
                  <span className="text-[11px] font-semibold text-[#5636D9] bg-[#f0edff] px-2 py-0.5 rounded-full">
                    {unread} sin leer
                  </span>
                )}
              </div>
              <button
                className="w-7 h-7 rounded-md text-[#5D6472] hover:bg-gray-100 flex items-center justify-center"
                onClick={onToggle}
                aria-label="Cerrar"
              >
                <X size={15} />
              </button>
            </header>

            <div className="max-h-[360px] overflow-y-auto divide-y divide-[#E1E4EA]">
              {error ? (
                <div className="p-4 text-xs text-red-600 bg-red-50 flex items-center gap-2">
                  <AlertCircle size={15} />
                  <span>{error}</span>
                </div>
              ) : loading ? (
                <div className="p-6 text-center text-xs text-[#5D6472]">
                  Actualizando alertas…
                </div>
              ) : items.some((item) => item.type !== 'new_match') || pendingMatches > 0 ? (
                <>
                {pendingMatches > 0 && (
                  <button type="button" onClick={onPending} className="m-3 mb-1 w-[calc(100%-1.5rem)] rounded-xl border border-[#D9D1FF] bg-[#F6F3FF] p-3 text-left hover:bg-[#F0EDFF] transition-colors">
                    <span className="flex items-center justify-between gap-2"><span className="inline-flex items-center gap-2 text-xs font-bold text-[#5636D9]"><Sparkles size={14}/> Nuevas licitaciones encontradas</span><span className="rounded-full bg-[#5636D9] px-2 py-0.5 text-[11px] font-bold text-white">{pendingMatches}</span></span>
                    <span className="mt-1 block text-[11px] leading-4 text-[#5D6472]">El Calificador comercial IA encontró oportunidades para revisar.</span>
                    <span className="mt-2 block text-[11px] font-semibold text-[#5636D9]">Abrir pendientes de revisión →</span>
                  </button>
                )}
                {items.filter((item) => item.type !== 'new_match').slice(0, 5).map((item) => (
                  <div
                    key={item.id}
                    className={`p-3.5 flex items-start gap-3 hover:bg-gray-50 transition-colors ${
                      item.readAt ? 'opacity-70 bg-white' : 'bg-[#f0edff]/20'
                    }`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                        item.readAt ? 'bg-transparent' : 'bg-[#5636D9]'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => onOpen(item)}
                        className="text-left font-semibold text-xs text-[#171A24] hover:text-[#5636D9] truncate block w-full"
                      >
                        {item.title}
                      </button>
                      <p className="text-[11px] text-[#5D6472] line-clamp-2 mt-0.5">
                        {item.message}
                      </p>
                      <span className="text-[10px] text-[#8A92A6] block mt-1">
                        {timeLabel(item.dueAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!item.readAt && (
                        <button
                          title="Marcar como leída"
                          onClick={() => onRead(item.id)}
                          className="w-6 h-6 rounded text-[#5D6472] hover:text-[#5636D9] hover:bg-gray-100 flex items-center justify-center"
                        >
                          <Check size={13} />
                        </button>
                      )}
                      <button
                        title="Descartar"
                        onClick={() => onDismiss(item.id)}
                        className="w-6 h-6 rounded text-[#5D6472] hover:text-red-600 hover:bg-gray-100 flex items-center justify-center"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                ))}
                </>
              ) : (
                <div className="p-6 text-center text-xs text-[#5D6472] space-y-1">
                  <CheckCircle2 size={24} className="mx-auto text-[#5636D9] mb-2 opacity-80" />
                  <div className="font-semibold text-[#171A24]">Todo al día</div>
                  <p>No tienes alertas pendientes en este momento.</p>
                </div>
              )}
            </div>

            <footer className="p-3 bg-[#F8F9FA] border-t border-[#E1E4EA] text-center">
              <button
                onClick={onNavigate}
                className="text-xs font-semibold text-[#5636D9] hover:underline inline-flex items-center gap-1"
              >
              Ver centro de alertas <ExternalLink size={12} />
              </button>
            </footer>
          </section>
        </>
      )}
    </div>
  );
}

export function AlertsPage({
  items,
  overview,
  filter,
  onFilter,
  onRead,
  onDismiss,
  onOpen,
  loading,
  error,
  csrfToken,
  canManageCompany,
  canRunSearch,
  onRunSearch,
  onGoToTracking,
}: {
  items: AlertItem[];
  overview: AlertOverview | null;
  filter: string;
  onFilter: (value: string) => void;
  onRead: (id: number) => void;
  onDismiss: (id: number) => void;
  onOpen: (item: AlertItem) => void;
  loading: boolean;
  error: string;
  csrfToken: string;
  canManageCompany: boolean;
  canRunSearch: boolean;
  onRunSearch: () => Promise<{ evaluated: number; created: number; configured: boolean; locked: boolean }>;
  onGoToTracking: () => void;
}) {
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');
  const [searchError, setSearchError] = useState('');
  const runSearch = async () => {
    setSearching(true); setSearchMessage(''); setSearchError('');
    try {
      const result = await onRunSearch();
      setSearchMessage(!result.configured ? 'Agrega rubros o palabras clave al perfil comercial para activar coincidencias.' : result.created ? `Búsqueda terminada: ${result.created} coincidencias nuevas entre ${result.evaluated} fichas revisadas.` : `Búsqueda terminada: se revisaron ${result.evaluated} fichas. No aparecieron coincidencias nuevas.`);
    } catch (cause) { setSearchError(cause instanceof Error ? cause.message : 'No se pudo completar la búsqueda.'); }
    finally { setSearching(false); }
  };
  const openOverviewItem = (item: { id: number; code: string; title: string; dueAt: string; message?: string }) => onOpen({ id: item.id, opportunityId: 0, type: 'overview', title: item.title, message: item.message ?? '', dueAt: item.dueAt, readAt: null, createdAt: item.dueAt, code: item.code, listingName: item.title });
  return (
    <div className="space-y-6">
      {/* Top Heading */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold text-[#5636D9] uppercase tracking-wider mb-1">
            Actividad y Avisos
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#171A24] tracking-tight">
            Alertas
          </h1>
          <p className="text-sm text-[#5D6472] mt-1">
            Revisa avisos de cierre y oportunidades que tienes en seguimiento.
          </p>
        </div>

      </div>

      <div className="rounded-2xl border border-[#D9D1FF] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div><div className="flex items-center gap-2 text-sm font-bold text-[#171A24]"><Sparkles size={17} className="text-[#5636D9]"/> Prioridades de tu empresa</div><p className="mt-1 text-sm text-[#5D6472]">Cierres, tareas y oportunidades relacionadas con tu perfil en el índice local.</p></div>
          {canRunSearch && <button type="button" onClick={() => void runSearch()} disabled={searching||loading} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#5636D9] px-4 text-sm font-semibold text-white hover:bg-[#4829c7] disabled:cursor-wait disabled:opacity-60">{searching?<LoaderCircle size={16} className="animate-spin"/>:<Search size={16}/>} {searching?'Buscando en el índice…':'Buscar coincidencias ahora'}</button>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
          {[
            ['En seguimiento', overview?.trackedActive],
            ['Cierran en 7 días', overview?.closingIn7Days],
            ['Tareas atrasadas', overview?.overdueTasks],
            ['Tareas próximos 7 días', overview?.tasksIn7Days],
            ['Coincidencias sin leer', overview?.newMatches],
          ].map(([label,value])=><div key={String(label)} className="rounded-xl border border-[#E1E4EA] bg-[#F9FAFC] p-3"><span className="block text-xs font-medium text-[#687287]">{label}</span><strong className="mt-1 block text-2xl font-bold tabular-nums text-[#171A24]">{value==null?'—':new Intl.NumberFormat('es-CL').format(Number(value))}</strong></div>)}
        </div>
        {searchMessage&&<p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{searchMessage}</p>}
        {searchError&&<p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{searchError}</p>}
        {overview&&<div className="mt-4 grid gap-4 xl:grid-cols-3">
          <section className="min-w-0 rounded-xl border border-[#E1E4EA] p-4"><h3 className="flex items-center gap-2 text-sm font-bold text-[#252A37]"><CalendarDays size={16} className="text-[#5636D9]"/> Próximos cierres</h3>{overview.nextClosings.length?<div className="mt-2 divide-y divide-[#E9ECF1]">{overview.nextClosings.map(row=><button key={row.id} type="button" onClick={()=>openOverviewItem({id:row.id,code:row.code,title:row.title,dueAt:row.dueAt,message:row.buyer??''})} className="block w-full py-2 text-left"><span className="block truncate text-sm font-semibold text-[#252A37]">{row.title}</span><span className="mt-0.5 block text-xs text-[#697387]">{row.code} · {row.buyer||'Comprador no informado'}</span><span className="mt-1 block text-xs font-semibold text-amber-700">Cierra {timeLabel(row.dueAt)}</span></button>)}</div>:<p className="mt-2 text-sm leading-5 text-[#697387]">No hay cierres dentro de 7 días entre las oportunidades guardadas.</p>}</section>
          <section className="min-w-0 rounded-xl border border-[#E1E4EA] p-4"><h3 className="flex items-center gap-2 text-sm font-bold text-[#252A37]"><ClipboardList size={16} className="text-[#5636D9]"/> Tareas de seguimiento</h3>{overview.nextTasks.length?<div className="mt-2 divide-y divide-[#E9ECF1]">{overview.nextTasks.map(row=><button key={row.id} type="button" onClick={()=>openOverviewItem({id:row.id,code:row.code,title:row.title,dueAt:row.dueAt,message:row.label})} className="block w-full py-2 text-left"><span className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${row.overdue?'bg-red-50 text-red-700':'bg-violet-50 text-violet-700'}`}>{row.overdue?'Atrasada':timeLabel(row.dueAt)}</span><span className="mt-1 block truncate text-sm font-semibold text-[#252A37]">{row.label}</span><span className="block truncate text-xs text-[#697387]">{row.code} · {row.title}</span></button>)}</div>:<><p className="mt-2 text-sm leading-5 text-[#697387]">No hay tareas vencidas ni con fecha dentro de 7 días.</p><button type="button" onClick={onGoToTracking} className="mt-3 text-sm font-semibold text-[#5636D9] hover:underline">Abrir seguimiento y planificar tareas →</button></>}</section>
          <section className="min-w-0 rounded-xl border border-[#E1E4EA] p-4"><h3 className="flex items-center gap-2 text-sm font-bold text-[#252A37]"><Sparkles size={16} className="text-[#5636D9]"/> Coincidencias recientes</h3>{overview.recentMatches.length?<div className="mt-2 divide-y divide-[#E9ECF1]">{overview.recentMatches.map(item=><button key={item.id} type="button" onClick={()=>onOpen(item)} className="block w-full py-2 text-left"><span className="block truncate text-sm font-semibold text-[#252A37]">{item.listingName||item.title}</span><span className="mt-0.5 block text-xs text-[#697387]">{item.code} · {item.matchLevel==='high'?'Coincidencia alta':item.matchLevel==='medium'?'Coincidencia media':'Coincidencia exploratoria'}{item.matchScore!=null?` · ${item.matchScore}/100`:''}</span><span className="mt-1 block line-clamp-2 text-xs text-[#697387]">{item.message||'Revisar ficha y criterios de coincidencia.'}</span></button>)}</div>:<p className="mt-2 text-sm leading-5 text-[#697387]">Aún no hay coincidencias guardadas. Ejecuta la búsqueda para cruzar tu perfil con fichas indexadas.</p>}</section>
        </div>}
        <p className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-[#7A8497]"><span>La búsqueda automática usa datos ya indexados en Oportuna; no consulta Mercado Público en tiempo real.</span>{overview&&<span>Datos actualizados {timeLabel(overview.generatedAt)}</span>}</p>
      </div>

      {/* TAB 1: REAL ALERTS LIST */}
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex items-center gap-2 flex-wrap bg-white p-3 rounded-xl border border-[#E1E4EA] shadow-sm">
            <span className="text-xs font-semibold text-[#5D6472] flex items-center gap-1 mr-1">
              <Filter size={14} /> Filtro:
            </span>
            {[
              { id: 'pending', label: 'Pendientes de revisar' },
              { id: 'all', label: 'Todas' },
              { id: 'unread', label: 'Sin leer' },
              { id: 'closing', label: 'Cierres próximos' },
              { id: 'followup', label: 'Seguimiento' },
              { id: 'matches', label: 'Nuevas coincidencias' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => onFilter(f.id)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  filter === f.id
                    ? 'bg-[#f0edff] text-[#5636D9] border border-[#5636D9]/30'
                    : 'text-[#5D6472] hover:bg-gray-50 border border-transparent'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filter === 'pending' && (
            <div className="rounded-xl border border-[#D9D1FF] bg-[#F6F3FF] px-4 py-3 text-sm text-[#4C5568]">
              <div className="flex items-center gap-2 font-semibold text-[#5636D9]"><Sparkles size={16}/> Licitaciones nuevas para revisar</div>
              <p className="mt-1 text-xs leading-5">El agente Calificador comercial compara tu perfil y catálogo con las fichas disponibles en el índice local. Abre cada resultado para revisar sus antecedentes y marcarlo como revisado.</p>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="p-8 text-center text-sm text-[#5D6472] bg-white rounded-xl border border-[#E1E4EA]">
              Cargando tus alertas y datos de seguimiento…
            </div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-xl border border-[#E1E4EA] space-y-3">
              <div className="w-12 h-12 rounded-xl bg-[#f0edff] text-[#5636D9] flex items-center justify-center mx-auto">
                <Bell size={22} />
              </div>
              <h3 className="font-bold text-base text-[#171A24]">
                No hay avisos activos en este filtro
              </h3>
              <p className="text-xs text-[#5D6472] max-w-sm mx-auto">
                Los avisos aparecen cuando una oportunidad guardada se acerca a su cierre, cuando vence una tarea de seguimiento o cuando la búsqueda del perfil encuentra una coincidencia nueva.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {items.map((item) => (
                <article
                  key={item.id}
                  className={`p-4 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                    item.readAt
                      ? 'bg-white border-[#E1E4EA] opacity-80'
                      : 'bg-white border-[#5636D9]/30 shadow-sm'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        item.type.includes('urgent') || item.type.includes('close')
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-[#f0edff] text-[#5636D9]'
                      }`}
                    >
                      {item.type.includes('urgent') || item.type.includes('close') ? (
                        <AlertTriangle size={18} />
                      ) : (
                        <Clock size={18} />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => onOpen(item)}
                          className="font-bold text-sm text-[#171A24] hover:text-[#5636D9] text-left"
                        >
                          {item.title}
                        </button>
                        {!item.readAt && (
                          <span className="bg-[#5636D9] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                            Nueva
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#5D6472] mt-1">{item.message}</p>
                      <div className="flex items-center gap-3 text-[11px] text-[#8A92A6] mt-1.5">
                        <span>Código MP: <b className="text-[#171A24]">{item.code}</b></span>
                        <span>•</span>
                        <span>{timeLabel(item.dueAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <button
                      onClick={() => onOpen(item)}
                      className="h-9 px-3 bg-[#f0edff] hover:bg-[#e4ddff] text-[#5636D9] text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                    >
                      Ver licitación <ExternalLink size={13} />
                    </button>
                    {!item.readAt && (
                      <button
                        title="Marcar como leída"
                        onClick={() => onRead(item.id)}
                        className="h-9 px-2.5 bg-white border border-[#E1E4EA] hover:bg-gray-50 text-[#5D6472] text-xs font-semibold rounded-lg"
                      >
                        <Check size={15} />
                      </button>
                    )}
                    <button
                      title="Descartar"
                      onClick={() => onDismiss(item.id)}
                      className="h-9 px-2.5 bg-white border border-[#E1E4EA] hover:bg-gray-50 text-[#5D6472] hover:text-red-600 text-xs font-semibold rounded-lg"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
      </div>
      <details className="rounded-xl border border-[#E1E4EA] bg-white px-4 py-3"><summary className="cursor-pointer text-sm font-semibold text-[#4C5568]">Configuración de búsqueda automática</summary><div className="mt-3"><ProactiveSearchControls csrfToken={csrfToken} canManageCompany={canManageCompany}/></div></details>
    </div>
  );
}
