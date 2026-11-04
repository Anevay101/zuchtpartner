/* MDR V54.0.99 – Jungpferde-Planer
   Ziel: ausgewählte Jungpferde gemeinsam priorisieren, Top-3-Qualifikation
   und ZS-Reife trennen sowie maximal zwei sinnvolle Meldungen je Disziplin
   vorschlagen. Keine undurchsichtige Mischpunktzahl: Turnierstärkeklasse,
   strategische A/B/C/D-Klasse und Rohwert bleiben getrennt sichtbar. */
(() => {
  'use strict';

  const STORAGE_SELECTION='mdr_younghorse_selection_v1';
  const CLASS_META={
    A:{rank:4,label:'A · Fast Track',short:'Fast Track',icon:'🔥',hint:'Turnier stark · ZS günstig'},
    B:{rank:3,label:'B · Qualifikation mitnehmen',short:'Qualifikation mitnehmen',icon:'🏇',hint:'Turnier stark · ZS anschließend aufwendiger'},
    C:{rank:2,label:'C · Früh parallel',short:'Früh parallel',icon:'⏳',hint:'Turnier ist der Flaschenhals · ZS günstig'},
    D:{rank:1,label:'D · Restkapazität',short:'Restkapazität nutzen',icon:'🌱',hint:'Turnier und ZS aufwendiger'},
    U:{rank:0,label:'Daten prüfen',short:'Daten prüfen',icon:'⚪',hint:'Turnier- oder ZS-Einordnung unvollständig'},
  };
  const BAND_META={
    4:{label:'sehr stark',cls:'very-strong'},
    3:{label:'gut',cls:'good'},
    2:{label:'durchschnittlich',cls:'average'},
    1:{label:'eher schwach',cls:'weak'},
    0:{label:'schwach / offen',cls:'poor'},
  };

  let selectedIds=new Set();
  let currentPlan=null;
  let initialized=false;

  function t(de,en){
    if (typeof window.mdrT==='function') return window.mdrT(de,en || de);
    return de;
  }
  function esc(v){ return typeof plannerEscape==='function' ? plannerEscape(v) : String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function norm(v){ return String(v??'').trim().toLocaleLowerCase('de'); }
  function idOf(h){ return String(h?.id ?? h?.external_id ?? h?.name ?? ''); }
  function younghorseAge(horse){
    if (!horse?.birthdate || typeof gameAgeYearsMonths!=='function') return null;
    return gameAgeYearsMonths(horse.birthdate);
  }
  function younghorseAgeEligible(horse){
    const age=younghorseAge(horse);
    if (!age) return false;
    return age.years>2 || (age.years===2 && age.months>=6);
  }
  function activePool(){
    const rows=Array.isArray(TP_HORSES) ? TP_HORSES : [];
    return rows.filter(h => {
      if (!younghorseAgeEligible(h)) return false;
      if (h?.breeding_allowed===true) return false;
      return typeof plannerBreedingShowPoints!=='function' || plannerBreedingShowPoints(h)==null;
    });
  }
  function pruneSelectionToActivePool(){
    const valid=new Set(activePool().map(idOf));
    const next=new Set([...selectedIds].filter(id=>valid.has(id)));
    if (next.size===selectedIds.size && [...next].every(id=>selectedIds.has(id))) return false;
    selectedIds=next;
    saveSelection();
    return true;
  }
  function saveSelection(){
    try { localStorage.setItem(STORAGE_SELECTION, JSON.stringify([...selectedIds])); } catch {}
  }
  function loadSelection(){
    try {
      const raw=JSON.parse(localStorage.getItem(STORAGE_SELECTION) || '[]');
      if (Array.isArray(raw)) selectedIds=new Set(raw.map(String));
    } catch { selectedIds=new Set(); }
    pruneSelectionToActivePool();
  }
  function horseById(id){ return (TP_ALL_HORSES || []).find(h=>idOf(h)===String(id)) || null; }

  function knownTop3(horse){
    try {
      const rows=typeof plannerTournamentResults==='function' ? plannerTournamentResults(horse) : {};
      return Object.values(rows || {}).some(row => Number(row?.first||0)+Number(row?.second||0)+Number(row?.third||0)>0);
    } catch { return false; }
  }
  function manualTop3(horse){ return horse?.younghorse_top3_qualified === true; }
  function isQualified(horse){ return knownTop3(horse) || manualTop3(horse); }

  function tournamentModel(horse){
    try {
      return typeof plannerTournamentModelForHorse==='function'
        ? plannerTournamentModelForHorse(horse,TP_TOURNAMENT_REFERENCES_BY_SERVER,TP_ALL_HORSES,tournamentScore)
        : TP_TOURNAMENT_REFERENCES;
    } catch { return TP_TOURNAMENT_REFERENCES; }
  }

  function bandRank(score){
    const n=Number(score);
    if (!Number.isFinite(n)) return 0;
    if (n>=80) return 4;
    if (n>=65) return 3;
    if (n>=45) return 2;
    if (n>=25) return 1;
    return 0;
  }

  function tournamentRow(horse,discipline){
    const evalRow=typeof tournamentScore==='function' ? tournamentScore(horse,discipline) : null;
    if (!evalRow || evalRow.complete===false || !Number.isFinite(Number(evalRow.points))) return null;
    const model=tournamentModel(horse);
    const relative=typeof plannerTournamentRelative==='function' ? plannerTournamentRelative(evalRow,model) : {percentile:null};
    const rec=typeof plannerTournamentRecommendationScore==='function'
      ? plannerTournamentRecommendationScore(evalRow,relative?.percentile,model)
      : {score:relative?.percentile ?? null};
    const score=Number.isFinite(Number(rec?.score)) ? Number(rec.score) : null;
    return {
      horse,discipline,group:evalRow.group || MDR_TOURNAMENT_DISCIPLINES?.[discipline]?.group || '',
      points:Number(evalRow.points),lk:evalRow.lk || '',percentile:relative?.percentile ?? null,
      recommendationScore:score,band:bandRank(score),isMainGroup:false,
    };
  }

  function consideredDisciplines(horse){
    const mainGroup=typeof plannerHorseMainGroup==='function' ? plannerHorseMainGroup(horse) : null;
    const mainNames=mainGroup && MDR_TOURNAMENT_GROUPS?.[mainGroup] ? [...MDR_TOURNAMENT_GROUPS[mainGroup]] : [];
    const mainRows=mainNames.map(d=>tournamentRow(horse,d)).filter(Boolean).map(r=>({...r,isMainGroup:true}));
    const mainSet=new Set(mainNames);
    const extraRows=Object.keys(MDR_TOURNAMENT_DISCIPLINES || {})
      .filter(d=>!mainSet.has(d))
      .map(d=>tournamentRow(horse,d))
      .filter(Boolean)
      .sort((a,b)=>b.points-a.points || (b.recommendationScore??-1)-(a.recommendationScore??-1) || a.discipline.localeCompare(b.discipline,'de'))
      .slice(0,4);
    if (mainRows.length) return [...mainRows,...extraRows];
    return Object.keys(MDR_TOURNAMENT_DISCIPLINES || {})
      .map(d=>tournamentRow(horse,d)).filter(Boolean)
      .sort((a,b)=>b.points-a.points || (b.recommendationScore??-1)-(a.recommendationScore??-1))
      .slice(0,4);
  }

  function zsProfile(horse){
    const model=TP_ZS_MODEL;
    const predicted=model?.predict ? model.predict(horse) : null;
    const benchmark=window.MDR_BREEDING_SHOW_BENCHMARK?.getBenchmarkForHorse?.(horse) || null;
    const rawAssessment=window.MDR_BREEDING_SHOW_BENCHMARK?.assessHorseForecast?.(horse,predicted,benchmark) || null;
    const assumedTop3Bonus=manualTop3(horse) && !knownTop3(horse) ? 15 : 0;
    let assessment=rawAssessment ? {...rawAssessment} : null;
    if (assessment && assumedTop3Bonus && Number.isFinite(Number(assessment.gap))) {
      assessment.gap=Math.max(0,Number(assessment.gap)-assumedTop3Bonus);
      assessment.remainingTournamentBonus=Math.max(0,Number(assessment.remainingTournamentBonus||500)-assumedTop3Bonus);
      assessment.extraCupStars=assessment.gap>assessment.remainingTournamentBonus
        ? Math.max(1,Math.ceil((assessment.gap-assessment.remainingTournamentBonus)/100)) : 0;
      assessment.status=assessment.extraCupStars ? 'red' : (assessment.gap>200 ? 'yellow' : 'green');
    }
    const gap=Number.isFinite(Number(assessment?.gap)) ? Number(assessment.gap) : null;
    const target=Number.isFinite(Number(benchmark?.qualifyingMedian)) ? Number(benchmark.qualifyingMedian) : null;
    const base=Number.isFinite(Number(predicted)) ? Number(predicted) : null;
    const good=assessment?.status==='green' ? true : (assessment?.status==='yellow' || assessment?.status==='red' ? false : null);
    return {predictedBase:base,benchmark,target,assessment,gap,good,assumedTop3Bonus};
  }

  function findParentRecord(horse){
    const ancestors=Array.isArray(horse?.pedigree) ? horse.pedigree.slice(1) : (horse?.pedigree?.ancestors || []);
    const gender=typeof plannerGender==='function' ? plannerGender(horse) : norm(horse?.gender);
    const parentIndex=gender==='stute' ? 1 : (gender==='hengst' || gender==='wallach' ? 0 : null);
    if (parentIndex==null) return {name:'',horse:null};
    const name=String(ancestors[parentIndex]?.name || '').trim();
    if (!name) return {name:'',horse:null};
    const key=norm(name);
    const matches=(TP_ALL_HORSES || []).filter(h=>norm(h?.name)===key);
    if (matches.length===1) return {name,horse:matches[0]};
    const sameServer=matches.find(h=>typeof mdrGameWorld==='function' && mdrGameWorld(h,'')===mdrGameWorld(horse,''));
    return {name,horse:sameServer || matches[0] || null};
  }

  function parentDelta(horse){
    const parent=findParentRecord(horse);
    const hs=typeof plannerStats==='function' ? plannerStats(horse) : {};
    const ps=parent.horse && typeof plannerStats==='function' ? plannerStats(parent.horse) : {};
    const gp=Number.isFinite(Number(hs?.gp)) && Number.isFinite(Number(ps?.gp)) ? Number(hs.gp)-Number(ps.gp) : null;
    const extpct=Number.isFinite(Number(hs?.extpct)) && Number.isFinite(Number(ps?.extpct)) ? Number(hs.extpct)-Number(ps.extpct) : null;
    return {parentName:parent.name,parentHorse:parent.horse,gp,extpct};
  }

  function horseProfile(horse){
    const disciplines=consideredDisciplines(horse);
    const sortBest=(rows)=>rows.slice().sort((a,b)=>(b.recommendationScore??-1)-(a.recommendationScore??-1) || b.points-a.points)[0] || null;
    const mainDisciplines=disciplines.filter(r=>r.isMainGroup);
    const secondaryDisciplines=disciplines.filter(r=>!r.isMainGroup);
    const bestMain=sortBest(mainDisciplines);
    const bestOverall=sortBest(disciplines);
    // Für die strategische Klasse zählt die realistisch trainierte Hauptbegabung.
    // Nur wenn keine Hauptgruppe erkannt werden kann, fällt der Planer auf den besten bekannten Wert zurück.
    const best=bestMain || bestOverall;
    const bestScore=best?.recommendationScore ?? null;
    const tournamentStrong=bestScore==null ? null : bestScore>=65;
    const zs=zsProfile(horse);
    let cls='U';
    if (tournamentStrong!==null && zs.good!==null) {
      cls=tournamentStrong ? (zs.good?'A':'B') : (zs.good?'C':'D');
    }
    const qualified=isQualified(horse);
    const stats=typeof plannerStats==='function' ? plannerStats(horse) : {};
    const parent=parentDelta(horse);
    return {horse,id:idOf(horse),qualified,knownTop3:knownTop3(horse),manualTop3:manualTop3(horse),disciplines,mainDisciplines,secondaryDisciplines,best,bestMain,bestOverall,bestScore,tournamentStrong,zs,cls,stats,parent,mainGroup:plannerHorseMainGroup?.(horse)||''};
  }

  function planProfiles(){
    pruneSelectionToActivePool();
    const validIds=new Set(activePool().map(idOf));
    const horses=[...selectedIds].filter(id=>validIds.has(String(id))).map(horseById).filter(Boolean);
    const profiles=horses.map(horseProfile);
    const unqualified=profiles.filter(p=>!p.qualified).sort((a,b)=>{
      const cr=(CLASS_META[b.cls]?.rank||0)-(CLASS_META[a.cls]?.rank||0); if(cr) return cr;
      const br=(b.best?.band||0)-(a.best?.band||0); if(br) return br;
      const sr=(b.bestScore??-1)-(a.bestScore??-1); if(sr) return sr;
      const zg=(a.zs.gap??Infinity)-(b.zs.gap??Infinity); if(zg) return zg;
      return (a.horse.name||'').localeCompare(b.horse.name||'','de');
    });
    const qualified=profiles.filter(p=>p.qualified).sort((a,b)=>{
      const gap=(a.zs.gap??Infinity)-(b.zs.gap??Infinity); if(gap) return gap;
      const base=(b.zs.predictedBase??-Infinity)-(a.zs.predictedBase??-Infinity); if(base) return base;
      return (a.horse.name||'').localeCompare(b.horse.name||'','de');
    });
    const entriesMain=buildAssignments(unqualified,'main');
    const entriesAll=buildAssignments(unqualified,'all');
    return {profiles,unqualified,qualified,entries:entriesMain,entriesMain,entriesAll,createdAt:new Date()};
  }

  function buildAssignments(unqualified,mode='all'){
    const byDiscipline=new Map();
    for (const profile of unqualified) {
      for (const row of profile.disciplines) {
        if (mode==='main' && !row.isMainGroup) continue;
        if (mode==='secondary' && row.isMainGroup) continue;
        if (!byDiscipline.has(row.discipline)) byDiscipline.set(row.discipline,[]);
        byDiscipline.get(row.discipline).push({...row,profile,classRank:CLASS_META[profile.cls]?.rank||0});
      }
    }
    const groupOrder=new Map((MDR_TOURNAMENT_GROUP_ORDER || []).map((g,i)=>[g,i]));
    const out=[];
    for (const [discipline,candidates] of byDiscipline) {
      candidates.sort((a,b)=>{
        const band=b.band-a.band; if(band) return band;
        const cls=b.classRank-a.classRank; if(cls) return cls;
        const score=(b.recommendationScore??-1)-(a.recommendationScore??-1); if(score) return score;
        const pts=b.points-a.points; if(pts) return pts;
        return (a.horse.name||'').localeCompare(b.horse.name||'','de');
      });
      const selected=candidates.slice(0,2).map((c,index)=>({
        ...c,slot:index+1,
        slotType:c.band>=2 && c.profile.cls!=='D' ? 'priority' : (c.band>=2 ? 'sensible' : 'free'),
      }));
      const waiting=candidates.slice(2);
      out.push({discipline,group:MDR_TOURNAMENT_DISCIPLINES?.[discipline]?.group || '',selected,waiting});
    }
    out.sort((a,b)=>(groupOrder.get(a.group)??99)-(groupOrder.get(b.group)??99) || a.discipline.localeCompare(b.discipline,'de'));
    return out;
  }

  function formatSigned(n,digits=0,suffix=''){
    if (!Number.isFinite(Number(n))) return '–';
    const v=Number(n); return `${v>0?'+':''}${v.toFixed(digits).replace('.',',')}${suffix}`;
  }
  function formatNum(n,digits=0){
    if (!Number.isFinite(Number(n))) return '–';
    return Number(n).toLocaleString('de-DE',{minimumFractionDigits:digits,maximumFractionDigits:digits});
  }
  function zsGapText(profile){
    const a=profile.zs.assessment;
    if (!a || profile.zs.gap==null) return '–';
    if (a.gap<=0) return '0 · Schwelle erreicht';
    if (a.status==='red' && a.extraCupStars) return `~${Math.round(a.gap)} P. · ${a.extraCupStars} Cup-Stern${a.extraCupStars===1?'':'e'}`;
    return `~${Math.round(a.gap)} P.`;
  }
  function top3Label(profile){
    if (profile.knownTop3) return '<span class="yhp-top3-known">✓ aus Erfolgen</span>';
    if (profile.manualTop3) return '<span class="yhp-top3-manual">✓ bestätigt</span>';
    return '<span class="muted">offen</span>';
  }

  function filteredPickerRows(){
    const q=norm(document.getElementById('yhp-search')?.value);
    const owner=document.getElementById('yhp-owner')?.value || '';
    const breed=document.getElementById('yhp-breed')?.value || '';
    const group=document.getElementById('yhp-group')?.value || '';
    return activePool().filter(h=>{
      if(q && !norm(h.name).includes(q)) return false;
      if(owner && h.owner!==owner) return false;
      if(breed && (normalizeBreed?.(h.breed)||h.breed||'')!==breed) return false;
      if(group && (plannerHorseMainGroup?.(h)||'')!==group) return false;
      return true;
    });
  }

  function refreshPickerFilters(){
    const rows=activePool();
    const owners=[...new Set(rows.map(h=>h.owner).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de'));
    const breeds=[...new Set(rows.map(h=>normalizeBreed?.(h.breed)||h.breed).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de'));
    const setOptions=(id,vals,label)=>{
      const el=document.getElementById(id); if(!el)return;
      const old=el.value;
      el.innerHTML=`<option value="">${esc(label)}</option>`+vals.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
      if([...el.options].some(o=>o.value===old)) el.value=old;
    };
    setOptions('yhp-owner',owners,t('Alle','All'));
    setOptions('yhp-breed',breeds,t('Alle','All'));
    setOptions('yhp-group',MDR_TOURNAMENT_GROUP_ORDER || [],t('Alle','All'));
  }

  function renderPoolSummary(){
    const root=document.getElementById('yhp-pool-summary'); if(!root)return;
    const rows=activePool();
    const qualified=rows.filter(isQualified).length;
    root.innerHTML=`<span><strong>${rows.length}</strong> verfügbar</span><span><strong>${selectedIds.size}</strong> ausgewählt</span><span><strong>${qualified}</strong> mit Top 3</span><span><strong>${Math.max(0,rows.length-qualified)}</strong> brauchen Top 3</span>`;
  }

  function renderPicker(){
    const body=document.getElementById('yhp-picker-body'); if(!body)return;
    pruneSelectionToActivePool();
    const rows=filteredPickerRows();
    body.innerHTML=rows.length ? rows.map(h=>{
      const id=idOf(h), checked=selectedIds.has(id);
      const group=plannerHorseMainGroup?.(h)||'–';
      const qualified=isQualified(h);
      const age=esc(typeof formatAgeShort==='function' ? formatAgeShort(h.birthdate) : '');
      const meta=[h.owner||'',normalizeBreed?.(h.breed)||h.breed||'',age].filter(Boolean).map(esc).join(' · ');
      return `<tr class="${checked?'yhp-picked':''}">
        <td class="yhp-check-col"><input type="checkbox" class="yhp-pick" data-yhp-id="${esc(id)}" ${checked?'checked':''} aria-label="${esc(h.name||'Pferd')} auswählen"></td>
        <td><a href="${mdrRoute('view',{id:h.id})}"><strong>${esc(h.name||'(ohne Name)')}</strong></a>${meta?`<br><span class="tiny muted">${meta}</span>`:''}</td>
        <td>${esc(group)}</td>
        <td>${qualified?'<span class="horse-status-chip horse-status-good">✓</span>':'–'}</td></tr>`;
    }).join('') : '<tr><td colspan="4" class="muted">Keine passenden Pferde.</td></tr>';
    body.querySelectorAll('.yhp-pick').forEach(cb=>cb.addEventListener('change',()=>{
      const id=String(cb.dataset.yhpId||'');
      if(cb.checked) selectedIds.add(id); else selectedIds.delete(id);
      saveSelection(); updateSelectedCount(); renderPicker(); if(currentPlan) renderPlan();
    }));
    updateSelectedCount();
  }

  function updateSelectedCount(){
    const el=document.getElementById('yhp-selected-count'); if(el)el.textContent=String(selectedIds.size);
    const btn=document.getElementById('yhp-build-plan'); if(btn)btn.disabled=selectedIds.size===0;
    renderPoolSummary();
  }

  function renderStatusTable(plan){
    const body=document.getElementById('yhp-status-body'); if(!body)return;
    body.innerHTML=plan.profiles.map(p=>{
      const meta=CLASS_META[p.cls]||CLASS_META.U;
      const manualDisabled=p.knownTop3;
      const check=p.qualified?'checked':'';
      const parentTitle=p.parent.parentName ? ` zum gleichgeschlechtlichen Elternteil ${p.parent.parentName}` : '';
      return `<tr>
        <td><a href="${mdrRoute('view',{id:p.horse.id})}"><strong>${esc(p.horse.name||'(ohne Name)')}</strong></a><br><span class="tiny muted">${esc(p.mainGroup||'Begabung offen')} · ${p.best?`${esc(p.best.discipline)} ${Math.round(p.best.recommendationScore??0)}/100`:'Turnierwert offen'}</span></td>
        <td><label class="yhp-top3-toggle"><input type="checkbox" data-yhp-top3="${esc(p.id)}" ${check} ${manualDisabled?'disabled':''}> <span>${manualDisabled?'aus Erfolgen':'erreicht'}</span></label></td>
        <td>${p.stats.gp==null?'–':`<strong>${formatNum(p.stats.gp,0)}</strong>`}<br><span class="tiny muted" title="${esc(parentTitle)}">Δ ${formatSigned(p.parent.gp,0)}</span></td>
        <td>${p.stats.extpct==null?'–':`<strong>${formatNum(p.stats.extpct,2)} %</strong>`}<br><span class="tiny muted" title="${esc(parentTitle)}">Δ ${formatSigned(p.parent.extpct,2,' %-Pkt.')}</span></td>
        <td>${p.zs.predictedBase==null?'–':`<strong>~${formatNum(p.zs.predictedBase,0)}</strong>`}<br><span class="tiny muted" title="${p.zs.assumedTop3Bonus?'Bei manuell bestätigter Top-3-Platzierung wird vorsichtig der Mindestbonus eines 3. Platzes (15 P.) berücksichtigt.':''}">${esc(zsGapText(p))}</span></td>
        <td><span class="yhp-class yhp-class-${esc(p.cls.toLowerCase())}">${meta.icon} ${esc(meta.label)}</span><br><span class="tiny muted">${esc(meta.hint)}</span></td>
      </tr>`;
    }).join('');
    body.querySelectorAll('[data-yhp-top3]').forEach(cb=>cb.addEventListener('change',async()=>{
      await setManualTop3(cb.dataset.yhpTop3,cb.checked);
    }));
  }

  function renderWorkLists(plan){
    const zs=document.getElementById('yhp-zs-list');
    const qual=document.getElementById('yhp-qual-list');
    if(zs) zs.innerHTML=plan.qualified.length ? plan.qualified.map((p,i)=>{
      const note=p.zs.gap==null?'ZS-Prognose unvollständig':p.zs.gap<=0?'Schätzwert bereits auf/über aktuellem Durchkommensniveau':`${zsGapText(p)} bis zum aktuellen Durchkommensniveau`;
      return `<div class="yhp-work-item"><span class="yhp-rank">${i+1}</span><div><strong>${esc(p.horse.name)}</strong><p>${esc(note)}</p></div></div>`;
    }).join('') : '<p class="muted small">Noch kein ausgewähltes Pferd ist für die Zuchtschau qualifiziert.</p>';
    if(qual) qual.innerHTML=plan.unqualified.length ? plan.unqualified.map((p,i)=>{
      const meta=CLASS_META[p.cls]||CLASS_META.U;
      const discs=p.disciplines.slice().sort((a,b)=>(b.recommendationScore??-1)-(a.recommendationScore??-1)||b.points-a.points).slice(0,3).map(r=>r.discipline).join(' · ');
      return `<div class="yhp-work-item"><span class="yhp-rank">${i+1}</span><div><strong>${esc(p.horse.name)}</strong> <span class="yhp-class yhp-class-${esc(p.cls.toLowerCase())}">${meta.icon} ${esc(meta.short)}</span><p>${esc(meta.hint)}${discs?` · beste Optionen: ${esc(discs)}`:''}</p></div></div>`;
    }).join('') : '<p class="muted small">Alle ausgewählten Pferde haben bereits eine Top-3-Platzierung.</p>';
  }

  function renderEntriesGrid(rootId,entries,showOrigin=false){
    const root=document.getElementById(rootId); if(!root)return;
    if(!entries.length){root.innerHTML='<p class="muted small">Keine auswertbaren Turnieroptionen für die noch nicht qualifizierten Pferde.</p>';return;}
    root.innerHTML=entries.map(row=>{
      const selected=row.selected.map(c=>{
        const type=c.slotType==='priority'?'● Priorität':c.slotType==='sensible'?'○ sinnvoll':'○ freier Platz';
        const band=BAND_META[c.band]||BAND_META[0];
        const origin=showOrigin?` · ${c.isMainGroup?'Haupt':'Neben'}`:'';
        return `<div class="yhp-entry-horse"><span class="yhp-entry-slot">${c.slot}.</span><div><strong>${esc(c.horse.name)}</strong><br><span class="tiny muted">${esc(type)} · ${esc(band.label)}${esc(origin)} · Empfehlung ${c.recommendationScore==null?'–':Math.round(c.recommendationScore)}/100 · Wert ${Math.round(c.points)}${c.lk?` · ${esc(c.lk)}`:''}</span></div></div>`;
      }).join('');
      const waiting=row.waiting.length ? `<details class="yhp-waiting"><summary>${row.waiting.length} weitere Kandidaten</summary><div>${row.waiting.map(c=>`${esc(c.horse.name)}${showOrigin?` · ${c.isMainGroup?'Haupt':'Neben'}`:''} · ${c.recommendationScore==null?'–':Math.round(c.recommendationScore)}/100 · ${Math.round(c.points)}`).join('<br>')}</div></details>`:'';
      return `<article class="yhp-entry-card"><header><strong>${esc(row.discipline)}</strong><span>${esc(row.group)}</span></header>${selected || '<p class="muted small">kein Kandidat</p>'}${waiting}</article>`;
    }).join('');
  }

  function renderEntries(plan){
    renderEntriesGrid('yhp-entry-grid',plan.entriesMain || plan.entries || [],false);
    renderEntriesGrid('yhp-entry-grid-all',plan.entriesAll || plan.entries || [],true);
  }

  function renderSummary(plan){
    const el=document.getElementById('yhp-plan-summary'); if(!el)return;
    const counts={A:0,B:0,C:0,D:0,U:0}; plan.unqualified.forEach(p=>counts[p.cls]=(counts[p.cls]||0)+1);
    el.textContent=`${plan.profiles.length} Pferde · ${plan.qualified.length} ZS-bereit · ${plan.unqualified.length} brauchen Top 3 · A ${counts.A} · B ${counts.B} · C ${counts.C} · D ${counts.D}${counts.U?` · offen ${counts.U}`:''}`;
  }

  function renderPlan(){
    const root=document.getElementById('yhp-results'); if(!root)return;
    if(!selectedIds.size){root.hidden=true;currentPlan=null;return;}
    currentPlan=planProfiles();
    root.hidden=false;
    renderSummary(currentPlan); renderStatusTable(currentPlan); renderWorkLists(currentPlan); renderEntries(currentPlan);
  }

  async function setManualTop3(id,value){
    const horse=horseById(id); if(!horse || knownTop3(horse)) return;
    const saved={...horse,younghorse_top3_qualified:value===true,updated_at:new Date().toISOString()};
    await localPut(LOCAL_STORES.horses,saved);
    const replace=(arr)=>{ const i=arr.findIndex(h=>idOf(h)===String(id)); if(i>=0)arr[i]=saved; };
    replace(TP_ALL_HORSES); replace(TP_HORSES);
    renderPicker(); renderPlan();
  }

  function workPlanText(plan){
    const date=new Intl.DateTimeFormat('de-DE').format(plan.createdAt);
    const lines=[`Jungpferde-Plan – ${date}`,''];
    lines.push('ZUCHTSCHAU JETZT');
    if(!plan.qualified.length) lines.push('- noch kein Pferd qualifiziert');
    plan.qualified.forEach((p,i)=>lines.push(`${i+1}. ${p.horse.name} – ${zsGapText(p)} ZS-Rest`));
    lines.push('','TURNIERQUALIFIKATION');
    if(!plan.unqualified.length) lines.push('- alle ausgewählten Pferde bereits qualifiziert');
    plan.unqualified.forEach((p,i)=>{ const m=CLASS_META[p.cls]||CLASS_META.U; lines.push(`${i+1}. ${p.horse.name} – ${m.short} – ${m.hint}`); });
    return lines.join('\n');
  }

  function entriesText(plan,includeSecondary=false){
    const entries=includeSecondary ? (plan.entriesAll || []) : (plan.entriesMain || plan.entries || []);
    const lines=[includeSecondary?'Turniermeldungen – Jungpferde (inkl. Nebendisziplinen)':'Turniermeldungen – Jungpferde (Hauptdisziplinen)',''];
    for(const row of entries){
      if(!row.selected.length) continue;
      lines.push(`${row.discipline}: ${row.selected.map(c=>c.horse.name).join(', ')}`);
    }
    return lines.join('\n');
  }

  async function copyText(text,statusMessage){
    let ok=false;
    try { if(navigator.clipboard?.writeText){ await navigator.clipboard.writeText(text); ok=true; } } catch {}
    if(!ok){
      const ta=document.createElement('textarea'); ta.value=text; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select();
      try { ok=document.execCommand('copy'); } catch {}
      ta.remove();
    }
    const status=document.getElementById('yhp-copy-status'); if(status)status.textContent=ok?statusMessage:'Kopieren nicht möglich – bitte Text manuell übernehmen.';
  }

  function wire(){
    ['yhp-search'].forEach(id=>document.getElementById(id)?.addEventListener('input',renderPicker));
    ['yhp-owner','yhp-breed','yhp-group'].forEach(id=>document.getElementById(id)?.addEventListener('change',renderPicker));
    document.getElementById('yhp-select-visible')?.addEventListener('click',()=>{ filteredPickerRows().forEach(h=>selectedIds.add(idOf(h))); saveSelection(); renderPicker(); if(currentPlan) renderPlan(); });
    document.getElementById('yhp-clear-selection')?.addEventListener('click',()=>{ selectedIds.clear(); saveSelection(); renderPicker(); document.getElementById('yhp-results').hidden=true; currentPlan=null; });
    document.getElementById('yhp-build-plan')?.addEventListener('click',renderPlan);
    document.getElementById('yhp-copy-work')?.addEventListener('click',()=>{ if(currentPlan)copyText(workPlanText(currentPlan),'Arbeitsplan wurde für die Notizen kopiert.'); });
    document.getElementById('yhp-copy-main-entries')?.addEventListener('click',()=>{ if(currentPlan)copyText(entriesText(currentPlan,false),'Turniermeldungen der Hauptdisziplinen wurden für die Notizen kopiert.'); });
    document.getElementById('yhp-copy-all-entries')?.addEventListener('click',()=>{ if(currentPlan)copyText(entriesText(currentPlan,true),'Alle Turniermeldungen inklusive Nebendisziplinen wurden für die Notizen kopiert.'); });
  }

  function initYounghorsePlanner(){
    if(initialized)return; initialized=true;
    refreshPickerFilters(); loadSelection(); wire(); renderPicker(); updateSelectedCount();
  }
  function renderYounghorsePlanner(){
    if(!initialized) initYounghorsePlanner();
    refreshPickerFilters(); renderPicker(); if(currentPlan)renderPlan();
  }

  window.initYounghorsePlanner=initYounghorsePlanner;
  window.renderYounghorsePlanner=renderYounghorsePlanner;
  window.MDR_YOUNGHORSE_PLANNER={consideredDisciplines,horseProfile,buildAssignments,planProfiles,knownTop3,isQualified,younghorseAgeEligible,activePool,entriesText};
})();
