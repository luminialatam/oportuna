Warning: truncated output (original token count: 15245)
Total output lines: 346

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadRuntimeConfig } from './runtimeConfig.js';
import { checkRateLimit, consumeRateLimit } from './rateLimitStore.js';
import pool from './db.js';
import { getByCode, listByDate, MercadoPublicoError } from './mercadoPublico.js';
import { startJob, getJob, pauseJob, resumeJob, retryJob, getHistory, recoverJobs, startScheduler, startSyncWorker, dailySchedulerStatus } from './syncService.js';
import { searchListings, analyzeListing, findEnrichmentCandidates, groqConfigured, clearSearchCache } from './smartSearch.js';
import { parseTenderAmount, tenderAmountStatus, tenderAmountUpsertSql } from './tenderAmount.js';
import { previewEnrichmentCandidates, enqueueEnrichment, enrichmentMetrics, enrichmentPilotStatus, enrichmentStatus, findPriorityCandidates, indexOfficialDetail, pauseEnrichmentPilot, resumeEnrichmentPilot, retryEnrichmentPilotFailures, startEnrichmentPilotBatch, recoverEnrichmentQueue, startEnrichmentWorker } from './listingEnrichment.js';
import { deleteCompanyProduct, getCompanyMatches, getCompanyWorkspace, saveCompanyProfile, saveCompanyProduct, searchCompanyProducts, suggestCommercialTerms } from './companyService.js';
import { addTrackedDate, deleteTrackedDate, deleteTrackedOpportunity, getTrackedCounts, getTrackedStatus, listTrackedOpportunities, saveTrackedOpportunity, trackingStates, updateTrackedDate, updateTrackedOpportunity } from './trackingService.js';
import { alertCounts, dismissAlert, evaluateAlerts, listAlerts, markAlertRead } from './alertService.js';
import { startAlertScheduler } from './alertScheduler.js';
import type { ApiListing } from './types.js';
import { acceptInvitationForUser, changePasswordForSession, createInvitation, createPasswordReset, createSession, registerPendingUser, issueEmailVerification, issueEmailVerificationForAddress, completeEmailVerification, consumePasswordReset, getSession, login, normalizeEmail, revokeSession, rotateCsrf, setActiveCompany, updatePersonalProfile } from './authService.js';
import { clearSessionCookies, csrfCookieName, getRequestCsrfToken, getRequestSessionToken, requireActiveCompany, requireAdministrator, requireAuth, requireCompanyRole, requireCsrf, requirePlatformAdmin, requireRequestOrigin, requireSecureTransport, requireServiceOrAdmin, requireVerifiedEmail, setSessionCookies } from './authMiddleware.js';
import { appBaseUrl, emailMode, getLocalMail, localMailPreviewEnabled, logSmtpFailure, probeSmtp, sanitizedSmtpFailureCode, sendEmail, type MailPurpose } from './emailService.js';
import { listCompanyAccessRequests, registerCompanyForCurrentUser, requestCompanyAccess, reviewCompanyAccessRequest } from './onboardingService.js';
import { normalizeChileanRut } from './chileanRut.js';
import { logMysqlFailure } from './mysqlDiagnostics.js';
import { runSmtpStartupProbeOnce } from './smtpStartupProbe.js';

const app = express();
const runtime = loadRuntimeConfig();
app.disable('x-powered-by');
app.set('trust proxy',runtime.trustProxyHops || false);
app.use(cors({ origin: (origin, callback) => callback(null, !origin || runtime.allowedOrigins.includes(origin)), credentials: true, optionsSuccessStatus: 204 }));
app.use(express.json({ limit: '32kb' }));
app.use(requireSecureTransport);
const backendDirectory = dirname(fileURLToPath(import.meta.url));
const frontendDirectory = [
  join(process.cwd(), 'dist'),
  join(backendDirectory, '../../dist'),
  join(backendDirectory, '../../../dist'),
].find((candidate) => existsSync(join(candidate, 'index.html'))) ?? join(process.cwd(), 'dist');
if (runtime.appEnv !== 'development' && ['web', 'all'].includes(runtime.processRole)) {
  if (!existsSync(join(frontendDirectory, 'index.html'))) {
    throw new Error('No existe el frontend compilado en dist/index.html; ejecuta el build antes de iniciar el rol web.');
  }
  app.use(express.static(frontendDirectory, {
    index: false,
    setHeaders: (response, filePath) => {
      response.setHeader('Cache-Control', filePath.endsWith('.html') ? 'no-store' : 'public, max-age=31536000, immutable');
    },
  }));
}
app.use('/api/buscador', (req,res,next)=>{const started=Date.now();res.on('finish',()=>console.info(`[search] ${req.method} ${req.path} status=${res.statusCode} duration_ms=${Date.now()-started}`));next();});
const dateSchema = z.string().regex(/^\d{8}$/);
function requestLimit(max:number, windowMs:number, scope='request'):express.RequestHandler{return(req,res,next)=>{const route=String(req.route?.path??req.path);void consumeRateLimit(`${scope}:${req.ip??'unknown'}:${req.method}:${route}`,max,windowMs).then(decision=>{if(!decision.allowed){res.set('Retry-After',String(decision.retryAfterSeconds));res.status(429).json({error:'Demasiadas solicitudes. Espera un momento y vuelve a intentar.'});return;}next();}).catch(()=>res.status(503).json({error:'El control de solicitudes no está disponible.'}));};}
function dbDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
}
function normalized(row: ApiListing) {
  if (typeof row.CodigoExterno !== 'string' || !row.CodigoExterno.trim()) throw new Error('Una licitación de la API no incluye CodigoExterno.');
  const number = row.CodigoEstado == null || row.CodigoEstado === '' ? null : Number(row.CodigoEstado);
  const amount = parseTenderAmount(row.MontoEstimado);
  return {
    codigo: row.CodigoExterno, nombre: typeof row.Nombre === 'string' ? row.Nombre : null,
    estado: number != null && Number.isFinite(number) ? number : null,
    cierre: dbDate(row.FechaCierre ?? row.Fechas?.FechaCierre),
    publicacion: dbDate(row.Fechas?.FechaPublicacion ?? row.Fechas?.FechaCreacion),
    organismo: typeof row.Comprador?.NombreOrganismo === 'string' ? row.Comprador.NombreOrganismo : null,
    monto: amount != null && Number.isFinite(amount) ? amount : null,
    moneda: typeof row.Moneda === 'string' ? row.Moneda : null,
  };
}
function requireDb(_req: express.Request, _res: express.Response, next: express.NextFunction) {
  void pool.query('SELECT 1').then(() => next()).catch((error) => {
    logMysqlFailure('request_guard', error);
    next(new MercadoPublicoError('MySQL no está disponible o la migración aún no se ha ejecutado.', 503));
  });
}
app.get('/api/health', async (req, res) => {
  let mysqlOk = false;
  let mysqlFailureCode: ReturnType<typeof logMysqlFailure> | undefined;
  try { await pool.query('SELECT 1'); mysqlOk = true; } catch (error) { mysqlFailureCode = logMysqlFailure('health_check', error); }
  const payload = { ok: true, apiConfigured: Boolean(process.env.MERCADOPUBLICO_TICKET?.trim()), mysql: mysqlOk };
  if (req.query.diagnostics === '1') {
    res.set('Cache-Control', 'no-store');
    return res.json({ ...payload, mysqlCode: mysqlFailureCode ?? null });
  }
  return res.json(payload);
});
app.get('/api/auth/email-mode',(_req,res)=>res.set('Cache-Control','no-store').json({localPreview:localMailPreviewEnabled(),mode:emailMode()}));
app.post('/api/platform/email/smtp-check',requireDb,requireAuth,requireCsrf,requirePlatformAdmin,requestLimit(3,60*60_000,'smtp-check'),async(_req,res)=>{
  res.set('Cache-Control','no-store');
  try {
    if(emailMode()!=='smtp')return res.status(409).json({ok:false,code:'SMTP_NOT_ACTIVE'});
    await probeSmtp();
    return res.json({ok:true,code:'SMTP_AUTHENTICATED'});
  } catch(error) {
    const code=sanitizedSmtpFailureCode(error);
    console.error(`[email] smtp_probe_failed code=${code}`);
    return res.status(503).json({ok:false,code});
  }
});
app.get('/api/licitaciones', requireDb, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const search = String(req.query.search ?? '').trim().slice(0, 150);
    const state = String(req.query.estado ?? '').trim();
    const clauses: string[] = []; const values: unknown[] = [];
    if (search) { clauses.push('(nombre LIKE ? OR codigo_externo LIKE ?)'); values.push(`%${search}%`, `%${search}%`); }
    if (state && /^\d+$/.test(state)) { clauses.push('codigo_estado = ?'); values.push(Number(state)); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [[countRows], [rows]] = await Promise.all([
      pool.query<any[]>(`SELECT COUNT(*) AS total FROM licitaciones ${where}`, values),
      pool.query<any[]>(`SELECT id,codigo_externo,nombre,codigo_estado,fecha_cierre,fecha_publicacion,organismo,monto_estimado,moneda,last_synced_at,JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.VisibilidadMonto')) amount_visibility FROM licitaciones ${where} ORDER BY fecha_cierre IS NULL, fecha_cierre ASC LIMIT ? OFFSET ?`, [...values, pageSize, (page - 1) * pageSize]),
    ]);
    res.json({ items: rows.map((row) => { const {amount_visibility:_visibility,...item}=row; return {...item,monto_estado:tenderAmountStatus(row.monto_estimado,row.amount_visibility)}; }), total: Number(countRows[0].total), page, pageSize });
  } catch (error) { next(error); }
});
app.get('/api/licitaciones/:codigo/local',requireDb,requestLimit(120,60_000),async(req,res,next)=>{
  try{
    const codigo=z.string().trim().min(1).max(100).parse(req.params.codigo);
    const [rows]=await pool.query<any[]>('SELECT codigo_externo,nombre,codigo_estado,fecha_cierre,fecha_publicacion,organismo,monto_estimado,moneda,payload_json FROM licitaciones WHERE codigo_externo=? LIMIT 1',[codigo]);
    if(!rows[0])return res.status(404).json({error:'La licitación no está disponible en la copia local.'});
    const row=rows[0];let detail:any=row.payload_json;
    if(typeof detail==='string'){try{detail=JSON.parse(detail)}catch{detail={}}}
    if(!detail||typeof detail!=='object'||Array.isArray(detail))detail={};
    const [itemRows]=await pool.query<any[]>('SELECT nombre,descripcion,categoria,cantidad,unidad_medida FROM licitacion_items WHERE codigo_externo=? ORDER BY item_index',[codigo]);
    const payloadItems=Array.isArray(detail.Items?.Listado)?detail.Items.Listado:[];
    const items=payloadItems.length?payloadItems:itemRows.map(item=>({NombreProducto:item.nombre,Descripcion:item.descripcion,Categoria:item.categoria,Cantidad:item.cantidad,UnidadMedida:item.unidad_medida}));
    const listing={...detail,CodigoExterno:detail.CodigoExterno??row.codigo_externo,Nombre:detail.Nombre??row.nombre,CodigoEstado:detail.CodigoEstado??row.codigo_estado,FechaCierre:detail.FechaCierre??row.fecha_cierre,Fechas:detail.Fechas??(row.fecha_publicacion?{FechaPublicacion:row.fecha_publicacion}:undefined),Comprador:detail.Comprador??(row.organismo?{NombreOrganismo:row.organismo}:undefined),MontoEstimado:detail.MontoEstimado??row.monto_estimado,Moneda:detail.Moneda??row.moneda,Items:payloadItems.length?detail.Items:(items.length?{Cantidad:items.length,Listado:items}:detail.Items)};
    const buyer=detail.Comprador;
    const detailAvailable=Boolean(
      (typeof detail.Descripcion==='string'&&detail.Descripcion.trim())||
      (buyer&&typeof buyer==='object'&&Object.values(buyer).some(value=>typeof value==='string'&&value.trim()))||
      items.length||
      ['Documentos','Archivos','Anexos','Adjuntos'].some(key=>Array.isArray(detail[key])&&detail[key].length)
    );
    res.json({source:'local',detailAvailable,listing});
  }catch(error){next(error);}
});
app.post('/api/licitaciones/:codigo/refresh',requireDb,requireAuth,requireCsrf,requireActiveCompany,requireCompanyRole('admin'),requestLimit(12,60_000),async (req, res, next) => {
  try {
    const codigo = z.string().min(1).max(100).parse(req.params.codigo);
    const detail = await getByCode(codigo);
    const values = normalized(detail);
    await pool.execute(`INSERT INTO licitaciones (codigo_externo,nombre,codigo_estado,fecha_cierre,fecha_publicacion,organismo,monto_estimado,moneda,payload_json,last_synced_at) VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE nombre=COALESCE(VALUES(nombre),nombre),codigo_estado=COALESCE(VALUES(codigo_estado),codigo_estado),fecha_cierre=COALESCE(VALUES(fecha_cierre),fecha_cierre),fecha_publicacion=COALESCE(VALUES(fecha_publicacion),fecha_publicacion),organismo=COALESCE(VALUES(organismo),organismo),${tenderAmountUpsertSql},moneda=COALESCE(VALUES(moneda),moneda),payload_json=JSON_MERGE_PATCH(payload_json,VALUES(payload_json)),last_synced_at=UTC_TIMESTAMP()`, [values.codigo, values.nombre, values.estado, values.cierre, values.publicacion, values.organismo, values.monto, values.moneda, JSON.stringify(detail)]);
    clearSearchCache();
    try { await indexOfficialDetail(values.codigo, detail as unknown as Record<string, any>); } catch (error) { console.warn(`[enrichment] detalle recibido pero no indexado; tipo=${error instanceof Error?error.name:'error'}`); }
    res.json(detail);
  } catch (error) { next(error); }
});
app.get('/api/buscador/status', (_req,res)=>res.json({groqConfigured:groqConfigured(),mode:groqConfigured()?'groq':'mysql'}));
app.post('/api/buscador/search',requireDb,requireAuth,requireCsrf,requireActiveCompany,requestLimit(30,60_000),async(req,res,next)=>{
  try{const body=z.object({query:z.string().trim().min(2).max(500),page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(10),states:z.array(z.number().int().min(0).max(999)).max(12).optional(),region:z.string().trim().max(80).nullable().optional(),budgetMin:z.number().nonnegative().nullable().optional(),budgetMax:z.number().nonnegative().nullable().optional(),closeAfter:z.string().date().nullable().optional(),closeBefore:z.string().date().nullable().optional(),matchLevel:z.enum(['high','medium','exploratory']).optional()}).parse(req.body);if(body.budgetMin!=null&&body.budgetMax!=null&&body.budgetMin>body.budgetMax)return res.status(400).json({error:'El presupuesto mínimo no puede superar el máximo.'});res.json(await searchListings(body));}catch(error){next(error);}
});
const authLoginSchema=z.object({email:z.string().trim().min(3).max(320),password:z.string().min(1).max(1024)});
app.get('/api/auth/session',requireDb,async(req,res,next)=>{res.set('Cache-Control','no-store');try{const sessionToken=getRequestSessionToken(req);const session=await getSession(sessionToken,getRequestCsrfToken(req));if(!session){const sessionExpired=Boolean(sessionToken);if(sessionExpired)clearSessionCookies(res);return res.json({authenticated:false,sessionExpired});}const {csrfToken,...safe}=session;res.json({authenticated:true,...safe,csrfToken});}catch(error){next(error);}});
app.patch('/api/auth/profile',requireDb,requireAuth,requireVerifiedEmail,requireCsrf,requestLimit(20,60_000,'account-profile'),async(req,res,next)=>{try{const body=z.object({firstName:z.string().trim().min(1).max(100),lastName:z.string().trim().max(100)}).strict().parse(req.body);if(!await updatePersonalProfile(req.auth!.userId,body.firstName,body.lastName))return res.status(404).json({error:'No se encontró la cuenta activa.'});res.set('Cache-Control','no-store').json({firstName:body.firstName,lastName:body.lastName});}catch(error){next(error);}});
app.post('/api/auth/password/change',requireDb,requireAuth,requireVerifiedEmail,requireCsrf,requestLimit(5,15*60_000,'password-change'),async(req,res,next)=>{try{const body=z.object({currentPassword:z.string().min(1).max(1024),newPassword:z.string().min(12).max(1024)}).strict().parse(req.body);const outcome=await changePasswordForSession(req.auth!.userId,req.auth!.id,body.currentPassword,body.newPassword);if(outcome==='same_password')return res.status(400).json({error:'La nueva contraseña debe ser distinta de la actual.'});if(outcome==='invalid_current_password')return res.status(400).json({error:'La contraseña actual no es correcta.'});res.set('Cache-Control','no-store').json({ok:true,message:'Contraseña actualizada. Se cerraron las demás sesiones activas.'});}catch(error){next(error);}});
app.post('/api/auth/login',requireDb,requestLimit(60,15*60_000,'login-ip'),requireRequestOrigin,async(req,res,next)=>{try{const body=authLoginSchema.parse(req.body);const accountKey=`login-account:${req.ip??'unknown'}:${normalizeEmail(body.email)}`;const accountLimit=await checkRateLimit(accountKey,10,15*60_000);if(!accountLimit.allowed){res.set('Retry-After',String(accountLimit.retryAfterSeconds));return res.status(429).json({error:'Demasiados intentos. Espera antes de volver a intentar.'});}const userId=await login(body.email,body.password);if(!userId){const failed=await consumeRateLimit(accountKey,10,15*60_000);if(!failed.allowed){res.set('Retry-After',String(failed.retryAfterSeconds));return res.status(429).json({error:'Demasiados intentos. Espera antes de volver a intentar.'});}return res.status(401).json({error:'Correo o contraseña incorrectos.'});}const created=await createSession(userId);setSessionCookies(res,created.raw,created.csrf,created.expires);res.set('Cache-Control','no-store');const {csrfToken,...safe}=created.session;res.json({authenticated:true,...safe,csrfToken});}catch(error){next(error);}});
app.post('/api/auth/register',requireDb,requestLimit(6,60*60_000,'register'),requireRequestOrigin,async(req,res,next)=>{let requestedEmail='';try{const body=z.object({invitationToken:z.string().min(32).max(128).optional(),firstName:z.string().trim().min(1).max(100),lastName:z.string().trim().min(1).max(100),email:z.string().trim().min(3).max(320),password:z.string().min(12).max(1024)}).parse(req.body);requestedEmail=body.email;const pending=await registerPendingUser(body.email,body.password,body.firstName,body.lastName,body.invitationToken);const link=`${appBaseUrl()}/?verifyEmail=${encodeURIComponent(pending.token)}`;let delivery:'accepted'|'simulated'|'failed'='failed';try{delivery=await sendEmail({to:pending.email,purpose:'verification',subject:'Verifica tu correo de Oportuna',text:`Hola ${body.firstName},\n\nConfirma tu correo para activar el acceso a Oportuna: ${link}\n\nEl enlace vence en 30 minutos y solo se puede usar una vez.`,link});}catch{/* Keep the account pending and let the verification screen offer a retry. */}const created=await createSession(pending.userId);setSessionCookies(res,created.raw,created.csrf,created.expires);res.set('Cache-Control','no-store');const {csrfToken,...safe}=created.session;res.status(201).json({authenticated:true,...safe,csrfToken,emailVerificationRequired:true,emailDelivery:delivery});}catch(error){if((error as any)?.code==='ER_DUP_ENTRY'){try{const issued=await issueEmailVerificationForAddress(requestedEmail);if(issued){const link=`${appBaseUrl()}/?verifyEmail=${encodeURIComponent(issued.token)}`;await sendEmail({to:issued.email,purpose:'verification',subject:'Verifica tu correo de Oportuna',text:`Confirma tu correo para continuar: ${link}\n\nEl enlace vence en 30 minutos y solo se puede usar una vez.`,link});}}catch{/* Keep duplicate-account responses neutral even when delivery is unavailable. */}return res.status(202).json({message:'Si es posible crear la cuenta, recibirás instrucciones para verificar el correo.',emailVerificationRequired:true});}if(error instanceof Error&&error.message==='La invitación no es válida o venció.')return res.status(400).json({error:'La invitación no coincide con el correo o venció.'});next(error);}});
app.post('/api/auth/email-verification/resend',requireDb,requireAuth,requireCsrf,requestLimit(3,60*60_000,'email-verification-resend'),async(req,res,next)=>{try{const issued=await issueEmailVerification(req.auth!.userId);let delivery:'accepted'|'simulated'|'failed'|'not_required'='not_required';if(issued){console.info('[email] verification_token_issued channel=session');const link=`${appBaseUrl()}/?verifyEmail=${encodeURIComponent(issued.token)}`;try{delivery…5245 tokens truncated…rrors(parsed.error)});res.json(await saveCompanyProfile(parsed.data));}catch(error){if((error as any)?.code==='ER_DUP_ENTRY'&&String((error as any)?.message).includes('uq_companies_rut_normalized'))return res.status(409).json({code:'COMPANY_ALREADY_REGISTERED',error:'Este RUT ya está registrado para otra empresa.',fieldErrors:{rut:'Este RUT ya está registrado para otra empresa.'}});if(error instanceof Error&&error.message==='El RUT de una empresa registrada no se puede dejar vacío.')return res.status(400).json({error:error.message,fieldErrors:{rut:error.message}});if(error instanceof Error&&error.message==='No se encontró la empresa activa.')return res.status(400).json({error:error.message});next(error);}});
app.get('/api/company/catalog',requireDb,requestLimit(60,60_000),async(req,res,next)=>{try{res.json({items:await searchCompanyProducts(String(req.query.q??''))});}catch(error){next(error);}});
app.post('/api/company/catalog',requireDb,requestLimit(30,60_000),async(req,res,next)=>{try{res.status(201).json({items:await saveCompanyProduct(companyProductSchema.parse(req.body))});}catch(error){next(error);}});
app.patch('/api/company/catalog/:id',requireDb,requestLimit(60,60_000),async(req,res,next)=>{try{const id=z.coerce.number().int().positive().parse(req.params.id);const items=await saveCompanyProduct(companyProductSchema.parse(req.body),id);if(!items)return res.status(404).json({error:'No se encontró el producto en el catálogo de esta empresa.'});res.json({items});}catch(error){next(error);}});
app.delete('/api/company/catalog/:id',requireDb,requestLimit(30,60_000),async(req,res,next)=>{try{const deleted=await deleteCompanyProduct(z.coerce.number().int().positive().parse(req.params.id));if(!deleted)return res.status(404).json({error:'No se encontró el producto en el catálogo de esta empresa.'});res.json({ok:true});}catch(error){next(error);}});
app.post('/api/company/catalog/suggestions',requireDb,requestLimit(10,60_000),async(req,res,next)=>{try{const body=z.object({nombre:z.string().trim().min(2).max(255),categoria:nullableText(160),descripcion:nullableText(1000)}).parse(req.body);res.json(await suggestCommercialTerms(body));}catch(error){if(error instanceof Error&&error.message.startsWith('Groq'))return res.status(502).json({error:error.message});next(error);}});
app.get('/api/company/matches',requireDb,requestLimit(30,60_000),async(_req,res,next)=>{try{res.json(await getCompanyMatches());}catch(error){next(error);}});
const trackedStateSchema=z.enum(trackingStates);
app.get('/api/company/tracking/lookup',requireDb,requestLimit(120,60_000),async(req,res,next)=>{try{const codigo=z.string().trim().min(1).max(100).parse(req.query.codigo);res.json(await getTrackedStatus(codigo));}catch(error){next(error);}});
app.get('/api/company/tracking',requireDb,requestLimit(60,60_000),async(req,res,next)=>{try{const estado=String(req.query.estado??'');const q=String(req.query.q??'').slice(0,120);const [items,counts]=await Promise.all([listTrackedOpportunities({estado,q}),getTrackedCounts()]);res.json({items,counts});}catch(error){next(error);}});
app.post('/api/company/tracking',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(30,60_000),async(req,res,next)=>{try{const body=z.object({codigo:z.string().trim().min(1).max(100)}).parse(req.body);const item=await saveTrackedOpportunity(body.codigo);if(!item)return res.status(404).json({error:'La licitación no existe en los registros locales.'});res.status(201).json(item);}catch(error){next(error);}});
app.patch('/api/company/tracking/:id',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(60,60_000),async(req,res,next)=>{try{const id=z.coerce.number().int().positive().parse(req.params.id);const body=z.object({estado:trackedStateSchema.optional(),notes:z.string().trim().max(5000).nullable().optional()}).refine(value=>value.estado!==undefined||value.notes!==undefined).parse(req.body);if(!await updateTrackedOpportunity(id,body))return res.status(404).json({error:'No se encontró la oportunidad en este espacio local.'});res.json({ok:true});}catch(error){next(error);}});
app.delete('/api/company/tracking/:id',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(30,60_000),async(req,res,next)=>{try{if(!await deleteTrackedOpportunity(z.coerce.number().int().positive().parse(req.params.id)))return res.status(404).json({error:'No se encontró la oportunidad en este espacio local.'});res.json({ok:true});}catch(error){next(error);}});
const trackedDateSchema=z.object({label:z.string().trim().min(1).max(160),dueAt:z.string().datetime({offset:true}),notes:z.string().trim().max(1000).nullable().optional()});
app.post('/api/company/tracking/:id/dates',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(40,60_000),async(req,res,next)=>{try{const trackingId=z.coerce.number().int().positive().parse(req.params.id);const body=trackedDateSchema.parse(req.body);const id=await addTrackedDate(trackingId,{...body,dueAt:new Date(body.dueAt).toISOString().slice(0,19).replace('T',' ')});if(!id)return res.status(404).json({error:'No se encontró la oportunidad en este espacio local.'});res.status(201).json({id});}catch(error){next(error);}});
app.patch('/api/company/tracking/:id/dates/:dateId',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(60,60_000),async(req,res,next)=>{try{const trackingId=z.coerce.number().int().positive().parse(req.params.id);const dateId=z.coerce.number().int().positive().parse(req.params.dateId);const body=z.object({label:z.string().trim().min(1).max(160).optional(),dueAt:z.string().datetime({offset:true}).optional(),notes:z.string().trim().max(1000).nullable().optional(),completed:z.boolean().optional()}).refine(value=>Object.keys(value).length>0).parse(req.body);if(!await updateTrackedDate(trackingId,dateId,{...body,dueAt:body.dueAt?new Date(body.dueAt).toISOString().slice(0,19).replace('T',' '):undefined}))return res.status(404).json({error:'No se encontró la fecha en este espacio.'});res.json({ok:true});}catch(error){next(error);}});
app.delete('/api/company/tracking/:id/dates/:dateId',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(40,60_000),async(req,res,next)=>{try{const trackingId=z.coerce.number().int().positive().parse(req.params.id);const dateId=z.coerce.number().int().positive().parse(req.params.dateId);if(!await deleteTrackedDate(trackingId,dateId))return res.status(404).json({error:'No se encontró la fecha en este espacio.'});res.json({ok:true});}catch(error){next(error);}});
app.use('/api/alerts',requireAuth,requireCsrf,requireActiveCompany);
app.get('/api/alerts/count',requireDb,requestLimit(120,60_000),async(_req,res,next)=>{try{res.json(await alertCounts());}catch(error){next(error);}});
app.get('/api/alerts',requireDb,requestLimit(40,60_000),async(req,res,next)=>{try{const filter=z.enum(['all','unread','closing','followup']).default('all').parse(req.query.filter);const [items,counts]=await Promise.all([listAlerts({filter,limit:100}),alertCounts()]);res.json({items,counts});}catch(error){next(error);}});
app.post('/api/alerts/evaluate',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(12,60_000),async(_req,res,next)=>{try{res.json({...await evaluateAlerts(),counts:await alertCounts()});}catch(error){next(error);}});
app.post('/api/alerts/:id/read',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(120,60_000),async(req,res,next)=>{try{const id=z.coerce.number().int().positive().parse(req.params.id);if(!await markAlertRead(id))return res.status(404).json({error:'No se encontró la alerta activa en este espacio.'});res.json({ok:true,counts:await alertCounts()});}catch(error){next(error);}});
app.post('/api/alerts/:id/dismiss',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(120,60_000),async(req,res,next)=>{try{const id=z.coerce.number().int().positive().parse(req.params.id);if(!await dismissAlert(id))return res.status(404).json({error:'No se encontró la alerta activa en este espacio.'});res.json({ok:true,counts:await alertCounts()});}catch(error){next(error);}});
app.use('/api/buscador/enrichment',requireAuth,requireCsrf,requireActiveCompany,requireCompanyRole('admin'));
app.post('/api/buscador/enrichment',requireDb,requestLimit(5,60_000),async(req,res,next)=>{try{const body=z.object({query:z.string().trim().min(2).max(500).optional(),codes:z.array(z.string().trim().min(1).max(100)).max(10).optional()}).refine(value=>Boolean(value.query||value.codes?.length)).parse(req.body);const chosen=[...(body.codes??[]).slice(0,5)];if(body.query)chosen.push(...await findEnrichmentCandidates(body.query,Math.max(1,10-chosen.length)));const unique=[...new Set(chosen)].slice(0,10);res.status(202).json({...await enqueueEnrichment(unique),candidatesSelected:unique.length});}catch(error){next(error);}});
app.post('/api/buscador/enrichment/prioritized',requireDb,requestLimit(2,60_000),async(req,res,next)=>{try{const body=z.object({limit:z.coerce.number().int().min(1).max(10).default(5)}).parse(req.body??{});const codes=await findPriorityCandidates(body.limit);res.status(202).json({...await enqueueEnrichment(codes),candidatesSelected:codes.length,limit:body.limit});}catch(error){next(error);}});
app.get('/api/buscador/enrichment/pilot',requireDb,async(_req,res,next)=>{try{res.json({...await enrichmentPilotStatus(),coverage:await enrichmentMetrics()});}catch(error){next(error);}});
app.post('/api/buscador/enrichment/pilot/start',requireDb,requestLimit(1,60_000),async(_req,res,next)=>{try{res.status(202).json({...await startEnrichmentPilotBatch(),pilot:await enrichmentPilotStatus()});}catch(error){next(error);}});
app.post('/api/buscador/enrichment/pilot/compare',requireDb,requestLimit(1,60_000),async(_req,res,next)=>{try{const workspace=await getCompanyWorkspace();const preview=await previewEnrichmentCandidates(workspace.products,workspace.profile.terminosExcluidos);res.json({...preview,estimatedRequests:preview.candidates.length});}catch(error){next(error);}});
app.post('/api/buscador/enrichment/pilot/start-thematic',requireDb,requestLimit(1,60_000),async(req,res,next)=>{try{const body=z.object({codes:z.array(z.string().trim().min(1).max(100)).min(1).max(10)}).parse(req.body);const requested=[...new Set(body.codes)];if(requested.length!==body.codes.length)throw new Error('La selección contiene códigos repetidos.');const workspace=await getCompanyWorkspace();const preview=await previewEnrichmentCandidates(workspace.products,workspace.profile.terminosExcluidos,10);const selected=preview.candidates.filter(item=>requested.includes(item.code));if(selected.length!==requested.length)throw new Error('Una o más candidatas ya no cumplen los criterios de enriquecimiento. Actualiza la vista previa.');res.status(202).json({...await startEnrichmentPilotBatch('thematic',selected),pilot:await enrichmentPilotStatus()});}catch(error){next(error);}});
app.post('/api/buscador/enrichment/pilot/pause',requireDb,requestLimit(3,60_000),async(_req,res,next)=>{try{res.json({...await pauseEnrichmentPilot(),pilot:await enrichmentPilotStatus()});}catch(error){next(error);}});
app.post('/api/buscador/enrichment/pilot/resume',requireDb,requestLimit(3,60_000),async(_req,res,next)=>{try{res.json({...await resumeEnrichmentPilot(),pilot:await enrichmentPilotStatus()});}catch(error){next(error);}});
app.post('/api/buscador/enrichment/pilot/retry',requireDb,requestLimit(2,60_000),async(_req,res,next)=>{try{res.status(202).json({...await retryEnrichmentPilotFailures(),pilot:await enrichmentPilotStatus()});}catch(error){next(error);}});
app.get('/api/buscador/enrichment/status',requireDb,async(req,res,next)=>{try{const raw=String(req.query.codes??'').trim();const codes=raw?raw.split(',').map(code=>z.string().trim().min(1).max(100).parse(code)).slice(0,50):undefined;res.json(await enrichmentStatus(codes));}catch(error){next(error);}});
app.post('/api/buscador/analysis/:codigo',requireDb,requireAuth,requireCsrf,requireActiveCompany,requestLimit(8,60_000),async(req,res,next)=>{try{const codigo=z.string().trim().min(1).max(100).parse(req.params.codigo);res.json(await analyzeListing(codigo));}catch(error){next(error);}});
app.use('/api/sync',requireServiceOrAdmin);
app.post('/api/sync/licitaciones', requireDb, requestLimit(1,60_000,'sync'), async (req, res, next) => {
  try {
    const fecha=dateSchema.parse(req.body?.fecha);const date=`${fecha.slice(4,8)}-${fecha.slice(2,4)}-${fecha.slice(0,2)}`;
    const parsed=new Date(`${date}T00:00:00Z`);if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)return res.status(400).json({error:'La fecha indicada no es válida.'});
    const id=await startJob(date,date,'historica',true);res.status(202).json({jobId:id});
  }catch(error){next(error);}
});
app.post('/api/sync/jobs', requireDb, requestLimit(2,60_000,'sync'), async (req,res,next)=>{try{const body=z.object({dateFrom:z.string().date(),dateTo:z.string().date(),type:z.enum(['historica','diaria']).default('historica')}).parse(req.body);const jobId=await startJob(body.dateFrom,body.dateTo,body.type,true);res.status(202).json({jobId});}catch(error){next(error);}});
app.get('/api/sync/jobs/current', requireDb, async (_req,res,next)=>{try{res.json(await getJob());}catch(error){next(error);}});
app.get('/api/sync/jobs/:id', requireDb, async (req,res,next)=>{try{const id=z.coerce.number().int().positive().parse(req.params.id);const job=await getJob(id);if(!job)return res.status(404).json({error:'No se encontró el proceso.'});res.json(job);}catch(error){next(error);}});
app.post('/api/sync/jobs/:id/pause', requireDb, requestLimit(10,60_000,'sync'), async(req,res,next)=>{try{await pauseJob(z.coerce.number().int().positive().parse(req.params.id));res.json({ok:true});}catch(error){next(error);}});
app.post('/api/sync/jobs/:id/resume', requireDb, requestLimit(10,60_000,'sync'), async(req,res,next)=>{try{await resumeJob(z.coerce.number().int().positive().parse(req.params.id));res.json({ok:true});}catch(error){next(error);}});
app.post('/api/sync/jobs/:id/retry', requireDb, requestLimit(5,60_000,'sync'), async(req,res,next)=>{try{await retryJob(z.coerce.number().int().positive().parse(req.params.id));res.json({ok:true});}catch(error){next(error);}});
app.get('/api/sync/history', requireDb, async(req,res,next)=>{try{res.json(await getHistory(Number(req.query.page)||1,Number(req.query.pageSize)||20));}catch(error){next(error);}});
app.use('/api/resumen',requireAuth);
app.get('/api/resumen', requireDb, async (_req, res, next) => {
  try {
    const [[totals], [states], [lastRun], [recent]] = await Promise.all([
      pool.query<any[]>('SELECT COUNT(*) AS total FROM licitaciones'),
      pool.query<any[]>('SELECT codigo_estado AS codigoEstado, COUNT(*) AS total FROM licitaciones GROUP BY codigo_estado ORDER BY total DESC'),
      pool.query<any[]>("SELECT DATE_FORMAT(fecha_consultada,'%Y-%m-%d') AS fechaConsultada, estado, total_recibidos AS totalRecibidos, total_insertados AS totalInsertados, total_actualizados AS totalActualizados, started_at AS startedAt FROM sync_runs ORDER BY started_at DESC LIMIT 1"),
      pool.query<any[]>('SELECT codigo_externo,nombre,codigo_estado,fecha_cierre,organismo,monto_estimado,moneda FROM licitaciones ORDER BY last_synced_at DESC LIMIT 6'),
    ]);
    res.json({ total: Number(totals[0].total), estados: states, ultimaSincronizacion: lastRun[0] ?? null, ultimasLicitaciones: recent });
  } catch (error) { next(error); }
});
app.use('/api/configuracion',requireAuth,requireAdministrator);
app.get('/api/configuracion', requireDb, async (_req, res, next) => {
  try {
    const [[lastRun], [count], [latestSuccess], [activeJob],dailySync] = await Promise.all([
      pool.query<any[]>("SELECT estado,DATE_FORMAT(fecha_consultada,'%Y-%m-%d') AS fechaConsultada,total_recibidos AS totalRecibidos,total_insertados AS totalInsertados,total_actualizados AS totalActualizados,mensaje_error AS mensajeError,started_at AS startedAt,finished_at AS finishedAt FROM sync_runs ORDER BY started_at DESC LIMIT 1"),
      pool.query<any[]>('SELECT COUNT(*) AS total FROM licitaciones'),
      pool.query<any[]>("SELECT MAX(last_successful_at) AS ultimaFechaExitosa,DATE_FORMAT(MAX(fecha),'%Y-%m-%d') AS fechaMasReciente FROM sync_job_days WHERE estado='completed'"),
      pool.query<any[]>("SELECT id,estado,fecha_inicio fechaInicio,fecha_fin fechaFin,total_dias totalDias,dias_completados diasCompletados,dias_fallidos diasFallidos,active_refresh_status activeRefreshStatus,mensaje_error mensajeError,total_recibidos totalRecibidos,total_insertados totalInsertados,total_actualizados totalActualizados FROM sync_jobs WHERE estado IN ('queued','running','paused') ORDER BY id DESC LIMIT 1"),
      dailySchedulerStatus(),
    ]);
    const enrichment=await enrichmentMetrics();const enrichmentPilot=await enrichmentPilotStatus();
    res.json({ apiConfigurada: Boolean(process.env.MERCADOPUBLICO_TICKET?.trim()), ultimoResultado: lastRun[0] ?? null, totalImportado: Number(count[0].total), ultimaFechaExitosa:latestSuccess[0]?.ultimaFechaExitosa??null,fechaMasReciente:latestSuccess[0]?.fechaMasReciente??null, schedulerEnabled:dailySync.enabled,schedulerTime:'08:00',schedulerTimezone:'America/Santiago',dailySync,procesoActivo:activeJob[0]??null,enrichment,enrichmentPilot });
  } catch (error) { next(error); }
});
if (runtime.appEnv !== 'development' && ['web', 'all'].includes(runtime.processRole)) {
  app.get('*', (req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) return next();
    res.sendFile(join(frontendDirectory, 'index.html'));
  });
}
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'Parámetros inválidos.' });
  const status = error instanceof MercadoPublicoError ? error.status : 500;
  if(status>=500)console.error(`[api] internal_error type=${error instanceof Error?error.name:'unknown'}`);
  const message = status<500&&error instanceof MercadoPublicoError ? error.message : status===500?'Ocurrió un error interno.':'No se pudo completar la solicitud.';
  return res.status(status).json({ error: message });
});
async function initializeWorker() {
  await pool.query('SELECT 1');
  if (['all','sync-worker'].includes(runtime.processRole)) {
    await recoverJobs();
    startSyncWorker();
    startScheduler();
  }
  if (runtime.enrichmentWorkerEnabled && ['all','enrichment-worker'].includes(runtime.processRole)) {
    await recoverEnrichmentQueue();
    startEnrichmentWorker();
  }
  if (['all','alert-worker'].includes(runtime.processRole)) startAlertScheduler();
}

if (runtime.processRole.endsWith('-worker')) {
  void initializeWorker().catch((error) => {
    console.error(`[worker] inicio fallido; tipo=${error instanceof Error ? error.name : 'error'}`);
    process.exitCode = 1;
  });
  const stopWorker = () => { void pool.end().finally(() => process.exit(0)); };
  process.once('SIGTERM', stopWorker);
  process.once('SIGINT', stopWorker);
} else {
  const server = app.listen(runtime.port, runtime.host, () => {
    console.log(`API Oportuna escuchando en ${runtime.host}:${runtime.port} (${runtime.appEnv}, rol=${runtime.processRole})`);
    runSmtpStartupProbeOnce();
    if (runtime.processRole === 'all') {
      void initializeWorker().catch((error) => console.error(`[worker] inicio fallido; tipo=${error instanceof Error ? error.name : 'error'}`));
    }
  });
  server.once('error', (error: NodeJS.ErrnoException) => {
    const code = /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'LISTEN_FAILED';
    console.error(`[server] listen_failed code=${code}`);
    process.exitCode = 1;
  });
  const shutdown = () => {
    server.close(() => { void pool.end().finally(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
