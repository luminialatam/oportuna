import { type FormEvent, useEffect, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  LoaderCircle,
  MailPlus,
  Shield,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

type AuthSession = {
  authenticated: true;
  csrfToken: string;
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  platformRole: 'user' | 'admin';
  emailVerified: boolean;
  activeCompanyId: number | null;
  role: 'admin' | 'collaborator' | 'read_only' | null;
  memberships: { companyId: number; companyName: string; role: 'admin' | 'collaborator' | 'read_only' }[];
};

const regions = [
  'Arica y Parinacota',
  'Tarapacá',
  'Antofagasta',
  'Atacama',
  'Coquimbo',
  'Valparaíso',
  'Metropolitana de Santiago',
  'Libertador General Bernardo O’Higgins',
  'Maule',
  'Ñuble',
  'Biobío',
  'La Araucanía',
  'Los Ríos',
  'Los Lagos',
  'Aysén del General Carlos Ibáñez del Campo',
  'Magallanes y de la Antártica Chilena',
];

const request = async <T,>(url: string, options: RequestInit = {}, csrfToken = ''): Promise<T> => {
  const headers = new Headers(options.headers);
  if (!['GET', 'HEAD'].includes((options.method ?? 'GET').toUpperCase())) {
    headers.set('X-CSRF-Token', csrfToken);
  }
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = data.fieldErrors && typeof data.fieldErrors === 'object'
      ? Object.entries(data.fieldErrors as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
          .map(([field, message]) => `${field}: ${message}`)
      : [];
    throw new Error([data.error ?? 'No se pudo completar la solicitud.', ...details].join(' '));
  }
  return data as T;
};

export function NoCompanyOnboarding({
  session,
  onAuthenticated,
}: {
  session: AuthSession;
  onAuthenticated: (value: AuthSession) => void;
}) {
  const [mode, setMode] = useState<'company' | 'access'>('company');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rut, setRut] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [nombreComercial, setNombreComercial] = useState('');
  const [rubroPrincipal, setRubroPrincipal] = useState('');
  const [region, setRegion] = useState('');
  const [emailContacto, setEmailContacto] = useState(session.email);
  const [telefono, setTelefono] = useState('');
  const [sitioWeb, setSitioWeb] = useState('');
  const [direccion, setDireccion] = useState('');
  const [comuna, setComuna] = useState('');
  const [descripcionComercial, setDescripcionComercial] = useState('');
  const [regionesOperacion, setRegionesOperacion] = useState('');
  const [productosPrincipales, setProductosPrincipales] = useState('');
  const [requestRole, setRequestRole] = useState<'collaborator' | 'read_only'>('read_only');

  const submitCompany = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await request<AuthSession>(
        '/api/onboarding/company',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rut,
            razonSocial,
            nombreComercial,
            rubroPrincipal,
            region,
            emailContacto,
            telefono: telefono || null,
            sitioWeb: sitioWeb || null,
            direccion: direccion || null,
            comuna: comuna || null,
            descripcionComercial: descripcionComercial || null,
            regionesOperacion: regionesOperacion
              .split(/[\n,;]/)
              .map((v) => v.trim())
              .filter(Boolean),
            productosPrincipales: productosPrincipales
              .split(/[\n,;]/)
              .map((v) => v.trim())
              .filter(Boolean),
          }),
        },
        session.csrfToken
      );
      onAuthenticated(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar la empresa.');
    } finally {
      setBusy(false);
    }
  };

  const submitAccess = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request<{ message: string }>(
        '/api/onboarding/access-requests',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rut, role: requestRole }),
        },
        session.csrfToken
      );
      setNotice(result.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar la solicitud.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#F5F6F8] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-2xl border border-[#E1E4EA] p-6 sm:p-8 shadow-md space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-xl bg-[#f0edff] text-[#5636D9] flex items-center justify-center mb-3">
            <Building2 size={24} />
          </div>
          <h1 className="text-2xl font-bold text-[#171A24]">Conecta tu empresa en Leasy</h1>
          <p className="text-sm text-[#5D6472] mt-1">
            Hola {session.firstName}. Registra los datos de tu empresa o solicita acceso a una
            existente.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center justify-center gap-2 p-1 bg-[#F5F6F8] rounded-xl border border-[#E1E4EA]">
          <button
            type="button"
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              mode === 'company'
                ? 'bg-white text-[#5636D9] shadow-sm'
                : 'text-[#5D6472] hover:bg-white/50'
            }`}
            onClick={() => {
              setMode('company');
              setError('');
              setNotice('');
            }}
          >
            Registrar nueva empresa
          </button>
          <button
            type="button"
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              mode === 'access'
                ? 'bg-white text-[#5636D9] shadow-sm'
                : 'text-[#5D6472] hover:bg-white/50'
            }`}
            onClick={() => {
              setMode('access');
              setError('');
              setNotice('');
            }}
          >
            Solicitar acceso a empresa existente
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div className="p-3 rounded-lg bg-[#f0edff] border border-[#5636D9]/30 text-xs text-[#5636D9] flex items-center gap-2">
            <CheckCircle2 size={15} />
            <span>{notice}</span>
          </div>
        )}

        {mode === 'company' ? (
          <form onSubmit={submitCompany} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-[#5D6472] mb-1">RUT Empresa</label>
                <input
                  required
                  maxLength={30}
                  value={rut}
                  onChange={(e) => setRut(e.target.value)}
                  placeholder="76.123.456-0"
                  className="w-full h-10 px-3 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#5D6472] mb-1">Razón Social</label>
                <input
                  required
                  maxLength={255}
                  value={razonSocial}
                  onChange={(e) => setRazonSocial(e.target.value)}
                  placeholder="Constructora Andes SpA"
                  className="w-full h-10 px-3 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#5D6472] mb-1">Nombre Comercial</label>
                <input
                  required
                  maxLength={255}
                  value={nombreComercial}
                  onChange={(e) => setNombreComercial(e.target.value)}
                  placeholder="Andes Construcciones"
                  className="w-full h-10 px-3 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#5D6472] mb-1">Rubro Principal</label>
                <input
                  required
                  maxLength={160}
                  value={rubroPrincipal}
                  onChange={(e) => setRubroPrincipal(e.target.value)}
                  placeholder="Ej. Obras Civiles y Edificación"
                  className="w-full h-10 px-3 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#5D6472] mb-1">Región Principal</label>
                <select
                  required
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] bg-white focus:outline-none focus:border-[#5636D9]"
                >
                  <option value="">Selecciona una región</option>
                  {regions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-[#5D6472] mb-1">Email de Contacto</label>
                <input
                  required
                  type="email"
                  value={emailContacto}
                  onChange={(e) => setEmailContacto(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#5D6472] mb-1">Teléfono (opcional)</label>
                <input
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  placeholder="+56 9 1234 5678"
                  className="w-full h-10 px-3 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#5D6472] mb-1">Sitio Web (opcional)</label>
                <input
                  value={sitioWeb}
                  onChange={(e) => setSitioWeb(e.target.value)}
                  placeholder="https://ejemplo.cl"
                  className="w-full h-10 px-3 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#5D6472] mb-1">Dirección (opcional)</label>
                <input
                  value={direccion}
                  onChange={(e) => setDireccion(e.target.value)}
                  placeholder="Av. Providencia 1234, Of. 501"
                  className="w-full h-10 px-3 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#5D6472] mb-1">Comuna (opcional)</label>
                <input
                  value={comuna}
                  onChange={(e) => setComuna(e.target.value)}
                  placeholder="Providencia"
                  className="w-full h-10 px-3 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-[#5D6472] mb-1">Regiones de Operación (opcional, separadas por coma)</label>
                <input
                  value={regionesOperacion}
                  onChange={(e) => setRegionesOperacion(e.target.value)}
                  placeholder="Metropolitana de Santiago, Valparaíso, Biobío"
                  className="w-full h-10 px-3 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-[#5D6472] mb-1">Productos o Servicios Principales (opcional, separados por coma)</label>
                <input
                  value={productosPrincipales}
                  onChange={(e) => setProductosPrincipales(e.target.value)}
                  placeholder="Insumos médicos, Reactivos, Equipos de esterilización"
                  className="w-full h-10 px-3 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-[#5D6472] mb-1">Descripción Comercial (opcional)</label>
                <textarea
                  rows={2}
                  value={descripcionComercial}
                  onChange={(e) => setDescripcionComercial(e.target.value)}
                  placeholder="Resumen del alcance o capacidades de la empresa..."
                  className="w-full p-3 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </div>
            </div>

            <p className="text-[11px] text-[#8A92A6] bg-[#F8F9FA] p-3 rounded-lg border border-[#E1E4EA]">
              La primera cuenta administrará provisionalmente este espacio. La representación legal
              se acredita en los procesos oficiales de Mercado Público.
            </p>

            <button
              type="submit"
              disabled={busy}
              className="w-full h-11 bg-[#5636D9] hover:bg-[#4b2ec7] text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
            >
              {busy ? <LoaderCircle size={18} className="spin" /> : <Building2 size={18} />}
              {busy ? 'Registrando…' : 'Registrar Empresa y Continuar'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitAccess} className="space-y-4">
            <p className="text-xs text-[#5D6472]">
              Ingresa el RUT de la empresa registrada. La solicitud se enviará a los administradores
              sin revelar información privada.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#5D6472] mb-1">
                  RUT de la empresa
                </label>
                <input
                  required
                  maxLength={30}
                  value={rut}
                  onChange={(e) => setRut(e.target.value)}
                  placeholder="76.123.456-0"
                  className="w-full h-10 px-3 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#5D6472] mb-1">
                  Rol de acceso solicitado
                </label>
                <select
                  value={requestRole}
                  onChange={(e) => setRequestRole(e.target.value as typeof requestRole)}
                  className="w-full h-10 px-3 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] bg-white focus:outline-none focus:border-[#5636D9]"
                >
                  <option value="collaborator">Colaborador (búsqueda y seguimiento)</option>
                  <option value="read_only">Solo lectura</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full h-11 bg-[#5636D9] hover:bg-[#4b2ec7] text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
            >
              {busy ? <LoaderCircle size={18} className="spin" /> : <MailPlus size={18} />}
              {busy ? 'Enviando…' : 'Enviar Solicitud de Acceso'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

type Member = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  role: 'admin' | 'collaborator' | 'read_only';
  status: string;
};

type AccessRequest = {
  id: number;
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
  requestedRole: 'collaborator' | 'read_only';
  message: string | null;
  createdAt: string;
};

export function CompanyTeamManagement({
  role,
  csrfToken,
}: {
  role: 'admin' | 'collaborator' | 'read_only' | null;
  csrfToken: string;
}) {
  const [activeTab, setActiveTab] = useState<'members' | 'matrix'>('members');
  const [members, setMembers] = useState<Member[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'collaborator' | 'read_only'>('collaborator');
  const [inviteToken, setInviteToken] = useState('');
  const [copiedToken, setCopiedToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    if (role !== 'admin') return;
    try {
      const [membership, access] = await Promise.all([
        request<{ members: Member[] }>('/api/company/members'),
        request<{ items: AccessRequest[] }>('/api/company/access-requests'),
      ]);
      setMembers(membership.members);
      setRequests(access.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el equipo.');
    }
  };

  useEffect(() => {
    void load();
  }, [role]);

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request<{ invitationToken?: string; delivery: 'simulated' | 'smtp' }>(
        '/api/company/members/invitations',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, role: inviteRole }),
        },
        csrfToken
      );
      setInviteToken(result.invitationToken ?? '');
      setNotice(
        result.delivery === 'simulated'
          ? 'Invitación generada con token de 1 solo uso.'
          : 'Invitación enviada por correo.'
      );
      setEmail('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la invitación.');
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (userId: number, nextRole: Member['role']) => {
    setError('');
    try {
      await request(
        `/api/company/members/${userId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: nextRole }),
        },
        csrfToken
      );
      await load();
      setNotice('Rol de usuario actualizado.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar el rol.');
    }
  };

  const review = async (
    id: number,
    decision: 'approve' | 'reject',
    selectedRole: 'collaborator' | 'read_only'
  ) => {
    setError('');
    try {
      await request(
        `/api/company/access-requests/${id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision, role: selectedRole }),
        },
        csrfToken
      );
      setNotice(decision === 'approve' ? 'Acceso aprobado.' : 'Solicitud rechazada.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo resolver la solicitud.');
    }
  };

  const copyToken = () => {
    if (!inviteToken) return;
    void navigator.clipboard.writeText(inviteToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  if (role !== 'admin') {
    return (
      <div className="bg-white rounded-xl border border-[#E1E4EA] p-6 shadow-sm text-center text-xs text-[#5D6472]">
        Solo los administradores de la empresa pueden gestionar integrantes y permisos.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Demo / RBAC Banner (Stitch screen 7) */}
      <div className="bg-white rounded-xl border border-[#E1E4EA] p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#f0edff] text-[#5636D9] flex items-center justify-center shrink-0">
            <ShieldCheck size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-xs text-[#171A24]">
                Control de Acceso Basado en Roles (RBAC)
              </span>
              <span className="text-[10px] font-semibold bg-[#f0edff] text-[#5636D9] px-2 py-0.5 rounded-full">
                Activo
              </span>
            </div>
            <p className="text-[11px] text-[#5D6472]">
              Aislamiento por empresa y membresía de usuario verificado con Argon2id.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-[#F5F6F8] p-1 rounded-lg border border-[#E1E4EA]">
          <button
            onClick={() => setActiveTab('members')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'members'
                ? 'bg-white text-[#5636D9] shadow-sm'
                : 'text-[#5D6472] hover:bg-gray-200'
            }`}
          >
            Integrantes ({members.length})
          </button>
          <button
            onClick={() => setActiveTab('matrix')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'matrix'
                ? 'bg-white text-[#5636D9] shadow-sm'
                : 'text-[#5D6472] hover:bg-gray-200'
            }`}
          >
            Matriz de Permisos
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="p-3 rounded-lg bg-[#f0edff] border border-[#5636D9]/30 text-xs text-[#5636D9] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} />
            <span>{notice}</span>
          </div>
          <button onClick={() => setNotice('')} className="text-[#5636D9]">
            <X size={14} />
          </button>
        </div>
      )}

      {activeTab === 'members' && (
        <div className="space-y-6">
          {/* Invite User Card (Stitch 7) */}
          <div className="bg-white rounded-xl border border-[#E1E4EA] p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-[#171A24] flex items-center gap-2">
                  <UserPlus size={17} className="text-[#5636D9]" />
                  Invitar nuevo integrante
                </h3>
                <p className="text-xs text-[#5D6472] mt-0.5">
                  Genera una invitación segura de un solo uso para un colaborador.
                </p>
              </div>
            </div>

            <form onSubmit={invite} className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-[#5D6472] mb-1">
                  Correo electrónico
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="colaborador@empresa.cl"
                  className="w-full h-10 px-3 rounded-lg border border-[#E1E4EA] text-xs text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </div>

              <div className="w-full sm:w-48">
                <label className="block text-xs font-semibold text-[#5D6472] mb-1">
                  Rol asignado
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}
                  className="w-full h-10 px-3 rounded-lg border border-[#E1E4EA] text-xs text-[#171A24] bg-white focus:outline-none focus:border-[#5636D9]"
                >
                  <option value="collaborator">Colaborador</option>
                  <option value="admin">Administrador</option>
                  <option value="read_only">Solo lectura</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="h-10 px-4 bg-[#5636D9] hover:bg-[#4b2ec7] text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors shrink-0"
              >
                {busy ? <LoaderCircle size={15} className="spin" /> : <MailPlus size={15} />}
                Crear invitación
              </button>
            </form>

            {inviteToken && (
              <div className="p-3.5 rounded-lg bg-[#f0edff]/40 border border-[#5636D9]/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div>
                  <span className="font-bold text-[#5636D9] block">
                    Token de invitación de un solo uso:
                  </span>
                  <code className="text-[#171A24] font-mono break-all">{inviteToken}</code>
                </div>
                <button
                  type="button"
                  onClick={copyToken}
                  className="h-8 px-3 bg-white border border-[#5636D9]/30 text-[#5636D9] hover:bg-[#f0edff] rounded-lg font-semibold flex items-center justify-center gap-1.5 shrink-0 self-start sm:self-auto"
                >
                  <Copy size={13} /> {copiedToken ? 'Copiado' : 'Copiar token'}
                </button>
              </div>
            )}
          </div>

          {/* Members List */}
          <div className="bg-white rounded-xl border border-[#E1E4EA] shadow-sm overflow-hidden">
            <div className="p-4 border-b border-[#E1E4EA] flex items-center justify-between">
              <h3 className="font-bold text-sm text-[#171A24] flex items-center gap-2">
                <Users size={17} className="text-[#5636D9]" /> Integrantes activos
              </h3>
              <span className="text-xs text-[#8A92A6]">{members.length} usuarios</span>
            </div>

            <div className="divide-y divide-[#E1E4EA]">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-[#f0edff] text-[#5636D9] font-bold text-xs flex items-center justify-center">
                      {(member.firstName || member.email)[0].toUpperCase()}
                    </div>
                    <div>
                      <span className="font-bold text-xs text-[#171A24]">
                        {`${member.firstName} ${member.lastName}`.trim() || member.email}
                      </span>
                      <div className="text-[11px] text-[#5D6472] mt-0.5">
                        <span>{member.email}</span>
                        <span className="mx-1">•</span>
                        <span className="text-[#5636D9] font-medium">
                          {member.status === 'active' ? 'Activo' : 'Suspendido'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <select
                      value={member.role}
                      onChange={(e) => void changeRole(member.id, e.target.value as Member['role'])}
                      className="h-8 px-2.5 rounded-lg border border-[#E1E4EA] text-xs font-semibold text-[#171A24] bg-white focus:outline-none focus:border-[#5636D9]"
                    >
                      <option value="admin">Administrador</option>
                      <option value="collaborator">Colaborador</option>
                      <option value="read_only">Solo lectura</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pending Access Requests */}
          {requests.length > 0 && (
            <div className="bg-white rounded-xl border border-[#E1E4EA] shadow-sm p-5 space-y-4">
              <h3 className="font-bold text-sm text-[#171A24] flex items-center gap-2">
                <Clock size={17} className="text-amber-600" />
                Solicitudes de acceso pendientes ({requests.length})
              </h3>
              <div className="divide-y divide-[#E1E4EA]">
                {requests.map((item) => (
                  <AccessRequestRow key={item.id} item={item} onReview={review} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: RBAC PERMISSIONS MATRIX (Stitch 7 screen) */}
      {activeTab === 'matrix' && (
        <div className="bg-white rounded-xl border border-[#E1E4EA] shadow-sm overflow-hidden">
          <div className="p-5 border-b border-[#E1E4EA]">
            <h3 className="font-bold text-sm text-[#171A24] flex items-center gap-2">
              <Shield size={17} className="text-[#5636D9]" />
              Matriz de Permisos por Rol (RBAC)
            </h3>
            <p className="text-xs text-[#5D6472] mt-1">
              Detalle de facultades operativas y administrativas asignadas a cada perfil dentro de la empresa.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F8F9FA] border-b border-[#E1E4EA] text-[#5D6472] font-semibold">
                <tr>
                  <th className="py-3 px-4">MÓDULO O ACCIÓN</th>
                  <th className="py-3 px-4 text-center">ADMINISTRADOR</th>
                  <th className="py-3 px-4 text-center">COLABORADOR</th>
                  <th className="py-3 px-4 text-center">SOLO LECTURA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E4EA]">
                {[
                  {
                    action: 'Buscar y explorar licitaciones públicas',
                    admin: true,
                    collab: true,
                    read: true,
                  },
                  {
                    action: 'Visualizar ficha local y análisis IA',
                    admin: true,
                    collab: true,
                    read: true,
                  },
                  {
                    action: 'Guardar y mover etapas en Seguimiento',
                    admin: true,
                    collab: true,
                    read: false,
                  },
                  {
                    action: 'Crear y gestionar alertas de cierre',
                    admin: true,
                    collab: true,
                    read: false,
                  },
                  {
                    action: 'Editar perfil comercial y RUT de la empresa',
                    admin: true,
                    collab: false,
                    read: false,
                  },
                  {
                    action: 'Crear, editar o eliminar productos del catálogo',
                    admin: true,
                    collab: false,
                    read: false,
                  },
                  {
                    action: 'Invitar integrantes y asignar roles',
                    admin: true,
                    collab: false,
                    read: false,
                  },
                  {
                    action: 'Configurar token de Mercado Público y sincronización',
                    admin: true,
                    collab: false,
                    read: false,
                  },
                ].map((row, idx) => (
                  <tr key={idx} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 font-medium text-[#171A24]">{row.action}</td>
                    <td className="py-3 px-4 text-center">
                      {row.admin ? (
                        <Check className="w-4 h-4 mx-auto text-[#5636D9]" />
                      ) : (
                        <X className="w-4 h-4 mx-auto text-[#8A92A6]" />
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {row.collab ? (
                        <Check className="w-4 h-4 mx-auto text-[#5636D9]" />
                      ) : (
                        <X className="w-4 h-4 mx-auto text-[#8A92A6]" />
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {row.read ? (
                        <Check className="w-4 h-4 mx-auto text-[#5636D9]" />
                      ) : (
                        <X className="w-4 h-4 mx-auto text-[#8A92A6]" />
                      )}
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

function AccessRequestRow({
  item,
  onReview,
}: {
  item: AccessRequest;
  onReview: (id: number, decision: 'approve' | 'reject', role: 'collaborator' | 'read_only') => void;
}) {
  const [role, setRole] = useState<'collaborator' | 'read_only'>(item.requestedRole);
  return (
    <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
      <div>
        <span className="font-bold text-[#171A24]">
          {`${item.firstName} ${item.lastName}`.trim() || item.email}
        </span>
        <span className="text-[#5D6472] block">{item.email}</span>
      </div>
      <div className="flex items-center gap-2 self-end sm:self-auto">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as typeof role)}
          className="h-8 px-2 rounded-lg border border-[#E1E4EA] text-xs bg-white"
        >
          <option value="collaborator">Colaborador</option>
          <option value="read_only">Solo lectura</option>
        </select>
        <button
          type="button"
          onClick={() => onReview(item.id, 'reject', role)}
          className="h-8 px-3 bg-white border border-[#E1E4EA] hover:bg-gray-100 text-[#5D6472] rounded-lg font-semibold"
        >
          Rechazar
        </button>
        <button
          type="button"
          onClick={() => onReview(item.id, 'approve', role)}
          className="h-8 px-3 bg-[#5636D9] hover:bg-[#4b2ec7] text-white rounded-lg font-semibold flex items-center gap-1"
        >
          <Check size={13} /> Aprobar
        </button>
      </div>
    </div>
  );
}
