import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {sqliteDatabase} from '../scripts/sqlite.mjs';
import {seed} from '../scripts/seed.mjs';
import {saveChanges,requestPayment,approveRequest} from '../src/service.js';
import {correctPayment,returnOrder,closePeriod,reopen} from '../src/accounting.js';
import {previewUpload,resolveReferences,commitImport} from '../src/imports.js';
import {parseWorkbook} from '../src/excel.js';
import {today} from '../src/validation.js';
import {backup} from '../src/backups.js';
import {restoreBackup} from '../scripts/restore.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const admin={id:'demo-admin',role:'admin'},agent={id:'demo-agent',role:'agent',agent_id:'agent-a'};
function fixture(t){const db=sqliteDatabase();seed(db);t.after(()=>db.connection.close());return db;}
const key=()=>crypto.randomUUID();
const balance=db=>db.connection.prepare("SELECT SUM(amount_minor) AS n FROM ledger_all WHERE order_id='demo-1'").get().n;
const pay=(db,parts,version=0)=>saveChanges(db,admin,{operationId:key(),changes:[{orderId:'demo-1',version,note:'',splits:parts}]});
test('split receipt posts exact cash allocations as one immutable payment',async t=>{
 const db=fixture(t),before=balance(db);await pay(db,[{method:'card',amount:'50.01'},{method:'cash',amount:'49.99'}]);assert.equal(balance(db),before-10000);
 assert.deepEqual(db.connection.prepare('SELECT method,amount_minor FROM cash_movements ORDER BY method').all().map(r=>({...r})),[{method:'card',amount_minor:5001},{method:'cash',amount_minor:4999}]);
 await assert.rejects(()=>pay(db,[{method:'cash',amount:'10'},{method:'cash',amount:'20'}],1));assert.equal(balance(db),before-10000);
});
test('split request remains pending and immutable until administrator approval',async t=>{
 const db=fixture(t),before=balance(db);await requestPayment(db,agent,{operationId:key(),orderId:'demo-1',splits:[{method:'cash',amount:'20'},{method:'bank',amount:'30'}]});assert.equal(balance(db),before);
 const r=db.connection.prepare('SELECT * FROM payment_requests').get();await approveRequest(db,admin,r.id,{operationId:key()});assert.equal(balance(db),before-5000);
 assert.throws(()=>db.connection.exec("UPDATE payment_requests SET splits_json='[]'"));
});
test('correction reverses original and posts replacement once; failed replacement rolls back',async t=>{
 const db=fixture(t),before=balance(db);await pay(db,[{method:'cash',amount:'100'}]);const p=db.connection.prepare('SELECT id FROM payments').get().id;
 await assert.rejects(()=>correctPayment(db,admin,p,{operationId:key(),reason:'Mistaken amount',splits:[{method:'bank',amount:'99999999'}]}));assert.equal(balance(db),before-10000);
 const body={operationId:key(),reason:'Wrong cashbox',splits:[{method:'card',amount:'90'}]};await correctPayment(db,admin,p,body);await correctPayment(db,admin,p,body);assert.equal(balance(db),before-9000);assert.equal(db.connection.prepare('SELECT COUNT(*) AS n FROM adjustments').get().n,1);
});
test('returns require exact refund allocations and never leave a negative balance',async t=>{
 const db=fixture(t);await pay(db,[{method:'cash',amount:'1488000'}]);assert.equal(balance(db),0);
 await assert.rejects(()=>returnOrder(db,admin,'demo-1',{operationId:key(),reason:'Damaged goods',amount:'10'}));
 await returnOrder(db,admin,'demo-1',{operationId:key(),reason:'Damaged goods',amount:'10',refundSplits:[{method:'cash',amount:'10'}]});assert.equal(balance(db),0);
 assert.equal(db.connection.prepare('SELECT SUM(amount_minor) AS n FROM cash_movements').get().n,148799000);
});
test('day closing requires reconciliation, freezes receipts, reopen is audited',async t=>{
 const db=fixture(t);await pay(db,[{method:'cash',amount:'100'}]);
 await assert.rejects(()=>closePeriod(db,admin,{operationId:key(),kind:'day',start:today(),counted:{cash:'0',card:'0',bank:'0'}}));
 await closePeriod(db,admin,{operationId:key(),kind:'day',start:today(),counted:{cash:'100',card:'0',bank:'0'}});
 await assert.rejects(()=>pay(db,[{method:'cash',amount:'1'}],1),e=>e.status===409);
 const id=db.connection.prepare('SELECT id FROM closings').get().id;await reopen(db,admin,id,{operationId:key(),reason:'Late receipt'});await pay(db,[{method:'cash',amount:'1'}],1);
});
test('month cannot reset unpaid debt; completed settled month closes',async t=>{
 const db=fixture(t);db.connection.prepare('INSERT INTO orders(id,source_namespace,source_order_id,agent_id,client_id,client_name,product,order_date,original_minor,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('old','test','old','agent-a','client-a','Test','Product','2020-01-01',10000,new Date().toISOString(),admin.id);
 await assert.rejects(()=>closePeriod(db,admin,{operationId:key(),kind:'month',start:'2020-01-01'}));
 await saveChanges(db,admin,{operationId:key(),changes:[{orderId:'old',version:0,note:'',splits:[{method:'cash',amount:'100'}]}]});await assert.rejects(()=>closePeriod(db,admin,{operationId:key(),kind:'month',start:'2020-01-01'}));
 await closePeriod(db,admin,{operationId:key(),kind:'month',start:'2019-12-01'});
 assert.equal(db.connection.prepare("SELECT original_minor FROM orders WHERE id='old'").get().original_minor,10000);
});
const sampleRoot=process.env.MEZON_SAMPLE_DIR;
test('backup is consistent and checksum-verified restore preserves balances and immutable triggers',async t=>{
 const db=fixture(t);await pay(db,[{method:'card',amount:'123.45'}]);let value;
 await backup({DB:db,BUCKET:{put:async(k,v)=>{value=v;}}},admin.id);
 const folder=mkdtempSync(join(tmpdir(),'mezon-restore-'));let restored;t.after(()=>{restored?.connection.close();assert.ok(folder.startsWith(join(tmpdir(),'mezon-restore-')));rmSync(folder,{recursive:true,force:true});});const file=join(folder,'backup.json'),target=join(folder,'restored.db');writeFileSync(file,value);
 restoreBackup(file,target);restored=sqliteDatabase(target);assert.equal(balance(restored),balance(db));assert.throws(()=>restored.connection.exec('DELETE FROM ledger'));assert.throws(()=>restoreBackup(file,target));
 const envelope=JSON.parse(value);envelope.payload+=' ';writeFileSync(file,JSON.stringify(envelope));assert.throws(()=>restoreBackup(file,join(folder,'tampered.db')),/checksum/);
});
test('independent real XLSX parser counts, totals, preview and repeated import',{skip:!sampleRoot},async t=>{
 const db=fixture(t),objects=new Map(),env={DB:db,ORIGINALS:{put:async(k,v)=>objects.set(k,v)}};
 const files=['лапша.xlsx','н.медов.xlsx','крембер.xlsx'];let total=0,count=0;
 for(const name of files){const r=parseWorkbook(readFileSync(sampleRoot+'/'+name),{year:2026,confirmApplicationDate:true});assert.ok(r.rows.every(r=>!r.issues.length));count+=r.rows.length;total+=r.rows.reduce((s,r)=>s+r.normalized.amountMinor,0);}
 assert.equal(count,82);assert.equal(total,23280188400);
 async function preview(){const form=new FormData();form.set('options',JSON.stringify({year:2026,confirmApplicationDate:true}));for(const n of files)form.append('files',new Blob([readFileSync(sampleRoot+'/'+n)]),n);const temp=new Request('https://mezon.test/api/imports',{method:'POST',body:form});const bytes=await temp.arrayBuffer();return previewUpload(new Request(temp.url,{method:'POST',headers:{'content-type':temp.headers.get('content-type'),'content-length':String(bytes.byteLength)},body:bytes}),env,admin);}
 const p=await preview();assert.equal(p.counts.unresolved,82);assert.equal(db.connection.prepare('SELECT COUNT(*) AS n FROM orders').get().n,4);
 await resolveReferences(db,admin,p.id,{operationId:key()});await commitImport(db,admin,p.id,{operationId:key()});const again=await preview();assert.equal(again.counts.duplicate,82);await commitImport(db,admin,again.id,{operationId:key()});assert.equal(db.connection.prepare('SELECT COUNT(*) AS n FROM orders').get().n,86);assert.equal(objects.size,6);
});
