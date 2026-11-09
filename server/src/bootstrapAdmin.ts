import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import pool from './db.js';
import { hashPassword, normalizeEmail, validEmail } from './authService.js';

async function secret(prompt:string) {
  if(!stdin.isTTY||typeof stdin.setRawMode!=='function')throw new Error('Ejecuta este comando desde una Terminal interactiva.');
  stdout.write(prompt);stdin.setRawMode(true);stdin.resume();let value='';
  return await new Promise<string>((resolve,reject)=>{const onData=(chunk:Buffer)=>{for(const byte of chunk){if(byte===3){stdin.removeListener('data',onData);stdin.setRawMode(false);stdout.write('\n');reject(new Error('Cancelado.'));return;}if(byte===13||byte===10){stdin.removeListener('data',onData);stdin.setRawMode(false);stdout.write('\n');resolve(value);return;}if(byte===127||byte===8){value=value.slice(0,-1);continue;}if(byte>=32)value+=String.fromCharCode(byte);}};stdin.on('data',onData);});
}

const rl=createInterface({input:stdin,output:stdout});
try {
  const email=normalizeEmail(await rl.question('Correo del primer administrador de plataforma: '));
  if(!validEmail(email))throw new Error('El correo no es válido.');
  const password=await secret('Contraseña (mínimo 12 caracteres, entrada oculta): ');
  const hash=await hashPassword(password);
  const conn=await pool.getConnection();
  try{await conn.beginTransaction();const [admins]=await conn.query<any[]>("SELECT id FROM app_users WHERE platform_role='admin' LIMIT 1 FOR UPDATE");if(admins.length)throw new Error('Ya existe un administrador de plataforma.');const [result]=await conn.execute<any>("INSERT INTO app_users (email_normalized,password_hash,platform_role,status,email_verified_at) VALUES (?,?,'admin','active',UTC_TIMESTAMP())",[email,hash]);await conn.commit();stdout.write(`Administrador de plataforma creado (id ${Number(result.insertId)}). No se vinculó ninguna empresa.\n`);}catch(error){await conn.rollback();throw error;}finally{conn.release();}
}catch(error){console.error(error instanceof Error?error.message:'No se pudo crear el administrador.');process.exitCode=1;}finally{rl.close();await pool.end();}
