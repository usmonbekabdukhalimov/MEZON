export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function assert(ok, message, status = 400) { if (!ok) throw new HttpError(status, message); }
export function money(value) {
  assert(typeof value === 'string' && /^\d{1,11}(\.\d{1,2})?$/.test(value), 'Summa musbat, ko‘pi bilan 2 kasrli matn bo‘lishi kerak.');
  const [whole, fraction = ''] = value.split('.');
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  assert(Number.isSafeInteger(n) && n > 0 && n <= 9000000000000, 'Summa ruxsat etilgan chegaradan tashqarida.');
  return n;
}
export function date(value) {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'Sana YYYY-MM-DD formatida bo‘lsin.');
  const parsed = new Date(value + 'T00:00:00Z');
  assert(!Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value, 'Sana mavjud emas.');
  return value;
}
export function today(now = new Date()) { return new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Tashkent', year:'numeric', month:'2-digit', day:'2-digit'}).format(now); }
export function identifier(value) { assert(typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(value), 'Identifikator noto‘g‘ri.'); return value; }
export function method(value) { assert(['cash', 'card', 'bank'].includes(value), 'To‘lov turi noto‘g‘ri.'); return value; }
export function version(value) { assert(Number.isSafeInteger(value) && value >= 0, 'Qator versiyasi noto‘g‘ri.'); return value; }
export function splits(value, legacy) {
  const parts=value || (legacy?[legacy]:[]);
  assert(Array.isArray(parts)&&parts.length>=1&&parts.length<=3,'Naqd/card/bank bo‘yicha 1–3 ta summa kiriting.');
  const seen=new Set();
  const result=parts.map(p=>{assert(p&&typeof p==='object','To‘lov qismi noto‘g‘ri.');method(p.method);assert(!seen.has(p.method),'Kassa takrorlangan.');seen.add(p.method);return {method:p.method,amountMinor:money(p.amount)};}).sort((a,b)=>a.method.localeCompare(b.method));
  const total=result.reduce((s,p)=>s+p.amountMinor,0);assert(Number.isSafeInteger(total)&&total<=9000000000000,'Jami summa juda katta.');
  return {parts:result,total,json:JSON.stringify(result),method:result[0].method};
}
export function reason(value){assert(typeof value==='string'&&value.trim().length>=3&&value.length<=500,'Kamida 3 belgili sabab yozing.');return value.trim();}
