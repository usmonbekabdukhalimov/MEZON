import {createClient} from '@supabase/supabase-js';
import {assert,HttpError} from './validation.js';
const cookie=(request,name)=>request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);
export const accessToken=request=>cookie(request,'mezon_access');
const client=env=>{assert(env.SUPABASE_SECRET_KEY,'Hisob yaratish uchun server kaliti ulanmagan.',503);return createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});};
function username(value){assert(typeof value==='string'&&/^[a-z][a-z0-9_]{3,31}$/.test(value),'Login: 4–32 ta kichik harf, raqam yoki _.');return value;}
const email=name=>`${name}@mezon.internal.invalid`;
function password(value){assert(typeof value==='string'&&value.length>=8&&value.length<=128,'Parol 8–128 belgidan iborat bo‘lsin.');}
function sessionResponse(data,clear=false){
 const headers=new Headers({'Cache-Control':'no-store','Content-Type':'application/json'});
 for(const [name,value,age] of [['mezon_access',data?.access_token,Math.min(data?.expires_in||3600,3600)],['mezon_refresh',data?.refresh_token,604800]])headers.append('Set-Cookie',`${name}=${clear?'':value}; Path=/api; Max-Age=${clear?0:age}; HttpOnly; Secure; SameSite=Strict`);
 return new Response(JSON.stringify({ok:true}),{headers});
}
async function token(env,grant,body){
 assert(env.SUPABASE_URL&&env.SUPABASE_PUBLISHABLE_KEY,'Supabase ulanmagan.',503);
 const res=await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=${grant}`,{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 if(res.status===429)throw new HttpError(429,'Urinishlar ko‘p. Birozdan keyin qayta kiring.');
 assert(res.ok,'Login yoki parol noto‘g‘ri. Qayta kiring.',401);return res.json();
}
export async function login(request,env,body){
 const name=username(body.username);password(body.password);
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode((request.headers.get('cf-connecting-ip')||'local')+':'+name));const key=Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');const window=Math.floor(Date.now()/600000);
 const limit=await env.DB.prepare('INSERT INTO login_limits VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window=excluded.window THEN attempts+1 ELSE 1 END,window=excluded.window RETURNING attempts').bind(key,window).first();
 assert(limit.attempts<=10,'Urinishlar ko‘p. 10 daqiqadan keyin qayta kiring.',429);
 const data=await token(env,'password',{email:email(name),password:body.password});
 const user=await env.DB.prepare('SELECT id FROM users WHERE id=? AND username=? AND active=1').bind(data.user.id,name).first();assert(user,'Hisobga ruxsat berilmagan.',403);
 return sessionResponse(data);
}
export async function refresh(request,env){
 const refresh_token=cookie(request,'mezon_refresh');assert(refresh_token&&refresh_token.length<8192,'Qayta kiring.',401);
 const data=await token(env,'refresh_token',{refresh_token});const user=await env.DB.prepare('SELECT id FROM users WHERE id=? AND active=1').bind(data.user.id).first();assert(user,'Hisob o‘chirilgan.',403);return sessionResponse(data);
}
export async function logout(request,env){
 const token=accessToken(request);if(token)await fetch(env.SUPABASE_URL+'/auth/v1/logout',{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)}).catch(()=>{});
 return sessionResponse(null,true);
}
export async function createAccount(env,actor,body){
 assert(actor.role==='admin','Admin ruxsati kerak.',403);const name=username(body.username);password(body.password);
 assert(['admin','agent'].includes(body.role),'Rol noto‘g‘ri.');if(body.role==='agent')assert(await env.DB.prepare('SELECT id FROM agents WHERE id=?').bind(body.agentId||'').first(),'Agent tanlang.');
 assert(!await env.DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first(),'Login band.',409);
 const supa=client(env);const {data,error}=await supa.auth.admin.createUser({email:email(name),password:body.password,email_confirm:true});assert(!error&&data.user,'Hisob yaratilmadi. Login band yoki Auth xatosi.',409);
 try{await env.DB.batch([env.DB.prepare('INSERT INTO users(id,role,agent_id,email,username) VALUES(?,?,?,?,?)').bind(data.user.id,body.role,body.role==='agent'?body.agentId:null,email(name),name),env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_id,details,recorded_at) VALUES(?,?,?,?,?)').bind(actor.id,'account.created',data.user.id,JSON.stringify({username:name,role:body.role}),new Date().toISOString())]);}
 catch(e){await supa.auth.admin.deleteUser(data.user.id);throw e;}return {ok:true,username:name};
}
export async function setup(request,env,body){
 assert(env.SETUP_TOKEN&&request.headers.get('x-setup-token')===env.SETUP_TOKEN,'Setup ruxsati yo‘q.',403);
 const name=username(body.username);password(body.password);const supa=client(env);
 assert(!(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n,'Setup tugallangan.',409);
 try{await env.DB.prepare('INSERT INTO setup_lock VALUES(1,?)').bind(new Date().toISOString()).run();}catch{throw new HttpError(409,'Setup allaqachon bajarilmoqda.');}
 const {data,error}=await supa.auth.admin.createUser({email:email(name),password:body.password,email_confirm:true});
 if(error){await env.DB.prepare('DELETE FROM setup_lock WHERE id=1').run();throw new HttpError(409,'Auth hisob yaratilmadi.');}
 try{await env.DB.batch([env.DB.prepare("INSERT INTO users(id,role,email,username) VALUES(?,'admin',?,?)").bind(data.user.id,email(name),name),env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_id,details,recorded_at) VALUES(?,?,?,?,?)').bind(data.user.id,'setup.completed',data.user.id,JSON.stringify({username:name}),new Date().toISOString())]);}
 catch(e){await supa.auth.admin.deleteUser(data.user.id);await env.DB.prepare('DELETE FROM setup_lock WHERE id=1').run();throw e;}return {ok:true,username:name};
}
