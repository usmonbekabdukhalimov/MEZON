export function editDraft(drafts, order, field, value) {
  const next=new Map(drafts);
  const draft={...(next.get(order.id)||{orderId:order.id,version:order.version,note:order.note,amount:'',method:'cash'})};
  draft[field]=value;
  if(draft.note===order.note && draft.amount==='' && draft.method==='cash' && !['cash','card','bank'].some(m=>draft[m])) next.delete(order.id); else next.set(order.id,draft);
  return next;
}
export function changesPayload(drafts) {
  return [...drafts.values()].map(d=>({orderId:d.orderId,version:d.version,note:d.note,...(d.amount?{payment:{amount:d.amount,method:d.method}}:{}),...(['cash','card','bank'].some(m=>d[m])?{splits:['cash','card','bank'].filter(m=>d[m]&&Number(d[m])!==0).map(m=>({method:m,amount:d[m]}))}:{})}));
}
export function draftTotal(d){return ['cash','card','bank'].reduce((sum,m)=>sum+(d?.[m]?(/^\d+(\.\d{1,2})?$/.test(d[m])?Math.round(Number(d[m])*100):NaN):0),d?.amount?Math.round(Number(d.amount)*100):0);}
