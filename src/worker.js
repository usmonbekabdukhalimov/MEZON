import {authorize, verifySupabase} from './auth.js';
import {assert, date, today, HttpError} from './validation.js';
import {saveChanges, requestPayment, approveRequest} from './service.js';
import {rejectRequest,correctPayment,returnOrder,closingSummary,closePeriod,reopen} from './accounting.js';
import {previewUpload,inspectImport,resolveReferences,commitImport} from './imports.js';
import {login,logout,refresh,setup,createAccount} from './accounts.js';
import {backup} from './backups.js';

const json = (data, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function readBody(request) {
  assert(request.headers.get('content-type')?.includes('application/json'), 'JSON yuboring.', 415);
  const reader = request.body?.getReader();
  assert(reader, 'So‘rov bo‘sh.');
  const chunks=[]; let size=0;
  while (true) {
    const {done,value}=await reader.read(); if (done) break;
    size+=value.byteLength;
    if (size>65536) { await reader.cancel(); throw new HttpError(413,'So‘rov juda katta.'); }
    chunks.push(value);
  }
  const buffer=new Uint8Array(size); let offset=0;
  for (const chunk of chunks) {buffer.set(chunk,offset);offset+=chunk.byteLength;}
  try {const body=JSON.parse(new TextDecoder().decode(buffer)); assert(body && typeof body==='object' && !Array.isArray(body),'JSON obyekt yuboring.');return body;}
  catch {throw new HttpError(400,'JSON noto‘g‘ri.');}
}

export function createHandler(verify = verifySupabase) {
  return async function handle(request, env) {
    const url = new URL(request.url); const path = url.pathname;
    try {
      if (path === '/api/health' && request.method === 'GET') return json({service:'MEZON', stage:2});
      if (path === '/api/config' && request.method === 'GET') return json({supabaseUrl:env.SUPABASE_URL || '',publishableKey:env.SUPABASE_PUBLISHABLE_KEY || ''});
      if (!path.startsWith('/api/')) {
        const response = await env.ASSETS.fetch(request);
        const headers = new Headers(response.headers);
        headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://*.supabase.co; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
        headers.set('X-Content-Type-Options','nosniff'); headers.set('Referrer-Policy','same-origin');
        return new Response(response.body,{status:response.status,headers});
      }
      if(path==='/api/scheduled-backup'&&request.method==='POST'){
        assert(env.BACKUP_TOKEN&&request.headers.get('Authorization')==='Bearer '+env.BACKUP_TOKEN,'Ruxsat yo‘q.',403);
        return json(await backup(env));
      }
      if(!['GET','HEAD'].includes(request.method)){
        const origin=request.headers.get('origin');
        assert(!origin||origin===url.origin,'Boshqa saytdan so‘rov taqiqlangan.',403);
        if(!request.headers.has('Authorization'))assert(origin===url.origin||path==='/api/setup','Origin talab qilinadi.',403);
      }
      if(path==='/api/auth/login'&&request.method==='POST')return await login(request,env,await readBody(request));
      if(path==='/api/auth/refresh'&&request.method==='POST')return await refresh(request,env);
      if(path==='/api/auth/logout'&&request.method==='POST')return await logout(request,env);
      if(path==='/api/setup'&&request.method==='POST')return json(await setup(request,env,await readBody(request)));
      const actor = await authorize(request, env, verify);
      if (path === '/api/me' && request.method === 'GET') return json(actor);
      if (path === '/api/orders' && request.method === 'GET') {
        const from = date(url.searchParams.get('from') || '2000-01-01');
        const to = date(url.searchParams.get('to') || today()); assert(from <= to, 'Davr boshlanishi tugashidan keyin bo‘lmasin.');
        const conditions=['o.order_date BETWEEN ? AND ?']; const params=[to,from,to];
        if (actor.role === 'agent') {conditions.push('o.agent_id=?');params.push(actor.agent_id);}
        else if(url.searchParams.get('agent')) {conditions.push('o.agent_id=?');params.push(url.searchParams.get('agent'));}
        if(url.searchParams.get('product')) {conditions.push('o.product=?');params.push(url.searchParams.get('product'));}
        const {results:orders}=await env.DB.prepare(`SELECT o.*,a.name AS agent_name,
          (SELECT COALESCE(SUM(amount_minor),0) FROM ledger_all WHERE order_id=o.id) AS debt_minor,
          (SELECT COALESCE(SUM(amount_minor),0) FROM ledger_all WHERE order_id=o.id AND effective_date<=?) AS historical_minor
          FROM orders o JOIN agents a ON a.id=o.agent_id WHERE ${conditions.join(' AND ')} ORDER BY o.order_date DESC,o.source_order_id`).bind(...params).all();
        const scope=actor.role==='agent'?' WHERE agent_id=?':'';
        const args=actor.role==='agent'?[actor.agent_id]:[];
        const {results:products}=await env.DB.prepare('SELECT DISTINCT product FROM orders'+scope+' ORDER BY product').bind(...args).all();
        const {results:agents}=await env.DB.prepare(actor.role==='agent'?'SELECT * FROM agents WHERE id=?':'SELECT * FROM agents ORDER BY name').bind(...args).all();
        const currentDay=today(); const todays=orders.filter(o=>o.order_date===currentDay);
        return json({orders,agents,products:products.map(p=>p.product),from,to,today:currentDay,
          summary:{count:orders.length,todayOrders:todays.length,todayClients:new Set(todays.map(o=>o.client_id)).size,
            debtMinor:orders.reduce((s,o)=>s+o.debt_minor,0),historicalMinor:orders.reduce((s,o)=>s+o.historical_minor,0)}});
      }
      if (path === '/api/requests' && request.method === 'GET') {
        const agentScope=actor.role==='agent'?' WHERE o.agent_id=?':'';
        const args=actor.role==='agent'?[actor.agent_id]:[];
        const {results}=await env.DB.prepare('SELECT r.*,o.source_order_id,o.client_name FROM payment_requests r JOIN orders o ON o.id=r.order_id'+agentScope+' ORDER BY r.created_at DESC').bind(...args).all();
        return json(results);
      }
      const history=path.match(/^\/api\/orders\/([a-zA-Z0-9:_-]+)\/history$/);
      if(history && request.method==='GET') {
        const order=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(history[1]).first();
        assert(order && (actor.role==='admin'||order.agent_id===actor.agent_id),'Buyurtma topilmadi.',404);
        const {results}=await env.DB.prepare('SELECT l.*,p.method,COALESCE(a.splits_json,p.splits_json) AS splits_json,a.reason,(SELECT COUNT(*) FROM adjustments WHERE reversal_of=p.id) AS reversed FROM ledger_all l LEFT JOIN payments p ON p.id=l.payment_id LEFT JOIN adjustments a ON a.id=l.id WHERE l.order_id=? ORDER BY l.recorded_at,l.id').bind(order.id).all();
        return json({order,ledger:results});
      }
      if(path==='/api/changes' && request.method==='POST') return json(await saveChanges(env.DB,actor,await readBody(request)));
      if(path==='/api/requests' && request.method==='POST') return json(await requestPayment(env.DB,actor,await readBody(request)));
      const approval=path.match(/^\/api\/requests\/([a-zA-Z0-9:_-]+)\/approve$/);
      if(approval && request.method==='POST') return json(await approveRequest(env.DB,actor,approval[1],await readBody(request)));
      const rejection=path.match(/^\/api\/requests\/([\w-]+)\/reject$/);
      if(rejection&&request.method==='POST')return json(await rejectRequest(env.DB,actor,rejection[1],await readBody(request)));
      const correction=path.match(/^\/api\/payments\/([\w-]+)\/correct$/);
      if(correction&&request.method==='POST')return json(await correctPayment(env.DB,actor,correction[1],await readBody(request)));
      const returned=path.match(/^\/api\/orders\/([\w-]+)\/return$/);
      if(returned&&request.method==='POST')return json(await returnOrder(env.DB,actor,returned[1],await readBody(request)));
      if(path==='/api/imports'&&request.method==='POST')return json(await previewUpload(request,env,actor));
      const imported=path.match(/^\/api\/imports\/([\w-]+)(?:\/(resolve|commit))?$/);
      if(imported){if(request.method==='GET'&&!imported[2])return json(await inspectImport(env.DB,actor,imported[1]));if(request.method==='POST'&&imported[2])return json(await (imported[2]==='resolve'?resolveReferences:commitImport)(env.DB,actor,imported[1],await readBody(request)));}
      if(path==='/api/clients'&&request.method==='GET'){
        const scope=actor.role==='agent'?' WHERE o.agent_id=?':'';
        return json((await env.DB.prepare('SELECT o.client_id,o.client_name,COUNT(*) AS orders,SUM(o.original_minor) AS original_minor,SUM((SELECT SUM(amount_minor) FROM ledger_all WHERE order_id=o.id)) AS debt_minor FROM orders o'+scope+' GROUP BY o.client_id,o.client_name ORDER BY debt_minor DESC').bind(...(actor.role==='agent'?[actor.agent_id]:[])).all()).results);
      }
      const clientHistory=path.match(/^\/api\/clients\/([\w-]+)\/history$/);
      if(clientHistory&&request.method==='GET')return json((await env.DB.prepare('SELECT o.*,(SELECT SUM(amount_minor) FROM ledger_all WHERE order_id=o.id) AS debt_minor FROM orders o WHERE client_id=?'+(actor.role==='agent'?' AND agent_id=?':'')+' ORDER BY order_date DESC').bind(clientHistory[1],...(actor.role==='agent'?[actor.agent_id]:[])).all()).results);
      assert(actor.role==='admin','Admin ruxsati kerak.',403);
      if(path==='/api/backups'&&request.method==='POST')return json(await backup(env,actor.id));
      if(path==='/api/backups'&&request.method==='GET')return json((await env.DB.prepare('SELECT id,sha256,created_at FROM backups ORDER BY created_at DESC LIMIT 100').all()).results);
      const download=path.match(/^\/api\/backups\/([\w-]+)\/download$/);
      if(download&&request.method==='GET'){
        const record=await env.DB.prepare('SELECT object_key FROM backups WHERE id=?').bind(download[1]).first();assert(record,'Backup topilmadi.',404);const object=await env.BUCKET.get(record.object_key);assert(object,'Backup fayli topilmadi.',404);
        return new Response(object.body,{headers:{'Content-Type':'application/json','Cache-Control':'no-store','Content-Disposition':`attachment; filename="mezon-${download[1]}.json"`}});
      }
      if(path==='/api/ranking'&&request.method==='GET'){
        const from=date(url.searchParams.get('from')||'2000-01-01'),to=date(url.searchParams.get('to')||today());
        return json((await env.DB.prepare('SELECT a.id,a.name,COUNT(o.id) AS orders,COALESCE(SUM(o.original_minor),0) AS sales_minor,COALESCE(SUM((SELECT SUM(amount_minor) FROM ledger_all WHERE order_id=o.id)),0) AS debt_minor,(SELECT COALESCE(SUM(c.amount_minor),0) FROM cash_movements c JOIN orders co ON co.id=c.order_id WHERE co.agent_id=a.id AND c.effective_date BETWEEN ? AND ?) AS collected_minor FROM agents a LEFT JOIN orders o ON o.agent_id=a.id AND o.order_date BETWEEN ? AND ? GROUP BY a.id ORDER BY collected_minor DESC').bind(from,to,from,to).all()).results);
      }
      if(path==='/api/audit'&&request.method==='GET')return json((await env.DB.prepare('SELECT * FROM audit_logs WHERE id<? ORDER BY id DESC LIMIT 200').bind(Number(url.searchParams.get('before'))||Number.MAX_SAFE_INTEGER).all()).results);
      if(path==='/api/closings'&&request.method==='GET')return json({closings:(await env.DB.prepare('SELECT * FROM closings ORDER BY created_at DESC').all()).results,summary:await closingSummary(env.DB,date(url.searchParams.get('from')||today()),date(url.searchParams.get('to')||today()))});
      if(path==='/api/closings'&&request.method==='POST')return json(await closePeriod(env.DB,actor,await readBody(request)));
      const opened=path.match(/^\/api\/closings\/([\w-]+)\/reopen$/);
      if(opened&&request.method==='POST')return json(await reopen(env.DB,actor,opened[1],await readBody(request)));
      if(path==='/api/users'&&request.method==='POST')return json(await createAccount(env,actor,await readBody(request)));
      if(path==='/api/users'&&request.method==='GET')return json({users:(await env.DB.prepare('SELECT id,username,role,agent_id,active FROM users').all()).results,agents:(await env.DB.prepare('SELECT * FROM agents ORDER BY name').all()).results});
      throw new HttpError(404,'Sahifa topilmadi.');
    } catch(error) {
      if(!(error instanceof HttpError)) console.error('MEZON API failure:',error.message);
      return json({error:error instanceof HttpError?error.message:'Server xatosi. Amalni qayta tekshiring.'},error.status || 500);
    }
  };
}
export default {fetch:createHandler(),async scheduled(event,env,ctx){ctx.waitUntil(backup(env));}};
