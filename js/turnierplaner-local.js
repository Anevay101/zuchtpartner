
let TP_HORSES = [];
let TP_ALL_HORSES = [];
let TP_SELECTED = null;
let TP_TOURNAMENT_REFERENCES = null;
let TP_ZS_MODEL = null;
function tpOwnerKey(value){ return String(value || '').trim().toLocaleLowerCase('de'); }

document.addEventListener('DOMContentLoaded', () => {
  initTurnierplaner().catch(error => {
    console.error('Turnierplaner konnte nicht initialisiert werden:', error);
    const tbody = document.getElementById('tp-ranking-body');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="error">Turnier-Rangliste konnte nicht geladen werden: ${plannerEscape(error.message || String(error))}</td></tr>`;
    }
  });
});

async function initTurnierplaner() {
  await requireSession();
  await renderSharedNav();

  TP_ALL_HORSES = await localGetAll(LOCAL_STORES.horses);
  await persistAutomaticCupStars();
  // Das ZS-Modell hängt nur vom geladenen Datenbestand ab, nicht von den
  // sichtbaren Filtern. Einmal berechnen statt bei jedem Tastendruck erneut
  // Kreuzvalidierung + Regression laufen zu lassen.
  TP_ZS_MODEL = buildBreedingShowModel();
  // Lerndatei bleibt bewusst in TP_ALL_HORSES für das ZS-Lernmodell,
  // wird aber aus allen operativen Turnier-/Cup-Listen ausgeblendet.
  TP_HORSES = TP_ALL_HORSES.filter(h => isActiveBreeder(h.owner) && !(typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(h)));
  TP_HORSES.sort((a,b) => (a.name || '').localeCompare(b.name || '', 'de'));

  // V54.0.58: eine einzige lokale Referenzmatrix für alle Disziplinen/LK-Kombinationen.
  // Keine zusätzlichen Supabase-Abfragen: TP_ALL_HORSES wurde oben bereits einmal geladen.
  TP_TOURNAMENT_REFERENCES = plannerBuildTournamentRelativeModel(TP_ALL_HORSES, tournamentScore);

  buildTournamentControls();
  buildCupAndShowControls();
  wireTournamentControls();
  wireTurnierMainTabs();
  renderTournamentRanking();
  renderCupAchievements();
  renderCupCalendar();
  renderBreedingShowOverview();
  renderTournamentStats();
}


async function persistAutomaticCupStars() {
  // Einmalige/laufende Datenpflege ohne Bestätigungsdialog: bereits
  // vorhandene Pferde, die 50 Gesamtstarts + 15 Siege in einer Disziplin
  // erfüllen, bekommen den automatisch abgeleiteten Cupstern samt
  // berechenbarer LK auch strukturiert gespeichert. V54.0.18 sammelt alle
  // nötigen Änderungen und schreibt sie als Bulk-Upsert statt vieler
  // einzelner Cloud-Anfragen.
  const changedRows=[];
  for (let i=0;i<TP_ALL_HORSES.length;i++) {
    const horse=TP_ALL_HORSES[i];
    const derived=plannerTournamentResults(horse);
    const starRows=Object.entries(derived).filter(([,row])=>row?.cup_star === true);
    if (!starRows.length) continue;

    const raw=horse?.tournament_results && typeof horse.tournament_results==='object' && !Array.isArray(horse.tournament_results)
      ? {...horse.tournament_results} : {};
    let changed=false;
    for (const [discipline,row] of starRows) {
      const old=raw[discipline] && typeof raw[discipline]==='object' ? {...raw[discipline]} : {};
      if (old.cup_star !== true || (!old.cup_lk && row.cup_lk)) changed=true;
      raw[discipline]={
        ...old,
        first:Number(row.first || old.first || 0),
        second:Number(row.second || old.second || 0),
        third:Number(row.third || old.third || 0),
        cup_star:true,
        cup_lk:old.cup_lk || row.cup_lk || '',
      };
    }
    const tags=Array.isArray(horse.tags) ? horse.tags.map(t=>typeof t==='string'?{label:t}:{...t}) : [];
    if (!tags.some(t=>t?.label==='Cupstern')) { tags.push({label:'Cupstern'}); changed=true; }
    if (!changed) continue;
    const saved={...horse,tournament_results:raw,tags,updated_at:new Date().toISOString()};
    TP_ALL_HORSES[i]=saved;
    changedRows.push(saved);
  }
  if (changedRows.length) await localBulkPut(LOCAL_STORES.horses,changedRows);
}

function buildTournamentControls() {
  const discipline = document.getElementById('tp-discipline');
  discipline.innerHTML = Object.entries(MDR_TOURNAMENT_DISCIPLINES)
    .map(([name, def]) => `<option value="${plannerEscape(name)}">${plannerEscape(def.group)} · ${plannerEscape(name)}</option>`)
    .join('');

  const owners = [...new Set(TP_HORSES.map(h => h.owner).filter(Boolean))]
    .sort((a,b) => a.localeCompare(b,'de'));
  const ownerRoot=document.getElementById('tp-owner-options');
  if (ownerRoot) ownerRoot.innerHTML=owners.length
    ? owners.map(o=>`<label><input type="checkbox" value="${plannerEscape(o)}" checked> <span>${plannerEscape(o)}</span></label>`).join('')
    : '<span class="tiny muted">Keine Besitzer verfügbar.</span>';

  refreshTournamentBreedFilters();

  const horseOwner=document.getElementById('tp-horse-owner');
  if (horseOwner) horseOwner.innerHTML='<option value="">Alle</option>' + owners.map(o=>`<option value="${plannerEscape(o)}">${plannerEscape(o)}</option>`).join('');
  refreshTournamentHorseBreedFilter();
  refreshTournamentHorseSelect();
}

function setTournamentBreedOptions(id, breeds, allLabel='Alle') {
  const el=document.getElementById(id);
  if (!el) return;
  const old=el.value;
  el.innerHTML=`<option value="">${plannerEscape(allLabel)}</option>` +
    breeds.map(b=>`<option value="${plannerEscape(b)}">${plannerEscape(b)}</option>`).join('');
  el.value=[...el.options].some(o=>o.value===old) ? old : '';
}

function selectedTournamentOwners() {
  return [...document.querySelectorAll('#tp-owner-options input[type="checkbox"]:checked')].map(cb=>cb.value);
}

function refreshTournamentBreedFilters() {
  const owners=new Set(selectedTournamentOwners().map(tpOwnerKey));
  const rows=owners.size ? TP_HORSES.filter(h=>owners.has(tpOwnerKey(h.owner))) : [];
  const breeds=[...new Set(rows.map(h=>normalizeBreed(h.breed)||'Rasselos'))]
    .sort((a,b)=>a.localeCompare(b,'de'));
  setTournamentBreedOptions('tp-breed',breeds);
}

function refreshZsBreedFilter() {
  const selectedOwners=[...document.querySelectorAll('#tp-zs-owners input[type="checkbox"]:checked')].map(cb=>cb.value);
  const ownerKeys=new Set(selectedOwners.map(tpOwnerKey));
  const rows=TP_ALL_HORSES.filter(h=>
    !(typeof mdrIsLearningHorse==='function' && mdrIsLearningHorse(h)) &&
    ownerKeys.has(tpOwnerKey(h.owner))
  );
  const breeds=[...new Set(rows.map(h=>normalizeBreed(h.breed)||'Rasselos'))]
    .sort((a,b)=>a.localeCompare(b,'de'));
  setTournamentBreedOptions('tp-zs-breed',breeds,'Alle Rassen');
}


function buildCupAndShowControls() {
  const cupDiscipline = document.getElementById('tp-cup-discipline');
  if (cupDiscipline) {
    cupDiscipline.innerHTML = '<option value="">Alle Disziplinen</option>' +
      Object.entries(MDR_TOURNAMENT_DISCIPLINES)
        .map(([name,def]) => `<option value="${plannerEscape(name)}">${plannerEscape(def.group)} · ${plannerEscape(name)}</option>`)
        .join('');
  }
  const cupGroup=document.getElementById('tp-cup-group');
  if (cupGroup) cupGroup.innerHTML='<option value="">Alle Gruppen</option>' + MDR_TOURNAMENT_GROUP_ORDER.map(g=>`<option value="${plannerEscape(g)}">${plannerEscape(g)}</option>`).join('');

  // Das Lernmodell nutzt weiterhin ALLE geeigneten Pferde der gesamten
  // Datenbank. Für die sichtbare ZS-Liste werden dagegen nur die in den
  // Einstellungen aktiven Züchter als Mehrfachauswahl angeboten.
  const zsVisibleHorses=TP_ALL_HORSES.filter(h=>
    !(typeof mdrIsLearningHorse==='function' && mdrIsLearningHorse(h))
  );
  const allOwners=[...new Set(zsVisibleHorses.map(h=>h.owner).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de'));
  const zsOwners=typeof activeBreederOptions==='function' ? activeBreederOptions(allOwners) : allOwners.filter(isActiveBreeder);
  const ownerRoot=document.getElementById('tp-zs-owners');
  if (ownerRoot) ownerRoot.innerHTML=zsOwners.length
    ? zsOwners.map(v=>`<label class="tp-zs-owner-option"><input type="checkbox" value="${plannerEscape(v)}" checked> <span>${plannerEscape(v)}</span></label>`).join('')
    : '<span class="tiny muted">Keine aktiven Züchter konfiguriert.</span>';
  refreshZsBreedFilter();
}

function wireTurnierMainTabs() {
  document.querySelectorAll('[data-tp-main-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab=btn.dataset.tpMainTab;
      document.querySelectorAll('[data-tp-main-tab]').forEach(b=>b.classList.toggle('active',b===btn));
      document.querySelectorAll('.tp-main-panel').forEach(panel=>panel.hidden = panel.id !== `tp-tab-${tab}`);
      if (tab==='cups') { renderCupAchievements(); renderCupCalendar(); }
      if (tab==='show') renderBreedingShowOverview();
      if (tab==='stats') renderTournamentStats();
    });
  });

  ['tp-cup-search','tp-cup-discipline','tp-cup-status','tp-cup-group'].forEach(id => {
    const el=document.getElementById(id);
    if (!el) return;
    el.addEventListener(el.tagName==='INPUT' ? 'input' : 'change', renderCupAchievements);
  });
  document.getElementById('tp-cup-reset')?.addEventListener('click', () => {
    ['tp-cup-search','tp-cup-discipline','tp-cup-status','tp-cup-group'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
    renderCupAchievements();
  });

  ['tp-zs-name'].forEach(id=>document.getElementById(id)?.addEventListener('input',renderBreedingShowOverview));
  ['tp-zs-breed','tp-zs-only','tp-zs-breeding'].forEach(id=>document.getElementById(id)?.addEventListener('change',renderBreedingShowOverview));
  document.getElementById('tp-zs-owners')?.addEventListener('change',()=>{
    refreshZsBreedFilter();
    renderBreedingShowOverview();
  });
  document.getElementById('tp-zs-reset')?.addEventListener('click',()=>{
    const defaults={
      'tp-zs-name':'','tp-zs-breed':'','tp-zs-only':'with','tp-zs-breeding':''
    };
    Object.entries(defaults).forEach(([id,value])=>{ const el=document.getElementById(id); if(el) el.value=value; });
    document.querySelectorAll('#tp-zs-owners input[type="checkbox"]').forEach(cb=>{ cb.checked=true; });
    refreshZsBreedFilter();
    renderBreedingShowOverview();
  });
}

function refreshTournamentHorseBreedFilter() {
  const owner=document.getElementById('tp-horse-owner')?.value || '';
  const rows=owner ? TP_HORSES.filter(h=>tpOwnerKey(h.owner)===tpOwnerKey(owner)) : TP_HORSES;
  const breeds=[...new Set(rows.map(h=>normalizeBreed(h.breed)||'Rasselos'))].sort((a,b)=>a.localeCompare(b,'de'));
  setTournamentBreedOptions('tp-horse-breed',breeds);
}

function refreshTournamentHorseSelect() {
  const owner = document.getElementById('tp-horse-owner')?.value || '';
  const breed = document.getElementById('tp-horse-breed')?.value || '';
  const current = document.getElementById('tp-horse')?.value || '';
  const horses = TP_HORSES.filter(h => (!owner || tpOwnerKey(h.owner)===tpOwnerKey(owner)) && (!breed || (normalizeBreed(h.breed) || 'Rasselos') === breed));

  document.getElementById('tp-horse').innerHTML =
    '<option value="">Bitte wählen…</option>' +
    horses.map(h => `<option value="${plannerEscape(h.id)}">${plannerEscape(h.name || '(ohne Name)')} · ${plannerEscape(h.breed || 'ohne Rasse')} · ${plannerEscape(h.owner || '')}</option>`).join('');

  if (horses.some(h => String(h.id) === String(current))) {
    document.getElementById('tp-horse').value = current;
  } else {
    document.getElementById('tp-horse').value = '';
    TP_SELECTED = null;
    const summary = document.getElementById('tp-horse-summary');
    const root = document.getElementById('tp-horse-options');
    if (summary) summary.innerHTML = '';
    if (root) root.innerHTML = '<p class="muted">Bitte ein Pferd auswählen.</p>';
  }
}

function wireTournamentControls() {
  document.getElementById('tp-reset')?.addEventListener('click', resetTournamentFilters);

  document.querySelectorAll('[data-tp-planning-mode]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const mode=btn.dataset.tpPlanningMode;
      document.querySelectorAll('[data-tp-planning-mode]').forEach(b=>b.classList.toggle('active',b===btn));
      const horse=document.getElementById('tp-planning-horse');
      const stock=document.getElementById('tp-planning-stock');
      if (horse) horse.hidden=mode!=='horse';
      if (stock) stock.hidden=mode!=='stock';
      if (mode==='horse') renderHorseTournamentOptions();
      else renderTournamentRanking();
      try { sessionStorage.setItem('mdr-turnierplanung-mode-v47',mode); } catch {}
    });
  });
  try {
    const saved=sessionStorage.getItem('mdr-turnierplanung-mode-v47');
    if (saved && saved!=='horse') document.querySelector(`[data-tp-planning-mode="${saved}"]`)?.click();
  } catch {}

  ['tp-discipline','tp-lk','tp-breed'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', renderTournamentRanking);
  });
  document.getElementById('tp-owner-options')?.addEventListener('change', () => {
    refreshTournamentBreedFilters();
    renderTournamentRanking();
  });

  document.getElementById('tp-horse-owner')?.addEventListener('change', () => {
    refreshTournamentHorseBreedFilter();
    refreshTournamentHorseSelect();
    renderHorseTournamentOptions();
  });
  document.getElementById('tp-horse-breed').addEventListener('change', () => {
    refreshTournamentHorseSelect();
    renderHorseTournamentOptions();
  });

  ['tp-points-min','tp-interior-max','tp-table-horse'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderTournamentRanking);
  });

  document.getElementById('tp-horse').addEventListener('change', renderHorseTournamentOptions);
  ['tp-horse-points-min','tp-horse-interior-max','tp-horse-discipline'].forEach(id=>{
    document.getElementById(id)?.addEventListener('input', renderHorseTournamentOptions);
  });
  document.getElementById('tp-horse-lk').addEventListener('change', renderHorseTournamentOptions);
}








function resetTournamentFilters() {
  document.getElementById('tp-points-min').value = '';
  document.getElementById('tp-interior-max').value = '';
  document.getElementById('tp-lk').value = '';
  document.getElementById('tp-table-horse').value = '';
  document.querySelectorAll('#tp-owner-options input[type="checkbox"]').forEach(cb=>{ cb.checked=true; });
  refreshTournamentBreedFilters();
  document.getElementById('tp-breed').value = '';
  renderTournamentRanking();
}

function tournamentHorseValueMap(horse) {
  const out = new Map();

  for (const source of [horse?.disciplines || {}, horse?.traits || {}]) {
    for (const entries of Object.values(source)) {
      for (const row of entries || []) {
        const key = plannerNorm(row.name);
        if (!key) continue;
        out.set(key, {
          name: row.name,
          potential: row.potential == null || row.potential === '' ? null : Number(row.potential),
          current: row.current == null || row.current === '' ? null : Number(row.current),
        });
      }
    }
  }
  return out;
}

function tournamentInteriorMap(horse) {
  const out = new Map();
  for (const row of horse?.temperament || []) {
    out.set(plannerNorm(row.label), row.value);
  }
  return out;
}


function tournamentSecondaryThreshold() {
  // Veraltet seit V54.0.58: Empfehlungen basieren auf Pxx, nicht auf Punktgrenzen.
  return MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN;
}

function tournamentScore(horse, disciplineName) {
  const def = MDR_TOURNAMENT_DISCIPLINES[disciplineName];
  if (!def) return null;

  const values = tournamentHorseValueMap(horse);
  const rows = def.performance.map(name => {
    const row = values.get(plannerNorm(name));
    return {
      name,
      potential: row?.potential ?? null,
      current: row?.current ?? null,
    };
  });

  // Alle 7 Potenzialwerte müssen vorhanden sein.
  if (rows.some(r => r.potential == null || Number.isNaN(r.potential))) {
    return {
      discipline: disciplineName,
      group: def.group,
      complete: false,
      points: null,
      interior: null,
      lk: null,
      rows,
    };
  }

  const disciplinePotential = rows[0].potential;
  const sixOther = rows.slice(1).reduce((sum, r) => sum + r.potential, 0);
  const points = 3 * disciplinePotential + sixOther;

  const minPotential = Math.min(...rows.map(r => r.potential));
  const lk = plannerLKFromPotential(minPotential);

  const intMap = tournamentInteriorMap(horse);
  const intScores = def.interior
    .map(name => scoreTemperamentTerm(intMap.get(plannerNorm(name))))
    .filter(v => v != null && !Number.isNaN(v));

  const interior = intScores.length === def.interior.length
    ? intScores.reduce((a,b) => a+b,0) / intScores.length
    : null;

  const mainGroup = detectHorseMainGroup(horse);
  const isMainGroup = mainGroup && mainGroup === def.group;
  const secondaryGood = false; // V54.0.58: wird erst nach der Pxx-Einordnung bestimmt.

  return {
    discipline: disciplineName,
    group: def.group,
    complete: true,
    points,
    interior,
    lk,
    minPotential,
    rows,
    isMainGroup,
    secondaryGood,
  };
}

function detectHorseMainGroup(horse) {
  if (typeof plannerHorseMainGroup === 'function') {
    const shared = plannerHorseMainGroup(horse);
    if (shared) return shared;
  }
  const begabung = plannerNormalizeDisciplineName(horse?.tournament_potential?.['Begabung']);
  if (typeof findDisciplineCategory === 'function') {
    const category = findDisciplineCategory(horse?.disciplines, begabung);
    if (category) return category;
  }
  const groups = new Set(Object.values(MDR_TOURNAMENT_DISCIPLINES).map(d => d.group));
  return groups.has(begabung) ? begabung : null;
}

function tournamentRelativeResult(evalRow) {
  return plannerTournamentRelative(evalRow, TP_TOURNAMENT_REFERENCES);
}

function tournamentRelativePercentile(evalRow) {
  return tournamentRelativeResult(evalRow).percentile;
}

function tournamentRelativeHtml(evalRow) {
  const rel=tournamentRelativeResult(evalRow);
  const p=rel.percentile;
  if (p == null) return '<span class="muted">P–</span>';
  const ref=plannerReferenceLabel(rel.reference);
  return `<span class="tp-relative-link tp-p-${plannerTournamentTraffic(p)}" title="P${p}: besser als etwa ${p} % der Vergleichswerte. ${plannerEscape(ref)}">P${p}</span>`;
}

function tournamentTrafficHtml(row, compact=false) {
  const relP=Number(row?.percentile ?? tournamentRelativePercentile(row));
  const recommendation=Number.isFinite(Number(row?.recommendationScore))
    ? {score:Number(row.recommendationScore)}
    : plannerTournamentRecommendationScore(row,relP);
  const isMain=Boolean(row?.isMainGroup);
  const info=row?.interpretation || plannerTournamentInterpretation(recommendation.score,isMain);
  const cls=`tp-eval-chip tp-eval-${info.traffic || 'neutral'}`;
  const prefix=info.traffic==='green'?'🟢':info.traffic==='yellow'?'🟡':info.traffic==='orange'?'🟠':info.traffic==='red'?'🔴':'⚪';
  return `<span class="${cls}">${prefix} ${compact ? plannerEscape(info.label) : plannerEscape(info.label)}</span>`;
}

function tournamentInteriorHtml(row) {
  const a=row?.interiorAssessment || plannerTournamentInteriorAssessment(row?.interior);
  const value=row?.interior == null ? '–' : Number(row.interior).toFixed(2);
  const prefix=a.traffic==='green'?'🟢':a.traffic==='yellow'?'🟡':a.traffic==='red'?'🔴':'⚪';
  return `<span class="tp-int tp-int-${a.traffic}">${value} <span class="tiny">${prefix} ${plannerEscape(a.label)}</span></span>`;
}

function renderTournamentStats() {
  const body=document.getElementById('tp-stats-body');
  const groupBody=document.getElementById('tp-stats-group-body');
  const basis=document.getElementById('tp-stats-basis');
  if (!body || !groupBody || !basis) return;
  const model=TP_TOURNAMENT_REFERENCES || {exact:{},byLk:{},horseCount:0};
  const order=['LK10','LK9','LK8','LK7','LK6','LK5','LK4','LK3','LK2','LK1'];
  const fmt=v=>v==null?'–':String(Math.round(Number(v)));
  const rows=order.map(lk=>model.byLk?.[lk]).filter(Boolean);
  body.innerHTML=rows.length ? rows.map(row=>`<tr>
    <th>${plannerEscape(row.lk)}</th><td>${row.n}</td><td>${fmt(row.mean)}</td><td>${fmt(row.p25)}</td><td>${fmt(row.p50)}</td><td>${fmt(row.p75)}</td>
  </tr>`).join('') : '<tr><td colspan="6" class="muted">Noch keine auswertbaren Referenzen.</td></tr>';

  const groupRank=new Map((MDR_TOURNAMENT_GROUP_ORDER || []).map((g,i)=>[g,i]));
  const lkRank=new Map(order.map((lk,i)=>[lk,i]));
  const exactRows=Object.values(model.exact || {}).slice().sort((a,b)=>
    (lkRank.get(a.lk) ?? 99)-(lkRank.get(b.lk) ?? 99) ||
    (groupRank.get(a.group) ?? 99)-(groupRank.get(b.group) ?? 99) ||
    String(a.discipline).localeCompare(String(b.discipline),'de')
  );
  groupBody.innerHTML=exactRows.length ? exactRows.map(row=>`<tr>
    <th>${plannerEscape(row.discipline)}</th><td>${plannerEscape(row.group||'–')}</td><td>${plannerEscape(row.lk)}</td><td>${row.n}</td>
    <td>${fmt(row.p25)}</td><td><strong>${fmt(row.p50)}</strong></td><td>${fmt(row.p75)}</td>
  </tr>`).join('') : '<tr><td colspan="7" class="muted">Keine Disziplin/LK-Daten.</td></tr>';
  basis.textContent=plannerTournamentReferenceBasisText(model) + '. Berechnung vollständig lokal aus dem bereits synchronisierten Bestand.';
}

function tournamentDataQualityBadge(horse) {
  return typeof dataQualityBadgeHtml === 'function' ? dataQualityBadgeHtml(horse) : '';
}

function renderTournamentRanking() {
  const disciplineName = document.getElementById('tp-discipline').value;
  const pointsMinRaw = document.getElementById('tp-points-min').value;
  const interiorMaxRaw = document.getElementById('tp-interior-max').value;
  const lkFilter = document.getElementById('tp-lk').value;
  const owners = new Set(selectedTournamentOwners().map(tpOwnerKey));
  const breed = document.getElementById('tp-breed').value;
  const horseSearch=(document.getElementById('tp-table-horse')?.value || '').trim().toLowerCase();
  const pointsMin = pointsMinRaw === '' ? null : Number(pointsMinRaw);
  const interiorMax = interiorMaxRaw === '' ? null : Number(interiorMaxRaw);

  let rows = TP_HORSES.map(horse => ({ horse, eval: tournamentScore(horse, disciplineName) }))
    .filter(row => row.eval?.complete)
    .filter(({horse, eval}) => {
      if (!owners.size || !owners.has(tpOwnerKey(horse.owner))) return false;
      if (breed && (normalizeBreed(horse.breed) || 'Rasselos') !== breed) return false;
      if (pointsMin != null && eval.points < pointsMin) return false;
      if (interiorMax != null && (eval.interior == null || eval.interior > interiorMax)) return false;
      if (lkFilter && eval.lk !== lkFilter) return false;
      if (horseSearch && !String(horse.name || '').toLowerCase().includes(horseSearch)) return false;
      return true;
    });

  // V54.0.59: LK-übergreifend nach EINEM Empfehlungswert sortieren.
  // Pxx bleibt die relative interne Basis; die absolute Turnierkurve (LK10 155 / LK9 190 / LK8 200)
  // verhindert, dass ein relativ gutes, absolut aber chancenloses Pferd zu hoch empfohlen wird.
  rows.forEach(({horse,eval:row})=>{
    const mainGroup=detectHorseMainGroup(horse);
    const isMain=Boolean(mainGroup && row.group===mainGroup);
    const rel=plannerTournamentRelative(row,TP_TOURNAMENT_REFERENCES);
    const recommendation=plannerTournamentRecommendationScore(row,rel.percentile);
    row.percentile=rel.percentile; row.reference=rel.reference; row.isMainGroup=isMain;
    row.recommendationScore=recommendation.score; row.recommendation=recommendation;
    row.interpretation=plannerTournamentInterpretation(recommendation.score,isMain);
    row.interiorAssessment=plannerTournamentInteriorAssessment(row.interior);
  });
  rows.sort((a,b) => {
    const as=Number.isFinite(Number(a.eval.recommendationScore))?Number(a.eval.recommendationScore):-1;
    const bs=Number.isFinite(Number(b.eval.recommendationScore))?Number(b.eval.recommendationScore):-1;
    if (bs!==as) return bs-as;
    const ap=Number.isFinite(Number(a.eval.percentile))?Number(a.eval.percentile):-1;
    const bp=Number.isFinite(Number(b.eval.percentile))?Number(b.eval.percentile):-1;
    if (bp!==ap) return bp-ap;
    const p=b.eval.points-a.eval.points;
    if(p)return p;
    const ai=a.eval.interior==null?Infinity:a.eval.interior;
    const bi=b.eval.interior==null?Infinity:b.eval.interior;
    if(ai!==bi)return ai-bi;
    return (a.horse.name||'').localeCompare(b.horse.name||'','de');
  });

  const title=document.getElementById('tp-title');
  const count=document.getElementById('tp-count');
  if (title) title.textContent=disciplineName ? `${disciplineName} · Bestandsvergleich` : 'Bestandsvergleich';
  if (count) count.textContent=`${rows.length} Pferd${rows.length===1?'':'e'}`;

  const body=document.getElementById('tp-ranking-body');
  if (!rows.length) {
    body.innerHTML='<tr><td colspan="7" class="muted">Keine Pferde entsprechen den gewählten Filtern.</td></tr>';
    return;
  }
  body.innerHTML=rows.map(({horse,eval:row},index)=>{
    const classification=tournamentTrafficHtml(row,true);
    return `<tr>
      <td>${index+1}</td>
      <td><a href="view.html?id=${encodeURIComponent(horse.id)}"><strong>${plannerEscape(horse.name || '(ohne Name)')}</strong></a><br><span class="tiny muted">${plannerEscape(horse.owner || '')} · ${plannerEscape(horse.breed || '')}</span></td>
      <td>${plannerEscape(row.discipline)}</td>
      <td><strong>${Math.round(row.points)}</strong></td>
      <td>${tournamentInteriorHtml(row)}</td>
      <td>${plannerEscape(row.lk || '?')}</td>
      <td><strong>${plannerTournamentRecommendationHtml(row)}</strong> · ${classification}</td>
    </tr>`;
  }).join('');
}

function tournamentProfileSubset(profile, subsetRows) {
  const rows=Array.isArray(subsetRows)?subsetRows:[];
  const mainGroup=profile?.mainGroup||null;
  const byRecommendation=(a,b)=>(Number(b.recommendationScore)||-1)-(Number(a.recommendationScore)||-1)||(Number(b.percentile)||-1)-(Number(a.percentile)||-1)||Number(b.points)-Number(a.points);
  const mainRows=rows.filter(r=>r.group===mainGroup).sort(byRecommendation);
  const secondaryRows=rows.filter(r=>r.group!==mainGroup).sort(byRecommendation);
  const recommendedSecondaryRows=secondaryRows.filter(r=>Number(r.recommendationScore)>=MDR_TOURNAMENT_P_GOOD);
  const situationalSecondaryRows=secondaryRows.filter(r=>Number(r.recommendationScore)>=MDR_TOURNAMENT_P_AVERAGE && Number(r.recommendationScore)<MDR_TOURNAMENT_P_GOOD);
  const suitableRows=[...mainRows.filter(r=>r.suitable),...recommendedSecondaryRows].sort(byRecommendation);
  const groups=(MDR_TOURNAMENT_GROUP_ORDER||[]).map(group=>{
    const allRows=rows.filter(r=>r.group===group).sort(byRecommendation);
    if(!allRows.length)return null;
    const good=allRows.filter(r=>r.suitable);
    return {group,rows:good,allRows,count:good.length,isMain:group===mainGroup,best:allRows[0]||null,provenCount:allRows.filter(r=>r.proven).length};
  }).filter(Boolean);
  const main=groups.find(g=>g.group===mainGroup)||{group:mainGroup,rows:[],allRows:mainRows,count:0,isMain:true,best:mainRows[0]||null,provenCount:0};
  const alternatives=groups.filter(g=>g.group!==mainGroup&&g.rows.some(r=>Number(r.recommendationScore)>=MDR_TOURNAMENT_P_GOOD));
  const bestMain=mainRows[0]||null, bestSecondary=secondaryRows[0]||null;
  let recommendation=bestMain?.interpretation?.label?`Hauptbegabung ${bestMain.interpretation.label}`:'Keine belastbare Turniereinordnung';
  if(bestSecondary&&Number(bestSecondary.recommendationScore)>=MDR_TOURNAMENT_P_GOOD) recommendation+=` · Nebenbegabung ${bestSecondary.interpretation.label.toLowerCase()}`;
  return {...profile,rows,mainRows,secondaryRows,recommendedSecondaryRows,situationalSecondaryRows,suitableRows,groups,main,alternatives,singleAlternatives:[],recommendation,best:rows[0]||null,bestMain,bestSecondary,bestSuitable:suitableRows[0]||null};
}

function renderHorseTournamentOptions() {
  const id=document.getElementById('tp-horse').value;
  const horse=TP_HORSES.find(h=>String(h.id)===String(id))||null;
  TP_SELECTED=horse;
  const root=document.getElementById('tp-horse-options');
  const summary=document.getElementById('tp-horse-summary');
  if(!horse){ summary.innerHTML=''; root.innerHTML='<p class="muted">Bitte ein Pferd auswählen.</p>'; return; }

  const pointsRaw=document.getElementById('tp-horse-points-min').value;
  const pointsMin=pointsRaw===''?null:Number(pointsRaw);
  const lkFilter=document.getElementById('tp-horse-lk').value;
  const disciplineFilter=(document.getElementById('tp-horse-discipline')?.value||'').trim().toLowerCase();
  const interiorRaw=document.getElementById('tp-horse-interior-max')?.value||'';
  const interiorMax=interiorRaw===''?null:Number(interiorRaw);

  const profile=plannerAnalyzeTournamentProfile(horse,TP_ALL_HORSES,tournamentScore,{relativeModel:TP_TOURNAMENT_REFERENCES});
  if(!profile.rows.length){ summary.innerHTML=''; root.innerHTML='<p class="muted">Für dieses Pferd fehlen noch vollständige Turnier-Potenzialwerte.</p>'; return; }

  const filtered=profile.rows.filter(r=>{
    if(pointsMin!=null&&r.points<pointsMin)return false;
    if(lkFilter&&r.lk!==lkFilter)return false;
    if(disciplineFilter&&!r.discipline.toLowerCase().includes(disciplineFilter))return false;
    if(interiorMax!=null&&(r.interior==null||r.interior>interiorMax))return false;
    return true;
  });
  const visible=tournamentProfileSubset(profile,filtered);
  const mainBest=visible.bestMain;
  const secondaryBest=visible.bestSecondary;
  const secondaryMention=[...visible.recommendedSecondaryRows,...visible.situationalSecondaryRows]
    .sort((a,b)=>(Number(b.recommendationScore)||-1)-(Number(a.recommendationScore)||-1)||(Number(b.percentile)||-1)-(Number(a.percentile)||-1)||Number(b.points)-Number(a.points));

  const mainTraffic=mainBest?tournamentTrafficHtml(mainBest,true):'<span class="muted">–</span>';
  const secondarySummary=secondaryBest&&Number(secondaryBest.recommendationScore)>=MDR_TOURNAMENT_P_AVERAGE
    ? `${plannerEscape(secondaryBest.discipline)} · ${plannerTournamentRecommendationHtml(secondaryBest)} · ${tournamentTrafficHtml(secondaryBest,true)}`
    : '<span class="muted">keine auffällige Nebenbegabung</span>';

  summary.innerHTML=`
    <div class="planner-summary tournament-recommendation-card selectable-copy-area">
      <div class="tournament-recommendation-head">
        <div>
          <h3><a href="view.html?id=${encodeURIComponent(horse.id)}">${plannerEscape(horse.name||'(ohne Name)')}</a></h3>
          <p class="tournament-recommendation-line"><strong>Turnierprofil:</strong> ${plannerEscape(visible.mainGroup||'Hauptbegabung unbekannt')} · ${mainTraffic}</p>
        </div>
        <button type="button" class="secondary small" id="tp-copy-recommendation">Für Notizen kopieren</button>
      </div>
      ${mainBest?`<p><strong>Stärkste Hauptdisziplin:</strong> ${plannerEscape(mainBest.discipline)} · ${Math.round(mainBest.points)} P. · ${plannerEscape(mainBest.lk||'LK –')} · Empf. ${plannerTournamentRecommendationHtml(mainBest)} · INT ${tournamentInteriorHtml(mainBest)}</p>`:'<p class="muted">Keine Hauptdisziplin entspricht den Filtern.</p>'}
      <p class="small"><strong>Beste Nebenbegabung:</strong> ${secondarySummary}</p>
      <details class="tp-relative-help tp-relative-help-inline"><summary><span class="tp-info-dot">i</span> Empfehlung &amp; INT</summary><p class="tiny">Der Empfehlungswert 0–100 kombiniert die relative Pxx-Stärke mit einer weichen realistischen Turnierkurve: LK10 ab 155, LK9 ab 190, LK8 ab 200 Punkten. Pxx wird weiterhin aus derselben Disziplin + LK berechnet und bei kleiner Stichprobe auf Gruppe+LK bzw. LK gesamt zurückgeführt. INT bleibt separat: ≤2,00 sehr gut, 2,01–2,50 gut machbar, &gt;2,50 mühsamer.</p></details>
    </div>`;

  const mainRows=visible.mainRows.length?visible.mainRows.map(r=>`<tr>
      <td>${tournamentTrafficHtml(r,true)}</td><th>${plannerEscape(r.discipline)}</th><td>${Math.round(r.points)}</td>
      <td>${plannerEscape(r.lk||'–')}</td><td><strong>${plannerTournamentRecommendationHtml(r)}</strong></td><td>${tournamentInteriorHtml(r)}</td>
      <td>${plannerEscape(r.interpretation?.label||'–')}</td>
    </tr>`).join(''):'<tr><td colspan="7" class="muted">Keine Hauptdisziplin entspricht den gewählten Filtern.</td></tr>';

  const secondaryRows=secondaryMention.length?secondaryMention.map(r=>`<tr>
      <td>${tournamentTrafficHtml(r,true)}</td><th>${plannerEscape(r.discipline)}</th><td>${plannerEscape(r.group)}</td><td>${Math.round(r.points)}</td>
      <td>${plannerEscape(r.lk||'–')}</td><td><strong>${plannerTournamentRecommendationHtml(r)}</strong></td><td>${tournamentInteriorHtml(r)}</td>
    </tr>`).join(''):'<tr><td colspan="7" class="muted">Keine Nebenbegabung mit Empfehlung ab 45/100 in der aktuellen Auswahl.</td></tr>';

  const fullRows=filtered.length?filtered.map((r,index)=>`<tr>
      <td>${index+1}</td><th>${plannerEscape(r.discipline)}</th><td>${plannerEscape(r.group)}</td><td>${Math.round(r.points)}</td>
      <td>${plannerEscape(r.lk||'–')}</td><td>${plannerTournamentRecommendationHtml(r)}</td><td>${tournamentInteriorHtml(r)}</td>
      <td>${tournamentTrafficHtml(r,true)}<br><span class="tiny muted">${plannerEscape(plannerReferenceLabel(r.reference))}</span></td>
    </tr>`).join(''):'<tr><td colspan="8" class="muted">Keine Disziplin entspricht den gewählten Filtern.</td></tr>';

  root.innerHTML=`
    <section class="tournament-compact-section selectable-copy-area">
      <div class="tournament-section-head"><h3>Hauptbegabung · ${plannerEscape(visible.mainGroup||'–')}</h3><button type="button" class="secondary small" id="tp-copy-suitable">Empfehlungen kopieren</button></div>
      <div class="table-wrap"><table class="detail-table tournament-suitable-table">
        <thead><tr><th>Ampel</th><th>Disziplin</th><th>Punkte</th><th>LK</th><th>Empfehlung</th><th>INT</th><th>Einordnung</th></tr></thead><tbody>${mainRows}</tbody>
      </table></div>
    </section>
    <section class="tournament-compact-section selectable-copy-area">
      <h3>Nebenbegabungen · Beritt prüfen</h3>
      <p class="tiny muted">Angezeigt werden nur Nebenbegabungen ab 45/100: 80+ sehr interessant · 65–79 interessant · 45–64 situativ.</p>
      <div class="table-wrap"><table class="detail-table tournament-suitable-table">
        <thead><tr><th>Ampel</th><th>Disziplin</th><th>Gruppe</th><th>Punkte</th><th>LK</th><th>Empfehlung</th><th>INT</th></tr></thead><tbody>${secondaryRows}</tbody>
      </table></div>
    </section>
    <details class="tournament-all-details">
      <summary>Alle ${filtered.length} gefilterten Disziplinen anzeigen</summary>
      <div class="table-wrap"><table class="detail-table tournament-all-table">
        <thead><tr><th>#</th><th>Disziplin</th><th>Gruppe</th><th>Punkte</th><th>LK</th><th>Empfehlung</th><th>INT</th><th>Einordnung / Referenz</th></tr></thead><tbody>${fullRows}</tbody>
      </table></div>
    </details>`;

  document.getElementById('tp-copy-recommendation')?.addEventListener('click',e=>plannerCopyText(plannerTournamentCopyText(visible),e.currentTarget));
  document.getElementById('tp-copy-suitable')?.addEventListener('click',e=>plannerCopyText(plannerSuitableTournamentCopyText(visible),e.currentTarget));
}


// ---------------------------------------------------------------------
// V53.5 – fester MDR-Cup-Kalender + verfügbare Pferde je LK
// ---------------------------------------------------------------------
const MDR_CUP_LKS = ['LK10','LK9','LK8'];
const MDR_CUP_TIMES = { LK10:'21:00', LK9:'22:00', LK8:'23:00' };
const MDR_CUP_DISCIPLINE_ORDER = Object.keys(MDR_TOURNAMENT_DISCIPLINES);

function cupLocalDateOnly(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function cupDayDistance(fromDate, toDate) {
  const a=Date.UTC(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const b=Date.UTC(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
  return Math.round((b-a)/86400000);
}

function cupFormatDate(date, withYear=false) {
  return new Intl.DateTimeFormat('de-DE', {
    weekday:'short', day:'2-digit', month:'2-digit', ...(withYear ? {year:'numeric'} : {})
  }).format(date);
}

function cupRegistrationDate(cupDate) {
  const d=new Date(cupDate.getFullYear(), cupDate.getMonth(), cupDate.getDate());
  d.setDate(d.getDate()-3);
  return d;
}

function cupUpcomingDays(dayWindow=6, refDate=new Date()) {
  const now=cupLocalDateOnly(refDate);
  const rows=[];
  for (let offset=0; offset<dayWindow; offset++) {
    const cursor=new Date(now);
    cursor.setDate(cursor.getDate()+offset);
    const day=cursor.getDate();
    if (day >= 1 && day <= MDR_CUP_DISCIPLINE_ORDER.length) {
      rows.push({ date:new Date(cursor), day, discipline:MDR_CUP_DISCIPLINE_ORDER[day-1] });
    }
  }
  return rows;
}

function cupNextDateForDiscipline(discipline, refDate=new Date()) {
  const idx=MDR_CUP_DISCIPLINE_ORDER.indexOf(discipline);
  if (idx < 0) return null;
  const day=idx+1;
  const today=cupLocalDateOnly(refDate);
  let candidate=new Date(today.getFullYear(), today.getMonth(), day);
  if (candidate < today) candidate=new Date(today.getFullYear(), today.getMonth()+1, day);
  return candidate;
}

function cupCalendarAvailability(discipline, lk) {
  const ready=[];
  const unknown=[];

  for (const horse of TP_HORSES) {
    const row=plannerTournamentResults(horse)[discipline];
    if (!row?.cup_star) continue;
    if (row.cup_lk === lk) ready.push(horse);
    else if (!row.cup_lk) unknown.push(horse);
  }

  const byName=(a,b)=>(a.name||'').localeCompare(b.name||'','de');
  ready.sort(byName); unknown.sort(byName);
  return {ready,unknown};
}

function cupCandidateLinks(horses) {
  return horses.map(h=>`<a class="cup-candidate-link" href="view.html?id=${encodeURIComponent(h.id)}"><strong>${plannerEscape(h.name || '(ohne Name)')}</strong>${h.owner ? `<span>${plannerEscape(h.owner)}</span>` : ''}</a>`).join('');
}

function cupAvailabilityHtml(discipline, lk) {
  const {ready}=cupCalendarAvailability(discipline,lk);
  const readyHtml=ready.length
    ? `<details class="cup-availability cup-availability-ready"><summary>🟢 ${ready.length} verfügbar</summary><div class="cup-candidate-list">${cupCandidateLinks(ready)}</div></details>`
    : '<div class="cup-availability cup-availability-none">⚪ 0 verfügbar</div>';
  return `<div class="cup-lk-slot"><strong>${lk} · ${MDR_CUP_TIMES[lk]}</strong>${readyHtml}</div>`;
}

function renderCupCalendar() {
  const root=document.getElementById('tp-cup-calendar');
  if (!root) return;
  const now=new Date();
  const today=cupLocalDateOnly(now);
  const rows=cupUpcomingDays(6,now);
  if (!rows.length) {
    root.innerHTML='<p class="muted">Kein Cup-Termin berechenbar.</p>';
    return;
  }

  const first=rows[0];
  const firstAvail=MDR_CUP_LKS.map(lk=>({lk,...cupCalendarAvailability(first.discipline,lk)}));
  const readyTotal=firstAvail.reduce((sum,x)=>sum+x.ready.length,0);
  const firstReg=cupRegistrationDate(first.date);
  const firstOpen=today >= cupLocalDateOnly(firstReg) && today <= cupLocalDateOnly(first.date);

  root.innerHTML=`
    <div class="cup-calendar-hero">
      <div>
        <span class="cup-calendar-kicker">📅 Nächster Cup-Tag</span>
        <h2>${plannerEscape(first.discipline)} · ${cupFormatDate(first.date,true)}</h2>
        <p class="small muted">${plannerEscape(MDR_TOURNAMENT_DISCIPLINES[first.discipline]?.group || '')} · Anmeldung ${firstOpen ? '<strong>jetzt offen</strong>' : `ab ${cupFormatDate(firstReg)}`}</p>
      </div>
      <div class="cup-calendar-hero-counts">
        <span class="cup-count-ready">🟢 ${readyTotal} verfügbar</span>
      </div>
    </div>
    <p class="tiny muted cup-calendar-rule">Fester MDR-Regelplan: 1. = Dressur bis 28. = Racking. LK10 um 21:00, LK9 um 22:00, LK8 um 23:00. Freischaltung zur Anmeldung jeweils 3 Tage vorher. Verfügbarkeit bezieht sich auf die in den Einstellungen aktiven Züchter. Grün zählt automatisch erkannte Cupsterne mit passender gespeicherter Cup-LK.</p>
    <div class="cup-calendar-list">
      ${rows.map((row,index)=>{
        const distance=cupDayDistance(today,row.date);
        const urgency=distance<=3 ? 'cup-calendar-urgent' : distance<=7 ? 'cup-calendar-soon' : '';
        const reg=cupRegistrationDate(row.date);
        const regOpen=today >= cupLocalDateOnly(reg) && today <= cupLocalDateOnly(row.date);
        const unknownMap=new Map();
        for (const horse of TP_HORSES) {
          const result=plannerTournamentResults(horse)[row.discipline];
          if (result?.cup_star && !result.cup_lk) unknownMap.set(String(horse.id),horse);
        }
        const unknown=[...unknownMap.values()].sort((a,b)=>(a.name||'').localeCompare(b.name||'','de'));
        return `<article class="cup-calendar-day ${urgency} ${index===0?'cup-calendar-next':''}">
          <div class="cup-calendar-date">
            <strong>${distance===0?'Heute':cupFormatDate(row.date)}</strong>
            <span>${regOpen ? '🟢 Meldung offen' : `Meldung ab ${cupFormatDate(reg)}`}</span>
          </div>
          <div class="cup-calendar-discipline">
            <strong>${plannerEscape(row.discipline)}</strong>
            <span>${plannerEscape(MDR_TOURNAMENT_DISCIPLINES[row.discipline]?.group || '')}</span>
          </div>
          <div class="cup-calendar-lks">${MDR_CUP_LKS.map(lk=>cupAvailabilityHtml(row.discipline,lk)).join('')}</div>
          ${unknown.length ? `<details class="cup-calendar-unknown"><summary>⚠️ ${unknown.length} Cupstern${unknown.length===1?'':'e'} ohne gespeicherte LK</summary><div class="cup-candidate-list">${cupCandidateLinks(unknown)}</div></details>` : ''}
        </article>`;
      }).join('')}
    </div>`;
}

// ---------------------------------------------------------------------
// V54.0.15 – Cups & Erfolge mit vollautomatischer Cupstern-Erkennung
// ---------------------------------------------------------------------
function cupAchievementRows() {
  const rows=[];
  for (const horse of TP_HORSES) {
    const results=plannerTournamentResults(horse);
    for (const [discipline,result] of Object.entries(results)) {
      if (!result.first && !result.second && !result.third && !result.cup_star) continue;
      rows.push({horse,discipline,result,progress:plannerCupProgress(horse,discipline)});
    }
    const legacy=(horse?.tags || []).some(t=>(typeof t==='string'?t:t?.label)==='Cupstern');
    if (legacy && !plannerCupStarRows(horse).length && !Object.keys(results).length) {
      rows.push({horse,discipline:'',result:{first:0,second:0,third:0,cup_star:true,cup_lk:''},progress:{wins:0,starts:plannerTournamentStarts(horse),requirementsReached:false,cupStar:true}});
    }
  }
  return rows;
}

function renderCupSummary() {
  const root=document.getElementById('tp-cup-summary');
  if (!root) return;
  const rows=cupAchievementRows();
  const starredIds=new Set(rows.filter(r=>r.result?.cup_star).map(r=>String(r.horse.id)));
  const nearIds=new Set(rows.filter(r=>!r.result?.cup_star && Number(r.result?.first || 0)>=7 && Number(r.result?.first || 0)<15).map(r=>String(r.horse.id)));
  const upcoming=cupUpcomingDays(6,new Date());
  const next=upcoming[0];
  root.innerHTML=`<div class="tp-summary-pills">
    <span>⭐ <strong>${starredIds.size}</strong> Cup-Pferde</span>
    <span>≈ <strong>${nearIds.size}</strong> mit 7–14 Siegen</span>
    <span>📅 ${next ? `<strong>${plannerEscape(next.discipline)}</strong> · ${cupFormatDate(next.date)}` : 'kein Cup in den nächsten 6 Tagen'}</span>
  </div>`;
}

function renderCupAchievements() {
  renderCupSummary();
  const body=document.getElementById('tp-cup-body');
  if (!body) return;
  const q=(document.getElementById('tp-cup-search')?.value || '').trim().toLowerCase();
  const discipline=document.getElementById('tp-cup-discipline')?.value || '';
  const status=document.getElementById('tp-cup-status')?.value || '';
  const group=document.getElementById('tp-cup-group')?.value || '';

  let rows=cupAchievementRows().map(row=>{
    const evaluation=row.discipline ? tournamentScore(row.horse,row.discipline) : null;
    return {...row,evaluation,tournamentValue:Number.isFinite(Number(evaluation?.points)) ? Number(evaluation.points) : null};
  }).filter(row=>{
    if (q && !`${row.horse.name || ''} ${row.horse.owner || ''}`.toLowerCase().includes(q)) return false;
    if (discipline && row.discipline!==discipline) return false;
    if (group && MDR_TOURNAMENT_DISCIPLINES[row.discipline]?.group!==group) return false;

    const hasStar=Boolean(row.result.cup_star);
    const wins=Number(row.result.first || 0);
    if (!hasStar && wins < 7) return false;

    if (status==='star' && !hasStar) return false;
    if (status==='no-star' && hasStar) return false;
    if (status==='near' && !(wins>=7 && wins<15 && !hasStar)) return false;
    return true;
  });

  // Disziplin ist die primäre Gruppierung. Innerhalb einer Disziplin entscheidet
  // der tatsächliche Turnierwert, danach die Zahl der Siege.
  rows.sort((a,b)=>{
    if (!discipline) {
      const da=String(a.discipline || 'ZZZ');
      const db=String(b.discipline || 'ZZZ');
      const dcmp=da.localeCompare(db,'de');
      if (dcmp) return dcmp;
    }
    const av=a.tournamentValue == null ? -Infinity : a.tournamentValue;
    const bv=b.tournamentValue == null ? -Infinity : b.tournamentValue;
    if (bv!==av) return bv-av;
    const wins=Number(b.result.first || 0)-Number(a.result.first || 0);
    if (wins) return wins;
    return (a.horse.name||'').localeCompare(b.horse.name||'','de');
  });

  const count=document.getElementById('tp-cup-count');
  if (count) count.textContent=`· ${rows.length} Einträge`;

  if (!rows.length) {
    body.innerHTML='<tr><td colspan="7" class="muted">Keine passenden Cupdaten bzw. noch keine 7 Siege in der gewählten Disziplin.</td></tr>';
    return;
  }

  body.innerHTML=rows.map(({horse,discipline,result,progress,evaluation,tournamentValue})=>{
    const starts=plannerTournamentStarts(horse);
    const statusText=result.cup_star
      ? '<strong>⭐</strong>'
      : '–';
    const nextCupDate=discipline ? cupNextDateForDiscipline(discipline) : null;
    const cupDistance=nextCupDate ? cupDayDistance(cupLocalDateOnly(new Date()),nextCupDate) : null;
    const upcomingClass=result.cup_star && cupDistance!=null
      ? (cupDistance<=3 ? 'cup-row-urgent' : cupDistance<=7 ? 'cup-row-soon' : '')
      : '';
    const cupLk=result.cup_lk || progress.cup_lk || evaluation?.lk || '–';
    const tournamentValueText=tournamentValue == null ? '–' : String(Math.round(tournamentValue));
    return `<tr class="${upcomingClass}">
      <td><a href="view.html?id=${encodeURIComponent(horse.id)}"><strong>${plannerEscape(horse.name || '(ohne Name)')}</strong></a><br><span class="tiny muted">${plannerEscape(horse.owner || '')}</span></td>
      <td>${plannerEscape(discipline || 'Disziplin noch ergänzen')}</td>
      <td><strong>${result.first || 0}</strong></td>
      <td>${starts == null ? '–' : starts}</td>
      <td>${statusText}</td>
      <td>${plannerEscape(cupLk)}</td>
      <td><strong>${plannerEscape(tournamentValueText)}</strong></td>
    </tr>`;
  }).join('');
}

// ---------------------------------------------------------------------
// V53.3 – lernende Zuchtschau-Grundwertprognose mit Modellprüfung
// ---------------------------------------------------------------------
const ZS_FEATURES = [
  { key:'gp', label:'GP' },
  { key:'ext', label:'Ext' },
  { key:'extpct', label:'Ext%' },
  { key:'int', label:'Int' },
  { key:'ext_x_extpct', label:'Ext×Ext%' },
  { key:'gp_sq', label:'GP²' },
  { key:'extpct_sq', label:'Ext%²' },
  { key:'disease', label:'Erbkrankheit' },
];

function zsTrainingStatus(horse) {
  if (typeof plannerBreedingShowTrainingStatus === 'function') return plannerBreedingShowTrainingStatus(horse);
  return {eligible:false,reason:'model-unavailable'};
}

function buildBreedingShowModel() {
  return typeof plannerBuildBreedingShowModel === 'function'
    ? plannerBuildBreedingShowModel(TP_ALL_HORSES)
    : {n:0,training:[],exclusions:{},featureInfo:{keys:[],risky:0,clear:0},predict:()=>null,coefficients:null,diagnostics:null,candidates:[],selectedCandidate:null};
}

function zsModelDataBand(n) {
  if (n<15) return 'experimentell';
  if (n<30) return 'erste brauchbare Tendenz';
  if (n<50) return 'brauchbare Datenbasis';
  if (n<100) return 'gute Datenbasis';
  return 'deutlich stabilere Datenbasis';
}

function zsFormulaText(model) {
  if (!model?.fit) return '';
  const parts=[`Grundwert ≈ ${model.intercept.toFixed(1)}`];
  model.fit.featureKeys.forEach((key,i)=>{
    const label=ZS_FEATURES.find(f=>f.key===key)?.label || key;
    const c=model.coefficients[i];
    parts.push(`${c>=0?'+':'−'} ${Math.abs(c).toFixed(4).replace(/0+$/,'').replace(/\.$/,'')} × ${label}`);
  });
  return parts.join(' ');
}

function zsCoefficientDirectionWarnings(model) {
  if (!model?.fit || !Array.isArray(model.coefficients)) return [];
  const expected={gp:1,ext:-1,extpct:1,int:-1,disease:-1};
  const warnings=[];
  model.fit.featureKeys.forEach((key,i)=>{
    const coefficient=Number(model.coefficients[i]);
    if (!Number.isFinite(coefficient) || Math.abs(coefficient)<0.0001 || !expected[key]) return;
    if (Math.sign(coefficient)!==expected[key]) warnings.push(ZS_FEATURES.find(f=>f.key===key)?.label || key);
  });
  return warnings;
}

function zsModelComparisonHtml(model) {
  const rows=Array.isArray(model?.candidates) ? model.candidates : [];
  if (!rows.length) return '';
  const selectedId=model.selectedCandidate?.id;
  const nearBestIds=new Set(model?.selectionInfo?.nearBestIds || []);
  const tolerancePct=((Number(model?.selectionInfo?.tolerance)||0)*100).toFixed(0);
  const exactBestId=model?.selectionInfo?.exactBestCandidate?.id || null;
  return `<details class="zs-model-comparison-details"><summary><strong>Getestete Modellvarianten vergleichen</strong></summary>
    <div class="table-wrap"><table class="detail-table zs-model-comparison-table"><thead><tr><th>Modell</th><th>MAE</th><th>RMSE</th><th>R²</th><th>Spearman</th><th>λ</th></tr></thead><tbody>${rows.map(row=>{
      const m=row.metrics || {};
      const selected=row.candidate?.id===selectedId;
      const nearBest=nearBestIds.has(row.candidate?.id);
      const exactBest=row.candidate?.id===exactBestId;
      const marker=selected?'✓ ':nearBest?'≈ ':'';
      const meta=[nearBest?`innerhalb ${tolerancePct}% RMSE-Toleranz`:'', exactBest && !selected?'reines RMSE-Minimum':''].filter(Boolean).join(' · ');
      return `<tr${selected?' class="zs-model-selected"':''}><td>${marker}<strong>${plannerEscape(row.candidate?.label||'Modell')}</strong><br><span class="tiny muted">${plannerEscape(row.candidate?.description||'')}${meta?` · ${plannerEscape(meta)}`:''}</span></td><td>${Number.isFinite(m.mae)?m.mae.toFixed(0):'–'}</td><td><strong>${Number.isFinite(m.rmse)?m.rmse.toFixed(0):'–'}</strong></td><td>${Number.isFinite(m.r2)?m.r2.toFixed(2):'–'}</td><td>${Number.isFinite(m.spearman)?m.spearman.toFixed(2):'–'}</td><td>${row.lambda??'–'}</td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="tiny muted">Automatische Auswahl: Das niedrigste RMSE setzt die Referenz. Modelle bis ${tolerancePct}% darüber gelten als prognostisch praktisch gleichwertig; innerhalb dieser Gruppe werden fachlich gerichtete Modelle und danach einfachere Modelle ohne unnötige Zusatzterme bevorzugt. MAE und RMSE lösen verbleibende Gleichstände. ✓ = verwendet, ≈ = innerhalb der Toleranz.</p>
  </details>`;
}

function zsOutlierDiagnosticsHtml(model) {
  const observations=Array.isArray(model?.diagnostics?.cv?.observations) ? model.diagnostics.cv.observations : [];
  if (!observations.length) return '';
  const top=[...observations]
    .filter(row=>Number.isFinite(Number(row?.absError)))
    .sort((a,b)=>Number(b.absError)-Number(a.absError))
    .slice(0,10);
  if (!top.length) return '';
  return `<details class="zs-outlier-details"><summary><strong>Größte Kreuzvalidierungs-Abweichungen</strong></summary>
    <p class="tiny muted">Die Prognose jedes hier gezeigten Pferdes stammt aus einem Test-Fold, in dem dieses Pferd nicht zum Lernen verwendet wurde. Die Tabelle dient zur Fehlersuche und verändert das Modell nicht automatisch.</p>
    <div class="table-wrap"><table class="detail-table zs-outlier-table"><thead><tr><th>Pferd</th><th>GP</th><th>Ext</th><th>Ext%</th><th>Int</th><th>ZS-Grundwert</th><th>CV-Prognose</th><th>Abweichung</th></tr></thead><tbody>${top.map(row=>{
      const h=row.horse || {};
      const x=row.x || {};
      const learning=typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(h);
      const horseName=plannerEscape(h.name || '(ohne Name)');
      const horseCell=learning
        ? `<strong>${horseName}</strong><br><span class="tiny muted">Lerndatei</span>`
        : `<a href="view.html?id=${encodeURIComponent(h.id)}"><strong>${horseName}</strong></a>${h.owner?`<br><span class="tiny muted">${plannerEscape(h.owner)}</span>`:''}`;
      const diff=Number(row.difference);
      return `<tr><td>${horseCell}</td><td>${Number.isFinite(Number(x.gp))?Number(x.gp).toFixed(0):'–'}</td><td>${Number.isFinite(Number(x.ext))?Number(x.ext).toFixed(2):'–'}</td><td>${Number.isFinite(Number(x.extpct))?Number(x.extpct).toFixed(2)+' %':'–'}</td><td>${Number.isFinite(Number(x.int))?Number(x.int).toFixed(2):'–'}</td><td>${Number.isFinite(Number(row.actual))?Math.round(Number(row.actual)):'–'}</td><td>${Number.isFinite(Number(row.predicted))?Math.round(Number(row.predicted)):'–'}</td><td><strong>${Number.isFinite(diff)?`${diff>=0?'+':''}${Math.round(diff)}`:'–'}</strong></td></tr>`;
    }).join('')}</tbody></table></div>
  </details>`;
}

function renderBreedingShowOverview() {
  const body=document.getElementById('tp-zs-body');
  if (!body) return;
  const model=TP_ZS_MODEL || (TP_ZS_MODEL=buildBreedingShowModel());
  const info=document.getElementById('tp-zs-model-info');
  const formula=document.getElementById('tp-zs-model-formula');
  const comparison=document.getElementById('tp-zs-model-comparison');
  if (info) {
    const ex=model.exclusions || {};
    const waiting=[];
    if (ex.missingSnapshot) waiting.push(`${ex.missingSnapshot} ZS-Datensätze ohne historischen Bonus-Snapshot`);
    if (ex.missingFeatures) waiting.push(`${ex.missingFeatures} ZS-Datensätze mit unvollständigen GP/Ext/Ext%/Int-Daten`);
    if (model.n<8) {
      info.innerHTML=`Lernmodell: <strong>n=${model.n}</strong> verwertbare echte Zuchtschau-Grundwerte. Ab n=8 startet eine vorsichtige Prognose.${waiting.length?` Noch nicht im Lernmodell: ${waiting.join(' · ')}.`:''}`;
    } else {
      const cv=model.diagnostics?.cv;
      const diseaseUnknown=model.featureInfo?.unknownDisease || 0;
      const diseaseNote=model.featureInfo?.keys?.includes('disease')
        ? `Erbkrankheit wird mitgelernt (${model.featureInfo.risky} betroffen / ${model.featureInfo.clear} sicher unauffällig).`
        : `Erbkrankheit wird aktuell nicht als Koeffizient gelernt (${model.featureInfo?.risky||0} betroffen / ${model.featureInfo?.clear||0} sicher unauffällig / ${diseaseUnknown} unbekannt; mindestens 3 je Gruppe und kein unbekannter EKH-Status in der Modellstichprobe).`;
      const baseline=cv?.baseline;
      const improvement=Number(cv?.improvementRmsePct);
      const comparisonText=cv && baseline
        ? ` · Ø-Baseline: MAE ${baseline.mae.toFixed(0)}, RMSE ${baseline.rmse.toFixed(0)}${Number.isFinite(improvement)?` · Modell ${improvement>=0?'<strong>'+Math.abs(improvement).toFixed(0)+'% besser</strong>':Math.abs(improvement).toFixed(0)+'% schlechter'} als Durchschnitt (RMSE)`:''}`
        : '';
      const rankText=Number.isFinite(cv?.spearman) ? `, Spearman <strong>${cv.spearman.toFixed(2)}</strong>` : '';
      const quality=cv ? ` · Kreuzvalidierung: MAE <strong>${cv.mae.toFixed(0)} Punkte</strong>, RMSE <strong>${cv.rmse.toFixed(0)}</strong>${cv.r2==null?'':`, R² ${cv.r2.toFixed(2)}`}${rankText}${comparisonText}` : '';
      const selected=model.selectedCandidate?.label || 'Modell';
      const directionWarnings=zsCoefficientDirectionWarnings(model);
      const directionNote=directionWarnings.length
        ? ` Gewählte Variante zeigt bei ${directionWarnings.join(', ')} eine ungewohnte Teilkoeffizientenrichtung; wegen der Korrelation von Ext und Ext% ist das kein automatischer Ausschluss, die Kreuzvalidierung entscheidet.`
        : ' Die Kernkoeffizientenrichtungen der gewählten Variante sind fachlich plausibel.';
      const tolerancePct=((Number(model.selectionInfo?.tolerance)||0)*100).toFixed(0);
      const exactBest=model.selectionInfo?.exactBestCandidate?.label || selected;
      const toleranceNote=model.selectionInfo && model.selectionInfo.exactBestCandidate?.id!==model.selectedCandidate?.id
        ? ` Auswahl mit ${tolerancePct}% RMSE-Toleranz: ${plannerEscape(selected)} wird als fachlich stabilere, praktisch gleich gute Variante gegenüber dem reinen RMSE-Minimum ${plannerEscape(exactBest)} bevorzugt.`
        : ` Auswahlregel: ${tolerancePct}% RMSE-Toleranz mit Vorrang für fachlich gerichtete und einfachere gleichwertige Modelle.`;
      info.innerHTML=`Lernmodell: <strong>n=${model.n}</strong> · <strong>${zsModelDataBand(model.n)}</strong> · ausgewählt: <strong>${plannerEscape(selected)}</strong>${quality} · λ=${model.lambda}.<br><span class="tiny">${diseaseNote}${directionNote}${toleranceNote}${waiting.length?` Nicht zum Lernen verwendet: ${waiting.join(' · ')}.`:''}</span>`;
    }
  }
  if (formula) {
    formula.innerHTML=model.fit
      ? `<strong>Formel des automatisch gewählten Modells:</strong> ${plannerEscape(zsFormulaText(model))}<br><span class="muted">Ext und Ext% bleiben getrennte Eingangsgrößen. Zusatzterme werden nur verwendet, wenn sie in der Kreuzvalidierung besser prognostizieren.</span>`
      : 'Noch keine Formel – mindestens 8 verwertbare ZS-Datensätze nötig.';
  }
  if (comparison) comparison.innerHTML=zsModelComparisonHtml(model)+zsOutlierDiagnosticsHtml(model);

  const nameQ=(document.getElementById('tp-zs-name')?.value || '').trim().toLowerCase();
  const selectedOwners=[...document.querySelectorAll('#tp-zs-owners input[type="checkbox"]:checked')].map(cb=>cb.value);
  const selectedOwnerKeys=new Set(selectedOwners.map(tpOwnerKey));
  const breed=document.getElementById('tp-zs-breed')?.value || '';
  const only=document.getElementById('tp-zs-only')?.value || 'with';
  const breeding=document.getElementById('tp-zs-breeding')?.value || '';

  // V54.0.18: Im Modus „ZS-Auswertung“ erscheinen ausschließlich Pferde
  // mit einer echten, positiven ZS-Punktangabe. 0/leer = ZS-Wert unbekannt
  // bzw. nicht mehr abrufbar. Der separate Prognose-Modus bleibt erhalten,
  // damit Pferde ohne echten ZS-Wert weiterhin mit dem unveränderten Modell
  // prognostiziert werden können.
  let candidates=TP_ALL_HORSES.filter(h=>{
    if (typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(h)) return false;
    const total=plannerBreedingShowPoints(h);
    if (only==='with' && total==null) return false;
    if (only==='forecast') {
      // V54.0.28: Die ZS-Prognose bleibt bis zum manuellen Eintrag eines
      // echten positiven ZS-Werts gültig. Alter und Fohlenstatus spielen
      // dafür keine Rolle; auch 6-, 7- oder 8-jährige Pferde bleiben in
      // der Prognoseliste, solange kein echter ZS-Wert vorliegt.
      if (total!=null) return false;
    }
    if (!selectedOwnerKeys.has(tpOwnerKey(h.owner))) return false;
    if (nameQ && !(h.name||'').toLowerCase().includes(nameQ)) return false;
    if (breed && (normalizeBreed(h.breed)||'Rasselos')!==breed) return false;
    if (breeding==='yes' && h.breeding_allowed!==true) return false;
    if (breeding==='no' && h.breeding_allowed!==false) return false;
    if (breeding==='unknown' && h.breeding_allowed!=null) return false;
    return true;
  });

  // Der ZS-Grundwert verwendet den beim ZS-Eintrag eingefrorenen historischen
  // Turnier-/Cup-Snapshot. Spätere Turniererfolge verändern ihn nicht mehr.
  let rows=candidates;
  if (only==='forecast') {
    rows.sort((a,b)=>{
      const ap=model.predict(a), bp=model.predict(b);
      if (ap==null && bp==null) return (a.name||'').localeCompare(b.name||'','de');
      if (ap==null) return 1;
      if (bp==null) return -1;
      return bp-ap || (a.name||'').localeCompare(b.name||'','de');
    });
  } else {
    rows.sort((a,b)=>(plannerBreedingShowPoints(b)??-1)-(plannerBreedingShowPoints(a)??-1) || (a.name||'').localeCompare(b.name||'','de'));
  }

  const count=document.getElementById('tp-zs-count');
  if (count) count.textContent=only==='forecast'
    ? `${rows.length} Pferde ohne echten ZS-Wert`
    : `${rows.length} ZS-Datensätze angezeigt`;
  if (!rows.length) {
    body.innerHTML=only==='forecast'
      ? '<tr><td colspan="7" class="muted">Keine passenden Pferde ohne echten ZS-Wert gefunden.</td></tr>'
      : '<tr><td colspan="7" class="muted">Keine passenden auswertbaren ZS-Datensätze. Für die ZS-Auswertung zählen nur positive echte ZS-Punktangaben.</td></tr>';
    return;
  }
  body.innerHTML=rows.map(h=>{
    const total=plannerBreedingShowPoints(h);
    const snapshot=typeof plannerBreedingShowSnapshot === 'function' ? plannerBreedingShowSnapshot(h) : null;
    const turnier=snapshot ? Number(snapshot.tournament_bonus || 0) : plannerTournamentShowBonus(h);
    const cup=snapshot ? Number(snapshot.cup_bonus || 0) : plannerCupShowBonus(h);
    const base=plannerBreedingShowBase(h);
    const pred=model.predict(h);
    const diff=base==null || pred==null ? null : base-pred;
    const st=zsTrainingStatus(h);
    let dataNote='';
    if (only==='forecast' && pred==null) {
      const forecastReason = model.n < 8
        ? 'Noch keine Prognose – mindestens 8 verwertbare echte ZS-Datensätze nötig'
        : (typeof plannerBreedingShowFeatureObject === 'function' && !plannerBreedingShowFeatureObject(h))
          ? 'Prognose nicht möglich – GP/Ext/Ext%/Int unvollständig'
          : 'Prognose derzeit nicht berechenbar';
      dataNote=`<br><span class="tiny warning-text">${plannerEscape(forecastReason)}</span>`;
    } else if (only!=='forecast' && !st.eligible) {
      const map={
        'missing-features':'Grundwerte unvollständig – nicht im Lernmodell',
        'missing-snapshot':'Historischer ZS-Bonusstand fehlt – bitte Datensatz einmal speichern',
        'invalid-base':'ZS-Grundwert unplausibel – bitte prüfen',
      };
      if (map[st.reason]) dataNote=`<br><span class="tiny warning-text">${plannerEscape(map[st.reason])}</span>`;
    }
    return `<tr>
      <td><a href="view.html?id=${encodeURIComponent(h.id)}"><strong>${plannerEscape(h.name || '(ohne Name)')}</strong></a><br><span class="tiny muted">${plannerEscape(h.owner || '')}</span>${dataNote}</td>
      <td>${total==null?'–':Math.round(total)}</td><td>${turnier}</td><td>${cup}</td><td>${base==null?'–':Math.round(base)}</td>
      <td>${pred==null?'–':Math.round(pred)}</td><td>${diff==null?'–':`${diff>=0?'+':''}${Math.round(diff)}`}</td>
    </tr>`;
  }).join('');
}
