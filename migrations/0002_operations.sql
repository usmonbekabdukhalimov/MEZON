ALTER TABLE payments ADD COLUMN splits_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE payment_requests ADD COLUMN splits_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE payment_requests ADD COLUMN reviewed_by TEXT REFERENCES users(id);
ALTER TABLE payment_requests ADD COLUMN review_reason TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX user_email ON users(email) WHERE email IS NOT NULL;
CREATE TABLE clients(id TEXT PRIMARY KEY,name TEXT NOT NULL);
INSERT INTO clients SELECT DISTINCT client_id,client_name FROM orders;
CREATE TABLE aliases(kind TEXT NOT NULL CHECK(kind IN ('agent','client')),label TEXT NOT NULL,entity_id TEXT NOT NULL,PRIMARY KEY(kind,label));
CREATE TABLE import_batches(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','committed')),options_json TEXT NOT NULL);
CREATE TABLE import_files(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES import_batches(id),name TEXT NOT NULL,sha256 TEXT NOT NULL,object_key TEXT NOT NULL,bytes INTEGER NOT NULL,profile TEXT NOT NULL);
CREATE TABLE import_rows(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES import_batches(id),file_id TEXT NOT NULL REFERENCES import_files(id),row_number INTEGER NOT NULL,normalized_json TEXT NOT NULL,issues_json TEXT NOT NULL,raw_json TEXT NOT NULL);
CREATE TABLE order_sources(order_id TEXT NOT NULL REFERENCES orders(id),file_id TEXT NOT NULL REFERENCES import_files(id),row_number INTEGER NOT NULL,PRIMARY KEY(order_id,file_id,row_number));
CREATE TABLE closings(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('day','month')),period_start TEXT NOT NULL,period_end TEXT NOT NULL,snapshot_json TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,reopened_by TEXT REFERENCES users(id),reopen_reason TEXT);
CREATE UNIQUE INDEX one_active_close ON closings(kind,period_start) WHERE reopened_by IS NULL;
CREATE TABLE adjustments(id TEXT PRIMARY KEY,operation_id TEXT NOT NULL REFERENCES operations(id),order_id TEXT NOT NULL REFERENCES orders(id),kind TEXT NOT NULL CHECK(kind IN ('reversal','return','refund')),amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor!=0),reversal_of TEXT UNIQUE REFERENCES payments(id),return_of TEXT UNIQUE REFERENCES adjustments(id),splits_json TEXT NOT NULL DEFAULT '[]',reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),effective_date TEXT NOT NULL,recorded_at TEXT NOT NULL,
CHECK((kind='return' AND amount_minor<0 AND reversal_of IS NULL AND return_of IS NULL) OR (kind='reversal' AND amount_minor>0 AND reversal_of IS NOT NULL AND return_of IS NULL) OR (kind='refund' AND amount_minor>0 AND reversal_of IS NULL AND return_of IS NOT NULL)));
CREATE INDEX adjustment_order_date ON adjustments(order_id,effective_date);
CREATE VIEW ledger_all AS SELECT id,order_id,kind,amount_minor,payment_id,actor_id,effective_date,recorded_at FROM ledger UNION ALL SELECT id,order_id,kind,amount_minor,reversal_of,actor_id,effective_date,recorded_at FROM adjustments;
CREATE VIEW cash_movements AS
SELECT p.id,p.order_id,p.effective_date,p.method,p.amount_minor FROM payments p WHERE json_array_length(p.splits_json)=0
UNION ALL SELECT p.id,p.order_id,p.effective_date,json_extract(j.value,'$.method'),json_extract(j.value,'$.amountMinor') FROM payments p,json_each(p.splits_json) j
UNION ALL SELECT a.id,a.order_id,a.effective_date,json_extract(j.value,'$.method'),-json_extract(j.value,'$.amountMinor') FROM adjustments a,json_each(a.splits_json) j WHERE a.kind IN ('reversal','refund');

CREATE TRIGGER payment_splits_guard BEFORE INSERT ON payments WHEN NEW.splits_json!='[]' BEGIN
 SELECT CASE WHEN NOT json_valid(NEW.splits_json) THEN RAISE(ABORT,'invalid_splits') END;
 SELECT CASE WHEN json_array_length(NEW.splits_json) NOT BETWEEN 1 AND 3 OR (SELECT SUM(json_extract(value,'$.amountMinor')) FROM json_each(NEW.splits_json))!=NEW.amount_minor OR EXISTS(SELECT 1 FROM json_each(NEW.splits_json) WHERE json_extract(value,'$.method') NOT IN ('cash','card','bank') OR json_type(value,'$.amountMinor')!='integer' OR json_extract(value,'$.amountMinor')<=0) OR (SELECT COUNT(DISTINCT json_extract(value,'$.method')) FROM json_each(NEW.splits_json))!=json_array_length(NEW.splits_json) THEN RAISE(ABORT,'invalid_splits') END;
 SELECT CASE WHEN NEW.request_id IS NOT NULL AND NEW.splits_json!=(SELECT splits_json FROM payment_requests WHERE id=NEW.request_id) THEN RAISE(ABORT,'request_conflict') END;
END;
CREATE TRIGGER immutable_request_splits BEFORE UPDATE OF splits_json ON payment_requests BEGIN SELECT RAISE(ABORT,'immutable_request'); END;
DROP TRIGGER request_guard;
CREATE TRIGGER request_guard BEFORE INSERT ON payment_requests BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users u JOIN orders o ON o.agent_id=u.agent_id WHERE u.id=NEW.actor_id AND u.active=1 AND u.role='agent' AND o.id=NEW.order_id) THEN RAISE(ABORT,'request_forbidden') END;
 SELECT CASE WHEN NEW.amount_minor>COALESCE((SELECT SUM(amount_minor) FROM ledger_all WHERE order_id=NEW.order_id),0) THEN RAISE(ABORT,'overpayment') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM closings c JOIN orders o ON o.id=NEW.order_id WHERE c.kind='month' AND c.reopened_by IS NULL AND o.order_date<=c.period_end) THEN RAISE(ABORT,'period_closed') END;
END;
DROP TRIGGER payment_guard;
CREATE TRIGGER payment_guard BEFORE INSERT ON payments BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND active=1 AND role='admin') THEN RAISE(ABORT,'payment_forbidden') END;
 SELECT CASE WHEN NEW.effective_date<(SELECT order_date FROM orders WHERE id=NEW.order_id) THEN RAISE(ABORT,'payment_before_order') END;
 SELECT CASE WHEN NEW.amount_minor>COALESCE((SELECT SUM(amount_minor) FROM ledger_all WHERE order_id=NEW.order_id),0) THEN RAISE(ABORT,'overpayment') END;
 SELECT CASE WHEN NEW.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_requests WHERE id=NEW.request_id AND order_id=NEW.order_id AND status='pending' AND amount_minor=NEW.amount_minor AND method=NEW.method) THEN RAISE(ABORT,'request_conflict') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM closings c JOIN orders o ON o.id=NEW.order_id WHERE c.reopened_by IS NULL AND ((NEW.effective_date BETWEEN c.period_start AND c.period_end) OR (c.kind='month' AND o.order_date<=c.period_end))) THEN RAISE(ABORT,'period_closed') END;
END;
CREATE TRIGGER order_closed_guard BEFORE INSERT ON orders BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM closings WHERE reopened_by IS NULL AND NEW.order_date<=period_end) THEN RAISE(ABORT,'period_closed') END;
END;
CREATE TRIGGER adjustment_guard BEFORE INSERT ON adjustments BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND active=1 AND role='admin') THEN RAISE(ABORT,'payment_forbidden') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM closings c JOIN orders o ON o.id=NEW.order_id WHERE c.reopened_by IS NULL AND ((NEW.effective_date BETWEEN c.period_start AND c.period_end) OR (c.kind='month' AND o.order_date<=c.period_end))) THEN RAISE(ABORT,'period_closed') END;
 SELECT CASE WHEN NEW.kind='reversal' AND NOT EXISTS(SELECT 1 FROM payments WHERE id=NEW.reversal_of AND order_id=NEW.order_id AND amount_minor=NEW.amount_minor) THEN RAISE(ABORT,'reversal_conflict') END;
 SELECT CASE WHEN NEW.kind='return' AND -NEW.amount_minor>COALESCE((SELECT original_minor FROM orders WHERE id=NEW.order_id),0)+COALESCE((SELECT SUM(amount_minor) FROM adjustments WHERE order_id=NEW.order_id AND kind='return'),0) THEN RAISE(ABORT,'return_exceeds_order') END;
 SELECT CASE WHEN NEW.kind='refund' AND (NOT EXISTS(SELECT 1 FROM adjustments WHERE id=NEW.return_of AND order_id=NEW.order_id AND kind='return' AND operation_id=NEW.operation_id) OR NEW.amount_minor!=-(SELECT SUM(amount_minor) FROM ledger_all WHERE order_id=NEW.order_id)) THEN RAISE(ABORT,'refund_conflict') END;
END;
CREATE TRIGGER adjustment_audit AFTER INSERT ON adjustments BEGIN
 INSERT INTO audit_logs(actor_id,action,entity_id,details,recorded_at) VALUES(NEW.actor_id,NEW.kind,NEW.id,json_object('order_id',NEW.order_id,'amount_minor',NEW.amount_minor,'reason',NEW.reason,'reversal_of',NEW.reversal_of,'return_of',NEW.return_of),NEW.recorded_at);
END;
CREATE TRIGGER immutable_adjustment_update BEFORE UPDATE ON adjustments BEGIN SELECT RAISE(ABORT,'immutable_adjustment'); END;
CREATE TRIGGER immutable_adjustment_delete BEFORE DELETE ON adjustments BEGIN SELECT RAISE(ABORT,'immutable_adjustment'); END;
CREATE TRIGGER immutable_close_snapshot BEFORE UPDATE OF snapshot_json,period_start,period_end,kind,created_at,actor_id ON closings BEGIN SELECT RAISE(ABORT,'immutable_close'); END;
