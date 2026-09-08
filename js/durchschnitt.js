const durchschnittDerivedCache = new WeakMap();
let DASHBOARD_FILTER_HORSES = [];

function dashboardOwnerKey(value) { return String(value || '').trim().toLocaleLowerCase('de'); }

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const session = await requireSession();
  if (!session) return;
  await renderSharedNav(session);
  wireForm();
  wireCheckDropdowns();
  populateCheckDropdown('d-tag-drop', getHorseTagOptions().map((t) => t.label), { noneOption: 'Kein Schlagwort' });
  await populateFilterOptions();
  document.querySelector('#d-owner-drop .checkdrop-panel').addEventListener('change', async () => {
    refreshDashboardBreedOptions();
    await calculate();
  });
  document.querySelector('#d-tag-drop .checkdrop-panel').addEventListener('change', calculate);
  await populateCompareHorseOptions();
  await renderSavedDashboardTiles();
  await calculate();
}

async function populateFilterOptions() {
  const data = (await localGetAll(LOCAL_STORES.horses)).filter(h => !(typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(h)));
  DASHBOARD_FILTER_HORSES = data;

  populateCheckDropdown('d-owner-drop', activeBreederOptions(data.map((d) => d.owner)));
  fillSelect('#d-gender', [...new Set(data.map((d) => d.gender).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de')));
  refreshDashboardBreedOptions();
}

function refreshDashboardBreedOptions() {
  const sel = document.querySelector('#d-breed');
  if (!sel) return;
  const previous = sel.value;
  const owners = getCheckDropdownSelected('d-owner-drop');
  const ownerKeys = new Set(owners.map(dashboardOwnerKey));
  const rows = DASHBOARD_FILTER_HORSES.filter(h =>
    isActiveBreeder(h.owner) && (!ownerKeys.size || ownerKeys.has(dashboardOwnerKey(h.owner)))
  );
  const breedCounts = new Map();
  for (const h of rows) {
    const breed = normalizeBreed(h.breed) || 'Rasselos';
    breedCounts.set(breed, (breedCounts.get(breed) || 0) + 1);
  }
  const options = [...breedCounts.entries()]
    .sort(([a],[b]) => a.localeCompare(b,'de'));
  sel.innerHTML = '<option value="">Alle</option>' + options.map(([value,count]) => `<option value="${escapeHtml(value)}">${escapeHtml(value)} (${count})</option>`).join('');
  sel.value = options.some(([value]) => value === previous) ? previous : '';
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
  if (h && typeof h === 'object' && durchschnittDerivedCache.has(h)) return durchschnittDerivedCache.get(h);
  const gpRaw = h.tournament_potential?.['Gesamtpotenzial'];
  const derived={
    gp: gpRaw != null && gpRaw !== '' ? Number(gpRaw) : null,
    extAvg: averageScore(h.exterior_descriptive, scoreExteriorTerm),
    extPercent: h.exterior_genetics?.overall?.percent ?? null,
    intAvg: averageScore(h.temperament, scoreTemperamentTerm),
  };
  if (h && typeof h === 'object') durchschnittDerivedCache.set(h,derived);
  return derived;
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
  const ownerKeys = new Set(owners.map(dashboardOwnerKey));
  const gender = document.querySelector('#d-gender').value;
  const breed = document.querySelector('#d-breed').value;
  const zzl = document.querySelector('#d-zzl').value;
  const tagSelected = getCheckDropdownSelected('d-tag-drop');

  return rows.filter((h) => {
    if (ownerKeys.size && !ownerKeys.has(dashboardOwnerKey(h.owner))) return false;
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
      renderColorGeneticsDashboard([], allData);
      return;
    }

    renderBreedingDashboard(data);
    renderColorGeneticsDashboard(data, allData);
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
    refreshDashboardBreedOptions();
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


// --- V54.0.30 Dashboard: Farbgenetik ---------------------------------
// Explorative Bestandsstatistik. Es werden keine neuen MDR-Regeln erfunden:
// sichtbare Fellfarben und echte gespeicherte Gentests werden getrennt ausgewertet.

const DASHBOARD_COLOR_BASE_ORDER = ['Chestnut','Wild Bay','Bay','Sea Brown','Black','Grey'];
const DASHBOARD_COLOR_GENE_LOCI = [
  'Extension','Agouti','Cream','Dun','Champagne','Grey','Silver',
  'Appaloosa','PATN1','Overo','Splashed','KIT','Flaxen'
];

function dashboardColorBaseLabel(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'wildbay' || key === 'wild bay') return 'Wild Bay';
  if (key === 'sealbrown' || key === 'seal brown' || key === 'sea brown') return 'Sea Brown';
  if (key === 'chestnut') return 'Chestnut';
  if (key === 'bay') return 'Bay';
  if (key === 'black') return 'Black';
  if (key === 'grey' || key === 'gray') return 'Grey';
  return value || null;
}

function dashboardColorUniqueGeneticBase(horse) {
  if (typeof cgKnowledge !== 'function' || typeof cgBaseName !== 'function') return null;
  const ext = cgKnowledge(horse, 'Extension');
  const agouti = cgKnowledge(horse, 'Agouti');
  if (!ext?.states?.length) return null;

  // ee ist unabhängig vom Agouti-Locus sichtbar Chestnut.
  const extBases = new Set();
  for (const e of ext.states) {
    if (e.filter(x => x === 'e').length === 2) extBases.add('Chestnut');
    else if (agouti?.states?.length) {
      for (const a of agouti.states) {
        const base = cgBaseName(e, a);
        if (base) extBases.add(dashboardColorBaseLabel(base));
      }
    }
  }
  return extBases.size === 1 ? [...extBases][0] : null;
}

function dashboardColorBase(horse) {
  const coat = String(horse?.coat_color || '').trim();
  const lc = coat.toLowerCase();
  // Grey ist als sichtbare MDR-Farbgruppe relevant, selbst wenn darunter eine
  // andere genetische Grundfarbe liegt.
  if (/\bgr[ae]y\b/.test(lc)) return 'Grey';

  if (typeof cgShade === 'function') {
    const shade = cgShade(horse);
    if (shade?.base) return dashboardColorBaseLabel(shade.base);
  }
  if (/wild\s*bay|wildbay/.test(lc)) return 'Wild Bay';
  if (/seal\s*brown|sealbrown|sea\s*brown/.test(lc)) return 'Sea Brown';
  if (/chestnut|sorrel/.test(lc)) return 'Chestnut';
  if (/\bbay\b/.test(lc)) return 'Bay';
  if (/\bblack\b/.test(lc)) return 'Black';

  return dashboardColorUniqueGeneticBase(horse);
}

function dashboardColorShade(horse) {
  if (typeof cgShade === 'function') {
    const shade = cgShade(horse);
    if (shade?.shade) return { base:dashboardColorBaseLabel(shade.base), shade:shade.shade };
  }
  const base = dashboardColorBase(horse);
  const coat = String(horse?.coat_color || '').trim();
  if (!base || !coat) return null;
  // Für noch nicht im Farbguide benannte Skalen (z.B. einzelne Wild-Bay-
  // Varianten) bleibt bewusst die echte MDR-Bezeichnung aus dem Datensatz stehen.
  if (base === 'Grey') return {base, shade:'Grey'};
  if (base === 'Wild Bay' || base === 'Sea Brown') return {base, shade:coat};
  return null;
}

function dashboardCountMap(values) {
  const map = new Map();
  for (const value of values) {
    const key = String(value || '').trim();
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function dashboardSortedCounts(map) {
  return [...map.entries()].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0],'de'));
}

function dashboardColorPills(entries, total, empty='Noch keine Daten.') {
  if (!entries.length) return `<p class="muted small">${escapeHtml(empty)}</p>`;
  return `<div class="color-count-pills">${entries.map(([label,n]) => {
    const pct = total ? Math.round(n / total * 1000) / 10 : 0;
    return `<span>${escapeHtml(label)} <strong>${n}</strong><small>${pct}%</small></span>`;
  }).join('')}</div>`;
}

function dashboardColorGeneRows(horse) {
  const rows = Array.isArray(horse?.colors) ? horse.colors : [];
  return rows.filter(row => {
    const label = String(row?.label || '').trim();
    const value = String(row?.value || '').trim();
    if (!label || !value) return false;
    if (typeof cgUntested === 'function' && cgUntested(value)) return false;
    return DASHBOARD_COLOR_GENE_LOCI.includes(label);
  });
}

function dashboardShadeGeneticFingerprints(shadeGroups) {
  const summaries = new Map();
  for (const [key, group] of shadeGroups.entries()) {
    const loci = new Map();
    for (const horse of group.horses) {
      for (const row of dashboardColorGeneRows(horse)) {
        if (!loci.has(row.label)) loci.set(row.label, {tested:0, values:new Map()});
        const stat = loci.get(row.label);
        stat.tested++;
        const value = String(row.value).trim();
        stat.values.set(value, (stat.values.get(value) || 0) + 1);
      }
    }
    const modes = new Map();
    for (const [locus, stat] of loci.entries()) {
      const sorted = dashboardSortedCounts(stat.values);
      if (!sorted.length) continue;
      const [value,count] = sorted[0];
      modes.set(locus, {value,count,tested:stat.tested,share:count/stat.tested});
    }
    summaries.set(key,{...group,modes});
  }

  // Nur Marker hervorheben, deren häufigster getesteter Genotyp sich zwischen
  // Schattierungen derselben Grundfarbe tatsächlich unterscheidet.
  const varyingByBase = new Map();
  for (const base of DASHBOARD_COLOR_BASE_ORDER) {
    const baseRows = [...summaries.values()].filter(x => x.base === base && x.horses.length >= 2);
    const varying = new Set();
    for (const locus of DASHBOARD_COLOR_GENE_LOCI) {
      const values = new Set(baseRows.map(x => x.modes.get(locus)).filter(x => x && x.tested >= 2).map(x => x.value));
      if (values.size > 1) varying.add(locus);
    }
    varyingByBase.set(base,varying);
  }

  return [...summaries.values()]
    .sort((a,b) => DASHBOARD_COLOR_BASE_ORDER.indexOf(a.base)-DASHBOARD_COLOR_BASE_ORDER.indexOf(b.base) || b.horses.length-a.horses.length || a.shade.localeCompare(b.shade,'de'))
    .map(row => {
      const varying = varyingByBase.get(row.base) || new Set();
      const markers = [...row.modes.entries()]
        .filter(([locus,stat]) => varying.has(locus) && stat.tested >= 2)
        .sort((a,b) => b[1].tested-a[1].tested || b[1].share-a[1].share)
        .slice(0,4)
        .map(([locus,stat]) => `${locus} ${stat.value} ${Math.round(stat.share*100)}% (${stat.count}/${stat.tested})`);
      return {...row,markers};
    });
}

function dashboardAppaloosaAnalysis(rows) {
  const patterns = new Map();
  const combos = new Map();
  for (const horse of rows) {
    const pattern = typeof cgPatternHint === 'function' ? cgPatternHint(horse) : String(horse?.appaloosa_pattern || '').trim();
    if (pattern) patterns.set(pattern,(patterns.get(pattern)||0)+1);
    if (!pattern || typeof cgTestedAppaloosaCategories !== 'function') continue;
    const tested = cgTestedAppaloosaCategories(horse);
    if (!tested.lp || !tested.p1) continue;
    const key = `${tested.lp}|${tested.p1}`;
    if (!combos.has(key)) combos.set(key,{lp:tested.lp,p1:tested.p1,n:0,patterns:new Map()});
    const row=combos.get(key); row.n++;
    row.patterns.set(pattern,(row.patterns.get(pattern)||0)+1);
  }
  return {patterns:dashboardSortedCounts(patterns), combos:[...combos.values()].sort((a,b)=>b.n-a.n || a.lp.localeCompare(b.lp))};
}

function dashboardColorInheritance(filteredChildren, allRows) {
  if (typeof bpParentNames !== 'function') return [];
  const byName = new Map();
  for (const horse of allRows || []) {
    const key = dashboardOwnerKey(horse?.name);
    if (key && !byName.has(key)) byName.set(key,horse);
  }
  const crosses = new Map();
  for (const child of filteredChildren) {
    const {fatherName,motherName}=bpParentNames(child);
    const father=byName.get(dashboardOwnerKey(fatherName));
    const mother=byName.get(dashboardOwnerKey(motherName));
    const fatherBase=dashboardColorBase(father), motherBase=dashboardColorBase(mother), childBase=dashboardColorBase(child);
    if (!fatherBase || !motherBase || !childBase) continue;
    const key=`${motherBase}|${fatherBase}`;
    if (!crosses.has(key)) crosses.set(key,{mother:motherBase,father:fatherBase,n:0,children:new Map()});
    const row=crosses.get(key); row.n++;
    row.children.set(childBase,(row.children.get(childBase)||0)+1);
  }
  return [...crosses.values()].filter(x=>x.n>=2).sort((a,b)=>b.n-a.n).slice(0,10);
}

function renderColorGeneticsDashboard(rows, allRows) {
  const root=document.getElementById('color-genetics-dashboard');
  if (!root) return;
  if (!rows?.length) { root.innerHTML='<p class="muted">Keine Pferde im aktuellen Filter.</p>'; return; }

  const baseCounts = new Map(DASHBOARD_COLOR_BASE_ORDER.map(x=>[x,0]));
  let baseUnknown=0, coatKnown=0;
  const coatCounts=new Map(), shadeGroups=new Map();
  for (const horse of rows) {
    const coat=String(horse?.coat_color||'').trim();
    if (coat) { coatKnown++; coatCounts.set(coat,(coatCounts.get(coat)||0)+1); }
    const base=dashboardColorBase(horse);
    if (baseCounts.has(base)) baseCounts.set(base,baseCounts.get(base)+1); else baseUnknown++;
    const info=dashboardColorShade(horse);
    if (info) {
      const key=`${info.base}|${info.shade}`;
      if (!shadeGroups.has(key)) shadeGroups.set(key,{base:info.base,shade:info.shade,horses:[]});
      shadeGroups.get(key).horses.push(horse);
    }
  }
  const baseEntries=[...baseCounts.entries()].filter(([,n])=>n>0);
  if (baseUnknown) baseEntries.push(['Nicht eindeutig zugeordnet',baseUnknown]);
  const shadeRows=dashboardShadeGeneticFingerprints(shadeGroups);
  const app=dashboardAppaloosaAnalysis(rows);
  const inheritance=dashboardColorInheritance(rows,allRows||rows);

  const shadeTable = shadeRows.length ? `<div class="table-wrap"><table class="detail-table color-genetics-table"><thead><tr><th>Grundfarbe</th><th>Schattierung / Variante</th><th>n</th><th>auffällige getestete Marker</th></tr></thead><tbody>${shadeRows.map(row=>`<tr><td>${escapeHtml(row.base)}</td><td><strong>${escapeHtml(row.shade)}</strong></td><td>${row.horses.length}</td><td>${row.markers.length ? row.markers.map(escapeHtml).join('<br>') : '<span class="muted">noch kein unterscheidbarer getesteter Marker</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Noch keine eindeutig erkannten Grundfarben-Schattierungen.</p>';

  const appComboTable = app.combos.length ? `<div class="table-wrap"><table class="detail-table color-genetics-table"><thead><tr><th>LP</th><th>PATN1</th><th>n</th><th>beobachtete sichtbare Muster</th></tr></thead><tbody>${app.combos.map(row=>`<tr><td>${escapeHtml(row.lp)}</td><td>${escapeHtml(row.p1)}</td><td>${row.n}</td><td>${dashboardSortedCounts(row.patterns).map(([pattern,n])=>`${escapeHtml(pattern)} <strong>${n}</strong> (${Math.round(n/row.n*100)}%)`).join(' · ')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Noch keine Pferde mit gleichzeitig getestetem LP, getestetem PATN1 und sichtbarem Appaloosa-Muster im aktuellen Filter.</p>';

  const inheritanceTable = inheritance.length ? `<div class="table-wrap"><table class="detail-table color-genetics-table"><thead><tr><th>Mutter</th><th>Vater</th><th>verknüpfte Fohlen</th><th>beobachtete Grundfarben</th></tr></thead><tbody>${inheritance.map(row=>`<tr><td>${escapeHtml(row.mother)}</td><td>${escapeHtml(row.father)}</td><td>${row.n}</td><td>${dashboardSortedCounts(row.children).map(([color,n])=>`${escapeHtml(color)} <strong>${n}</strong> (${Math.round(n/row.n*100)}%)`).join(' · ')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Noch zu wenige verknüpfte Eltern-Fohlen-Paare mit auswertbarer Grundfarbe (mindestens 2 je Kombination).</p>';

  root.innerHTML=`
    <div class="color-genetics-grid">
      <section class="color-genetics-subcard">
        <h3>Grundfarben</h3>
        <p class="tiny muted">Sichtbare bzw. aus eindeutigem Farbgenotyp ableitbare Grundfarb-Gruppe.</p>
        ${dashboardColorPills(baseEntries,rows.length)}
      </section>
      <section class="color-genetics-subcard">
        <h3>Sichtbare Fellfarben</h3>
        <p class="tiny muted">Exakte MDR-Bezeichnungen werden bewusst nicht zusammengeführt.</p>
        ${dashboardColorPills(dashboardSortedCounts(coatCounts).slice(0,18),coatKnown,'Keine Fellfarben erfasst.')}
        ${coatCounts.size>18?`<p class="tiny muted">+ ${coatCounts.size-18} weitere Bezeichnungen im aktuellen Filter.</p>`:''}
      </section>
    </div>

    <details class="color-genetics-detail" open>
      <summary><strong>Schattierungen &amp; genetische Auffälligkeiten</strong></summary>
      <p class="small muted">Chestnut, Bay, Sea Brown und Black nutzen bereits bekannte MDR-Bezeichnungen aus dem Farbguide. Noch nicht sicher benannte Varianten bleiben bei ihrer gespeicherten Originalbezeichnung. Die Markeranalyse verwendet ausschließlich echte gespeicherte Gentests und hebt nur Unterschiede zwischen Schattierungen derselben Grundfarbe hervor.</p>
      ${shadeTable}
      <p class="tiny muted">Explorativ: Häufigkeiten können auf einen Zusammenhang hinweisen, beweisen aber noch nicht, welches Gen die MDR-Schattierung verursacht.</p>
    </details>

    <details class="color-genetics-detail">
      <summary><strong>Appaloosa · LP, PATN1 &amp; sichtbares Muster</strong></summary>
      <p class="small muted">Appaloosa-Muster werden separat betrachtet. PATN2 wird nicht angenommen oder erfunden, solange kein echter entsprechender Gentest im Datenbestand existiert.</p>
      <h4>Sichtbare Muster</h4>
      ${dashboardColorPills(app.patterns,app.patterns.reduce((s,x)=>s+x[1],0),'Keine Appaloosa-Muster im aktuellen Filter.')}
      <h4>Getestete Genetik → beobachtetes Muster</h4>
      ${appComboTable}
    </details>

    <details class="color-genetics-detail">
      <summary><strong>Beobachtete Farbvererbung</strong></summary>
      <p class="small muted">Nur tatsächlich in der Datenbank verknüpfte Eltern und Fohlen. Die Prozentwerte sind Beobachtungen des vorhandenen Bestands, keine errechneten Mendel-Wahrscheinlichkeiten.</p>
      ${inheritanceTable}
    </details>`;
}
