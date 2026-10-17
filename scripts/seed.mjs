import {today} from '../src/validation.js';
export function seed(db) {
  if(db.connection.prepare('SELECT COUNT(*) AS n FROM users').get().n) return;
  const c=db.connection;
  c.exec("INSERT INTO agents VALUES('agent-a','Agent A'),('agent-b','Agent B'); INSERT INTO users(id,role,agent_id,active) VALUES('demo-admin','admin',NULL,1),('demo-agent','agent','agent-a',1),('demo-other','agent','agent-b',1)");
  const now=new Date().toISOString(); const current=today();
  const rows=[['demo-1','DEMO-1001','agent-a','client-a','Namuna do‘kon 1','Лапша',current,148800000],
    ['demo-2','DEMO-1002','agent-a','client-b','Namuna do‘kon 2','Крембер',current,93616000],
    ['demo-3','DEMO-1003','agent-b','client-c','Namuna do‘kon 3','Н. Медов',current,38010000],
    ['demo-4','DEMO-1004','agent-a','client-a','Namuna do‘kon 1','Лапша',current.slice(0,8)+'01',29760000]];
  const stmt=c.prepare('INSERT INTO orders(id,source_namespace,source_order_id,agent_id,client_id,client_name,product,order_date,original_minor,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  for(const [id,source,agent,client,name,product,day,amount] of rows) stmt.run(id,'synthetic',source,agent,client,name,product,day,amount,now,'demo-admin');
}
