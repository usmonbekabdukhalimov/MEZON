import {assert} from './validation.js';
export const backupTables=['agents','users','clients','aliases','operations','orders','payment_requests','payments','ledger','adjustments','audit_logs','import_batches','import_files','import_rows','order_sources','closings'];
export async function backup(env,actorId=null){
 assert(env.BUCKET,'Backup ombori ulanmagan.',503);
 const snapshots=await env.DB.batch(backupTables.map(t=>env.DB.prepare('SELECT * FROM '+t)));
 const payload=JSON.stringify({format:'mezon-backup-v1',schemaVersion:3,createdAt:new Date().toISOString(),tables:Object.fromEntries(backupTables.map((t,i)=>[t,snapshots[i].results]))});
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload))),b=>b.toString(16).padStart(2,'0')).join('');
 const id=crypto.randomUUID(),key='backups/'+id+'.json';await env.BUCKET.put(key,JSON.stringify({sha256:hash,payload}),{httpMetadata:{contentType:'application/json'}});
 await env.DB.prepare('INSERT INTO backups VALUES(?,?,?,?,?)').bind(id,key,hash,new Date().toISOString(),actorId).run();return {ok:true,id,sha256:hash};
}
