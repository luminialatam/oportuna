import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, ListChecks, Plus, Search, X } from 'lucide-react';
import type { Tracked } from './TrackingWorkspace';

const timeZone = 'America/Santiago';
const dayFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
});
const dateLabel = new Intl.DateTimeFormat('es-CL', { timeZone, dateStyle: 'full' });
const timeLabel = new Intl.DateTimeFormat('es-CL', {
  timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const monthLabel = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'UTC', month: 'long', year: 'numeric',
});
const weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

type CalendarEvent = {
  id: string;
  code: string;
  title: string;
  label: string;
  date: Date;
  completed: boolean;
};

function collectEvents(items: Tracked[]) {
  const events: CalendarEvent[] = [];

  for (const item of items) {
    if (item.estado === 'discarded') continue;
    const title = item.listing.nombre || item.codigo;

    if (item.listing.fechaCierre) {
      events.push({
        id: `closing-${item.id}`, code: item.codigo, title,
        label: 'Cierre de licitación', date: new Date(item.listing.fechaCierre), completed: false,
      });
    }

    for (const date of item.dates) {
      events.push({
        id: `deadline-${date.id}`, code: item.codigo, title,
        label: date.label, date: new Date(date.dueAt), completed: date.completed,
      });
    }
  }

  return events.filter((event) => Number.isFinite(event.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function TrackingCalendar({ items, total, loading, error, onRetry, onOpen, onExplore, csrfToken }: {
  items: Tracked[];
  total: number;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onOpen: (code: string) => void;
  onExplore: () => void;
  csrfToken: string;
}) {
  const today = dayFormat.format(new Date());
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [selectedDay, setSelectedDay] = useState('');
  const events = useMemo(() => collectEvents(items), [items]);
  const actionableItems = items.filter((item) => item.estado !== 'discarded');
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [savedNotice, setSavedNotice] = useState('');
  const [selectedOpportunity, setSelectedOpportunity] = useState('');
  const [deadlineLabel, setDeadlineLabel] = useState('');
  const [deadlineAt, setDeadlineAt] = useState('');
  const [deadlineNotes, setDeadlineNotes] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const monthEvents = events.filter((event) => dayFormat.format(event.date).startsWith(month));
  const eventsByDay = new Map<string, CalendarEvent[]>();

  for (const event of events) {
    const day = dayFormat.format(event.date);
    if (!day.startsWith(month)) continue;
    const group = eventsByDay.get(day);
    if (group) group.push(event);
    else eventsByDay.set(day, [event]);
  }
  const monthClosings = monthEvents.filter((event) => event.label === 'Cierre de licitación').length;
  const monthInternal = monthEvents.length - monthClosings;
  const nextEvent = events.find((event) => event.date.getTime() >= new Date().getTime());
  const suggestedOpportunity = actionableItems.find((item) => !['submitted'].includes(item.estado));
  const suggestedStep = suggestedOpportunity ? ({
    saved: 'Revisar requisitos y decidir si la empresa puede participar',
    evaluating: 'Validar partidas, cantidades y condiciones de las bases',
    preparing_offer: 'Cerrar costos, documentos y revisión de la oferta',
  }[suggestedOpportunity.estado] ?? 'Revisar el siguiente hito de esta oportunidad') : '';

  const firstDay = new Date(`${month}-01T00:00:00Z`);
  const year = firstDay.getUTCFullYear();
  const monthIndex = firstDay.getUTCMonth();
  const offset = (firstDay.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const groups = [...eventsByDay].filter(([day]) => !selectedDay || day === selectedDay);

  function showMonth(value: string) {
    setMonth(value);
    setSelectedDay('');
  }

  function moveMonth(delta: number) {
    showMonth(new Date(Date.UTC(year, monthIndex + delta, 1)).toISOString().slice(0, 7));
  }

  useEffect(() => {
    if (showAddForm) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [showAddForm]);

  async function addDeadline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const opportunity = actionableItems.find((item) => String(item.id) === (selectedOpportunity || String(actionableItems[0]?.id ?? '')));
    if (!opportunity || !deadlineLabel.trim() || !deadlineAt) return;
    setSaving(true);
    setFormError('');
    setSavedNotice('');
    try {
      const response = await fetch(`/api/company/tracking/${opportunity.id}/dates`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ label: deadlineLabel.trim(), dueAt: new Date(deadlineAt).toISOString(), notes: deadlineNotes.trim() || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar el plazo.');
      setDeadlineLabel('');
      setDeadlineAt('');
      setDeadlineNotes('');
      setShowAddForm(false);
      setSavedNotice('Plazo agregado al calendario.');
      await onRetry();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'No se pudo guardar el plazo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold text-[#171A24] tracking-tight">Calendario</h1>
        <p className="text-sm text-[#5D6472] mt-1">Tus fechas críticas para decidir, preparar y presentar ofertas. Hora de Chile continental.</p>
      </header>

      {loading ? (
        <p role="status" className="p-6 rounded-xl bg-white border border-[#E1E4EA] text-sm">Cargando calendario…</p>
      ) : error ? (
        <div role="alert" className="p-6 rounded-xl bg-white border border-[#E1E4EA] space-y-3">
          <p className="text-sm text-red-700">{error}</p>
          <button type="button" onClick={onRetry} className="text-sm font-semibold text-[#5636D9]">Reintentar</button>
        </div>
      ) : (
        <>
          <section className="overflow-hidden rounded-2xl border border-[#DED8FF] bg-white shadow-sm">
            <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div className="max-w-2xl">
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[#5636D9]">Plan de acción</p>
                <h2 className="text-lg font-bold text-[#171A24]">No dejes que un cierre te tome por sorpresa</h2>
                <p className="mt-1 text-sm leading-6 text-[#5D6472]">El calendario reúne cierres oficiales de tus oportunidades guardadas y tareas que agregue tu equipo, como revisar bases, pedir cotizaciones o preparar documentos.</p>
                {nextEvent ? (
                  <p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#F5F3FF] px-3 py-2 text-sm text-[#4630B5]"><Clock3 size={15} /> Próximo hito: <strong>{nextEvent.label}</strong> · {dateLabel.format(nextEvent.date)}</p>
                ) : (
                  <p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"><AlertTriangle size={15} /> Aún no hay fechas próximas: guarda una oportunidad para ver su cierre y planificar los pasos.</p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {actionableItems.length > 0 ? (
                  <button type="button" onClick={() => setShowAddForm((visible) => !visible)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#5636D9] px-4 py-2 text-sm font-semibold text-white hover:bg-[#482bc5]"><Plus size={16} /> Agregar plazo</button>
                ) : (
                  <button type="button" onClick={onExplore} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#5636D9] px-4 py-2 text-sm font-semibold text-white hover:bg-[#482bc5]"><Search size={16} /> Buscar oportunidades</button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 divide-y divide-[#EEEAFE] border-t border-[#EEEAFE] bg-[#FAF9FF] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <div className="p-4 sm:px-6"><p className="text-xs text-[#687184]">Oportunidades activas</p><p className="mt-1 text-2xl font-bold text-[#171A24]">{items.filter((item) => !['discarded', 'submitted'].includes(item.estado)).length}</p><p className="mt-0.5 text-xs text-[#687184]">en tu pipeline</p></div>
              <div className="p-4 sm:px-6"><p className="text-xs text-[#687184]">Cierres este mes</p><p className="mt-1 text-2xl font-bold text-[#171A24]">{monthClosings}</p><p className="mt-0.5 text-xs text-[#687184]">según fechas disponibles</p></div>
              <div className="p-4 sm:px-6"><p className="text-xs text-[#687184]">Plazos del equipo este mes</p><p className="mt-1 text-2xl font-bold text-[#171A24]">{monthInternal}</p><p className="mt-0.5 text-xs text-[#687184]">tareas internas agendadas</p></div>
            </div>
          </section>

          {showAddForm && actionableItems.length > 0 && (
            <form ref={formRef} onSubmit={(event) => void addDeadline(event)} className="max-w-5xl space-y-4 rounded-xl border border-[#DED8FF] bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-[#171A24]">Agregar un plazo de trabajo</h2><p className="mt-1 text-sm text-[#687184]">Programa una tarea concreta para avanzar esta oferta. Quedará asociada a la licitación seleccionada.</p></div><button type="button" onClick={() => setShowAddForm(false)} aria-label="Cerrar formulario" className="rounded-lg p-1 text-[#687184] hover:bg-gray-100"><X size={18} /></button></div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-xs font-semibold text-[#5D6472]">Oportunidad<select required value={selectedOpportunity || String(actionableItems[0]?.id ?? '')} onChange={(event) => setSelectedOpportunity(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-[#E1E4EA] bg-white px-3 text-sm font-normal text-[#171A24]">{actionableItems.map((item) => <option key={item.id} value={item.id}>{item.listing.nombre || item.codigo}</option>)}</select></label>
                <label className="text-xs font-semibold text-[#5D6472]">Nombre del plazo<input required value={deadlineLabel} onChange={(event) => setDeadlineLabel(event.target.value)} maxLength={160} placeholder="Ej. Revisar bases administrativas" className="mt-1 h-10 w-full rounded-lg border border-[#E1E4EA] px-3 text-sm font-normal text-[#171A24]" /></label>
                <label className="text-xs font-semibold text-[#5D6472]">Fecha y hora<input required type="datetime-local" value={deadlineAt} onChange={(event) => setDeadlineAt(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-[#E1E4EA] px-3 text-sm font-normal text-[#171A24]" /></label>
                <label className="text-xs font-semibold text-[#5D6472]">Nota para el equipo (opcional)<input value={deadlineNotes} onChange={(event) => setDeadlineNotes(event.target.value)} maxLength={1000} placeholder="Responsable, documento o detalle" className="mt-1 h-10 w-full rounded-lg border border-[#E1E4EA] px-3 text-sm font-normal text-[#171A24]" /></label>
              </div>
              {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
              <div className="flex justify-end"><button type="submit" disabled={saving} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#5636D9] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"><CheckCircle2 size={16} />{saving ? 'Guardando…' : 'Guardar plazo'}</button></div>
            </form>
          )}
          {savedNotice && <p role="status" className="flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCircle2 size={16} />{savedNotice}</p>}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
          <section aria-label="Vista mensual" className="p-4 sm:p-6 rounded-xl bg-white border border-[#E1E4EA]">
            <div className="flex items-center gap-2 mb-4">
              <h2 aria-live="polite" className="grow font-semibold capitalize">{monthLabel.format(firstDay)}</h2>
              <button type="button" onClick={() => showMonth(today.slice(0, 7))} className="px-3 py-2 text-sm font-semibold text-[#5636D9]">Hoy</button>
              <button type="button" aria-label="Mes anterior" onClick={() => moveMonth(-1)} className="p-2 rounded-lg border border-[#E1E4EA] hover:bg-gray-50"><ChevronLeft size={16} /></button>
              <button type="button" aria-label="Mes siguiente" onClick={() => moveMonth(1)} className="p-2 rounded-lg border border-[#E1E4EA] hover:bg-gray-50"><ChevronRight size={16} /></button>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {weekdays.map((day) => <span key={day} className="text-center text-xs text-[#5D6472] mb-1">{day}</span>)}
              {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
              {Array.from({ length: daysInMonth }, (_, index) => {
                const number = index + 1;
                const day = `${month}-${String(number).padStart(2, '0')}`;
                const count = eventsByDay.get(day)?.length ?? 0;
                return (
                  <button
                    key={day}
                    type="button"
                    aria-label={`${dateLabel.format(new Date(`${day}T12:00:00Z`))}, ${count} ${count === 1 ? 'evento' : 'eventos'}`}
                    aria-current={day === today ? 'date' : undefined}
                    aria-pressed={selectedDay === day}
                    onClick={() => setSelectedDay(selectedDay === day ? '' : day)}
                    className="min-h-11 rounded-lg border border-[#E1E4EA] text-sm hover:bg-[#f0edff] aria-pressed:bg-[#f0edff] aria-pressed:border-[#5636D9] aria-[current=date]:font-bold"
                  >
                    {number}
                    {count > 0 && <span aria-hidden="true" className="block text-[10px] font-semibold text-[#5636D9]">{count}</span>}
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="space-y-4">
            {suggestedOpportunity && (
              <section className="rounded-xl border border-[#DED8FF] bg-[#FAF9FF] p-5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#5636D9]">Sugerencia de Oportuna</p>
                <h2 className="mt-1 font-semibold text-[#171A24]">{suggestedStep}</h2>
                <button type="button" onClick={() => onOpen(suggestedOpportunity.codigo)} className="mt-2 text-left text-sm font-semibold text-[#5636D9] hover:underline">{suggestedOpportunity.listing.nombre || suggestedOpportunity.codigo} <span aria-hidden="true">→</span></button>
                <p className="mt-2 text-xs leading-5 text-[#687184]">Recomendación según la etapa actual: {suggestedOpportunity.estado === 'saved' ? 'Guardada' : suggestedOpportunity.estado === 'evaluating' ? 'En evaluación' : 'Preparando oferta'}. Confirma siempre las condiciones en la ficha oficial.</p>
                <button type="button" onClick={() => { setSelectedOpportunity(String(suggestedOpportunity.id)); setDeadlineLabel(suggestedStep); setShowAddForm(true); }} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[#D8D0FF] bg-white px-3 py-2 text-xs font-semibold text-[#5636D9] hover:bg-[#F3F0FF]"><Plus size={14}/>Programar este paso</button>
              </section>
            )}
            <section className="rounded-xl border border-[#E1E4EA] bg-white p-5">
              <div className="flex items-center gap-2"><ListChecks size={18} className="text-[#5636D9]"/><h2 className="font-semibold text-[#171A24]">Cómo usar tu calendario</h2></div>
              <ol className="mt-4 space-y-3 text-sm text-[#5D6472]">
                <li className="flex gap-3"><span className="font-bold text-[#5636D9]">1</span><span><strong className="text-[#171A24]">Guarda</strong> una licitación en Seguimiento; su fecha de cierre aparecerá aquí si está informada.</span></li>
                <li className="flex gap-3"><span className="font-bold text-[#5636D9]">2</span><span><strong className="text-[#171A24]">Agrega plazos</strong> para revisar bases, solicitar precios o preparar documentos.</span></li>
                <li className="flex gap-3"><span className="font-bold text-[#5636D9]">3</span><span><strong className="text-[#171A24]">Selecciona un día</strong> para ver sus eventos y abrir la ficha relacionada.</span></li>
              </ol>
              {total > items.length && <p className="mt-4 border-t border-[#E1E4EA] pt-3 text-xs leading-5 text-[#687184]">Se muestran {items.length} de {total} oportunidades del seguimiento. Para ver todo, usa Seguimiento.</p>}
            </section>
            <section className="rounded-xl border border-[#E1E4EA] bg-white p-5">
              <h2 className="font-semibold text-[#171A24]">Este mes</h2>
              <div className="mt-3 space-y-2 text-sm">
                <p className="flex justify-between gap-3"><span className="text-[#5D6472]">Cierres oficiales</span><strong>{monthClosings}</strong></p>
                <p className="flex justify-between gap-3"><span className="text-[#5D6472]">Plazos internos</span><strong>{monthInternal}</strong></p>
              </div>
              {!monthEvents.length && <p className="mt-3 rounded-lg bg-[#F8F9FA] p-3 text-xs leading-5 text-[#687184]">No hay fechas este mes. Usa “Agregar plazo” para planificar un hito o guarda una oportunidad para incorporar su cierre.</p>}
            </section>
          </aside>

          <section aria-labelledby="calendar-events" className="space-y-3 xl:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <h2 id="calendar-events" className="font-semibold">{selectedDay ? 'Eventos del día' : 'Eventos del mes'}</h2>
              {selectedDay && <button type="button" onClick={() => setSelectedDay('')} className="text-sm font-semibold text-[#5636D9]">Ver todo el mes</button>}
            </div>
            {total > items.length && <p className="text-sm text-[#5D6472]">El calendario muestra {items.length} de {total} oportunidades en seguimiento.</p>}
            {!groups.length && (
              <div className="flex flex-col gap-4 rounded-xl border border-[#E1E4EA] bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3 text-sm text-[#5D6472]">
                  <CalendarDays size={19} className="mt-0.5 shrink-0 text-[#5636D9]" />
                  <div><p className="font-semibold text-[#171A24]">{selectedDay ? 'No hay eventos para este día.' : 'Todavía no hay eventos este mes.'}</p><p className="mt-1">{selectedDay ? 'Elige otro día o vuelve a ver el mes completo.' : items.length ? 'Agrega un plazo interno o revisa otro mes para planificar las próximas acciones.' : 'Al guardar una oportunidad se agregará su fecha de cierre, cuando esté disponible.'}</p></div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {selectedDay && <button type="button" onClick={() => setSelectedDay('')} className="rounded-lg border border-[#E1E4EA] px-3 py-2 text-sm font-semibold text-[#5D6472]">Ver mes</button>}
                  {actionableItems.length ? <button type="button" onClick={() => setShowAddForm(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#5636D9] px-3 py-2 text-sm font-semibold text-white"><Plus size={15}/>Agregar plazo</button> : <button type="button" onClick={onExplore} className="inline-flex items-center gap-2 rounded-lg bg-[#5636D9] px-3 py-2 text-sm font-semibold text-white"><Search size={15}/>Buscar oportunidades</button>}
                </div>
              </div>
            )}
            {groups.map(([day, group]) => (
              <section key={day} className="rounded-xl border border-[#E1E4EA] bg-white p-4">
                <h3 className="mb-2 text-sm font-semibold capitalize">{dateLabel.format(group[0].date)}</h3>
                <ul className="divide-y divide-[#E1E4EA]">
                  {group.map((event) => (
                    <li key={event.id} className="flex items-start gap-3 py-2 text-sm">
                      <time dateTime={event.date.toISOString()} className="shrink-0 tabular-nums text-[#5D6472]">{timeLabel.format(event.date)}</time>
                      <div className="min-w-0">
                        <button type="button" onClick={() => onOpen(event.code)} className="text-left font-semibold text-[#5636D9] hover:underline">{event.title}</button>
                        <p className="mt-0.5 text-xs text-[#5D6472]">{event.label} · {event.code}{event.completed && ' · Completado'}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </section>
          </div>
        </>
      )}
    </div>
  );
}
