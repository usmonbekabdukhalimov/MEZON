import {assert,identifier,money,splits,reason,date,today} from './validation.js';
import {atomicOperation} from './service.js';
const s=(db,sql,...args)=>db.prepare(sql).bind(...args);
const admin=actor=>assert(actor.role==='admin','Admin ruxsati kerak.',403);
const audit=(db,actor,action,id,details)=>s(db,'INSERT INTO audit_logs(actor_id,action,entity_id,details,recorded_at) VALUES(?,?,?,?,?)',actor.id,action,id,JSON.stringify(details),new Date().toISOString());
const guard=(db,id,sql,...args)=>s(db,`INSERT INTO write_guards VALUES(?,CASE WHEN (${sql}) THEN 1 ELSE 0 END)`,id,...args);
export async function rejectRequest(db,actor,id,body){
 admin(actor);reason(body.reason);identifier(id);const key=identifier(body.operationId);
 return atomicOperation(db,actor,key,{type:'reject',id,reason:body.reason},[
 guard(db,key,"SELECT COUNT(*)=1 FROM payment_requests WHERE id=? AND status='pending'",id),
 s(db,"UPDATE payment_requests SET status='rejected',reviewed_by=?,review_reason=? WHERE id=?",actor.id,body.reason,id),audit(db,actor,'request.rejected',id,{reason:body.reason}),s(db,'DELETE FROM write_guards WHERE id=?',key)]);
}
export async function correctPayment(db,actor,id,body){
 admin(actor);identifier(id);reason(body.reason);const key=identifier(body.operationId);
 const payment=await s(db,'SELECT * FROM payments WHERE id=?',id).first();assert(payment,'To‘lov topilmadi.',404);
 const replacement=body.splits?.length?splits(body.splits):null;
 const oldSplits=payment.splits_json==='[]'?JSON.stringify([{method:payment.method,amountMinor:payment.amount_minor}]):payment.splits_json;
 const now=new Date().toISOString();const day=today();
 const statements=[s(db,"INSERT INTO adjustments(id,operation_id,order_id,kind,amount_minor,reversal_of,splits_json,reason,actor_id,effective_date,recorded_at) VALUES(?,?,?,'reversal',?,?,?,?,?,?,?)",crypto.randomUUID(),key,payment.order_id,payment.amount_minor,id,oldSplits,body.reason,actor.id,day,now)];
 if(replacement)statements.push(s(db,'INSERT INTO payments(id,operation_id,order_id,amount_minor,method,actor_id,effective_date,created_at,splits_json) VALUES(?,?,?,?,?,?,?,?,?)',crypto.randomUUID(),key,payment.order_id,replacement.total,replacement.method,actor.id,day,now,replacement.json));
 statements.push(s(db,'UPDATE orders SET version=version+1 WHERE id=?',payment.order_id));
 return atomicOperation(db,actor,key,{type:'correction',id,reason:body.reason,splits:replacement?.parts||[]},statements);
}
export async function returnOrder(db,actor,id,body){
 admin(actor);identifier(id);reason(body.reason);const key=identifier(body.operationId),amount=money(body.amount);
 const prior=await s(db,'SELECT actor_id,payload FROM operations WHERE id=?',key).first();
 if(prior){const refund=body.refundSplits?.length?splits(body.refundSplits):null;assert(prior.actor_id===actor.id&&prior.payload===JSON.stringify({type:'return',id,amount,reason:body.reason,refund:refund?.parts||[]}),'Amal kaliti ziddiyati.',409);return {ok:true,replayed:true};}
 const order=await s(db,'SELECT o.*,COALESCE((SELECT SUM(amount_minor) FROM ledger_all WHERE order_id=o.id),0) AS debt FROM orders o WHERE id=?',id).first();assert(order,'Buyurtma topilmadi.',404);
 const refund=body.refundSplits?.length?splits(body.refundSplits):null;
 assert((refund?.total||0)===Math.max(0,amount-order.debt),'Ortiqcha qaytarilgan qism uchun aniq refund kassalarini kiriting.');
 const now=new Date().toISOString(),creditId=crypto.randomUUID();
 const statements=[guard(db,key,'SELECT COUNT(*)=1 FROM orders WHERE id=? AND version=?',id,order.version),s(db,"INSERT INTO adjustments(id,operation_id,order_id,kind,amount_minor,reason,actor_id,effective_date,recorded_at) VALUES(?,?,?,'return',?,?,?,?,?)",creditId,key,id,-amount,body.reason,actor.id,today(),now)];
 if(refund)statements.push(s(db,"INSERT INTO adjustments(id,operation_id,order_id,kind,amount_minor,return_of,splits_json,reason,actor_id,effective_date,recorded_at) VALUES(?,?,?,'refund',?,?,?,?,?,?,?)",crypto.randomUUID(),key,id,refund.total,creditId,refund.json,body.reason,actor.id,today(),now));
 statements.push(s(db,'UPDATE orders SET version=version+1 WHERE id=?',id),s(db,'DELETE FROM write_guards WHERE id=?',key));
 return atomicOperation(db,actor,key,{type:'return',id,amount,reason:body.reason,refund:refund?.parts||[]},statements);
}
export async function closingSummary(db,start,end){
 const {results:cash}=await s(db,'SELECT method,COALESCE(SUM(amount_minor),0) AS amount_minor FROM cash_movements WHERE effective_date BETWEEN ? AND ? GROUP BY method',start,end).all();
 const debt=await s(db,'SELECT COUNT(*) AS unsettled,COALESCE(SUM(debt),0) AS amount_minor FROM (SELECT o.id,(SELECT SUM(amount_minor) FROM ledger_all WHERE order_id=o.id) AS debt FROM orders o WHERE order_date<=?) WHERE debt!=0',end).first();
 const pending=await s(db,"SELECT COUNT(*) AS n FROM payment_requests r JOIN orders o ON o.id=r.order_id WHERE r.status='pending' AND o.order_date<=?",end).first();
 return {start,end,cash,debt,pending:pending.n};
}
export async function closePeriod(db,actor,body){
 admin(actor);const key=identifier(body.operationId);assert(['day','month'].includes(body.kind),'Yopish turi noto‘g‘ri.');
 const start=date(body.start);let end=start;
 if(body.kind==='month'){assert(start.endsWith('-01'),'Oyning birinchi sanasini tanlang.');const d=new Date(start+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);end=d.toISOString().slice(0,10);assert(end<today(),'Oy tugagandan keyin yoping.');}
 else assert(end<=today(),'Kelajak kunni yopib bo‘lmaydi.');
 const snapshot=await closingSummary(db,start,end);const statements=[];
 // Snapshot and guard are in one write transaction: concurrent payments/imports cannot invalidate a close.
 const cashSql="SELECT json_group_array(json_object('method',method,'amount_minor',amount_minor)) FROM (SELECT method,SUM(amount_minor) AS amount_minor FROM cash_movements WHERE effective_date BETWEEN ? AND ? GROUP BY method ORDER BY method)";
 const sorted=[...snapshot.cash].sort((a,b)=>a.method.localeCompare(b.method));
 statements.push(guard(db,key,`SELECT (${cashSql})=?`,start,end,JSON.stringify(sorted)));
 if(body.kind==='month'){
  statements.push(guard(db,key+'-debt','SELECT NOT EXISTS(SELECT 1 FROM orders o WHERE order_date<=? AND ((SELECT SUM(amount_minor) FROM ledger_all WHERE order_id=o.id)!=0 OR (SELECT SUM(amount_minor) FROM ledger_all WHERE order_id=o.id AND effective_date<=?)!=0))',end,end));
  statements.push(guard(db,key+'-pending',"SELECT NOT EXISTS(SELECT 1 FROM payment_requests r JOIN orders o ON o.id=r.order_id WHERE o.order_date<=? AND r.status='pending')",end));
 }else{
  for(const m of ['cash','card','bank']){const expected=snapshot.cash.find(c=>c.method===m)?.amount_minor||0;const text=body.counted?.[m];assert(typeof text==='string'&&/^-?\d+(\.\d{1,2})?$/.test(text),'Har bir kassa bo‘yicha haqiqiy jami kiriting.');const parsed=text.startsWith('-')?-money(text.slice(1)):(Number(text)===0?0:money(text));assert(parsed===expected,`${m}: haqiqiy summa ledger bilan teng emas.`);}
 }
 const id=crypto.randomUUID();statements.push(s(db,'INSERT INTO closings(id,kind,period_start,period_end,snapshot_json,actor_id,created_at) VALUES(?,?,?,?,?,?,?)',id,body.kind,start,end,JSON.stringify(snapshot),actor.id,new Date().toISOString()),audit(db,actor,'period.closed',id,{kind:body.kind,start,end}),s(db,'DELETE FROM write_guards WHERE id IN (?,?,?)',key,key+'-debt',key+'-pending'));
 return atomicOperation(db,actor,key,{type:'close',kind:body.kind,start,counted:body.counted||null},statements);
}
export async function reopen(db,actor,id,body){
 admin(actor);reason(body.reason);const key=identifier(body.operationId);
 return atomicOperation(db,actor,key,{type:'reopen',id,reason:body.reason},[guard(db,key,'SELECT COUNT(*)=1 FROM closings WHERE id=? AND reopened_by IS NULL',id),s(db,'UPDATE closings SET reopened_by=?,reopen_reason=? WHERE id=?',actor.id,body.reason,id),audit(db,actor,'period.reopened',id,{reason:body.reason}),s(db,'DELETE FROM write_guards WHERE id=?',key)]);
}
