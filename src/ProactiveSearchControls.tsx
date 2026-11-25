import { useEffect, useState } from 'react';
import { BellRing, LoaderCircle } from 'lucide-react';

type Preferences={enabled:boolean;frequency:'hourly'|'daily'|'weekly';lastCheckedAt:string|null;lastErrorCode:string|null;configuredProfiles:number;scheduler:{processScheduler:boolean;externalEndpoint:boolean;frequencyFloorMinutes:number}};

export function ProactiveSearchControls({csrfToken,canManageCompany}:{csrfToken:string;canManageCompany:boolean}){
  const [value,setValue]=useState<Preferences|null>(null);
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const load=async()=>{
    setError('');
    try{const response=await fetch('/api/company/proactive-search',{credentials:'same-origin',cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'No se pudo consultar la búsqueda automática.');setValue(data);}
    catch(cause){setError(cause instanceof Error?cause.message:'No se pudo consultar la búsqueda automática.');}
  };
  useEffect(()=>{void load();},[]);
  const save=async(next:Partial<Pick<Preferences,'enabled'|'frequency'>>)=>{
    if(!value)return;
    const body={enabled:next.enabled??value.enabled,frequency:next.frequency??value.frequency};setSaving(true);setError('');
    try{const response=await fetch('/api/company/proactive-search',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error||'No se pudo guardar la preferencia.');setValue(data);}
    catch(cause){setError(cause instanceof Error?cause.message:'No se pudo guardar la preferencia.');}
    finally{setSaving(false);}
  };
  const schedulerMessage=value?.scheduler.processScheduler
    ?'Las búsquedas periódicas están habilitadas en el servidor.'
    :value?.scheduler.externalEndpoint
      ?'La búsqueda periódica depende de una tarea de actualización configurada para Oportuna. También puedes ejecutar una búsqueda manual desde esta página.'
      :'No hay una tarea periódica disponible ahora. Puedes ejecutar búsquedas manuales desde Alertas.';
  return <section className="rounded-2xl border border-[#D9D1FF] bg-white p-5 shadow-sm" aria-labelledby="proactive-search-heading">
    <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f0edff] text-[#5636D9]"><BellRing size={19}/></span><div><h2 id="proactive-search-heading" className="font-bold text-[#171A24]">Búsqueda automática por perfil</h2><p className="mt-1 max-w-3xl text-sm text-[#5D6472]">Oportuna compara el perfil comercial y los productos de tu empresa con las licitaciones activas del índice local. Las nuevas coincidencias aparecen en Alertas con una explicación. Esta búsqueda no consulta Mercado Público en tiempo real.</p></div></div>
    {!value&&!error&&<p className="mt-4 flex items-center gap-2 text-sm text-[#5D6472]" role="status"><LoaderCircle size={16} className="animate-spin"/>Cargando preferencia…</p>}
    {error&&<p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
    {value&&<>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="grid gap-1 text-sm font-medium text-[#4C5568]">Frecuencia<select value={value.frequency} disabled={!canManageCompany||saving} onChange={event=>void save({frequency:event.target.value as Preferences['frequency']})} className="h-10 rounded-lg border border-[#DCE1EA] bg-white px-3"><option value="hourly">Cada hora</option><option value="daily">Diaria</option><option value="weekly">Semanal</option></select></label>
        <label className="flex min-h-10 items-center gap-2 text-sm font-semibold text-[#303747]"><input type="checkbox" checked={value.enabled} disabled={!canManageCompany||saving} onChange={event=>void save({enabled:event.target.checked})}/>{saving?'Guardando…':value.enabled?'Activa':'Pausada'}</label>
        {value.configuredProfiles===0&&<span className="text-sm text-[#8A5D12]">Para recibir coincidencias, agrega palabras clave comerciales a Mi empresa o crea productos con términos relacionados en el catálogo.</span>}
      </div>
      <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{schedulerMessage}</p>
      {value.lastCheckedAt&&<p className="mt-2 text-xs text-[#737D91]">Última búsqueda: {new Intl.DateTimeFormat('es-CL',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Santiago'}).format(new Date(value.lastCheckedAt))}{value.lastErrorCode==='SEARCH_FAILED'?' · La última ejecución tuvo un problema; prueba la búsqueda manual.':''}</p>}
      {!canManageCompany&&<p className="mt-2 text-xs text-[#737D91]">Solo una persona administradora de la empresa puede cambiar esta preferencia.</p>}
    </>}
  </section>;
}
