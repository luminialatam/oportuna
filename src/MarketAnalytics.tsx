import {
  Activity,
  ArrowRight,
  BarChart3,
  Building,
  CheckCircle2,
  Database,
  Info,
  PieChart,
} from 'lucide-react';
import './MarketAnalytics.css';

type Listing = {
  codigo_externo: string;
  nombre: string | null;
  codigo_estado: number | null;
  fecha_cierre: string | null;
  organismo: string | null;
  monto_estimado: string | number | null;
  moneda: string | null;
};

type MarketSummary = {
  total: number;
  estados: { codigoEstado: number | null; total: number }[];
  ultimaSincronizacion: {
    startedAt?: string | null;
    fechaConsultada?: string | null;
    estado?: string | null;
    totalRecibidos?: number | null;
    totalInsertados?: number | null;
    totalActualizados?: number | null;
  } | null;
  ultimasLicitaciones: Listing[];
};

type Props = {
  summary: MarketSummary | null;
  health: { ok: boolean; apiConfigured: boolean; mysql: boolean } | null;
  error?: string;
  onOpenListing: (code: string) => void;
  onViewListings: () => void;
  onRetry: () => void;
};

const stateLabels: Record<number, string> = {
  5: 'Publicada',
  6: 'Cerrada',
  7: 'Desierta',
  8: 'Adjudicada',
  15: 'Revocada',
  18: 'Revocada',
  19: 'Suspendida',
};

const count = (value: number) => new Intl.NumberFormat('es-CL').format(value);

export function MarketAnalytics({
  summary,
  health: _health,
  error,
  onOpenListing: _onOpenListing,
  onViewListings,
  onRetry,
}: Props) {
  const totalListings = summary?.total ?? 0;
  const states = summary?.estados ?? [];
  const publishedCount = states.find((s) => s.codigoEstado === 5)?.total ?? 0;
  const awardedCount = states.find((s) => s.codigoEstado === 8)?.total ?? 0;
  const desertedCount = states.find((s) => s.codigoEstado === 7)?.total ?? 0;

  // Compute buyers distribution from latest listings
  const buyerCounts: Record<string, number> = {};
  for (const item of summary?.ultimasLicitaciones ?? []) {
    if (item.organismo) {
      buyerCounts[item.organismo] = (buyerCounts[item.organismo] || 0) + 1;
    }
  }
  const topBuyers = Object.entries(buyerCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Header with Source Label */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold text-[#5636D9] uppercase tracking-wider">
              Índice actual de Mercado Público
            </span>
            <span className="text-[10px] bg-[#f0edff] text-[#5636D9] font-semibold px-2 py-0.5 rounded-full">
              Fuente: datos sincronizados localmente
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#171A24] tracking-tight">
            Inteligencia de mercado
          </h1>
          <p className="text-sm text-[#5D6472] mt-1">
            Consulta la distribución actual del índice y una muestra de compradores recientes.
          </p>
        </div>

      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Info size={16} />
            <span>{error}</span>
          </div>
          <button onClick={onRetry} className="font-semibold underline">
            Reintentar
          </button>
        </div>
      )}

      <div className="space-y-6">
          {/* 4 KPIs Grid (Stitch 4 design) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-[#E1E4EA] p-5 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#5D6472] uppercase">
                  Licitaciones Indexadas
                </span>
                <div className="w-8 h-8 rounded-lg bg-[#f0edff] text-[#5636D9] flex items-center justify-center">
                  <Database size={16} />
                </div>
              </div>
              <div className="text-2xl font-bold text-[#171A24]">{count(totalListings)}</div>
              <p className="text-[11px] text-[#8A92A6]">Registros almacenados en MySQL local</p>
            </div>

            <div className="bg-white rounded-xl border border-[#E1E4EA] p-5 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#5D6472] uppercase">
                  Oportunidades Abiertas
                </span>
                <div className="w-8 h-8 rounded-lg bg-[#f0edff] text-[#5636D9] flex items-center justify-center">
                  <Activity size={16} />
                </div>
              </div>
              <div className="text-2xl font-bold text-[#171A24]">{count(publishedCount)}</div>
              <p className="text-[11px] text-[#8A92A6]">En plazo de postulación oficial</p>
            </div>

            <div className="bg-white rounded-xl border border-[#E1E4EA] p-5 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#5D6472] uppercase">
                  Procesos Adjudicados
                </span>
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                  <CheckCircle2 size={16} />
                </div>
              </div>
              <div className="text-2xl font-bold text-[#171A24]">{count(awardedCount)}</div>
              <p className="text-[11px] text-[#8A92A6]">Historial con adjudicatario asignado</p>
            </div>

            <div className="bg-white rounded-xl border border-[#E1E4EA] p-5 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#5D6472] uppercase">
                  Tasa de Desiertas
                </span>
                <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                  <PieChart size={16} />
                </div>
              </div>
              <div className="text-2xl font-bold text-[#171A24]">
                {totalListings > 0 ? `${Math.round((desertedCount / totalListings) * 100)}%` : '0%'}
              </div>
              <p className="text-[11px] text-[#8A92A6]">{count(desertedCount)} licitaciones desiertas</p>
            </div>
          </div>

          {/* Comparative Distribution Panels (Stitch 4 design) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Panel 1: State Breakdown */}
            <div className="bg-white rounded-xl border border-[#E1E4EA] p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm text-[#171A24] flex items-center gap-2">
                  <BarChart3 size={17} className="text-[#5636D9]" />
                  Distribución por Estado Oficial
                </h3>
                <span className="text-xs text-[#8A92A6]">{totalListings} total</span>
              </div>

              <div className="space-y-3">
                {states.map((st) => {
                  const pct = totalListings > 0 ? Math.round((st.total / totalListings) * 100) : 0;
                  const label =
                    st.codigoEstado == null ? 'Sin estado' : stateLabels[st.codigoEstado] ?? `Estado ${st.codigoEstado}`;
                  return (
                    <div key={String(st.codigoEstado)} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[#171A24]">{label}</span>
                        <span className="font-semibold text-[#5D6472]">
                          {count(st.total)} ({pct}%)
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-[#F5F6F8] overflow-hidden">
                        <div
                          className="h-full bg-[#5636D9] rounded-full transition-all"
                          style={{ width: `${Math.max(3, pct)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Panel 2: Top Buyers from Database */}
            <div className="bg-white rounded-xl border border-[#E1E4EA] p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-[#171A24] flex items-center gap-2">
                    <Building size={17} className="text-[#5636D9]" />
                    Muestra de Compradores Recientes
                  </h3>
                  <span className="text-[10px] text-[#8A92A6]">
                    Basado en las últimas licitaciones devueltas por /api/resumen
                  </span>
                </div>
                <button
                  onClick={onViewListings}
                  className="text-xs text-[#5636D9] font-semibold hover:underline flex items-center gap-1"
                >
                  Ver todos <ArrowRight size={13} />
                </button>
              </div>

              {topBuyers.length > 0 ? (
                <div className="divide-y divide-[#E1E4EA]">
                  {topBuyers.map(([buyer, num]) => (
                    <div key={buyer} className="py-2.5 flex items-center justify-between text-xs">
                      <span className="font-medium text-[#171A24] max-w-xs truncate">{buyer}</span>
                      <span className="px-2 py-0.5 rounded-full bg-[#F5F6F8] text-[#5D6472] font-bold">
                        {num} en muestra
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-xs text-[#8A92A6]">
                  Sincroniza licitaciones para generar el ranking de compradores.
                </div>
              )}
            </div>
          </div>
        </div>


    </div>
  );
}
