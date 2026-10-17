import {assert, identifier, money, method, version, today, HttpError,splits} from './validation.js';

const statement = (db, sql, ...args) => db.prepare(sql).bind(...args);
export async function atomicOperation(db, actor, operationId, payload, statements) {
  identifier(operationId);
  const serialized = JSON.stringify(payload);
  const existing = () => statement(db, 'SELECT actor_id,payload FROM operations WHERE id=?', operationId).first();
  function replay(row) {
    assert(row.actor_id === actor.id && row.payload === serialized, 'Bu amal kaliti boshqa o‘zgarish uchun ishlatilgan.', 409);
    return {ok:true, replayed:true};
  }
  const previous = await existing();
  if (previous) return replay(previous);
  try {
    await db.batch([
      statement(db, 'INSERT INTO operations VALUES(?,?,?,?)', operationId, actor.id, serialized, new Date().toISOString()),
      ...statements
    ]);
  } catch (error) {
    const row = await existing();
    if (row) return replay(row);
    const details = `${error.message} ${error.cause?.message || ''}`;
    if (/overpayment/.test(details)) throw new HttpError(409, 'To‘lov joriy qarzdan oshib ketdi.');
    if (/payment_before_order/.test(details)) throw new HttpError(409, 'Buyurtma sanasidan oldin to‘lov kiritilmaydi.');
    if (/period_closed/.test(details)) throw new HttpError(409,'Davr yopilgan. Avval sabab bilan qayta oching.');
    if (/constraint|write_guards|request_conflict|conflict|invalid_splits|return_exceeds/i.test(details)) throw new HttpError(409, 'Ma’lumot o‘zgargan yoki amal takrorlangan. Jadvalni yangilang.');
    throw error;
  }
  return {ok:true, replayed:false};
}

export async function saveChanges(db, actor, body) {
  assert(actor.role === 'admin', 'Faqat Admin/Buxgalter tasdiqlaydi.', 403);
  const {operationId, changes} = body;
  identifier(operationId);
  assert(Array.isArray(changes) && changes.length > 0 && changes.length <= 50, '1–50 ta qator yuboring.');
  const seen = new Set(); const statements = []; const now = new Date().toISOString();
  for (const row of changes) {
    assert(row && typeof row==='object', 'Qator noto‘g‘ri.');
    identifier(row.orderId); version(row.version);
    assert(!seen.has(row.orderId), 'Bitta qatorni ikki marta yubormang.'); seen.add(row.orderId);
    assert(typeof row.note === 'string' && row.note.length <= 500, 'Izoh 500 belgidan oshmasin.');
    const guardId = `${operationId}:${row.orderId}`;
    // A zero-row UPDATE is not a SQL error: this CHECK makes stale/missing rows abort the entire D1 batch.
    statements.push(statement(db, 'INSERT INTO write_guards VALUES(?,COALESCE((SELECT 1 FROM orders WHERE id=? AND version=?),0))', guardId, row.orderId, row.version));
    if (row.payment || row.splits?.length) {
      const receipt=splits(row.splits,row.payment);
      statements.push(statement(db, 'INSERT INTO payments(id,operation_id,order_id,request_id,amount_minor,method,actor_id,effective_date,created_at,splits_json) VALUES(?,?,?,?,?,?,?,?,?,?)', crypto.randomUUID(), operationId, row.orderId, null, receipt.total, receipt.method, actor.id, today(), now,receipt.json));
    }
    statements.push(statement(db, 'INSERT INTO audit_logs(actor_id,action,entity_id,details,recorded_at) SELECT ?,?,id,json_object(\'before_note\',note,\'after_note\',?),? FROM orders WHERE id=?', actor.id, 'order.edited', row.note, now, row.orderId));
    statements.push(statement(db, 'UPDATE orders SET note=?,version=version+1 WHERE id=?', row.note, row.orderId));
    statements.push(statement(db, 'DELETE FROM write_guards WHERE id=?', guardId));
  }
  return atomicOperation(db, actor, operationId, {type:'changes', changes}, statements);
}

export async function requestPayment(db, actor, body) {
  assert(actor.role === 'agent', 'So‘rov Agent uchun.', 403);
  const receipt=splits(body.splits,{amount:body.amount,method:body.method});identifier(body.orderId); identifier(body.operationId);
  const order = await statement(db, 'SELECT id FROM orders WHERE id=? AND agent_id=?', body.orderId, actor.agent_id).first();
  assert(order, 'Buyurtma topilmadi.', 404);
  return atomicOperation(db, actor, body.operationId, {type:'request', orderId:body.orderId,splits:receipt.parts}, [
    statement(db, 'INSERT INTO payment_requests(id,operation_id,order_id,actor_id,amount_minor,method,created_at,splits_json) VALUES(?,?,?,?,?,?,?,?)', crypto.randomUUID(), body.operationId, body.orderId, actor.id, receipt.total, receipt.method, new Date().toISOString(),receipt.json)
  ]);
}

export async function approveRequest(db, actor, requestId, body) {
  assert(actor.role === 'admin', 'Faqat Admin/Buxgalter tasdiqlaydi.', 403);
  identifier(requestId); identifier(body.operationId);
  const request = await statement(db, 'SELECT * FROM payment_requests WHERE id=?', requestId).first();
  assert(request, 'So‘rov topilmadi.', 404);
  const now = new Date().toISOString();
  return atomicOperation(db, actor, body.operationId, {type:'approve',requestId}, [
    statement(db, 'INSERT INTO payments(id,operation_id,order_id,request_id,amount_minor,method,actor_id,effective_date,created_at,splits_json) VALUES(?,?,?,?,?,?,?,?,?,?)', crypto.randomUUID(), body.operationId, request.order_id, requestId, request.amount_minor, request.method, actor.id, today(), now,request.splits_json),
    statement(db,'UPDATE payment_requests SET reviewed_by=? WHERE id=?',actor.id,requestId),
    statement(db, 'UPDATE orders SET version=version+1 WHERE id=?', request.order_id)
  ]);
}
