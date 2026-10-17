import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
mkdirSync('drizzle/meta',{recursive:true});
const files=readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort();
const entries=files.map((name,idx)=>{
 const sql=readFileSync('migrations/'+name,'utf8').replace(/^PRAGMA foreign_keys\s*=\s*ON;\s*/i,'');
 // Break only between complete top-level statements, never inside a trigger body.
 writeFileSync('drizzle/'+name,sql.replace(/;\r?\n(?=(?:CREATE|ALTER|DROP|INSERT|PRAGMA)\b)/g,';\n--> statement-breakpoint\n'));
 return {idx,version:'6',when:1792252800000+idx,tag:name.slice(0,-4),breakpoints:true};
});
writeFileSync('drizzle/meta/_journal.json',JSON.stringify({version:'7',dialect:'sqlite',entries},null,2)+'\n');
