import {editDraft,changesPayload,draftTotal} from './drafts.js';
import {installExtras} from './extras.js';
const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('uz-UZ',{maximumFractionDigits:2}).format(value/100);
const labels={cash:'Naqd',card:'Card',bank:'Bank',pending:'Kutilmoqda',approved:'Tasdiqlangan',rejected:'Rad etilgan'};
let config,token,actor,orders=[],requests=[],drafts=new Map(),pendingSave=null,busy=false,requestAttempt=null;
const approvalKeys=new Map();
function message(text,error=false){$('message').textContent=text;$('message').className=error?'error':'';}
async function api(path,options={}) {
  const response=await fetch(path,{...options,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(options.body&&!(options.body instanceof FormData)?{'Content-Type':'application/json'}:{}),...options.headers}});
  if(response.status===401&&!config?.demo&&!options.retried&&!path.startsWith('/api/auth/')){const r=await fetch('/api/auth/refresh',{method:'POST'});if(r.ok)return api(path,{...options,retried:true});}
  const data=await response.json();if(!response.ok){const error=new Error(data.error || 'Amal bajarilmadi.');error.status=response.status;throw error;}return data;
}
function post(path,body){return api(path,{method:'POST',body:JSON.stringify(body)});}
function disableBusy(value){busy=value;document.querySelectorAll('#workspace button,#request-form button').forEach(b=>b.disabled=value);updateDraftBar();}
function updateDraftBar(){
  $('save').disabled=busy||!drafts.size;$('cancel').disabled=busy||!drafts.size||!!pendingSave;
  $('draft-count').textContent=drafts.size?`${drafts.size} qator saqlanmagan`:'Saqlangan ma’lumotlar';
  document.querySelectorAll('#filters input,#filters select,#filters button').forEach(e=>e.disabled=busy||drafts.size>0);
  document.querySelectorAll('#orders-body input,#orders-body select').forEach(e=>e.disabled=busy||!!pendingSave);
  document.querySelectorAll('#request-form input,#request-form select').forEach(e=>e.disabled=busy||!!requestAttempt);
}
function renderOrders(){
  $('orders-body').innerHTML=orders.map(o=>{
    const d=drafts.get(o.id);const preview=o.debt_minor-draftTotal(d);
    return `<tr data-id="${escape(o.id)}" class="${d?'dirty':''}"><td><strong>${escape(o.source_order_id)}</strong><small>${escape(o.order_date)}</small></td><td><strong>${escape(o.client_name)}</strong><small>${escape(o.agent_name)}</small></td><td>${escape(o.product)}</td><td class="numeric original">${money(o.original_minor)}</td><td class="numeric ${d?'preview':''}" data-debt>${money(preview)}${d?'<small>Saqlanmagan hisob</small>':''}</td>${['cash','card','bank'].map(m=>`<td class="admin-col"><input class="cell-input" data-field="${m}" aria-label="${escape(o.source_order_id)} ${labels[m]}" inputmode="decimal" placeholder="0.00" value="${escape(d?.[m]||'')}"></td>`).join('')}<td class="admin-col"><input class="cell-input note-input" data-field="note" aria-label="${escape(o.source_order_id)} izoh" maxlength="500" value="${escape(d?.note??o.note)}"></td><td><div class="row-actions"><button data-history="${escape(o.id)}">Tarix</button>${actor.role==='agent'?`<button data-request="${escape(o.id)}" ${o.debt_minor<=0?'disabled':''}>To‘lov</button>`:''}</div></td></tr>`;
  }).join('');$('empty').hidden=orders.length>0;updateDraftBar();
}
async function loadOrders(){
  const params=new URLSearchParams({from:$('from').value,to:$('to').value,agent:$('agent-filter').value,product:$('product-filter').value});
  const data=await api('/api/orders?'+params);orders=data.orders;
  const agent=$('agent-filter').value,product=$('product-filter').value;
  $('agent-filter').innerHTML='<option value="">Barcha agentlar</option>'+data.agents.map(a=>`<option value="${escape(a.id)}">${escape(a.name)}</option>`).join('');$('agent-filter').value=agent;
  $('product-filter').innerHTML='<option value="">Barcha mahsulotlar</option>'+data.products.map(p=>`<option>${escape(p)}</option>`).join('');$('product-filter').value=product;
  $('today-orders').textContent=data.summary.todayOrders;$('today-clients').textContent=`${data.summary.todayClients} mijoz · tanlangan filtrda`;
  $('order-count').textContent=data.summary.count;$('current-debt').textContent=money(data.summary.debtMinor);$('historical-debt').textContent=money(data.summary.historicalMinor);
  $('historical-label').textContent=`${data.to} yakunidagi qoldiq · UZS`;renderOrders();
}
async function loadRequests(){
  requests=await api('/api/requests');$('pending-count').textContent=requests.filter(r=>r.status==='pending').length;
  $('requests-body').innerHTML=requests.map(r=>`<tr><td>${escape(r.source_order_id)}</td><td>${escape(r.client_name)}</td><td class="numeric">${money(r.amount_minor)}</td><td>${escape(splitLabel(r))}</td><td><span class="status ${escape(r.status)}">${labels[r.status]}</span></td><td>${actor.role==='admin'&&r.status==='pending'?`<button data-approve="${escape(r.id)}">Tasdiqlash</button> <button data-action="reject" data-id="${escape(r.id)}">Rad etish</button>`:'—'}</td></tr>`).join('');$('requests-empty').hidden=requests.length>0;
}
async function enter(){
  actor=await api('/api/me');$('identity').textContent=actor.role==='admin'?'Admin / Buxgalter':'Agent';
  $('scope-label').textContent=actor.role==='agent'?'Mening buyurtmalarim va barcha davrlar tarixi':'Barcha agentlar bo‘yicha hisob-kitob';
  document.body.classList.toggle('agent-mode',actor.role==='agent');$('import-nav').hidden=actor.role!=='admin';
  $('draft-help').textContent=actor.role==='admin'?'To‘lov va izohlarni qatorlarda kiriting. Saqlashgacha database o‘zgarmaydi.':'Har bir to‘lov so‘rovi aniq buyurtmaga bog‘lanadi.';
  $('to').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  $('from').value='2000-01-01';
  await Promise.all([loadOrders(),loadRequests()]);$('login').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;
  $('environment').textContent=config.demo?'Lokal namuna':'MEZON';message(config.demo?'Lokal namuna: sun’iy ma’lumotlar. To‘lovlar shu kompyuterdagi namuna bazasiga saqlanadi.':'');
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(!['demo','view','close','history','request','approve'].some(key=>button.dataset[key]))return;
  if(busy)return;
  let managesBusy=false;
  try{
    if(button.dataset.demo){token=button.dataset.demo;await enter();}
    if(button.dataset.view){document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===button));for(const name of ['orders','requests','import','clients','ranking','closing','audit','users','backup'])$(`${name}-view`).hidden=name!==button.dataset.view;}
    if(button.dataset.close)$(button.dataset.close).close();
    if(button.dataset.history){
      const data=await api(`/api/orders/${button.dataset.history}/history`);$('history-title').textContent=`${data.order.source_order_id} — barcha tarix`;
      $('history-content').innerHTML=`<p>Asl summa: <strong>${money(data.order.original_minor)} UZS</strong></p><table><thead><tr><th>Sana</th><th>Amal</th><th>Summa</th><th>Kassa</th></tr></thead><tbody>${data.ledger.map(l=>`<tr><td>${escape(l.effective_date)}</td><td>${escape({opening:'Boshlang‘ich qarz',payment:'Tasdiqlangan to‘lov',reversal:'To‘lov bekor qilindi',return:'Qaytarish',refund:'Pul qaytarildi'}[l.kind])}${actor.role==='admin'&&l.kind==='payment'&&!l.reversed?` <button data-action="correct" data-id="${escape(l.payment_id)}">Tuzatish</button>`:''}</td><td class="numeric">${money(l.amount_minor)}</td><td>${escape(splitLabel(l))}</td></tr>`).join('')}</tbody></table>${actor.role==='admin'?`<button data-action="return" data-id="${escape(data.order.id)}">Mahsulot qaytarish</button>`:''}`;$('history-dialog').showModal();
    }
    if(button.dataset.request){if(requestAttempt){$('request-dialog').showModal();message('Oldingi so‘rov natijasi noma’lum. Avval uni qayta yuborib tekshiring.',true);return;}const o=orders.find(o=>o.id===button.dataset.request);$('request-form').reset();$('request-form').elements.orderId.value=o.id;$('request-order-label').textContent=`${o.source_order_id} · ${o.client_name} · qoldiq ${money(o.debt_minor)} UZS`;$('request-dialog').showModal();}
    if(button.dataset.approve){
      if(drafts.size)throw new Error('Avval jadvaldagi o‘zgarishlarni saqlang yoki bekor qiling.');
      managesBusy=true;disableBusy(true);const id=button.dataset.approve;
      if(!approvalKeys.has(id))approvalKeys.set(id,crypto.randomUUID());
      await post(`/api/requests/${id}/approve`,{operationId:approvalKeys.get(id)});approvalKeys.delete(id);
      await Promise.all([loadOrders(),loadRequests()]);message('To‘lov tasdiqlandi. Qarz yangilandi.');
    }
  }catch(error){message(error.message,true);}finally{if(managesBusy)disableBusy(false);}
});
$('orders-body').addEventListener('input',event=>{
  const field=event.target.dataset.field;if(!field)return;
  const tr=event.target.closest('tr'),o=orders.find(o=>o.id===tr.dataset.id);
  drafts=editDraft(drafts,o,field,event.target.value);pendingSave=null;tr.classList.toggle('dirty',drafts.has(o.id));
  const amount=draftTotal(drafts.get(o.id));const valid=Number.isFinite(amount);
  tr.querySelector('[data-debt]').textContent=valid?money(o.debt_minor-amount):'Summa noto‘g‘ri';updateDraftBar();
});
$('cancel').onclick=()=>{drafts.clear();pendingSave=null;renderOrders();message('Saqlanmagan o‘zgarishlar bekor qilindi.');};
$('save').onclick=async()=>{
  disableBusy(true);
  try{pendingSave ||= {operationId:crypto.randomUUID(),changes:changesPayload(drafts)};await post('/api/changes',pendingSave);drafts.clear();pendingSave=null;await loadOrders();message('O‘zgarishlar saqlandi. To‘lovlar tasdiqlandi.');}
  catch(error){
    if(error.status && error.status<500)pendingSave=null;
    message(error.message+(pendingSave?' Natija hali noma’lum. Qayta tekshirish uchun Save Changes ni bosing; ayni kalit saqlanadi.':''),true);
  }finally{disableBusy(false);}
};
$('filters').onsubmit=async e=>{e.preventDefault();if(drafts.size)return;try{await loadOrders();}catch(error){message(error.message,true);}};
$('request-form').onsubmit=async e=>{
  e.preventDefault();const data=Object.fromEntries(new FormData(e.target));disableBusy(true);
  try{
    requestAttempt ||= {body:{orderId:data.orderId,splits:['cash','card','bank'].filter(m=>data[m]&&Number(data[m])!==0).map(m=>({method:m,amount:data[m]})),operationId:crypto.randomUUID()}};
    await post('/api/requests',requestAttempt.body);requestAttempt=null;$('request-dialog').close();await loadRequests();message('So‘rov yuborildi. Qarz admin tasdig‘ini kutmoqda.');
  }catch(error){if(error.status&&error.status<500)requestAttempt=null;message(error.message+(requestAttempt?' Natija noma’lum; ayni so‘rovni qayta yuborib tekshiring.':''),true);}finally{disableBusy(false);}
};
$('login-form').onsubmit=async e=>{
  e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;
  try{
    await post('/api/auth/login',Object.fromEntries(new FormData(e.target)));token=null;e.target.reset();await enter();
  }catch(error){token=null;message(error.message,true);}finally{button.disabled=false;}
};
$('logout').onclick=async()=>{
  if(busy)return;if(drafts.size){message('Avval o‘zgarishlarni saqlang yoki bekor qiling.',true);return;}
  if(!config.demo)await post('/api/auth/logout',{}).catch(()=>{});
  token=null;actor=null;orders=[];requests=[];location.reload();
};
window.addEventListener('beforeunload',event=>{if(drafts.size){event.preventDefault();event.returnValue='';}});
try{config=await api('/api/config');$('demo-login').hidden=!config.demo;$('login-form').hidden=!!config.demo;}catch(error){message(error.message,true);}

function splitLabel(row){const parts=JSON.parse(row.splits_json||'[]');return parts.length?parts.map(p=>labels[p.method]+': '+money(p.amountMinor)).join(' / '):(labels[row.method]||'—');}
installExtras({api,post,message,escape,money,getActor:()=>actor,getOrders:()=>orders,hasDrafts:()=>drafts.size>0,reload:async()=>{await Promise.all([loadOrders(),loadRequests()]);}});
if(!config?.demo){try{await enter();}catch{}}
