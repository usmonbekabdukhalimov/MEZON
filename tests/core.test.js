import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteDatabase} from '../scripts/sqlite.mjs';
import {seed} from '../scripts/seed.mjs';
import {createHandler} from '../src/worker.js';
import {verifySupabase} from '../src/auth.js';
import {HttpError,money,date,today} from '../src/validation.js';
import {editDraft,changesPayload} from '../public/drafts.js';

function fixture(t) {
  const DB=sqliteDatabase();seed(DB);t.after(()=>DB.connection.close());
  const handler=createHandler(async req=>{
    const id=req.headers.get('Authorization')?.replace('Bearer ','');
    if(!['demo-admin','demo-agent','demo-other'].includes(id))throw new HttpError(401,'Unauthorized');return id;
  });
  async function call(path,actor='demo-admin',body) {
    const response=await handler(new Request('https://mezon.test'+path,{method:body?'POST':'GET',headers:{...(actor?{Authorization:'Bearer '+actor}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),{DB});
    return {status:response.status,data:await response.json()};
  }
  const get=sql=>DB.connection.prepare(sql).get();
  const balance=id=>DB.connection.prepare('SELECT SUM(amount_minor) AS n FROM ledger WHERE order_id=?').get(id).n;
  return {DB,call,get,balance};
}
const change=(orderId='demo-1',amount='100',v=0)=>({orderId,version:v,note:'Paid at desk',payment:{amount,method:'cash'}});
const batch=changes=>({operationId:crypto.randomUUID(),changes});

test('money uses exact integer minor units and rejects invalid financial values',()=>{
  assert.equal(money('0.01'),1);assert.equal(money('1488000.12'),148800012);
  for(const value of ['0','-1','1e3','1.001','NaN','Infinity','1,50',' 10',1,null,'90000000000.01'])assert.throws(()=>money(value));
});
test('date validity and Tashkent business midnight',()=>{
  assert.equal(date('2024-02-29'),'2024-02-29');assert.throws(()=>date('2026-02-29'));
  assert.equal(today(new Date('2026-10-17T19:01:00Z')),'2026-10-18');
});
test('unauthenticated/unknown/disabled accounts are denied',async t=>{
  const f=fixture(t);assert.equal((await f.call('/api/orders',null)).status,401);
  f.DB.connection.exec("UPDATE users SET active=0 WHERE id='demo-agent'");
  assert.equal((await f.call('/api/orders','demo-agent')).status,403);
});
test('agent order filters cannot bypass ownership, other history is hidden',async t=>{
  const f=fixture(t);const result=await f.call('/api/orders?agent=agent-b','demo-agent');
  assert.equal(result.status,200);assert.ok(result.data.orders.every(o=>o.agent_id==='agent-a'));
  assert.equal((await f.call('/api/orders/demo-3/history','demo-agent')).status,404);
});
test('agent cannot directly pay or approve',async t=>{
  const f=fixture(t);assert.equal((await f.call('/api/changes','demo-agent',batch([change()]))).status,403);
  assert.equal((await f.call('/api/requests/missing/approve','demo-agent',{operationId:'approve-1'})).status,403);
});
test('agent request is order-bound, no debt change until approval',async t=>{
  const f=fixture(t);const before=f.balance('demo-1');
  assert.equal((await f.call('/api/requests','demo-agent',{operationId:'request-1',orderId:'demo-1',amount:'123.45',method:'card'})).status,200);
  assert.equal(f.balance('demo-1'),before);assert.equal(f.get('SELECT COUNT(*) AS n FROM payments').n,0);
  const id=f.get('SELECT id FROM payment_requests').id;
  assert.equal((await f.call('/api/requests/'+id+'/approve','demo-admin',{operationId:'approve-1'})).status,200);
  assert.equal(f.balance('demo-1'),before-12345);assert.equal(f.get('SELECT status FROM payment_requests').status,'approved');
  assert.equal(f.get('SELECT COUNT(*) AS n FROM audit_logs WHERE action=\'payment.approved\'').n,1);
});
test('agent cannot request or enumerate another agent order',async t=>{
  const f=fixture(t);assert.equal((await f.call('/api/requests','demo-agent',{operationId:'request-1',orderId:'demo-3',amount:'10',method:'cash'})).status,404);
  await f.call('/api/requests','demo-other',{operationId:'request-2',orderId:'demo-3',amount:'10',method:'bank'});
  assert.deepEqual((await f.call('/api/requests','demo-agent')).data,[]);
});
test('direct admin payment preserves original and appends ledger',async t=>{
  const f=fixture(t);const before=f.balance('demo-1');
  assert.equal((await f.call('/api/changes','demo-admin',batch([change()]))).status,200);
  assert.equal(f.balance('demo-1'),before-10000);
  assert.equal(f.get("SELECT original_minor FROM orders WHERE id='demo-1'").original_minor,before);
  assert.equal(f.get('SELECT COUNT(*) AS n FROM payment_requests').n,0);
});
test('multiple rows commit together with notes and versions',async t=>{
  const f=fixture(t);const before=f.balance('demo-2');
  assert.equal((await f.call('/api/changes','demo-admin',batch([change(),change('demo-2','10')]))).status,200);
  assert.equal(f.balance('demo-2'),before-1000);assert.equal(f.get("SELECT version FROM orders WHERE id='demo-2'").version,1);
  assert.equal(f.get('SELECT COUNT(*) AS n FROM write_guards').n,0);
});
test('overpayment in second row rolls back first payment, notes, audit and operation',async t=>{
  const f=fixture(t);const before=f.balance('demo-1'),audit=f.get('SELECT COUNT(*) AS n FROM audit_logs').n;
  assert.equal((await f.call('/api/changes','demo-admin',batch([change(),change('demo-2','99999999')]))).status,409);
  assert.equal(f.balance('demo-1'),before);assert.equal(f.get('SELECT COUNT(*) AS n FROM payments').n,0);
  assert.equal(f.get('SELECT COUNT(*) AS n FROM operations').n,0);assert.equal(f.get('SELECT COUNT(*) AS n FROM audit_logs').n,audit);
  assert.equal(f.get("SELECT note FROM orders WHERE id='demo-1'").note,'');
});
test('stale/missing row aborts entire batch instead of silent zero-row update',async t=>{
  const f=fixture(t);const before=f.balance('demo-1');
  assert.equal((await f.call('/api/changes','demo-admin',batch([change(),change('demo-2','10',42)]))).status,409);
  assert.equal(f.balance('demo-1'),before);
  assert.equal((await f.call('/api/changes','demo-admin',batch([change('nonexistent')]))).status,409);
});
test('replayed save is idempotent, changed payload with same key conflicts',async t=>{
  const f=fixture(t);const data=batch([change()]);
  await f.call('/api/changes','demo-admin',data);
  assert.equal((await f.call('/api/changes','demo-admin',data)).data.replayed,true);
  assert.equal(f.get('SELECT COUNT(*) AS n FROM payments').n,1);
  data.changes[0].payment.amount='200';assert.equal((await f.call('/api/changes','demo-admin',data)).status,409);
});
test('two concurrent saves against same version cannot overpay or both succeed',async t=>{
  const f=fixture(t);const responses=await Promise.all([f.call('/api/changes','demo-admin',batch([change('demo-1','1000000')])),f.call('/api/changes','demo-admin',batch([change('demo-1','1000000')]))]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.ok(f.balance('demo-1')>=0);
});
test('duplicate approval is one payment, stale pending request revalidates debt',async t=>{
  const f=fixture(t);
  await f.call('/api/requests','demo-agent',{operationId:'request-1',orderId:'demo-1',amount:'100',method:'cash'});
  const id=f.get('SELECT id FROM payment_requests').id;
  const approve=()=>f.call(`/api/requests/${id}/approve`,'demo-admin',{operationId:crypto.randomUUID()});
  const results=await Promise.all([approve(),approve()]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal(f.get('SELECT COUNT(*) AS n FROM payments').n,1);
  await f.call('/api/requests','demo-agent',{operationId:'request-2',orderId:'demo-2',amount:'936160',method:'cash'});
  const second=f.get("SELECT id FROM payment_requests WHERE operation_id='request-2'").id;
  await f.call('/api/changes','demo-admin',batch([change('demo-2','1')]));
  assert.equal((await f.call(`/api/requests/${second}/approve`,'demo-admin',{operationId:'approval-2'})).status,409);
});
test('original amount, posted payment, ledger and audit cannot be edited/deleted',async t=>{
  const f=fixture(t);await f.call('/api/changes','demo-admin',batch([change()]));
  for(const sql of ["UPDATE orders SET original_minor=1","UPDATE payments SET amount_minor=1","DELETE FROM payments","UPDATE ledger SET amount_minor=1","DELETE FROM ledger","DELETE FROM audit_logs","UPDATE audit_logs SET action='fake'"])assert.throws(()=>f.DB.connection.exec(sql));
});
test('source unique key prevents reimport while repeat client orders remain valid',t=>{
  const f=fixture(t);const n=f.get("SELECT COUNT(*) AS n FROM orders WHERE client_id='client-a'").n;assert.equal(n,2);
  assert.throws(()=>f.DB.connection.exec("INSERT INTO orders SELECT 'duplicate',source_namespace,source_order_id,agent_id,client_id,client_name,product,order_date,original_minor,note,version,created_at,created_by FROM orders WHERE id='demo-1'"));
});
test('period cohort current debt and historical period-end debt stay distinct',async t=>{
  const f=fixture(t);f.DB.connection.prepare('INSERT INTO orders(id,source_namespace,source_order_id,agent_id,client_id,client_name,product,order_date,original_minor,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('old','synthetic','OLD-1','agent-a','client-a','Example','Лапша','2020-01-10',10000,new Date().toISOString(),'demo-admin');
  await f.call('/api/changes','demo-admin',batch([change('old','25')]));
  const result=await f.call('/api/orders?from=2020-01-01&to=2020-01-31');
  assert.equal(result.data.summary.debtMinor,7500);assert.equal(result.data.summary.historicalMinor,10000);
  assert.equal(result.data.summary.count,1);
});
test('invalid request payload and method cannot write financial data',async t=>{
  const f=fixture(t);const data=batch([change()]);data.changes[0].payment.method='crypto';
  assert.equal((await f.call('/api/changes','demo-admin',data)).status,400);
  assert.equal((await f.call('/api/changes','demo-admin',batch([change('demo-1','-1')]))).status,400);
  assert.equal(f.get('SELECT COUNT(*) AS n FROM payments').n,0);
});
test('draft edits are local immutable state, cancel leaves source data unchanged',()=>{
  const order={id:'one',version:4,note:'original',debt_minor:10000};
  let drafts=editDraft(new Map(),order,'amount','10.01');drafts=editDraft(drafts,order,'note','changed');
  assert.equal(order.note,'original');assert.equal(order.debt_minor,10000);
  assert.deepEqual(changesPayload(drafts),[{orderId:'one',version:4,note:'changed',payment:{amount:'10.01',method:'cash'}}]);
  drafts.clear();assert.deepEqual(changesPayload(drafts),[]);assert.equal(order.note,'original');
});
test('production auth validates with Supabase; arbitrary token and anonymous user rejected',async t=>{
  const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);
  const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test'};
  const req=new Request('https://mezon.test',{headers:{Authorization:'Bearer arbitrary'}});
  globalThis.fetch=async()=>new Response('{}',{status:401});await assert.rejects(()=>verifySupabase(req,env),e=>e.status===401);
  globalThis.fetch=async(url,init)=>{assert.equal(url,'https://project.supabase.co/auth/v1/user');assert.equal(init.headers.apikey,'public-test');return Response.json({id:'known',is_anonymous:false,user_metadata:{role:'admin'}});};
  assert.equal(await verifySupabase(req,env),'known');
  globalThis.fetch=async()=>Response.json({id:'anon',is_anonymous:true});await assert.rejects(()=>verifySupabase(req,env),e=>e.status===401);
});
test('choosing payment method before amount retains the selected cashbox',()=>{
  const order={id:'one',version:0,note:''};
  let drafts=editDraft(new Map(),order,'method','bank');
  drafts=editDraft(drafts,order,'amount','12.34');
  assert.equal(changesPayload(drafts)[0].payment.method,'bank');
});
