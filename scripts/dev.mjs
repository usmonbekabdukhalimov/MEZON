import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {sqliteDatabase} from './sqlite.mjs';
import {seed} from './seed.mjs';
import {createHandler} from '../src/worker.js';
import {HttpError} from '../src/validation.js';

await mkdir('.local',{recursive:true});
const DB=sqliteDatabase('.local/mezon.db');seed(DB);
const BUCKET={async put(key,data){const file=resolve('.local/objects',key);if(!file.startsWith(resolve('.local/objects')+sep))throw new Error('Invalid object key');await mkdir(resolve(file,'..'),{recursive:true});await writeFile(file,data);},async get(key){try{return {body:await readFile(resolve('.local/objects',key))};}catch{return null;}}};
const publicRoot=resolve('public');
const ASSETS={async fetch(req) {
  let path;
  try {path=decodeURIComponent(new URL(req.url).pathname);} catch {return new Response('Bad path',{status:400});}
  const file=resolve(publicRoot,'.'+(path==='/'?'/index.html':path));
  if(!file.startsWith(publicRoot+sep)) return new Response('Forbidden',{status:403});
  try {return new Response(await readFile(file),{headers:{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[extname(file)] || 'application/octet-stream'}});}
  catch {return new Response('Not found',{status:404});}
}};
const handler=createHandler(async request=>{
  const token=request.headers.get('Authorization');
  const id=({'Bearer demo-admin':'demo-admin','Bearer demo-agent':'demo-agent'})[token];
  if(!id) throw new HttpError(401,'Demo hisobni tanlang.');return id;
});
const server=http.createServer(async(req,res)=>{
  try {
    if(!['127.0.0.1:8787','localhost:8787'].includes(req.headers.host)) {res.writeHead(403);res.end();return;}
    if(req.headers.origin && !['http://127.0.0.1:8787','http://localhost:8787'].includes(req.headers.origin)) {res.writeHead(403);res.end();return;}
    const chunks=[];let size=0;
    for await(const chunk of req) {size+=chunk.length;if(size>12*1024*1024) {res.writeHead(413);res.end();return;}chunks.push(chunk);}
    const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
    const response=req.url==='/api/config'?Response.json({demo:true}):await handler(request,{DB,ASSETS,BUCKET,ORIGINALS:BUCKET});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  } catch(error) {res.writeHead(500);res.end('Local server error');console.error(error.message);}
});
server.listen(8787,'127.0.0.1',()=>console.log('MEZON local demo: http://127.0.0.1:8787 (synthetic data only)'));
