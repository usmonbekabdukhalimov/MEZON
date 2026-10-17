import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {sqliteDatabase} from './sqlite.mjs';
import {backupTables} from '../src/backups.js';
export function restoreBackup(source,target){
 if(existsSync(target))throw new Error('Restore requires a NEW database path. Existing databases are never overwritten.');
 const envelope=JSON.parse(readFileSync(source,'utf8'));
 if(createHash('sha256').update(envelope.payload).digest('hex')!==envelope.sha256)throw new Error('Backup checksum mismatch');
 const data=JSON.parse(envelope.payload);if(data.format!=='mezon-backup-v1'||data.schemaVersion!==3)throw new Error('Unsupported backup');
 if(Object.keys(data.tables).sort().join()!==[...backupTables].sort().join())throw new Error('Backup table manifest mismatch');
 const db=sqliteDatabase(target),c=db.connection;
 const triggers=c.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();
 c.exec('PRAGMA foreign_keys=OFF;BEGIN');
 try{
  for(const trigger of triggers)c.exec(`DROP TRIGGER "${trigger.name}"`);
  for(const table of backupTables){const allowed=c.prepare(`PRAGMA table_info("${table}")`).all().map(r=>r.name);for(const row of data.tables[table]){const cols=Object.keys(row);if(cols.some(k=>!allowed.includes(k)))throw new Error('Unknown backup column');c.prepare(`INSERT INTO "${table}" (${cols.map(k=>'"'+k+'"').join()}) VALUES(${cols.map(()=>'?').join()})`).run(...cols.map(k=>row[k]));}}
  for(const trigger of triggers)c.exec(trigger.sql);
  if(c.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Foreign key validation failed');
  if(c.prepare('SELECT order_id FROM ledger_all GROUP BY order_id HAVING SUM(amount_minor)<0').all().length)throw new Error('Negative balance in backup');
  if(c.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Integrity check failed');
  c.exec('COMMIT;PRAGMA foreign_keys=ON');
 }catch(e){c.exec('ROLLBACK');throw e;}finally{c.close();}
 return {ok:true,originalFiles:'Original XLSX objects remain in the R2 originals/ prefix; keep that bucket with this backup.'};
}
if(process.argv[1]?.endsWith('restore.mjs')){if(process.argv.length!==4)throw new Error('Usage: node scripts/restore.mjs backup.json NEW-database.db');console.log(restoreBackup(process.argv[2],process.argv[3]));}
