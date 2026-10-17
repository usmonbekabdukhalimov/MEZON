import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';

// Local test adapter only. Production code exclusively uses env.DB (Cloudflare D1).
export function sqliteDatabase(path=':memory:') {
  const connection=new DatabaseSync(path); connection.exec('PRAGMA foreign_keys=ON');
  const exists=connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='orders'").get();
  if(!exists) connection.exec(readFileSync(new URL('../migrations/0001_core.sql',import.meta.url),'utf8'));
  connection.exec('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)');
  for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')&&n!=='0001_core.sql').sort()) {
    if(connection.prepare('SELECT name FROM local_migrations WHERE name=?').get(name))continue;
    connection.exec('BEGIN');
    try{connection.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));connection.prepare('INSERT INTO local_migrations VALUES(?)').run(name);connection.exec('COMMIT');}catch(e){connection.exec('ROLLBACK');throw e;}
  }
  function prepare(sql,args=[]) {
    return {
      bind(...values) {return prepare(sql,values);},
      async first() {return connection.prepare(sql).get(...args) || null;},
      async all() {return {results:connection.prepare(sql).all(...args)};},
      async run() {return {meta:connection.prepare(sql).run(...args)};},
      execute() {return /^SELECT\b/i.test(sql.trim())?{results:connection.prepare(sql).all(...args)}:{meta:connection.prepare(sql).run(...args)};}
    };
  }
  return {connection,prepare,async batch(statements) {
    connection.exec('BEGIN IMMEDIATE');
    try {const result=statements.map(s=>s.execute());connection.exec('COMMIT');return result;}
    catch(error) {connection.exec('ROLLBACK');throw error;}
  }};
}
