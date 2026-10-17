import {parseWorkbook} from './excel.js';
import {assert,identifier} from './validation.js';
import {atomicOperation} from './service.js';
const s=(db,sql,...a)=>db.prepare(sql).bind(...a);
const admin=a=>assert(a.role==='admin','Admin ruxsati kerak.',403);
export async function previewUpload(request,env,actor){
 admin(actor);assert(env.ORIGINALS,'Original fayllar ombori ulanmagan.',503);
 const length=Number(request.headers.get('content-length'));assert(length>0&&length<=12*1024*1024,'Upload hajmi 12 MB dan oshmasin.',413);
 const form=await request.formData();let options;try{options=JSON.parse(form.get('options')||'{}');}catch{assert(false,'Import sozlamalari noto‘g‘ri.');}
 const files=form.getAll('files');assert(files.length>0&&files.length<=10,'1–10 ta Excel tanlang.');
 const id=crypto.randomUUID();const all=[];let rowCount=0;
 for(const file of files){assert(typeof file.arrayBuffer==='function'&&file.name.endsWith('.xlsx'),'Faqat .xlsx fayl.');const bytes=new Uint8Array(await file.arrayBuffer());const parsed=parseWorkbook(bytes,options);rowCount+=parsed.rows.length;assert(rowCount<=200,'Bir importda 200 tagacha buyurtma.');const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');const fileId=crypto.randomUUID(),key=`originals/${sha}/${fileId}.xlsx`;await env.ORIGINALS.put(key,bytes,{httpMetadata:{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});all.push({fileId,key,sha,bytes:bytes.length,name:file.name.slice(0,150),parsed});}
 const statements=[s(env.DB,'INSERT INTO import_batches(id,actor_id,created_at,options_json) VALUES(?,?,?,?)',id,actor.id,new Date().toISOString(),JSON.stringify(options))];
 for(const f of all){statements.push(s(env.DB,'INSERT INTO import_files VALUES(?,?,?,?,?,?,?)',f.fileId,id,f.name,f.sha,f.key,f.bytes,f.parsed.profile));for(const row of f.parsed.rows)statements.push(s(env.DB,'INSERT INTO import_rows VALUES(?,?,?,?,?,?,?)',crypto.randomUUID(),id,f.fileId,row.rowNumber,JSON.stringify(row.normalized),JSON.stringify(row.issues),JSON.stringify(row.raw)));}
 statements.push(s(env.DB,'INSERT INTO audit_logs(actor_id,action,entity_id,details,recorded_at) VALUES(?,?,?,?,?)',actor.id,'import.preview',id,JSON.stringify({files:files.length,rows:rowCount}),new Date().toISOString()));
 await env.DB.batch(statements);return inspectImport(env.DB,actor,id);
}
export async function inspectImport(db,actor,id){
 admin(actor);identifier(id);const batch=await s(db,'SELECT * FROM import_batches WHERE id=?',id).first();assert(batch,'Import topilmadi.',404);
 const {results:source}=await s(db,'SELECT * FROM import_rows WHERE batch_id=? ORDER BY file_id,row_number',id).all();
 const {results:aliases}=await s(db,'SELECT * FROM aliases').all();const map=new Map(aliases.map(a=>[a.kind+':'+a.label,a.entity_id]));
 const keys=new Map();const rows=[];
 for(const raw of source){const n=JSON.parse(raw.normalized_json);const issues=JSON.parse(raw.issues_json);const agentId=map.get('agent:'+n.agentLabel),clientId=map.get('client:'+n.clientLabel);const key=n.sourceNamespace+':'+n.sourceOrderId;let status=issues.length?'invalid':(!agentId||!clientId)?'unresolved':'new';
  const fingerprint=JSON.stringify(n);if(keys.has(key))status=keys.get(key)===fingerprint?'duplicate':'conflict';else keys.set(key,fingerprint);
  if(!issues.length){const old=await s(db,'SELECT * FROM orders WHERE source_namespace=? AND source_order_id=?',n.sourceNamespace,n.sourceOrderId).first();if(old)status=old.original_minor===n.amountMinor&&old.order_date===n.orderDate&&old.product===n.product&&old.agent_id===agentId&&old.client_id===clientId?'duplicate':'conflict';}
  rows.push({id:raw.id,fileId:raw.file_id,rowNumber:raw.row_number,...n,agentId,clientId,issues,status});
 }
 return {id,status:batch.status,rows,counts:rows.reduce((m,r)=>(m[r.status]=(m[r.status]||0)+1,m),{})};
}
export async function resolveReferences(db,actor,id,body){
 admin(actor);const preview=await inspectImport(db,actor,id);const key=identifier(body.operationId);const statements=[];const seen=new Set();
 for(const r of preview.rows)for(const [kind,label,entity] of [['agent',r.agentLabel,r.agentId],['client',r.clientLabel,r.clientId]]){
  if(entity||!label||seen.has(kind+label))continue;seen.add(kind+label);const entityId=crypto.randomUUID();
  statements.push(s(db,`INSERT INTO ${kind==='agent'?'agents':'clients'}(id,name) VALUES(?,?)`,entityId,label),s(db,'INSERT INTO aliases VALUES(?,?,?)',kind,label,entityId));
 }
 statements.push(s(db,'INSERT INTO audit_logs(actor_id,action,entity_id,details,recorded_at) VALUES(?,?,?,?,?)',actor.id,'aliases.created',id,JSON.stringify({count:seen.size}),new Date().toISOString()));
 await atomicOperation(db,actor,key,{type:'resolve-new-references',id},statements);return inspectImport(db,actor,id);
}
export async function commitImport(db,actor,id,body){
 admin(actor);const key=identifier(body.operationId);const prior=await s(db,'SELECT actor_id,payload FROM operations WHERE id=?',key).first();if(prior){assert(prior.actor_id===actor.id&&prior.payload===JSON.stringify({type:'import',id}),'Amal kaliti ziddiyati.',409);return {ok:true,replayed:true};}
 const preview=await inspectImport(db,actor,id);assert(preview.status==='preview','Bu import allaqachon saqlangan.',409);
 assert(!preview.rows.some(r=>['invalid','unresolved','conflict'].includes(r.status)),'Avval barcha xato va mappinglarni hal qiling.');
 const statements=[s(db,"INSERT INTO write_guards VALUES(?,COALESCE((SELECT 1 FROM import_batches WHERE id=? AND status='preview'),0))",key,id)];const now=new Date().toISOString();
 for(const r of preview.rows.filter(r=>r.status==='new')){const orderId=crypto.randomUUID();statements.push(s(db,'INSERT INTO orders(id,source_namespace,source_order_id,agent_id,client_id,client_name,product,order_date,original_minor,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)',orderId,r.sourceNamespace,r.sourceOrderId,r.agentId,r.clientId,r.clientLabel,r.product,r.orderDate,r.amountMinor,now,actor.id),s(db,'INSERT INTO order_sources VALUES(?,?,?)',orderId,r.fileId,r.rowNumber));}
 statements.push(s(db,"UPDATE import_batches SET status='committed' WHERE id=?",id),s(db,'INSERT INTO audit_logs(actor_id,action,entity_id,details,recorded_at) VALUES(?,?,?,?,?)',actor.id,'import.committed',id,JSON.stringify(preview.counts),now),s(db,'DELETE FROM write_guards WHERE id=?',key));
 return atomicOperation(db,actor,key,{type:'import',id},statements);
}
