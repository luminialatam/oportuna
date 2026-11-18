import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  X,
} from 'lucide-react';

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
  open,
  loading,
  error,
  onToggle,
  onNavigate,
  onRead,
  onDismiss,
  onOpen,
}: {
  items: AlertItem[];
  unread: number;
  open: boolean;
  loading: boolean;
  error: string;
  onToggle: () => void;
  onNavigate: () => void;
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
              ) : items.length ? (
                items.slice(0, 5).map((item) => (
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
                ))
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
  filter,
  onFilter,
  onRead,
  onDismiss,
  onOpen,
  loading,
  error,
}: {
  items: AlertItem[];
  filter: string;
  onFilter: (value: string) => void;
  onRead: (id: number) => void;
  onDismiss: (id: number) => void;
  onOpen: (item: AlertItem) => void;
  loading: boolean;
  error: string;
}) {
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

      {/* TAB 1: REAL ALERTS LIST */}
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex items-center gap-2 flex-wrap bg-white p-3 rounded-xl border border-[#E1E4EA] shadow-sm">
            <span className="text-xs font-semibold text-[#5D6472] flex items-center gap-1 mr-1">
              <Filter size={14} /> Filtro:
            </span>
            {[
              { id: 'all', label: 'Todas' },
              { id: 'unread', label: 'Sin leer' },
              { id: 'closing', label: 'Cierres próximos (24h/48h)' },
              { id: 'followup', label: 'Seguimiento' },
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

          {error && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="p-8 text-center text-sm text-[#5D6472] bg-white rounded-xl border border-[#E1E4EA]">
              Consultando eventos de alerta en tiempo real…
            </div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-xl border border-[#E1E4EA] space-y-3">
              <div className="w-12 h-12 rounded-xl bg-[#f0edff] text-[#5636D9] flex items-center justify-center mx-auto">
                <Bell size={22} />
              </div>
              <h3 className="font-bold text-base text-[#171A24]">
                No hay alertas activas en esta vista
              </h3>
              <p className="text-xs text-[#5D6472] max-w-sm mx-auto">
                Las alertas se generan automáticamente cuando las licitaciones guardadas en tu
                seguimiento tienen plazos de cierre a 72h, 48h o 24 horas.
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
    </div>
  );
}
