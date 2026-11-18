import { type FormEvent, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Lock,
  Mail,
  Shield,
  User,
} from 'lucide-react';
import { useNavigate } from 'react-router';

export type AuthResult = {
  authenticated: true;
  csrfToken: string;
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  platformRole: 'user' | 'admin';
  emailVerified: boolean;
  emailDelivery?: 'smtp' | 'simulated' | 'failed';
  activeCompanyId: number | null;
  role: 'admin' | 'collaborator' | 'read_only' | null;
  memberships: {
    companyId: number;
    companyName: string;
    role: 'admin' | 'collaborator' | 'read_only';
  }[];
};

export function AuthGate({ onAuthenticated, initialError = '' }: { onAuthenticated: (session: AuthResult) => void; initialError?: string }) {
  const params = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState<'login' | 'register' | 'invite' | 'reset'>(
    params.has('resetPassword') ? 'reset' : params.has('invitation') ? 'invite' : 'login'
  );
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [invitationToken, setInvitationToken] = useState(params.get('invitation') ?? '');
  const [resetToken, setResetToken] = useState(params.get('resetPassword') ?? '');
  const [verificationToken, setVerificationToken] = useState(params.get('verifyEmail') ?? '');
  const [localLink, setLocalLink] = useState('');
  const [localPreview, setLocalPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (params.has('resetPassword') || params.has('verifyEmail')) {
      history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    void fetch('/api/auth/email-mode')
      .then((res) => res.json())
      .then((data) => setLocalPreview(Boolean(data.localPreview)))
      .catch(() => setLocalPreview(false));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'reset') {
        if (resetToken) {
          const response = await fetch('/api/auth/password-reset/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: resetToken, password }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'No se pudo actualizar la contraseña.');
          setNotice(result.message);
          setResetToken('');
          setPassword('');
          setMode('login');
          history.replaceState({}, '', window.location.pathname);
          return;
        }
        const response = await fetch('/api/auth/password-reset/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'No se pudo solicitar la recuperación.');
        setNotice(result.message);
        setLocalLink('');
        return;
      }

      const isInvite = mode === 'invite';
      const body =
        mode === 'login'
          ? { email, password }
          : { firstName, lastName, email, password, ...(isInvite ? { invitationToken } : {}) };

      const response = await fetch(mode === 'login' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No fue posible completar el acceso.');
      if (!result.authenticated) {
        setNotice(
          result.message ||
            'Si es posible crear la cuenta, recibirás instrucciones para verificar el correo.'
        );
        return;
      }
      if (mode === 'login' && invitationToken && result.emailVerified) {
        const accepted = await fetch('/api/auth/invitations/accept', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': result.csrfToken,
          },
          credentials: 'same-origin',
          body: JSON.stringify({ invitationToken }),
        });
        const acceptedResult = await accepted.json();
        if (!accepted.ok) throw new Error(acceptedResult.error || 'No se pudo aceptar la invitación.');
        history.replaceState({}, '', window.location.pathname);
        onAuthenticated(acceptedResult);
        navigate(acceptedResult.emailVerified && !acceptedResult.activeCompanyId ? '/onboarding' : '/');
        return;
      }
      onAuthenticated(result);
      navigate(result.emailVerified && !result.activeCompanyId ? '/onboarding' : '/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No fue posible completar la solicitud.');
    } finally {
      setBusy(false);
    }
  };

  const openLocalMail = async () => {
    try {
      const response = await fetch(
        `/api/auth/local-outbox?email=${encodeURIComponent(email)}&purpose=password-reset`
      );
      const result = await response.json();
      const mail = result.messages?.[0];
      if (!response.ok || !mail) throw new Error('No hay mensajes simulados para esa dirección.');
      setLocalLink(mail.link);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'El buzón local no está disponible.');
    }
  };

  const resendPublicVerification = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/email-verification/resend-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo solicitar el reenvío.');
      setNotice(result.message);
      if (localPreview) {
        const inbox = await fetch(
          `/api/auth/local-outbox?email=${encodeURIComponent(email)}&purpose=verification`
        );
        const data = await inbox.json();
        if (data.messages?.[0]) setLocalLink(data.messages[0].link);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo solicitar el reenvío.');
    } finally {
      setBusy(false);
    }
  };

  const confirmVerification = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/email-verification/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: verificationToken }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'El enlace de verificación venció o ya fue utilizado.');
      setVerificationToken('');
      setNotice('Correo verificado exitosamente. Inicia sesión para continuar.');
      setMode('login');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No fue posible verificar el correo.');
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === 'login'
      ? 'Bienvenido de nuevo'
      : mode === 'reset'
      ? 'Recuperar contraseña'
      : mode === 'invite'
      ? 'Aceptar invitación'
      : 'Crear tu cuenta';

  const subtitle =
    mode === 'login'
      ? 'Ingresa a tu espacio de licitaciones y adjudicaciones.'
      : mode === 'reset'
      ? resetToken
        ? 'Elige una nueva contraseña para recuperar el acceso a tu cuenta.'
        : 'Solicita un enlace para elegir una nueva contraseña. Por seguridad, el mensaje no confirma si el correo está registrado ni si se entregó.'
      : mode === 'invite'
      ? 'Define tus credenciales para incorporarte al equipo.'
      : 'Registra tu usuario para comenzar a gestionar oportunidades.';

  if (verificationToken) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-[#001F3F] via-[#5636D9] to-[#001F3F] flex items-center justify-center p-4">
        <header className="flex justify-between items-center w-full max-w-lg px-4 mb-6 text-white">
  <h1 className="text-xl font-bold">Oportuna</h1>
  <a href="#" className="text-sm underline cursor-not-allowed" title="Prototipo">Centro de Ayuda</a>
</header>
<div className="w-full max-w-lg bg-white rounded-2xl border border-[#E1E4EA] p-8 shadow-sm space-y-6 relative z-10">
          <div className="flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-xl bg-[#f0edff] text-[#5636D9] flex items-center justify-center mb-3">
              <CheckCircle2 size={24} />
            </div>
            <h1 className="text-2xl font-bold text-[#171A24]">Verificar cuenta</h1>
            <p className="text-sm text-[#5D6472] mt-1">
              Confirma que tienes acceso a este correo para habilitar tu cuenta en Oportuna.
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {notice && (
            <div className="p-3 rounded-lg bg-[#f0edff] border border-[#5636D9]/30 text-xs text-[#5636D9] flex items-center gap-2">
              <CheckCircle2 size={16} className="shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          <div className="space-y-4">
            <button
              onClick={() => void confirmVerification()}
              disabled={busy}
              className="w-full h-11 bg-[#5636D9] hover:bg-[#4b2ec7] text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
            >
              {busy ? <LoaderCircle size={18} className="spin" /> : <Shield size={18} />}
              {busy ? 'Verificando…' : 'Confirmar verificación'}
            </button>

            <div className="pt-2 border-t border-[#E1E4EA] space-y-3">
              <label className="block text-xs font-semibold text-[#5D6472]">
                ¿Necesitas otro correo de verificación?
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nombre@empresa.cl"
                  className="mt-1 w-full h-10 px-3 rounded-lg border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </label>
              <button
                type="button"
                onClick={() => void resendPublicVerification()}
                disabled={busy || !email.trim()}
                className="w-full h-10 bg-white border border-[#E1E4EA] text-[#5D6472] hover:bg-gray-50 text-xs font-semibold rounded-lg"
              >
                Reenviar correo
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-screen min-h-screen bg-[#0a0914] flex items-center justify-center px-4 py-28 sm:px-6 relative overflow-x-hidden">
      <div aria-hidden="true" className="auth-ambient pointer-events-none fixed inset-0" />
      <header className="auth-topbar fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-5 py-5 sm:px-8 lg:px-12 text-white">
        <a href="/" className="flex items-center gap-3 no-underline text-white">
          <span className="auth-logo-mark"><Lock size={21} /></span>
          <span className="flex flex-col"><b className="text-lg leading-5">Oportuna</b><small className="text-sm text-[#aaa0c4]">Mercado Público · Chile</small></span>
        </a>
        <span className="auth-help">Centro de Ayuda</span>
      </header>
      <div className="w-full max-w-[560px] bg-white rounded-2xl sm:rounded-[22px] border border-[#E1E4EA] p-6 sm:p-9 lg:p-10 shadow-[0_20px_60px_rgba(0,0,0,.3)] space-y-6 relative z-10">
        {/* Brand & Security Header */}
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-xl bg-[#f0edff] text-[#5636D9] flex items-center justify-center mb-3 shadow-sm">
            <Lock size={22} />
          </div>
          <h1 className="text-2xl font-bold text-[#171A24] tracking-tight">{title}</h1>
          <p className="text-sm text-[#5D6472] mt-1">{subtitle}</p>
        </div>

        {/* Alerts / Error & Notice */}
        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div className="p-3 rounded-lg bg-[#f0edff] border border-[#5636D9]/30 text-xs text-[#5636D9] flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {/* Main Auth Form */}
        <form onSubmit={submit} className="space-y-4">
          {(mode === 'register' || mode === 'invite') && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="auth-first-name" className="block text-xs font-semibold text-[#5D6472] mb-1">Nombre</label>
                <div className="relative">
                  <User className="w-4 h-4 text-[#8A92A6] absolute left-3 top-3 pointer-events-none" />
                  <input
                    id="auth-first-name"
                    type="text"
                    autoComplete="given-name"
                    required
                    maxLength={100}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Stefan"
                    className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="auth-last-name" className="block text-xs font-semibold text-[#5D6472] mb-1">Apellido</label>
                <input
                  id="auth-last-name"
                  type="text"
                  autoComplete="family-name"
                  required
                  maxLength={100}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Baeten"
                  className="w-full h-10 px-3 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </div>
            </div>
          )}

          {mode === 'invite' && !invitationToken && (
            <div>
              <label htmlFor="auth-invitation-token" className="block text-xs font-semibold text-[#5D6472] mb-1">
                Token de invitación
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-[#8A92A6] absolute left-3 top-3 pointer-events-none" />
                <input
                  id="auth-invitation-token"
                  type="text"
                  required
                  minLength={32}
                  maxLength={128}
                  value={invitationToken}
                  onChange={(e) => setInvitationToken(e.target.value)}
                  placeholder="Pega el token entregado por el administrador"
                  className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#E1E4EA] text-sm font-mono text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </div>
            </div>
          )}

          {(mode !== 'reset' || !resetToken) && (
            <div>
              <label htmlFor="auth-email" className="block text-xs font-semibold text-[#5D6472] mb-1">
                Correo electrónico
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#8A92A6] absolute left-3 top-3 pointer-events-none" />
                <input
                  id="auth-email"
                  type="email"
                  autoComplete={mode === 'login' ? 'username' : 'email'}
                  required
                  maxLength={320}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nombre@empresa.cl"
                  className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </div>
            </div>
          )}

          {(mode === 'login' ||
            mode === 'register' ||
            mode === 'invite' ||
            (mode === 'reset' && Boolean(resetToken))) && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="auth-password" className="text-xs font-semibold text-[#5D6472]">
                  {mode === 'reset' ? 'Nueva contraseña' : 'Contraseña'}
                </label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('reset');
                      setError('');
                      setNotice('');
                    }}
                    className="text-xs text-[#5636D9] hover:underline"
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#8A92A6] absolute left-3 top-3 pointer-events-none" />
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  minLength={mode === 'login' ? 1 : 12}
                  maxLength={1024}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'login' ? '••••••••••••' : 'Mínimo 12 caracteres'}
                  className="w-full h-10 pl-9 pr-10 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-[#8A92A6] hover:text-[#171A24]"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full h-11 bg-[#5636D9] hover:bg-[#4b2ec7] text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
          >
            {busy ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <KeyRound size={18} />
            )}
            {busy
              ? 'Procesando…'
              : mode === 'login'
              ? 'Iniciar sesión'
              : mode === 'reset'
              ? resetToken
                ? 'Actualizar contraseña'
                : 'Solicitar recuperación'
              : mode === 'invite'
              ? 'Aceptar invitación'
              : 'Registrar cuenta'}
          </button>
        </form>

        {/* Local Mail Simulation links for dev */}
        {localLink && (
          <a
            className="block text-center text-xs text-[#5636D9] underline pt-2"
            href={localLink}
          >
            Abrir enlace simulado en desarrollo
          </a>
        )}

        {localPreview && mode === 'reset' && !resetToken && notice && (
          <button
            type="button"
            className="w-full text-xs text-[#5D6472] hover:text-[#171A24] underline"
            onClick={() => void openLocalMail()}
          >
            Abrir buzón local de prueba
          </button>
        )}

        {/* Bottom Mode Switcher */}
        <div className="pt-4 border-t border-[#E1E4EA] flex flex-col items-center gap-2 text-xs text-[#5D6472]">
          {mode === 'login' ? (
            <>
              <div>
                ¿No tienes cuenta aún?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError('');
                    setNotice('');
                  }}
                  className="text-[#5636D9] font-semibold hover:underline"
                >
                  Registrarse
                </button>
              </div>
              <div>
                ¿Tienes un token de invitación?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('invite');
                    setError('');
                    setNotice('');
                  }}
                  className="text-[#5636D9] font-semibold hover:underline"
                >
                  Aceptar invitación
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
                setNotice('');
                setResetToken('');
                setPassword('');
              }}
              className="text-[#5636D9] font-semibold hover:underline flex items-center gap-1"
            >
              <ArrowLeft size={14} /> Volver al inicio de sesión
            </button>
          )}
        </div>

        <p className="text-[11px] text-[#8A92A6] text-center leading-relaxed">
          Las contraseñas se protegen con Argon2id. Las solicitudes sensibles validan tokens CSRF; el RUT identifica a la empresa, pero no acredita representación legal.
        </p>
      </div>
      <footer className="auth-bottomline">Oportuna · Inteligencia de Mercado Público para Chile · Plataforma segura</footer>
    </main>
  );
}

export function EmailVerificationGate({
  session,
  onAuthenticated,
}: {
  session: AuthResult;
  onAuthenticated: (session: AuthResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [mailLink, setMailLink] = useState('');
  const [localPreview, setLocalPreview] = useState(false);
  const [email, setEmail] = useState(session.email);
  const [verificationToken, setVerificationToken] = useState(
    () => new URLSearchParams(window.location.search).get('verifyEmail') ?? ''
  );
  const [invitationToken] = useState(
    () => new URLSearchParams(window.location.search).get('invitation') ?? ''
  );

  const refreshSession = async () => {
    const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
    const result = await response.json();
    if (result.authenticated && result.csrfToken) onAuthenticated(result);
    else setMessage('Correo verificado. Inicia sesión para continuar.');
  };

  useEffect(() => {
    void fetch('/api/auth/email-mode')
      .then((res) => res.json())
      .then((data) => setLocalPreview(Boolean(data.localPreview)))
      .catch(() => setLocalPreview(false));
    if (verificationToken) history.replaceState({}, '', window.location.pathname);
  }, []);

  const verify = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/email-verification/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: verificationToken }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'El enlace de verificación venció o ya fue utilizado.');
      setVerificationToken('');
      setMessage(result.message);
      if (invitationToken) {
        const currentResponse = await fetch('/api/auth/session', { credentials: 'same-origin' });
        const current = await currentResponse.json();
        if (current.authenticated && current.emailVerified && !current.activeCompanyId) {
          const accepted = await fetch('/api/auth/invitations/accept', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': current.csrfToken,
            },
            body: JSON.stringify({ invitationToken }),
          });
          const acceptedResult = await accepted.json();
          if (!accepted.ok)
            throw new Error(acceptedResult.error || 'No se pudo aceptar la invitación.');
          onAuthenticated(acceptedResult);
          return;
        }
      }
      await refreshSession();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No fue posible verificar el correo.');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/email-verification/resend', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': session.csrfToken },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo reenviar el enlace.');
      setMessage(
        result.delivery === 'smtp'
          ? 'El servidor de correo aceptó el mensaje para envío. Revisa tu bandeja y spam.'
          : result.delivery === 'simulated'
          ? 'Se creó un correo de prueba. Ábrelo desde el buzón local.'
          : result.delivery === 'failed'
          ? 'La solicitud fue aceptada, pero el servidor de correo no confirmó el envío. Puedes volver a intentarlo.'
          : result.delivery === 'not_required'
          ? 'La cuenta ya no necesita verificación.'
          : result.message || 'La solicitud fue recibida; no se informó una confirmación del correo.'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo reenviar el enlace.');
    } finally {
      setBusy(false);
    }
  };

  const resendPublicVerification = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/email-verification/resend-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo solicitar el reenvío.');
      setMessage(result.message);
      if (localPreview) {
        const inbox = await fetch(
          `/api/auth/local-outbox?email=${encodeURIComponent(email)}&purpose=verification`
        );
        const data = await inbox.json();
        if (data.messages?.[0]) setMailLink(data.messages[0].link);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo solicitar el reenvío.');
    } finally {
      setBusy(false);
    }
  };

  const openLocalMail = async () => {
    try {
      const response = await fetch(
        `/api/auth/local-outbox?email=${encodeURIComponent(session.email)}&purpose=verification`
      );
      const result = await response.json();
      const mail = result.messages?.[0];
      if (!response.ok || !mail) throw new Error('No hay un enlace simulado disponible.');
      setMailLink(mail.link);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'El buzón local no está disponible.');
    }
  };

  return (
    <main className="min-h-screen bg-[#F5F6F8] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-[#E1E4EA] p-8 shadow-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-xl bg-[#f0edff] text-[#5636D9] flex items-center justify-center mb-3">
            <Mail size={24} />
          </div>
          <h1 className="text-2xl font-bold text-[#171A24]">
            {verificationToken ? 'Verificar cuenta' : 'Revisa tu correo'}
          </h1>
          <p className="text-sm text-[#5D6472] mt-1">
            {verificationToken ? (
              'Confirma que tienes acceso a este correo para habilitar tu cuenta.'
            ) : session.emailDelivery === 'failed' ? (
              <>
                No pudimos confirmar el envío a <b>{session.email}</b>. Puedes solicitar otro enlace
                desde aquí.
              </>
            ) : session.emailDelivery === 'smtp' ? (
              <>El servidor de correo aceptó el mensaje para envío a <b>{session.email}</b>. Revisa tu bandeja y spam; puedes solicitar otro enlace si no aparece.</>
            ) : session.emailDelivery === 'simulated' ? (
              <>Se creó un mensaje de prueba para <b>{session.email}</b>. Abre el buzón local para continuar.</>
            ) : (
              <>
                Tu cuenta está pendiente de verificación. Si el correo no llega a{' '}
                <b>{session.email}</b>, puedes solicitar otro enlace.
              </>
            )}
          </p>
        </div>

        {busy && <div className="p-3 rounded-lg bg-gray-50 text-xs text-gray-700">Validando…</div>}
        {message && (
          <div className="p-3 rounded-lg bg-[#E8F5E9] border border-[#16845B]/30 text-xs text-[#16845B]">
            {message}
          </div>
        )}
        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}

        {verificationToken ? (
          <div className="space-y-3">
            <button
              className="w-full h-11 bg-[#5636D9] hover:bg-[#4b2ec7] text-white font-semibold rounded-xl text-sm transition-colors"
              onClick={() => void verify()}
              disabled={busy}
            >
              Verificar cuenta
            </button>
            <div className="pt-2 border-t border-[#E1E4EA]">
              <label htmlFor="auth-email" className="block text-xs font-semibold text-[#5D6472] mb-1">
                Correo electrónico
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nombre@empresa.cl"
                className="w-full h-10 px-3 rounded-lg border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9] mb-2"
              />
              <button
                className="w-full h-10 bg-white border border-[#E1E4EA] text-[#5D6472] hover:bg-gray-50 text-xs font-semibold rounded-lg"
                onClick={() => void resendPublicVerification()}
                disabled={busy || !email.trim()}
              >
                {busy ? 'Enviando…' : 'Reenviar enlace'}
              </button>
            </div>
          </div>
        ) : (
          <button
            className="w-full h-11 bg-[#5636D9] hover:bg-[#4b2ec7] text-white font-semibold rounded-xl text-sm transition-colors"
            onClick={() => void resend()}
            disabled={busy}
          >
            Reenviar enlace
          </button>
        )}

        {mailLink && (
          <a
            className="block text-center text-xs text-[#5636D9] underline"
            href={mailLink}
          >
            Abrir enlace de verificación simulado
          </a>
        )}
        {!verificationToken && localPreview && (
          <button
            type="button"
            className="w-full text-xs text-[#5D6472] hover:text-[#171A24] underline"
            onClick={() => void openLocalMail()}
          >
            Buzón local de prueba
          </button>
        )}
      </div>
    </main>
  );
}

export function LegacyClaim({
  company,
  onClaim,
  busy,
  error,
}: {
  company: { id: number; name: string } | null;
  onClaim: () => void;
  busy: boolean;
  error: string;
}) {
  return (
    <main className="min-h-screen bg-[#F5F6F8] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-[#E1E4EA] p-8 shadow-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-xl bg-[#f0edff] text-[#5636D9] flex items-center justify-center mb-3">
            <Lock size={24} />
          </div>
          <h1 className="text-2xl font-bold text-[#171A24]">Vincular espacio local</h1>
          <p className="text-sm text-[#5D6472] mt-1">
            La vinculación es administrativa y solo se puede usar una vez.
          </p>
        </div>

        {company ? (
          <div className="p-4 rounded-xl bg-[#F5F6F8] border border-[#E1E4EA] space-y-1">
            <span className="text-xs text-[#5D6472]">Empresa local pendiente</span>
            <div className="text-base font-bold text-[#171A24]">{company.name}</div>
            <p className="text-xs text-[#5D6472]">
              ID {company.id}. Sus licitaciones y catálogo se conservarán en esta cuenta.
            </p>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 text-xs text-[#5D6472]">
            No hay una empresa local pendiente para vincular.
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}

        <button
          className="w-full h-11 bg-[#5636D9] hover:bg-[#4b2ec7] text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
          disabled={busy || !company}
          onClick={onClaim}
        >
          {busy ? <LoaderCircle size={18} className="spin" /> : <Lock size={18} />}
          Vincular como administrador
        </button>

        <p className="text-[11px] text-[#8A92A6] text-center">
          Esta acción asegura el aislamiento de datos para el administrador de la plataforma.
        </p>
      </div>
    </main>
  );
}
