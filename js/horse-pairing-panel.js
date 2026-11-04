/* MDR V54.0.103 – Verpaarungen direkt auf der Pferdeseite.
   Der zentrale Verpaarungslog bleibt Historie/Gesamtübersicht; die eigentliche
   Fohlenzuordnung kann hier am Pferd erledigt werden. */

function hppEsc(value) {
  return typeof plannerEscape === 'function' ? plannerEscape(value) : String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function hppNorm(value) {
  return typeof plannerNorm === 'function' ? plannerNorm(value) : String(value||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('de');
}
function hppParents(horse) {
  if (typeof bpParentNames === 'function') {
    const p=bpParentNames(horse); return {sire:String(p?.fatherName||'').trim(),dam:String(p?.motherName||'').trim()};
  }
  const rows=Array.isArray(horse?.pedigree)?horse.pedigree.slice(1):(horse?.pedigree?.ancestors||[]);
  return {sire:String(rows?.[0]?.name||rows?.[0]||'').trim(),dam:String(rows?.[1]?.name||rows?.[1]||'').trim()};
}
function hppSameParents(pairing,parents) {
  return !!parents.sire && !!parents.dam && hppNorm(pairing?.stallion)===hppNorm(parents.sire) && hppNorm(pairing?.mare)===hppNorm(parents.dam);
}
function hppDate(value) {
  const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})/); return m?`${m[3]}.${m[2]}.${m[1]}`:'–';
}
function hppSnapshot(horse) {
  if (typeof foalActualMetricSnapshot !== 'function') return null;
  return {name:horse?.name||null,...foalActualMetricSnapshot(horse),captured_at:new Date().toISOString()};
}
async function hppLink(pairing,horse) {
  const now=new Date().toISOString();
  const oldReferenceId=pairing?.foal_reference_id ?? null;
  await localUpdate(LOCAL_STORES.pairings,pairing.id,{
    foal_horse_id:horse.id, foal_reference_id:null, foal_name:horse.name||null,
    actual_foal_snapshot:hppSnapshot(horse), foal_recorded_at:pairing.foal_recorded_at||now, updated_at:now,
  });
  if (oldReferenceId!=null && LOCAL_STORES.foalReferenceData) await localDelete(LOCAL_STORES.foalReferenceData,oldReferenceId).catch(()=>{});
}
async function hppCreate(horse,parents) {
  const now=new Date().toISOString();
  return localAdd(LOCAL_STORES.pairings,{
    user_id:horse?.user_id||null, owner:horse?.owner||null, stallion:parents.sire, mare:parents.dam,
    pairing_date:String(horse?.birthdate||'').slice(0,10)||null, keep_foal:null,
    notes:'🐴 Nachträglich auf der Pferdeseite aus dem Fohlen angelegt.', prediction_snapshot:null,
    foal_horse_id:horse.id, foal_reference_id:null, foal_name:horse.name||null,
    actual_foal_snapshot:hppSnapshot(horse), foal_recorded_at:now, created_at:now, updated_at:now,
  });
}
function hppHistoryHtml(horse,pairings) {
  const own=(pairings||[]).filter(p=>hppNorm(p?.mare)===hppNorm(horse?.name)||hppNorm(p?.stallion)===hppNorm(horse?.name));
  if (!own.length) return '';
  own.sort((a,b)=>String(b?.pairing_date||'').localeCompare(String(a?.pairing_date||'')));
  const rows=own.slice(0,12).map(p=>{
    const isMare=hppNorm(p.mare)===hppNorm(horse.name);
    const partner=isMare?p.stallion:p.mare;
    const foal=p.foal_name||p.actual_foal_snapshot?.name||'noch kein Fohlen verknüpft';
    const foalLink=p.foal_horse_id!=null?`<a href="${mdrRoute('view',{id:p.foal_horse_id})}">${hppEsc(foal)}</a>`:hppEsc(foal);
    return `<div class="horse-pairing-history-row"><span>${hppEsc(hppDate(p.pairing_date))}</span><strong>${hppEsc(partner||'–')}</strong><span>${foalLink}</span></div>`;
  }).join('');
  return `<details class="horse-pairing-history"><summary><strong>Eigene Verpaarungshistorie (${own.length})</strong><span class="small muted">Partner · Fohlen</span></summary><div class="horse-pairing-history-list">${rows}${own.length>12?`<div class="tiny muted">+ ${own.length-12} weitere in der Verpaarungshistorie</div>`:''}</div></details>`;
}
async function renderHorsePairingPanel(horse) {
  const root=document.getElementById('horse-pairing-panel');
  if (!root) return;
  const pairings=await localGetAll(LOCAL_STORES.pairings).catch(()=>[]);
  const parents=hppParents(horse);
  const linked=(pairings||[]).find(p=>p?.foal_horse_id!=null && String(p.foal_horse_id)===String(horse?.id));
  const candidates=(pairings||[]).filter(p=>hppSameParents(p,parents) && (p.foal_horse_id==null || String(p.foal_horse_id)===String(horse?.id)));
  candidates.sort((a,b)=>{
    const ae=String(a?.pairing_date||'').slice(0,10)===String(horse?.birthdate||'').slice(0,10)?0:1;
    const be=String(b?.pairing_date||'').slice(0,10)===String(horse?.birthdate||'').slice(0,10)?0:1;
    return ae-be || String(b?.pairing_date||'').localeCompare(String(a?.pairing_date||''));
  });

  let origin='';
  if (linked) {
    origin=`<div class="horse-pairing-status horse-pairing-linked"><span class="horse-status-chip horse-status-good">✓ zugeordnet</span><div><strong>${hppEsc(linked.stallion||parents.sire)} × ${hppEsc(linked.mare||parents.dam)}</strong><div class="small muted">Verpaarung vom ${hppEsc(hppDate(linked.pairing_date))}</div></div></div>`;
  } else if (parents.sire && parents.dam && candidates.length) {
    const options=candidates.map(p=>`<option value="${hppEsc(p.id)}">${hppEsc(hppDate(p.pairing_date))} · ${hppEsc(p.stallion)} × ${hppEsc(p.mare)}</option>`).join('');
    origin=`<div class="horse-pairing-origin"><div><strong>Passende Eltern-Verpaarung gefunden</strong><div class="small muted">${hppEsc(parents.sire)} × ${hppEsc(parents.dam)}</div></div><div class="horse-pairing-action-row"><select id="horse-pairing-candidate">${options}</select><button type="button" id="horse-pairing-link-btn">Verpaarung zuordnen</button></div></div>`;
  } else if (parents.sire && parents.dam) {
    origin=`<div class="horse-pairing-origin"><div><strong>Noch keine passende Verpaarung in der Historie</strong><div class="small muted">${hppEsc(parents.sire)} × ${hppEsc(parents.dam)}${horse?.birthdate?` · Fohlen ${hppEsc(hppDate(horse.birthdate))}`:''}</div></div><button type="button" id="horse-pairing-create-btn" class="secondary">Verpaarung nachträglich anlegen</button></div>`;
  } else {
    origin='<p class="small muted">Für eine Fohlenzuordnung müssen Vater und Mutter im Stammbaum bekannt sein.</p>';
  }
  root.innerHTML=`${origin}${hppHistoryHtml(horse,pairings)}`;

  document.getElementById('horse-pairing-link-btn')?.addEventListener('click',async e=>{
    const id=document.getElementById('horse-pairing-candidate')?.value;
    const pairing=candidates.find(p=>String(p.id)===String(id));
    if (!pairing) return;
    e.currentTarget.disabled=true;
    try { await hppLink(pairing,horse); await renderHorsePairingPanel(horse); }
    catch(error){ e.currentTarget.disabled=false; root.insertAdjacentHTML('afterbegin',`<p class="error">Zuordnung fehlgeschlagen: ${hppEsc(error.message)}</p>`); }
  });
  document.getElementById('horse-pairing-create-btn')?.addEventListener('click',async e=>{
    e.currentTarget.disabled=true;
    try { await hppCreate(horse,parents); await renderHorsePairingPanel(horse); }
    catch(error){ e.currentTarget.disabled=false; root.insertAdjacentHTML('afterbegin',`<p class="error">Verpaarung konnte nicht angelegt werden: ${hppEsc(error.message)}</p>`); }
  });
}
