PRAGMA foreign_keys = ON;
CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE users (
  id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('admin','agent')),
  agent_id TEXT REFERENCES agents(id), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  CHECK(role='admin' OR agent_id IS NOT NULL)
);
CREATE TABLE orders (
  id TEXT PRIMARY KEY, source_namespace TEXT NOT NULL, source_order_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id), client_id TEXT NOT NULL, client_name TEXT NOT NULL,
  product TEXT NOT NULL, order_date TEXT NOT NULL,
  original_minor INTEGER NOT NULL CHECK(typeof(original_minor)='integer' AND original_minor>0 AND original_minor<=9000000000000),
  note TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
  UNIQUE(source_namespace,source_order_id)
);
CREATE TABLE operations (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE write_guards (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE payment_requests (
  id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id),
  order_id TEXT NOT NULL REFERENCES orders(id), actor_id TEXT NOT NULL REFERENCES users(id),
  amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor>0 AND amount_minor<=9000000000000),
  method TEXT NOT NULL CHECK(method IN ('cash','card','bank')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL
);
CREATE TABLE payments (
  id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id),
  order_id TEXT NOT NULL REFERENCES orders(id), request_id TEXT UNIQUE REFERENCES payment_requests(id),
  amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor>0 AND amount_minor<=9000000000000),
  method TEXT NOT NULL CHECK(method IN ('cash','card','bank')),
  actor_id TEXT NOT NULL REFERENCES users(id), effective_date TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE ledger (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
  kind TEXT NOT NULL CHECK(kind IN ('opening','payment')),
  amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer'),
  payment_id TEXT UNIQUE REFERENCES payments(id), actor_id TEXT NOT NULL REFERENCES users(id),
  effective_date TEXT NOT NULL, recorded_at TEXT NOT NULL,
  CHECK((kind='opening' AND amount_minor>0 AND payment_id IS NULL) OR (kind='payment' AND amount_minor<0 AND payment_id IS NOT NULL))
);
CREATE UNIQUE INDEX one_opening ON ledger(order_id) WHERE kind='opening';
CREATE INDEX ledger_order_date ON ledger(order_id,effective_date);
CREATE INDEX orders_agent_date ON orders(agent_id,order_date);
CREATE INDEX requests_order_status ON payment_requests(order_id,status);
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
  entity_id TEXT NOT NULL, details TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE TRIGGER order_opening AFTER INSERT ON orders BEGIN
  INSERT INTO ledger VALUES ('opening:'||NEW.id,NEW.id,'opening',NEW.original_minor,NULL,NEW.created_by,NEW.order_date,NEW.created_at);
  INSERT INTO audit_logs(actor_id,action,entity_id,details,recorded_at) VALUES(NEW.created_by,'order.created',NEW.id,json_object('original_minor',NEW.original_minor),NEW.created_at);
END;
CREATE TRIGGER immutable_order BEFORE UPDATE OF original_minor,source_namespace,source_order_id,agent_id,client_id,client_name,product,order_date,created_at,created_by ON orders BEGIN
  SELECT RAISE(ABORT,'immutable_order');
END;
CREATE TRIGGER request_guard BEFORE INSERT ON payment_requests BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users u JOIN orders o ON o.agent_id=u.agent_id WHERE u.id=NEW.actor_id AND u.active=1 AND u.role='agent' AND o.id=NEW.order_id) THEN RAISE(ABORT,'request_forbidden') END;
  SELECT CASE WHEN NEW.amount_minor>COALESCE((SELECT SUM(amount_minor) FROM ledger WHERE order_id=NEW.order_id),0) THEN RAISE(ABORT,'overpayment') END;
END;
CREATE TRIGGER request_audit AFTER INSERT ON payment_requests BEGIN
  INSERT INTO audit_logs(actor_id,action,entity_id,details,recorded_at) VALUES(NEW.actor_id,'request.created',NEW.id,json_object('order_id',NEW.order_id,'amount_minor',NEW.amount_minor),NEW.created_at);
END;
CREATE TRIGGER payment_guard BEFORE INSERT ON payments BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND active=1 AND role='admin') THEN RAISE(ABORT,'payment_forbidden') END;
  SELECT CASE WHEN NEW.effective_date<(SELECT order_date FROM orders WHERE id=NEW.order_id) THEN RAISE(ABORT,'payment_before_order') END;
  SELECT CASE WHEN NEW.amount_minor>COALESCE((SELECT SUM(amount_minor) FROM ledger WHERE order_id=NEW.order_id),0) THEN RAISE(ABORT,'overpayment') END;
  SELECT CASE WHEN NEW.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_requests WHERE id=NEW.request_id AND order_id=NEW.order_id AND status='pending' AND amount_minor=NEW.amount_minor AND method=NEW.method) THEN RAISE(ABORT,'request_conflict') END;
END;
CREATE TRIGGER payment_post AFTER INSERT ON payments BEGIN
  INSERT INTO ledger VALUES('payment:'||NEW.id,NEW.order_id,'payment',-NEW.amount_minor,NEW.id,NEW.actor_id,NEW.effective_date,NEW.created_at);
  UPDATE payment_requests SET status='approved' WHERE id=NEW.request_id;
  INSERT INTO audit_logs(actor_id,action,entity_id,details,recorded_at) VALUES(NEW.actor_id,'payment.approved',NEW.id,json_object('order_id',NEW.order_id,'request_id',NEW.request_id,'amount_minor',NEW.amount_minor,'method',NEW.method),NEW.created_at);
END;
CREATE TRIGGER immutable_payment_update BEFORE UPDATE ON payments BEGIN SELECT RAISE(ABORT,'immutable_payment'); END;
CREATE TRIGGER immutable_payment_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT,'immutable_payment'); END;
CREATE TRIGGER immutable_request BEFORE UPDATE OF id,operation_id,order_id,actor_id,amount_minor,method,created_at ON payment_requests BEGIN SELECT RAISE(ABORT,'immutable_request'); END;
CREATE TRIGGER immutable_ledger_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT,'immutable_ledger'); END;
CREATE TRIGGER immutable_ledger_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT,'immutable_ledger'); END;
CREATE TRIGGER immutable_audit_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT,'immutable_audit'); END;
CREATE TRIGGER immutable_audit_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT,'immutable_audit'); END;
