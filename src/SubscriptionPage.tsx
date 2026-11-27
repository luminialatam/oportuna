import { useCallback, useEffect, useState } from 'react';
import { Check, LoaderCircle, Sparkles } from 'lucide-react';

type PlanId = 'crece' | 'vuela' | 'brilla';
type BillingPeriod = 'monthly' | 'annual';
type Plan = { id: PlanId; name: string; priceClp: number; annualPriceClp: number; users: number; analysesMonthly: number; recommendationsWeekly: number | null; trackedOpportunities: number | null; marketAnalytics: boolean };
type PlanRequest = { id: number; requestedPlan: PlanId; billingPeriod: BillingPeriod; status: 'pending' | 'approved' | 'rejected'; requestedAt: string; reviewedAt: string | null; decisionNote: string | null; reviewerFirstName: string | null; reviewerLastName: string | null };
type Summary = { plan: Plan; billingPeriod: BillingPeriod; usage: { activeUsers: number; pendingInvitations: number; analysesMonthly: number; trackedOpportunities: number; recommendationsWeekly: number } };

const features = [
  { id: 'crece' as const, title: 'Crece', users: '1 usuario activo', analyses: '3 análisis de fichas al mes', recommendations: 'Hasta 5 recomendaciones semanales', tracking: 'Hasta 10 oportunidades activas en seguimiento', analytics: false },
  { id: 'vuela' as const, title: 'Vuela', users: '3 usuarios activos', analyses: '30 análisis de fichas al mes', recommendations: 'Recomendaciones completas según el catálogo', tracking: 'Seguimiento sin tope del plan', analytics: true },
  { id: 'brilla' as const, title: 'Brilla', users: '5 usuarios activos', analyses: '100 análisis de fichas al mes', recommendations: 'Recomendaciones completas según el catálogo', tracking: 'Seguimiento sin tope del plan', analytics: true },
];
const money = (amount: number) => new Intl.NumberFormat('es-CL').format(amount);
const planPrice = (plan: Plan, period: BillingPeriod) => plan.id === 'crece' ? 'Gratis' : `$${money(period === 'annual' ? plan.annualPriceClp : plan.priceClp)} CLP al ${period === 'annual' ? 'año' : 'mes'} + IVA`;
const statusLabel = { pending: 'Pendiente de revisión', approved: 'Aprobada', rejected: 'Rechazada' } as const;

export function SubscriptionPage({ csrfToken, canRequest, onPlanLoaded }: { csrfToken: string; canRequest: boolean; onPlanLoaded?: (summary: Summary) => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [requests, setRequests] = useState<PlanRequest[]>([]);
  const [period, setPeriod] = useState<BillingPeriod>('monthly');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [submittingPlan, setSubmittingPlan] = useState<PlanId | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const requestsPromise = canRequest ? fetch('/api/company/plan-requests', { credentials: 'same-origin', cache: 'no-store' }) : Promise.resolve(null);
      const [planResponse, requestsResponse] = await Promise.all([
        fetch('/api/company/plan', { credentials: 'same-origin', cache: 'no-store' }), requestsPromise,
      ]);
      const data = await planResponse.json();
      if (!planResponse.ok) throw new Error(data.error || 'No se pudo cargar el plan de la empresa.');
      setSummary(data); setPeriod(data.billingPeriod === 'annual' ? 'annual' : 'monthly'); onPlanLoaded?.(data);
      if (requestsResponse) {
        const requestData = await requestsResponse.json();
        if (!requestsResponse.ok) throw new Error(requestData.error || 'No se pudo cargar el estado de las solicitudes.');
        setRequests(requestData.requests ?? []);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar el plan de la empresa.'); }
    finally { setLoading(false); }
  }, [canRequest, onPlanLoaded]);
  useEffect(() => { void load(); }, [load]);

  const requestPlan = async (plan: PlanId) => {
    if (!canRequest || pendingRequest) return;
    setSubmittingPlan(plan); setError(''); setNotice('');
    try {
      const response = await fetch('/api/company/plan-requests', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ plan, billingPeriod: plan === 'crece' ? 'monthly' : period }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo enviar la solicitud.');
      setNotice('Solicitud enviada. El plan se activará cuando la revise un administrador de plataforma.');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo enviar la solicitud.'); }
    finally { setSubmittingPlan(null); }
  };

  const usage = summary?.usage;
  const plan = summary?.plan;
  const current = features.find(item => item.id === plan?.id);
  const pendingRequest = requests.find(item => item.status === 'pending');
  const used = [
    ['Usuarios activos', usage?.activeUsers ?? 0, plan?.users ?? 1],
    ['Análisis este mes', usage?.analysesMonthly ?? 0, plan?.analysesMonthly ?? 3],
    ['Recomendaciones esta semana', usage?.recommendationsWeekly ?? 0, plan?.recommendationsWeekly ?? 5],
    ['Oportunidades en seguimiento', usage?.trackedOpportunities ?? 0, plan?.trackedOpportunities ?? 10],
  ] as const;

  return <div className="mx-auto w-full max-w-6xl space-y-7">
    <header className="border-b border-[#E1E4EA] pb-4">
      <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#5636D9]"><Sparkles size={15} /> Cuenta</div>
      <h1 className="text-2xl font-bold text-[#171A24]">Plan y suscripción</h1>
      <p className="mt-1 text-sm text-[#5D6472]">Solicita un cambio de plan. La activación es manual y esta pantalla no procesa cobros.</p>
    </header>
    {loading ? <div className="flex items-center gap-2 rounded-xl border border-[#E1E4EA] bg-white p-6 text-sm text-[#5D6472]"><LoaderCircle size={18} className="animate-spin" /> Cargando plan…</div> : null}
    {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}<button className="ml-3 font-semibold underline" onClick={() => void load()}>Reintentar</button></div> : null}
    {notice ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div> : null}
    {summary && current ? <>
      <section className="rounded-2xl border border-[#5636D9]/25 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><span className="text-xs font-bold uppercase tracking-wide text-[#5636D9]">Plan activo</span><h2 className="mt-1 text-xl font-bold text-[#171A24]">{current.title}</h2><p className="mt-1 text-sm text-[#5D6472]">{planPrice(plan!, summary.billingPeriod)}</p></div>
          <span className="rounded-full bg-[#f0edff] px-3 py-1 text-xs font-semibold text-[#5636D9]">Activación manual</span>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {used.map(([label, value, limit]) => <div key={label}>
            <div className="mb-1 flex justify-between gap-2 text-xs"><span className="text-[#5D6472]">{label}</span><b className="text-[#171A24]">{value.toLocaleString('es-CL')} / {limit === null ? 'Sin tope' : limit.toLocaleString('es-CL')}</b></div>
            {limit !== null ? <div className="h-2 overflow-hidden rounded-full bg-[#F0F1F4]"><div className="h-full rounded-full bg-[#5636D9]" style={{ width: `${Math.min(100, limit ? value / limit * 100 : 0)}%` }} /></div> : <div className="h-2 rounded-full bg-emerald-100" />}
          </div>)}
        </div>
      </section>

      {canRequest ? <section className="rounded-2xl border border-[#E1E4EA] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-[#171A24]">Solicitar cambio de plan</h2><p className="mt-1 text-xs text-[#737D91]">Un administrador de plataforma revisará la solicitud.</p></div>
          <div role="group" aria-label="Modalidad de pago" className="inline-flex rounded-xl border border-[#DCE1EA] bg-[#F7F8FA] p-1"><button type="button" aria-pressed={period === 'monthly'} onClick={() => setPeriod('monthly')} className={`rounded-lg px-4 py-2 text-xs font-semibold ${period === 'monthly' ? 'bg-white text-[#5636D9] shadow-sm' : 'text-[#5D6472]'}`}>Mensual</button><button type="button" aria-pressed={period === 'annual'} onClick={() => setPeriod('annual')} className={`rounded-lg px-4 py-2 text-xs font-semibold ${period === 'annual' ? 'bg-white text-[#5636D9] shadow-sm' : 'text-[#5D6472]'}`}>Anual <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">Ahorra 15%</span></button></div>
        </div>
        {pendingRequest ? <div role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Solicitud pendiente: {features.find(item => item.id === pendingRequest.requestedPlan)?.title} · {pendingRequest.billingPeriod === 'annual' ? 'Anual' : 'Mensual'}. No se puede crear otra hasta que se resuelva.</div> : null}
      </section> : null}

      <section className="grid gap-4 lg:grid-cols-3" aria-label="Opciones de plan">
        {features.map(option => {
          const optionPrice = option.id === 'crece' ? 'Gratis' : `$${money(period === 'annual' ? planCatalogPrice(option.id, 'annual') : planCatalogPrice(option.id, 'monthly'))} CLP al ${period === 'annual' ? 'año' : 'mes'} + IVA`;
          const isCurrent = option.id === current.id;
          const isCurrentSelection = isCurrent && (option.id === 'crece' || summary.billingPeriod === period);
          const isRecommended = option.id === 'vuela';
          return <article key={option.id} className={`relative flex flex-col rounded-2xl border bg-white p-5 shadow-sm ${isRecommended ? 'border-[#5636D9] ring-1 ring-[#5636D9]' : 'border-[#E1E4EA]'}`}>
            {isRecommended ? <span className="absolute -top-3 right-4 rounded-full bg-[#5636D9] px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-white">Recomendado</span> : null}
            <div className="flex items-start justify-between gap-2"><div><h3 className="text-lg font-bold text-[#171A24]">{option.title}</h3><p className="mt-1 min-h-10 text-sm font-semibold text-[#5636D9]">{optionPrice}</p></div>{isCurrent && <span className="rounded-full bg-[#f0edff] px-2.5 py-1 text-[11px] font-semibold text-[#5636D9]">Plan actual</span>}</div>
            <ul className="mt-4 flex-1 space-y-3 text-sm text-[#4C5568]">{[option.users, option.analyses, option.recommendations, option.tracking, ...(option.analytics ? ['Inteligencia de mercado'] : ['Resumen y buscador'])].map(feature => <li key={feature} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-emerald-600" /><span>{feature}</span></li>)}</ul>
            {option.analytics && <p className="mt-4 text-xs text-[#737D91]">Incluye los cinco principales compradores por licitaciones indexadas de los últimos 30 días.</p>}
            {canRequest ? <button type="button" disabled={Boolean(pendingRequest) || submittingPlan !== null || isCurrentSelection} onClick={() => void requestPlan(option.id)} className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#5636D9] px-4 text-sm font-semibold text-white hover:bg-[#4b2ec7] disabled:cursor-not-allowed disabled:opacity-50">{submittingPlan === option.id ? <LoaderCircle size={16} className="animate-spin" /> : null}{isCurrentSelection ? 'Plan actual' : isCurrent ? 'Solicitar cambio de modalidad' : `Solicitar ${option.title}`}</button> : null}
          </article>;
        })}
      </section>

      {canRequest && requests.length ? <section className="rounded-2xl border border-[#E1E4EA] bg-white p-5 shadow-sm"><h2 className="font-bold text-[#171A24]">Estado de solicitudes</h2><div className="mt-3 divide-y divide-[#E9ECF1]">{requests.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div><b>{features.find(planOption => planOption.id === item.requestedPlan)?.title}</b><span className="ml-2 text-[#5D6472]">{item.billingPeriod === 'annual' ? 'Anual' : 'Mensual'}</span><p className="text-xs text-[#737D91]">{new Intl.DateTimeFormat('es-CL',{dateStyle:'medium',timeStyle:'short'}).format(new Date(item.requestedAt))}{item.reviewedAt ? ` · Revisada ${new Intl.DateTimeFormat('es-CL',{dateStyle:'medium',timeStyle:'short'}).format(new Date(item.reviewedAt))}` : ''}</p>{item.decisionNote ? <p className="text-xs text-[#737D91]">{item.decisionNote}</p> : null}</div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : item.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'}`}>{statusLabel[item.status]}</span></div>)}</div></section> : null}
    </> : null}
    <p className="text-center text-xs text-[#737D91]">La activación es manual; no se realizan cobros ni se almacena información de pago.</p>
  </div>;
}

function planCatalogPrice(plan: Exclude<PlanId, 'crece'>, period: BillingPeriod) {
  if (plan === 'vuela') return period === 'annual' ? 508_980 : 49_900;
  return period === 'annual' ? 814_980 : 79_900;
}
