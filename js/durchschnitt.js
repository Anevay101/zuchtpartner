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
    if (shade?.shade) return { base:dashboardColorBaseLabel(shade.base), shade:shade.shade, orderIndex:shade.index, scaleLength:shade.scale?.length || null };
  }
  const base = dashboardColorBase(horse);
  const coat = String(horse?.coat_color || '').trim();
  if (!base || !coat) return null;
  // Für noch nicht im Farbguide benannte Skalen (z.B. einzelne Wild-Bay-
  // Varianten) bleibt bewusst die echte MDR-Bezeichnung aus dem Datensatz stehen.
  if (base === 'Grey') return {base, shade:'Grey', orderIndex:null, scaleLength:null};
  if (base === 'Wild Bay' || base === 'Sea Brown') return {base, shade:coat, orderIndex:null, scaleLength:null};
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
    .sort((a,b) => {
      const baseDiff=DASHBOARD_COLOR_BASE_ORDER.indexOf(a.base)-DASHBOARD_COLOR_BASE_ORDER.indexOf(b.base);
      if (baseDiff) return baseDiff;
      const ai=Number.isFinite(a.orderIndex)?a.orderIndex:999;
      const bi=Number.isFinite(b.orderIndex)?b.orderIndex:999;
      if (ai!==bi) return ai-bi;
      return b.horses.length-a.horses.length || a.shade.localeCompare(b.shade,'de');
    })
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


// --- V54.0.31–V54.0.36 Snowflake-Detektiv ------------------------------
// Explorative Spurensuche zum seltenen Snowflake-Muster. Die Auswertung kombiniert
// reguläre Pferde und Lerndatei-Pferde, zählt identische MDR-IDs aber nur einmal.
// V54.0.36: Die vom Nutzer bereitgestellte MDR-Patterntafel zeigt neben P1/P2 auch
// einen dritten Pattern-Locus P3. P2/P3 sind nicht als individuelle Gentests
// verfügbar; daraus abgeleitete Zustände bleiben ausschließlich Forschungsmodell
// im Dashboard und werden niemals auf Pferdeseiten gespeichert oder behauptet.

function dashboardSnowflakeStableKey(horse, fallbackIndex = 0) {
  const external = String(horse?.external_id || '').trim();
  if (external) return `mdr:${String(horse?.game_version || 'DE').toUpperCase()}:${external}`;
  if (horse?.id != null && horse?.id !== '') return `local:${String(horse.id)}`;
  return `fallback:${dashboardOwnerKey(horse?.name)}:${fallbackIndex}`;
}

function dashboardSnowflakeSource(horse) {
  return typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(horse)
    ? 'Lerndatei'
    : 'Datenbank';
}

function dashboardSnowflakeDedupedRows(allRows) {
  const map = new Map();
  (allRows || []).forEach((horse,index) => {
    if (!horse || typeof horse !== 'object') return;
    const key = dashboardSnowflakeStableKey(horse,index);
    const current = map.get(key);
    if (!current) { map.set(key,horse); return; }
    // Falls trotz Schutzmechanismen dieselbe MDR-ID mehrfach vorhanden ist,
    // bevorzugen wir den regulären Datensatz vor einer Lerndatei-Kopie.
    const currentLearning = dashboardSnowflakeSource(current) === 'Lerndatei';
    const incomingLearning = dashboardSnowflakeSource(horse) === 'Lerndatei';
    if (currentLearning && !incomingLearning) map.set(key,horse);
  });
  return [...map.values()];
}

function dashboardSnowflakePattern(horse) {
  const pattern = typeof cgPatternHint === 'function'
    ? cgPatternHint(horse)
    : String(horse?.appaloosa_pattern || '').trim();
  return String(pattern || '').trim();
}

function dashboardSnowflakeIsSnowflake(horse) {
  return /^snowflake$/i.test(dashboardSnowflakePattern(horse));
}

function dashboardSnowflakeParents(horse) {
  if (typeof bpParentNames === 'function') return bpParentNames(horse);
  return {fatherName:null,motherName:null};
}

function dashboardSnowflakePedigreeNames(horse) {
  const pedigree = horse?.pedigree;
  const raw = Array.isArray(pedigree)
    ? pedigree.slice(1)
    : Array.isArray(pedigree?.ancestors) ? pedigree.ancestors : [];
  return raw.map(x => typeof x === 'string' ? x : x?.name).map(x => String(x || '').trim()).filter(Boolean);
}

function dashboardSnowflakeNameIndex(rows) {
  const byVersionName = new Map();
  const byName = new Map();
  const push = (map,key,horse) => {
    if (!key) return;
    if (!map.has(key)) map.set(key,[]);
    map.get(key).push(horse);
  };
  for (const horse of rows || []) {
    const nameKey = dashboardOwnerKey(horse?.name);
    if (!nameKey) continue;
    push(byName,nameKey,horse);
    push(byVersionName,`${String(horse?.game_version || 'DE').toUpperCase()}|${nameKey}`,horse);
  }
  return {byVersionName,byName};
}

function dashboardSnowflakeResolveByName(name, child, index) {
  const key = dashboardOwnerKey(name);
  if (!key) return null;
  const versionKey = `${String(child?.game_version || 'DE').toUpperCase()}|${key}`;
  const sameVersion = index.byVersionName.get(versionKey) || [];
  if (sameVersion.length === 1) return sameVersion[0];
  const global = index.byName.get(key) || [];
  return global.length === 1 ? global[0] : null;
}

function dashboardSnowflakeGenotype(horse) {
  const tested = typeof cgTestedAppaloosaCategories === 'function'
    ? cgTestedAppaloosaCategories(horse)
    : {lp:null,p1:null};
  return {
    lp: tested?.lp || '–',
    p1: tested?.p1 || '–',
  };
}

function dashboardSnowflakeGeneticallyEligible(horse) {
  const g=dashboardSnowflakeGenotype(horse);
  // Aktuelle Arbeitshypothese: Snowflake wurde bislang nur bei vorhandenem LP
  // und p1p1 beobachtet. Das ist ein Forschungsfilter, keine behauptete MDR-Regel.
  const hasLp=String(g.lp || '').includes('Lp');
  return hasLp && g.p1 === 'p1p1';
}

// Forschungsmodell aus der MDR-Patterntafel (nicht als Pferdegenotyp speichern):
// P1_ -> Leopard/Few Spot; p1p1 + P2_ -> Blanket/Snowcap;
// p1p1 + p2p2 + P3_ -> Varnish Roan; p1p1 + p2p2 + p3p3 -> Snowflake.
function dashboardSnowflakePatternModel(patternOrHorse) {
  const raw = typeof patternOrHorse === 'string' ? patternOrHorse : dashboardSnowflakePattern(patternOrHorse);
  const pattern=String(raw||'').trim().toLowerCase();
  if (pattern==='snowflake') return {label:'p1p1 · p2p2 · p3p3',p1:'p1p1',p2:'p2p2',p3:'p3p3',certainty:'Musterzuordnung'};
  if (pattern==='varnish roan') return {label:'p1p1 · p2p2 · P3_',p1:'p1p1',p2:'p2p2',p3:'P3_',certainty:'Musterzuordnung'};
  if (pattern==='spotted blanket' || pattern==='blanket' || pattern==='snowcap') return {label:'p1p1 · P2_ · P3 offen',p1:'p1p1',p2:'P2_',p3:'offen',certainty:'Musterzuordnung'};
  if (pattern==='leopard' || pattern==='few spot' || pattern==='fewspot') return {label:'P1_ · P2/P3 maskiert',p1:'P1_',p2:'maskiert',p3:'maskiert',certainty:'Musterzuordnung'};
  return {label:'–',p1:'–',p2:'–',p3:'–',certainty:'offen'};
}

function dashboardSnowflakePatternModelAudit(rows,snowflakes) {
  const index=dashboardSnowflakeNameIndex(rows||[]);
  const contradictions=[];
  let snowflakeTested=0, snowflakeP1Consistent=0, parentP1Checked=0;
  for (const horse of snowflakes||[]) {
    const g=dashboardSnowflakeGenotype(horse);
    if (g.p1!=='–') {
      snowflakeTested++;
      if (g.p1==='p1p1') snowflakeP1Consistent++;
      else contradictions.push(`${horse?.name||'Snowflake'}: sichtbares Snowflake, aber PATN1-Test ${g.p1}`);
    }
    const {fatherName,motherName}=dashboardSnowflakeParents(horse);
    for (const parentName of [fatherName,motherName]) {
      const parent=dashboardSnowflakeResolveByName(parentName,horse,index);
      if (!parent) continue;
      const pg=dashboardSnowflakeGenotype(parent);
      if (pg.p1==='P1P1') {
        parentP1Checked++;
        contradictions.push(`${parent?.name||parentName}: P1P1 kann unter dem einfachen P1/P2/P3-Modell kein p1 an ein Snowflake-Fohlen geben`);
      } else if (pg.p1==='P1p1' || pg.p1==='p1p1') parentP1Checked++;
    }
  }
  return {contradictions,snowflakeTested,snowflakeP1Consistent,parentP1Checked};
}


function dashboardSnowflakeKnownPattern(horse) {
  const pattern=dashboardSnowflakePattern(horse);
  return pattern && pattern !== 'anderes / unklar' ? pattern : '';
}

function dashboardSnowflakeHasLpCategory(horse) {
  const lp=dashboardSnowflakeGenotype(horse).lp;
  return lp === 'LpLp' || lp === 'Lplp';
}

function dashboardLogChoose(n,k) {
  n=Number(n); k=Number(k);
  if (!Number.isFinite(n) || !Number.isFinite(k) || k<0 || k>n) return -Infinity;
  k=Math.min(k,n-k);
  let out=0;
  for (let i=1;i<=k;i++) out += Math.log(n-k+i)-Math.log(i);
  return out;
}

function dashboardFisherExact(a,b,c,d) {
  a=Math.max(0,Math.round(Number(a)||0));
  b=Math.max(0,Math.round(Number(b)||0));
  c=Math.max(0,Math.round(Number(c)||0));
  d=Math.max(0,Math.round(Number(d)||0));
  const r1=a+b, r2=c+d, c1=a+c, n=r1+r2;
  if (!n || !r1 || !r2 || !c1 || c1===n) return null;
  const lo=Math.max(0,c1-r2), hi=Math.min(r1,c1);
  const logDen=dashboardLogChoose(n,c1);
  const logProb=x=>dashboardLogChoose(r1,x)+dashboardLogChoose(r2,c1-x)-logDen;
  const obs=logProb(a);
  let sum=0;
  for (let x=lo;x<=hi;x++) {
    const lp=logProb(x);
    if (lp <= obs + 1e-10) sum += Math.exp(lp);
  }
  return Math.min(1,sum);
}

function dashboardOddsRatio(a,b,c,d) {
  const corrected=[a,b,c,d].some(x=>x===0);
  const k=corrected?0.5:0;
  const den=(b+k)*(c+k);
  if (!den) return {value:null,corrected};
  return {value:((a+k)*(d+k))/den,corrected};
}

function dashboardSnowflakeFormatP(p) {
  if (p==null || !Number.isFinite(p)) return '–';
  if (p<0.001) return '<0,001';
  if (p<0.01) return p.toFixed(3).replace('.',',');
  return p.toFixed(2).replace('.',',');
}

function dashboardSnowflakeControlAnalysis(rows,snowflakes) {
  const knownPatternRows=(rows||[]).filter(h=>dashboardSnowflakeKnownPattern(h));
  const controls=knownPatternRows.filter(h=>!dashboardSnowflakeIsSnowflake(h));
  const testedSnowflakes=(snowflakes||[]).filter(h=>{
    const g=dashboardSnowflakeGenotype(h);
    return (g.lp==='LpLp'||g.lp==='Lplp') && g.p1!=='–';
  });
  const testedControls=controls.filter(h=>{
    const g=dashboardSnowflakeGenotype(h);
    return (g.lp==='LpLp'||g.lp==='Lplp') && g.p1!=='–';
  });

  const comboKey=h=>{ const g=dashboardSnowflakeGenotype(h); return `${g.lp}|${g.p1}`; };
  const snowflakeCombos=new Set(testedSnowflakes.map(comboKey));
  const controlCombos=new Set(testedControls.map(comboKey));
  const comboOverlap=[...snowflakeCombos].filter(key=>controlCombos.has(key));

  const sfP1p1=testedSnowflakes.filter(h=>dashboardSnowflakeGenotype(h).p1==='p1p1').length;
  const sfP1=testedSnowflakes.length-sfP1p1;
  const ctrlP1p1=testedControls.filter(h=>dashboardSnowflakeGenotype(h).p1==='p1p1').length;
  const ctrlP1=testedControls.length-ctrlP1p1;
  const patnOr=(sfP1+ctrlP1===0 || sfP1p1+ctrlP1p1===0) ? {value:null,corrected:false} : dashboardOddsRatio(sfP1p1,sfP1,ctrlP1p1,ctrlP1);
  const patnP=dashboardFisherExact(sfP1p1,sfP1,ctrlP1p1,ctrlP1);

  const sfP1p1Rows=testedSnowflakes.filter(h=>dashboardSnowflakeGenotype(h).p1==='p1p1');
  const ctrlP1p1Rows=testedControls.filter(h=>dashboardSnowflakeGenotype(h).p1==='p1p1');
  const sfLpLp=sfP1p1Rows.filter(h=>dashboardSnowflakeGenotype(h).lp==='LpLp').length;
  const sfLplp=sfP1p1Rows.filter(h=>dashboardSnowflakeGenotype(h).lp==='Lplp').length;
  const ctrlLpLp=ctrlP1p1Rows.filter(h=>dashboardSnowflakeGenotype(h).lp==='LpLp').length;
  const ctrlLplp=ctrlP1p1Rows.filter(h=>dashboardSnowflakeGenotype(h).lp==='Lplp').length;
  const lpOr=(sfLpLp+ctrlLpLp===0 || sfLplp+ctrlLplp===0) ? {value:null,corrected:false} : dashboardOddsRatio(sfLpLp,sfLplp,ctrlLpLp,ctrlLplp);
  const lpP=dashboardFisherExact(sfLpLp,sfLplp,ctrlLpLp,ctrlLplp);

  return {
    controls,testedSnowflakes,testedControls,snowflakeCombos,controlCombos,comboOverlap,
    patn:{a:sfP1p1,b:sfP1,c:ctrlP1p1,d:ctrlP1,odds:patnOr,p:patnP},
    lpDose:{a:sfLpLp,b:sfLplp,c:ctrlLpLp,d:ctrlLplp,odds:lpOr,p:lpP},
  };
}

function dashboardSnowflakeAncestorEnrichment(snowflakes,controls) {
  const withPedigree=(horses)=> (horses||[]).map(h=>({horse:h,names:[...new Set(dashboardSnowflakePedigreeNames(h).map(dashboardOwnerKey).filter(Boolean))],display:dashboardSnowflakePedigreeNames(h)})).filter(x=>x.names.length);
  const sf=withPedigree(snowflakes||[]), ct=withPedigree(controls||[]);
  const displayNames=new Map();
  for (const group of [...sf,...ct]) {
    const raw=dashboardSnowflakePedigreeNames(group.horse);
    for (const name of raw) if (!displayNames.has(dashboardOwnerKey(name))) displayNames.set(dashboardOwnerKey(name),name);
  }
  const sfCounts=new Map(), ctCounts=new Map();
  for (const x of sf) for (const key of x.names) sfCounts.set(key,(sfCounts.get(key)||0)+1);
  for (const x of ct) for (const key of x.names) ctCounts.set(key,(ctCounts.get(key)||0)+1);
  const rows=[];
  for (const [key,sfCount] of sfCounts.entries()) {
    if (sfCount<2) continue;
    const ctrlCount=ctCounts.get(key)||0;
    const sfRate=sf.length?sfCount/sf.length:0;
    const ctrlRate=ct.length?ctrlCount/ct.length:0;
    const enrichment=((sfCount+0.5)/(sf.length+1))/((ctrlCount+0.5)/(ct.length+1));
    rows.push({name:displayNames.get(key)||key,sfCount,ctrlCount,sfN:sf.length,ctrlN:ct.length,sfRate,ctrlRate,enrichment});
  }
  rows.sort((a,b)=>b.enrichment-a.enrichment || b.sfCount-a.sfCount || a.name.localeCompare(b.name,'de'));
  return {rows:rows.slice(0,15),snowflakeN:sf.length,controlN:ct.length};
}

function dashboardSnowflakeInformativePairings(rows) {
  const index=dashboardSnowflakeNameIndex(rows||[]);
  const pairs=new Map();
  for (const child of rows||[]) {
    const {fatherName,motherName}=dashboardSnowflakeParents(child);
    const fk=dashboardOwnerKey(fatherName), mk=dashboardOwnerKey(motherName);
    if (!fk || !mk) continue;
    const key=`${fk}|${mk}`;
    if (!pairs.has(key)) pairs.set(key,{
      fatherName:String(fatherName||'').trim(), motherName:String(motherName||'').trim(), children:[]
    });
    pairs.get(key).children.push(child);
  }

  const out=[];
  for (const pair of pairs.values()) {
    const sample=pair.children[0];
    const father=dashboardSnowflakeResolveByName(pair.fatherName,sample,index);
    const mother=dashboardSnowflakeResolveByName(pair.motherName,sample,index);
    const fp=dashboardSnowflakeKnownPattern(father), mp=dashboardSnowflakeKnownPattern(mother);
    const fatherSF=father&&dashboardSnowflakeIsSnowflake(father), motherSF=mother&&dashboardSnowflakeIsSnowflake(mother);
    const knownChildren=pair.children.filter(h=>dashboardSnowflakeKnownPattern(h));
    const sfChildren=knownChildren.filter(dashboardSnowflakeIsSnowflake);
    if (!sfChildren.length && !fatherSF && !motherSF) continue;

    let type='Elternmuster offen → Snowflake';
    let rank=1;
    let note='Mehr Elterndaten nötig.';
    if (fatherSF && motherSF) {
      type='Snowflake × Snowflake'; rank=5;
      note='Sehr informativ für Vererbungs- und Dosisprüfung.';
    } else if ((fatherSF && mp && !motherSF) || (motherSF && fp && !fatherSF)) {
      type='Snowflake × Nicht-Snowflake'; rank=4;
      note='Besonders wertvoll für Dominanz-/Segregationsprüfung.';
    } else if (!fatherSF && !motherSF && fp && mp && sfChildren.length) {
      type='Nicht-Snowflake × Nicht-Snowflake → Snowflake'; rank=6;
      note='Gegenindiz für ein einfaches vollständig dominantes Ein-Faktor-Modell; mit rezessiver/komplexer Vererbung vereinbar.';
    } else if (fatherSF || motherSF) {
      type='Snowflake × Muster offen'; rank=2;
      note='Informativ, sobald das zweite Elternmuster ergänzt ist.';
    }

    const eligible=pair.children.filter(dashboardSnowflakeGeneticallyEligible);
    const eligibleKnown=eligible.filter(h=>dashboardSnowflakeKnownPattern(h));
    const eligibleSf=eligibleKnown.filter(dashboardSnowflakeIsSnowflake);
    out.push({
      ...pair,father,mother,fp,mp,type,rank,n:knownChildren.length,sf:sfChildren.length,
      rate:knownChildren.length?sfChildren.length/knownChildren.length:null,
      eligibleN:eligibleKnown.length,eligibleSf:eligibleSf.length,
      eligibleRate:eligibleKnown.length?eligibleSf.length/eligibleKnown.length:null,
      note,
    });
  }
  return out.sort((a,b)=>b.rank-a.rank || b.n-a.n || b.sf-a.sf || a.fatherName.localeCompare(b.fatherName,'de')).slice(0,20);
}

function dashboardSnowflakeHypothesisChecks(control,pairings,audit) {
  const nonNon=(pairings||[]).filter(x=>x.type==='Nicht-Snowflake × Nicht-Snowflake → Snowflake');
  const sfSf=(pairings||[]).filter(x=>x.type==='Snowflake × Snowflake');
  const lp=control?.lpDose;
  const checks=[];
  const overlap=control?.comboOverlap || [];
  checks.push({
    model:'LP + PATN1 allein',
    status:overlap.length?'nicht ausreichend':'offen',
    reason:overlap.length
      ? `Dieselben getesteten LP/PATN1-Kombinationen (${overlap.map(x=>x.replace('|',' + ')).join(', ')}) kommen auch bei Nicht-Snowflakes vor.`
      : 'Noch keine ausreichend getestete Kontrollgruppe mit derselben LP/PATN1-Kombination.'
  });
  checks.push({
    model:'MDR-Patterntafel · P1/P2/P3',
    status:audit?.contradictions?.length?'Widerspruch prüfen':'sehr gut vereinbar',
    reason:audit?.contradictions?.length
      ? `${audit.contradictions.length} Datensatz-/Modellwiderspruch/widersprüche gefunden; Details stehen direkt unter der Patterntafel.`
      : `Snowflake = p1p1 + p2p2 + p3p3 passt zu allen ${audit?.snowflakeTested||0} bislang PATN1-getesteten Snowflakes. P2/P3 bleiben mangels Gentest verborgen.`
  });
  checks.push({
    model:'LP-Dosis als Snowflake-Schalter',
    status:(lp?.a||0)>0 && (lp?.b||0)>0?'eher nein':'offen',
    reason:(lp?.a||0)>0 && (lp?.b||0)>0
      ? 'Snowflake kommt sowohl bei LpLp als auch Lplp vor; LP steuert nach der Patterntafel vor allem die jeweilige Ausprägungsvariante.'
      : 'Noch zu wenig vollständig getestete Snowflakes für eine Aussage zur LP-Dosis.'
  });
  checks.push({
    model:'verdecktes Tragen von p2 / p3',
    status:nonNon.length?'stark interessant':'offen',
    reason:nonNon.length
      ? `${nonNon.length} dokumentierte Nicht-Snowflake × Nicht-Snowflake-Paarung(en) erzeugen Snowflake. Das ist mit verdecktem p2/p3-Tragen sehr gut vereinbar.`
      : 'Nicht-Snowflake-Eltern können nach der Patterntafel p2 und/oder p3 verdeckt tragen; dafür sind mehr dokumentierte Nachkommen nötig.'
  });
  if (sfSf.length) checks.push({model:'Snowflake × Snowflake',status:'Schlüsseltest',reason:`${sfSf.length} solche Paarung(en) sind dokumentiert. Unter dem einfachen P1/P2/P3-Modell sollten LP-positive Fohlen besonders häufig bzw. vollständig Snowflake sein.`});
  return checks;
}

function dashboardSnowflakeHorseLink(horse, fallbackName = '–') {
  const name = horse?.name || fallbackName || '–';
  if (horse?.id == null || horse?.id === '') return escapeHtml(name);
  return `<a href="view.html?id=${encodeURIComponent(horse.id)}"><strong>${escapeHtml(name)}</strong></a>`;
}

function dashboardSnowflakePatternCounts(horses) {
  const counts = new Map();
  for (const horse of horses || []) {
    const pattern = dashboardSnowflakePattern(horse);
    if (!pattern) continue;
    counts.set(pattern,(counts.get(pattern)||0)+1);
  }
  return counts;
}

function dashboardSnowflakePatternSummary(horses, limit = 4) {
  const entries=dashboardSortedCounts(dashboardSnowflakePatternCounts(horses));
  if (!entries.length) return 'keine Muster erfasst';
  const shown=entries.slice(0,limit).map(([pattern,n])=>`${escapeHtml(pattern)} ${n}`).join(' · ');
  return entries.length>limit ? `${shown} · +${entries.length-limit}` : shown;
}

function dashboardSnowflakeFamilyAnalysis(rows, snowflakes) {
  const nameIndex = dashboardSnowflakeNameIndex(rows);
  const childLinks = [];
  for (const child of rows) {
    const {fatherName,motherName} = dashboardSnowflakeParents(child);
    childLinks.push({
      child,
      fatherName:String(fatherName || '').trim(),
      motherName:String(motherName || '').trim(),
      fatherKey:dashboardOwnerKey(fatherName),
      motherKey:dashboardOwnerKey(motherName),
    });
  }

  const snowflakeKeys = new Set(snowflakes.map((h,i)=>dashboardSnowflakeStableKey(h,i)));
  const snowflakeNameKeys = new Set(snowflakes.map(h=>dashboardOwnerKey(h?.name)).filter(Boolean));
  const parentCandidates = new Map();
  const snowflakeRows = [];
  let nonSnowflakeParentPairCases = 0;

  const addParentCandidate = (parentName, mateName, child, parentHorse) => {
    const key = dashboardOwnerKey(parentName);
    if (!key) return;
    if (!parentCandidates.has(key)) parentCandidates.set(key,{
      name:parentName,
      horse:parentHorse || null,
      snowflakeChildren:[],
      snowflakeMates:new Set(),
      allKnownChildren:[],
    });
    const row=parentCandidates.get(key);
    if (!row.horse && parentHorse) row.horse=parentHorse;
    row.snowflakeChildren.push(child);
    if (mateName) row.snowflakeMates.add(dashboardOwnerKey(mateName));
  };

  // Alle bekannten Nachkommen pro Elternname sammeln.
  for (const link of childLinks) {
    for (const [parentName,parentKey] of [[link.fatherName,link.fatherKey],[link.motherName,link.motherKey]]) {
      if (!parentKey) continue;
      if (!parentCandidates.has(parentKey)) continue;
      parentCandidates.get(parentKey).allKnownChildren.push(link.child);
    }
  }

  for (const snowflake of snowflakes) {
    const {fatherName,motherName}=dashboardSnowflakeParents(snowflake);
    const father=dashboardSnowflakeResolveByName(fatherName,snowflake,nameIndex);
    const mother=dashboardSnowflakeResolveByName(motherName,snowflake,nameIndex);
    addParentCandidate(fatherName,motherName,snowflake,father);
    addParentCandidate(motherName,fatherName,snowflake,mother);

    const fatherPattern=dashboardSnowflakePattern(father);
    const motherPattern=dashboardSnowflakePattern(mother);
    if (father && mother && fatherPattern && motherPattern && !/^snowflake$/i.test(fatherPattern) && !/^snowflake$/i.test(motherPattern)) {
      nonSnowflakeParentPairCases++;
    }

    const fk=dashboardOwnerKey(fatherName), mk=dashboardOwnerKey(motherName);
    const siblings = childLinks.filter(link => {
      if (link.child === snowflake) return false;
      return (fk && link.fatherKey===fk) || (mk && link.motherKey===mk);
    }).map(x=>x.child);
    const fullSiblings = childLinks.filter(link => {
      if (link.child === snowflake) return false;
      return fk && mk && link.fatherKey===fk && link.motherKey===mk;
    }).map(x=>x.child);
    const halfSiblings = siblings.filter(h => !fullSiblings.includes(h));
    const childRows = childLinks.filter(link => link.fatherKey===dashboardOwnerKey(snowflake?.name) || link.motherKey===dashboardOwnerKey(snowflake?.name)).map(x=>x.child);
    const sfChildren = childRows.filter(dashboardSnowflakeIsSnowflake);
    const sfSiblings = siblings.filter(dashboardSnowflakeIsSnowflake);

    snowflakeRows.push({
      horse:snowflake,
      fatherName,motherName,father,mother,
      fullSiblings,halfSiblings,sfSiblings,
      children:childRows,sfChildren,
    });
  }

  // Jetzt, nachdem Kandidaten bekannt sind, deren komplette Nachzucht ergänzen.
  for (const row of parentCandidates.values()) {
    const key=dashboardOwnerKey(row.name);
    row.allKnownChildren = childLinks.filter(link => link.fatherKey===key || link.motherKey===key).map(x=>x.child);
  }

  const candidates=[...parentCandidates.values()].map(row => {
    const knownPatternChildren=row.allKnownChildren.filter(h=>dashboardSnowflakePattern(h));
    const eligibleChildren=row.allKnownChildren.filter(dashboardSnowflakeGeneticallyEligible);
    const eligiblePatternChildren=eligibleChildren.filter(h=>dashboardSnowflakePattern(h));
    const eligibleSnowflakes=eligiblePatternChildren.filter(dashboardSnowflakeIsSnowflake);
    const eligibleUnknownPattern=Math.max(0,eligibleChildren.length-eligiblePatternChildren.length);
    const sfCount=row.snowflakeChildren.length;
    const mateCount=row.snowflakeMates.size;
    const parentPattern=dashboardSnowflakePattern(row.horse);
    const snowflakeRate=knownPatternChildren.length ? sfCount/knownPatternChildren.length : null;
    const eligibleSnowflakeRate=eligiblePatternChildren.length ? eligibleSnowflakes.length/eligiblePatternChildren.length : null;
    // Transparenter Evidenzscore, KEINE Genwahrscheinlichkeit. Die genetisch
    // passende Teilstichprobe darf den Score nur vorsichtig ergänzen.
    let score=Math.min(70,sfCount*25);
    if (mateCount>=2) score+=15;
    if (row.horse && parentPattern && !/^snowflake$/i.test(parentPattern)) score+=5;
    if (eligiblePatternChildren.length>=3 && eligibleSnowflakeRate!=null && eligibleSnowflakeRate>=0.25) score+=10;
    score=Math.min(100,score);
    let note='ein Snowflake-Nachkomme';
    if (sfCount>=2 && mateCount>=2) note='mehrere Snowflakes mit verschiedenen Partnern';
    else if (sfCount>=2) note='mehrere Snowflake-Nachkommen';
    else if (row.horse && parentPattern && !/^snowflake$/i.test(parentPattern)) note='nicht selbst Snowflake, aber Snowflake-Nachkomme';
    return {
      ...row,knownPatternChildren,sfCount,mateCount,snowflakeRate,score,note,
      eligibleChildren,eligiblePatternChildren,eligibleSnowflakes,
      eligibleUnknownPattern,eligibleSnowflakeRate,
    };
  }).sort((a,b)=>b.score-a.score || b.sfCount-a.sfCount || a.name.localeCompare(b.name,'de'));

  const ancestorCounts=new Map();
  for (const horse of snowflakes) {
    const unique=new Set(dashboardSnowflakePedigreeNames(horse).map(dashboardOwnerKey).filter(Boolean));
    const display=new Map(dashboardSnowflakePedigreeNames(horse).map(name=>[dashboardOwnerKey(name),name]));
    for (const key of unique) {
      if (!ancestorCounts.has(key)) ancestorCounts.set(key,{name:display.get(key)||key,count:0});
      ancestorCounts.get(key).count++;
    }
  }
  const commonAncestors=[...ancestorCounts.values()].filter(x=>x.count>=2).sort((a,b)=>b.count-a.count || a.name.localeCompare(b.name,'de')).slice(0,12);

  return {nameIndex,snowflakeRows,candidates,commonAncestors,nonSnowflakeParentPairCases};
}

function dashboardSnowflakeHypotheses(rows, snowflakes, family, control, pairings) {
  const messages=[];
  const testedCombos=new Map();
  let testedN=0;
  for (const horse of snowflakes) {
    const g=dashboardSnowflakeGenotype(horse);
    if (g.lp==='–' || g.p1==='–') continue;
    testedN++;
    const key=`${g.lp} + ${g.p1}`;
    testedCombos.set(key,(testedCombos.get(key)||0)+1);
  }
  if (testedN) {
    if (testedCombos.size===1) {
      const [[combo,n]]=[...testedCombos.entries()];
      messages.push(`<strong>LP/PATN1-Spur:</strong> Alle ${n} genetisch vollständig getesteten Snowflakes teilen aktuell <strong>${escapeHtml(combo)}</strong>. Das ist ein Hinweis, noch keine bewiesene Regel.`);
    } else {
      messages.push(`<strong>LP/PATN1-Spur:</strong> Snowflake tritt aktuell in ${testedCombos.size} verschiedenen getesteten LP/PATN1-Kombinationen auf. LP + PATN1 allein erklären das Muster damit wahrscheinlich nicht eindeutig.`);
    }
    const patn=control?.patn;
    if (patn && (patn.a+patn.b)>0 && (patn.c+patn.d)>0) {
      const sfPct=Math.round(patn.a/(patn.a+patn.b)*100);
      const ctPct=Math.round(patn.c/(patn.c+patn.d)*100);
      messages.push(`<strong>Kontrollgruppe:</strong> p1p1 liegt bei getesteten Snowflakes bei <strong>${patn.a}/${patn.a+patn.b} (${sfPct}%)</strong>, bei getesteten Nicht-Snowflake-LP-Schecken bei <strong>${patn.c}/${patn.c+patn.d} (${ctPct}%)</strong>.`);
    }
  } else {
    messages.push('<strong>LP/PATN1-Spur:</strong> Für die vorhandenen Snowflakes fehlen noch ausreichend vollständige LP/PATN1-Tests.');
  }

  if (family.nonSnowflakeParentPairCases>0) {
    messages.push(`<strong>P2/P3-Träger-Spur:</strong> ${family.nonSnowflakeParentPairCases} Snowflake-Fall/Fälle stammen aus zwei sichtbaren Nicht-Snowflake-Eltern. Das ist mit verdecktem p2/p3-Tragen nach der MDR-Patterntafel vereinbar.`);
  }
  const strong=family.candidates.filter(x=>x.sfCount>=2 && x.mateCount>=2);
  if (strong.length) {
    messages.push(`<strong>Linien-Hinweis:</strong> ${strong.slice(0,3).map(x=>escapeHtml(x.name)).join(', ')} ${strong.length===1?'taucht':'tauchen'} mit mehreren Snowflake-Nachkommen aus verschiedenen Partnern auf. Diese Linien sind besonders interessant für weitere Beobachtungen.`);
  }
  const eligibleEvidence=family.candidates
    .filter(x=>x.eligiblePatternChildren?.length>=2)
    .sort((a,b)=>(b.eligiblePatternChildren?.length||0)-(a.eligiblePatternChildren?.length||0) || (b.eligibleSnowflakeRate||0)-(a.eligibleSnowflakeRate||0))
    .slice(0,3);
  if (eligibleEvidence.length) {
    messages.push(`<strong>LP+p1p1-Nachzucht:</strong> ${eligibleEvidence.map(x=>`${escapeHtml(x.name)} ${x.eligibleSnowflakes.length}/${x.eligiblePatternChildren.length} Snowflake`).join(' · ')}. Gezählt werden nur Nachkommen mit vorhandenem LP, p1p1 und bekanntem sichtbaren Muster; das ist ein Test der aktuellen Arbeitshypothese, keine festgelegte MDR-Regel.`);
  }
  const informativeNonNon=(pairings||[]).filter(x=>x.type==='Nicht-Snowflake × Nicht-Snowflake → Snowflake');
  if (informativeNonNon.length) {
    messages.push(`<strong>Schlüssel-Paarungen:</strong> ${informativeNonNon.length} dokumentierte Nicht-Snowflake × Nicht-Snowflake-Paarung(en) haben Snowflake-Nachkommen. Das ist besonders wichtig, um verdecktes p2/p3-Tragen in den Elternlinien einzugrenzen.`);
  }
  if (!family.candidates.length) {
    messages.push('<strong>Familien-Spur:</strong> Noch keine auswertbaren Elternverknüpfungen. Für die Trägersuche sind Mutter/Vater bzw. Stammbaumdaten besonders wertvoll.');
  }
  return messages;
}

function renderSnowflakeDetective(allRows) {
  const rows=dashboardSnowflakeDedupedRows(allRows || []);
  const snowflakes=rows.filter(dashboardSnowflakeIsSnowflake);
  const regularSnowflakes=snowflakes.filter(h=>dashboardSnowflakeSource(h)==='Datenbank');
  const learningSnowflakes=snowflakes.filter(h=>dashboardSnowflakeSource(h)==='Lerndatei');
  const lpPatternRefs=rows.filter(h=>dashboardSnowflakePattern(h) || dashboardSnowflakeGenotype(h).lp!=='–');

  if (!snowflakes.length) return `
    <details class="snowflake-detective">
      <summary><strong>❄️ Snowflake-Detektiv</strong></summary>
      <p class="small muted">Noch kein Snowflake in Datenbank oder Lerndatei gefunden. Sobald Snowflakes erfasst werden, vergleicht der Detektiv LP/PATN1, Familien und Nachkommen automatisch.</p>
    </details>`;

  const family=dashboardSnowflakeFamilyAnalysis(rows,snowflakes);
  const control=dashboardSnowflakeControlAnalysis(rows,snowflakes);
  const pairings=dashboardSnowflakeInformativePairings(rows);
  const ancestorEnrichment=dashboardSnowflakeAncestorEnrichment(snowflakes,control.controls);
  const audit=dashboardSnowflakePatternModelAudit(rows,snowflakes);
  const hypotheses=dashboardSnowflakeHypotheses(rows,snowflakes,family,control,pairings);
  const modelChecks=dashboardSnowflakeHypothesisChecks(control,pairings,audit);
  const genotypeCounts=new Map();
  for (const horse of snowflakes) {
    const g=dashboardSnowflakeGenotype(horse);
    const key=`${g.lp}|${g.p1}`;
    if (!genotypeCounts.has(key)) genotypeCounts.set(key,{lp:g.lp,p1:g.p1,n:0});
    genotypeCounts.get(key).n++;
  }
  const genotypeTable=[...genotypeCounts.values()].sort((a,b)=>b.n-a.n).map(row=>`<tr><td>${escapeHtml(row.lp)}</td><td>${escapeHtml(row.p1)}</td><td>${row.n}</td><td>${Math.round(row.n/snowflakes.length*100)}%</td></tr>`).join('');

  const snowflakeTable=family.snowflakeRows.map(row=>{
    const h=row.horse, g=dashboardSnowflakeGenotype(h);
    const fatherG=dashboardSnowflakeGenotype(row.father), motherG=dashboardSnowflakeGenotype(row.mother);
    const father= row.father ? `${dashboardSnowflakeHorseLink(row.father,row.fatherName)}<br><span class="tiny muted">${escapeHtml(dashboardSnowflakePattern(row.father)||'Muster offen')} · ${escapeHtml(fatherG.lp)}/${escapeHtml(fatherG.p1)}</span>` : escapeHtml(row.fatherName || '–');
    const mother= row.mother ? `${dashboardSnowflakeHorseLink(row.mother,row.motherName)}<br><span class="tiny muted">${escapeHtml(dashboardSnowflakePattern(row.mother)||'Muster offen')} · ${escapeHtml(motherG.lp)}/${escapeHtml(motherG.p1)}</span>` : escapeHtml(row.motherName || '–');
    return `<tr>
      <td>${dashboardSnowflakeHorseLink(h)}<br><span class="tiny muted">${escapeHtml(h?.breed||'–')} · ${escapeHtml(dashboardSnowflakeSource(h))}</span></td>
      <td>${escapeHtml(g.lp)}</td><td>${escapeHtml(g.p1)}</td>
      <td>${father}</td><td>${mother}</td>
      <td>${row.fullSiblings.length} voll / ${row.halfSiblings.length} halb${row.sfSiblings.length?` · <strong>${row.sfSiblings.length} Snowflake</strong>`:''}<br><span class="tiny muted">${dashboardSnowflakePatternSummary([...row.fullSiblings,...row.halfSiblings])}</span></td>
      <td>${row.children.length}${row.sfChildren.length?` · <strong>${row.sfChildren.length} Snowflake</strong>`:''}<br><span class="tiny muted">${dashboardSnowflakePatternSummary(row.children)}</span></td>
    </tr>`;
  }).join('');

  const candidateTable=family.candidates.length ? family.candidates.slice(0,15).map(row=>{
    const g=dashboardSnowflakeGenotype(row.horse);
    const pattern=dashboardSnowflakePattern(row.horse) || 'Muster offen';
    const eligibleRate=row.eligibleSnowflakeRate==null?'–':`${Math.round(row.eligibleSnowflakeRate*100)}%`;
    const eligibleN=row.eligiblePatternChildren.length;
    const eligibleExtra=row.eligibleUnknownPattern ? `<br><span class="tiny muted">+${row.eligibleUnknownPattern} ohne Musterangabe</span>` : '';
    return `<tr>
      <td>${row.horse?dashboardSnowflakeHorseLink(row.horse,row.name):escapeHtml(row.name)}<br><span class="tiny muted">${escapeHtml(pattern)} · ${escapeHtml(g.lp)}/${escapeHtml(g.p1)}</span></td>
      <td>${row.sfCount}</td><td>${row.mateCount}</td>
      <td>${eligibleN}${eligibleExtra}</td><td>${row.eligibleSnowflakes.length}</td><td><strong>${eligibleRate}</strong></td>
      <td><span class="snowflake-score" title="Explorativer Evidenzscore, keine Genwahrscheinlichkeit">${row.score}</span></td>
      <td>${escapeHtml(row.note)}</td>
    </tr>`;
  }).join('') : '';


  const metricPct=(num,den)=>den?`${num}/${den} (${Math.round(num/den*100)}%)`:'–';
  const metricOr=x=>x?.value==null?'–':`${x.value>=10?x.value.toFixed(1):x.value.toFixed(2).replace('.',',')}${x.corrected?'*':''}`;
  const patn=control.patn, lpDose=control.lpDose;
  const controlTable=`
    <tr><td><strong>p1p1</strong> vs. P1 vorhanden</td><td>${metricPct(patn.a,patn.a+patn.b)}</td><td>${metricPct(patn.c,patn.c+patn.d)}</td><td>${metricOr(patn.odds)}</td><td>${dashboardSnowflakeFormatP(patn.p)}</td></tr>
    <tr><td><strong>LpLp</strong> vs. Lplp <span class="tiny muted">(nur p1p1)</span></td><td>${metricPct(lpDose.a,lpDose.a+lpDose.b)}</td><td>${metricPct(lpDose.c,lpDose.c+lpDose.d)}</td><td>${metricOr(lpDose.odds)}</td><td>${dashboardSnowflakeFormatP(lpDose.p)}</td></tr>`;

  const patternModelTable=`
    <tr><td><strong>P1p1</strong> · P2 beliebig</td><td>Lplp → Leopard<br>LpLp → Few Spot neu</td><td>P1 überlagert P2/P3</td></tr>
    <tr><td><strong>P1P1</strong> · P2 beliebig</td><td>Lplp → Leopard<br>LpLp → Few Spot alt</td><td>P1 überlagert P2/P3</td></tr>
    <tr><td><strong>p1p1 + P2_</strong></td><td>Lplp → Spotted Blanket<br>LpLp → Snowcap</td><td>Pattern 2 sichtbar</td></tr>
    <tr><td><strong>p1p1 + p2p2 + P3_</strong></td><td>Varnish Roan</td><td>Pattern 3 vorhanden</td></tr>
    <tr><td><strong>p1p1 + p2p2 + p3p3</strong></td><td>Snowflake</td><td>rezessive Endstufe der drei Pattern-Loci</td></tr>`;
  const auditText=audit.contradictions.length
    ? `<p class="error small"><strong>${audit.contradictions.length} Modellwiderspruch/widersprüche:</strong><br>${audit.contradictions.slice(0,8).map(escapeHtml).join('<br>')}</p>`
    : `<p class="small"><strong>Aktuell kein Widerspruch:</strong> ${audit.snowflakeP1Consistent}/${audit.snowflakeTested || 0} PATN1-getestete Snowflakes passen bei P1 zu <strong>p1p1</strong>. P2/P3 können mangels Gentest nicht direkt bestätigt werden.</p>`;

  const modelTable=modelChecks.map(row=>`<tr><td><strong>${escapeHtml(row.model)}</strong></td><td><span class="snowflake-model-status">${escapeHtml(row.status)}</span></td><td>${escapeHtml(row.reason)}</td></tr>`).join('');

  const pairingTable=pairings.length ? pairings.map(row=>{
    const father=row.father?dashboardSnowflakeHorseLink(row.father,row.fatherName):escapeHtml(row.fatherName||'–');
    const mother=row.mother?dashboardSnowflakeHorseLink(row.mother,row.motherName):escapeHtml(row.motherName||'–');
    const rate=row.rate==null?'–':`${Math.round(row.rate*100)}%`;
    const eligible=row.eligibleN?`${row.eligibleSf}/${row.eligibleN} (${Math.round(row.eligibleRate*100)}%)`:'–';
    return `<tr><td><strong>${escapeHtml(row.type)}</strong></td><td>${father}<br><span class="tiny muted">${escapeHtml(row.fp||'Muster offen')}</span></td><td>${mother}<br><span class="tiny muted">${escapeHtml(row.mp||'Muster offen')}</span></td><td>${row.sf}/${row.n || 0}${row.n?` (${rate})`:''}</td><td>${eligible}</td><td>${escapeHtml(row.note)}</td></tr>`;
  }).join('') : '';

  const ancestorTable=ancestorEnrichment.rows.length ? ancestorEnrichment.rows.map(row=>`<tr><td>${escapeHtml(row.name)}</td><td>${metricPct(row.sfCount,row.sfN)}</td><td>${metricPct(row.ctrlCount,row.ctrlN)}</td><td><strong>${row.enrichment.toFixed(row.enrichment>=10?1:2).replace('.',',')}×</strong></td></tr>`).join('') : '';

  const commonAncestors=family.commonAncestors.length
    ? `<div class="snowflake-ancestor-pills">${family.commonAncestors.map(x=>`<span>${escapeHtml(x.name)} <strong>${x.count}/${snowflakes.length}</strong></span>`).join('')}</div>`
    : '<p class="muted small">Noch keine gemeinsamen Ahnen in mindestens zwei Snowflake-Stammbäumen erkennbar.</p>';

  return `
    <details class="snowflake-detective" open>
      <summary><strong>❄️ Snowflake-Detektiv</strong></summary>
      <p class="small muted">Explorative Spurensuche nach dem seltenen Snowflake-Muster. Der Detektiv kombiniert die gesamte Pferdedatenbank mit der Lerndatei und berücksichtigt dabei alle LP-Scheckenrassen, unabhängig vom aktuellen Dashboard-Filter. Identische MDR-IDs zählen nur einmal. Die ergänzte MDR-Patterntafel zeigt eine Hierarchie aus Pattern 1, Pattern 2 und einem dritten Pattern-Locus P3. P2/P3 sind im Datenbestand nicht als individuelle Gentests verfügbar. Der Detektiv nutzt diese Tafel deshalb ausschließlich als Forschungsmodell und speichert keine daraus abgeleiteten P2/P3-Zustände auf Pferdeseiten.</p>
      <div class="snowflake-stat-grid">
        <div><strong>${snowflakes.length}</strong><span>Snowflakes gesamt</span></div>
        <div><strong>${regularSnowflakes.length}</strong><span>Datenbank</span></div>
        <div><strong>${learningSnowflakes.length}</strong><span>Lerndatei</span></div>
        <div><strong>${lpPatternRefs.length}</strong><span>LP-Schecken-Referenzen</span></div>
      </div>

      <section class="snowflake-hypotheses">
        <h4>🕵️ Aktuelle Indizien</h4>
        ${hypotheses.map(x=>`<p>${x}</p>`).join('')}
      </section>

      <details class="snowflake-subdetail" open>
        <summary><strong>Musteranalyse · Snowflake ↔ LP/PATN1</strong></summary>
        <div class="table-wrap"><table class="detail-table color-genetics-table"><thead><tr><th>LP</th><th>PATN1</th><th>Snowflakes</th><th>Anteil</th></tr></thead><tbody>${genotypeTable}</tbody></table></div>
        <p class="tiny muted">„–“ bedeutet nicht getestet/unbekannt. Die sichtbare Patterntafel legt für Snowflake p1p1 + p2p2 + p3p3 nahe; P2/P3 werden aber nicht als individuelle Gentests erfunden oder gespeichert.</p>
      </details>

      <details class="snowflake-subdetail" open>
        <summary><strong>🧩 MDR-Patterntafel · P1/P2/P3</strong></summary>
        <p class="small muted">Arbeitsmodell aus der von dir hinterlegten MDR-Patterntafel. Entscheidend ist die Hierarchie: P1 überlagert P2/P3; ohne P1 entscheidet P2; erst bei p1p1 + p2p2 wird Pattern 3 sichtbar. Die abgeleiteten P2/P3-Zustände bleiben ausschließlich hier im Forschungsbereich.</p>
        <div class="table-wrap"><table class="detail-table color-genetics-table"><thead><tr><th>Pattern-Konstellation</th><th>sichtbares Muster</th><th>Interpretation</th></tr></thead><tbody>${patternModelTable}</tbody></table></div>
        ${auditText}
        <p class="tiny muted"><strong>Snowflake-Arbeitshypothese:</strong> LP vorhanden + p1p1 + p2p2 + p3p3. Damit wäre Snowflake kein zusätzlicher „Flaxen-artiger“ Faktor X, sondern die sichtbare Endstufe der drei Pattern-Loci. Das wird weiterhin nur gegen echte MDR-Daten geprüft.</p>
      </details>

      <details class="snowflake-subdetail" open>
        <summary><strong>🧪 Snowflake vs. Kontrollgruppe</strong></summary>
        <p class="small muted">Verglichen werden nur LP-Schecken mit bekanntem sichtbaren Muster und echtem LP/PATN1-Test. Nicht getestete Pferde fließen nicht in diese 2×2-Vergleiche ein. Der Fisher-Test prüft die beobachtete Anreicherung; er beweist keine MDR-Ursache.</p>
        <div class="table-wrap"><table class="detail-table color-genetics-table"><thead><tr><th>Test</th><th>Snowflake</th><th>Nicht-Snowflake-Kontrolle</th><th>Odds Ratio</th><th>Fisher p</th></tr></thead><tbody>${controlTable}</tbody></table></div>
        <p class="tiny muted">* Bei einer Nullzelle wird für die Odds Ratio eine 0,5-Korrektur verwendet. Besonders wichtig: Ein Merkmal kann stark angereichert und trotzdem nicht allein ursächlich sein.</p>
        <h4>Hypothesencheck</h4>
        <div class="table-wrap"><table class="detail-table color-genetics-table"><thead><tr><th>Modell</th><th>Stand</th><th>Warum?</th></tr></thead><tbody>${modelTable}</tbody></table></div>
      </details>

      <details class="snowflake-subdetail">
        <summary><strong>🧬 Informative Paarungen</strong></summary>
        <p class="small muted">Priorisiert werden Paarungen, mit denen sich verdecktes p2/p3-Tragen und die P1/P2/P3-Hierarchie besonders gut prüfen lassen. „Nicht-Snowflake“ wird nur verwendet, wenn das sichtbare Elternmuster tatsächlich erfasst ist.</p>
        ${pairingTable ? `<div class="table-wrap"><table class="detail-table color-genetics-table"><thead><tr><th>Typ</th><th>Vater</th><th>Mutter</th><th>Snowflake / bekannte Muster</th><th>LP+p1p1-Teilmenge</th><th>Bedeutung</th></tr></thead><tbody>${pairingTable}</tbody></table></div>` : '<p class="muted small">Noch keine ausreichend dokumentierte informative Paarung.</p>'}
      </details>

      <details class="snowflake-subdetail">
        <summary><strong>🌳 Ahnen-Anreicherung vs. Kontrollgruppe</strong></summary>
        <p class="small muted">Ein Ahn ist erst interessant, wenn er bei Snowflakes häufiger vorkommt als bei Nicht-Snowflake-LP-Schecken. Gezählt wird je Pferd höchstens einmal. Wegen unvollständiger und verwandter Stammbäume ist die Anreicherung nur explorativ.</p>
        ${ancestorTable ? `<div class="table-wrap"><table class="detail-table color-genetics-table"><thead><tr><th>Ahn</th><th>Snowflakes mit Ahn</th><th>Kontrollen mit Ahn</th><th>Anreicherung</th></tr></thead><tbody>${ancestorTable}</tbody></table></div>` : '<p class="muted small">Noch zu wenige vergleichbare Stammbäume für eine Kontrollgruppen-Anreicherung.</p>'}
      </details>

      <details class="snowflake-subdetail">
        <summary><strong>Snowflake-Fälle &amp; Familien</strong></summary>
        <div class="table-wrap"><table class="detail-table color-genetics-table snowflake-family-table"><thead><tr><th>Snowflake</th><th>LP</th><th>PATN1</th><th>Vater</th><th>Mutter</th><th>Geschwister</th><th>Nachkommen</th></tr></thead><tbody>${snowflakeTable}</tbody></table></div>
      </details>

      <details class="snowflake-subdetail">
        <summary><strong>🔎 Mögliche Träger-/Linienkandidaten</strong></summary>
        <p class="small muted">Der Verdachtsindex ist nur ein transparenter Evidenzscore und <strong>keine</strong> P2-/P3-Trägerwahrscheinlichkeit. Die direkt testbare Vorbedingung <strong>LP vorhanden + p1p1</strong> wird separat gezählt; P2/P3 lassen sich derzeit nur über Muster und Familien indirekt untersuchen. Daraus wird kein Pferdemerkmal gespeichert.</p>
        ${candidateTable ? `<div class="table-wrap"><table class="detail-table color-genetics-table"><thead><tr><th>Linie / Elternteil</th><th>Snowflake-Nachkommen</th><th>Partner</th><th>LP+p1p1 + Muster</th><th>davon Snowflake</th><th>Snowflake-Quote</th><th>Index</th><th>Hinweis</th></tr></thead><tbody>${candidateTable}</tbody></table></div>` : '<p class="muted small">Noch keine Elternkandidaten aus den gespeicherten Stammbäumen ableitbar.</p>'}
        <h4>Gemeinsame Ahnen</h4>
        ${commonAncestors}
      </details>
    </details>`;
}

function renderColorGeneticsDashboard(rows, allRows) {
  const root=document.getElementById('color-genetics-dashboard');
  if (!root) return;
  if (!rows?.length) {
    root.innerHTML=`<p class="muted">Keine Pferde im aktuellen Filter.</p>${renderSnowflakeDetective(allRows || [])}`;
    return;
  }

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
      if (!shadeGroups.has(key)) shadeGroups.set(key,{base:info.base,shade:info.shade,orderIndex:info.orderIndex,scaleLength:info.scaleLength,horses:[]});
      shadeGroups.get(key).horses.push(horse);
    }
  }
  const baseEntries=[...baseCounts.entries()].filter(([,n])=>n>0);
  if (baseUnknown) baseEntries.push(['Nicht eindeutig zugeordnet',baseUnknown]);
  const shadeRows=dashboardShadeGeneticFingerprints(shadeGroups);
  const app=dashboardAppaloosaAnalysis(rows);
  const inheritance=dashboardColorInheritance(rows,allRows||rows);

  const shadeTable = shadeRows.length ? `<div class="table-wrap"><table class="detail-table color-genetics-table"><thead><tr><th>Grundfarbe</th><th>Schattierung / Variante</th><th>Stufe hell → dunkel</th><th>n</th><th>auffällige getestete Marker</th></tr></thead><tbody>${shadeRows.map(row=>`<tr><td>${escapeHtml(row.base)}</td><td><strong>${escapeHtml(row.shade)}</strong></td><td>${Number.isFinite(row.orderIndex)&&row.scaleLength?`${row.orderIndex+1}/${row.scaleLength}`:'–'}</td><td>${row.horses.length}</td><td>${row.markers.length ? row.markers.map(escapeHtml).join('<br>') : '<span class="muted">noch kein unterscheidbarer getesteter Marker</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Noch keine eindeutig erkannten Grundfarben-Schattierungen.</p>';

  const appComboTable = app.combos.length ? `<div class="table-wrap"><table class="detail-table color-genetics-table"><thead><tr><th>LP</th><th>PATN1</th><th>n</th><th>beobachtete sichtbare Muster</th></tr></thead><tbody>${app.combos.map(row=>`<tr><td>${escapeHtml(row.lp)}</td><td>${escapeHtml(row.p1)}</td><td>${row.n}</td><td>${dashboardSortedCounts(row.patterns).map(([pattern,n])=>`${escapeHtml(pattern)} <strong>${n}</strong> (${Math.round(n/row.n*100)}%)`).join(' · ')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Noch keine Pferde mit gleichzeitig getestetem LP, getestetem PATN1 und sichtbarem LP-Scheckungsmuster im aktuellen Filter.</p>';

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
      <p class="small muted">Die vollständigen MDR-Schattierungsskalen für Chestnut (8), Bay (8), Sealbrown/Sea Brown (4) und Black (4) sind jetzt in offizieller Reihenfolge hell → dunkel hinterlegt. Varianten ohne eigene veröffentlichte Skala bleiben bei ihrer gespeicherten MDR-Bezeichnung. Die Markeranalyse verwendet ausschließlich echte gespeicherte Gentests und hebt nur Unterschiede zwischen Schattierungen derselben Grundfarbe hervor.</p>
      ${shadeTable}
      <p class="tiny muted">Explorativ: Häufigkeiten können auf einen Zusammenhang hinweisen, beweisen aber noch nicht, welches Gen die MDR-Schattierung verursacht.</p>
    </details>

    <details class="color-genetics-detail">
      <summary><strong>LP-Scheckung · LP, PATN1 &amp; sichtbares Muster</strong></summary>
      <p class="small muted">LP-basierte Scheckungsmuster werden rasseübergreifend betrachtet. Die ergänzte MDR-Patterntafel zeigt Pattern 1, Pattern 2 und Pattern 3: P1_ führt zu Leopard/Few Spot, p1p1 + P2_ zu Spotted Blanket/Snowcap, p1p1 + p2p2 + P3_ zu Varnish Roan und p1p1 + p2p2 + p3p3 zu Snowflake. P2/P3 sind nicht als individuelle Gentests im Datenbestand vorhanden und werden daher nur im Snowflake-Detektiv als Forschungsmodell verwendet.</p>
      <h4>Sichtbare Muster</h4>
      ${dashboardColorPills(app.patterns,app.patterns.reduce((s,x)=>s+x[1],0),'Keine LP-Scheckungsmuster im aktuellen Filter.')}
      <h4>Getestete Genetik → beobachtetes Muster</h4>
      ${appComboTable}
      ${renderSnowflakeDetective(allRows || rows)}
    </details>

    <details class="color-genetics-detail">
      <summary><strong>Beobachtete Farbvererbung</strong></summary>
      <p class="small muted">Nur tatsächlich in der Datenbank verknüpfte Eltern und Fohlen. Die Prozentwerte sind Beobachtungen des vorhandenen Bestands, keine errechneten Mendel-Wahrscheinlichkeiten.</p>
      ${inheritanceTable}
    </details>`;
}
