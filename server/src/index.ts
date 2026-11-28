import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createRequire } from 'node:module';
import type multerFactory from 'multer';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { loadRuntimeConfig } from './runtimeConfig.js';
import { checkRateLimit, consumeRateLimit } from './rateLimitStore.js';
import pool from './db.js';
import { getByCode, listByDate, MercadoPublicoError } from './mercadoPublico.js';
import { startJob, getJob, pauseJob, resumeJob, retryJob, getHistory, recoverJobs, startScheduler, startSyncWorker, dailySchedulerStatus } from './syncService.js';
import { searchListings, analyzeListing, findEnrichmentCandidates, groqConfigured, clearSearchCache } from './smartSearch.js';
import { parseTenderAmount, tenderAmountStatus, tenderAmountUpsertSql } from './tenderAmount.js';
import { previewEnrichmentCandidates, enqueueEnrichment, enrichmentMetrics, enrichmentPilotStatus, enrichmentStatus, findPriorityCandidates, indexOfficialDetail, pauseEnrichmentPilot, resumeEnrichmentPilot, retryEnrichmentPilotFailures, startEnrichmentPilotBatch, recoverEnrichmentQueue, startEnrichmentWorker } from './listingEnrichment.js';
import { deleteCompanyProduct, getCompanyMatches, getCompanyWorkspace, saveCompanyProfile, saveCompanyProduct, searchCompanyProducts, suggestCommercialTerms } from './companyService.js';
import { addTrackedDate, deleteTrackedDate, deleteTrackedOpportunity, dismissTrackedOpportunity, getTrackedCounts, getTrackedStatus, listTrackedOpportunities, saveTrackedOpportunity, trackingStates, updateTrackedDate, updateTrackedOpportunity } from './trackingService.js';
import { deleteOfferDraft, getOfferDraft, saveOfferDraft } from './offerPreparationService.js';
import { offerDraftSchema } from './offerDraftValidation.js';
import { deleteAnalyticsView, exportAnalyticsCsv, getAnalytics, listAnalyticsViews, saveAnalyticsView } from './analyticsService.js';
import { normalizeAnalyticsFilters } from './analyticsFilters.js';
import { alertCounts, dismissAlert, evaluateAlerts, getAlertOverview, listAlerts, markAlertRead } from './alertService.js';
import { startAlertScheduler } from './alertScheduler.js';
import type { ApiListing } from './types.js';
import { acceptInvitationForUser, changePasswordForSession, createInvitation, createPasswordReset, createSession, createUser, registerPendingUser, issueEmailVerification, issueEmailVerificationForAddress, completeEmailVerification, consumePasswordReset, getSession, login, normalizeEmail, revokeSession, rotateCsrf, setActiveCompany, updatePersonalProfile } from './authService.js';
import { clearSessionCookies, csrfCookieName, getRequestCsrfToken, getRequestSessionToken, requireActiveCompany, requireAdministrator, requireAuth, requireCompanyRole, requireCsrf, requirePlatformAdmin, requireRequestOrigin, requireSecureTransport, requireServiceOrAdmin, requireVerifiedEmail, setSessionCookies } from './authMiddleware.js';
import { appBaseUrl, emailMode, getLocalMail, localMailPreviewEnabled, logSmtpFailure, probeSmtp, sanitizedSmtpFailureCode, sendEmail, type MailPurpose } from './emailService.js';
import { listCompanyAccessRequests, registerCompanyForCurrentUser, requestCompanyAccess, reviewCompanyAccessRequest } from './onboardingService.js';
import { normalizeChileanRut } from './chileanRut.js';
import { logMysqlFailure } from './mysqlDiagnostics.js';
import { runSmtpStartupProbeOnce } from './smtpStartupProbe.js';
import { assertCanActivateMember, changeCompanyPlan, getCompanyPlan, getCompanyPlanSummary, isPlanId, listCompanySubscriptions, listCompanyPlanRequests, listPendingCompanyPlanRequests, planCatalog, requestCompanyPlanChange, reviewCompanyPlanRequest, runLimitedListingAnalysis, SubscriptionLimitError, PendingPlanRequestError, PlanRequestConflictError, type BillingPeriod } from './subscriptionService.js';
import { bulkOpportunityAction, dismissOpportunity, getOpportunityFeed, markOpportunityRead, restoreOpportunity } from './opportunityFeedService.js';
import { getOpportunityTeam, listActiveCompanyMembers, listOpportunityActivity, saveOpportunityTeam } from './collaborationService.js';
import { dismissProactiveMatch, getProactiveSearchPreferences, runCurrentCompanyProactiveSearch, runProactiveSearchPass, saveProactiveSearchPreferences, setProactiveMatchRead } from './proactiveSearchService.js';
import { getAlertEmailPreference, saveAlertEmailPreference } from './alertEmailService.js';
import { deletePriceBookItem, listPriceBookItems, savePriceBookItems } from './priceBookService.js';
import { automationSchedulerStatus, dismissAutomationNotification, listAutomationRules, markAutomationNotificationRead, runAutomationPass, saveAutomationRule, toggleAutomationRule } from './automationService.js';
import { analyzeOfferDocumentText, extractOfferDocument, fetchOfficialOfferDocument, MAX_OFFER_DOCUMENT_BYTES, MAX_OFFER_DOCUMENTS_PER_DRAFT, OfferDocumentAnalysisError } from './offerDocumentAnalysis.js';

const app = express();
const runtimeRequire = createRequire(import.meta.url);
const multer = (() => {
  try {
    return runtimeRequire('multer');
  } catch {
    return runtimeRequire('../../vendor/multer.cjs');
  }
})() as typeof multerFactory;
const runtime = loadRuntimeConfig();
app.disable('x-powered-by');
app.set('trust proxy',runtime.trustProxyHops || false);
app.use(cors({ origin: (origin, callback) => callback(null, !origin || runtime.allowedOrigins.includes(origin)), credentials: true, optionsSuccessStatus: 204 }));
app.use(express.json({ limit: '1mb' }));
app.use(requireSecureTransport);
app.use((_req,res,next)=>{res.locals.requestId=randomUUID().replace(/-/g,'').slice(0,12).toUpperCase();next();});
app.use('/api/platform/test-center',requireAuth,requirePlatformAdmin);
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
app.get('/api/platform/users',requireDb,requireAuth,requirePlatformAdmin,async(req,res,next)=>{
  try {
    const query=String(req.query.q??'').trim().slice(0,160);
    const limit=Math.min(100,Math.max(1,Number(req.query.limit)||50));
    const offset=Math.max(0,Number(req.query.offset)||0);
    const term=`%${query}%`;
    const where=query?`WHERE u.email_normalized LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?`:'';
    const values=query?[term,term,term]:[];
    const [[rows],[counts]]=await Promise.all([
      pool.query<any[]>(`SELECT u.id,u.email_normalized email,u.first_name firstName,u.last_name lastName,u.platform_role platformRole,u.status,u.email_verified_at emailVerifiedAt,u.created_at createdAt,
        COALESCE((SELECT GROUP_CONCAT(DISTINCT m.role ORDER BY m.role SEPARATOR ',') FROM company_memberships m WHERE m.user_id=u.id AND m.status='active'),'') companyRoles
        FROM app_users u ${where} ORDER BY u.created_at DESC,u.id DESC LIMIT ? OFFSET ?`,[...values,limit,offset]),
      pool.query<any[]>(`SELECT COUNT(*) total FROM app_users ${query?`WHERE email_normalized LIKE ? OR first_name LIKE ? OR last_name LIKE ?`:''}`,values),
    ]);
    res.set('Cache-Control','no-store').json({users:rows.map(row=>({...row,companyRoles:String(row.companyRoles??'').split(',').filter(Boolean)})),total:Number(counts[0]?.total??0),limit,offset});
  } catch(error) { next(error); }
});
app.post('/api/platform/users',requireDb,requireAuth,requireCsrf,requirePlatformAdmin,requestLimit(10,60*60_000,'platform-user-create'),async(req,res,next)=>{
  try {
    const body=z.object({firstName:z.string().trim().min(1).max(100),lastName:z.string().trim().min(1).max(100),email:z.string().trim().min(3).max(320),password:z.string().min(12).max(1024),platformRole:z.enum(['user','admin']).default('user')}).strict().parse(req.body);
    const userId=await createUser(body.email,body.password,body.platformRole,body.firstName,body.lastName);
    res.set('Cache-Control','no-store').status(201).json({ok:true,user:{id:userId,email:normalizeEmail(body.email),firstName:body.firstName,lastName:body.lastName,platformRole:body.platformRole,status:'active',emailVerified:true}});
  } catch(error) {
    if((error as any)?.code==='ER_DUP_ENTRY')return res.status(409).json({error:'Ya existe una cuenta con ese correo.'});
    next(error);
  }
});
app.get('/api/platform/companies',requireDb,requireAuth,requirePlatformAdmin,async(_req,res,next)=>{
  try { res.set('Cache-Control','no-store').json({companies:await listCompanySubscriptions(),plans:Object.values(planCatalog)}); }
  catch(error) { next(error); }
});
app.get('/api/platform/plan-requests',requireDb,requireAuth,requirePlatformAdmin,async(_req,res,next)=>{
  try { res.set('Cache-Control','no-store').json({requests:await listPendingCompanyPlanRequests()}); }
  catch(error) { next(error); }
});
app.patch('/api/platform/plan-requests/:requestId',requireDb,requireAuth,requireCsrf,requirePlatformAdmin,requestLimit(60,60*60_000,'plan-request-review'),async(req,res,next)=>{
  try {
    const requestId=z.coerce.number().int().positive().parse(req.params.requestId);
    const body=z.object({decision:z.enum(['approved','rejected']),note:z.string().trim().max(500).nullable().optional()}).strict().parse(req.body);
    const result=await reviewCompanyPlanRequest(requestId,body.decision,req.auth!.userId,body.note??null);
    if(!result)return res.status(409).json({code:'PLAN_REQUEST_ALREADY_REVIEWED',error:'La solicitud ya fue resuelta o no existe.'});
    res.set('Cache-Control','no-store').json({ok:true,request:result});
  } catch(error) { next(error); }
});
app.patch('/api/platform/companies/:companyId/plan',requireDb,requireAuth,requireCsrf,requirePlatformAdmin,requestLimit(40,60*60_000,'company-plan-change'),async(req,res,next)=>{
  try {
    const companyId=z.coerce.number().int().positive().parse(req.params.companyId);
    const body=z.object({plan:z.string().refine(isPlanId,'Selecciona un plan válido.'),billingPeriod:z.enum(['monthly','annual']).optional()}).strict().parse(req.body);
    if(!await changeCompanyPlan(companyId,body.plan as keyof typeof planCatalog,req.auth!.userId,body.billingPeriod as BillingPeriod|undefined))return res.status(404).json({error:'No se encontró la empresa.'});
    res.set('Cache-Control','no-store').json({ok:true,companyId,plan:planCatalog[body.plan as keyof typeof planCatalog]});
  } catch(error) { next(error); }
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
    const officialBuyer=detail.Comprador&&typeof detail.Comprador==='object'&&!Array.isArray(detail.Comprador)?detail.Comprador:{};
    const buyerName=[officialBuyer.NombreOrganismo,detail.NombreOrganismo,detail.OrganismoComprador,detail.Organismo,row.organismo].find(value=>typeof value==='string'&&value.trim());
    const buyerUnit=[officialBuyer.NombreUnidad,detail.NombreUnidad,detail.UnidadCompra].find(value=>typeof value==='string'&&value.trim());
    const localBuyer={...officialBuyer,NombreOrganismo:buyerName??null,NombreUnidad:buyerUnit??null};
    const amountHidden=detail.VisibilidadMonto===0||detail.VisibilidadMonto==='0'||detail.VisibilidadMonto===false;
    const detailAmount=detail.MontoEstimado;
    const listing={...detail,CodigoExterno:detail.CodigoExterno??row.codigo_externo,Nombre:detail.Nombre??row.nombre,CodigoEstado:detail.CodigoEstado??row.codigo_estado,FechaCierre:detail.FechaCierre??row.fecha_cierre,Fechas:{...(row.fecha_publicacion?{FechaPublicacion:row.fecha_publicacion}:{}),...(detail.Fechas&&typeof detail.Fechas==='object'?detail.Fechas:{})},Comprador:localBuyer,MontoEstimado:amountHidden?null:(detailAmount!==undefined&&detailAmount!==null&&detailAmount!==''?detailAmount:row.monto_estimado),Moneda:detail.Moneda||row.moneda,Items:payloadItems.length?detail.Items:(items.length?{Cantidad:items.length,Listado:items}:detail.Items)};
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
// Las búsquedas y sincronizaciones guardan un resumen; la ficha debe obtener el registro completo directamente de MP.
app.get('/api/licitaciones/:codigo/oficial',requireDb,requestLimit(30,60_000,'tender-detail'),async(req,res,next)=>{
  try{
    const codigo=z.string().trim().min(1).max(100).parse(req.params.codigo);
    const listing=await getByCode(codigo);
    res.set('Cache-Control','private, max-age=60').json({source:'mercadopublico',listing});
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
  try{const body=z.object({query:z.string().trim().min(2).max(500),page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(10),states:z.array(z.number().int().min(0).max(999)).max(12).optional(),region:z.string().trim().max(80).nullable().optional(),modality:z.enum(['public','private','agile']).nullable().optional(),budgetMin:z.number().nonnegative().nullable().optional(),budgetMax:z.number().nonnegative().nullable().optional(),closeAfter:z.string().date().nullable().optional(),closeBefore:z.string().date().nullable().optional(),matchLevel:z.enum(['high','medium','exploratory']).optional()}).parse(req.body);if(body.budgetMin!=null&&body.budgetMax!=null&&body.budgetMin>body.budgetMax)return res.status(400).json({error:'El presupuesto mínimo no puede superar el máximo.'});res.json(await searchListings(body));}catch(error){next(error);}
});
const authLoginSchema=z.object({email:z.string().trim().min(3).max(320),password:z.string().min(1).max(1024)});
app.get('/api/auth/session',requireDb,async(req,res,next)=>{res.set('Cache-Control','no-store');try{const sessionToken=getRequestSessionToken(req);const session=await getSession(sessionToken,getRequestCsrfToken(req));if(!session){const sessionExpired=Boolean(sessionToken);if(sessionExpired)clearSessionCookies(res);return res.json({authenticated:false,sessionExpired});}const {csrfToken,...safe}=session;res.json({authenticated:true,...safe,csrfToken});}catch(error){next(error);}});
app.patch('/api/auth/profile',requireDb,requireAuth,requireVerifiedEmail,requireCsrf,requestLimit(20,60_000,'account-profile'),async(req,res,next)=>{try{const body=z.object({firstName:z.string().trim().min(1).max(100),lastName:z.string().trim().max(100)}).strict().parse(req.body);if(!await updatePersonalProfile(req.auth!.userId,body.firstName,body.lastName))return res.status(404).json({error:'No se encontró la cuenta activa.'});res.set('Cache-Control','no-store').json({firstName:body.firstName,lastName:body.lastName});}catch(error){next(error);}});
app.post('/api/auth/password/change',requireDb,requireAuth,requireVerifiedEmail,requireCsrf,requestLimit(5,15*60_000,'password-change'),async(req,res,next)=>{try{const body=z.object({currentPassword:z.string().min(1).max(1024),newPassword:z.string().min(12).max(1024)}).strict().parse(req.body);const outcome=await changePasswordForSession(req.auth!.userId,req.auth!.id,body.currentPassword,body.newPassword);if(outcome==='same_password')return res.status(400).json({error:'La nueva contraseña debe ser distinta de la actual.'});if(outcome==='invalid_current_password')return res.status(400).json({error:'La contraseña actual no es correcta.'});res.set('Cache-Control','no-store').json({ok:true,message:'Contraseña actualizada. Se cerraron las demás sesiones activas.'});}catch(error){next(error);}});
app.post('/api/auth/login',requireDb,requestLimit(60,15*60_000,'login-ip'),requireRequestOrigin,async(req,res,next)=>{try{const body=authLoginSchema.parse(req.body);const accountKey=`login-account:${req.ip??'unknown'}:${normalizeEmail(body.email)}`;const accountLimit=await checkRateLimit(accountKey,10,15*60_000);if(!accountLimit.allowed){res.set('Retry-After',String(accountLimit.retryAfterSeconds));return res.status(429).json({error:'Demasiados intentos. Espera antes de volver a intentar.'});}const userId=await login(body.email,body.password);if(!userId){const failed=await consumeRateLimit(accountKey,10,15*60_000);if(!failed.allowed){res.set('Retry-After',String(failed.retryAfterSeconds));return res.status(429).json({error:'Demasiados intentos. Espera antes de volver a intentar.'});}return res.status(401).json({error:'Correo o contraseña incorrectos.'});}const created=await createSession(userId);setSessionCookies(res,created.raw,created.csrf,created.expires);res.set('Cache-Control','no-store');const {csrfToken,...safe}=created.session;res.json({authenticated:true,...safe,csrfToken});}catch(error){next(error);}});
app.post('/api/auth/register',requireDb,requestLimit(6,60*60_000,'register'),requireRequestOrigin,async(req,res,next)=>{let requestedEmail='';try{const body=z.object({invitationToken:z.string().min(32).max(128).optional(),firstName:z.string().trim().min(1).max(100),lastName:z.string().trim().min(1).max(100),email:z.string().trim().min(3).max(320),password:z.string().min(12).max(1024)}).parse(req.body);requestedEmail=body.email;const pending=await registerPendingUser(body.email,body.password,body.firstName,body.lastName,body.invitationToken);const link=`${appBaseUrl()}/?verifyEmail=${encodeURIComponent(pending.token)}`;let delivery:'accepted'|'simulated'|'failed'='failed';try{delivery=await sendEmail({to:pending.email,purpose:'verification',subject:'Verifica tu correo de Oportuna',text:`Hola ${body.firstName},\n\nConfirma tu correo para activar el acceso a Oportuna: ${link}\n\nEl enlace vence en 30 minutos y solo se puede usar una vez.`,link});}catch{/* Keep the account pending and let the verification screen offer a retry. */}const created=await createSession(pending.userId);setSessionCookies(res,created.raw,created.csrf,created.expires);res.set('Cache-Control','no-store');const {csrfToken,...safe}=created.session;res.status(201).json({authenticated:true,...safe,csrfToken,emailVerificationRequired:true,emailDelivery:delivery});}catch(error){if((error as any)?.code==='ER_DUP_ENTRY'){try{const issued=await issueEmailVerificationForAddress(requestedEmail);if(issued){const link=`${appBaseUrl()}/?verifyEmail=${encodeURIComponent(issued.token)}`;await sendEmail({to:issued.email,purpose:'verification',subject:'Verifica tu correo de Oportuna',text:`Confirma tu correo para continuar: ${link}\n\nEl enlace vence en 30 minutos y solo se puede usar una vez.`,link});}}catch{/* Keep duplicate-account responses neutral even when delivery is unavailable. */}return res.status(202).json({message:'Si es posible crear la cuenta, recibirás instrucciones para verificar el correo.',emailVerificationRequired:true});}if(error instanceof Error&&error.message==='La invitación no es válida o venció.')return res.status(400).json({error:'La invitación no coincide con el correo o venció.'});next(error);}});
app.post('/api/auth/email-verification/resend',requireDb,requireAuth,requireCsrf,requestLimit(3,60*60_000,'email-verification-resend'),async(req,res,next)=>{try{const issued=await issueEmailVerification(req.auth!.userId);let delivery:'accepted'|'simulated'|'failed'|'not_required'='not_required';if(issued){console.info('[email] verification_token_issued channel=session');const link=`${appBaseUrl()}/?verifyEmail=${encodeURIComponent(issued.token)}`;try{delivery=await sendEmail({to:issued.email,purpose:'verification',subject:'Verifica tu correo de Oportuna',text:`Confirma tu correo para continuar: ${link}\n\nEl enlace vence en 30 minutos y solo se puede usar una vez.`,link});}catch(error){logSmtpFailure('verification',error);delivery='failed';}}else console.info('[email] verification_token_not_issued channel=session reason=not_pending');const message=delivery==='accepted'?'El servidor de correo aceptó el mensaje. Revisa tu bandeja y correo no deseado.':delivery==='simulated'?'Se generó un correo simulado en el buzón local.':delivery==='failed'?'No pudimos confirmar el envío. Tu cuenta sigue pendiente; inténtalo más tarde.':'Tu cuenta no necesita verificación.';res.set('Cache-Control','no-store');return res.status(202).json({delivery,message});}catch(error){next(error);}});app.post('/api/auth/email-verification/resend-request',requireDb,requestLimit(3,60*60_000,'email-verification-resend-public'),requireRequestOrigin,async(req,res,next)=>{try{const {email}=z.object({email:z.string().trim().min(3).max(320)}).parse(req.body);const issued=await issueEmailVerificationForAddress(email);if(issued){console.info('[email] verification_token_issued channel=public');const link=`${appBaseUrl()}/?verifyEmail=${encodeURIComponent(issued.token)}`;try{await sendEmail({to:issued.email,purpose:'verification',subject:'Verifica tu correo de Oportuna',text:`Confirma tu correo para continuar: ${link}\n\nEl enlace vence en 30 minutos y solo se puede usar una vez.`,link});}catch(error){logSmtpFailure('verification',error);}}else console.info('[email] verification_token_not_issued channel=public reason=not_eligible');res.set('Cache-Control','no-store');res.status(202).json({message:'Solicitud recibida. Si la cuenta necesita verificación, el servidor intentará enviar un enlace al correo indicado.'});}catch(error){next(error);}});
app.post('/api/auth/email-verification/confirm',requireDb,requestLimit(10,60*60_000,'email-verification-confirm'),requireRequestOrigin,async(req,res,next)=>{try{const body=z.object({token:z.string().min(32).max(128)}).parse(req.body);if(!await completeEmailVerification(body.token))return res.status(400).json({error:'El enlace de verificación no es válido, venció o ya fue utilizado.'});res.set('Cache-Control','no-store');res.json({ok:true,message:'Correo verificado. Ya puedes continuar.'});}catch(error){next(error);}});
app.get('/api/auth/local-outbox',requestLimit(30,60_000,'local-outbox'),(req,res)=>{const address=(req.ip??'').replace(/^::ffff:/,'');if(!localMailPreviewEnabled()||!['127.0.0.1','::1'].includes(address))return res.status(404).json({error:'No encontrado.'});const email=String(req.query.email??'').trim();if(!email||email.length>320)return res.status(400).json({error:'Correo inválido.'});const purpose=typeof req.query.purpose==='string'?req.query.purpose as MailPurpose:undefined;res.set('Cache-Control','no-store').json({simulated:true,messages:getLocalMail(email,purpose)});});
app.post('/api/auth/password-reset/request',requireDb,requestLimit(6,60*60_000,'password-reset'),requireRequestOrigin,async(req,res,next)=>{try{const {email}=z.object({email:z.string().trim().min(3).max(320)}).parse(req.body);const reset=await createPasswordReset(email);if(reset){const link=`${appBaseUrl()}/?resetPassword=${encodeURIComponent(reset.token)}`;try{await sendEmail({to:normalizeEmail(email),purpose:'password-reset',subject:'Recupera tu acceso a Oportuna',text:`Usa este enlace para elegir una nueva contraseña: ${link}\n\nEl enlace vence en 30 minutos y solo se puede usar una vez.`,link});}catch(error){logSmtpFailure('password-reset',error);}}res.set('Cache-Control','no-store');res.status(202).json({accepted:true,message:'Solicitud recibida. Esto no confirma el envío del correo. Si existe una cuenta con ese correo, recibirás instrucciones cuando el servicio de correo esté disponible.'});}catch(error){next(error);}});
app.post('/api/auth/password-reset/complete',requireDb,requestLimit(10,60*60_000,'password-reset-complete'),requireRequestOrigin,async(req,res,next)=>{try{const body=z.object({token:z.string().min(32).max(128),password:z.string().min(12).max(1024)}).parse(req.body);if(!await consumePasswordReset(body.token,body.password))return res.status(400).json({error:'El enlace de recuperación no es válido o venció.'});res.json({ok:true,message:'Contraseña actualizada. Inicia sesión nuevamente.'});}catch(error){next(error);}});
app.post('/api/auth/logout',requireDb,requireAuth,requireCsrf,async(req,res,next)=>{try{await revokeSession(getRequestSessionToken(req));clearSessionCookies(res);res.json({ok:true});}catch(error){next(error);}});
const onboardingOptionalText=(max:number)=>z.string().trim().max(max).nullable().optional().transform(value=>value?.trim()||null);
const companyOnboardingSchema=z.object({rut:z.string().trim().min(3).max(30).refine(value=>Boolean(normalizeChileanRut(value)),'El RUT no es válido.'),razonSocial:z.string().trim().min(2).max(255),nombreComercial:z.string().trim().min(2).max(255),rubroPrincipal:z.string().trim().min(2).max(160),region:z.string().trim().min(2).max(120),emailContacto:z.string().trim().email().max(320),telefono:onboardingOptionalText(40),sitioWeb:z.string().trim().max(500).nullable().optional().refine(value=>!value||/^https?:\/\//i.test(value),'URL inválida.'),direccion:onboardingOptionalText(255),comuna:onboardingOptionalText(120),descripcionComercial:onboardingOptionalText(3000),regionesOperacion:z.array(z.string().trim().min(2).max(120)).max(16).default([]),productosPrincipales:z.array(z.string().trim().min(2).max(255)).max(20).default([])});
function onboardingFieldErrors(error:z.ZodError){
 const labels:Record<string,string>={rut:'RUT de empresa',razonSocial:'Razón social',nombreComercial:'Nombre comercial',rubroPrincipal:'Rubro principal',region:'Región principal',emailContacto:'Email de contacto',telefono:'Teléfono',sitioWeb:'Sitio web',direccion:'Dirección',comuna:'Comuna',descripcionComercial:'Descripción comercial',regionesOperacion:'Regiones de operación',productosPrincipales:'Productos o servicios principales'};
 const fieldErrors:Record<string,string[]>={};
 for(const issue of error.issues){const key=String(issue.path[0]??'form');const detail=issue as typeof issue&{minimum?:number;maximum?:number;origin?:string};let message=issue.message;if(issue.code==='too_small')message=detail.origin==='array'?'No puede estar vacía.':`Escribe al menos ${detail.minimum??2} caracteres.`;else if(issue.code==='too_big')message=detail.origin==='array'?`Reduce la lista a ${detail.maximum??20} elementos o menos.`:`No puede superar ${detail.maximum??'el límite'} caracteres.`;else if(issue.code==='invalid_type')message='Revisa el formato de este campo.';if(key==='emailContacto')message='Ingresa un correo de contacto válido.';else if(key==='sitioWeb')message='Usa una dirección que comience con http:// o https://, o deja el campo vacío.';else if(key==='rut')message='Ingresa un RUT de empresa válido.';const label=labels[key]??'Formulario';(fieldErrors[label]??=[]).push(message);}
 return Object.fromEntries(Object.entries(fieldErrors).map(([key,messages])=>[key,[...new Set(messages)].join(' ')]));
}
app.post('/api/onboarding/company',requireDb,requireAuth,requireVerifiedEmail,requireCsrf,requestLimit(6,60*60_000,'company-registration'),async(req,res,next)=>{try{if(typeof req.body?.rut!=='string'||!normalizeChileanRut(req.body.rut))return res.status(400).json({error:'Revisa los campos indicados.',fieldErrors:{'RUT de empresa':'Ingresa un RUT de empresa válido.'}});const parsed=companyOnboardingSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Revisa los campos indicados.',fieldErrors:onboardingFieldErrors(parsed.error)});const company=await registerCompanyForCurrentUser(parsed.data);if(!await setActiveCompany(req.auth!.id,req.auth!.userId,company.companyId))return res.status(500).json({error:'No se pudo activar la nueva empresa.'});const csrf=await rotateCsrf(req.auth!.id,req.auth!.userId);res.setHeader('Set-Cookie',`${csrfCookieName}=${encodeURIComponent(csrf)}; Path=/; SameSite=Lax; Max-Age=1209600${runtime.secureCookies?'; Secure':''}`);const session=await getSession(getRequestSessionToken(req),csrf);if(!session)return res.status(401).json({error:'La sesión expiró.'});res.status(201).json({authenticated:true,...session,company:{id:company.companyId,representationStatus:company.representationStatus}});}catch(error){if((error as any)?.code==='ER_DUP_ENTRY'&&String((error as any)?.message).includes('uq_companies_rut_normalized'))return res.status(409).json({code:'COMPANY_ALREADY_REGISTERED',error:'Esta empresa ya está registrada. Puedes solicitar acceso a sus administradores.'});next(error);}});
app.post('/api/onboarding/access-requests',requireDb,requireAuth,requireVerifiedEmail,requireCsrf,requestLimit(6,60*60_000,'company-access-request'),async(req,res,next)=>{try{const schema=z.object({rut:z.string().trim().min(3).max(30).refine(value=>Boolean(normalizeChileanRut(value)),'El RUT no es válido.'),role:z.enum(['collaborator','read_only']).default('read_only'),message:nullableText(1000)});const parsed=schema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Revisa los campos indicados.',fieldErrors:onboardingFieldErrors(parsed.error)});const body=parsed.data;await requestCompanyAccess(body.rut,body.role,body.message??null);res.status(202).json({submitted:true,message:'Si encontramos una empresa con ese RUT, un administrador revisará tu solicitud.'});}catch(error){next(error);}});

app.get('/api/onboarding/progress',requireDb,requireAuth,requireActiveCompany,async(_req,res,next)=>{try{const workspace=await getCompanyWorkspace();const profile=workspace.profile;const profileComplete=Boolean(profile.razonSocial&&profile.actividad&&profile.regiones.length&&profile.emailContacto);const activeProducts=workspace.products.filter(product=>product.activo).length;res.json({steps:[{id:'account',label:'Crear cuenta',complete:true},{id:'company',label:'Registrar empresa',complete:true},{id:'profile',label:'Completar perfil comercial',complete:profileComplete},{id:'catalog',label:'Configurar catálogo',complete:activeProducts>0},{id:'opportunities',label:'Revisar primeras oportunidades',complete:false}],completed:2+Number(profileComplete)+Number(activeProducts>0),total:5,activeProducts,profileComplete,representationStatus:workspace.representationStatus});}catch(error){next(error);}});
app.post('/api/auth/invitations/accept',requireDb,requireAuth,requireVerifiedEmail,requireCsrf,requestLimit(6,60*60_000,'invitation-accept'),async(req,res,next)=>{try{const body=z.object({invitationToken:z.string().min(32).max(128)}).parse(req.body);const companyId=await acceptInvitationForUser(body.invitationToken,req.auth!.userId,req.auth!.email);if(!await setActiveCompany(req.auth!.id,req.auth!.userId,companyId))return res.status(403).json({error:'No fue posible activar la empresa invitada.'});const session=await getSession(getRequestSessionToken(req),getRequestCsrfToken(req));if(!session)return res.status(401).json({error:'La sesión expiró.'});res.json({authenticated:true,...session});}catch(error){next(error);}});
app.post('/api/auth/company',requireDb,requireAuth,requireCsrf,async(req,res,next)=>{try{const body=z.object({companyId:z.coerce.number().int().positive()}).parse(req.body);if(!await setActiveCompany(req.auth!.id,req.auth!.userId,body.companyId))return res.status(403).json({error:'No tienes una membresía activa en esa empresa.'});const token=getRequestSessionToken(req);const session=await getSession(token,getRequestCsrfToken(req));if(!session)return res.status(401).json({error:'La sesión expiró.'});res.json({authenticated:true,...session});}catch(error){next(error);}});
app.use('/api/company',requireAuth,requireCsrf,requireVerifiedEmail,requireActiveCompany);
app.get('/api/company/plan',requireDb,async(req,res,next)=>{try{res.set('Cache-Control','no-store').json(await getCompanyPlanSummary(req.auth!.activeCompanyId!));}catch(error){next(error);}});
app.get('/api/company/plan-requests',requireDb,requireCompanyRole('admin'),async(req,res,next)=>{try{res.set('Cache-Control','private, no-store').json({requests:await listCompanyPlanRequests(req.auth!.activeCompanyId!)});}catch(error){next(error);}});
app.post('/api/company/plan-requests',requireDb,requireCompanyRole('admin'),requestLimit(10,60*60_000,'company-plan-request'),async(req,res,next)=>{
  try {
    const body=z.object({plan:z.string().refine(isPlanId,'Selecciona un plan válido.'),billingPeriod:z.enum(['monthly','annual'])}).strict().parse(req.body);
    const id=await requestCompanyPlanChange(req.auth!.activeCompanyId!,req.auth!.userId,body.plan as keyof typeof planCatalog,body.billingPeriod);
    res.status(201).set('Cache-Control','private, no-store').json({id,status:'pending'});
  } catch(error) { next(error); }
});
app.post('/api/company/bridge/resolve',requireDb,requestLimit(12,60_000,'marketplace-bridge-resolve'),async(req,res,next)=>{
  try {
    const body=z.object({code:z.string().trim().min(1).max(100)}).strict().parse(req.body);
    const detail=await getByCode(body.code);
    const values=normalized(detail);
    await pool.execute(`INSERT INTO licitaciones (codigo_externo,nombre,codigo_estado,fecha_cierre,fecha_publicacion,organismo,monto_estimado,moneda,payload_json,last_synced_at)
      VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE nombre=COALESCE(VALUES(nombre),nombre),codigo_estado=COALESCE(VALUES(codigo_estado),codigo_estado),
      fecha_cierre=COALESCE(VALUES(fecha_cierre),fecha_cierre),fecha_publicacion=COALESCE(VALUES(fecha_publicacion),fecha_publicacion),organismo=COALESCE(VALUES(organismo),organismo),
      ${tenderAmountUpsertSql},moneda=COALESCE(VALUES(moneda),moneda),payload_json=JSON_MERGE_PATCH(payload_json,VALUES(payload_json)),last_synced_at=UTC_TIMESTAMP()`,
    [values.codigo,values.nombre,values.estado,values.cierre,values.publicacion,values.organismo,values.monto,values.moneda,JSON.stringify(detail)]);
    clearSearchCache();
    try { await indexOfficialDetail(values.codigo,detail as unknown as Record<string,any>); }
    catch(error) { console.warn(`[enrichment] bridge detail not indexed; type=${error instanceof Error?error.name:'error'}`); }
    res.set('Cache-Control','private, no-store').json({listing:detail});
  } catch(error) { next(error); }
});
app.get('/api/company/opportunities',requireDb,requestLimit(60,60_000),async(req,res,next)=>{
  try { const filter=z.enum(['recommended','unread','discarded']).default('recommended').parse(req.query.filter);res.set('Cache-Control','private, no-store').json(await getOpportunityFeed(filter)); }
  catch(error) { next(error); }
});
app.get('/api/company/team-members',requireDb,requestLimit(60,60_000),async(_req,res,next)=>{try{res.set('Cache-Control','private, no-store').json({members:await listActiveCompanyMembers()});}catch(error){next(error);}});
const automationRuleSchema=z.object({name:z.string().trim().min(2).max(160),triggerType:z.enum(['new_match','closing_soon']),conditions:z.object({region:z.string().trim().max(100).optional(),category:z.string().trim().max(160).optional(),keywords:z.array(z.string().trim().min(2).max(100)).max(20).optional(),minAffinity:z.number().int().min(0).max(100).optional(),daysBeforeClose:z.number().int().min(1).max(60).optional()}).strict(),actions:z.object({createTask:z.boolean(),taskLabel:z.string().trim().max(160),taskDueDays:z.number().int().min(1).max(60),assignUserId:z.number().int().positive().nullable(),notify:z.boolean()}).strict()}).strict().refine(value=>value.actions.createTask||value.actions.assignUserId!==null||value.actions.notify,'Configura al menos una acción.');
app.get('/api/company/automation-rules',requireDb,requestLimit(60,60_000),async(_req,res,next)=>{try{res.set('Cache-Control','private, no-store').json({items:await listAutomationRules(),scheduler:automationSchedulerStatus()});}catch(error){next(error);}});
app.post('/api/company/automation-rules',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(20,60_000,'automation-rules'),async(req,res,next)=>{try{const body=automationRuleSchema.parse(req.body);const id=await saveAutomationRule(body);res.status(201).json({id,items:await listAutomationRules()});}catch(error){next(error);}});
app.put('/api/company/automation-rules/:id',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(30,60_000,'automation-rules'),async(req,res,next)=>{try{const id=z.coerce.number().int().positive().parse(req.params.id);const body=automationRuleSchema.parse(req.body);if(!await saveAutomationRule({...body,id}))return res.status(404).json({error:'No se encontró esa regla en la empresa activa.'});res.json({items:await listAutomationRules()});}catch(error){next(error);}});
app.patch('/api/company/automation-rules/:id',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(40,60_000,'automation-rules'),async(req,res,next)=>{try{const id=z.coerce.number().int().positive().parse(req.params.id);const body=z.object({enabled:z.boolean()}).strict().parse(req.body);if(!await toggleAutomationRule(id,body.enabled))return res.status(404).json({error:'No se encontró esa regla en la empresa activa.'});res.json({items:await listAutomationRules()});}catch(error){next(error);}});
app.post('/api/company/opportunities/bulk',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(12,60_000,'opportunity-bulk'),async(req,res,next)=>{
  try { const body=z.object({codes:z.array(z.string().trim().min(1).max(100)).min(1).max(100),action:z.enum(['read','discard','restore','assign']),assignedUserId:z.number().int().positive().nullable().optional()}).strict().parse(req.body);
    const codes=[...new Set(body.codes)];res.json(await bulkOpportunityAction({codes,action:body.action,assignedUserId:body.assignedUserId}));
  } catch(error) { next(error); }
});
app.get('/api/company/opportunities/:code/team',requireDb,requestLimit(60,60_000),async(req,res,next)=>{try{const code=z.string().trim().min(1).max(100).parse(req.params.code);res.set('Cache-Control','private, no-store').json(await getOpportunityTeam(code));}catch(error){next(error);}});
app.put('/api/company/opportunities/:code/team',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(30,60_000,'opportunity-team'),async(req,res,next)=>{try{const code=z.string().trim().min(1).max(100).parse(req.params.code);const body=z.object({assignedUserId:z.number().int().positive().nullable(),participantIds:z.array(z.number().int().positive()).max(50)}).strict().parse(req.body);const result=await saveOpportunityTeam(code,body);if(!result)return res.status(404).json({error:'La licitación no existe en el índice local.'});res.json(result);}catch(error){next(error);}});
app.get('/api/company/opportunities/:code/activity',requireDb,requestLimit(60,60_000),async(req,res,next)=>{try{const code=z.string().trim().min(1).max(100).parse(req.params.code);res.set('Cache-Control','private, no-store').json({items:await listOpportunityActivity(code)});}catch(error){next(error);}});
app.post('/api/company/opportunities/:code/read',requireDb,requestLimit(120,60_000),async(req,res,next)=>{
  try { const code=z.string().trim().min(1).max(100).parse(req.params.code);if(!await markOpportunityRead(code))return res.status(404).json({error:'La oportunidad no está disponible en el índice.'});res.status(204).end(); }
  catch(error) { next(error); }
});
app.post('/api/company/opportunities/:code/discard',requireDb,requestLimit(60,60_000),async(req,res,next)=>{
  try { const code=z.string().trim().min(1).max(100).parse(req.params.code);if(!await dismissOpportunity(code))return res.status(404).json({error:'La oportunidad no está disponible en el índice.'});res.json({ok:true}); }
  catch(error) { next(error); }
});
app.delete('/api/company/opportunities/:code/discard',requireDb,requestLimit(60,60_000),async(req,res,next)=>{
  try { const code=z.string().trim().min(1).max(100).parse(req.params.code);if(!await restoreOpportunity(code))return res.status(404).json({error:'No se encontró un descarte para esta oportunidad.'});res.json({ok:true}); }
  catch(error) { next(error); }
});
app.get('/api/company/analytics/top-buyers',requireDb,requestLimit(30,60_000),async(req,res,next)=>{
  try {
    const plan=await getCompanyPlan(req.auth!.activeCompanyId!);
    if(!plan.marketAnalytics)return res.status(403).json({code:'PLAN_UPGRADE_REQUIRED',error:'Inteligencia de mercado está disponible en Vuela y Brilla.',requiredPlan:'vuela'});
    const [buyers]=await pool.query<any[]>(`SELECT organismo buyer,COUNT(*) total FROM licitaciones
      WHERE fecha_publicacion>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY) AND organismo IS NOT NULL AND TRIM(organismo)<>''
      GROUP BY organismo ORDER BY total DESC,organismo ASC LIMIT 5`);
    res.set('Cache-Control','private, no-store').json({periodDays:30,buyers:buyers.map(row=>({buyer:String(row.buyer),total:Number(row.total)}))});
  } catch(error) { next(error); }
});

const priceBookItemSchema=z.object({id:z.number().int().positive().optional(),name:z.string().trim().min(1).max(255),category:z.string().max(160).default(''),unit:z.string().max(40).default('unidad'),basePrice:z.number().min(0).max(1_000_000_000_000),baseCost:z.number().min(0).max(1_000_000_000_000),chargeUnit:z.enum(['unidad','m2','hora','kg','servicio','km']),widthM:z.number().min(0).max(100_000).nullable().default(null),heightM:z.number().min(0).max(100_000).nullable().default(null),specifications:z.string().max(3000).default(''),surcharges:z.array(z.object({name:z.string().trim().min(1).max(100),amount:z.number().min(0).max(1_000_000_000),kind:z.enum(['fixed','percent'])}).strict()).max(30).default([]),active:z.boolean().default(true)}).strict();
app.get('/api/company/price-book',requireDb,requestLimit(60,60_000),async(_req,res,next)=>{try{res.set('Cache-Control','no-store').json({items:await listPriceBookItems()});}catch(error){next(error);}});
app.put('/api/company/price-book',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(20,60_000,'price-book'),async(req,res,next)=>{try{const body=z.object({items:z.array(priceBookItemSchema.omit({id:true})).min(1).max(1000)}).strict().parse(req.body);res.set('Cache-Control','no-store').json({items:await savePriceBookItems(body.items)});}catch(error){next(error);}});
app.delete('/api/company/price-book/:id',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(30,60_000,'price-book-delete'),async(req,res,next)=>{try{const deleted=await deletePriceBookItem(z.coerce.number().int().positive().parse(req.params.id));if(!deleted)return res.status(404).json({error:'No se encontró ese precio base en esta empresa.'});res.json({ok:true});}catch(error){next(error);}});
app.get('/api/company/proactive-search',requireDb,async(_req,res,next)=>{try{res.set('Cache-Control','no-store').json(await getProactiveSearchPreferences());}catch(error){next(error);}});
app.get('/api/company/alert-email',requireDb,async(req,res,next)=>{try{res.set('Cache-Control','no-store').json(await getAlertEmailPreference(req.auth!.activeCompanyId!,req.auth!.userId));}catch(error){next(error);}});
app.put('/api/company/alert-email',requireDb,requestLimit(20,60_000,'alert-email-preference'),async(req,res,next)=>{try{const {enabled}=z.object({enabled:z.boolean()}).strict().parse(req.body);res.set('Cache-Control','no-store').json(await saveAlertEmailPreference(req.auth!.activeCompanyId!,req.auth!.userId,enabled));}catch(error){if(error instanceof Error&&error.message==='Verifica tu correo antes de activar los avisos por email.')return res.status(409).json({error:error.message});next(error);}});
app.put('/api/company/proactive-search',requireDb,requireCompanyRole('admin'),requestLimit(20,60_000,'proactive-search-preferences'),async(req,res,next)=>{try{const body=z.object({enabled:z.boolean(),frequency:z.enum(['hourly','daily','weekly'])}).strict().parse(req.body);res.set('Cache-Control','no-store').json(await saveProactiveSearchPreferences(body));}catch(error){next(error);}});
app.post('/api/company/proactive-search/run',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(3,60_000,'proactive-search-manual'),async(_req,res,next)=>{try{res.set('Cache-Control','no-store').json(await runCurrentCompanyProactiveSearch());}catch(error){next(error);}});
app.put('/api/company/profile',requireCompanyRole('admin'));
app.post('/api/company/catalog',requireCompanyRole('admin'));
app.patch('/api/company/catalog/:id',requireCompanyRole('admin'));
app.delete('/api/company/catalog/:id',requireCompanyRole('admin'));
app.post('/api/company/catalog/suggestions',requireCompanyRole('admin'));
app.use('/api/company/members',requireCompanyRole('admin'));
app.get('/api/company/members',requireDb,async(req,res,next)=>{try{const [rows]=await pool.query<any[]>(`SELECT u.id,u.first_name firstName,u.last_name lastName,u.email_normalized email,m.role,m.status,m.created_at createdAt FROM company_memberships m JOIN app_users u ON u.id=m.user_id WHERE m.company_id=? ORDER BY m.created_at,u.email_normalized`,[req.auth!.activeCompanyId]);const [invitations]=await pool.query<any[]>(`SELECT id,invited_email email,role,expires_at expiresAt,created_at createdAt FROM company_invitations WHERE company_id=? AND accepted_at IS NULL AND expires_at>UTC_TIMESTAMP() ORDER BY created_at DESC`,[req.auth!.activeCompanyId]);res.json({members:rows,invitations});}catch(error){next(error);}});
app.post('/api/company/members/invitations',requireDb,requestLimit(20,60_000),async(req,res,next)=>{try{const body=z.object({email:z.string().trim().min(3).max(320),role:z.enum(['admin','collaborator','read_only']).default('collaborator')}).parse(req.body);const invite=await createInvitation(req.auth!.activeCompanyId!,body.email,body.role,req.auth!.userId);const link=`${appBaseUrl()}/?invitation=${encodeURIComponent(invite.token)}`;const delivery=await sendEmail({to:normalizeEmail(body.email),purpose:'invitation',subject:'Invitación para colaborar en Oportuna',text:`Te invitaron a colaborar en una empresa dentro de Oportuna. Abre este enlace para aceptar: ${link}\n\nLa invitación vence en siete días y solo puede usarla ${normalizeEmail(body.email)}.`,link});res.status(201).json({...(delivery==='simulated'?{invitationToken:invite.token}:{}),expiresAt:invite.expiresAt,delivery});}catch(error){next(error);}});
app.patch('/api/company/members/:userId',requireDb,requestLimit(40,60_000),async(req,res,next)=>{
  const connection=await pool.getConnection();
  try{
    const userId=z.coerce.number().int().positive().parse(req.params.userId);
    const body=z.object({role:z.enum(['admin','collaborator','read_only']).optional(),status:z.enum(['active','suspended']).optional()}).refine(value=>value.role!==undefined||value.status!==undefined).parse(req.body);
    if(userId===req.auth!.userId&&body.status==='suspended')return res.status(400).json({error:'No puedes suspender tu propia membresía activa.'});
    const companyId=req.auth!.activeCompanyId!;
    await connection.beginTransaction();
    await connection.query('SELECT company_id FROM company_subscriptions WHERE company_id=? FOR UPDATE',[companyId]);
    const [target]=await connection.query<any[]>(`SELECT role,status FROM company_memberships WHERE company_id=? AND user_id=? LIMIT 1 FOR UPDATE`,[companyId,userId]);
    if(!target[0]){await connection.rollback();return res.status(404).json({error:'No se encontró la membresía en esta empresa.'});}
    if(body.status==='active'&&target[0].status!=='active')await assertCanActivateMember(connection,companyId);
    if(target[0].role==='admin'&&target[0].status==='active'&&((body.role!==undefined&&body.role!=='admin')||body.status==='suspended')){
      const [admins]=await connection.query<any[]>(`SELECT COUNT(*) total FROM company_memberships WHERE company_id=? AND status='active' AND role='admin'`,[companyId]);
      if(Number(admins[0].total)<=1){await connection.rollback();return res.status(409).json({error:'La empresa debe conservar al menos un administrador activo.'});}
    }
    const fields:string[]=[];const values:any[]=[];if(body.role){fields.push('role=?');values.push(body.role);}if(body.status){fields.push('status=?');values.push(body.status);}
    await connection.execute(`UPDATE company_memberships SET ${fields.join(',')} WHERE company_id=? AND user_id=?`,[...values,companyId,userId]);
    await connection.commit();res.json({ok:true});
  }catch(error){await connection.rollback();next(error);}finally{connection.release();}
});
app.get('/api/company/access-requests',requireDb,requireCompanyRole('admin'),requestLimit(40,60_000),async(_req,res,next)=>{try{res.json({items:await listCompanyAccessRequests()});}catch(error){next(error);}});
app.patch('/api/company/access-requests/:id',requireDb,requireCompanyRole('admin'),requestLimit(40,60_000),async(req,res,next)=>{try{const id=z.coerce.number().int().positive().parse(req.params.id);const body=z.object({decision:z.enum(['approve','reject']),role:z.enum(['collaborator','read_only']).default('read_only')}).parse(req.body);const ok=await reviewCompanyAccessRequest(id,body.decision,body.role,req.auth!.userId);if(!ok)return res.status(404).json({error:'La solicitud ya fue resuelta o no pertenece a esta empresa.'});res.json({ok:true});}catch(error){next(error);}});
app.post('/api/platform/legacy-company/claim',requireDb,requireAuth,requireCsrf,requirePlatformAdmin,async(req,res,next)=>{const conn=await pool.getConnection();let committed=false;try{const body=z.object({companyId:z.coerce.number().int().positive()}).parse(req.body);await conn.beginTransaction();const [contexts]=await conn.query<any[]>('SELECT company_id FROM company_local_context WHERE singleton_id=1 FOR UPDATE');if(Number(contexts[0]?.company_id)!==body.companyId){await conn.rollback();return res.status(409).json({error:'La empresa solicitada no coincide con el contexto local pendiente.'});}const [claims]=await conn.query<any[]>('SELECT singleton_id FROM legacy_company_claims WHERE singleton_id=1 FOR UPDATE');if(claims.length){await conn.rollback();return res.status(409).json({error:'La vinculación inicial ya fue consumida.'});}const [company]=await conn.query<any[]>('SELECT id FROM companies WHERE id=? LIMIT 1',[body.companyId]);if(!company.length){await conn.rollback();return res.status(404).json({error:'No se encontró la empresa local.'});}await conn.execute("INSERT INTO company_memberships (user_id,company_id,role,status) VALUES (?,?,'admin','active')",[req.auth!.userId,body.companyId]);await conn.execute('INSERT INTO legacy_company_claims (singleton_id,company_id,claimed_by) VALUES (1,?,?)',[body.companyId,req.auth!.userId]);await conn.commit();committed=true;if(!await setActiveCompany(req.auth!.id,req.auth!.userId,body.companyId))return res.status(500).json({error:'No se pudo activar la empresa vinculada.'});const csrf=await rotateCsrf(req.auth!.id,req.auth!.userId);res.setHeader('Set-Cookie',`${csrfCookieName}=${encodeURIComponent(csrf)}; Path=/; SameSite=Lax; Max-Age=1209600${runtime.secureCookies?'; Secure':''}`);res.json({ok:true,companyId:body.companyId,csrfToken:csrf});}catch(error){if(!committed)await conn.rollback();next(error);}finally{conn.release();}});
app.get('/api/platform/legacy-company/pending',requireDb,requireAuth,requirePlatformAdmin,async(_req,res,next)=>{try{const [[context],[claim],[company]] = await Promise.all([pool.query<any[]>('SELECT company_id FROM company_local_context WHERE singleton_id=1'),pool.query<any[]>('SELECT singleton_id FROM legacy_company_claims WHERE singleton_id=1'),pool.query<any[]>('SELECT c.id,c.nombre_comercial FROM companies c JOIN company_local_context x ON x.company_id=c.id WHERE x.singleton_id=1')]);res.json({available:Boolean(context[0]?.company_id&&!claim.length),company:company[0]?{id:Number(company[0].id),name:company[0].nombre_comercial||'Empresa local'}:null});}catch(error){next(error);}});
const textListSchema=z.array(z.string().trim().min(2).max(100)).max(70).default([]);
const keywordListSchema=z.array(z.string().trim().min(2).max(100)).default([]);
const nullableText=(max:number)=>z.string().trim().max(max).nullable().optional().transform(value=>value?.trim()||null);
const companyProfileSchema=z.object({nombreComercial:z.string().trim().min(2,'Ingresa un nombre comercial de al menos 2 caracteres.').max(255),razonSocial:nullableText(255),rut:nullableText(20).refine(value=>value===null||Boolean(normalizeChileanRut(value)),'El RUT de empresa no es válido.'),emailContacto:z.preprocess(value=>typeof value==='string'&&!value.trim()?null:value,z.string().trim().email('Ingresa un correo con formato válido.').max(320).nullable().optional()),telefono:nullableText(40),direccion:nullableText(255),comuna:nullableText(120),regionPrincipal:nullableText(120),descripcionComercial:nullableText(3000),actividad:nullableText(3000),rubros:textListSchema,regiones:textListSchema,sitioWeb:z.string().trim().max(500).nullable().optional().refine(value=>!value||/^https?:\/\//i.test(value),'Ingresa una URL válida que comience con http:// o https://.').transform(value=>value?.trim()||null),palabrasClave:keywordListSchema,terminosExcluidos:textListSchema,estados:z.array(z.number().int().min(0).max(999)).max(12).default([5])});
function companyProfileFieldErrors(error:z.ZodError){
 const result:Record<string,string[]>={};
 for(const issue of error.issues){
  const field=String(issue.path[0]??'form');
  const detail=issue as typeof issue&{minimum?:number;maximum?:number;origin?:string};
  const line=typeof issue.path[1]==='number'?`Línea ${Number(issue.path[1])+1}: `:'';
  let message=issue.message;
  if(field==='emailContacto')message=issue.code==='too_big'?'El correo no puede superar 320 caracteres.':'Ingresa un correo con formato válido o deja el campo vacío.';
  else if(field==='nombreComercial')message=issue.code==='too_small'?'Es obligatorio e incluye al menos 2 caracteres.':issue.code==='too_big'?'No puede superar 255 caracteres.':'Ingresa un nombre comercial válido.';
  else if(field==='sitioWeb')message='Ingresa una URL válida que comience con http:// o https://, o deja el campo vacío.';
  else if(field==='rut')message='Ingresa un RUT válido; este identificador no se puede borrar de una empresa registrada.';
  else if(issue.code==='too_small')message=detail.origin==='array'?'Agrega al menos un elemento.':`Escribe al menos ${detail.minimum??2} caracteres.`;
  else if(issue.code==='too_big')message=detail.origin==='array'?`No puede superar ${detail.maximum??70} elementos.`:`No puede superar ${detail.maximum??'el límite'} caracteres.`;
  else if(issue.code==='invalid_type')message='Revisa el formato de este campo.';
  const entry=`${line}${message}`;
  (result[field]??=[]).push(entry);
 }
 return Object.fromEntries(Object.entries(result).map(([field,messages])=>[field,messages.join(' ')]));
}
const companyProductSchema=z.object({nombre:z.string().trim().min(2).max(255),categoria:nullableText(160),descripcion:nullableText(3000),palabrasClave:keywordListSchema,sinonimos:keywordListSchema,terminosRelacionados:keywordListSchema,aplicaciones:keywordListSchema,exclusiones:textListSchema,tiposComerciales:z.array(z.enum(['product_supply','service','installation','maintenance_repair','rental','construction'])).max(6).default([]),activo:z.boolean().default(true)});
app.get('/api/company/profile',requireDb,requestLimit(60,60_000),async(_req,res,next)=>{try{res.json(await getCompanyWorkspace());}catch(error){next(error);}});
app.get('/api/company/offer-drafts/:code',requireDb,requestLimit(60,60_000),async(req,res,next)=>{try{const code=z.string().trim().min(1).max(100).parse(req.params.code);res.set('Cache-Control','no-store').json(await getOfferDraft(code));}catch(error){next(error);}});
app.put('/api/company/offer-drafts/:code',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(30,60_000),async(req,res,next)=>{try{const code=z.string().trim().min(1).max(100).parse(req.params.code);const draft=offerDraftSchema.parse(req.body);const result=await saveOfferDraft(code,draft);if(!result)return res.status(404).json({error:'La licitación no existe en el índice local.'});res.set('Cache-Control','no-store').json(result);}catch(error){next(error);}});
app.delete('/api/company/offer-drafts/:code',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(20,60_000),async(req,res,next)=>{try{const code=z.string().trim().min(1).max(100).parse(req.params.code);const deleted=await deleteOfferDraft(code);res.json({ok:true,deleted});}catch(error){next(error);}});
const offerDocumentUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_OFFER_DOCUMENT_BYTES,files:1,fields:2,parts:3},fileFilter:(_req,file,callback)=>{const extension=file.originalname.toLowerCase().split('.').pop();if(extension==='pdf'||extension==='docx')callback(null,true);else callback(new Error('Formato no admitido. Puedes analizar archivos PDF y DOCX.'));}});
function parseOfferDocumentUpload(req:express.Request,res:express.Response,next:express.NextFunction){offerDocumentUpload.single('file')(req,res,error=>{if(!error)return next();if((error as any).code==='LIMIT_FILE_SIZE')return res.status(413).json({error:'El documento supera el máximo de 10 MB.'});res.status(400).json({error:error.message==='Formato no admitido. Puedes analizar archivos PDF y DOCX.'?error.message:'No se pudo recibir el archivo. Revisa el formato y vuelve a intentar.'});});}
app.post('/api/company/offer-drafts/:code/analyze-document',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(5,60_000,'offer-document-analysis'),parseOfferDocumentUpload,async(req,res,next)=>{
  try{
    const code=z.string().trim().min(1).max(100).parse(req.params.code);
    const input=z.object({name:z.string().trim().min(1).max(255),url:z.string().max(2048).default('')}).strict().parse(req.body);
    const saved=await getOfferDraft(code);
    if(!saved.draft||!Array.isArray((saved.draft as any).documents))return res.status(409).json({error:'Guarda primero la referencia del documento en el borrador.'});
    const documents=(saved.draft as any).documents as Array<Record<string,any>>;
    const document=documents.find(item=>item.name===input.name&&(req.file?item.url===''&&item.sourceKind==='uploaded':item.url===input.url));
    if(!document)return res.status(409).json({error:'El documento ya no está en el borrador guardado. Guarda los cambios y vuelve a intentar.'});
    const analyzedCount=documents.filter(item=>item!==document&&(item.analysisAt||item.analysisStatus==='running')).length;
    if(analyzedCount>=MAX_OFFER_DOCUMENTS_PER_DRAFT&&!document.analysisAt)return res.status(429).json({error:`El borrador alcanzó el máximo de ${MAX_OFFER_DOCUMENTS_PER_DRAFT} documentos analizados.`});
    const source=req.file?{buffer:req.file.buffer,filename:req.file.originalname}:await fetchOfficialOfferDocument(input.url);
    const extraction=await extractOfferDocument(source.buffer,source.filename);
    const analysis=await analyzeOfferDocumentText(input.name,extraction);
    res.set('Cache-Control','private, no-store').json({analysis,analysisAt:new Date().toISOString()});
  }catch(error){if(error instanceof OfferDocumentAnalysisError)return res.status(error.status).json({code:error.code,error:error.message});if(error instanceof z.ZodError)return res.status(400).json({error:'Revisa el nombre y el enlace del documento.'});next(error);}
});
app.put('/api/company/profile',requireDb,requestLimit(20,60_000),async(req,res,next)=>{try{if(typeof req.body?.rut==='string'&&req.body.rut.trim()&&!normalizeChileanRut(req.body.rut))return res.status(400).json({error:'Corrige el RUT indicado.',fieldErrors:{rut:'Ingresa un RUT válido.'}});const parsed=companyProfileSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Revisa los campos indicados.',fieldErrors:companyProfileFieldErrors(parsed.error)});res.json(await saveCompanyProfile(parsed.data));}catch(error){if((error as any)?.code==='ER_DUP_ENTRY'&&String((error as any)?.message).includes('uq_companies_rut_normalized'))return res.status(409).json({code:'COMPANY_ALREADY_REGISTERED',error:'Este RUT ya está registrado para otra empresa.',fieldErrors:{rut:'Este RUT ya está registrado para otra empresa.'}});if(error instanceof Error&&error.message==='El RUT de una empresa registrada no se puede dejar vacío.')return res.status(400).json({error:error.message,fieldErrors:{rut:error.message}});if(error instanceof Error&&error.message==='No se encontró la empresa activa.')return res.status(400).json({error:error.message});next(error);}});
app.get('/api/company/catalog',requireDb,requestLimit(60,60_000),async(req,res,next)=>{try{res.json({items:await searchCompanyProducts(String(req.query.q??''))});}catch(error){next(error);}});
app.post('/api/company/catalog',requireDb,requestLimit(30,60_000),async(req,res,next)=>{try{res.status(201).json({items:await saveCompanyProduct(companyProductSchema.parse(req.body))});}catch(error){next(error);}});
app.patch('/api/company/catalog/:id',requireDb,requestLimit(60,60_000),async(req,res,next)=>{try{const id=z.coerce.number().int().positive().parse(req.params.id);const items=await saveCompanyProduct(companyProductSchema.parse(req.body),id);if(!items)return res.status(404).json({error:'No se encontró el producto en el catálogo de esta empresa.'});res.json({items});}catch(error){next(error);}});
app.delete('/api/company/catalog/:id',requireDb,requestLimit(30,60_000),async(req,res,next)=>{try{const deleted=await deleteCompanyProduct(z.coerce.number().int().positive().parse(req.params.id));if(!deleted)return res.status(404).json({error:'No se encontró el producto en el catálogo de esta empresa.'});res.json({ok:true});}catch(error){next(error);}});
app.post('/api/company/catalog/suggestions',requireDb,requestLimit(10,60_000),async(req,res,next)=>{try{const body=z.object({nombre:z.string().trim().min(2).max(255),categoria:nullableText(160),descripcion:nullableText(1000)}).parse(req.body);res.json(await suggestCommercialTerms(body));}catch(error){if(error instanceof Error&&error.message.startsWith('Groq'))return res.status(502).json({error:error.message});next(error);}});
app.get('/api/company/matches', requireDb, requestLimit(30, 60_000), async (req, res, next) => {
  try {
    // Recorre todo el índice local vigente en lotes. Un prefiltrado por palabras
    // clave y un límite fijo podía dejar fuera fichas con evidencia en partidas
    // o términos guardados al final del perfil.
    res.json(await getCompanyMatches({ board: req.query.view === 'board' }));
  } catch (error) {
    next(error);
  }
});
app.post('/api/company/matches/dismiss', requireDb, requireCompanyRole('admin','collaborator'), requestLimit(60, 60_000), async (req, res, next) => {
  try {
    const body = z.object({ codigo: z.string().trim().min(1).max(100) }).parse(req.body);
    if (!await dismissTrackedOpportunity(body.codigo)) return res.status(404).json({ error: 'La licitación ya no está disponible en el índice local.' });
    res.json({ ok: true, discarded: true });
  } catch (error) {
    next(error);
  }
});
const analyticsFilterSchema=z.object({
  dateFrom:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  modality:z.string().trim().max(80).optional(),
  product:z.string().trim().max(120).optional(),
  organism:z.string().trim().max(160).optional(),
  region:z.string().trim().max(120).optional(),
  state:z.string().trim().max(3).optional(),
}).strict();
const analyticsFiltersFrom = (value: unknown) => normalizeAnalyticsFilters(analyticsFilterSchema.parse(value));
app.use('/api/analytics',requireAuth,requireCsrf,requireVerifiedEmail,requireActiveCompany);
app.get('/api/analytics',requireDb,requestLimit(30,60_000),async(req,res,next)=>{try{
  const filters=analyticsFiltersFrom(req.query);
  const companyId=req.auth!.activeCompanyId!;
  res.set('Cache-Control','no-store').json(await getAnalytics(filters,companyId));
}catch(error){if(error instanceof Error&&error.message.startsWith('El período'))return res.status(400).json({error:error.message});next(error);}});
app.get('/api/analytics/export.csv',requireDb,requestLimit(12,60_000),async(req,res,next)=>{try{
  const filters=analyticsFiltersFrom(req.query);
  const result=await exportAnalyticsCsv(filters);
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="oportuna-analitica.csv"');
  res.setHeader('X-Oportuna-Exported-Rows',String(result.exported));
  res.setHeader('X-Oportuna-Export-Limit',String(result.limit));
  res.send(result.csv);
}catch(error){if(error instanceof Error&&error.message.startsWith('El período'))return res.status(400).json({error:error.message});next(error);}});
app.get('/api/analytics/views',requireDb,requestLimit(60,60_000),async(req,res,next)=>{try{
  res.set('Cache-Control','no-store').json({items:await listAnalyticsViews(req.auth!.activeCompanyId!,req.auth!.userId)});
}catch(error){next(error);}});
app.post('/api/analytics/views',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(20,60_000),async(req,res,next)=>{try{
  const body=z.object({name:z.string().trim().min(2).max(80),filters:analyticsFilterSchema}).strict().parse(req.body);
  const filters=analyticsFiltersFrom(body.filters);
  res.status(201).json(await saveAnalyticsView(req.auth!.activeCompanyId!,req.auth!.userId,body.name,filters));
}catch(error){if(error instanceof Error&&error.message.startsWith('El período'))return res.status(400).json({error:error.message});next(error);}});
app.delete('/api/analytics/views/:id',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(30,60_000),async(req,res,next)=>{try{
  const id=z.coerce.number().int().positive().parse(req.params.id);
  if(!await deleteAnalyticsView(req.auth!.activeCompanyId!,req.auth!.userId,id))return res.status(404).json({error:'No se encontró la vista guardada en esta cuenta.'});
  res.json({ok:true});
}catch(error){next(error);}});
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
app.get('/api/alerts/overview',requireDb,requestLimit(60,60_000),async(_req,res,next)=>{try{res.set('Cache-Control','no-store').json(await getAlertOverview());}catch(error){next(error);}});
app.get('/api/alerts',requireDb,requestLimit(40,60_000),async(req,res,next)=>{try{const filter=z.enum(['all','unread','closing','followup','matches','pending']).default('all').parse(req.query.filter);const [items,counts]=await Promise.all([listAlerts({filter,limit:100}),alertCounts()]);res.json({items,counts});}catch(error){next(error);}});
app.post('/api/alerts/evaluate',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(12,60_000),async(_req,res,next)=>{try{res.json({...await evaluateAlerts(),counts:await alertCounts()});}catch(error){next(error);}});
app.post('/api/alerts/:id/read',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(120,60_000),async(req,res,next)=>{try{const id=z.coerce.number().int().parse(req.params.id);const ok=id<=-1_000_000_000?await markAutomationNotificationRead(Math.abs(id)-1_000_000_000):id<0?await setProactiveMatchRead(Math.abs(id)):await markAlertRead(z.coerce.number().int().positive().parse(id));if(!ok)return res.status(404).json({error:'No se encontró la alerta activa en este espacio.'});res.json({ok:true,counts:await alertCounts()});}catch(error){next(error);}});
app.post('/api/alerts/:id/dismiss',requireDb,requireCompanyRole('admin','collaborator'),requestLimit(120,60_000),async(req,res,next)=>{try{const id=z.coerce.number().int().parse(req.params.id);const ok=id<=-1_000_000_000?await dismissAutomationNotification(Math.abs(id)-1_000_000_000):id<0?await dismissProactiveMatch(Math.abs(id)):await dismissAlert(z.coerce.number().int().positive().parse(id));if(!ok)return res.status(404).json({error:'No se encontró la alerta activa en este espacio.'});res.json({ok:true,counts:await alertCounts()});}catch(error){next(error);}});
app.post('/api/internal/proactive-search/run',requireDb,requireServiceOrAdmin,requestLimit(2,60_000,'proactive-search-run'),async(_req,res,next)=>{let search:any=null;let searchError:unknown;try{search=await runProactiveSearchPass();}catch(error){searchError=error;}try{const automations=await runAutomationPass();if(searchError)return next(searchError);const failed=Number(search?.failed??0)+Number(automations.failed??0);res.set('Cache-Control','no-store').json({...search,failed,locked:Boolean(search?.locked),automation:automations});}catch(error){next(error);}});
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
app.post('/api/buscador/analysis/:codigo',requireDb,requireAuth,requireVerifiedEmail,requireCsrf,requireActiveCompany,requestLimit(8,60_000),async(req,res,next)=>{try{
  const codigo=z.string().trim().min(1).max(100).parse(req.params.codigo);
  const [localRows]=await pool.query<any[]>('SELECT codigo_externo FROM licitaciones WHERE codigo_externo=? LIMIT 1',[codigo]);
  if(!localRows.length)return res.status(404).json({error:'La licitación no está disponible en la copia local.'});
  const officialListing=await getByCode(codigo);
  await indexOfficialDetail(codigo,officialListing as unknown as Record<string,any>);
  const outcome=await runLimitedListingAnalysis(req.auth!.activeCompanyId!,req.auth!.userId,codigo,()=>analyzeListing(codigo));
  res.set('Cache-Control','no-store').set('X-Plan-Analysis-Remaining',String(Math.max(0,outcome.limit-outcome.used))).json({...outcome.value,source:'mercadopublico',refreshedAt:new Date().toISOString()});
}catch(error){next(error);}});
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
  app.get('/centro-de-pruebas',requireAuth,requirePlatformAdmin,(_req,res,next)=>res.sendFile(join(frontendDirectory,'index.html'),error=>error?next(error):undefined));
  app.get('*', (req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) return next();
    res.sendFile(join(frontendDirectory, 'index.html'));
  });
}
app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if(error instanceof SubscriptionLimitError)return res.status(403).json({code:error.code,error:error.message,metric:error.metric,limit:error.limit});
  if(error instanceof PendingPlanRequestError)return res.status(409).json({code:error.code,error:error.message});
  if(error instanceof PlanRequestConflictError)return res.status(409).json({code:error.code,error:error.message});
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'Parámetros inválidos.' });
  const cause=error as {code?:unknown};
  const dbCode=typeof cause?.code==='string'?cause.code:'';
  const isOfferDraft=req.path.startsWith('/api/company/offer-drafts/');
  const requestId=String(res.locals.requestId||'SIN-REF');
  let status=error instanceof MercadoPublicoError?error.status:500;
  let message=status<500&&error instanceof MercadoPublicoError?error.message:'No se pudo completar la solicitud.';
  if(status>=500){
     console.error(`[api] internal_error ref=${requestId} method=${req.method} route=${req.path} type=${error instanceof Error?error.name:'unknown'} code=${dbCode||'none'}`);
    message='Ocurrió un error interno.';
    if(isOfferDraft){
      if(dbCode==='ER_NO_SUCH_TABLE'||dbCode==='ER_BAD_FIELD_ERROR'){
        status=503;
        message='El guardado de borradores no está habilitado correctamente en el servidor. Contacta al administrador e indica la referencia '+requestId+'.';
      }else if(dbCode==='ER_NO_REFERENCED_ROW_2'||dbCode==='ER_ROW_IS_REFERENCED_2'){
        status=409;
        message='La empresa, la sesión o la licitación ya no coincide con los datos del servidor. Recarga la ficha e inténtalo otra vez. Referencia: '+requestId+'.';
      }else{
        message='No se pudo guardar el borrador. Tus datos siguen en pantalla. Inténtalo nuevamente; si vuelve a fallar, comparte esta referencia con soporte: '+requestId+'.';
      }
    }
  }
  const safeDiagnosticCode=/^[A-Z0-9_]+$/.test(dbCode)?dbCode:'INTERNAL';
  return res.status(status).json({ error: message, ...(status>=500||isOfferDraft?{requestId}:{}), ...(status>=500&&req.path==='/api/company/matches'?{diagnosticCode:safeDiagnosticCode}:{}) });
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
