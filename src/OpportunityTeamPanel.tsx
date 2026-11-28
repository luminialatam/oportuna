import { useCallback, useEffect, useState } from 'react';
import { Activity, LoaderCircle, Users } from 'lucide-react';

type Person = { id: number; name: string; role: string };
type Event = { id: number; type: string; summary: string; createdAt: string; actor: string | null };
async function request<T>(url: string, csrfToken: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.method && options.method !== 'GET') headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'No se pudo cargar el equipo de esta oportunidad.');
  return body;
}

export function OpportunityTeamPanel({ code, csrfToken, canEdit = true }: { code: string; csrfToken: string; canEdit?: boolean }) {
  const [members, setMembers] = useState<Person[]>([]);
  const [assignedUserId, setAssignedUserId] = useState('');
  const [participantIds, setParticipantIds] = useState<number[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [team, roster, activity] = await Promise.all([
        request<{ assignedUserId: number | null; participants: Person[] }>(`/api/company/opportunities/${encodeURIComponent(code)}/team`, csrfToken),
        request<{ members: Person[] }>('/api/company/team-members', csrfToken),
        request<{ items: Event[] }>(`/api/company/opportunities/${encodeURIComponent(code)}/activity`, csrfToken),
      ]);
      setMembers(roster.members); setAssignedUserId(team.assignedUserId == null ? '' : String(team.assignedUserId));
      setParticipantIds(team.participants.map(member => member.id)); setEvents(activity.items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar el equipo.'); }
    finally { setLoading(false); }
  }, [code, csrfToken]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true); setError(''); setNotice('');
    try {
      await request(`/api/company/opportunities/${encodeURIComponent(code)}/team`, csrfToken, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedUserId: assignedUserId ? Number(assignedUserId) : null, participantIds }),
      });
      setNotice('Responsable y participantes guardados para la empresa activa.'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar el equipo.'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="rounded-lg border border-[#E1E4EA] p-3 text-sm text-[#667085]" role="status"><LoaderCircle className="mr-2 inline animate-spin" size={15}/>Cargando equipo e historial…</div>;
  return <section className="rounded-xl border border-[#E1E4EA] bg-white p-4" aria-label="Equipo e historial de oportunidad">
    <h3 className="flex items-center gap-2 font-semibold text-[#171A24]"><Users size={17} className="text-[#5636D9]"/>Equipo responsable</h3>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-medium text-[#344054]">Responsable<select className="rounded-lg border border-[#D0D5DD] bg-white px-3 py-2.5" value={assignedUserId} disabled={!canEdit} onChange={event => setAssignedUserId(event.target.value)}><option value="">Sin asignar</option>{members.map(member => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select></label>
      <fieldset className="rounded-lg border border-[#E1E4EA] p-3" disabled={!canEdit}><legend className="px-1 text-xs font-semibold text-[#667085]">Participantes</legend>{members.length ? <div className="max-h-32 space-y-1 overflow-auto">{members.map(member => <label key={member.id} className="flex items-center gap-2 text-sm text-[#344054]"><input type="checkbox" checked={participantIds.includes(member.id)} onChange={event => setParticipantIds(current => event.target.checked ? [...new Set([...current, member.id])] : current.filter(id => id !== member.id))}/>{member.name}<span className="text-xs text-[#667085]">{member.role}</span></label>)}</div> : <p className="text-xs text-[#667085]">No hay integrantes activos para asignar.</p>}</fieldset>
    </div>
    {canEdit && <button type="button" disabled={saving} onClick={() => void save()} className="mt-3 rounded-lg bg-[#5636D9] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar equipo'}</button>}
    {error && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-red-700" role="alert"><span>{error}</span><button type="button" onClick={() => void load()} className="font-semibold underline">Reintentar</button></div>}
    {notice && <p className="mt-2 text-sm text-emerald-700" role="status">{notice}</p>}
    <div className="mt-4 border-t border-[#EAECF0] pt-3"><h4 className="flex items-center gap-2 text-sm font-semibold text-[#344054]"><Activity size={15}/>Actividad reciente</h4>{events.length ? <ol className="mt-2 space-y-2">{events.slice(0, 12).map(event => <li key={event.id} className="text-xs text-[#475467]"><span>{event.summary}</span><span className="mt-0.5 block text-[#7A8497]">{event.actor || 'Autor no disponible'} · {new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.createdAt))}</span></li>)}</ol> : <p className="mt-2 text-xs text-[#667085]">Aún no hay actividad registrada.</p>}</div>
  </section>;
}
