import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, KeyRound, LoaderCircle, Shield, UserRound } from 'lucide-react';
import type { AuthResult } from './AuthGate';

type PersonalFields = Pick<AuthResult, 'firstName' | 'lastName'>;

async function responseError(response: Response) {
  const payload = await response.json().catch(() => ({})) as { error?: string };
  return payload.error || 'No se pudo completar la solicitud.';
}

export function ProfilePage({
  session,
  onProfileUpdated,
  onNavigateSecurity,
}: {
  session: AuthResult;
  onProfileUpdated: (fields: PersonalFields) => void;
  onNavigateSecurity: () => void;
}) {
  const [firstName, setFirstName] = useState(session.firstName);
  const [lastName, setLastName] = useState(session.lastName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setFirstName(session.firstName);
    setLastName(session.lastName);
  }, [session.firstName, session.lastName]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const response = await fetch('/api/auth/profile', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken },
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim() }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const fields = await response.json() as PersonalFields;
      setFirstName(fields.firstName);
      setLastName(fields.lastName);
      onProfileUpdated(fields);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron guardar los cambios.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-page">
      <header className="account-page-heading">
        <div className="account-eyebrow">Cuenta</div>
        <h1>Mi perfil</h1>
        <p>Administra los datos personales de tu cuenta. La información de tu proveedor se configura en Mi empresa.</p>
      </header>

      <section className="account-card" aria-labelledby="personal-data-heading">
        <div className="account-card-heading">
          <span className="account-icon"><UserRound size={18} /></span>
          <div>
            <h2 id="personal-data-heading">Datos personales</h2>
            <p>Estos datos identifican a la persona que inició sesión.</p>
          </div>
        </div>
        <form className="account-form" onSubmit={submit}>
          <div className="account-form-grid">
            <label>
              <span>Nombre</span>
              <input id="account-first-name" name="firstName" autoComplete="given-name" maxLength={100} required value={firstName} onChange={(event) => setFirstName(event.target.value)} />
            </label>
            <label>
              <span>Apellido</span>
              <input id="account-last-name" name="lastName" autoComplete="family-name" maxLength={100} value={lastName} onChange={(event) => setLastName(event.target.value)} />
            </label>
            <label className="account-full-row">
              <span>Correo electrónico</span>
              <input id="account-email" name="email" type="email" autoComplete="username" value={session.email} readOnly aria-describedby="account-email-note" />
              <small id="account-email-note">El correo se usa para iniciar sesión y no se puede cambiar desde esta pantalla.</small>
            </label>
          </div>
          {error && <p className="account-message account-message-error" role="alert">{error}</p>}
          {saved && <p className="account-message account-message-success" role="status"><CheckCircle2 size={16} /> Perfil actualizado.</p>}
          <div className="account-form-actions">
            <button className="button button-primary" type="submit" disabled={busy}>
              {busy ? <LoaderCircle size={16} className="spin" /> : null}
              {busy ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </section>

      <button type="button" className="account-navigation-card" onClick={onNavigateSecurity}>
        <span className="account-icon"><Shield size={18} /></span>
        <span><b>Seguridad</b><small>Cambia tu contraseña y revisa el acceso a tu cuenta.</small></span>
        <ArrowRight size={16} />
      </button>
    </div>
  );
}

export function SecurityPage({ session }: { session: AuthResult }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (newPassword.length < 12) {
      setError('La nueva contraseña debe tener al menos 12 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/auth/password/change', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json() as { message: string };
      setSuccess(result.message);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cambiar la contraseña.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-page">
      <header className="account-page-heading">
        <div className="account-eyebrow">Cuenta · Seguridad</div>
        <h1>Seguridad</h1>
        <p>Actualiza la contraseña de tu cuenta. Te pediremos la contraseña actual para confirmar el cambio.</p>
      </header>

      <section className="account-card" aria-labelledby="change-password-heading">
        <div className="account-card-heading">
          <span className="account-icon"><KeyRound size={18} /></span>
          <div>
            <h2 id="change-password-heading">Cambiar contraseña</h2>
            <p>Usa al menos 12 caracteres. Al cambiarla, las demás sesiones activas se cerrarán.</p>
          </div>
        </div>
        <form className="account-form account-password-form" onSubmit={submit}>
          <label>
            <span>Contraseña actual</span>
            <input id="current-password" name="currentPassword" type="password" autoComplete="current-password" required maxLength={1024} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
          </label>
          <label>
            <span>Nueva contraseña</span>
            <input id="new-password" name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          </label>
          <label>
            <span>Confirmar nueva contraseña</span>
            <input id="confirm-new-password" name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          </label>
          {error && <p className="account-message account-message-error" role="alert">{error}</p>}
          {success && <p className="account-message account-message-success" role="status"><CheckCircle2 size={16} /> {success}</p>}
          <div className="account-form-actions">
            <button className="button button-primary" type="submit" disabled={busy}>
              {busy ? <LoaderCircle size={16} className="spin" /> : null}
              {busy ? 'Actualizando…' : 'Cambiar contraseña'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
