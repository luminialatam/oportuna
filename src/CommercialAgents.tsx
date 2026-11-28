import { Activity, Calculator, FileSearch, Sparkles } from 'lucide-react';
import { CompanyOpportunities } from './CompanyWorkspace';

const agents = [
  {
    icon: TargetIcon,
    name: 'Calificador comercial',
    status: 'En uso',
    description: 'Compara el catálogo de Andes Organics con título, descripción y partidas del índice local.',
    output: 'Ordena oportunidades y explica qué coincidencias encontró.',
    limitation: 'El puntaje es textual; no estima la probabilidad de adjudicación ni confirma elegibilidad.',
    tone: 'emerald',
  },
  {
    icon: FileSearch,
    name: 'Analista de ficha',
    status: 'Bajo demanda',
    description: 'Resume datos estructurados de una ficha y señala información que falta.',
    output: 'Muestra hechos, riesgos visibles y un siguiente paso para revisar.',
    limitation: 'Las bases y anexos deben abrirse y revisarse en la fuente oficial; no se marcan como leídos.',
    tone: 'violet',
  },
  {
    icon: Calculator,
    name: 'Evaluador de margen',
    status: 'Con datos del equipo',
    description: 'Calcula venta proyectada, costo directo y margen bruto por partida.',
    output: 'Compara el escenario ingresado con el margen objetivo de la empresa.',
    limitation: 'Usa cantidades de la ficha y costos/precios que ingresa el equipo; no calcula utilidad neta.',
    tone: 'amber',
  },
  {
    icon: Activity,
    name: 'Seguimiento comercial',
    status: 'Reglas activas',
    description: 'Organiza oportunidades guardadas, hitos y recordatorios de cierre.',
    output: 'Mantiene visibles las tareas y fechas próximas del equipo.',
    limitation: 'Las etapas y resultados comerciales los actualiza el equipo.',
    tone: 'blue',
  },
];

function TargetIcon({ size = 18, className = '' }: { size?: number; className?: string }) {
  return <Sparkles size={size} className={className} />;
}

const toneClasses: Record<string, string> = {
  emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  violet: 'bg-violet-50 text-violet-800 border-violet-200',
  amber: 'bg-amber-50 text-amber-900 border-amber-200',
  blue: 'bg-blue-50 text-blue-800 border-blue-200',
};

export function CommercialAgents({
  onConfigure,
  onAnalyzeListing,
  companyName,
  csrfToken,
}: {
  onConfigure: () => void;
  onAnalyzeListing: (code: string) => void;
  companyName: string;
  csrfToken: string;
}) {
  return (
    <div className="space-y-6">
      <header>
        <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#5636D9]">
          <Sparkles size={15} /> Inteligencia comercial
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[#171A24] sm:text-3xl">Agentes IA</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[#5D6472]">
          Asistentes para encontrar oportunidades, revisar la ficha y decidir si tiene sentido cotizar para {companyName || 'tu empresa'}. Cada resultado indica qué datos usó y qué debe validar el equipo.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Capacidades de los asistentes de Leasy">
        {agents.map(({ icon: Icon, name, status, description, output, limitation, tone }) => (
          <article key={name} className="rounded-xl border border-[#E1E4EA] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#F2F0FF] text-[#5636D9]"><Icon size={18} /></span>
              <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${toneClasses[tone]}`}>{status}</span>
            </div>
            <h2 className="mt-3 font-bold text-[#171A24]">{name}</h2>
            <p className="mt-1 text-xs leading-relaxed text-[#5D6472]">{description}</p>
            <div className="mt-3 border-t border-[#EAECF0] pt-3 text-xs leading-relaxed">
              <p><strong className="text-[#344054]">Entrega:</strong> <span className="text-[#5D6472]">{output}</span></p>
              <p className="mt-2"><strong className="text-[#344054]">Límite:</strong> <span className="text-[#667085]">{limitation}</span></p>
            </div>
          </article>
        ))}
      </section>

      <section className="rounded-xl border border-[#DED8FF] bg-[#FAF9FF] p-4 sm:p-5">
        <div className="mb-4 flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#5636D9] text-white"><Sparkles size={19} /></span>
          <div>
            <h2 className="font-bold text-[#171A24]">Bandeja del calificador comercial</h2>
            <p className="mt-1 text-sm leading-relaxed text-[#5D6472]">Procesos publicados que coinciden con el catálogo y las preferencias de la empresa. Empieza por los mejores candidatos y abre una evaluación antes de preparar costos.</p>
          </div>
        </div>
        <CompanyOpportunities
          board
          csrfToken={csrfToken}
          onConfigure={onConfigure}
          onOpenListing={onAnalyzeListing}
          actionLabel="Evaluar oportunidad"
        />
      </section>

      <aside className="rounded-xl border border-[#E1E4EA] bg-white p-4 text-xs leading-relaxed text-[#5D6472]">
        <strong className="text-[#171A24]">Cómo se usa para vender con margen:</strong> filtra coincidencias, valida requisitos y capacidad de suministro, ingresa costos reales por partida, fija el margen objetivo de {companyName || 'la empresa'} y registra en Seguimiento si el equipo cotizó y cuál fue el resultado. Los puntajes del catálogo no se presentan como probabilidades.
      </aside>
    </div>
  );
}
