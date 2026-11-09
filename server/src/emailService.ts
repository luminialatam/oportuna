import net from 'node:net';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';

export type MailPurpose = 'verification' | 'password-reset' | 'invitation';
export type MailMessage = { to: string; purpose: MailPurpose; subject: string; text: string; link: string };
type StoredMail = MailMessage & { createdAt: string };
const localOutbox: StoredMail[] = [];

function appEnvironment(env:NodeJS.ProcessEnv) {
  const configured=env.APP_ENV?.trim().toLowerCase();
  if(configured)return configured;
  return env.NODE_ENV?.trim().toLowerCase()==='production'?'production':'development';
}
export function emailMode(env: NodeJS.ProcessEnv = process.env): 'simulated' | 'smtp' {
  const configured = env.EMAIL_TRANSPORT?.trim().toLowerCase();
  if (configured === 'smtp') return 'smtp';
  if (configured === 'simulated') return appEnvironment(env)==='development'?'simulated':'smtp';
  if(configured)throw new Error('EMAIL_TRANSPORT must be smtp or simulated.');
  return appEnvironment(env)==='development'?'simulated':'smtp';
}

export function localMailPreviewEnabled(env: NodeJS.ProcessEnv = process.env) {
  return appEnvironment(env)==='development'&&emailMode(env)==='simulated';
}

const SMTP_REQUIRED=['SMTP_HOST','SMTP_USERNAME','SMTP_PASSWORD','SMTP_FROM'] as const;
export function smtpConfigurationStatus(env:NodeJS.ProcessEnv=process.env) {
  const missing=SMTP_REQUIRED.filter((key)=>!env[key]?.trim());
  if(missing.length)return{configured:false,valid:false,missing};
  try{smtpConfig(env);return{configured:true,valid:true,missing:[] as string[]};}
  catch{return{configured:true,valid:false,missing:[] as string[]};}
}

export function getLocalMail(email: string, purpose?: MailPurpose) {
  const normalized = email.trim().normalize('NFKC').toLowerCase();
  return localOutbox.filter((mail) => mail.to.toLowerCase() === normalized && (!purpose || mail.purpose === purpose)).slice(-10).reverse();
}

function requiredEnv(name: string,env:NodeJS.ProcessEnv=process.env) { const value = env[name]?.trim(); if (!value) throw new Error('SMTP configuration is incomplete.'); return value; }
function safeHeader(value: string) { if (/[\r\n]/.test(value)) throw new Error('Invalid email header.'); return value; }
function encodeHeader(value: string) { return `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`; }

function smtpConfig(env:NodeJS.ProcessEnv=process.env) {
  const host=requiredEnv('SMTP_HOST',env),username=requiredEnv('SMTP_USERNAME',env),password=requiredEnv('SMTP_PASSWORD',env),from=safeHeader(requiredEnv('SMTP_FROM',env));
  const rawPort=env.SMTP_PORT?.trim()||'465';const port=Number(rawPort);
  const rawSecure=env.SMTP_SECURE?.trim().toLowerCase();
  const secure=rawSecure?rawSecure==='true':port===465?true:port===587?false:undefined;
  const rawTimeout=env.SMTP_TIMEOUT_MS?.trim()||'15000';const timeoutMs=Number(rawTimeout);
  if(!Number.isInteger(port)||port<1||port>65535||!Number.isInteger(timeoutMs)||timeoutMs<2000||timeoutMs>60000||/[\s\r\n/@]/.test(host)||host.length>253||!/^[^\s@<>]+@[^\s@<>]+$/.test(from)||!['true','false',undefined].includes(rawSecure)||secure===undefined||(port===465&&!secure)||(port===587&&secure))throw new Error('SMTP configuration is invalid.');
  const heloName=safeHeader(env.SMTP_HELO_NAME?.trim()||'localhost');
  return{host,port,secure,timeoutMs,from,username,password,heloName};
}

type Socket = net.Socket | tls.TLSSocket;
type Reader = { buffer: string; lines: string[]; waiters: Array<() => void>; error?: Error; cleanup: () => void };
function makeReader(socket: Socket): Reader {
  const reader: Reader = { buffer: '', lines: [], waiters: [], cleanup: () => undefined };
  socket.setEncoding('utf8');
  const onData = (chunk: string) => {
    reader.buffer += chunk;
    let newline = reader.buffer.indexOf('\n');
    while (newline >= 0) { reader.lines.push(reader.buffer.slice(0, newline).replace(/\r$/, '')); reader.buffer = reader.buffer.slice(newline + 1); reader.waiters.shift()?.(); newline = reader.buffer.indexOf('\n'); }
  };
  const onError = (error: Error) => { reader.error = error; reader.waiters.shift()?.(); };
  const onClose = () => { reader.error ??= new Error('closed'); reader.waiters.shift()?.(); };
  socket.on('data', onData);socket.on('error', onError);socket.on('close', onClose);
  reader.cleanup=()=>{socket.off('data',onData);socket.off('error',onError);socket.off('close',onClose);socket.setEncoding();};
  return reader;
}
async function readReply(reader: Reader) {
  const lines: string[] = [];
  while (true) {
    while (!reader.lines.length && !reader.error) await new Promise<void>((resolve) => reader.waiters.push(resolve));
    if (reader.error) throw new Error('SMTP connection failed.');
    const line = reader.lines.shift()!; lines.push(line);
    if (/^\d{3} /.test(line)) break;
    if (!/^\d{3}-/.test(line)) throw new Error('Invalid SMTP response.');
  }
  const code = Number(lines[lines.length - 1].slice(0, 3));
  return { code, lines };
}
async function command(socket: Socket, reader: Reader, value: string, allowed: number[]) {
  socket.write(`${value}\r\n`);
  const response = await readReply(reader);
  if (!allowed.includes(response.code)) throw new Error(`SMTP_${response.code}`);
  return response;
}
function connectSmtp(host: string, port: number, secure: boolean, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket: Socket = secure ? tls.connect({ host, port, servername: host, rejectUnauthorized: true }) : net.createConnection({ host, port });
    const timer = setTimeout(() => socket.destroy(new Error('timeout')), timeoutMs);
    const event = secure ? 'secureConnect' : 'connect';
    socket.once(event, () => { clearTimeout(timer); socket.setTimeout(timeoutMs, () => socket.destroy(new Error('timeout'))); resolve(socket); });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}
async function sendSmtp(message: MailMessage) {
  const {host,port,secure:implicitTls,timeoutMs,from,username,password,heloName}=smtpConfig();
  let socket: Socket | undefined;
  try {
    socket = await connectSmtp(host, port, implicitTls, timeoutMs);
    let reader = makeReader(socket);
    const greeting = await readReply(reader); if (greeting.code !== 220) throw new Error(`SMTP_${greeting.code}`);
    const domain = heloName;
    await command(socket, reader, `EHLO ${safeHeader(domain)}`, [250]);
    if (!implicitTls) {
      await command(socket,reader,'STARTTLS',[220]);reader.cleanup();
      const secured=await new Promise<tls.TLSSocket>((resolve,reject)=>{const upgraded=tls.connect({socket:socket as net.Socket,servername:host,rejectUnauthorized:true});upgraded.once('secureConnect',()=>resolve(upgraded));upgraded.once('error',reject);});
      socket=secured;reader=makeReader(socket);await command(socket,reader,`EHLO ${safeHeader(domain)}`,[250]);
    }
    await command(socket, reader, `AUTH PLAIN ${Buffer.from(`\0${username}\0${password}`).toString('base64')}`, [235]);
    await command(socket, reader, `MAIL FROM:<${safeHeader(from)}>`, [250]);
    await command(socket, reader, `RCPT TO:<${safeHeader(message.to)}>`, [250, 251]);
    await command(socket, reader, 'DATA', [354]);
    const body = message.text.replace(/\r?\n/g, '\r\n').split('\r\n').map((line) => line.startsWith('.') ? `.${line}` : line).join('\r\n');
    const content = [
      `From: ${from}`, `To: ${safeHeader(message.to)}`, `Subject: ${encodeHeader(safeHeader(message.subject))}`,
      `Date: ${new Date().toUTCString()}`, `Message-ID: <${randomUUID()}@${domain}>`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', body, '.', '',
    ].join('\r\n');
    socket.write(content);
    const sent = await readReply(reader); if (sent.code !== 250) throw new Error(`SMTP_${sent.code}`);
    await command(socket, reader, 'QUIT', [221]);
  } catch (error) {
    socket?.destroy();
    // Deliberately omit server responses, credentials, recipient and token from logs/errors.
    const message = error instanceof Error ? error.message : '';
    const safeCode = /^SMTP_\d{3}$/.test(message) ? message : message.includes('timeout') ? 'SMTP_TIMEOUT' : 'SMTP_DELIVERY_FAILED';
    throw new Error(safeCode);
  } finally { socket?.end(); }
}

export async function sendEmail(message: MailMessage) {
  if (emailMode() === 'simulated') {
    localOutbox.push({ ...message, createdAt: new Date().toISOString() });
    if (localOutbox.length > 200) localOutbox.splice(0, localOutbox.length - 200);
    return 'simulated' as const;
  }
  await sendSmtp(message);
  return 'smtp' as const;
}

export function appBaseUrl() {
  const origin = process.env.CLIENT_ORIGIN?.split(',')[0]?.trim() || 'http://127.0.0.1:5173';
  return origin.replace(/\/$/, '');
}
