import pool from './db.js';
import { currentCompanyContext } from './companyRequestContext.js';
import { formatChileanRut, normalizeChileanRut } from './chileanRut.js';

export type CompanyOnboardingInput = {
  rut: string; razonSocial: string; nombreComercial: string; rubroPrincipal: string; region: string; emailContacto: string;
  telefono?: string|null; sitioWeb?: string|null; direccion?: string|null; comuna?: string|null; descripcionComercial?: string|null;
  regionesOperacion?: string[]; productosPrincipales?: string[];
};

export async function registerCompanyForCurrentUser(input: CompanyOnboardingInput) {
  const context=currentCompanyContext();
  if(!context?.userId)throw new Error('La sesión no está disponible.');
  if(context.companyId)throw new Error('Ya tienes una empresa activa.');
  const rut=normalizeChileanRut(input.rut);
  if(!rut)throw new Error('El RUT no es válido.');
  const connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    const [companies]=await connection.execute<any>('INSERT INTO companies (nombre_comercial,rut_normalized,representation_status) VALUES (?,?,\'unverified\')',[input.nombreComercial.trim(),rut]);
    const companyId=Number(companies.insertId);
    const regions=[...new Set([input.region.trim(),...(input.regionesOperacion??[]).map(value=>value.trim())].filter(Boolean))].slice(0,16);
    await connection.execute(`INSERT INTO commercial_profiles (company_id,razon_social,rut,email_contact,phone,address,commune,primary_region,business_description,actividad,rubros,regiones,sitio_web,palabras_clave,terminos_excluidos)
      VALUES (?,?,?,?,?,?,?,?,?,?,JSON_ARRAY(?),?,?,?,?)`,[
      companyId,input.razonSocial.trim(),formatChileanRut(rut),input.emailContacto.trim().toLowerCase(),input.telefono?.trim()||null,input.direccion?.trim()||null,input.comuna?.trim()||null,input.region.trim(),input.descripcionComercial?.trim()||null,input.rubroPrincipal.trim(),input.rubroPrincipal.trim(),JSON.stringify(regions),input.sitioWeb?.trim()||null,JSON.stringify([]),JSON.stringify([]),
    ]);
    await connection.execute('INSERT INTO company_search_preferences (company_id,estados,regiones) VALUES (?,JSON_ARRAY(5),?)',[companyId,JSON.stringify(regions)]);
    await connection.execute("INSERT INTO company_memberships (user_id,company_id,role,status) VALUES (?,?,'admin','active')",[context.userId,companyId]);
    for(const product of [...new Set((input.productosPrincipales??[]).map(value=>value.trim()).filter(Boolean))].slice(0,20)){
      await connection.execute(`INSERT INTO company_products (company_id,nombre,categoria,descripcion,palabras_clave,sinonimos,terminos_relacionados,aplicaciones,exclusiones,activo)
        VALUES (?,?,?,NULL,JSON_ARRAY(),JSON_ARRAY(),JSON_ARRAY(),JSON_ARRAY(),JSON_ARRAY(),1)`,[companyId,product,input.rubroPrincipal.trim()]);
    }
    await connection.commit();
    return {companyId,representationStatus:'unverified'};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}

export async function requestCompanyAccess(rutInput:string,role:'collaborator'|'read_only',message:string|null) {
  const context=currentCompanyContext();
  if(!context?.userId)throw new Error('La sesión no está disponible.');
  const rut=normalizeChileanRut(rutInput);
  if(!rut)throw new Error('El RUT no es válido.');
  const connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    const [companies]=await connection.query<any[]>('SELECT id FROM companies WHERE rut_normalized=? LIMIT 1 FOR UPDATE',[rut]);
    if(!companies[0]){await connection.commit();return {submitted:true};}
    const companyId=Number(companies[0].id);
    const [memberships]=await connection.query<any[]>("SELECT status FROM company_memberships WHERE company_id=? AND user_id=? LIMIT 1 FOR UPDATE",[companyId,context.userId]);
    if(memberships[0]?.status==='active'){await connection.commit();return {submitted:true};}
    await connection.execute(`INSERT INTO company_access_requests (company_id,user_id,requested_role,message,status)
      VALUES (?,?,?,?, 'pending') ON DUPLICATE KEY UPDATE
      requested_role=IF(status='rejected',VALUES(requested_role),requested_role),
      message=IF(status='rejected',VALUES(message),COALESCE(message,VALUES(message))),
      reviewed_by=IF(status='rejected',NULL,reviewed_by),reviewed_at=IF(status='rejected',NULL,reviewed_at),
      status=IF(status='rejected','pending',status)`,[companyId,context.userId,role,message?.slice(0,1000)||null]);
    await connection.commit();
    return {submitted:true};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}

export async function listCompanyAccessRequests() {
  const context=currentCompanyContext();if(!context?.companyId)throw new Error('Selecciona una empresa activa.');
  const [rows]=await pool.query<any[]>(`SELECT r.id,r.requested_role requestedRole,r.message,r.status,r.created_at createdAt,
    u.id userId,u.first_name firstName,u.last_name lastName,u.email_normalized email
    FROM company_access_requests r JOIN app_users u ON u.id=r.user_id
    WHERE r.company_id=? AND r.status='pending' ORDER BY r.created_at,r.id`,[context.companyId]);
  return rows.map(row=>({...row,id:Number(row.id),userId:Number(row.userId)}));
}

export async function reviewCompanyAccessRequest(requestId:number,decision:'approve'|'reject',role:'collaborator'|'read_only',reviewerId:number) {
  const context=currentCompanyContext();if(!context?.companyId)throw new Error('Selecciona una empresa activa.');
  const connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    const [rows]=await connection.query<any[]>("SELECT user_id FROM company_access_requests WHERE id=? AND company_id=? AND status='pending' FOR UPDATE",[requestId,context.companyId]);
    if(!rows[0]){await connection.rollback();return false;}
    const userId=Number(rows[0].user_id);
    if(decision==='approve')await connection.execute(`INSERT INTO company_memberships (user_id,company_id,role,status) VALUES (?,?,?,'active')
      ON DUPLICATE KEY UPDATE role=VALUES(role),status='active'`,[userId,context.companyId,role]);
    await connection.execute('UPDATE company_access_requests SET status=?,requested_role=?,reviewed_by=?,reviewed_at=UTC_TIMESTAMP() WHERE id=? AND company_id=?',[decision==='approve'?'approved':'rejected',role,reviewerId,requestId,context.companyId]);
    await connection.commit();return true;
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}
