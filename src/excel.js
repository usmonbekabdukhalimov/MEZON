import {Unzip,UnzipInflate,strFromU8} from 'fflate';
import {XMLParser} from 'fast-xml-parser';
import {assert,money,date} from './validation.js';
const array=x=>x==null?[]:Array.isArray(x)?x:[x];
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false,processEntities:true});
const text=x=>typeof x==='object'?(x?.['#text']??''):String(x??'');
function xml(bytes){const v=strFromU8(bytes);assert(!/<!DOCTYPE|<!ENTITY/i.test(v),'XML entities are not supported.');return parser.parse(v);}
function unzipBounded(bytes){
 assert(bytes.byteLength<=5*1024*1024,'Excel fayli 5 MB dan oshmasin.');
 const entries={};let total=0,count=0;
 const unzip=new Unzip(file=>{
  assert(++count<=200,'Excel arxivida fayllar juda ko‘p.');
  assert(!entries[file.name]&&!file.name.includes('..')&&!file.name.startsWith('/'),'Excel arxiv yo‘li noto‘g‘ri.');
  assert(!/vbaProject|externalLinks/i.test(file.name),'Makros va external link ruxsat etilmagan.');
  assert((file.originalSize||0)<=8*1024*1024,'Excel bo‘limi juda katta.');
  const chunks=[];let size=0;
  file.ondata=(error,data,final)=>{if(error)throw error;size+=data.length;total+=data.length;assert(size<=8*1024*1024&&total<=24*1024*1024,'Excel ochilganda hajmi juda katta.');chunks.push(data);if(final){const out=new Uint8Array(size);let i=0;for(const c of chunks){out.set(c,i);i+=c.length;}entries[file.name]=out;}};file.start();
 });
 unzip.register(UnzipInflate);
 for(let offset=0;offset<bytes.length;offset+=1024)unzip.push(bytes.subarray(offset,offset+1024),offset+1024>=bytes.length);
 return entries;
}
function column(address){let n=0;for(const c of address.match(/^[A-Z]+/)?.[0]||'')n=n*26+c.charCodeAt(0)-64;return n-1;}
function decimal(value){
 const v=String(value??'');const m=v.match(/^(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);if(!m)return v;
 const digits=m[1]+(m[2]||''),point=m[1].length+Number(m[3]);assert(Math.abs(point)<40,'Raqam juda katta.');
 return point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point);
}
export function parseWorkbook(bytes,options={}){
 let zip;try{zip=unzipBounded(bytes);}catch(e){assert(false,e.status?e.message:'Excel ZIP fayli yaroqsiz.');}
 assert(zip['xl/workbook.xml']&&zip['xl/_rels/workbook.xml.rels'],'XLSX tuzilmasi topilmadi.');
 const book=xml(zip['xl/workbook.xml']);const sheets=array(book.workbook.sheets.sheet);assert(sheets.length===1,'Hozir har faylda bitta ma’lumot varag‘i bo‘lishi kerak.');
 const rels=array(xml(zip['xl/_rels/workbook.xml.rels']).Relationships.Relationship);
 const rel=rels.find(r=>r['@_Id']===sheets[0]['@_r:id']);assert(rel&&!rel['@_TargetMode'],'Excel varag‘i yo‘li noto‘g‘ri.');
 const target=rel['@_Target'].startsWith('/')?rel['@_Target'].slice(1):'xl/'+rel['@_Target'];assert(zip[target],'Excel varag‘i topilmadi.');
 const strings=zip['xl/sharedStrings.xml']?array(xml(zip['xl/sharedStrings.xml']).sst.si).map(si=>si.t!==undefined?text(si.t):array(si.r).map(r=>text(r.t)).join('')):[];
 const rows=array(xml(zip[target]).worksheet.sheetData?.row).map(r=>{const values=[];let formula=false;for(const c of array(r.c)){const col=column(c['@_r']);assert(col>=0&&col<64,'Ustun chegarasi oshdi.');formula ||= c.f!==undefined;values[col]=c['@_t']==='s'?strings[Number(c.v)]:c['@_t']==='inlineStr'?text(c.is?.t):text(c.v);}return {number:Number(r['@_r']),values,formula};}).filter(r=>r.values.some(v=>v!==''&&v!=null));
 assert(rows.length<=202,'Bir importda 200 tagacha buyurtma. Katta faylni bo‘ling.');
 const header=rows.find(r=>r.values.includes('Сумма'));assert(header,'Сумма ustuni topilmadi.');
 let profile;if(header.values.includes('ИД заказа'))profile=header.values.includes('Дата доставки')?'lapsha':header.values.includes('Дата и время создания')?'krember':null;
 else if(header.values.includes('№')&&header.values.includes('Дата заявки'))profile='medov';
 assert(profile,'Fayl formati qo‘llanmaydi.');
 const isMed=profile==='medov';const col=isMed?{id:1,date:3,agent:12,client:5,amount:8}:{id:0,date:1,agent:2,client:4,amount:5};
 for(const [key,label] of [['id',isMed?'№':'ИД заказа'],['amount','Сумма'],['agent',isMed?'Агент':'Торговый представитель'],['client','Клиент']])assert(header.values[col[key]]===label,'Ustunlar mappingga mos emas: '+label);
 const product={lapsha:'Лапша',krember:'Крембер',medov:'Н. Медов'}[profile];
 const data=rows.filter(r=>r.number>header.number).map(row=>{
  const raw=row.values;const issues=[];let amountMinor=null,day=null,id='';
  try{assert(!row.formula,'Formula saqlangan qatorni qiymatlarga aylantiring.');id=decimal(raw[col.id]).replace(/\.0+$/,'');assert(/^\d{1,30}$/.test(id),'Order ID noto‘g‘ri yoki aniqligi yo‘qolgan.');amountMinor=money(decimal(raw[col.amount]).replace(/\.0+$/,''));
   const match=String(raw[col.date]||'').match(isMed?/^(\d{2})\.(\d{2})\s+\d{2}:\d{2}$/:/^(\d{2})\.(\d{2})\.(\d{4})(?: \d{2}:\d{2}:\d{2})?$/);assert(match,'Sana formati noto‘g‘ri.');
   if(isMed)assert(options.confirmApplicationDate===true&&Number.isInteger(options.year)&&options.year>=2000&&options.year<=2100,'н.медов uchun yil va ariza sanasini ishlatishni tasdiqlang.');
   day=date(`${isMed?options.year:match[3]}-${match[2]}-${match[1]}`);
   assert(raw[col.agent]?.trim()&&raw[col.client]?.trim(),'Agent yoki mijoz yo‘q.');
  }catch(e){issues.push(e.message);}
  return {rowNumber:row.number,raw,issues,normalized:{sourceNamespace:isMed?'medov':'upstream-common',sourceOrderId:id,product,orderDate:day,amountMinor,agentLabel:String(raw[col.agent]||'').trim(),clientLabel:String(raw[col.client]||'').trim()}};
 });
 return {profile,sheet:sheets[0]['@_name'],rows:data};
}
