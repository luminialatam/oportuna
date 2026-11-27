import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { LoaderCircle, Search, ShieldCheck, UserPlus, Users, CreditCard } from 'lucide-react';

type PlatformUser = {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  platformRole: 'user' | 'admin';
  companyRoles: Array<'admin' | 'collaborator'>;
  status: 'active' | 'suspended';
  emailVerifiedAt: string | null;
  createdAt: string;
};

const pageSize = 50;
type CompanyPlanRow = { companyId: number; companyName: string; plan: 'crece' | 'vuela' | 'brilla'; billingPeriod: 'monthly' | 'annual'; activeUsers: number; trackedOpportunities: number };
type PlanChangeRequest = { id: number; companyId: number; companyName: string; requestedPlan: CompanyPlanRow['plan']; billingPeriod: CompanyPlanRow['billingPeriod']; requestedAt: string; requesterFirstName: string; requesterLastName: string };
const planLabels = { crece: 'Crece', vuela: 'Vuela', brilla: 'Brilla' } as const;

export function PlatformUsers({ csrfToken }: { csrfToken: string }) {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [platformRole, setPlatformRole] = useState<'user' | 'admin'>('user');
  const [companies, setCompanies] = useState<CompanyPlanRow[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [planSaving, setPlanSaving] = useState<number | null>(null);
  const [planRequests, setPlanRequests] = useState<PlanChangeRequest[]>([]);
  const [requestAction, setRequestAction] = useState<number | null>(null);

  const loadUsers = useCallback(async (nextOffset = offset, search = query) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(nextOffset) });
      if (search.trim()) params.set('q', search.trim());
      const response = await fetch(`/api/platform/users?${params}`, { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las cuentas.');
      setUsers(data.users);
      setTotal(data.total);
      setOffset(nextOffset);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las cuentas.');
    } finally {
      setLoading(false);
    }
  }, [offset, query]);

  useEffect(() => { void loadUsers(0, ''); }, []);

  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    try {
      const [response, requestResponse] = await Promise.all([
        fetch('/api/platform/companies', { credentials: 'same-origin', cache: 'no-store' }),
        fetch('/api/platform/plan-requests', { credentials: 'same-origin', cache: 'no-store' }),
      ]);
      const data = await response.json();
      const requestData = await requestResponse.json();
      if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los planes.');
      if (!requestResponse.ok) throw new Error(requestData.error || 'No se pudo cargar la bandeja de solicitudes.');
      setCompanies(data.companies ?? []);
      setPlanRequests(requestData.requests ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los planes.'); }
    finally { setPlansLoading(false); }
  }, []);
  useEffect(() => { void loadPlans(); }, [loadPlans]);

  const changePlan = async (companyId: number, plan: CompanyPlanRow['plan']) => {
    setPlanSaving(companyId); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/platform/companies/${companyId}/plan`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ plan }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo cambiar el plan.');
      setCompanies(current => current.map(item => item.companyId === companyId ? { ...item, plan } : item));
      setNotice(`Plan ${planLabels[plan]} activado para ${companies.find(item => item.companyId === companyId)?.companyName ?? 'la empresa'}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cambiar el plan.'); }
    finally { setPlanSaving(null); }
  };

  const reviewPlanRequest = async (id: number, decision: 'approved' | 'rejected') => {
    setRequestAction(id); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/platform/plan-requests/${id}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ decision }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo resolver la solicitud.');
      setNotice(decision === 'approved' ? 'Solicitud aprobada y plan activado.' : 'Solicitud rechazada.');
      await loadPlans();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo resolver la solicitud.'); }
    finally { setRequestAction(null); }
  };

  const createAccount = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/platform/users', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ firstName, lastName, email, password, platformRole }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo crear la cuenta.');
      setFirstName('');
      setLastName('');
      setEmail('');
      setPassword('');
      setPlatformRole('user');
      setNotice(`Cuenta creada para ${data.user.email}. La contraseña inicial no se vuelve a mostrar.`);
      await loadUsers(0, query);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear la cuenta.');
    } finally {
      setSaving(false);
    }
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void loadUsers(0, query);
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E1E4EA] pb-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#5636D9]">
            <ShieldCheck size={15} /> Administración de plataforma
          </div>
          <h1 className="text-2xl font-bold text-[#171A24]">Cuentas de usuario</h1>
          <p className="mt-1 text-sm text-[#5D6472]">Consulta y crea cuentas de clientes y administradores de Oportuna.</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-[#E1E4EA] bg-white px-4 py-3 text-sm font-semibold text-[#303747]">
          <Users size={17} className="text-[#5636D9]" /> {total} cuentas
        </div>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      <section className="overflow-hidden rounded-2xl border border-[#E1E4EA] bg-white shadow-sm">
        <div className="border-b border-[#E1E4EA] p-4"><h2 className="font-bold text-[#171A24]">Solicitudes de cambio de plan</h2><p className="mt-1 text-xs text-[#737D91]">La aprobación aplica el plan y sus cupos inmediatamente. No procesa cobros.</p></div>
        {plansLoading ? <div className="p-5 text-sm text-[#5D6472]">Cargando solicitudes…</div> : planRequests.length === 0 ? <div className="p-5 text-sm text-[#5D6472]">No hay solicitudes pendientes.</div> : <div className="divide-y divide-[#E9ECF1]">{planRequests.map(request => <div key={request.id} className="flex flex-wrap items-center justify-between gap-4 p-4"><div><b className="block text-sm text-[#171A24]">{request.companyName} · {planLabels[request.requestedPlan]}</b><span className="text-xs text-[#5D6472]">{request.billingPeriod === 'annual' ? 'Anual' : 'Mensual'} · Solicitó {`${request.requesterFirstName} ${request.requesterLastName}`.trim() || 'administrador de empresa'}</span><time className="block text-xs text-[#737D91]">{new Intl.DateTimeFormat('es-CL',{dateStyle:'medium',timeStyle:'short'}).format(new Date(request.requestedAt))}</time></div><div className="flex gap-2"><button type="button" disabled={requestAction !== null} onClick={() => void reviewPlanRequest(request.id,'rejected')} className="rounded-lg border border-[#DCE1EA] px-3 py-2 text-xs font-semibold text-[#5D6472] disabled:opacity-50">Rechazar</button><button type="button" disabled={requestAction !== null} onClick={() => void reviewPlanRequest(request.id,'approved')} className="rounded-lg bg-[#5636D9] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{requestAction === request.id ? 'Procesando…' : 'Aprobar'}</button></div></div>)}</div>}
      </section>

      <section className="overflow-hidden rounded-2xl border border-[#E1E4EA] bg-white shadow-sm">
        <div className="border-b border-[#E1E4EA] p-4"><div className="flex items-center gap-2"><CreditCard size={17} className="text-[#5636D9]"/><h2 className="font-bold text-[#171A24]">Planes por empresa</h2></div><p className="mt-1 text-xs text-[#737D91]">Activación manual sin cobros. Bajar de plan conserva los datos y accesos existentes; los cupos bloquean nuevas incorporaciones.</p></div>
        {plansLoading ? <div className="p-6 text-sm text-[#5D6472]">Cargando empresas…</div> : companies.length === 0 ? <div className="p-6 text-sm text-[#5D6472]">No hay empresas registradas.</div> : <div className="divide-y divide-[#E9ECF1]">{companies.map(company => <div key={company.companyId} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><b className="block text-sm text-[#171A24]">{company.companyName}</b><span className="text-xs text-[#737D91]">{company.activeUsers} usuarios activos · {company.trackedOpportunities} oportunidades en seguimiento · {company.billingPeriod === 'annual' ? 'Anual' : 'Mensual'}</span></div><label className="flex items-center gap-2 text-xs font-semibold text-[#5D6472]">Plan<select disabled={planSaving === company.companyId} value={company.plan} onChange={event => void changePlan(company.companyId, event.target.value as CompanyPlanRow['plan'])} className="h-10 rounded-lg border border-[#DCE1EA] bg-white px-3 text-sm text-[#171A24]"><option value="crece">Crece · Gratis</option><option value="vuela">Vuela · $49.900 + IVA</option><option value="brilla">Brilla · $79.900 + IVA</option></select>{planSaving === company.companyId && <LoaderCircle size={15} className="animate-spin"/>}</label></div>)}</div>}
      </section>

      <section className="rounded-2xl border border-[#E1E4EA] bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <UserPlus size={18} className="text-[#5636D9]" />
          <h2 className="font-bold text-[#171A24]">Crear cuenta</h2>
        </div>
        <form onSubmit={createAccount} className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm font-medium text-[#4C5568]">Nombre
            <input required maxLength={100} value={firstName} onChange={(event) => setFirstName(event.target.value)} className="h-11 w-full rounded-xl border border-[#DCE1EA] px-3 text-[#171A24] outline-none focus:border-[#5636D9]" />
          </label>
          <label className="space-y-1 text-sm font-medium text-[#4C5568]">Apellido
            <input required maxLength={100} value={lastName} onChange={(event) => setLastName(event.target.value)} className="h-11 w-full rounded-xl border border-[#DCE1EA] px-3 text-[#171A24] outline-none focus:border-[#5636D9]" />
          </label>
          <label className="space-y-1 text-sm font-medium text-[#4C5568]">Correo electrónico
            <input required type="email" maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 w-full rounded-xl border border-[#DCE1EA] px-3 text-[#171A24] outline-none focus:border-[#5636D9]" />
          </label>
          <label className="space-y-1 text-sm font-medium text-[#4C5568]">Contraseña inicial (mínimo 12 caracteres)
            <input required type="password" minLength={12} maxLength={1024} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 w-full rounded-xl border border-[#DCE1EA] px-3 text-[#171A24] outline-none focus:border-[#5636D9]" />
          </label>
          <label className="space-y-1 text-sm font-medium text-[#4C5568]">Nivel de acceso
            <select value={platformRole} onChange={(event) => setPlatformRole(event.target.value as 'user' | 'admin')} className="h-11 w-full rounded-xl border border-[#DCE1EA] bg-white px-3 text-[#171A24] outline-none focus:border-[#5636D9]">
              <option value="user">Cliente</option>
              <option value="admin">Administrador de plataforma</option>
            </select>
          </label>
          <div className="flex items-end">
            <button disabled={saving} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#5636D9] px-5 text-sm font-semibold text-white hover:bg-[#4b2ec7] disabled:opacity-60">
              {saving ? <LoaderCircle size={17} className="animate-spin" /> : <UserPlus size={17} />}
              {saving ? 'Creando…' : 'Crear cuenta'}
            </button>
          </div>
        </form>
        <p className="mt-3 text-xs text-[#737D91]">La cuenta queda activa y verificada. Comparte la contraseña inicial con su titular por un canal seguro.</p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[#E1E4EA] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E1E4EA] p-4">
          <h2 className="font-bold text-[#171A24]">Todas las cuentas</h2>
          <form onSubmit={submitSearch} className="flex w-full max-w-md gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8A92A6]" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o correo" className="h-10 w-full rounded-xl border border-[#DCE1EA] pl-9 pr-3 text-sm outline-none focus:border-[#5636D9]" />
            </div>
            <button className="h-10 rounded-xl border border-[#DCE1EA] px-4 text-sm font-semibold text-[#4C5568] hover:bg-[#F7F8FA]">Buscar</button>
          </form>
        </div>
        {loading ? <div className="flex items-center justify-center gap-2 p-12 text-sm text-[#5D6472]"><LoaderCircle size={18} className="animate-spin" /> Cargando cuentas…</div> : users.length === 0 ? <div className="p-12 text-center text-sm text-[#737D91]">No hay cuentas para mostrar.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-[#F7F8FA] text-xs uppercase tracking-wide text-[#737D91]"><tr><th className="px-5 py-3">Usuario</th><th className="px-5 py-3">Nivel</th><th className="px-5 py-3">Estado</th><th className="px-5 py-3">Correo</th><th className="px-5 py-3">Creada</th></tr></thead>
              <tbody className="divide-y divide-[#E9ECF1]">
                {users.map((user) => <tr key={user.id}>
                  <td className="px-5 py-4"><div className="font-semibold text-[#202635]">{`${user.firstName} ${user.lastName}`.trim() || '—'}</div><div className="mt-0.5 text-xs text-[#737D91]">{user.email}</div></td>
                  <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${user.platformRole === 'admin' ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-700'}`}>{user.platformRole === 'admin' ? 'Administrador de plataforma' : 'Cliente'}</span>{user.companyRoles?.length > 0 && <small className="mt-1 block text-xs text-[#737D91]">Rol en empresa: {[...new Set(user.companyRoles)].map(role => role === 'admin' ? 'Administrador' : 'Colaborador').join(', ')}</small>}</td>
                  <td className="px-5 py-4 text-[#4C5568]">{user.status === 'active' ? 'Activa' : 'Suspendida'}</td>
                  <td className="px-5 py-4 text-[#4C5568]">{user.emailVerifiedAt ? 'Verificado' : 'Pendiente'}</td>
                  <td className="px-5 py-4 text-[#737D91]">{new Intl.DateTimeFormat('es-CL',{dateStyle:'medium'}).format(new Date(user.createdAt))}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-[#E1E4EA] px-5 py-3 text-xs text-[#737D91]">
          <span>{total ? `${offset + 1}–${Math.min(offset + users.length, total)} de ${total}` : '0 cuentas'}</span>
          <div className="flex gap-2"><button disabled={offset === 0 || loading} onClick={() => void loadUsers(Math.max(0, offset - pageSize), query)} className="rounded-lg border border-[#DCE1EA] px-3 py-1.5 disabled:opacity-40">Anterior</button><button disabled={offset + pageSize >= total || loading} onClick={() => void loadUsers(offset + pageSize, query)} className="rounded-lg border border-[#DCE1EA] px-3 py-1.5 disabled:opacity-40">Siguiente</button></div>
        </div>
      </section>
    </div>
  );
}
