import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import { emailMode, getLocalMail, localMailPreviewEnabled, logSmtpFailure, probeSmtp, sanitizedSmtpFailureCode, sendEmail, sendSmtp, smtpConfigurationStatus } from '../src/emailService.js';

class FakeSmtpSocket extends Duplex {
  private dataMode=false;
  constructor(private readonly authCode=235){super();setImmediate(()=>this.push('220 smtp-test ready\r\n'));}
  _read(){}
  _write(chunk:Buffer|string,_encoding:BufferEncoding,callback:(error?:Error|null)=>void){
    const input=chunk.toString();let reply='';
    if(this.dataMode){this.dataMode=false;reply='250 2.0.0 accepted\r\n';}
    else for(const line of input.trim().split(/\r?\n/)){
      if(line.startsWith('EHLO '))reply+='250 smtp-test\r\n';
      else if(line.startsWith('AUTH PLAIN '))reply+=`${this.authCode} auth result\r\n`;
      else if(line.startsWith('MAIL FROM:'))reply+='250 sender ok\r\n';
      else if(line.startsWith('RCPT TO:'))reply+='250 recipient ok\r\n';
      else if(line==='DATA'){this.dataMode=true;reply+='354 continue\r\n';}
      else if(line==='QUIT')reply+='221 bye\r\n';
    }
    setImmediate(()=>{if(reply)this.push(reply);callback();});
  }
}

assert.equal(emailMode({ APP_ENV: 'development' }), 'simulated');
assert.equal(emailMode({ APP_ENV: 'production', NODE_ENV: 'production', EMAIL_TRANSPORT: 'simulated' }), 'smtp', 'production cannot silently simulate mail');
assert.equal(emailMode({ APP_ENV: 'production' }), 'smtp', 'APP_ENV production takes precedence when NODE_ENV is omitted');
assert.equal(emailMode({ APP_ENV: 'staging', NODE_ENV: 'development', EMAIL_TRANSPORT: 'simulated' }), 'smtp', 'staging cannot silently simulate mail');
assert.throws(()=>emailMode({APP_ENV:'development',EMAIL_TRANSPORT:'smpt'}),/EMAIL_TRANSPORT must be smtp or simulated/);
assert.equal(localMailPreviewEnabled({ APP_ENV: 'development' }), true);
assert.equal(localMailPreviewEnabled({ APP_ENV: 'production', EMAIL_TRANSPORT: 'simulated' }), false);
const smtpBase={SMTP_HOST:'smtp.example.invalid',SMTP_USERNAME:'qa-user',SMTP_PASSWORD:'not-a-real-secret',SMTP_FROM:'no-reply@example.invalid'};
assert.deepEqual(smtpConfigurationStatus(smtpBase),{configured:true,valid:true,missing:[]},'implicit TLS defaults correctly on 465 without exposing values');
assert.equal(smtpConfigurationStatus({...smtpBase,SMTP_PORT:'587'}).valid,true,'587 defaults to STARTTLS');
assert.equal(smtpConfigurationStatus({...smtpBase,SMTP_PORT:'587',SMTP_SECURE:'true'}).valid,false,'implicit TLS on the standard STARTTLS port is rejected');
assert.equal(smtpConfigurationStatus({...smtpBase,SMTP_PORT:'465',SMTP_SECURE:'false'}).valid,false,'plain SMTP on the implicit TLS port is rejected');
assert.deepEqual(smtpConfigurationStatus({SMTP_HOST:'mail.example.invalid'}),{configured:false,valid:false,missing:['SMTP_USERNAME','SMTP_PASSWORD','SMTP_FROM']});
assert.equal(sanitizedSmtpFailureCode(new Error('timeout')),'SMTP_TIMEOUT');
assert.equal(sanitizedSmtpFailureCode(Object.assign(new Error('refused'),{code:'ECONNREFUSED'})),'SMTP_CONNECTION_FAILED');
assert.equal(sanitizedSmtpFailureCode(new Error('SMTP_550')),'SMTP_5xx');
assert.equal(sanitizedSmtpFailureCode(new Error('SMTP_421')),'SMTP_4xx');
assert.equal(sanitizedSmtpFailureCode(new Error('SMTP_CONNECTION_FAILED')),'SMTP_CONNECTION_FAILED','sanitization remains stable when an already-sanitized error is handled again');

const smtpTestConfig={...smtpBase,SMTP_PORT:'465',SMTP_SECURE:'true'};
const fakeConnect=async()=>new FakeSmtpSocket() as any;
const smtpLink='https://example.invalid/?verifyEmail=fake-token';
const smtpMessage={to:'qa@example.invalid',purpose:'verification' as const,subject:'QA verify',text:`Open ${smtpLink}`,link:smtpLink};
assert.equal(await sendSmtp(smtpMessage,smtpTestConfig,fakeConnect),'accepted','a local SMTP server accepting DATA confirms SMTP acceptance');
assert.deepEqual(await probeSmtp(smtpTestConfig,fakeConnect),{authenticated:true},'SMTP diagnostic checks connection/auth without sending a message');
await assert.rejects(probeSmtp(smtpTestConfig,async()=>{throw Object.assign(new Error('connection refused'),{code:'ECONNREFUSED'});}),/SMTP_CONNECTION_FAILED/);
await assert.rejects(probeSmtp(smtpTestConfig,async()=>new FakeSmtpSocket(535) as any),/SMTP_5xx/);
const logged:string[]=[];const originalConsoleError=console.error;console.error=(line?:unknown)=>logged.push(String(line));
try{logSmtpFailure('password-reset',new Error('SMTP_550'));}finally{console.error=originalConsoleError;}
assert.deepEqual(logged,['[email] delivery_failed purpose=password-reset code=SMTP_5xx'],'delivery logs contain only the purpose and sanitized SMTP code');
process.env.APP_ENV = 'development';
process.env.EMAIL_TRANSPORT = 'simulated';
const link = 'http://127.0.0.1:5173/?verifyEmail=unit-test-token';
assert.equal(await sendEmail({ to: 'qa@example.invalid', purpose: 'verification', subject: 'Verifica', text: `Abre ${link}`, link }), 'simulated');
for(const purpose of ['password-reset','invitation'] as const)assert.equal(await sendEmail({to:'qa@example.invalid',purpose,subject:'Prueba',text:`Abre ${link}`,link}),'simulated');
const mail = getLocalMail('QA@example.invalid', 'verification')[0];
assert.equal(mail?.link, link);
assert.equal(mail?.to, 'qa@example.invalid');
assert.ok(mail?.createdAt);
process.env.EMAIL_TRANSPORT = 'smtp';
delete process.env.SMTP_HOST;
process.env.SMTP_PASSWORD='not-a-real-secret';
await assert.rejects(sendEmail({ to: 'qa@example.invalid', purpose: 'verification', subject: 'Verifica', text: link, link }), (error:any) => error.message==='SMTP configuration is incomplete.'&&!error.message.includes(process.env.SMTP_PASSWORD));
console.log('PASS: SMTP local aceptado y caído, diagnóstico sin envío, códigos sanitizados, simulación y errores sin secretos.');
