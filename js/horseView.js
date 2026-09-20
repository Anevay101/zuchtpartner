
let viewHorseId = null;
let viewHorseList = [];
let viewHorseIndex = -1;
let swipeStartX = null;
let viewSort = { field: 'name', dir: 'asc' };
let extraData = {};

document.addEventListener('DOMContentLoaded', initView);


const VIEW_TEXT_FIELDS = ['name','external_id','game_version','gender','breed','breed_composition','coat_color','appaloosa_pattern','owner','hlp_slp','breeding_goal','notes','image_url'];
const VIEW_NUMBER_FIELDS = ['purebred_pct','ico','stud_fee','tournament_starts_total','breeding_show_points'];
const VIEW_BOOLEAN_FIELDS = ['disease_free','breeding_allowed','learning_file','in_breeding_station','flaxen_carrier'];

function viewHorseKey(id) {
  const n = Number(id);
  return Number.isNaN(n) ? id : n;
}

function viewDerivedFlaxenCarrier(data) {
  if (data?.flaxen_carrier === true || data?.flaxen_carrier === false) return data.flaxen_carrier;
  const state = data?.color_gene_overrides?.Flaxen;
  if (state === 'het' || state === 'hom') return true;
  if (state === 'absent') return false;
  if (typeof inferGeneticHintsFromPhenotype === 'function') {
    const visible = [data?.coat_color, data?.notes, data?.name].some((text) =>
      inferGeneticHintsFromPhenotype(text).some((hint) => hint?.locus === 'Flaxen' && String(hint?.allele || '').toLowerCase() === 'flfl')
    );
    if (visible) return true;
  }
  return null;
}

function fillViewHorseFields(data) {
  const normalized = (!data?.game_version || (typeof mdrGameWorldConflict === 'function' && mdrGameWorldConflict(data)))
    ? { ...data, game_version: mdrGameWorld(data, 'DE') }
    : data;
  for (const id of VIEW_TEXT_FIELDS) {
    const el = document.getElementById(id);
    if (el && normalized?.[id] != null) el.value = normalized[id];
  }
  const birth = document.getElementById('birthdate');
  if (birth && normalized?.birthdate) birth.value = normalized.birthdate;
  for (const id of VIEW_NUMBER_FIELDS) {
    const el = document.getElementById(id);
    if (el && normalized?.[id] != null) el.value = normalized[id];
  }
  const flaxen = viewDerivedFlaxenCarrier(normalized);
  for (const id of VIEW_BOOLEAN_FIELDS) {
    const el = document.getElementById(id);
    const value = id === 'flaxen_carrier' ? flaxen : normalized?.[id];
    if (el && value != null) el.value = String(value);
  }

  const breed = normalizeBreed(normalized?.breed) || 'Rasselos';
  const breedEl = document.getElementById('breed');
  if (breedEl) breedEl.value = breed;
  const compositionField = document.getElementById('breed-composition-field');
  if (compositionField) compositionField.hidden = !(Number(normalized?.purebred_pct) < 100 || String(normalized?.breed_composition || '').trim());
  const appaloosaField = document.getElementById('appaloosa-pattern-field');
  if (appaloosaField) {
    const relevant = appaloosaPatternStateForHorse(normalized).relevant;
    appaloosaField.hidden = !relevant;
  }
  const isStallion = /hengst|stallion/i.test(String(normalized?.gender || ''));
  document.getElementById('stud-station-field')?.toggleAttribute('hidden', !isStallion);
  document.getElementById('stud-fee-field')?.toggleAttribute('hidden', !isStallion);
  const img = document.getElementById('image-preview');
  if (img) {
    const url = String(normalized?.image_url || '').trim();
    if (url) { img.src = url; img.hidden = false; }
    else { img.hidden = true; img.removeAttribute('src'); }
  }
}

async function loadViewHorse(id) {
  let data;
  try { data = await localGet(LOCAL_STORES.horses, viewHorseKey(id)); }
  catch (error) {
    document.getElementById('form-error').textContent = 'Konnte Pferd nicht laden: ' + error.message;
    return null;
  }
  if (!data) {
    document.getElementById('form-error').textContent = 'Pferd wurde in der lokalen Datenbank nicht gefunden.';
    return null;
  }
  extraData = data;
  fillViewHorseFields(data);
  await renderDetailTables(data);
  return data;
}

function viewTagLabels(horse) {
  return (horse?.tags || []).map(t => typeof t === 'string' ? t : t?.label).filter(Boolean);
}

function viewLanguage() {
  return window.MDR_I18N?.language === 'en' ? 'en' : 'de';
}

function viewBreedingShowMetric(horse) {
  const actualZs = typeof plannerBreedingShowPoints === 'function' ? plannerBreedingShowPoints(horse) : null;
  let value = actualZs;
  let state = actualZs != null ? '✓' : '?';
  let title = actualZs != null ? 'eingetragener ZS-Wert' : 'kein ZS-Wert verfügbar';
  if (actualZs == null && Array.isArray(viewHorseList) && typeof plannerBuildBreedingShowModel === 'function') {
    try {
      const model = plannerBuildBreedingShowModel(viewHorseList);
      const predicted = model?.predict?.(horse);
      if (predicted != null && Number.isFinite(Number(predicted))) {
        value = Number(predicted);
        state = '≈';
        title = 'ZS-Prognose';
      }
    } catch {}
  }
  return { value, state, title };
}

function viewBasicDataCopyText(horse) {
  const d = viewDerived(horse);
  const zs = viewBreedingShowMetric(horse);
  const offspringRaw = horse?.offspring_count != null && horse.offspring_count !== '' ? Number(horse.offspring_count) : null;
  const gp = d.gp == null || !Number.isFinite(d.gp) ? '?' : Math.round(d.gp);
  const ext = d.ext == null || !Number.isFinite(d.ext) ? '?' : d.ext.toFixed(2);
  const extpct = d.extpct == null || !Number.isFinite(Number(d.extpct)) ? '?' : `${Number(d.extpct).toFixed(0)}%`;
  const intValue = d.int == null || !Number.isFinite(d.int) ? '?' : d.int.toFixed(2);
  const zsValue = zs.value == null || !Number.isFinite(Number(zs.value)) ? '?' : `${zs.state} ${Math.round(Number(zs.value))}`;
  const offspring = offspringRaw == null || !Number.isFinite(offspringRaw) ? '?' : Math.max(0, Math.round(offspringRaw));
  return [`GP ${gp}`,`Ext ${ext}`,`Ext% ${extpct}`,`Int ${intValue}`,`ZS ${zsValue}`,`Nachkommen ${offspring}`].join('\n');
}

function viewImportantMissing(horse) {
  const missing = [];
  if (!horse?.external_id) missing.push('MDR-ID');
  if (!plannerHorseTalent(horse)) missing.push('Begabung');
  if (!horse?.disciplines || Object.keys(horse.disciplines).length < 1) missing.push('Disziplinwerte');
  if (!horse?.traits || Object.keys(horse.traits).length < 1) missing.push('Grundlagen/Gangarten');

  const isAppaloosa = /appaloosa|leopard|few\s*spot|blanket|snowcap|varnish|snowflake/i.test(`${horse?.coat_color || ''} ${horse?.appaloosa_pattern || ''}`);
  if (isAppaloosa) {
    const p1 = (horse?.colors || []).find(r => r?.label === 'PATN1');
    if (!p1?.value || /nicht getestet/i.test(String(p1.value))) missing.push('PATN1');
  }

  const hasLegacyCup = viewTagLabels(horse).includes('Cupstern');
  if (hasLegacyCup && !Object.keys(plannerCupResults(horse)).length) missing.push('Cup-Siege/Disziplin');
  return missing;
}

function renderHorseViewHeader(horse) {
  const chips = document.getElementById('horse-summary-chips');
  if (chips) {
    const age = horse?.birthdate ? viewAgeLabel(horse.birthdate) : null;
    const talent = plannerHorseTalent(horse);
    const group = plannerHorseMainGroup(horse);
    const stars = plannerCupStarRows(horse);
    const bits = [
      normalizeBreed(horse?.breed) || 'Rasselos',
      horse?.gender || null,
      age || null,
      group ? `${group}${talent ? ' / ' + talent : ''}` : talent || null,
      horse?.breeding_allowed === true ? 'ZZL ✓' : horse?.breeding_allowed === false ? 'ZZL ✗' : 'ZZL ?',
      stars.length ? `⭐ ${stars.map(r=>r.discipline + (r.lk ? ' '+r.lk : '')).join(', ')}` : null,
    ];
    if (/hengst|stallion/i.test(String(horse?.gender || ''))) {
      const inStation = horse?.in_breeding_station === true || viewTagLabels(horse).includes('Zuchtstation');
      if (inStation) bits.push('Zuchtstation ✓');
      bits.push(`Decktaxe: ${horse?.stud_fee == null || horse?.stud_fee === '' || Number(horse.stud_fee) === 0 ? 'kostenlos' : `${horse.stud_fee} DD`}`);
    }
    chips.innerHTML = bits.filter(Boolean).map(x => `<span>${plannerEscape(x)}</span>`).join('');
  }

  const metrics = document.getElementById('horse-key-metrics');
  if (metrics) {
    const d = viewDerived(horse);
    const zs = viewBreedingShowMetric(horse);
    const offspring = horse?.offspring_count != null && horse.offspring_count !== '' ? Number(horse.offspring_count) : null;
    const en = viewLanguage() === 'en';
    const rows = [
      [en ? 'OP' : 'GP', d.gp == null || !Number.isFinite(d.gp) ? '?' : Math.round(d.gp), en ? 'Overall potential' : 'Gesamtpotenzial'],
      [en ? 'Confo' : 'Ext', d.ext == null || !Number.isFinite(d.ext) ? '?' : d.ext.toFixed(2), en ? 'Conformation – lower is better' : 'Körperbau – niedriger ist besser'],
      [en ? 'Confo%' : 'Ext%', d.extpct == null || !Number.isFinite(Number(d.extpct)) ? '?' : `${Number(d.extpct).toFixed(0)}%`, en ? 'Genetic conformation – higher is better' : 'genetisches Exterieur – höher ist besser'],
      [en ? 'Inner Values' : 'Int', d.int == null || !Number.isFinite(d.int) ? '?' : d.int.toFixed(2), en ? 'Inner values – lower is better' : 'Interieur – niedriger ist besser'],
      ['ZS', `${zs.state} ${zs.value == null || !Number.isFinite(Number(zs.value)) ? '–' : Math.round(Number(zs.value))}`, zs.title],
      [en ? 'Offspring' : 'Nachkommen', offspring == null || !Number.isFinite(offspring) ? '?' : Math.max(0, Math.round(offspring)), offspring == null ? (en ? 'not yet imported from MDR profile' : 'noch nicht aus MDR-Profil eingelesen') : (en ? 'offspring according to MDR profile' : 'Nachkommen laut MDR-Profil')],
    ];
    metrics.innerHTML = rows.map(([label,value,title]) => `<div class="horse-key-metric" title="${plannerEscape(title)}" data-i18n-skip><span>${plannerEscape(label)}</span><strong>${plannerEscape(String(value))}</strong></div>`).join('');
  }

  const missing = viewImportantMissing(horse);
  const missRoot = document.getElementById('horse-important-missing');
  if (missRoot) {
    missRoot.hidden = !missing.length;
    missRoot.innerHTML = missing.length ? `<strong>Noch ergänzen für vollständige Auswertung:</strong> ${missing.map(plannerEscape).join(' · ')}` : '';
  }

  const placeholder = document.getElementById('horse-image-placeholder');
  const image = document.getElementById('image-preview');
  if (placeholder) placeholder.hidden = Boolean(image && !image.hidden);
}

function viewDerived(horse) {
  const gpRaw = horse?.tournament_potential?.['Gesamtpotenzial'];
  return {
    gp: gpRaw != null && gpRaw !== '' ? Number(gpRaw) : null,
    ext: averageScore(horse?.exterior_descriptive, scoreExteriorTerm),
    extpct: horse?.exterior_genetics?.overall?.percent ?? null,
    int: averageScore(horse?.temperament, scoreTemperamentTerm),
  };
}
function viewSortValue(horse, field) {
  if (field === 'name') return String(horse?.name || '').toLocaleLowerCase('de');
  if (field === 'age') {
    if (!horse?.birthdate) return null;
    const t = new Date(horse.birthdate).getTime();
    return Number.isFinite(t) ? Date.now() - t : null;
  }
  if (field === 'updated_at') {
    const t = horse?.updated_at ? new Date(horse.updated_at).getTime() : NaN;
    return Number.isFinite(t) ? t : null;
  }
  return viewDerived(horse)[field] ?? null;
}
function sortViewHorseList() {
  const mult = viewSort.dir === 'desc' ? -1 : 1;
  viewHorseList.sort((a,b) => {
    const av=viewSortValue(a,viewSort.field), bv=viewSortValue(b,viewSort.field);
    if (av == null && bv == null) return String(a.name||'').localeCompare(String(b.name||''),'de');
    if (av == null) return 1; if (bv == null) return -1;
    const c = typeof av === 'string' ? av.localeCompare(bv,'de') : av-bv;
    return c ? c*mult : String(a.name||'').localeCompare(String(b.name||''),'de');
  });
  viewHorseIndex=viewHorseList.findIndex(h=>String(h.id)===String(viewHorseId));
}
function loadViewSortPreference() {
  try {
    const saved=JSON.parse(localStorage.getItem('mdr-horse-view-sort-v5367')||'null');
    const field=({birthdate:'age'})[saved?.field]||saved?.field;
    if (['name','age','updated_at','gp','ext','extpct','int'].includes(field)) viewSort={field,dir:saved?.dir==='desc'?'desc':'asc'};
  } catch {}
}
function wireViewSortControls() {
  const field=document.getElementById('view-sort-field'), dir=document.getElementById('view-sort-dir');
  if (!field || !dir) return;
  field.value=viewSort.field; dir.value=viewSort.dir;
  const apply=()=>{
    viewSort={field:field.value,dir:dir.value==='desc'?'desc':'asc'};
    try { localStorage.setItem('mdr-horse-view-sort-v5367',JSON.stringify({field:viewSort.field==='age'?'birthdate':viewSort.field,dir:viewSort.dir})); } catch {}
    sortViewHorseList();
  };
  field.addEventListener('change',apply); dir.addEventListener('change',apply);
}
function viewAgeLabel(birthdate) { return typeof formatAgeShort === 'function' ? formatAgeShort(birthdate) : formatAge(birthdate); }


function renderHorseBreedingShowSummary(horse, allHorses) {
  const field = document.getElementById('breeding_show_summary');
  const note = document.getElementById('breeding-show-summary-note');
  if (!field) return;

  const actual = typeof plannerBreedingShowPoints === 'function'
    ? plannerBreedingShowPoints(horse)
    : null;
  if (actual != null) {
    field.value = String(Math.round(actual));
    if (note) note.textContent = 'Echter eingetragener ZS-Gesamtwert. Details stehen im Reiter „Zuchtschau“.';
    return;
  }

  if (typeof plannerBuildBreedingShowModel !== 'function') {
    field.value = '–';
    if (note) note.textContent = 'ZS-Prognose derzeit nicht verfügbar.';
    return;
  }

  const model = plannerBuildBreedingShowModel(allHorses);
  const predicted = model.predict(horse);
  if (predicted != null && Number.isFinite(predicted)) {
    field.value = String(Math.round(predicted));
    if (note) note.textContent = 'ZS-Prognose (Grundwert). Sie bleibt unabhängig vom Alter sichtbar und wird erst durch einen echten eingetragenen ZS-Wert ersetzt.';
    return;
  }

  field.value = '–';
  if (note) {
    if (model.n < 8) note.textContent = `Noch keine ZS-Prognose: aktuell ${model.n} verwertbare echte ZS-Datensätze, mindestens 8 nötig.`;
    else if (typeof plannerBreedingShowFeatureObject === 'function' && !plannerBreedingShowFeatureObject(horse)) note.textContent = 'ZS-Prognose nicht berechenbar: GP, Ext, Ext% oder Int fehlen.';
    else note.textContent = 'ZS-Prognose derzeit nicht berechenbar.';
  }
}

function viewZsHasScore(value) {
  return value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value));
}
function viewZsScore(value) {
  return viewZsHasScore(value) ? Math.round(Number(value)).toLocaleString('de-DE') : '–';
}

function viewZsBenchmarkHtml(horse, benchmark) {
  const breed = normalizeBreed(horse?.breed) || horse?.breed || 'Rasselos';
  const gender = /stute|stutfohlen|mare|filly/i.test(String(horse?.gender || '')) ? 'Stuten'
    : /hengst|hengstfohlen|stallion|colt/i.test(String(horse?.gender || '')) ? 'Hengste' : '';
  if (!benchmark) {
    return `<section class="zs-benchmark-panel zs-benchmark-missing">
      <div class="zs-section-title"><span>Aktuelles Zuchtschau-Niveau</span><small>${plannerEscape(breed)}${gender ? ` · ${gender}` : ''}</small></div>
      <p class="small muted">Für diese Rasse und dieses Geschlecht liegt noch kein eingelesener Zuchtschau-Benchmark vor.</p>
    </section>`;
  }
  const range = viewZsHasScore(benchmark.fieldP25) && viewZsHasScore(benchmark.fieldP75)
    ? `${viewZsScore(benchmark.fieldP25)}–${viewZsScore(benchmark.fieldP75)}` : '–';
  const quota = benchmark.gender === 'Stute' ? '1 von 3 Stuten' : '1 von 5 Hengsten';
  return `<section class="zs-benchmark-panel">
    <div class="zs-section-title"><span>Aktuelles Zuchtschau-Niveau</span><small>${plannerEscape(benchmark.breed)} · ${benchmark.gender === 'Stute' ? 'Stuten' : 'Hengste'}</small></div>
    <div class="zs-benchmark-metrics">
      <div><span>Typischer Bereich</span><strong>${range}</strong><small>P25–P75</small></div>
      <div><span>Meldeniveau</span><strong>${viewZsScore(benchmark.fieldMedian)}</strong><small>Median</small></div>
      <div class="zs-benchmark-target"><span>Durchkommen</span><strong>${viewZsScore(benchmark.qualifyingMedian)}</strong><small>${quota}, abgerundet</small></div>
      <div><span>Podium</span><strong>${viewZsScore(benchmark.podiumMedian)}</strong><small>typischer 3. Platz</small></div>
      <div><span>Siegniveau</span><strong>${viewZsScore(benchmark.winnerMedian)}</strong><small>typischer Sieger</small></div>
    </div>
    <p class="tiny muted zs-benchmark-basis">Datengrundlage: ${benchmark.shows} besetzte Schauen · ${benchmark.entries} Meldungen · Durchkommensniveau aus ${benchmark.qualifyingShows} auswertbaren Schauen.</p>
  </section>`;
}

function viewZsForecastHtml(horse, allHorses, benchmark) {
  if (typeof plannerBuildBreedingShowModel !== 'function') {
    return `<section class="zs-forecast-panel"><div class="zs-section-title"><span>Zuchtschau-Prognose</span></div><p class="small muted">Die Grundwert-Prognose ist derzeit nicht verfügbar.</p></section>`;
  }
  const model = plannerBuildBreedingShowModel(allHorses || []);
  const predicted = model.predict(horse);
  if (predicted == null || !Number.isFinite(Number(predicted))) {
    const reason = model.n < 8
      ? `Noch keine Prognose: aktuell ${model.n} verwertbare echte ZS-Datensätze, mindestens 8 nötig.`
      : (typeof plannerBreedingShowFeatureObject === 'function' && !plannerBreedingShowFeatureObject(horse))
        ? 'Prognose nicht berechenbar: GP, Ext, Ext% oder Int fehlen.'
        : 'Zuchtschau-Prognose derzeit nicht berechenbar.';
    return `<section class="zs-forecast-panel"><div class="zs-section-title"><span>Zuchtschau-Prognose</span></div><p class="small muted">${plannerEscape(reason)}</p></section>`;
  }
  const api = window.MDR_BREEDING_SHOW_BENCHMARK;
  const assessment = api?.assessHorseForecast ? api.assessHorseForecast(horse, predicted, benchmark) : null;
  if (!assessment || assessment.status === 'neutral') {
    return `<section class="zs-forecast-panel">
      <div class="zs-section-title"><span>Zuchtschau-Prognose</span></div>
      <div class="zs-forecast-values"><div><span>DB-Prognose Grundwert</span><strong>${viewZsScore(predicted)}</strong></div></div>
      <p class="small muted">Für die Ampel fehlt noch ein passendes aktuelles Durchkommensniveau der Rasse.</p>
    </section>`;
  }
  let explanation='';
  if (assessment.status === 'red') {
    const plural = assessment.extraCupStars === 1 ? 'Cup-Stern' : 'Cup-Sterne';
    const afterTournament = Math.max(0, assessment.gap - assessment.remainingTournamentBonus);
    explanation = `Selbst mit ausgeschöpftem normalem Turnierbonus fehlen rechnerisch noch ca. ${viewZsScore(afterTournament)} Punkte. Dafür wären mindestens ${assessment.extraCupStars} zusätzliche ${plural} nötig.`;
  } else if (assessment.gap <= 0) {
    explanation = 'Der aktuelle Schätzwert liegt bereits auf oder über dem typischen Durchkommensniveau.';
  } else {
    explanation = `Bis zum typischen Durchkommensniveau fehlen rechnerisch ca. ${viewZsScore(assessment.gap)} zusätzliche Bonuspunkte.`;
  }
  return `<section class="zs-forecast-panel">
    <div class="zs-section-title"><span>Zuchtschau-Prognose</span><span class="zs-forecast-status zs-forecast-${assessment.status}">${plannerEscape(assessment.label)}</span></div>
    <div class="zs-forecast-values">
      <div><span>DB-Prognose Grundwert</span><strong>${viewZsScore(predicted)}</strong></div>
      <div><span>Aktueller Turnierbonus</span><strong>${viewZsScore(assessment.tournamentBonus)} / 500</strong></div>
      <div><span>Aktueller Cup-Stern-Bonus</span><strong>${viewZsScore(assessment.cupBonus)}</strong></div>
      <div><span>Schätzwert mit aktuellem Bonus</span><strong>${viewZsScore(assessment.currentEstimate)}</strong></div>
      <div class="zs-forecast-target"><span>Typisches Durchkommen</span><strong>${viewZsScore(benchmark?.qualifyingMedian)}</strong></div>
    </div>
    <p class="small zs-forecast-explanation">${plannerEscape(explanation)}</p>
    <p class="tiny muted">Der Schätzwert ist kein echter ZS-Wert: Prognostizierter Grundwert + aktuell vorhandener Turnierbonus + aktuell vorhandener Cup-Stern-Bonus. Grün = höchstens ca. 200 zusätzliche normale Bonuspunkte; Gelb = mehr, aber noch innerhalb des verbleibenden 500er-Turnierbonus; Rot = normaler Turnierbonus reicht nicht aus.</p>
  </section>`;
}

function renderHorseBreedingShowDetails(horse, allHorses = viewHorseList) {
  const root=document.getElementById('horse-zs-details');
  if (!root) return;
  const benchmarkApi=window.MDR_BREEDING_SHOW_BENCHMARK;
  const benchmark=benchmarkApi?.getBenchmarkForHorse ? benchmarkApi.getBenchmarkForHorse(horse) : null;
  const benchmarkHtml=viewZsBenchmarkHtml(horse,benchmark);
  const total=typeof plannerBreedingShowPoints === 'function' ? plannerBreedingShowPoints(horse) : null;
  if (total == null) {
    root.innerHTML=`<p class="muted">Noch kein echter ZS-Wert eingetragen. Die ZS-Prognose bleibt unabhängig vom Alter kompakt unter „Stammdaten“ sichtbar, bis ein echter ZS-Wert eingetragen wird.</p>${benchmarkHtml}${viewZsForecastHtml(horse,allHorses,benchmark)}`;
    return;
  }
  const snapshot=typeof plannerBreedingShowSnapshot === 'function' ? plannerBreedingShowSnapshot(horse) : null;
  if (!snapshot) {
    root.innerHTML=`${benchmarkHtml}<div class="notice notice-warning small"><strong>ZS-Gesamtwert:</strong> ${Math.round(total)} · Historische Bonusdaten zum ZS-Eintrag fehlen noch.</div>`;
    return;
  }
  const tournamentBonus=Number(snapshot.tournament_bonus || 0);
  const cupBonus=Number(snapshot.cup_bonus || 0);
  const base=typeof plannerBreedingShowBase === 'function' ? plannerBreedingShowBase(horse) : total-tournamentBonus-cupBonus;
  const iso=String(snapshot.snapshot_date || snapshot.captured_at || '').slice(0,10);
  const dateText=iso ? iso.split('-').reverse().join('.') : '–';
  const levelDiff=viewZsHasScore(benchmark?.qualifyingMedian) ? total-Number(benchmark.qualifyingMedian) : null;
  const levelNote=levelDiff == null ? '' : `<p class="small zs-current-level-note"><strong>Einordnung zum heutigen Rassen-Niveau:</strong> Der eingetragene ZS-Gesamtwert liegt ${levelDiff>=0?`ca. ${viewZsScore(levelDiff)} Punkte über`:`ca. ${viewZsScore(Math.abs(levelDiff))} Punkte unter`} dem typischen aktuellen Durchkommensniveau.</p>`;
  root.innerHTML=`
    ${benchmarkHtml}
    <div class="zs-detail-metrics">
      <div><span>ZS-Gesamtwert</span><strong>${Math.round(total)}</strong></div>
      <div><span>ZS-Grundwert</span><strong>${Number.isFinite(Number(base))?Math.round(base):'–'}</strong></div>
      <div><span>Turnierbonus bei ZS</span><strong>${Math.round(tournamentBonus)}</strong></div>
      <div><span>Cupbonus bei ZS</span><strong>${Math.round(cupBonus)}</strong></div>
      <div><span>Eintragungsdatum</span><strong>${plannerEscape(dateText)}</strong></div>
    </div>
    ${levelNote}
    <p class="small muted zs-detail-formula">Grundwert = ZS-Gesamtwert − damaliger Turnierbonus − damaliger Cupbonus. Der Grundwert bleibt danach unverändert.</p>`;
}

async function initView() {
  const session = await requireSession();
  if (!session) return;
  await renderSharedNav(session);

  const params = new URLSearchParams(window.location.search);
  viewHorseId = params.get('id');
  if (!viewHorseId) { window.location.href = mdrRoute('database'); return; }

  document.getElementById('edit-link').href = mdrRoute('horse',{id:viewHorseId});
  document.getElementById('delete-btn').addEventListener('click', onDeleteView);
  document.getElementById('horse-copy-basic-data')?.addEventListener('click', (event) => {
    if (extraData) plannerCopyText(viewBasicDataCopyText(extraData), event.currentTarget);
  });
  document.getElementById('prev-horse-btn').addEventListener('click', () => onNavigateView('prev'));
  document.getElementById('next-horse-btn').addEventListener('click', () => onNavigateView('next'));
  wireTabs();
  loadViewSortPreference();
  wireViewSortControls();

  viewHorseList = await localGetAll(LOCAL_STORES.horses);
  sortViewHorseList();
  if (window.MDR_BREEDING_SHOW_BENCHMARK?.ensureLoaded) {
    try { await window.MDR_BREEDING_SHOW_BENCHMARK.ensureLoaded(); }
    catch (error) { console.warn('Zuchtschau-Benchmark konnte nicht geladen werden:', error); }
  }

  await loadViewHorse(viewHorseId);
  if (!extraData?.id) return;

  document.getElementById('tag-badges').innerHTML = tagsBadgesHtml(extraData.tags, extraData.birthdate);
  document.getElementById('last-edited').textContent = extraData.updated_at ? `Zuletzt aktualisiert: ${formatTimestamp(extraData.updated_at)} · ${extraData.last_change_source || 'unbekannt'}` : '';
  document.getElementById('horse-age').textContent = extraData.birthdate ? `Alter: ${viewAgeLabel(extraData.birthdate)}` : '';

  const name = document.getElementById('name').value;
  document.getElementById('page-heading').textContent = '🐴 ' + (name || '(ohne Name)');
  document.title = (name || (window.MDR_I18N?.language === 'en' ? 'Horse' : 'Pferd')) + (window.MDR_I18N?.language === 'en' ? ' – MDR Database' : ' – MDR Datenbank');

  renderHorseViewHeader(extraData);
  renderHorseBreedingShowSummary(extraData, viewHorseList);
  renderHorseBreedingShowDetails(extraData, viewHorseList);
  renderHorseTournamentProfile(extraData, viewHorseList);
  if (window.MDR_LP_MODEL?.renderHorse) {
    window.MDR_LP_MODEL.renderHorse(document.getElementById('horse-lp-model'), extraData, viewHorseList);
  }
  if (typeof bpRenderBreedingPanel === 'function') await bpRenderBreedingPanel(extraData, 'breeding-progress-panel');

  const externalId = document.getElementById('external_id').value;
  const linkBtn = document.getElementById('mdr-link-btn');
  const missingLink = document.getElementById('mdr-link-missing');
  if (externalId) {
    const gameHost = mdrGameHost(extraData, 'DE');
    linkBtn.href = `https://${gameHost}/index2.php?site=pferd&id=${encodeURIComponent(externalId)}`;
    linkBtn.hidden = false;
    missingLink.hidden = true;
  } else {
    linkBtn.hidden = true;
    missingLink.hidden = false;
  }

  const swipe = document.getElementById('horse-swipe-area');
  swipe?.addEventListener('touchstart', e => { swipeStartX = e.changedTouches?.[0]?.clientX ?? null; }, {passive:true});
  swipe?.addEventListener('touchend', e => {
    if (swipeStartX == null) return;
    const endX = e.changedTouches?.[0]?.clientX;
    if (endX == null) return;
    const delta = endX - swipeStartX;
    swipeStartX = null;
    if (Math.abs(delta) < 70) return;
    onNavigateView(delta < 0 ? 'next' : 'prev');
  }, {passive:true});
}

async function onDeleteView() {
  if (!confirm('Dieses Pferd wirklich unwiderruflich löschen?')) return;
  try { await localDelete(LOCAL_STORES.horses, viewHorseKey(viewHorseId)); }
  catch (error) { document.getElementById('form-error').textContent = 'Löschen fehlgeschlagen: ' + error.message; return; }
  window.location.href = mdrRoute('database');
}

async function onNavigateView(direction) {
  const errorEl = document.getElementById('form-error');
  errorEl.textContent = '';
  if (!viewHorseList.length) {
    viewHorseList = await localGetAll(LOCAL_STORES.horses);
    sortViewHorseList();
  }
  const adjacent = viewHorseList[direction === 'next' ? viewHorseIndex + 1 : viewHorseIndex - 1];
  if (!adjacent) {
    errorEl.textContent = direction === 'next' ? 'Kein weiteres Pferd (Ende der gewählten Sortierung).' : 'Kein vorheriges Pferd (Anfang der gewählten Sortierung).';
    return;
  }
  window.location.href = mdrRoute('view',{id:adjacent.id});
}
