
let TP_HORSES = [];
let TP_ALL_HORSES = [];
let TP_SELECTED = null;
let TP_TOURNAMENT_REFERENCES = {};
let TP_ZS_MODEL = null;
let TP_LK_REFERENCE_MODEL = null;
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

  const thresholdInput = document.getElementById('tp-secondary-threshold');
  if (thresholdInput) thresholdInput.value = String(plannerTournamentAbsoluteMin(150));
  TP_TOURNAMENT_REFERENCES = plannerBuildTournamentReferences(TP_ALL_HORSES, tournamentScore);
  TP_LK_REFERENCE_MODEL = buildLkReferenceModel(TP_ALL_HORSES);

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
  document.getElementById('tp-owner').innerHTML =
    '<option value="">Alle</option>' +
    owners.map(o => `<option value="${plannerEscape(o)}">${plannerEscape(o)}</option>`).join('');

  refreshTournamentBreedFilters();

  const allBreeds = [...new Set(TP_HORSES.map(h => normalizeBreed(h.breed) || 'Rasselos'))]
    .sort((a,b) => a.localeCompare(b,'de'));
  document.getElementById('tp-horse-breed').innerHTML = '<option value="">Alle</option>' +
    allBreeds.map(b => `<option value="${plannerEscape(b)}">${plannerEscape(b)}</option>`).join('');

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

function refreshTournamentBreedFilters() {
  const owner=document.getElementById('tp-owner')?.value || '';
  const rows=owner ? TP_HORSES.filter(h=>tpOwnerKey(h.owner)===tpOwnerKey(owner)) : TP_HORSES;
  const breeds=[...new Set(rows.map(h=>normalizeBreed(h.breed)||'Rasselos'))]
    .sort((a,b)=>a.localeCompare(b,'de'));
  setTournamentBreedOptions('tp-breed',breeds);
  setTournamentBreedOptions('tp-table-breed',breeds);
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

function refreshTournamentHorseSelect() {
  const breed = document.getElementById('tp-horse-breed')?.value || '';
  const current = document.getElementById('tp-horse')?.value || '';
  const horses = TP_HORSES.filter(h => !breed || (normalizeBreed(h.breed) || 'Rasselos') === breed);

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
  document.getElementById('tp-run').addEventListener('click', renderTournamentRanking);
  document.getElementById('tp-reset').addEventListener('click', resetTournamentFilters);

  document.getElementById('tp-secondary-threshold').addEventListener('input', (event) => {
    const threshold = tournamentSecondaryThreshold();
    if (event.currentTarget && Number(event.currentTarget.value) < MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN) {
      event.currentTarget.value = String(threshold);
    }
    plannerSetTournamentAbsoluteMin(threshold);
    renderTournamentRanking();
    renderHorseTournamentOptions();
  });

  ['tp-discipline','tp-lk','tp-breed'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderTournamentRanking);
  });
  document.getElementById('tp-owner').addEventListener('change', () => {
    refreshTournamentBreedFilters();
    renderTournamentRanking();
  });

  document.getElementById('tp-horse-breed').addEventListener('change', () => {
    refreshTournamentHorseSelect();
    renderHorseTournamentOptions();
  });

  ['tp-points-min','tp-interior-max'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderTournamentRanking);
  });

  document.getElementById('tp-horse').addEventListener('change', renderHorseTournamentOptions);
  document.getElementById('tp-horse-points-min').addEventListener('input', renderHorseTournamentOptions);
  document.getElementById('tp-horse-lk').addEventListener('change', renderHorseTournamentOptions);

  // Direkte Tabellenfilter im Einzelpferd-Rechner
  ['tp-horse-table-discipline','tp-horse-table-points','tp-horse-table-interior'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderHorseTournamentOptions);
  });
  document.querySelectorAll('#tp-horse-table-lks input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', renderHorseTournamentOptions);
  });
  document.getElementById('tp-horse-table-reset').addEventListener('click', resetHorseTableFilters);

  // Direkte Tabellenfilter in der Gesamtliste
  ['tp-table-horse','tp-table-discipline','tp-table-points','tp-table-interior'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderTournamentRanking);
  });
  document.getElementById('tp-table-breed').addEventListener('change', renderTournamentRanking);
  document.querySelectorAll('#tp-table-lks input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', renderTournamentRanking);
  });
  document.getElementById('tp-table-reset').addEventListener('click', resetRankingTableFilters);

}


function selectedLks(containerId) {
  return [...document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)]
    .map(cb => cb.value);
}

function resetHorseTableFilters() {
  document.getElementById('tp-horse-table-discipline').value = '';
  document.getElementById('tp-horse-table-points').value = '';
  document.getElementById('tp-horse-table-interior').value = '';
  document.querySelectorAll('#tp-horse-table-lks input[type="checkbox"]').forEach(cb => cb.checked = false);
  renderHorseTournamentOptions();
}

function resetRankingTableFilters() {
  document.getElementById('tp-table-horse').value = '';
  document.getElementById('tp-table-discipline').value = '';
  document.getElementById('tp-table-points').value = '';
  document.getElementById('tp-table-interior').value = '';
  document.getElementById('tp-table-breed').value = '';
  document.querySelectorAll('#tp-table-lks input[type="checkbox"]').forEach(cb => cb.checked = false);
  renderTournamentRanking();
}

function resetTournamentFilters() {
  document.getElementById('tp-points-min').value = '';
  document.getElementById('tp-interior-max').value = '';
  document.getElementById('tp-lk').value = '';
  document.getElementById('tp-owner').value = '';
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
  const el = document.getElementById('tp-secondary-threshold');
  const value = Number(el?.value);
  return Number.isFinite(value) ? Math.max(MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN, value) : plannerTournamentAbsoluteMin(150);
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
  const secondaryGood = !isMainGroup && points >= tournamentSecondaryThreshold();

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

function tpQuantile(values, q) {
  const sorted=(values || []).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos=(sorted.length-1)*Math.max(0,Math.min(1,Number(q)));
  const lo=Math.floor(pos), hi=Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi]-sorted[lo])*(pos-lo);
}

function tpMean(values) {
  const clean=(values || []).map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((a,b)=>a+b,0)/clean.length : null;
}

function tpMainReferenceSample(horse) {
  const group=detectHorseMainGroup(horse);
  if (!group) return null;
  const rows=Object.entries(MDR_TOURNAMENT_DISCIPLINES)
    .filter(([,def])=>def.group === group)
    .map(([name])=>tournamentScore(horse,name))
    .filter(row=>row?.complete && Number.isFinite(Number(row.points)) && row.lk);
  if (!rows.length) return null;
  rows.sort((a,b)=>Number(b.points)-Number(a.points) || plannerLKRank(a.lk)-plannerLKRank(b.lk));
  const best=rows[0];
  return {
    horseId: horse.id,
    horseName: horse.name || '',
    group,
    discipline: best.discipline,
    lk: best.lk,
    points: Number(best.points),
  };
}

function tpEqualGroupCdf(groupArrays, value) {
  const arrays=(groupArrays || []).filter(arr=>Array.isArray(arr) && arr.length);
  if (!arrays.length) return null;
  const score=Number(value);
  if (!Number.isFinite(score)) return null;
  const shares=arrays.map(arr=>arr.filter(v=>Number(v) <= score).length / arr.length);
  return shares.reduce((a,b)=>a+b,0) / shares.length;
}

function tpEqualGroupQuantile(groupArrays, q) {
  const arrays=(groupArrays || []).filter(arr=>Array.isArray(arr) && arr.length);
  const values=[...new Set(arrays.flat().map(Number).filter(Number.isFinite))].sort((a,b)=>a-b);
  if (!values.length) return null;
  for (const value of values) {
    if ((tpEqualGroupCdf(arrays,value) || 0) >= q) return value;
  }
  return values[values.length-1];
}

function buildLkReferenceModel(horses) {
  const samples=(horses || []).map(tpMainReferenceSample).filter(Boolean);
  const byLk={};
  const groupRows=[];
  const lkOrder=['LK10','LK9','LK8','LK7','LK6','LK5','LK4','LK3','LK2','LK1'];

  for (const lk of lkOrder) {
    const lkRows=samples.filter(row=>row.lk === lk);
    if (!lkRows.length) continue;
    const byGroup=new Map();
    lkRows.forEach(row=>{
      if (!byGroup.has(row.group)) byGroup.set(row.group,[]);
      byGroup.get(row.group).push(Number(row.points));
    });
    const groups=[...byGroup.entries()].sort((a,b)=>a[0].localeCompare(b[0],'de'));
    groups.forEach(([group,values])=>groupRows.push({
      group, lk, n:values.length,
      mean:tpMean(values), p25:tpQuantile(values,.25), median:tpQuantile(values,.5), p75:tpQuantile(values,.75),
    }));

    const stableGroups=groups.filter(([,values])=>values.length >= 3).map(([,values])=>values.slice());
    const pooled=lkRows.map(row=>Number(row.points));
    const equalWeighted=stableGroups.length >= 2;
    byLk[lk]={
      lk, n:lkRows.length, groupCount:groups.length, stableGroupCount:stableGroups.length, equalWeighted,
      mean: equalWeighted ? tpMean(stableGroups.map(tpMean)) : tpMean(pooled),
      p25: equalWeighted ? tpEqualGroupQuantile(stableGroups,.25) : tpQuantile(pooled,.25),
      median: equalWeighted ? tpEqualGroupQuantile(stableGroups,.5) : tpQuantile(pooled,.5),
      p75: equalWeighted ? tpEqualGroupQuantile(stableGroups,.75) : tpQuantile(pooled,.75),
      cdf: value => equalWeighted
        ? tpEqualGroupCdf(stableGroups,value)
        : (pooled.length ? pooled.filter(v=>v <= Number(value)).length / pooled.length : null),
    };
  }
  return {samples,byLk,groupRows};
}

function tournamentRelativePercentile(evalRow) {
  if (!evalRow?.lk || !Number.isFinite(Number(evalRow.points))) return null;
  const ref=TP_LK_REFERENCE_MODEL?.byLk?.[evalRow.lk];
  if (!ref || typeof ref.cdf !== 'function') return null;
  const p=ref.cdf(Number(evalRow.points));
  return p == null || !Number.isFinite(p) ? null : Math.max(0,Math.min(100,Math.round(p*100)));
}

function tournamentRelativeHtml(evalRow) {
  const p=tournamentRelativePercentile(evalRow);
  if (p == null) return '<span class="muted">–</span>';
  return `<span class="tp-relative-link" title="P${p}: höher als etwa ${p} % der Hauptbegabungs-Referenz derselben LK">P${p}</span>`;
}

function renderTournamentStats() {
  const body=document.getElementById('tp-stats-body');
  const groupBody=document.getElementById('tp-stats-group-body');
  const basis=document.getElementById('tp-stats-basis');
  if (!body || !groupBody || !basis) return;
  const model=TP_LK_REFERENCE_MODEL || {samples:[],byLk:{},groupRows:[]};
  const order=['LK10','LK9','LK8','LK7','LK6','LK5','LK4','LK3','LK2','LK1'];
  const fmt=v=>v==null?'–':String(Math.round(Number(v)));
  const rows=order.map(lk=>model.byLk?.[lk]).filter(Boolean);
  body.innerHTML=rows.length ? rows.map(row=>`<tr>
    <th>${plannerEscape(row.lk)}</th><td>${row.n}</td><td>${row.groupCount}</td>
    <td><strong>${fmt(row.mean)}</strong></td><td>${fmt(row.p25)}</td><td>${fmt(row.median)}</td><td>${fmt(row.p75)}</td>
  </tr>`).join('') : '<tr><td colspan="7" class="muted">Noch keine geeigneten Hauptbegabungs-Referenzen.</td></tr>';

  const groupRank=new Map((MDR_TOURNAMENT_GROUP_ORDER || []).map((g,i)=>[g,i]));
  const lkRank=new Map(order.map((lk,i)=>[lk,i]));
  const groupRows=(model.groupRows || []).slice().sort((a,b)=>
    (lkRank.get(a.lk) ?? 99)-(lkRank.get(b.lk) ?? 99) ||
    (groupRank.get(a.group) ?? 99)-(groupRank.get(b.group) ?? 99) ||
    a.group.localeCompare(b.group,'de')
  );
  groupBody.innerHTML=groupRows.length ? groupRows.map(row=>`<tr>
    <th>${plannerEscape(row.group)}</th><td>${plannerEscape(row.lk)}</td><td>${row.n}</td>
    <td><strong>${fmt(row.mean)}</strong></td><td>${fmt(row.p25)}</td><td>${fmt(row.median)}</td><td>${fmt(row.p75)}</td>
  </tr>`).join('') : '<tr><td colspan="7" class="muted">Keine Gruppendaten.</td></tr>';

  const horseCount=new Set((model.samples || []).map(r=>String(r.horseId ?? r.horseName))).size;
  const weightedCount=rows.filter(r=>r.equalWeighted).length;
  basis.textContent=`${horseCount} Referenzpferde · ${weightedCount} LK-Stufen mit gleich gewichteten Hauptgruppen`;
}

function tournamentDataQualityBadge(horse) {
  return typeof dataQualityBadgeHtml === 'function' ? dataQualityBadgeHtml(horse) : '';
}

function renderTournamentRanking() {
  const disciplineName = document.getElementById('tp-discipline').value;
  const pointsMinRaw = document.getElementById('tp-points-min').value;
  const interiorMaxRaw = document.getElementById('tp-interior-max').value;
  const lkFilter = document.getElementById('tp-lk').value;
  const owner = document.getElementById('tp-owner').value;
  const breed = document.getElementById('tp-breed').value;

  const pointsMin = pointsMinRaw === '' ? null : Number(pointsMinRaw);
  const interiorMax = interiorMaxRaw === '' ? null : Number(interiorMaxRaw);

  // Zusätzliche Filter direkt an der Tabelle
  const tableHorse = document.getElementById('tp-table-horse').value.trim().toLowerCase();
  const tableDiscipline = document.getElementById('tp-table-discipline').value.trim().toLowerCase();
  const tablePointsRaw = document.getElementById('tp-table-points').value;
  const tableInteriorRaw = document.getElementById('tp-table-interior').value;
  const tablePoints = tablePointsRaw === '' ? null : Number(tablePointsRaw);
  const tableInterior = tableInteriorRaw === '' ? null : Number(tableInteriorRaw);
  const tableBreed = document.getElementById('tp-table-breed').value;
  const tableLks = selectedLks('tp-table-lks');

  let rows = TP_HORSES.map(horse => ({
    horse,
    eval: tournamentScore(horse, disciplineName),
  }))
  .filter(row => row.eval?.complete);

  rows = rows.filter(({horse, eval}) => {
    if (owner && horse.owner !== owner) return false;
    if (breed && (normalizeBreed(horse.breed) || 'Rasselos') !== breed) return false;
    if (pointsMin != null && eval.points < pointsMin) return false;
    if (interiorMax != null && (eval.interior == null || eval.interior > interiorMax)) return false;
    if (lkFilter && eval.lk !== lkFilter) return false;

    // Tabellenfilter wirken zusätzlich
    if (tableHorse) {
      const haystack = `${horse.name || ''} ${horse.owner || ''}`.toLowerCase();
      if (!haystack.includes(tableHorse)) return false;
    }
    if (tableDiscipline && !eval.discipline.toLowerCase().includes(tableDiscipline)) return false;
    if (tableBreed && (normalizeBreed(horse.breed) || 'Rasselos') !== tableBreed) return false;
    if (tablePoints != null && eval.points < tablePoints) return false;
    if (tableInterior != null && (eval.interior == null || eval.interior > tableInterior)) return false;
    if (tableLks.length && !tableLks.includes(eval.lk)) return false;

    return true;
  });

  // Wichtigster Faktor = Punkte.
  // Bei Gleichstand besseres Interieur, dann bessere LK.
  rows.sort((a,b) => {
    const p = b.eval.points - a.eval.points;
    if (p) return p;

    const ai = a.eval.interior ?? 99;
    const bi = b.eval.interior ?? 99;
    if (ai !== bi) return ai - bi;

    return plannerLKRank(a.eval.lk) - plannerLKRank(b.eval.lk);
  });

  const totalRows=rows.length;
  if (rows.length > 1) {
    const keep=Math.ceil(rows.length/2);
    const cutoffPoints=Number(rows[keep-1]?.eval?.points);
    let end=keep;
    while (end < rows.length && Number(rows[end]?.eval?.points) === cutoffPoints) end++;
    rows=rows.slice(0,end);
  }

  document.getElementById('tp-title').textContent =
    `Turnierwerte – ${disciplineName || 'Disziplin'}`;

  document.getElementById('tp-count').textContent = totalRows
    ? `${rows.length} von ${totalRows} · obere 50 %${rows.length > Math.ceil(totalRows/2) ? ' inkl. Gleichstand' : ''}`
    : '0 Pferde';

  // Ab mehr als 20 Treffern bekommt nur die sichtbare Rangliste eine Scrollbar.
  const scrollBox = document.getElementById('tp-ranking-scroll');
  scrollBox.classList.toggle('tournament-scroll-20', rows.length > 20);

  const tbody = document.getElementById('tp-ranking-body');

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted">Keine Pferde für diese Filter gefunden.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(({horse, eval}, index) => {
    const reference = TP_TOURNAMENT_REFERENCES[eval.discipline] || null;
    const proof = plannerTournamentProof(horse, eval.discipline);
    const suitability = plannerTournamentSuitability(eval, reference, tournamentSecondaryThreshold(), {
      isMainGroup: eval.isMainGroup === true,
      mainMin: MDR_TOURNAMENT_MAIN_MIN,
      proof,
    });
    const provenText = proof.proven ? ' · bewährt' : '';
    let label = '';
    if (eval.isMainGroup && suitability.suitable) {
      label = `<span class="planner-badge tournament-main-badge">Hauptdisziplin · geeignet${provenText}</span>`;
    } else if (eval.isMainGroup) {
      label = `<span class="muted small">Hauptdisziplin · ${plannerEscape(suitability.reason)} (${Math.round(suitability.minimum)} P.)</span>`;
    } else if (suitability.suitable) {
      label = `<span class="planner-badge tournament-secondary-badge">geeignete Option${provenText}</span>`;
    } else {
      label = `<span class="muted small">${plannerEscape(suitability.reason)} (${Math.round(suitability.minimum)} P.)</span>`;
    }

    return `
      <tr>
        <td>${index + 1}</td>
        <td>
          <a href="view.html?id=${encodeURIComponent(horse.id)}"><strong>${plannerEscape(horse.name || '(ohne Name)')}</strong></a> ${tournamentDataQualityBadge(horse)}
          <br><span class="muted small">${plannerEscape(horse.breed || 'ohne Rasse')} · ${plannerEscape(horse.game_version || 'DE')}${horse.owner ? ` · ${plannerEscape(horse.owner)}` : ''}</span>
        </td>
        <td>${plannerEscape(eval.discipline)}</td>
        <td><strong>${Math.round(eval.points)}</strong></td>
        <td>${eval.interior == null ? '–' : eval.interior.toFixed(2)}</td>
        <td>${plannerEscape(eval.lk || '–')}</td>
        <td>${label}</td>
      </tr>
    `;
  }).join('');
}

function tournamentProfileSubset(profile, subsetRows) {
  const rows = Array.isArray(subsetRows) ? subsetRows : [];
  const suitableRows = rows.filter(r => r.suitable);
  const mainGroup = profile?.mainGroup || null;

  const groups = (MDR_TOURNAMENT_GROUP_ORDER || [])
    .map(group => {
      const groupRows = suitableRows.filter(r => r.group === group);
      if (!groupRows.length) return null;
      const avgPoints = groupRows.reduce((sum, r) => sum + Number(r.points), 0) / groupRows.length;
      const provenCount = groupRows.filter(r => r.proven).length;
      return {
        group,
        rows: groupRows,
        count: groupRows.length,
        avgPoints,
        provenCount,
        provisional: false,
        isMain: group === mainGroup,
      };
    })
    .filter(Boolean);

  const main = groups.find(g => g.group === mainGroup) || {
    group: mainGroup, rows: [], count: 0, avgPoints: null, provenCount: 0, provisional: false, isMain: true,
  };
  const alternatives = groups
    .filter(g => g.group !== mainGroup && g.count >= 2)
    .sort((a,b) => b.count-a.count || b.provenCount-a.provenCount || b.avgPoints-a.avgPoints);
  const singleAlternatives = groups
    .filter(g => g.group !== mainGroup && g.count === 1)
    .sort((a,b) => b.provenCount-a.provenCount || b.avgPoints-a.avgPoints);

  let recommendation = 'Keine klare Turnierempfehlung';
  if (mainGroup && main.count >= 2) recommendation = 'Hauptdisziplin sinnvoll';
  else if (alternatives.length) recommendation = 'Alternative prüfen';
  else if (mainGroup && main.count === 1) recommendation = 'Hauptdisziplin mit Einzelstärke';
  else if (!mainGroup && groups.some(g => g.count >= 2)) recommendation = 'Geeignete Turniergruppe gefunden';

  return {
    ...profile,
    rows,
    suitableRows,
    groups,
    main,
    alternatives,
    singleAlternatives,
    recommendation,
    best: rows[0] || null,
    bestSuitable: suitableRows[0] || null,
  };
}

function renderHorseTournamentOptions() {
  const id = document.getElementById('tp-horse').value;
  const horse = TP_HORSES.find(h => String(h.id) === String(id)) || null;
  TP_SELECTED = horse;

  const root = document.getElementById('tp-horse-options');
  const summary = document.getElementById('tp-horse-summary');

  if (!horse) {
    summary.innerHTML = '';
    root.innerHTML = '<p class="muted">Bitte ein Pferd auswählen.</p>';
    return;
  }

  const pointsMinRaw = document.getElementById('tp-horse-points-min').value;
  const lkFilter = document.getElementById('tp-horse-lk').value;
  const pointsMin = pointsMinRaw === '' ? null : Number(pointsMinRaw);

  const tableDiscipline = document.getElementById('tp-horse-table-discipline').value.trim().toLowerCase();
  const tablePointsRaw = document.getElementById('tp-horse-table-points').value;
  const tableInteriorRaw = document.getElementById('tp-horse-table-interior').value;
  const tablePoints = tablePointsRaw === '' ? null : Number(tablePointsRaw);
  const tableInterior = tableInteriorRaw === '' ? null : Number(tableInteriorRaw);
  const tableLks = selectedLks('tp-horse-table-lks');

  const profile = plannerAnalyzeTournamentProfile(horse, TP_ALL_HORSES, tournamentScore, {
    absoluteMin: tournamentSecondaryThreshold(),
    references: TP_TOURNAMENT_REFERENCES,
  });
  const allRows = profile.rows;

  if (!allRows.length) {
    summary.innerHTML = '';
    root.innerHTML = '<p class="muted">Für dieses Pferd fehlen noch vollständige Turnier-Potenzialwerte.</p>';
    return;
  }

  // V54.0.14: Im Einzelpferd-Rechner wirken ALLE sichtbaren Filter auf
  // dieselbe Ergebnismenge. Das betrifft Empfehlung, Hauptgruppenübersicht,
  // geeignete Disziplinen, Kopiertext und die 28er-Detailtabelle gleichermaßen.
  // So kann z. B. LK10 sowohl oben als auch in den Tabellenfiltern gewählt werden,
  // ohne dass darunter weiterhin LK8-Werte stehen bleiben.
  const profileRows = allRows.filter(r => {
    if (pointsMin != null && r.points < pointsMin) return false;
    if (lkFilter && r.lk !== lkFilter) return false;
    if (tableDiscipline && !r.discipline.toLowerCase().includes(tableDiscipline)) return false;
    if (tablePoints != null && r.points < tablePoints) return false;
    if (tableInterior != null && (r.interior == null || r.interior > tableInterior)) return false;
    if (tableLks.length && !tableLks.includes(r.lk)) return false;
    return true;
  });
  const visibleProfile = tournamentProfileSubset(profile, profileRows);
  const rows = profileRows;

  const best = visibleProfile.best;
  const topFilterActive = pointsMin != null || Boolean(lkFilter) || Boolean(tableDiscipline) || tablePoints != null || tableInterior != null || tableLks.length > 0;
  const bestLabel = topFilterActive ? 'Beste gefilterte Disziplin' : 'Beste Disziplin';
  const mainLabel = visibleProfile.mainGroup || 'unbekannt';
  const alt = visibleProfile.alternatives[0] || null;
  const alternativeText = alt
    ? `${plannerEscape(alt.group)} · ${alt.count} geeignete Disziplinen${alt.provenCount ? ` · ${alt.provenCount} bewährt` : ''}`
    : 'keine';

  summary.innerHTML = `
    <div class="planner-summary tournament-recommendation-card selectable-copy-area">
      <div class="tournament-recommendation-head">
        <div>
          <h3><a href="view.html?id=${encodeURIComponent(horse.id)}">${plannerEscape(horse.name || '(ohne Name)')}</a></h3>
          <p class="tournament-recommendation-line"><strong>Empfehlung:</strong> ${plannerEscape(visibleProfile.recommendation)}</p>
        </div>
        <button type="button" class="secondary small" id="tp-copy-recommendation">Für Notizen kopieren</button>
      </div>
      <p><strong>Hauptdisziplin:</strong> ${plannerEscape(mainLabel)}${best ? ` · <strong>${bestLabel}:</strong> ${plannerEscape(best.discipline)} ${Math.round(best.points)} · Int ${best.interior == null ? '–' : best.interior.toFixed(2)} · ${plannerEscape(best.lk || 'LK –')} · ${tournamentRelativeHtml(best)}` : ' · <span class="muted">keine Disziplin entspricht den oberen Filtern</span>'}</p>
      <p class="small"><strong>Alternative:</strong> ${alternativeText}</p>
      <p class="tiny muted">Grenzen: Haupt ${Math.round(visibleProfile.mainMin)} P. · Neben ${Math.round(visibleProfile.secondaryMin)} P.</p>
      <details class="tp-relative-help tp-relative-help-inline"><summary><span class="tp-info-dot">i</span> Relative Stärke</summary><p class="tiny">P72 = höher als etwa 72 % der Hauptbegabungs-Referenz derselben LK. Nur Vergleich; Empfehlung unverändert.</p></details>
    </div>`;

  const groupRows = visibleProfile.groups.length
    ? visibleProfile.groups.map(g => {
        const statusBase = g.isMain ? 'Hauptdisziplin' : g.count >= 2 ? 'Alternative prüfen' : 'Einzeloption';
        const status = `${statusBase}${g.provenCount ? ` · ${g.provenCount} bewährt` : ''}`;
        return `<tr><th>${plannerEscape(g.group)}</th><td><strong>${g.count}</strong></td><td>${plannerEscape(status)}</td></tr>`;
      }).join('')
    : '<tr><td colspan="3" class="muted">Keine Hauptgruppe mit geeigneter Disziplin.</td></tr>';

  const suitableRows = visibleProfile.suitableRows.length
    ? visibleProfile.suitableRows.map(r => `<tr>
        <th>${plannerEscape(r.discipline)}${r.proven ? ' <span class="planner-badge tournament-secondary-badge">bewährt</span>' : ''}</th>
        <td>${plannerEscape(r.group)}</td>
        <td><strong>${Math.round(r.points)}</strong></td>
        <td>${r.interior == null ? '–' : r.interior.toFixed(2)}</td>
        <td>${plannerEscape(r.lk || '–')}</td>
        <td>${tournamentRelativeHtml(r)}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="muted">Keine geeignete Disziplin erkannt.</td></tr>';

  const fullRows = rows.length
    ? rows.map((r, index) => {
        let label = '';
        const proofText = r.proven ? ' · bewährt' : '';
        const refText = plannerEscape(plannerReferenceLabel(r.reference));
        if (r.suitable && r.group === visibleProfile.mainGroup) label = `<span class="planner-badge tournament-main-badge">geeignet · Hauptdisziplin${proofText}</span><br><span class="tiny muted">${refText}</span>`;
        else if (r.suitable) label = `<span class="planner-badge tournament-secondary-badge">geeignet${proofText}</span><br><span class="tiny muted">${refText}</span>`;
        else label = `<span class="muted small">${plannerEscape(r.suitability?.reason || 'nicht geeignet')} (${Math.round(r.suitability?.minimum || 0)} P.)</span><br><span class="tiny muted">${refText}</span>`;
        return `<tr>
          <td>${index + 1}</td>
          <th>${plannerEscape(r.discipline)}</th>
          <td>${plannerEscape(r.group)}</td>
          <td><strong>${Math.round(r.points)}</strong></td>
          <td>${r.interior == null ? '–' : r.interior.toFixed(2)}</td>
          <td>${plannerEscape(r.lk || '–')}</td>
          <td>${tournamentRelativeHtml(r)}</td>
          <td>${label}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="8" class="muted">Keine Disziplin entspricht den gewählten Tabellenfiltern.</td></tr>';

  root.innerHTML = `
    <section class="tournament-compact-section selectable-copy-area">
      <h3>Hauptgruppenübersicht</h3>
      <div class="table-wrap"><table class="detail-table tournament-group-overview">
        <thead><tr><th>Hauptgruppe</th><th>Geeignet</th><th>Einordnung</th></tr></thead>
        <tbody>${groupRows}</tbody>
      </table></div>
    </section>

    <section class="tournament-compact-section selectable-copy-area">
      <div class="tournament-section-head"><h3>Geeignete Disziplinen</h3><button type="button" class="secondary small" id="tp-copy-suitable">Geeignete Disziplinen kopieren</button></div>
      <div class="table-wrap"><table class="detail-table tournament-suitable-table">
        <thead><tr><th>Disziplin</th><th>Gruppe</th><th>Punkte</th><th>Int</th><th>LK</th><th>Relative Stärke <span class="tp-info-dot" title="P72 = höher als etwa 72 % der Hauptbegabungs-Referenz derselben LK">i</span></th></tr></thead>
        <tbody>${suitableRows}</tbody>
      </table></div>
    </section>

    <details class="tournament-all-details">
      <summary>Alle 28 Disziplinen anzeigen</summary>
      <div class="table-wrap"><table class="detail-table tournament-all-table">
        <thead><tr><th>#</th><th>Disziplin</th><th>Gruppe</th><th>Punkte</th><th>Interieur</th><th>LK</th><th>Relativ</th><th>Einordnung</th></tr></thead>
        <tbody>${fullRows}</tbody>
      </table></div>
    </details>
  `;

  document.getElementById('tp-copy-recommendation')?.addEventListener('click', e => plannerCopyText(plannerTournamentCopyText(visibleProfile), e.currentTarget));
  document.getElementById('tp-copy-suitable')?.addEventListener('click', e => plannerCopyText(plannerSuitableTournamentCopyText(visibleProfile), e.currentTarget));
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

function cupUpcomingDays(limit=10, refDate=new Date()) {
  const now=cupLocalDateOnly(refDate);
  const cursor=new Date(now);
  const rows=[];
  let guard=0;
  while (rows.length < limit && guard < 75) {
    const day=cursor.getDate();
    if (day >= 1 && day <= MDR_CUP_DISCIPLINE_ORDER.length) {
      rows.push({
        date:new Date(cursor),
        day,
        discipline:MDR_CUP_DISCIPLINE_ORDER[day-1],
      });
    }
    cursor.setDate(cursor.getDate()+1);
    guard++;
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
  const rows=cupUpcomingDays(10,now);
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

function renderCupAchievements() {
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
