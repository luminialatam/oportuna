import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
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

export function TrackingCalendar({ items, total, loading, error, onRetry, onOpen }: {
  items: Tracked[];
  total: number;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onOpen: (code: string) => void;
}) {
  const today = dayFormat.format(new Date());
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [selectedDay, setSelectedDay] = useState('');
  const events = useMemo(() => collectEvents(items), [items]);
  const eventsByDay = new Map<string, CalendarEvent[]>();

  for (const event of events) {
    const day = dayFormat.format(event.date);
    if (!day.startsWith(month)) continue;
    const group = eventsByDay.get(day);
    if (group) group.push(event);
    else eventsByDay.set(day, [event]);
  }

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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold text-[#171A24] tracking-tight">Calendario</h1>
        <p className="text-sm text-[#5D6472] mt-1">Cierres de licitaciones en seguimiento y plazos internos. Hora de Chile continental.</p>
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
          <section aria-label="Vista mensual" className="max-w-3xl p-4 sm:p-6 rounded-xl bg-white border border-[#E1E4EA]">
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

          <section aria-labelledby="calendar-events" className="max-w-3xl space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 id="calendar-events" className="font-semibold">{selectedDay ? 'Eventos del día' : 'Eventos del mes'}</h2>
              {selectedDay && <button type="button" onClick={() => setSelectedDay('')} className="text-sm font-semibold text-[#5636D9]">Ver todo el mes</button>}
            </div>
            {total > items.length && <p className="text-sm text-[#5D6472]">El calendario muestra {items.length} de {total} oportunidades en seguimiento.</p>}
            {!groups.length && (
              <div className="flex items-center gap-2 rounded-xl border border-[#E1E4EA] bg-white p-4 text-sm text-[#5D6472]">
                <CalendarDays size={17} /> {selectedDay ? 'No hay eventos para este día.' : 'No hay cierres ni plazos para este mes.'}
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
        </>
      )}
    </div>
  );
}
