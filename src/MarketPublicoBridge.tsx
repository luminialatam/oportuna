import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, ExternalLink, LoaderCircle, Puzzle, ShieldCheck } from 'lucide-react';

type PublicListing = { CodigoExterno: string; Nombre?: string; Comprador?: { NombreOrganismo?: string }; Fechas?: { FechaCierre?: string } };

export function MarketPublicoBridge({ code, csrfToken, companyName, canSave, onSaved }: { code: string; csrfToken: string; companyName: string; canSave: boolean; onSaved: (code: string) => void }) {
  const [extensionDetected, setExtensionDetected] = useState(false);
  const [listing, setListing] = useState<PublicListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const nonce = globalThis.crypto.randomUUID();
    let settled = false;
    const finish = (detected: boolean) => { if (!settled) { settled = true; setExtensionDetected(detected); } };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (event.data?.type === 'oportuna-extension:pong' && event.data?.nonce === nonce) finish(true);
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'oportuna-extension:ping', nonce }, window.location.origin);
    const timer = window.setTimeout(() => finish(false), 700);
    return () => { window.clearTimeout(timer); window.removeEventListener('message', onMessage); };
  }, []);

  useEffect(() => {
    if (!code) { setListing(null); setError(''); setSaved(false); return; }
    let active = true;
    setLoading(true); setError(''); setListing(null); setSaved(false);
    void fetch('/api/company/bridge/resolve', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ code }) })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'No se pudo recuperar la ficha pública.'); return data; })
      .then(data => { if (active) setListing(data.listing); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudo recuperar la ficha pública.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [code, csrfToken]);

  const save = async () => {
    if (!listing || !canSave || saving) return;
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/company/tracking', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ codigo: listing.CodigoExterno }) });
      const data = response.status === 204 ? {} : await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar en Seguimiento.');
      setSaved(true);
      window.setTimeout(() => onSaved(listing.CodigoExterno), 500);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar en Seguimiento.'); }
    finally { setSaving(false); }
  };

  return <div className="mx-auto w-full max-w-4xl space-y-6">
    <header className="rounded-2xl border border-[#E1E4EA] bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#f0edff] text-[#5636D9]"><Puzzle size={22} /></span><div><div className="text-[11px] font-bold uppercase tracking-wider text-[#5636D9]">Puente de ficha pública</div><h1 className="text-2xl font-bold text-[#171A24]">Mercado Público</h1></div></div>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-[#5D6472]">Abre una ficha pública de Mercado Público y luego la extensión Oportuna. El puente envía el código detectado; Oportuna recupera la ficha con su API oficial.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3"><span role="status" className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${extensionDetected ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{extensionDetected ? <><CheckCircle2 size={14}/>Extensión detectada</> : <><Puzzle size={14}/>Extensión no detectada</>}</span><a href="https://www.mercadopublico.cl/" target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[#5636D9] px-3 text-xs font-semibold text-white">Probar puente en Mercado Público <ExternalLink size={13}/></a></div>
    </header>

    {code ? <section className="rounded-2xl border border-[#E1E4EA] bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3"><div><div className="text-[11px] font-bold uppercase tracking-wider text-[#5636D9]">Código recibido desde la ficha</div><h2 className="mt-1 font-mono text-xl font-bold text-[#171A24]">{code}</h2></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">Empresa activa: {companyName}</span></div>
      {loading ? <div className="mt-5 flex items-center gap-2 text-sm text-[#5D6472]"><LoaderCircle size={17} className="animate-spin"/>Recuperando ficha desde Mercado Público…</div> : null}
      {error ? <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {listing ? <div className="mt-5 rounded-xl border border-[#E9ECF1] bg-[#F8F9FA] p-4"><h3 className="font-bold text-[#171A24]">{listing.Nombre || 'Ficha pública'}</h3><p className="mt-1 text-sm text-[#5D6472]">{listing.Comprador?.NombreOrganismo || 'Organismo no informado'}</p><p className="mt-1 text-xs text-[#737D91]">Código {listing.CodigoExterno}</p><div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" disabled={!canSave || saving || saved} onClick={() => void save()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#5636D9] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving ? <LoaderCircle size={16} className="animate-spin"/> : saved ? <CheckCircle2 size={16}/> : null}{saved ? 'Guardada en Seguimiento' : saving ? 'Guardando…' : 'Guardar en Seguimiento'}<ArrowRight size={14}/></button>{!canSave ? <span className="text-xs text-amber-800">Tu acceso es de solo lectura; solicita a un administrador que guarde la oportunidad.</span> : null}</div></div> : null}
      <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-[#737D91]"><ShieldCheck size={15} className="mt-0.5 shrink-0"/>Se mantiene tu sesión y la empresa activa. Guardar usa los permisos y cupos actuales de Oportuna. Este puente no lee credenciales, cookies del proveedor ni datos de postulaciones.</p>
    </section> : <section className="rounded-2xl border border-dashed border-[#C9CED8] bg-white p-6 text-sm text-[#5D6472]">Para probarlo, abre una ficha pública en Mercado Público, abre la extensión desde Chrome y pulsa <b>Abrir en Oportuna</b>. El código aparecerá aquí y podrás revisar la empresa antes de guardarlo.</section>}
  </div>;
}
