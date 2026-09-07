document.addEventListener('DOMContentLoaded', init);

async function init() {
  const session = await requireSession();
  if (!session) return;
  await renderSharedNav(session);
  wireForm();
  wireCheckDropdowns();
  populateCheckDropdown('d-tag-drop', getHorseTagOptions().map((t) => t.label), { noneOption: 'Kein Schlagwort' });
  await populateFilterOptions();
  document.querySelector('#d-owner-drop .checkdrop-panel').addEventListener('change', calculate);
  document.querySelector('#d-tag-drop .checkdrop-panel').addEventListener('change', calculate);
  await populateCompareHorseOptions();
  await renderSavedDashboardTiles();
  await calculate();
}

async function populateFilterOptions() {
  const data = (await localGetAll(LOCAL_STORES.horses)).filter(h => !(typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(h)));

  populateCheckDropdown('d-owner-drop', activeBreederOptions(data.map((d) => d.owner)));
  fillSelect('#d-gender', [...new Set(data.map((d) => d.gender).filter(Boolean))].sort());

  // Nur Rassen anbieten, die tatsächlich in der lokalen Datenbank vorkommen.
  // Die Anzahl steht direkt dabei, damit sofort sichtbar ist, welche Basis
  // der Durchschnitt bei Auswahl dieser Rasse verwendet.
  const breedCounts = new Map();
  for (const h of data) {
    const breed = normalizeBreed(h.breed);
    if (!breed) continue;
    breedCounts.set(breed, (breedCounts.get(breed) || 0) + 1);
  }
  const breedOptions = [...breedCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'de'))
    .map(([value, count]) => ({ value, label: `${value} (${count})` }));
  fillSelect('#d-breed', breedOptions);
}

function fillSelect(selector, values) {
  const sel = document.querySelector(selector);
  for (const item of values) {
    const opt = document.createElement('option');
    if (typeof item === 'object') {
      opt.value = item.value;
      opt.textContent = item.label;
    } else {
      opt.value = item;
      opt.textContent = item;
    }
    sel.appendChild(opt);
  }
}

function computeDerived(h) {
  const gpRaw = h.tournament_potential?.['Gesamtpotenzial'];
  return {
    gp: gpRaw != null && gpRaw !== '' ? Number(gpRaw) : null,
    extAvg: averageScore(h.exterior_descriptive, scoreExteriorTerm),
    extPercent: h.exterior_genetics?.overall?.percent ?? null,
    intAvg: averageScore(h.temperament, scoreTemperamentTerm),
  };
}

function average(values) {
  const nums = values.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  if (!nums.length) return { avg: null, count: 0 };
  return { avg: nums.reduce((a, b) => a + b, 0) / nums.length, count: nums.length };
}

function fmtStat(stat, suffix, total) {
  if (stat.avg == null) return '-';
  const note = stat.count === total
    ? ''
    : ` <span class="muted small">(aus ${stat.count} von ${total} Pferden mit Wert)</span>`;
  return `${stat.avg.toFixed(2)}${suffix}${note}`;
}

function renderBreedingDashboard(rows) {
  const root = document.getElementById('breeding-dashboard');
  if (!root) return;
  const total = rows.length;
  if (!total) { root.innerHTML = '<p class="muted">Keine Pferde im aktuellen Filter.</p>'; return; }

  const groups = Object.fromEntries(MDR_TOURNAMENT_GROUP_ORDER.map(g => [g,{total:0,talents:Object.fromEntries((MDR_TOURNAMENT_GROUPS[g]||[]).map(t=>[t,0]))}]));
  let unknown = 0;
  for (const horse of rows) {
    const talent = plannerHorseTalent(horse);
    const group = plannerHorseMainGroup(horse);
    if (!group || !groups[group]) { unknown++; continue; }
    groups[group].total++;
    if (talent && Object.prototype.hasOwnProperty.call(groups[group].talents,talent)) groups[group].talents[talent]++;
  }

  root.innerHTML = `<div class="breeding-dashboard-grid">${MDR_TOURNAMENT_GROUP_ORDER.map(group => {
    const g=groups[group];
    const talentRows=Object.entries(g.talents);
    const max=Math.max(0,...talentRows.map(([,n])=>n));
    const low=talentRows.filter(([,n])=>max>0 && n < max*.45).map(([name])=>name);
    return `<section class="breeding-dashboard-group">
      <h3>${escapeHtml(group)} <span>${g.total}</span></h3>
      <div class="talent-counts">${talentRows.map(([name,n])=>`<span class="${low.includes(name)?'talent-low':''}">${escapeHtml(name)} <strong>${n}</strong></span>`).join('')}</div>
      ${low.length && g.total ? `<p class="tiny muted">Wenig vertreten: ${low.map(escapeHtml).join(', ')}</p>` : ''}
    </section>`;
  }).join('')}</div>${unknown ? `<p class="tiny muted">${unknown} Pferde ohne eindeutig erkannte Begabung/Hauptgruppe.</p>` : ''}`;
}

function localAverageFilter(rows) {
  const owners = getCheckDropdownSelected('d-owner-drop');
  const gender = document.querySelector('#d-gender').value;
  const breed = document.querySelector('#d-breed').value;
  const zzl = document.querySelector('#d-zzl').value;
  const tagSelected = getCheckDropdownSelected('d-tag-drop');

  return rows.filter((h) => {
    if (owners.length && !owners.includes(h.owner)) return false;
    if (gender && h.gender !== gender) return false;

    const normalizedBreed = normalizeBreed(h.breed) || 'Rasselos';
    if (breed && normalizedBreed !== breed) return false;

    if (zzl === 'true' && h.breeding_allowed !== true) return false;
    if (zzl === 'false' && h.breeding_allowed === true) return false;

    if (tagSelected.length && !matchesTags(h, tagSelected)) return false;
    return true;
  });
}

async function calculate() {
  const resultEl = document.querySelector('#avg-result');
  resultEl.innerHTML = '<p class="muted small">Lade…</p>';

  try {
    const allData = await localGetAll(LOCAL_STORES.horses);
    const activeData = allData.filter(h => isActiveBreeder(h.owner) && !(typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(h)));
    const data = localAverageFilter(activeData);

    if (!data.length) {
      resultEl.innerHTML = '<p>Keine Pferde gefunden.</p>';
      renderBreedingDashboard([]);
      return;
    }

    renderBreedingDashboard(data);
    const derived = data.map(computeDerived);
    const total = data.length;
    const gp = average(derived.map((d) => d.gp));
    const ext = average(derived.map((d) => d.extAvg));
    const extpct = average(derived.map((d) => d.extPercent));
    const intAvg = average(derived.map((d) => d.intAvg));

    resultEl.innerHTML = `
      <table class="detail-table">
        <tbody>
          <tr><th>Gefilterte Pferde</th><td><strong>${total}</strong></td></tr>
          <tr><th>Ø GP</th><td>${fmtStat(gp, '', total)}</td></tr>
          <tr><th>Ø Ext</th><td>${fmtStat(ext, '', total)}</td></tr>
          <tr><th>Ø Ext%</th><td>${fmtStat(extpct, '%', total)}</td></tr>
          <tr><th>Ø Int</th><td>${fmtStat(intAvg, '', total)}</td></tr>
        </tbody>
      </table>
    `;
  } catch (error) {
    resultEl.innerHTML = `<p class="error">Fehler beim Laden: ${escapeHtml(error.message)}</p>`;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function wireForm() {
  const form = document.querySelector('#avg-filter-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    calculate();
  });

  // Besitzer, Rasse, Geschlecht und ZZL rechnen sofort neu.
  form.querySelectorAll('select').forEach((el) => {
    el.addEventListener('change', calculate);
  });

  document.querySelector('#avg-reset').addEventListener('click', () => {
    form.reset();
    resetCheckDropdown('d-owner-drop');
    resetCheckDropdown('d-tag-drop');
    calculate();
  });
}


function dashboardCupStar(row) {
  if (Object.values(row?.tournament_results || {}).some(r=>r?.cup_star===true)) return true;
  return (row?.tags||[]).some(t=>(typeof t==='string'?t:t?.label)==='Cupstern');
}
const DASHBOARD_LOCUS_CHECK={Extension:v=>v.includes('E'),Dun:v=>v.includes('D'),Champagne:v=>v.includes('Ch'),Grey:v=>v.includes('G'),Silver:v=>v.includes('Z'),Overo:v=>v.includes('O'),Splashed:v=>v.includes('SPL'),Appaloosa:v=>v.includes('Lp'),PATN1:v=>v.includes('P1'),Agouti:v=>/Ap|A1|At/.test(v),Cream:v=>/Cr|pl/.test(v),KIT:v=>!!v&&!/^0+$/.test(v)};
function dashboardMatchesGenetic(row,locusName){
  const genes=()=>presentGenesSummary(row.colors,row.coat_color,row.notes,row.name,null,row.color_gene_overrides);
  if(locusName==='__pearl__'){const raw=(row.colors||[]).find(c=>c.label==='Cream');return !!((raw&&!isUntestedLocusValue(raw.value)&&/pl/i.test(raw.value))||genes().some(g=>g.locus==='Cream'&&/pl/i.test(g.alleles)));}
  if(locusName==='__pearl_doubled__'){const raw=(row.colors||[]).find(c=>c.label==='Cream');return !!((raw&&!isUntestedLocusValue(raw.value)&&/^plpl$/i.test(raw.value))||genes().some(g=>g.locus==='Cream'&&/^plpl$/i.test(g.alleles)));}
  if(locusName==='__flaxen__')return genes().some(g=>g.locus==='Flaxen'); if(locusName==='__flaxen_doubled__')return genes().some(g=>g.locus==='Flaxen'&&/^flfl$/i.test(g.alleles));
  const kit={__kit_sb__:'sb',__kit_rn__:'rn',__kit_to__:'to'}; if(kit[locusName]){const raw=(row.colors||[]).find(c=>c.label==='KIT');return !!raw&&!isUntestedLocusValue(raw.value)&&new RegExp(kit[locusName],'i').test(raw.value);}
  const entry=(row.colors||[]).find(c=>c.label===locusName); if(!entry||isUntestedLocusValue(entry.value))return false; return DASHBOARD_LOCUS_CHECK[locusName]?DASHBOARD_LOCUS_CHECK[locusName](entry.value):false;
}
function dashboardAffectedDiseases(row){const clear=v=>{const c=String(v||'').replace(/\//g,'');return c===''||/^N+$/.test(c);};const diseases=(row.genetic_diseases||[]).filter(d=>!isUntestedLocusValue(d.value));const tested=diseases.filter(d=>!clear(d.value)).map(d=>d.label);const codes=new Set(diseases.map(d=>d.label));const ov=row.disease_gene_overrides||{};return [...tested,...Object.keys(ov).filter(code=>(ov[code]==='het'||ov[code]==='hom')&&!codes.has(code))];}
function dashboardMatchesEkh(row,selected){return selected.some(code=>code==='__none__'?row.disease_free===true:dashboardAffectedDiseases(row).includes(code));}
function dashboardTriState(v){return typeof normalizeTriStateSavedState==='function'?normalizeTriStateSavedState(v):(Array.isArray(v)?{include:v,exclude:[]}:{include:[],exclude:[]});}
function dashboardCompare(value,op,target){if(target==null||target==='')return true;if(value==null||!Number.isFinite(Number(value)))return false;return op==='lt'?Number(value)<Number(target):Number(value)>Number(target);}
function dashboardPresetFilter(rows,filters,breedingContext,preferredBreeds){const f=filters||{},tags=dashboardTriState(f.tags),gen=dashboardTriState(f.genetik),ekh=dashboardTriState(f.ekh);return rows.filter(row=>{
  if(f.name&&!String(row.name||'').toLowerCase().includes(String(f.name).toLowerCase()))return false;if(f.owner&&row.owner!==f.owner)return false;if(f.gender&&row.gender!==f.gender)return false;
  const breed=normalizeBreed(row.breed)||'Rasselos';if(f.breed==='__preferred__'&&Array.isArray(preferredBreeds)&&preferredBreeds.length&&!preferredBreeds.includes(breed))return false;if(f.breed&&f.breed!=='__preferred__'&&breed!==f.breed)return false;
  if(f.gameVersion&&(row.game_version||'DE')!==f.gameVersion)return false;if(f.zzl==='true'&&row.breeding_allowed!==true)return false;if(f.zzl==='false'&&row.breeding_allowed===true)return false;if(f.cupStarOnly&&!dashboardCupStar(row))return false;
  if(f.dataQuality&&typeof analyzeHorseDataQuality==='function'){const level=analyzeHorseDataQuality(row).level;if(f.dataQuality==='not-complete'?level==='green':level!==f.dataQuality)return false;}
  if(gen.include.length&&!gen.include.every(v=>dashboardMatchesGenetic(row,v)))return false;if(gen.exclude.some(v=>dashboardMatchesGenetic(row,v)))return false;if(ekh.include.length&&!dashboardMatchesEkh(row,ekh.include))return false;if(ekh.exclude.length&&dashboardMatchesEkh(row,ekh.exclude))return false;if(tags.include.length&&!matchesTags(row,tags.include))return false;if(tags.exclude.length&&matchesTags(row,tags.exclude))return false;
  const d=computeDerived(row);if(!dashboardCompare(d.gp,f.gpOp||'gt',f.gpVal))return false;if(!dashboardCompare(d.extAvg,f.extOp||'gt',f.extVal))return false;if(!dashboardCompare(d.extPercent,f.extpctOp||'gt',f.extpctVal))return false;if(!dashboardCompare(d.intAvg,f.intOp||'gt',f.intVal))return false;
  if(f.bestFoalMode&&f.bestFoalMode!=='off'&&breedingContext&&typeof bpBestFoalInfo==='function'){const isBest=bpBestFoalInfo(row,breedingContext).anyBest;if(f.bestFoalMode==='only'&&!isBest)return false;if(f.bestFoalMode==='exclude'&&isBest)return false;}return true;});}
function dashboardTileValue(rows,metric){if(metric==='count')return String(rows.length);const d=rows.map(computeDerived),field={gp:'gp',ext:'extAvg',extpct:'extPercent',int:'intAvg'}[metric]||'gp',stat=average(d.map(x=>x[field]));return stat.avg==null?'–':`${stat.avg.toFixed(2)}${metric==='extpct'?'%':''}`;}
async function renderSavedDashboardTiles(){const section=document.getElementById('dashboard-saved-tiles-section'),root=document.getElementById('dashboard-saved-tiles');if(!section||!root)return;const settings=await localGet(LOCAL_STORES.userSettings,'settings')||{},tiles=Array.isArray(settings.dashboard_tiles)?settings.dashboard_tiles:[];if(!tiles.length){section.hidden=true;return;}const[all,presets]=await Promise.all([localGetAll(LOCAL_STORES.horses),localGetAll(LOCAL_STORES.filterPresets)]);const base=all.filter(h=>isActiveBreeder(h.owner)&&!(typeof mdrIsLearningHorse==='function'&&mdrIsLearningHorse(h))),presetById=new Map(presets.map(p=>[String(p.id),p])),ctx=typeof bpBuildContext==='function'?bpBuildContext(all):null,labels={count:'Pferde',gp:'Ø GP',ext:'Ø Ext',extpct:'Ø Ext%',int:'Ø Int'};root.innerHTML=tiles.map(tile=>{const preset=presetById.get(String(tile.preset_id));if(!preset)return `<article class="dashboard-saved-tile dashboard-saved-tile-missing"><strong>${escapeHtml(tile.title||'Kachel')}</strong><span>Filtervorlage fehlt</span></article>`;const rows=dashboardPresetFilter(base,preset.filters,ctx,settings.preferred_breeds);return `<article class="dashboard-saved-tile" title="Filtervorlage: ${escapeHtml(preset.name||'')}"><span class="dashboard-tile-title">${escapeHtml(tile.title||preset.name||'Dashboard-Kachel')}</span><strong>${escapeHtml(dashboardTileValue(rows,tile.metric))}</strong><span class="dashboard-tile-caption">${escapeHtml(labels[tile.metric]||tile.metric||'')}</span></article>`;}).join('');section.hidden=false;}

async function populateCompareHorseOptions() {
  const sel = document.getElementById('compare-horse');
  if (!sel) return;
  const rows = (await localGetAll(LOCAL_STORES.horses)).filter(h => isActiveBreeder(h.owner) && !(typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(h)));
  rows.sort((a,b) => (a.name || '').localeCompare(b.name || '', 'de'));
  sel.innerHTML = '<option value="">Bitte wählen…</option>' +
    rows.map(h => `<option value="${h.id}">${escapeHtml(h.name || '(ohne Name)')} · ${escapeHtml(h.breed || 'ohne Rasse')} · ${escapeHtml(h.game_version || 'DE')}</option>`).join('');
  sel.addEventListener('change', renderBreedComparison);
}

function percentileBetter(value, values, lowerIsBetter) {
  const valid = values.filter(v => v != null && Number.isFinite(v));
  if (!valid.length || value == null) return null;
  const worse = valid.filter(v => lowerIsBetter ? v > value : v < value).length;
  return Math.round((worse / valid.length) * 100);
}

async function renderBreedComparison() {
  const root = document.getElementById('breed-compare-result');
  const id = document.getElementById('compare-horse')?.value;
  if (!id) {
    root.innerHTML = '<p class="muted small">Bitte ein Pferd auswählen.</p>';
    return;
  }

  const horses = (await localGetAll(LOCAL_STORES.horses)).filter(h => isActiveBreeder(h.owner) && !(typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(h)));
  const horse = horses.find(h => String(h.id) === String(id));
  if (!horse) return;

  // Rassen bleiben in DE/EN absichtlich unübersetzt. Deshalb nur exakt
  // gleiche Rasse UND gleiche Spielversion vergleichen.
  const peers = horses.filter(h =>
    h.id !== horse.id &&
    (h.breed || '') === (horse.breed || '') &&
    (h.game_version || 'DE') === (horse.game_version || 'DE')
  );

  const self = computeDerived(horse);
  const peerStats = peers.map(computeDerived);

  const avgPeer = (key) => average(peerStats.map(s => s[key])).avg;
  const gpAvg = avgPeer('gp');
  const extAvg = avgPeer('extAvg');
  const extPctAvg = avgPeer('extPercent');
  const intAvg = avgPeer('intAvg');

  const fmtDiff = (value, avg, lowerBetter = false, suffix = '') => {
    if (value == null || avg == null) return '–';
    const diff = value - avg;
    const sign = diff > 0 ? '+' : '';
    const good = lowerBetter ? diff < 0 : diff > 0;
    const bad = lowerBetter ? diff > 0 : diff < 0;
    return `<strong class="${good ? 'compare-good' : bad ? 'compare-bad' : ''}">${sign}${diff.toFixed(2)}${suffix}</strong>`;
  };

  const intPct = percentileBetter(self.intAvg, peerStats.map(s => s.intAvg), true);
  const gpPct = percentileBetter(self.gp, peerStats.map(s => s.gp), false);
  const extPctRank = percentileBetter(self.extPercent, peerStats.map(s => s.extPercent), false);

  root.innerHTML = `
    <p><strong>${escapeHtml(horse.name || '(ohne Name)')}</strong> vs. ${peers.length} andere Pferde der Rasse
      <strong>${escapeHtml(horse.breed || 'ohne Rasse')}</strong> (${escapeHtml(horse.game_version || 'DE')})</p>
    ${!peers.length ? '<p class="muted">Noch keine Vergleichspferde derselben Rasse/Spielversion vorhanden.</p>' : `
    <table class="detail-table">
      <thead><tr><th>Wert</th><th>Pferd</th><th>Rasse Ø</th><th>Abweichung</th><th>Einordnung</th></tr></thead>
      <tbody>
        <tr><th>GP</th><td>${self.gp ?? '–'}</td><td>${gpAvg == null ? '–' : gpAvg.toFixed(2)}</td><td>${fmtDiff(self.gp, gpAvg)}</td><td>${gpPct == null ? '–' : `besser als ${gpPct}%`}</td></tr>
        <tr><th>Ext</th><td>${self.extAvg == null ? '–' : self.extAvg.toFixed(2)}</td><td>${extAvg == null ? '–' : extAvg.toFixed(2)}</td><td>${fmtDiff(self.extAvg, extAvg, true)}</td><td>niedriger ist besser</td></tr>
        <tr><th>Ext%</th><td>${self.extPercent == null ? '–' : self.extPercent.toFixed(2) + '%'}</td><td>${extPctAvg == null ? '–' : extPctAvg.toFixed(2) + '%'}</td><td>${fmtDiff(self.extPercent, extPctAvg, false, '%')}</td><td>${extPctRank == null ? '–' : `besser als ${extPctRank}%`}</td></tr>
        <tr><th>Int</th><td>${self.intAvg == null ? '–' : self.intAvg.toFixed(2)}</td><td>${intAvg == null ? '–' : intAvg.toFixed(2)}</td><td>${fmtDiff(self.intAvg, intAvg, true)}</td><td>${intPct == null ? '–' : `besser als ${intPct}%`}</td></tr>
      </tbody>
    </table>`}
  `;
}
