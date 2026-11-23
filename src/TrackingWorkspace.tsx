import { useCallback, useEffect, useState } from 'react';
import { TrackingCalendar } from './TrackingCalendar';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Kanban,
  List,
  LoaderCircle,
  Search,
  Trash2,
  X,
} from 'lucide-react';

export type Tracked = {
  id: number;
  codigo: string;
  estado: string;
  notes: string;
  listing: {
    nombre: string | null;
    codigoEstado: number | null;
    fechaCierre: string | null;
    organismo: string | null;
    montoEstimado: string | number | null;
    moneda: string | null;
  };
  dates: { id: number; label: string; dueAt: string; notes: string; completed: boolean }[];
};

const STAGES = [
  { id: 'saved', label: 'Guardadas', color: 'bg-gray-100 text-[#5D6472]' },
  { id: 'evaluating', label: 'En evaluación', color: 'bg-blue-100 text-blue-700' },
  { id: 'preparing_offer', label: 'Preparando oferta', color: 'bg-purple-100 text-purple-700' },
  { id: 'submitted', label: 'Presentadas', color: 'bg-emerald-100 text-emerald-700' },
  { id: 'discarded', label: 'Descartadas', color: 'bg-red-100 text-red-700' },
];

async function request<T>(url: string, options?: RequestInit, csrfToken = ''): Promise<T> {
  const headers = new Headers(options?.headers);
  const method = (options?.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la solicitud.');
  return data as T;
}

const dateLabel = (value: string | null) => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? '—'
    : new Intl.DateTimeFormat('es-CL', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(parsed);
};

const money = (value: string | number | null, currency: string | null) => {
  if (value == null || value === '') return '—';
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: currency || 'CLP',
    maximumFractionDigits: 0,
  }).format(Number(value));
};

export function TrackingWorkspace({
  onOpen,
  onChanged,
  csrfToken,
  calendar = false,
}: {
  onOpen: (codigo: string) => void;
  onChanged: () => void;
  csrfToken: string;
  calendar?: boolean;
}) {
  const [items, setItems] = useState<Tracked[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [activeNotesId, setActiveNotesId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (filter) params.set('estado', filter);
      if (query.trim()) params.set('q', query.trim());
      const result = await request<{ items: Tracked[]; counts: Record<string, number> }>(
        `/api/company/tracking?${params}`
      );
      setItems(result.items);
      setCounts(result.counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar Seguimiento.');
    } finally {
      setLoading(false);
    }
  }, [filter, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = async (id: number, body: unknown) => {
    setBusy(id);
    setError('');
    try {
      await request(
        `/api/company/tracking/${id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        csrfToken
      );
      await load();
      onChanged();
      setNotice('Cambios guardados exitosamente.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm('¿Quitar esta licitación de tu tablero de seguimiento?')) return;
    try {
      await request(`/api/company/tracking/${id}`, { method: 'DELETE' }, csrfToken);
      await load();
      onChanged();
      setNotice('Licitación eliminada del seguimiento.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo quitar la licitación.');
    }
  };

  if (calendar) {
    return (
      <TrackingCalendar
        items={items}
        total={Object.values(counts).reduce((sum, count) => sum + count, 0)}
        loading={loading}
        error={error}
        onRetry={() => void load()}
        onOpen={onOpen}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold text-[#5636D9] uppercase tracking-wider mb-1">
            Gestión y Pipeline
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#171A24] tracking-tight">
            Seguimiento de Oportunidades
          </h1>
          <p className="text-sm text-[#5D6472] mt-1">
            Gestiona el ciclo de vida de tus licitaciones guardadas, prepara ofertas y asigna plazos.
          </p>
        </div>

        {/* View mode switcher */}
        <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-[#E1E4EA] shadow-sm self-start sm:self-auto">
          <button
            onClick={() => setViewMode('kanban')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              viewMode === 'kanban'
                ? 'bg-[#5636D9] text-white shadow-sm'
                : 'text-[#5D6472] hover:bg-gray-100'
            }`}
          >
            <Kanban size={14} /> Tablero
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              viewMode === 'list'
                ? 'bg-[#5636D9] text-white shadow-sm'
                : 'text-[#5D6472] hover:bg-gray-100'
            }`}
          >
            <List size={14} /> Lista
          </button>
        </div>
      </div>

      {/* Toolbar & Stage filter pills */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-[#E1E4EA] shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-3 text-[#8A92A6]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por título, código u organismo..."
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-[#E1E4EA] text-xs text-[#171A24] focus:outline-none focus:border-[#5636D9]"
          />
        </div>

        {/* Stage counts */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
          <button
            onClick={() => setFilter('')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
              filter === ''
                ? 'bg-[#171A24] text-white'
                : 'bg-[#F8F9FA] text-[#5D6472] hover:bg-gray-200'
            }`}
          >
            Todas ({items.length})
          </button>
          {STAGES.map((st) => (
            <button
              key={st.id}
              onClick={() => setFilter(filter === st.id ? '' : st.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 transition-all ${
                filter === st.id
                  ? 'bg-[#5636D9] text-white'
                  : 'bg-[#F8F9FA] text-[#5D6472] hover:bg-gray-200'
              }`}
            >
              <span>{st.label}</span>
              <b className="px-1.5 py-0.2 rounded-full bg-white/20 text-[10px]">
                {counts[st.id] ?? 0}
              </b>
            </button>
          ))}
        </div>
      </div>

      {/* Alerts / Feedback */}
      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="p-3 rounded-xl bg-[#f0edff] border border-[#5636D9]/30 text-xs text-[#5636D9] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} />
            <span>{notice}</span>
          </div>
          <button onClick={() => setNotice('')} className="text-[#5636D9]">
            <X size={14} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-sm text-[#5D6472] bg-white rounded-xl border border-[#E1E4EA]">
          <LoaderCircle size={24} className="spin mx-auto text-[#5636D9] mb-2" />
          Cargando tu tablero de seguimiento…
        </div>
      ) : items.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-[#E1E4EA] space-y-3">
          <div className="w-12 h-12 rounded-xl bg-[#f0edff] text-[#5636D9] flex items-center justify-center mx-auto">
            <Activity size={24} />
          </div>
          <h3 className="font-bold text-base text-[#171A24]">
            Aún no tienes licitaciones en seguimiento
          </h3>
          <p className="text-xs text-[#5D6472] max-w-sm mx-auto">
            Explora las oportunidades en "Buscar oportunidades" o "Resumen" y haz clic en "Guardar en
            seguimiento" para comenzar a gestionar tus postulaciones aquí.
          </p>
        </div>
      ) : viewMode === 'kanban' ? (
        /* KANBAN VIEW */
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4 items-start overflow-x-auto pb-4">
          {STAGES.map((col) => {
            const colItems = items.filter((item) => item.estado === col.id);
            return (
              <div
                key={col.id}
                className="bg-[#F8F9FA] rounded-xl border border-[#E1E4EA] p-3 flex flex-col gap-3 min-w-[240px]"
              >
                {/* Column Header */}
                <div className="flex items-center justify-between pb-2 border-b border-[#E1E4EA]">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-[#171A24]">{col.label}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white text-[#5D6472] border border-[#E1E4EA]">
                      {colItems.length}
                    </span>
                  </div>
                </div>

                {/* Cards */}
                <div className="space-y-3">
                  {colItems.map((item) => (
                    <article
                      key={item.id}
                      className="bg-white rounded-xl border border-[#E1E4EA] p-4 shadow-sm hover:shadow transition-shadow space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          onClick={() => onOpen(item.codigo)}
                          className="font-bold text-xs text-[#171A24] hover:text-[#5636D9] text-left line-clamp-2"
                        >
                          {item.listing.nombre || 'Licitación sin nombre'}
                        </button>
                        <button
                          onClick={() => void remove(item.id)}
                          className="text-[#8A92A6] hover:text-red-600 transition-colors shrink-0"
                          title="Eliminar de seguimiento"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      <div className="text-[11px] text-[#5D6472] space-y-0.5">
                        <p className="truncate">{item.listing.organismo || 'Organismo no informado'}</p>
                        <p className="font-mono text-[#8A92A6]">{item.codigo}</p>
                      </div>

                      <div className="pt-2 border-t border-[#E1E4EA] flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#171A24]">
                          {money(item.listing.montoEstimado, item.listing.moneda)}
                        </span>
                        <span className="text-[11px] text-[#5D6472] flex items-center gap-1">
                          <Clock size={12} />
                          {dateLabel(item.listing.fechaCierre)}
                        </span>
                      </div>

                      {/* Stage selector dropdown */}
                      <div className="pt-1">
                        <label className="block text-[10px] text-[#8A92A6] mb-1 font-semibold uppercase">
                          Mover etapa:
                        </label>
                        <select
                          value={item.estado}
                          disabled={busy === item.id}
                          onChange={(e) => void update(item.id, { estado: e.target.value })}
                          className="w-full h-8 px-2 rounded-lg border border-[#E1E4EA] text-xs text-[#171A24] bg-white focus:outline-none focus:border-[#5636D9]"
                        >
                          {STAGES.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Notes & Actions */}
                      <div className="pt-1 flex items-center justify-between">
                        <button
                          onClick={() =>
                            setActiveNotesId(activeNotesId === item.id ? null : item.id)
                          }
                          className="text-xs text-[#5636D9] hover:underline flex items-center gap-1"
                        >
                          {item.notes ? 'Editar notas' : '+ Agregar nota'}
                        </button>
                        <button
                          onClick={() => onOpen(item.codigo)}
                          className="text-xs font-semibold text-[#5D6472] hover:text-[#171A24] flex items-center gap-1"
                        >
                          Ficha <ArrowRight size={12} />
                        </button>
                      </div>

                      {/* Expanded notes */}
                      {activeNotesId === item.id && (
                        <div className="p-3 rounded-lg bg-[#F8F9FA] border border-[#E1E4EA] space-y-2 mt-2">
                          <textarea
                            rows={3}
                            value={item.notes}
                            onChange={(e) => {
                              const val = e.target.value;
                              setItems((prev) =>
                                prev.map((r) => (r.id === item.id ? { ...r, notes: val } : r))
                              );
                            }}
                            placeholder="Notas del equipo, requisitos clave..."
                            className="w-full p-2 text-xs border border-[#E1E4EA] rounded-lg bg-white focus:outline-none focus:border-[#5636D9]"
                          />
                          <button
                            onClick={() => void update(item.id, { notes: item.notes })}
                            disabled={busy === item.id}
                            className="w-full py-1.5 bg-[#5636D9] hover:bg-[#4b2ec7] text-white text-xs font-semibold rounded-lg"
                          >
                            Guardar notas
                          </button>
                        </div>
                      )}
                    </article>
                  ))}

                  {colItems.length === 0 && (
                    <div className="py-8 text-center text-xs text-[#8A92A6] border border-dashed border-[#E1E4EA] rounded-xl">
                      Sin oportunidades en esta etapa
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* LIST VIEW */
        <div className="bg-white rounded-xl border border-[#E1E4EA] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F8F9FA] border-b border-[#E1E4EA] text-[#5D6472] font-semibold">
                <tr>
                  <th className="py-3 px-4">OPORTUNIDAD</th>
                  <th className="py-3 px-4">ORGANISMO</th>
                  <th className="py-3 px-4">MONTO</th>
                  <th className="py-3 px-4">CIERRE</th>
                  <th className="py-3 px-4">ETAPA</th>
                  <th className="py-3 px-4 text-right">ACCIONES</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E4EA]">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4">
                      <button
                        onClick={() => onOpen(item.codigo)}
                        className="font-bold text-[#171A24] hover:text-[#5636D9] text-left block max-w-sm truncate"
                      >
                        {item.listing.nombre || 'Licitación sin nombre'}
                      </button>
                      <span className="font-mono text-[11px] text-[#8A92A6]">{item.codigo}</span>
                    </td>
                    <td className="py-3 px-4 text-[#5D6472] max-w-xs truncate">
                      {item.listing.organismo || 'No informado'}
                    </td>
                    <td className="py-3 px-4 font-semibold text-[#171A24]">
                      {money(item.listing.montoEstimado, item.listing.moneda)}
                    </td>
                    <td className="py-3 px-4 text-[#5D6472]">{dateLabel(item.listing.fechaCierre)}</td>
                    <td className="py-3 px-4">
                      <select
                        value={item.estado}
                        disabled={busy === item.id}
                        onChange={(e) => void update(item.id, { estado: e.target.value })}
                        className="h-8 px-2 rounded-lg border border-[#E1E4EA] text-xs font-semibold text-[#171A24] bg-white"
                      >
                        {STAGES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <button
                        onClick={() => onOpen(item.codigo)}
                        className="text-[#5636D9] font-semibold hover:underline"
                      >
                        Ver ficha
                      </button>
                      <button
                        onClick={() => void remove(item.id)}
                        className="text-[#8A92A6] hover:text-red-600"
                        title="Eliminar"
                      >
                        <Trash2 size={14} className="inline" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
