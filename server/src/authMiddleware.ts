import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { getSession, type AuthenticatedSession } from './authService.js';
import { runWithCompanyContext, type CompanyRole } from './companyRequestContext.js';
import { loadRuntimeConfig } from './runtimeConfig.js';

declare global { namespace Express { interface Request { auth?: AuthenticatedSession; } } }
const runtime=loadRuntimeConfig();
const production=runtime.secureCookies;
export const sessionCookieName=production?'__Host-oportuna.sid':'oportuna.sid';
export const csrfCookieName=production?'__Host-oportuna.csrf':'oportuna.csrf';
function cookieValue(req:Request,name:string){const header=req.headers.cookie??'';for(const part of header.split(';')){const at=part.indexOf('=');if(at<0)continue;if(part.slice(0,at).trim()===name){try{return decodeURIComponent(part.slice(at+1).trim())}catch{return ''}}}return '';}
export function getRequestSessionToken(req:Request){return cookieValue(req,sessionCookieName);}
export function getRequestCsrfToken(req:Request){return cookieValue(req,csrfCookieName);}
export function setSessionCookies(res:Response,sessionToken:string,csrfToken:string,expires:Date){const maxAge=Math.max(0,expires.getTime()-Date.now());const secure=production?'; Secure':'';res.setHeader('Set-Cookie',[
  `${sessionCookieName}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAge/1000)}${secure}`,
  `${csrfCookieName}=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Lax; Max-Age=${Math.floor(maxAge/1000)}${secure}`,
]);}
export function clearSessionCookies(res:Response){const secure=production?'; Secure':'';res.setHeader('Set-Cookie',[
  `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  `${csrfCookieName}=; Path=/; SameSite=Lax; Max-Age=0${secure}`,
]);}
export function matchesConfiguredOrigin(req:Request){const origin=req.get('origin');return Boolean(origin&&runtime.allowedOrigins.includes(origin));}
export const requireSecureTransport:RequestHandler=(req,res,next)=>{if(production&&!req.secure){res.status(426).json({error:'Esta aplicación requiere HTTPS.'});return;}next();};
export const requireRequestOrigin:RequestHandler=(req,res,next)=>{if(!matchesConfiguredOrigin(req)){res.status(403).json({error:'Origen no permitido.'});return;}next();};
export const requireCsrf:RequestHandler=(req,res,next)=>{
  if(['GET','HEAD','OPTIONS'].includes(req.method)){next();return;}
  const csrfCookie=cookieValue(req,csrfCookieName);const supplied=req.get('x-csrf-token');
  if(!matchesConfiguredOrigin(req)||!csrfCookie||!supplied||csrfCookie!==supplied){res.status(403).json({error:'Solicitud no válida. Actualiza la sesión e inténtalo nuevamente.'});return;}
  next();
};
export const requireAuth:RequestHandler=(req,res,next)=>{void (async()=>{
  if(production&&!req.secure){res.status(426).json({error:'Esta aplicación requiere HTTPS.'});return;}
  const token=getRequestSessionToken(req);const csrf=cookieValue(req,csrfCookieName);const session=await getSession(token,csrf);
  if(!session){res.status(401).json({error:'Inicia sesión para continuar.'});return;}
  req.auth=session;
  runWithCompanyContext({userId:session.userId,companyId:session.activeCompanyId,role:session.role,platformRole:session.platformRole},()=>next());
})().catch(next);};
export const requireActiveCompany:RequestHandler=(req,res,next)=>{if(!req.auth?.activeCompanyId||!req.auth.role){res.status(403).json({error:'Selecciona una empresa activa a la que pertenezcas.'});return;}next();};
export const requireVerifiedEmail:RequestHandler=(req,res,next)=>{if(!req.auth?.emailVerified){res.status(403).json({code:'EMAIL_VERIFICATION_REQUIRED',error:'Verifica tu correo para continuar.'});return;}next();};
export const requireCompanyRole=(...roles:CompanyRole[]):RequestHandler=>(req,res,next)=>{if(!req.auth?.role||!roles.includes(req.auth.role)){res.status(403).json({error:'No tienes permisos para esta acción.'});return;}next();};
export const requirePlatformAdmin:RequestHandler=(req,res,next)=>{if(req.auth?.platformRole!=='admin'){res.status(403).json({error:'Se requiere administración de plataforma.'});return;}next();};
export const requireAdministrator:RequestHandler=(req,res,next)=>{if(req.auth?.platformRole==='admin'||req.auth?.role==='admin'){next();return;}res.status(403).json({error:'Se requiere rol de administración.'});};
export const requireServiceOrAdmin:RequestHandler=(req,res,next)=>{
  const token=process.env.SYNC_API_TOKEN?.trim();const authorized=Boolean(token&&token.length>=32&&req.get('authorization')===`Bearer ${token}`);
  if(authorized){(req as any).serviceAuthorized=true;next();return;}
  requireAuth(req,res,(error?:unknown)=>{if(error)return next(error);if(res.headersSent)return;requireCsrf(req,res,(csrfError?:unknown)=>{if(csrfError)return next(csrfError);if(req.auth?.platformRole==='admin'){next();return;}requireActiveCompany(req,res,()=>requireCompanyRole('admin')(req,res,next));});});
};
