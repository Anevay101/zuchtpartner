
let ZH_HORSES = [];
let ZH_MARES = [];
let ZH_STALLIONS = [];
let ZH_ACTIVE_BREEDS = [];
let foreignStallion = null;
let empiricalDeviations = null;
let flaxenLookup = null;
let flaxenChildrenByName = null;

let schwerpunkt = 'gp';
let sortMode = 'best';
let richtung = 'stute';
let comboSecond = 'extpct';
let comboWeight = 50;
let turnierzuchtMode = 'off';
let turnierzuchtDiscipline = 'Reining';
let appaloosaWish = 'any';
let talentWish = '';
const REMEMBERED_PAIRING_TTL_DAYS = 60;

document.addEventListener('DOMContentLoaded', initZucht);

// Chrome kann Select-Werte aus einem bestehenden Profil bzw. dem BFCache erst
// nach DOMContentLoaded sichtbar wiederherstellen. Deshalb mehrfach nachziehen
// und dabei immer den tatsächlich sichtbaren Select-Wert übernehmen.
function resyncTurnierzuchtAfterBrowserRestore() {
  if (!document.getElementById('turnierzucht-mode')) return;
  syncTurnierzuchtUiState();
  refreshTalentWishOptions();
  syncTurnierzuchtUiState();
  updateTurnierzuchtInfo();
  renderBestMatches();
}
window.addEventListener('pageshow', () => {
  [0, 80, 300].forEach(ms => setTimeout(resyncTurnierzuchtAfterBrowserRestore, ms));
});
window.addEventListener('load', () => {
  [0, 120].forEach(ms => setTimeout(resyncTurnierzuchtAfterBrowserRestore, ms));
});


function enRepairComparable(value) {
  return JSON.stringify(value ?? null);
}

async function repairStoredEnglishHorsesForPlanner(horses) {
  let repaired = 0;

  for (let i = 0; i < horses.length; i++) {
    const old = horses[i];
    if ((old?.game_version || 'DE') !== 'EN' || !old?.raw_text) continue;

    let parsed;
    try {
      parsed = parseHorseText(old.raw_text);
    } catch (err) {
      console.warn('EN-Neuparsen fehlgeschlagen:', old?.name, err);
      continue;
    }

    // Nur parserbasierte Felder reparieren. Manuelle Tags/Notizen/Overrides
    // und lokale IDs bleiben unangetastet.
    const keys = [
      'gender','breed','birthdate','breeding_allowed','hlp_slp',
      'disease_free','genetic_diseases','colors','exterior_genetics',
      'exterior_descriptive','temperament','disciplines','traits',
      'tournament_potential','pedigree','ico','purebred_pct',
      'breed_composition','breeding_goal','breeding_goal_source','in_breeding_station','stud_fee'
    ];

    const next = { ...old };
    let changed = false;
    for (const key of keys) {
      const fresh = parsed[key];
      if (fresh === undefined || fresh === null) continue;

      // Leere Arrays/Objekte aus unvollständigem Kopiertext überschreiben
      // vorhandene gute Daten nicht.
      if (Array.isArray(fresh) && fresh.length === 0) continue;
      if (
        fresh && typeof fresh === 'object' && !Array.isArray(fresh) &&
        Object.keys(fresh).length === 0
      ) continue;

      if (enRepairComparable(next[key]) !== enRepairComparable(fresh)) {
        next[key] = fresh;
        changed = true;
      }
    }

    if (!changed) continue;

    next.updated_at = old.updated_at || new Date().toISOString();
    next.en_parser_repaired_v25 = true;

    try {
      await localPut(LOCAL_STORES.horses, next);
      horses[i] = next;
      repaired++;
    } catch (err) {
      console.warn('EN-Reparatur konnte nicht gespeichert werden:', old?.name, err);
      horses[i] = next; // wenigstens in dieser Sitzung korrekt verwenden
    }
  }

  return repaired;
}

async function initZucht() {
  await requireSession();
  await renderSharedNav();

  ZH_HORSES = await localGetAll(LOCAL_STORES.horses);
  const repairedEnglish = await repairStoredEnglishHorsesForPlanner(ZH_HORSES);
  ZH_HORSES.sort((a,b) => (a.name || '').localeCompare(b.name || '', 'de'));

  // V51: Farbguide lernt Appaloosa-Muster dynamisch aus dem tatsächlich
  // geladenen Bestand. Nicht nur aus dem beim Bau bekannten Snapshot.
  globalThis.MDR_APPALOOSA_EMPIRICAL_HORSES = ZH_HORSES;

  // Persönliche Zuchtbasis: Die Stuten müssen einem aktiven Züchter gehören.
  // Hengste dürfen von beliebigen Besitzern stammen, aber nur aus Rassen,
  // die bei den Stuten der aktiven Züchter tatsächlich vorkommen.
  ZH_ACTIVE_BREEDS = typeof activeBreedingBreeds === 'function'
    ? activeBreedingBreeds(ZH_HORSES)
    : uniqueSorted(ZH_HORSES.filter(h => isActiveBreeder(h.owner) && /stute|mare|female/i.test(String(h.gender || ''))).map(h => normalizeBreed(h.breed) || 'Rasselos'));
  const activeBreedSet = new Set(ZH_ACTIVE_BREEDS);

  ZH_MARES = ZH_HORSES.filter((h) =>
    plannerGenderLocal(h) === 'stute' &&
    isActiveBreeder(h.owner) &&
    breedingEligibleLocal(h) &&
    !(typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(h))
  );
  ZH_STALLIONS = ZH_HORSES.filter((h) =>
    plannerGenderLocal(h) === 'hengst' &&
    activeBreedSet.has(normalizeBreed(h.breed) || 'Rasselos') &&
    breedingEligibleLocal(h) &&
    !(typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(h))
  );

  if (repairedEnglish > 0) {
    console.info(`${repairedEnglish} englische Pferde für den Verpaarungsratgeber neu ausgewertet.`);
  }

  await loadEmpiricalLocal();
  buildFilters();
  buildTurnierzuchtControls();
  wireControls();
  renderInzuchtResult();
  renderRememberedPairings();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function plannerGenderLocal(h) {
  const g = String(h?.gender || '').toLowerCase();
  if (g.includes('stute') || g.includes('mare') || g.includes('female')) return 'stute';
  if (g.includes('hengst') || g.includes('stallion') || g.includes('male')) return 'hengst';
  return g;
}

function breedingEligibleLocal(h) {
  const allowed =
    h?.breeding_allowed === true ||
    /^(ja|yes|true|1)$/i.test(String(h?.breeding_allowed ?? '').trim());
  if (!allowed) return false;

  // GBH-Hengste sollen im Zuchtplaner grundsätzlich nicht mehr als
  // Zuchtpartner auftauchen. Das gilt zusätzlich zur Altersgrenze.
  if (
    plannerGenderLocal(h) === 'hengst' &&
    plannerHorseTagLabels(h).some(label => normalizeFilterText(label) === 'gbh')
  ) {
    return false;
  }

  const years = typeof gameAgeYears === 'function' ? gameAgeYears(h.birthdate) : null;
  return years == null || years < 25;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b,'de'));
}

function fillSelect(id, values, allLabel='Alle') {
  const el = document.getElementById(id);
  const old = el.value;
  el.innerHTML = `<option value="">${allLabel}</option>` +
    values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if ([...el.options].some(o => o.value === old)) el.value = old;
}

function buildFilters() {
  fillSelect('mare-owner-select', uniqueSorted(ZH_MARES.map(h => h.owner)));
  fillSelect('stallion-owner-select', uniqueSorted(ZH_STALLIONS.map(h => h.owner)));
  fillSelect('mare-breed-select', ZH_ACTIVE_BREEDS);
  fillSelect('stallion-breed-select', ZH_ACTIVE_BREEDS);

  refreshHorseSelectors();
  refreshCandidateFilters();

  const colorRoot = document.getElementById('farbwunsch-options');
  colorRoot.innerHTML = COLOR_WISH_OPTIONS.map((o) => `
    <label><input type="checkbox" value="${esc(o.label)}"> ${esc(o.label)}</label>
  `).join('');
}


function normalizeFilterText(value) {
  return String(value ?? '').trim().toLocaleLowerCase('de');
}

function ownerMatchesFilter(horse, owner) {
  if (!owner) return true;
  return normalizeFilterText(horse?.owner) === normalizeFilterText(owner);
}

function breedMatchesFilter(horse, breed) {
  if (!breed) return true;
  return normalizeFilterText(normalizeBreed(horse?.breed) || 'Rasselos') === normalizeFilterText(breed);
}

function plannerHorseTagLabels(horse) {
  if (typeof effectiveHorseTags === 'function') {
    return effectiveHorseTags(horse?.tags, horse?.birthdate).map(t => t.label).filter(Boolean);
  }
  return (horse?.tags || []).map(t => typeof t === 'string' ? t : t?.label).filter(Boolean);
}

function tagMatchesFilter(horse, tag) {
  if (!tag) return true;
  return plannerHorseTagLabels(horse).some(label => normalizeFilterText(label) === normalizeFilterText(tag));
}

function plannerHorseInBreedingStation(horse) {
  if (horse?.in_breeding_station === true) return true;
  return plannerHorseTagLabels(horse).some(label => normalizeFilterText(label) === 'zuchtstation');
}

function candidateMatchesFilters(horse, owner, breed, station = '') {
  if (!ownerMatchesFilter(horse, owner) || !breedMatchesFilter(horse, breed)) return false;
  if (station === 'true' && !plannerHorseInBreedingStation(horse)) return false;
  if (station === 'false' && plannerHorseInBreedingStation(horse)) return false;
  return true;
}

// Im Verpaarungsratgeber ist der Gegenpartner-Filter dieselbe Sache wie
// der entsprechende Besitzer-/Rassefilter oben bei Stute/Hengst.
// So gibt es keine zwei voneinander abweichenden Filterzustände mehr.
function candidateParentFilterIds() {
  return richtung === 'hengst'
    ? { owner: 'mare-owner-select', breed: 'mare-breed-select' }
    : { owner: 'stallion-owner-select', breed: 'stallion-breed-select' };
}

function setSelectValueIfAvailable(id, value) {
  const el = document.getElementById(id);
  if (!el) return false;
  const normalized = String(value ?? '');
  if ([...el.options].some(o => o.value === normalized)) {
    el.value = normalized;
    return true;
  }
  if (!normalized) {
    el.value = '';
    return true;
  }
  return false;
}

function syncCandidateFiltersFromParentControls() {
  const ids = candidateParentFilterIds();
  const owner = document.getElementById(ids.owner)?.value || '';
  const breed = document.getElementById(ids.breed)?.value || '';

  setSelectValueIfAvailable('candidate-owner-select', owner);
  setSelectValueIfAvailable('candidate-breed-select', breed);
}

function syncParentControlsFromCandidateFilters() {
  const ids = candidateParentFilterIds();
  const owner = document.getElementById('candidate-owner-select')?.value || '';
  const breed = document.getElementById('candidate-breed-select')?.value || '';

  setSelectValueIfAvailable(ids.owner, owner);
  setSelectValueIfAvailable(ids.breed, breed);
}

function filteredHorsePool(pool, ownerId, breedId) {
  const owner = document.getElementById(ownerId).value;
  const breed = document.getElementById(breedId).value;
  return pool.filter(h => candidateMatchesFilters(h, owner, breed));
}

function refreshHorseSelectors() {
  const mareSel = document.getElementById('mare-select');
  const stallionSel = document.getElementById('stallion-select');
  const oldM = mareSel.value;
  const oldS = stallionSel.value;

  const mares = filteredHorsePool(ZH_MARES, 'mare-owner-select', 'mare-breed-select');
  const stallions = filteredHorsePool(ZH_STALLIONS, 'stallion-owner-select', 'stallion-breed-select');

  mareSel.innerHTML = '<option value="">Bitte wählen…</option>' +
    mares.map(h => `<option value="${esc(h.id)}">${esc(h.name || '(ohne Name)')}</option>`).join('');
  stallionSel.innerHTML = '<option value="">Bitte wählen…</option>' +
    stallions.map(h => `<option value="${esc(h.id)}">${esc(h.name || '(ohne Name)')}</option>`).join('');

  if ([...mareSel.options].some(o => o.value === oldM)) mareSel.value = oldM;
  if ([...stallionSel.options].some(o => o.value === oldS)) stallionSel.value = oldS;
}

function refreshCandidateFilters() {
  const pool = richtung === 'hengst' ? ZH_MARES : ZH_STALLIONS;
  fillSelect('candidate-owner-select', uniqueSorted(pool.map(h => h.owner)));
  fillSelect('candidate-breed-select', ZH_ACTIVE_BREEDS);
  const stationWrap = document.getElementById('candidate-station-wrap');
  const stationSelect = document.getElementById('candidate-station-select');
  // Zuchtstation ist eine Hengst-Eigenschaft und daher nur sinnvoll, wenn
  // der gesuchte Gegenpartner ein Hengst ist.
  if (stationWrap) stationWrap.hidden = richtung === 'hengst';
  if (richtung === 'hengst' && stationSelect) stationSelect.value = '';
  syncCandidateFiltersFromParentControls();
}

function applySelectedHorseBreedToBoth(horse) {
  if (!horse) return;
  const breed = normalizeBreed(horse.breed) || 'Rasselos';

  // Eigene Seite + Gegenpol voreinstellen. Falls eine Rasse in einer
  // Auswahlliste nicht vorkommt, wird dort nichts erzwungen.
  setSelectValueIfAvailable('mare-breed-select', breed);
  setSelectValueIfAvailable('stallion-breed-select', breed);
  setSelectValueIfAvailable('candidate-breed-select', breed);

  refreshHorseSelectors();
  syncCandidateFiltersFromParentControls();
}


function syncTurnierzuchtUiState({ activateFromTalent = false } = {}) {
  const modeEl = document.getElementById('turnierzucht-mode');
  const disciplineEl = document.getElementById('turnierzucht-discipline');
  const talentEl = document.getElementById('talent-wish-select');

  if (modeEl) {
    const uiMode = ['off','main','specific'].includes(modeEl.value) ? modeEl.value : 'off';
    // Browser können Select-Werte nach einem Reload/Zurück-Navigieren optisch
    // wiederherstellen, während die JS-Variable noch auf dem Startwert "off"
    // steht. Deshalb ist die sichtbare Auswahl hier immer die Quelle der Wahrheit.
    turnierzuchtMode = uiMode;
  }
  if (disciplineEl?.value) turnierzuchtDiscipline = disciplineEl.value;
  if (talentEl) {
    talentWish = talentEl.value || '';
    // Wer eine gewünschte Begabung auswählt, möchte die optionale Turnierzucht
    // tatsächlich benutzen. Falls der Modus noch explizit "Aus" ist, wird
    // automatisch die Hauptdisziplin des Ausgangspferdes aktiviert.
    if (activateFromTalent && talentWish && turnierzuchtMode === 'off' && modeEl) {
      modeEl.value = 'main';
      turnierzuchtMode = 'main';
    }
  }
}

function buildTurnierzuchtControls() {
  const sel = document.getElementById('turnierzucht-discipline');
  sel.innerHTML = Object.entries(TURNIERZUCHT_DISCIPLINES)
    .map(([name, def]) => `<option value="${esc(name)}">${esc(def.group)} · ${esc(name)}</option>`)
    .join('');
  sel.value = turnierzuchtDiscipline;
  syncTurnierzuchtUiState();
  refreshTalentWishOptions();
  // Nach dem Neufüllen der Begabungsoptionen den ggf. vom Browser
  // wiederhergestellten Zustand noch einmal sauber übernehmen.
  syncTurnierzuchtUiState();
  updateTurnierzuchtInfo();
  setTimeout(() => {
    syncTurnierzuchtUiState();
    refreshTalentWishOptions();
    syncTurnierzuchtUiState();
    updateTurnierzuchtInfo();
    renderBestMatches();
  }, 0);
}

function refreshTalentWishOptions() {
  const sel = document.getElementById('talent-wish-select');
  if (!sel) return;
  const primary = selectedPrimaryForTurnierzucht();
  let group = null;
  if (primary) {
    group = typeof plannerHorseMainGroup === 'function'
      ? plannerHorseMainGroup(primary)
      : turnierzuchtMainGroup(primary);
  }
  if (turnierzuchtMode === 'specific') group = TURNIERZUCHT_DISCIPLINES[turnierzuchtDiscipline]?.group || group;
  const tournamentGroups = typeof MDR_TOURNAMENT_GROUPS !== 'undefined' ? MDR_TOURNAMENT_GROUPS : null;
  const options = group && tournamentGroups?.[group]
    ? tournamentGroups[group]
    : Object.keys(TURNIERZUCHT_DISCIPLINES);
  const previous = talentWish;
  sel.innerHTML = '<option value="">Keine Präferenz</option>' + options.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
  if ([...sel.options].some(o => o.value === previous)) sel.value = previous;
  else { talentWish = ''; sel.value = ''; }
}

function selectedPrimaryForTurnierzucht() {
  return richtung === 'hengst' ? selectedStallion() : selectedMare();
}

function setTurnierzuchtSummaryStatus(text, active = false) {
  const el = document.getElementById('turnierzucht-summary-status');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('active', active);
}

function updateTurnierzuchtInfo() {
  syncTurnierzuchtUiState();
  const wrap = document.getElementById('turnierzucht-specific-wrap');
  const info = document.getElementById('turnierzucht-info');
  wrap.hidden = turnierzuchtMode !== 'specific';

  if (turnierzuchtMode === 'off') {
    setTurnierzuchtSummaryStatus('Aus', false);
    info.innerHTML = 'Turnierzucht ist ausgeschaltet; die bisherige Sortierung bleibt unverändert.';
    return;
  }

  const primary = selectedPrimaryForTurnierzucht();
  if (!primary) {
    setTurnierzuchtSummaryStatus(turnierzuchtMode === 'specific' ? `Disziplin: ${turnierzuchtDiscipline}` : 'Hauptdisziplin · Pferd wählen', true);
    info.innerHTML = 'Bitte zuerst ein Ausgangspferd auswählen.';
    return;
  }

  const goalNote = primary.breeding_goal ? `<br><span class="tiny">Gespeichertes Zuchtziel: <strong>${esc(primary.breeding_goal)}</strong></span>` : '';
  const setup = turnierzuchtWeights(turnierzuchtMode, primary, turnierzuchtDiscipline);
  if (turnierzuchtMode === 'main' && !setup.group) {
    setTurnierzuchtSummaryStatus('Hauptdisziplin nicht erkannt', true);
    info.innerHTML = '⚠️ Hauptdisziplin nicht erkannt. Bitte „Bestimmte Disziplin“ verwenden oder das Pferd mit vollständig ausgeklappten Disziplinen neu einlesen.';
    return;
  }

  setTurnierzuchtSummaryStatus(
    turnierzuchtMode === 'main' ? `Hauptdisziplin: ${setup.label}` : `Disziplin: ${setup.label}`,
    true,
  );

  const weighted = [...setup.weights.entries()]
    .filter(([, weight]) => weight > 1)
    .sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de'));

  info.innerHTML = `
    <strong>Ziel: ${esc(setup.label)}</strong><br>
    Vorrangige Interieurwerte:
    ${weighted.map(([name, weight]) => `${esc(name)} ×${weight}`).join(' · ')}<br>
    <span class="tiny">Vorrangige Werte: Exzellent bekommt Bonus; Gut ist neutral; In Ordnung einen kleinen Malus; darunter gibt es deutliche Abzüge.</span>${goalNote}
  `;
}

function turnierzuchtResultHtml(tz) {
  if (!tz?.active) return '';

  const priorityRows = tz.rows
    .filter((r) => r.isPriority)
    .sort((a,b) => b.weight - a.weight || a.trait.localeCompare(b.trait, 'de'));

  return `
    <details class="turnierzucht-result">
      <summary>
        🏆 Turnierzucht ${esc(tz.label)}:
        <strong>${tz.score == null ? '–' : Math.round(tz.score) + '/100'}</strong>
        · <strong>${esc(tz.rating)}</strong>
      </summary>
      <div class="turnierzucht-result-body">
        <table class="detail-table">
          <thead>
            <tr><th>Interieurwert</th><th>Priorität</th><th>Best Case</th><th>Worst Case</th><th>Ziel</th></tr>
          </thead>
          <tbody>
            ${priorityRows.map((r) => `
              <tr>
                <th>${esc(r.trait)}</th>
                <td>×${r.weight}</td>
                <td>${esc(turnierzuchtCategoryLabel(r.best))}</td>
                <td>${esc(turnierzuchtCategoryLabel(r.worst))}</td>
                <td>${r.best === 1 ? 'Exzellent möglich' : r.best === 2 ? 'Gut möglich' : r.best === 3 ? 'In Ordnung möglich' : esc(turnierzuchtCategoryLabel(r.best))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <p class="small muted">
          <strong>Exzellent-Chance:</strong> ${tz.excellentPriority?.length || 0} relevante Werte ·
          <strong>Relevante Werte unter In Ordnung:</strong> ${tz.weakPriority?.length || 0}.
        </p>

        ${priorityRows.some(r => r.empirical?.n) ? `
          <details class="turnierzucht-empirical">
            <summary><strong>Beobachtete Interieur-Vererbung</strong></summary>
            <div class="turnierzucht-empirical-list">
              ${priorityRows.filter(r => r.empirical?.n).map(r => {
                const e = r.empirical;
                const dist = e.distribution.map(x => `${turnierzuchtCategoryLabel(x.score)} ${Math.round(x.p*100)}%`).join(' · ');
                const hit = e.withinProjectedPct == null ? '' : ` · Prognosespanne ${Math.round(e.withinProjectedPct*100)}% getroffen`;
                return `<p class="small"><strong>${esc(r.trait)}</strong> · Eltern ${esc(turnierzuchtCategoryLabel(e.lo))} × ${esc(turnierzuchtCategoryLabel(e.hi))} · n=${e.n}<br><span class="muted">${esc(dist)}${esc(hit)}</span></p>`;
              }).join('')}
            </div>
            <p class="tiny muted">Verglichen werden echte Fohlen mit demselben Eltern-Kategorienpaar beim jeweiligen Interieurwert. Das sind Erfahrungswerte, keine Gentest-Wahrscheinlichkeiten.</p>
          </details>` : '<p class="tiny muted">Für diese Interieur-Kombinationen gibt es noch keine passenden Eltern–Fohlen-Vergleiche.</p>'}

        <p class="tiny muted">
          Der Score ist eine Ranking-Hilfe aus sichtbaren Interieur-Kategorien. Der unbekannte H/h-Genotyp wird nicht erfunden.
        </p>
      </div>
    </details>
  `;
}

function wireControls() {
  document.querySelectorAll('[data-zp-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.zpTab;
      document.querySelectorAll('[data-zp-tab]').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('tab-inzucht').hidden = tab !== 'inzucht';
      document.getElementById('tab-auswahl').hidden = tab !== 'auswahl';
      if (tab === 'auswahl') renderBestMatches();
    });
  });

  ['mare-owner-select','mare-breed-select','stallion-owner-select','stallion-breed-select']
    .forEach(id => document.getElementById(id).addEventListener('change', () => {
      refreshHorseSelectors();

      const candidateIds = candidateParentFilterIds();
      if (id === candidateIds.owner || id === candidateIds.breed) {
        syncCandidateFiltersFromParentControls();
      }

      renderInzuchtResult();
      renderBestMatches();
    }));

  document.getElementById('mare-select').addEventListener('change', () => {
    const mare = selectedMare();
    if (mare) applySelectedHorseBreedToBoth(mare);
    renderInzuchtResult();
    refreshTalentWishOptions();
    updateTurnierzuchtInfo();
    renderBestMatches();
  });

  document.getElementById('stallion-select').addEventListener('change', () => {
    foreignStallion = null;
    document.getElementById('stallion-parse-status').textContent = '';
    const stallion = selectedStallion();
    if (stallion) applySelectedHorseBreedToBoth(stallion);
    renderInzuchtResult();
    refreshTalentWishOptions();
    updateTurnierzuchtInfo();
    renderBestMatches();
  });

  document.getElementById('stallion-parse-btn').addEventListener('click', () => {
    const text = document.getElementById('stallion-raw-text').value;
    if (!text.trim()) {
      document.getElementById('stallion-parse-status').textContent = 'Bitte zuerst Text einfügen.';
      return;
    }
    foreignStallion = parseHorseText(text);
    const foreignFeeEl = document.getElementById('foreign-stud-fee');
    foreignStallion.stud_fee = foreignFeeEl && foreignFeeEl.value !== ''
      ? Number(foreignFeeEl.value)
      : null;
    document.getElementById('stallion-select').value = '';
    if (foreignStallion?.breed) applySelectedHorseBreedToBoth(foreignStallion);
    document.getElementById('stallion-parse-status').textContent =
      `Erkannt: ${foreignStallion.name || 'kein Name gefunden'} · Decktaxe: ${studFeeDisplay(foreignStallion)}`;
    renderInzuchtResult();
    renderBestMatches();
  });

  document.getElementById('foreign-stud-fee')?.addEventListener('input', e => {
    if (!foreignStallion) return;
    foreignStallion.stud_fee = e.target.value === '' ? null : Number(e.target.value);
    renderInzuchtResult();
    renderBestMatches();
  });

  document.getElementById('richtung-select').addEventListener('change', e => {
    richtung = e.target.value;
    refreshCandidateFilters();
    updateDirectionLabels();
    refreshTalentWishOptions();
    updateTurnierzuchtInfo();
    renderBestMatches();
  });

  document.getElementById('schwerpunkt-select').addEventListener('change', e => {
    schwerpunkt = e.target.value;
    updateDirectionLabels();
    renderBestMatches();
  });

  document.getElementById('sortierung-select').addEventListener('change', e => {
    sortMode = e.target.value;
    updateComboVisibility();
    renderBestMatches();
  });

  document.getElementById('combo-second-select').addEventListener('change', e => {
    comboSecond = e.target.value;
    renderBestMatches();
  });

  document.getElementById('combo-weight-input').addEventListener('change', e => {
    const n = parseInt(e.target.value, 10);
    comboWeight = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
    e.target.value = comboWeight;
    renderBestMatches();
  });

  ['candidate-owner-select','candidate-breed-select']
    .forEach(id => document.getElementById(id).addEventListener('change', () => {
      syncParentControlsFromCandidateFilters();
      refreshHorseSelectors();
      renderInzuchtResult();
      renderBestMatches();
    }));
  document.getElementById('candidate-station-select')?.addEventListener('change', renderBestMatches);

  document.getElementById('farbwunsch-options').addEventListener('change', renderBestMatches);

  document.getElementById('talent-wish-select')?.addEventListener('change', e => {
    talentWish = e.target.value || '';
    syncTurnierzuchtUiState({ activateFromTalent: true });
    refreshTalentWishOptions();
    syncTurnierzuchtUiState();
    updateTurnierzuchtInfo();
    renderBestMatches();
  });

  document.getElementById('appaloosa-wish').addEventListener('change', e => {
    appaloosaWish = e.target.value;
    const info = document.getElementById('appaloosa-wish-info');
    if (appaloosaWish === 'snowflake') {
      info.innerHTML = '❄️ Snowflake wird im lernenden Appaloosa-Modell wie die übrigen sichtbaren Muster berücksichtigt.';
    } else if (appaloosaWish === 'any') {
      info.textContent = 'Kein Appaloosa-Muster wird bevorzugt.';
    } else {
      info.innerHTML = `Gewünschtes Muster: <strong>${esc(appaloosaWish)}</strong>. Höhere berechenbare Chancen werden bevorzugt.`;
    }
    renderBestMatches();
  });

  const turnierzuchtModeEl = document.getElementById('turnierzucht-mode');
  const applyTurnierzuchtModeFromUi = e => {
    turnierzuchtMode = e?.target?.value || turnierzuchtModeEl.value;
    syncTurnierzuchtUiState();
    refreshTalentWishOptions();
    updateTurnierzuchtInfo();
    renderBestMatches();
  };
  turnierzuchtModeEl.addEventListener('change', applyTurnierzuchtModeFromUi);
  turnierzuchtModeEl.addEventListener('input', applyTurnierzuchtModeFromUi);
  turnierzuchtModeEl.addEventListener('focus', () => {
    const before = turnierzuchtMode;
    syncTurnierzuchtUiState();
    if (before !== turnierzuchtMode) {
      refreshTalentWishOptions();
      updateTurnierzuchtInfo();
      renderBestMatches();
    }
  });

  document.getElementById('turnierzucht-discipline').addEventListener('change', e => {
    turnierzuchtDiscipline = e.target.value;
    refreshTalentWishOptions();
    updateTurnierzuchtInfo();
    renderBestMatches();
  });

  document.addEventListener('click', onDecksprungLocal);
  document.addEventListener('click', onRememberPairing);
  document.addEventListener('click', onDeleteRememberedPairing);
}

function updateComboVisibility() {
  const show = sortMode === 'combo';
  document.getElementById('combo-second-wrap').hidden = !show;
  document.getElementById('combo-weight-wrap').hidden = !show;
}

function updateDirectionLabels() {
  const isH = richtung === 'hengst';
  document.getElementById('candidate-breed-label').textContent = isH ? 'Stute-Rasse' : 'Hengst-Rasse';
  document.getElementById('candidate-owner-label').textContent = isH ? 'Stute-Besitzer' : 'Hengst-Besitzer';
  const metric = ({gp:'GP',ext:'Ext',extpct:'Ext%',int:'Int'})[schwerpunkt] || schwerpunkt;
  document.getElementById('complement-sort-option').textContent =
    isH ? `Bester Ausgleich des Hengstes (${metric})` : `Bester Ausgleich der Stute (${metric})`;
}

function selectedMare() {
  const id = document.getElementById('mare-select').value;
  return ZH_MARES.find(h => String(h.id) === String(id)) || null;
}

function selectedStallion() {
  if (foreignStallion) return foreignStallion;
  const id = document.getElementById('stallion-select').value;
  return ZH_STALLIONS.find(h => String(h.id) === String(id)) || null;
}

function selectedParentMiniHtml(horse) {
  if (!horse) return '';
  const gp = horse.tournament_potential?.['Gesamtpotenzial'];
  const ext = averageScore(horse.exterior_descriptive, scoreExteriorTerm);
  const extPct = horse.exterior_genetics?.overall?.percent;
  const intAvg = averageScore(horse.temperament, scoreTemperamentTerm);
  return `
    <span class="zp-selected-parent-name">${esc(horse.name || '(ohne Name)')}</span>
    <span>GP <strong>${gp ?? '–'}</strong></span>
    <span>Ext <strong>${ext == null ? '–' : Number(ext).toFixed(2)}</strong></span>
    <span>Ext% <strong>${extPct == null ? '–' : extPct + '%'}</strong></span>
    <span>Int <strong>${intAvg == null ? '–' : Number(intAvg).toFixed(2)}</strong></span>
    <span class="muted">${esc(horse.owner || '–')}</span>`;
}

function updateSelectedParentSummaries() {
  const pairs = [
    ['mare-selected-summary', selectedMare()],
    ['stallion-selected-summary', selectedStallion()],
  ];
  for (const [id, horse] of pairs) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.hidden = !horse;
    el.innerHTML = horse ? selectedParentMiniHtml(horse) : '';
  }
}

async function loadEmpiricalLocal() {
  const refs = await localGetAll(LOCAL_STORES.foalReferenceData);
  const liveIds = new Set(ZH_HORSES.map(h => String(h.id)));
  const extras = refs.filter(r => !r.horse_id || !liveIds.has(String(r.horse_id)));
  const combined = [...ZH_HORSES, ...extras];
  empiricalDeviations = combined.length ? computeEmpiricalDeviations(combined) : null;

  // V52: dieselbe kombinierte Lernbasis auch für die komplette
  // empirische Farbvererbung verwenden. Referenz-Fohlen zählen mit,
  // doppelte technische Referenzen werden im Farbguide selbst dedupliziert.
  globalThis.MDR_COLOR_EMPIRICAL_HORSES = combined;
  globalThis.MDR_APPALOOSA_EMPIRICAL_HORSES = combined;
  globalThis.MDR_TALENT_EMPIRICAL_HORSES = combined;
  globalThis.MDR_INTERIOR_EMPIRICAL_HORSES = combined;

  flaxenLookup = new Map();
  for (const h of combined) {
    const key = normalizeName(h.name);
    if (key && !flaxenLookup.has(key)) flaxenLookup.set(key, h);
  }
  flaxenChildrenByName = new Map();
  for (const h of combined) {
    const anc = pedigreeAncestorNames(h);
    for (const parentName of [anc[0], anc[1]]) {
      if (!parentName || normalizeName(parentName) === 'unbekannt') continue;
      const key = normalizeName(parentName);
      if (!flaxenChildrenByName.has(key)) flaxenChildrenByName.set(key, []);
      flaxenChildrenByName.get(key).push(h);
    }
  }
}

function genesText(horse) {
  if (!horse) return '–';
  if (typeof cgHorseGeneticsSummary === 'function') return cgHorseGeneticsSummary(horse);
  const genes = presentGenesSummary(horse.colors, horse.coat_color, horse.notes, horse.name);
  return genes.map(g => `${g.locus}: ${g.alleles}`).join(' · ') || '–';
}

function horseSummary(label, h) {
  if (!h) return '';
  const gp = h.tournament_potential?.['Gesamtpotenzial'];
  const ext = averageScore(h.exterior_descriptive, scoreExteriorTerm);
  const extPct = h.exterior_genetics?.overall?.percent;
  const intAvg = averageScore(h.temperament, scoreTemperamentTerm);
  return `
    <div class="result-card">
      <h2>${esc(label)}: ${esc(h.name || '(ohne Name)')}</h2>
      <p class="small muted">
        GP: <strong>${gp ?? '–'}</strong> ·
        Ext: <strong>${ext == null ? '–' : ext.toFixed(2)}</strong> ·
        Ext%: <strong>${extPct == null ? '–' : extPct + '%'}</strong> ·
        Int: <strong>${intAvg == null ? '–' : intAvg.toFixed(2)}</strong>
      </p>
      <p class="small muted">
        Fellfarbe: <strong>${esc(h.coat_color || '–')}</strong><br>
        Genetik: <strong>${esc(genesText(h))}</strong>
      </p>
      <p class="small muted">Besitzer: <strong>${esc(h.owner || '–')}</strong></p>
      ${plannerGenderLocal(h) === 'hengst' ? `<p class="small">${studFeeHtml(h)}</p>` : ''}
    </div>`;
}

function fmtGp(v) { return v == null ? '–' : Math.round(v); }
function fmtScore(v) { return v == null ? '–' : Number(v).toFixed(2); }
function fmtPct(v) { return v == null ? '–' : Number(v).toFixed(1) + '%'; }

function studFeeDisplay(horse) {
  const raw = horse?.stud_fee;
  if (raw == null || raw === '' || Number(raw) === 0) return 'kostenlos';
  const n = Number(raw);
  return Number.isFinite(n) ? `${n} DD` : 'kostenlos';
}

function studFeeHtml(horse) {
  if (!horse || plannerGenderLocal(horse) !== 'hengst') return '';
  const free = horse?.stud_fee == null || horse?.stud_fee === '' || Number(horse.stud_fee) === 0;
  return `<span class="stud-fee-badge ${free ? 'stud-fee-free' : 'stud-fee-paid'}">Decktaxe: ${esc(studFeeDisplay(horse))}</span>`;
}

function ekhWarningHtmlLocal(mare, stallion) {
  const a = (mare?.genetic_diseases || []).filter(d => isDiseaseCarrierOrAffected(d.value));
  const b = (stallion?.genetic_diseases || []).filter(d => isDiseaseCarrierOrAffected(d.value));
  if (!a.length && !b.length) return '';

  const setA = new Set(a.map(d => d.label));
  const setB = new Set(b.map(d => d.label));
  const all = [...new Set([...setA, ...setB])];
  const shared = all.filter(x => setA.has(x) && setB.has(x));
  const doubled = [...new Set(
    [...(mare?.genetic_diseases || []), ...(stallion?.genetic_diseases || [])]
      .filter(d => isDiseaseAusgepraegt(d.value))
      .map(d => d.label)
  )];

  const severe = shared.length || doubled.length;
  const detail = severe
    ? ` – ${shared.length ? `beide Eltern tragen ${shared.join(', ')}` : ''}${shared.length && doubled.length ? '; ' : ''}${doubled.length ? `${doubled.join(', ')} ausgeprägt` : ''}.`
    : ' – nur bei einem Elternteil bekannt, geringeres Risiko.';
  return `<div class="notice ${severe ? 'notice-warning' : 'notice-caution'}">⚠️ Erbkrankheit(en): <strong>${esc(all.join(', '))}</strong>${esc(detail)}</div>`;
}

function empiricalHtml(mare, stallion) {
  if (!empiricalDeviations) return '';
  const est = estimateFoalEmpirical(mare, stallion, empiricalDeviations);

  const rangeText = (key, metricFormatter) => {
    const value = est?.[key];
    const stats = empiricalDeviations?.[key];
    if (value == null || stats?.typicalLowOffset == null || stats?.typicalHighOffset == null) return '–';
    return `${metricFormatter(value + stats.typicalLowOffset)}–${metricFormatter(value + stats.typicalHighOffset)}`;
  };

  const rangeNote = (key, metricFormatter) => {
    const stats = empiricalDeviations?.[key];
    const n = Number(stats?.n || 0);
    return `typisch ${rangeText(key, metricFormatter)} · n=${n}`;
  };

  return `
    <div class="planner-empirical-estimate">
      <p class="small">
        <strong>Datenbank-Schätzung</strong><br>
        GP <strong>${fmtGp(est.gp)}</strong> <span class="tiny muted">(${rangeNote('gp',fmtGp)})</span> ·
        Ext <strong>${fmtScore(est.ext)}</strong> <span class="tiny muted">(${rangeNote('ext',fmtScore)})</span> ·
        Ext% <strong>${fmtPct(est.extPct)}</strong> <span class="tiny muted">(${rangeNote('extPct',fmtPct)})</span> ·
        Int <strong>${fmtScore(est.int)}</strong> <span class="tiny muted">(${rangeNote('int',fmtScore)})</span>
      </p>
      <p class="tiny muted">
        Schätzung = Elternmittel + Ø-Abweichung echter Fohlen. „Typisch“ = zentraler 80%-Bereich
        der bisher beobachteten Schätzfehler (10.–90. Perzentil). n = auswertbare Eltern–Fohlen-Trios je Wert.
      </p>
    </div>`;
}

function relationshipDetailsHtml(duplicates) {
  if (!duplicates?.length) return '';

  return `
    <details class="relationship-diagnostic" open>
      <summary><strong>🔎 Warum als verwandt erkannt?</strong></summary>
      <p class="small muted">
        Angezeigt werden die exakten Fundstellen. Ein echter gemeinsamer
        Vorfahr muss auf Mutter- und Vaterseite vorkommen.
        Rassen sowie Unknown/Unbekannt werden nicht als Vorfahren gewertet.
      </p>
      ${duplicates.map(d => `
        <div class="relationship-diagnostic-row">
          <strong>${esc(d.name)}</strong>
          <ul>
            ${(d.occurrences || []).map(o =>
              `<li><strong>${esc(o.side)}</strong>: ${esc(o.role || 'Stammbaum')}</li>`
            ).join('')}
          </ul>
        </div>
      `).join('')}
    </details>
  `;
}

function renderInzuchtResult() {
  updateSelectedParentSummaries();
  const mare = selectedMare();
  const stallion = selectedStallion();
  const el = document.getElementById('inzucht-result');

  let html = horseSummary('Mutter', mare) + horseSummary('Vater', stallion);
  if (!mare || !stallion) {
    if (!html) html = '<p class="muted">Stute und Hengst auswählen.</p>';
    el.innerHTML = html;
    return;
  }

  const duplicates = findSharedNames(mare, stallion);
  const ext = exteriorFoalRange(mare, stallion);
  const intR = interieurFoalRange(mare, stallion);
  const gp = estimateFoalGP(mare, stallion);

  html += `<div class="result-card"><h2>Fohlen</h2>`;
  html += duplicates.length
    ? `<div class="pill no">INZUCHT!!!</div>
       <p>${esc(duplicates.map(d => d.name).join(', '))}</p>
       ${relationshipDetailsHtml(duplicates)}`
    : `<div class="pill yes">KEINE sichtbare Inzucht</div>`;

  if (hasOveroGene(mare) && hasOveroGene(stallion)) {
    html += `<div class="notice notice-warning">⚠️ Beide Eltern tragen Overo – problematische Overo×Overo-Kombination.</div>`;
  }

  html += ekhWarningHtmlLocal(mare, stallion);
  html += `<p class="small">
    Fohlen best case: GP <strong>${fmtGp(gp.gpBest)}</strong> · Ext <strong>${fmtScore(ext.extBest)}</strong> · Ext% <strong>${fmtPct(ext.extPctBest)}</strong> · Int <strong>${fmtScore(intR.intBest)}</strong>
  </p>`;
  html += `<p class="small muted">
    Fohlen worst case: GP <strong>${fmtGp(gp.gpWorst)}</strong> · Ext <strong>${fmtScore(ext.extWorst)}</strong> · Ext% <strong>${fmtPct(ext.extPctWorst)}</strong> · Int <strong>${fmtScore(intR.intWorst)}</strong>
  </p>`;
  html += empiricalHtml(mare, stallion);
  html += colorGuideHtml(mare, stallion, globalThis.MDR_COLOR_EMPIRICAL_HORSES || ZH_HORSES);
  html += `</div>`;

  el.innerHTML = html;
}

function selectedColorWishes() {
  return [...document.querySelectorAll('#farbwunsch-options input:checked')].map(x => x.value);
}

function complementRow(c, ownerLabel) {
  const comp = c.complement;
  if (!comp) return '';
  if (schwerpunkt === 'int') {
    if (!comp.atStake) return '';
    const pct = Math.round(comp.saved / comp.atStake * 100);
    return `<p class="small muted">Ausgleich (Int): <strong>${comp.saved} von ${comp.atStake}</strong> ausgeglichen (${pct}%)</p>`;
  }
  const fixedTotal = comp.fixedTotal ?? comp.atStake ?? 0;
  const fixed = comp.fixed ?? comp.saved ?? 0;
  const heldTotal = comp.heldTotal ?? 0;
  const held = comp.held ?? 0;
  const parts = [
    `Schwächen behoben: <strong>${fixed}/${fixedTotal}</strong>`,
    `gute Stellen gehalten: <strong>${held}/${heldTotal}</strong>`,
  ];
  if (schwerpunkt === 'ext' || schwerpunkt === 'extpct') parts.push(`homozygot abgesichert: <strong>${comp.secured || 0}</strong>`);
  const pct = fixedTotal ? Math.round(fixed / fixedTotal * 100) : 100;
  return `<p class="small muted">Bester Ausgleich: ${parts.join(' · ')} <span title="Die Prozentzahl zeigt nur den Anteil behobener Schwächen; die Rangfolge berücksichtigt danach auch erhaltene gute Stellen und genetische Absicherung.">(${pct}% Schwächenbehebung)</span></p>`;
}

function comboRow(c) {
  if (!c.comboComplement) return '';
  const pctA = c.complement?.atStake ? Math.round(c.complement.saved / c.complement.atStake * 100) : 100;
  const pctB = c.comboComplement?.atStake ? Math.round(c.comboComplement.saved / c.comboComplement.atStake * 100) : 100;
  const labels = {gp:'GP',ext:'Ext',extpct:'Ext%',int:'Int'};
  return `<p class="small muted">
    Kombinierter Ausgleich (${labels[schwerpunkt]} ${comboWeight}% / ${labels[comboSecond]} ${100-comboWeight}%):
    <strong>${c.comboScore.toFixed(0)}%</strong><br>
    ${labels[schwerpunkt]}: ${pctA}% · ${labels[comboSecond]}: ${pctB}%
  </p>`;
}

function compactWhyRecommendedHtml(c) {
  const reasons = [];
  const tz = c.turnierzucht;
  if (tz?.active) {
    const excellent = tz.excellentPriority?.length || 0;
    if (excellent) reasons.push(`+ ${excellent}× Exzellent-Chance`);
  }
  if (talentWish && c.talentWishProjection) {
    const p = c.talentWishProjection;
    if (p.n && p.probability != null) reasons.push(`+ ${talentWish} ${Math.round(p.probability*100)}% (n=${p.n})`);
    else if (p.score >= .45) reasons.push(`+ ${talentWish}-Wunsch passend`);
  }
  const comp = c.complement;
  if (comp?.atStake) {
    const pct = Math.round(comp.saved / comp.atStake * 100);
    if (pct >= 60) reasons.push(`+ ${pct}% Werte-Ausgleich`);
  }
  return reasons.length ? `<div class="candidate-why"><strong>Warum empfohlen:</strong> ${reasons.slice(0,3).map(esc).join(' · ')}</div>` : '';
}

function renderBestMatches() {
  // V53.6: Der tatsächlich sichtbare Select-Wert ist bei JEDER Berechnung
  // die Quelle der Wahrheit. Keine zwischengespeicherte Zustandsvariable darf
  // einen vom Browser wiederhergestellten oder gerade geänderten Wert überholen.
  syncTurnierzuchtUiState();
  const modeEl = document.getElementById('turnierzucht-mode');
  const disciplineEl = document.getElementById('turnierzucht-discipline');
  const liveTurnierzuchtMode = ['off','main','specific'].includes(modeEl?.value) ? modeEl.value : 'off';
  const liveTurnierzuchtDiscipline = disciplineEl?.value || turnierzuchtDiscipline;
  turnierzuchtMode = liveTurnierzuchtMode;
  turnierzuchtDiscipline = liveTurnierzuchtDiscipline;
  updateTurnierzuchtInfo();
  const primary = richtung === 'hengst' ? selectedStallion() : selectedMare();
  const pool = richtung === 'hengst' ? ZH_MARES : ZH_STALLIONS;
  const primaryLabel = richtung === 'hengst' ? 'Hengst' : 'Stute';
  const candidateLabel = richtung === 'hengst' ? 'Stuten' : 'Hengste';
  const resultEl = document.getElementById('auswahl-result');
  const hint = document.getElementById('auswahl-hint');

  updateDirectionLabels();

  if (!primary) {
    resultEl.innerHTML = `<p class="muted small">Bitte zuerst ${richtung === 'hengst' ? 'einen Hengst' : 'eine Stute'} auswählen.</p>`;
    hint.textContent = '';
    return;
  }

  const owner = document.getElementById('candidate-owner-select').value;
  const breed = document.getElementById('candidate-breed-select').value;
  const station = richtung === 'hengst' ? '' : (document.getElementById('candidate-station-select')?.value || '');
  const filtered = pool.filter(h => candidateMatchesFilters(h, owner, breed, station));

  const ranked = rankStallions(primary, filtered, {
    schwerpunkt,
    farbwuensche: selectedColorWishes(),
    sortMode,
    empiricalDeviations,
    flaxenLookup,
    flaxenChildrenByName,
    comboSecond,
    comboWeight,
  });

  // Ohne Turnierzucht bleibt exakt das bisherige Top-20-Verhalten bestehen.
  // Mit Turnierzucht wird dagegen der gesamte bereits hart gefilterte Pool
  // bewertet, damit ein guter Turnierzucht-Partner nicht schon durch die
  // normale GP/Ext/Int-Vorsortierung außerhalb der Top 20 abgeschnitten wird.
  const resultLimit = ranked.top.length || 20;
  let rankingPool = liveTurnierzuchtMode !== 'off' && Array.isArray(ranked.all)
    ? ranked.all.slice()
    : ranked.top.slice();

  if (liveTurnierzuchtMode !== 'off') {
    rankingPool.forEach((c, originalIndex) => {
      const candidate = c.stallion;
      const mareForTz = richtung === 'hengst' ? candidate : primary;
      const stallionForTz = richtung === 'hengst' ? primary : candidate;
      c.turnierzucht = turnierzuchtEvaluate(
        mareForTz, stallionForTz, liveTurnierzuchtMode, liveTurnierzuchtDiscipline, primary
      );
      c._originalRank = originalIndex;
    });

    rankingPool.sort((a,b) => {
      const diff = turnierzuchtRankValue(b.turnierzucht) - turnierzuchtRankValue(a.turnierzucht);
      if (Math.abs(diff) > 0.0001) return diff;
      return a._originalRank - b._originalRank;
    });
  }

  if (talentWish) {
    rankingPool.forEach((c,index) => {
      const candidate = c.stallion;
      const mareForTalent = richtung === 'hengst' ? candidate : primary;
      const stallionForTalent = richtung === 'hengst' ? primary : candidate;
      c.talentWishProjection = plannerTalentWishProjection(
        mareForTalent, stallionForTalent, talentWish,
        globalThis.MDR_TALENT_EMPIRICAL_HORSES || ZH_HORSES
      );
      c._beforeTalentRank = index;
      c._talentRankValue = index - ((c.talentWishProjection?.score || 0) * 2.5);
    });
    if (liveTurnierzuchtMode !== 'off') {
      // Turnierzucht bleibt Primärsortierung. Der Begabungswunsch wirkt nur
      // als Bonus/Tie-Breaker und kann einen besseren Turnierzucht-Score nicht
      // unbemerkt hinter einen schlechteren schieben.
      rankingPool.sort((a,b) => {
        const tzDiff = turnierzuchtRankValue(b.turnierzucht) - turnierzuchtRankValue(a.turnierzucht);
        if (Math.abs(tzDiff) > 0.0001) return tzDiff;
        const talentDiff = (b.talentWishProjection?.score || 0) - (a.talentWishProjection?.score || 0);
        if (Math.abs(talentDiff) > 1e-9) return talentDiff;
        return a._beforeTalentRank - b._beforeTalentRank;
      });
    } else {
      rankingPool.sort((a,b) => a._talentRankValue - b._talentRankValue || a._beforeTalentRank - b._beforeTalentRank);
    }
  }

  if (appaloosaWish !== 'any') {
    rankingPool.forEach((c,index) => {
      const candidate = c.stallion;
      const mareForColor = richtung === 'hengst' ? candidate : primary;
      const stallionForColor = richtung === 'hengst' ? primary : candidate;
      c.appaloosaWishScore = cgAppaloosaWishScore(mareForColor,stallionForColor,appaloosaWish,globalThis.MDR_COLOR_EMPIRICAL_HORSES || ZH_HORSES);
      c._beforeColorRank = index;
    });
    rankingPool.sort((a,b) => {
      if (liveTurnierzuchtMode !== 'off') {
        const tzDiff = turnierzuchtRankValue(b.turnierzucht) - turnierzuchtRankValue(a.turnierzucht);
        if (Math.abs(tzDiff) > 0.0001) return tzDiff;
      }
      if (a.appaloosaWishScore == null && b.appaloosaWishScore == null) return a._beforeColorRank-b._beforeColorRank;
      if (a.appaloosaWishScore == null) return 1;
      if (b.appaloosaWishScore == null) return -1;
      if (Math.abs(b.appaloosaWishScore-a.appaloosaWishScore) > 1e-9) return b.appaloosaWishScore-a.appaloosaWishScore;
      return a._beforeColorRank-b._beforeColorRank;
    });
  }

  ranked.top = rankingPool
    .filter(c => candidateMatchesFilters(c.stallion, owner, breed, station))
    .slice(0, resultLimit);

  // Sicherheitsprüfung: keine Karte darf den aktiven Besitzer-/Rassefilter verletzen.
  const leaked = ranked.top.filter(c => !candidateMatchesFilters(c.stallion, owner, breed, station));
  if (leaked.length) {
    console.error('Kandidatenfilter-Sicherheitsprüfung fehlgeschlagen', leaked);
    ranked.top = ranked.top.filter(c => candidateMatchesFilters(c.stallion, owner, breed, station));
  }

  const ex = ranked.exclusionStats || {};
  const exclusionBits = [];
  if (ex.related) exclusionBits.push(`${ex.related} wegen echter gemeinsamer Verwandtschaft`);
  if (ex.overo) exclusionBits.push(`${ex.overo} wegen Overo × Overo`);
  if (ex.colorWish) exclusionBits.push(`${ex.colorWish} wegen aktivem Farbwunsch`);

  const activeFilterBits = [];
  if (owner) activeFilterBits.push(`Besitzer: ${owner}`);
  if (breed) activeFilterBits.push(`Rasse: ${breed}`);
  
  hint.textContent = `${ranked.candidateCount} von ${ranked.total} ${candidateLabel} passen, Top ${ranked.top.length} angezeigt.` +
    (activeFilterBits.length ? ` · Aktiver Kandidatenfilter: ${activeFilterBits.join(' · ')}.` : ' · Kandidatenfilter: Alle.') +
    (exclusionBits.length ? ` · Ausgeschlossen: ${exclusionBits.join(', ')}.` : '') +
    (liveTurnierzuchtMode !== 'off' ? ' · Turnierzucht wird vorrangig gewertet.' : '') +
    (appaloosaWish !== 'any' ? ` · Appaloosa-Wunsch ${appaloosaWish === 'snowflake' ? 'Snowflake' : appaloosaWish} berücksichtigt.` : '') +
    (talentWish ? ` · Begabungswunsch ${talentWish} als kleiner Zusatzfaktor.` : '');

  let html = horseSummary(primaryLabel, primary);
  html += `<div class="notice">
    Erklärung zur Fohlen-Vorhersage: <strong>Int</strong> ist eine Näherung aus den Phänotyp-Kategorien der Eltern.
    <strong>GP</strong> wird aus den Grenzwerten der Eltern-Einzelwerte geschätzt. Ext und Ext% verwenden die Genotyp-Logik.
  </div>`;

  if (!ranked.top.length) {
    const totalOppositeSex = pool.length;
    const filteredCount = filtered.length;
    const unknownPedigreeCandidates = filtered.filter(h =>
      pedigreeAncestorNames(h).some(isUnknownAncestorName)
    ).length;

    resultEl.innerHTML = html + `
      <p class="muted">Keine passenden ${candidateLabel} gefunden.</p>
      <div class="notice small">
        Diagnose: ${totalOppositeSex} zuchtfähige ${candidateLabel} insgesamt,
        ${filteredCount} nach Besitzer-/Rassefilter.<br>
        <strong>Ausschlussgründe:</strong>
        echte gemeinsame Verwandtschaft ${ranked.exclusionStats?.related || 0},
        Overo × Overo ${ranked.exclusionStats?.overo || 0},
        aktiver Farbwunsch ${ranked.exclusionStats?.colorWish || 0}.<br>
        ${unknownPedigreeCandidates ? `${unknownPedigreeCandidates} Kandidaten haben unbekannte Stammbaumplätze; Unknown/Unbekannt wird ausdrücklich ignoriert.` : ''}
        Eine Namenswiederholung <strong>nur innerhalb derselben Elternseite</strong>
        gilt nicht mehr als gemeinsamer Vorfahr.
      </div>`;
    return;
  }

  html += `<div class="group-heading">${candidateLabel}</div>`;

  html += ranked.top.map((c, i) => {
    const h = c.stallion;
    const mare = richtung === 'hengst' ? h : primary;
    const stallion = richtung === 'hengst' ? primary : h;
    const gp = h.tournament_potential?.['Gesamtpotenzial'];
    const ext = averageScore(h.exterior_descriptive, scoreExteriorTerm);
    const extPct = h.exterior_genetics?.overall?.percent;
    const intAvg = averageScore(h.temperament, scoreTemperamentTerm);

    return `
      <div class="result-card zp-candidate-card" data-owner="${esc(h.owner || '')}" data-breed="${esc(normalizeBreed(h.breed) || 'Rasselos')}">
        <div class="zp-candidate-head">
          <h2><span class="zp-rank">${i+1}.</span> ${esc(h.name || '(ohne Name)')}</h2>
          <div class="zp-stat-strip">
            <span>GP <strong>${gp ?? '–'}</strong></span>
            <span>Ext <strong>${fmtScore(ext)}</strong></span>
            <span>Ext% <strong>${extPct == null ? '–' : extPct + '%'}</strong></span>
            <span>Int <strong>${fmtScore(intAvg)}</strong></span>
          </div>
        </div>
        <p class="small muted zp-candidate-meta">
          <span>🎨 ${esc(h.coat_color || '–')}</span>
          <span>🧬 ${esc(genesText(h))}</span>
          <span>👤 ${esc(h.owner || '–')}</span>
          ${plannerGenderLocal(h) === 'hengst' ? `<span>${studFeeHtml(h)}</span>` : ''}
        </p>
        ${compactWhyRecommendedHtml(c)}

        ${ekhWarningHtmlLocal(mare, stallion)}

        <div class="zp-foal-case-grid">
          <p class="small zp-foal-case zp-foal-best">
            <strong>Best Case</strong>
            <span>GP ${fmtGp(c.gpBest)}</span><span>Ext ${fmtScore(c.extBest)}</span><span>Ext% ${fmtPct(c.extPctBest)}</span><span>Int ${fmtScore(c.intBest)}</span>
          </p>

          <p class="small muted zp-foal-case zp-foal-worst">
            <strong>Worst Case</strong>
            <span>GP ${fmtGp(c.gpWorst)}</span><span>Ext ${fmtScore(c.extWorst)}</span><span>Ext% ${fmtPct(c.extPctWorst)}</span><span>Int ${fmtScore(c.intWorst)}</span>
          </p>
        </div>

        ${empiricalHtml(mare, stallion)}
        ${sortMode === 'combo' ? comboRow(c) : complementRow(c, primaryLabel)}
        ${appaloosaWish !== 'any' && c.appaloosaWishScore != null
          ? `<p class="small"><strong>🐆 ${esc(appaloosaWish === 'snowflake' ? 'Snowflake' : appaloosaWish)}:</strong> ${cgPct(c.appaloosaWishScore)} konservative Mindestchance aus aktuellem Genetik-/Datenbankmodell</p>`
          : ''}
        ${talentWish && c.talentWishProjection ? (() => {
          const p=c.talentWishProjection;
          return p.n && p.probability != null
            ? `<p class="small talent-wish-line"><strong>🎯 Begabungswunsch ${esc(talentWish)}:</strong> ${Math.round(p.probability*100)}% bisher beobachtet (n=${p.n})</p>`
            : `<p class="small talent-wish-line"><strong>🎯 Begabungswunsch ${esc(talentWish)}:</strong> noch keine passende Eltern–Fohlen-Gruppe; nur kleiner Eltern-Tendenzbonus</p>`;
        })() : ''}
        ${colorGuideHtml(mare, stallion, globalThis.MDR_COLOR_EMPIRICAL_HORSES || ZH_HORSES)}
        ${turnierzuchtResultHtml(c.turnierzucht)}

        <div class="actions">
          <a class="btn secondary" href="view.html?id=${encodeURIComponent(h.id)}">Pferd ansehen</a>
          <button type="button" class="btn secondary decksprung-btn"
            data-mare="${esc(mare.name || '')}"
            data-mare-id="${esc(mare.id || '')}"
            data-stallion="${esc(stallion.name || '')}"
            data-stallion-id="${esc(stallion.id || '')}"
            data-owner="${esc(mare.owner || '')}">Decksprung nutzen</button>
          <button type="button" class="btn secondary remember-pairing-btn"
            data-mare-id="${esc(mare.id || '')}"
            data-stallion-id="${esc(stallion.id || '')}">⭐ Vergleich merken</button>
          <span class="small muted decksprung-status"></span>
        </div>
      </div>`;
  }).join('');

  resultEl.innerHTML = html;
}

async function onDecksprungLocal(e) {
  const btn = e.target.closest('.decksprung-btn');
  if (!btn) return;

  const status = btn.parentElement.querySelector('.decksprung-status');
  btn.disabled = true;
  status.textContent = 'Speichert…';

  try {
    const foaling = new Date();
    foaling.setDate(foaling.getDate() + 30);

    const mare = ZH_HORSES.find(h => String(h.id) === String(btn.dataset.mareId))
      || ZH_HORSES.find(h => normalizeName(h.name) === normalizeName(btn.dataset.mare));
    const stallion = ZH_HORSES.find(h => String(h.id) === String(btn.dataset.stallionId))
      || (foreignStallion && normalizeName(foreignStallion.name) === normalizeName(btn.dataset.stallion) ? foreignStallion : null)
      || ZH_HORSES.find(h => normalizeName(h.name) === normalizeName(btn.dataset.stallion));

    const predictionSnapshot = mare && stallion
      ? buildFoalPredictionSnapshot(mare, stallion, empiricalDeviations, 'zuchtplaner-decksprung')
      : null;

    const savedId = await localAdd(LOCAL_STORES.pairings, {
      owner: btn.dataset.owner || null,
      stallion: btn.dataset.stallion || null,
      mare: btn.dataset.mare || null,
      pairing_date: (() => {
        const pad = n => String(n).padStart(2, '0');
        return `${foaling.getFullYear()}-${pad(foaling.getMonth() + 1)}-${pad(foaling.getDate())}`;
      })(),
      keep_foal: null,
      notes: null,
      stallion_stud_fee: stallion?.stud_fee == null || stallion?.stud_fee === ''
        ? null
        : Number(stallion.stud_fee),
      prediction_snapshot: predictionSnapshot,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Nicht nur dem IndexedDB-"add"-Event vertrauen: den frisch angelegten
    // Datensatz direkt wieder lesen. Nur dann Erfolg melden.
    const saved = await localGet(LOCAL_STORES.pairings, savedId);
    if (!saved) {
      throw new Error('Der Eintrag konnte nach dem Speichern nicht wiedergefunden werden.');
    }

    status.innerHTML = '✓ Gespeichert · <a href="verpaarung.html">Zum Verpaarungs-Log</a>';
  } catch (err) {
    status.textContent = 'Fehler: ' + err.message;
    btn.disabled = false;
  }
}


async function onRememberPairing(e) {
  const btn = e.target.closest('.remember-pairing-btn');
  if (!btn) return;

  const mare =
    ZH_HORSES.find(h => String(h.id) === String(btn.dataset.mareId)) ||
    (selectedMare()?.id && String(selectedMare().id) === String(btn.dataset.mareId) ? selectedMare() : null);

  const stallion =
    ZH_HORSES.find(h => String(h.id) === String(btn.dataset.stallionId)) ||
    (
      foreignStallion &&
      (
        !btn.dataset.stallionId ||
        String(foreignStallion.id || '') === String(btn.dataset.stallionId)
      )
        ? foreignStallion
        : null
    );

  if (!mare || !stallion) {
    alert('Die Verpaarung konnte nicht gemerkt werden, weil Stute oder Hengst nicht mehr eindeutig gefunden wurde.');
    return;
  }

  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Speichert…';

  try {
    const all = await localGetAll(LOCAL_STORES.pairingNotes);
    const mareKey = String(mare.id || normalizeName(mare.name));
    const stallionKey = String(stallion.id || normalizeName(stallion.name));
    const existing = all.find(r =>
      String(r.mare_id || normalizeName(r.mare_name)) === mareKey &&
      String(r.stallion_id || normalizeName(r.stallion_name)) === stallionKey
    );

    const record = {
      ...(existing || {}),
      mare_id: mare.id || null,
      mare_name: mare.name || '',
      stallion_id: stallion.id || null,
      stallion_name: stallion.name || '',
      mare_owner: mare.owner || '',
      stallion_owner: stallion.owner || '',
      stallion_stud_fee: stallion?.stud_fee == null || stallion?.stud_fee === ''
        ? null
        : Number(stallion.stud_fee),
      mare_goal: mare.breeding_goal || '',
      stallion_goal: stallion.breeding_goal || '',
      updated_at: new Date().toISOString(),
      created_at: existing?.created_at || new Date().toISOString(),
    };

    if (existing) await localPut(LOCAL_STORES.pairingNotes, record);
    else await localAdd(LOCAL_STORES.pairingNotes, record);

    // Speicherung kontrollieren, bevor Erfolg angezeigt wird.
    const savedRows = await localGetAll(LOCAL_STORES.pairingNotes);
    const saved = savedRows.find(r =>
      String(r.mare_id || normalizeName(r.mare_name)) === mareKey &&
      String(r.stallion_id || normalizeName(r.stallion_name)) === stallionKey
    );
    if (!saved) throw new Error('Der gemerkte Vergleich konnte nach dem Speichern nicht wiedergefunden werden.');

    btn.textContent = '✓ Gemerkt';
    await renderRememberedPairings();
  } catch (err) {
    btn.textContent = 'Fehler';
    console.error(err);
    alert('Vergleich konnte nicht gespeichert werden: ' + err.message);
  }

  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = oldText;
  }, 1200);
}

async function onDeleteRememberedPairing(e) {
  const btn = e.target.closest('.delete-remembered-pairing');
  if (!btn) return;
  await localDelete(LOCAL_STORES.pairingNotes, Number(btn.dataset.id));
  await renderRememberedPairings();
}

async function renderRememberedPairings() {
  const root = document.getElementById('remembered-pairings');
  if (!root) return;

  let rows = await localGetAll(LOCAL_STORES.pairingNotes);
  const now = Date.now();
  const ttlMs = REMEMBERED_PAIRING_TTL_DAYS * 24 * 60 * 60 * 1000;

  // Altbestände ohne Merkdatum bekommen beim ersten Laden ein Startdatum,
  // damit sie nicht unvermittelt gelöscht werden.
  for (const row of rows) {
    if (!row.created_at) {
      row.created_at = new Date().toISOString();
      row.updated_at = row.updated_at || row.created_at;
      await localPut(LOCAL_STORES.pairingNotes,row);
    }
  }

  const expired = rows.filter(row => {
    const t = new Date(row.created_at).getTime();
    return Number.isFinite(t) && now - t >= ttlMs;
  });
  for (const row of expired) await localDelete(LOCAL_STORES.pairingNotes, Number(row.id));
  if (expired.length) rows = rows.filter(row => !expired.some(x => String(x.id) === String(row.id)));

  rows.sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  if (!rows.length) {
    root.innerHTML = '<p class="muted">Noch nichts gemerkt.</p>';
    return;
  }

  const horseById = new Map(ZH_HORSES.map(h => [String(h.id),h]));
  const horseByName = new Map(ZH_HORSES.map(h => [normalizeName(h.name),h]));
  const remainingDays = row => {
    const t = new Date(row.created_at).getTime();
    if (!Number.isFinite(t)) return REMEMBERED_PAIRING_TTL_DAYS;
    return Math.max(0, Math.ceil((ttlMs - (now - t)) / (24*60*60*1000)));
  };
  const currentStallion = row => horseById.get(String(row.stallion_id)) || horseByName.get(normalizeName(row.stallion_name)) || null;
  const currentFee = row => {
    const horse = currentStallion(row);
    const fee = horse?.stud_fee ?? row.stallion_stud_fee;
    if (fee == null || fee === '' || Number(fee) === 0) return 'kostenlos';
    return `${Number(fee)} DD`;
  };

  root.innerHTML = `
    <div class="table-wrap">
      <table class="detail-table remembered-pairings-table">
        <thead><tr><th>Stute</th><th>Hengst</th><th>Zuchtziel</th><th>Gemerkt</th><th>Noch</th><th></th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><strong>${r.mare_id ? `<a href="view.html?id=${encodeURIComponent(r.mare_id)}">${esc(r.mare_name || '–')}</a>` : esc(r.mare_name || '–')}</strong>${r.mare_owner ? `<br><span class="small muted">${esc(r.mare_owner)}</span>` : ''}</td>
              <td><strong>${r.stallion_id ? `<a href="view.html?id=${encodeURIComponent(r.stallion_id)}">${esc(r.stallion_name || '–')}</a>` : esc(r.stallion_name || '–')}</strong>${r.stallion_owner ? `<br><span class="small muted">${esc(r.stallion_owner)}</span>` : ''}<br><span class="tiny muted">Decktaxe: ${esc(currentFee(r))}</span></td>
              <td>${esc(r.mare_goal || r.stallion_goal || '–')}</td>
              <td>${r.created_at ? esc(new Date(r.created_at).toLocaleDateString('de-DE')) : '–'}</td>
              <td><strong>${remainingDays(r)} Tage</strong></td>
              <td><button type="button" class="btn secondary delete-remembered-pairing" data-id="${r.id}">Löschen</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <p class="tiny muted">Gemerkte Verpaarungen werden 60 Tage nach dem Merken automatisch entfernt. Echte Einträge im Verpaarungs-Log bleiben erhalten.</p>
  `;
}
