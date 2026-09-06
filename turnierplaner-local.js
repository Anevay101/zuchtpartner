
let TP_HORSES = [];
let TP_ALL_HORSES = [];
let TP_SELECTED = null;
let TP_TOURNAMENT_REFERENCES = {};

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
  // Lerndatei bleibt bewusst in TP_ALL_HORSES für das ZS-Lernmodell,
  // wird aber aus allen operativen Turnier-/Cup-Listen ausgeblendet.
  TP_HORSES = TP_ALL_HORSES.filter(h => isActiveBreeder(h.owner) && !(typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(h)));
  TP_HORSES.sort((a,b) => (a.name || '').localeCompare(b.name || '', 'de'));

  const thresholdInput = document.getElementById('tp-secondary-threshold');
  if (thresholdInput) thresholdInput.value = String(plannerTournamentAbsoluteMin(150));
  TP_TOURNAMENT_REFERENCES = plannerBuildTournamentReferences(TP_ALL_HORSES, tournamentScore);

  buildTournamentControls();
  buildCupAndShowControls();
  wireTournamentControls();
  wireTurnierMainTabs();
  renderTournamentRanking();
  renderCupAchievements();
  renderCupCalendar();
  renderBreedingShowOverview();
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

  const breeds = [...new Set(TP_HORSES.map(h => h.breed).filter(Boolean))]
    .sort((a,b) => a.localeCompare(b,'de'));
  const breedOptions =
    '<option value="">Alle</option>' +
    breeds.map(b => `<option value="${plannerEscape(b)}">${plannerEscape(b)}</option>`).join('');

  document.getElementById('tp-breed').innerHTML = breedOptions;
  document.getElementById('tp-table-breed').innerHTML = breedOptions;
  document.getElementById('tp-horse-breed').innerHTML = breedOptions;

  refreshTournamentHorseSelect();
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

  // Zuchtschau-Lernmodell und ZS-Liste arbeiten bewusst mit dem gesamten
  // Datenbestand, nicht nur mit den in Einstellungen gesetzten aktiven Züchtern.
  const zsVisibleHorses=TP_ALL_HORSES.filter(h=>!(typeof mdrIsLearningHorse==='function' && mdrIsLearningHorse(h)));
  const zsOwners=[...new Set(zsVisibleHorses.map(h=>h.owner).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de'));
  const zsBreeds=[...new Set(zsVisibleHorses.map(h=>normalizeBreed(h.breed)||'Rasselos'))].sort((a,b)=>a.localeCompare(b,'de'));
  const ownerSel=document.getElementById('tp-zs-owner');
  if (ownerSel) ownerSel.innerHTML='<option value="">Alle Besitzer</option>' + zsOwners.map(v=>`<option value="${plannerEscape(v)}">${plannerEscape(v)}</option>`).join('');
  const breedSel=document.getElementById('tp-zs-breed');
  if (breedSel) breedSel.innerHTML='<option value="">Alle Rassen</option>' + zsBreeds.map(v=>`<option value="${plannerEscape(v)}">${plannerEscape(v)}</option>`).join('');
}

function wireTurnierMainTabs() {
  document.querySelectorAll('[data-tp-main-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab=btn.dataset.tpMainTab;
      document.querySelectorAll('[data-tp-main-tab]').forEach(b=>b.classList.toggle('active',b===btn));
      document.querySelectorAll('.tp-main-panel').forEach(panel=>panel.hidden = panel.id !== `tp-tab-${tab}`);
      if (tab==='cups') { renderCupAchievements(); renderCupCalendar(); }
      if (tab==='show') renderBreedingShowOverview();
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
  ['tp-zs-owner','tp-zs-breed','tp-zs-only','tp-zs-breeding'].forEach(id=>document.getElementById(id)?.addEventListener('change',renderBreedingShowOverview));
  document.getElementById('tp-zs-reset')?.addEventListener('click',()=>{
    const defaults={
      'tp-zs-name':'','tp-zs-owner':'','tp-zs-breed':'','tp-zs-only':'with','tp-zs-breeding':''
    };
    Object.entries(defaults).forEach(([id,value])=>{ const el=document.getElementById(id); if(el) el.value=value; });
    renderBreedingShowOverview();
  });

  document.getElementById('tp-cup-body')?.addEventListener('click', async (e) => {
    const btn=e.target.closest('[data-confirm-cup]');
    if (!btn) return;
    btn.disabled=true;
    try {
      await confirmProbableCupStar(btn.dataset.horseId, btn.dataset.discipline);
    } catch (error) {
      console.error(error);
      alert('Cupstern konnte nicht bestätigt werden: ' + (error.message || String(error)));
      btn.disabled=false;
    }
  });
}

function refreshTournamentHorseSelect() {
  const breed = document.getElementById('tp-horse-breed')?.value || '';
  const current = document.getElementById('tp-horse')?.value || '';
  const horses = TP_HORSES.filter(h => !breed || h.breed === breed);

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

  ['tp-discipline','tp-lk','tp-owner','tp-breed'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderTournamentRanking);
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
    if (breed && horse.breed !== breed) return false;
    if (pointsMin != null && eval.points < pointsMin) return false;
    if (interiorMax != null && (eval.interior == null || eval.interior > interiorMax)) return false;
    if (lkFilter && eval.lk !== lkFilter) return false;

    // Tabellenfilter wirken zusätzlich
    if (tableHorse) {
      const haystack = `${horse.name || ''} ${horse.owner || ''}`.toLowerCase();
      if (!haystack.includes(tableHorse)) return false;
    }
    if (tableDiscipline && !eval.discipline.toLowerCase().includes(tableDiscipline)) return false;
    if (tableBreed && horse.breed !== tableBreed) return false;
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

  document.getElementById('tp-title').textContent =
    `Turnierwerte – ${disciplineName || 'Disziplin'}`;

  document.getElementById('tp-count').textContent =
    `${rows.length} Pferde mit vollständig auswertbaren Werten`;

  // Ab mehr als 20 Treffern bekommt nur die Gesamtliste eine eigene Scrollbar.
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
      <p><strong>Hauptdisziplin:</strong> ${plannerEscape(mainLabel)}${best ? ` · <strong>${bestLabel}:</strong> ${plannerEscape(best.discipline)} ${Math.round(best.points)} · Int ${best.interior == null ? '–' : best.interior.toFixed(2)} · ${plannerEscape(best.lk || 'LK –')}` : ' · <span class="muted">keine Disziplin entspricht den oberen Filtern</span>'}</p>
      <p class="small"><strong>Alternative:</strong> ${alternativeText}</p>
      <p class="tiny muted">Hauptdisziplin geeignet ab <strong>${Math.round(visibleProfile.mainMin)} Punkten</strong> · Nebendisziplinen ab <strong>${Math.round(visibleProfile.secondaryMin)} Punkten</strong>. Spezialisten-P25 ist nur Vergleichswert und kein Ausschlusskriterium.</p>
      <p class="tiny muted tournament-reference-basis"><strong>Referenzbasis:</strong> ${plannerEscape(plannerTournamentReferenceBasisText(visibleProfile.references))}</p>
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
      </tr>`).join('')
    : '<tr><td colspan="5" class="muted">Keine geeignete Disziplin erkannt.</td></tr>';

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
          <td>${label}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="7" class="muted">Keine Disziplin entspricht den gewählten Tabellenfiltern.</td></tr>';

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
        <thead><tr><th>Disziplin</th><th>Gruppe</th><th>Punkte</th><th>Int</th><th>LK</th></tr></thead>
        <tbody>${suitableRows}</tbody>
      </table></div>
    </section>

    <details class="tournament-all-details">
      <summary>Alle 28 Disziplinen anzeigen</summary>
      <div class="table-wrap"><table class="detail-table tournament-all-table">
        <thead><tr><th>#</th><th>Disziplin</th><th>Gruppe</th><th>Punkte</th><th>Interieur</th><th>LK</th><th>Einordnung</th></tr></thead>
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
  const probable=[];
  const unknown=[];

  for (const horse of TP_HORSES) {
    const results=plannerTournamentResults(horse);
    const row=results[discipline];
    if (row?.cup_star) {
      if (row.cup_lk === lk) ready.push(horse);
      else if (!row.cup_lk) unknown.push(horse);
      continue;
    }

    const progress=plannerCupProgress(horse,discipline);
    if (!progress.requirementsReached) continue;
    const calculatedLk=plannerTournamentEvaluation(horse,discipline)?.lk || '';
    if (calculatedLk === lk) probable.push(horse);
  }

  const byName=(a,b)=>(a.name||'').localeCompare(b.name||'','de');
  ready.sort(byName); probable.sort(byName); unknown.sort(byName);
  return {ready,probable,unknown};
}

function cupCandidateLinks(horses) {
  return horses.map(h=>`<a class="cup-candidate-link" href="view.html?id=${encodeURIComponent(h.id)}"><strong>${plannerEscape(h.name || '(ohne Name)')}</strong>${h.owner ? `<span>${plannerEscape(h.owner)}</span>` : ''}</a>`).join('');
}

function cupAvailabilityHtml(discipline, lk) {
  const {ready,probable}=cupCalendarAvailability(discipline,lk);
  const readyHtml=ready.length
    ? `<details class="cup-availability cup-availability-ready"><summary>🟢 ${ready.length} verfügbar</summary><div class="cup-candidate-list">${cupCandidateLinks(ready)}</div></details>`
    : '<div class="cup-availability cup-availability-none">⚪ 0 verfügbar</div>';
  const probableHtml=probable.length
    ? `<details class="cup-availability cup-availability-probable"><summary>🟡 +${probable.length} wahrscheinlich</summary><div class="cup-candidate-list">${cupCandidateLinks(probable)}</div></details>`
    : '';
  return `<div class="cup-lk-slot"><strong>${lk} · ${MDR_CUP_TIMES[lk]}</strong>${readyHtml}${probableHtml}</div>`;
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
  const probableTotal=firstAvail.reduce((sum,x)=>sum+x.probable.length,0);
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
        <span class="cup-count-probable">🟡 ${probableTotal} wahrscheinlich</span>
      </div>
    </div>
    <p class="tiny muted cup-calendar-rule">Fester MDR-Regelplan: 1. = Dressur bis 28. = Racking. LK10 um 21:00, LK9 um 22:00, LK8 um 23:00. Freischaltung zur Anmeldung jeweils 3 Tage vorher. Verfügbarkeit bezieht sich auf die in den Einstellungen aktiven Züchter. Grün zählt nur bestätigte Cupsterne mit passender Cup-LK; Gelb sind noch unbestätigte Vorerkennungen.</p>
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
          ${unknown.length ? `<details class="cup-calendar-unknown"><summary>⚠️ ${unknown.length} bestätigte${unknown.length===1?'r Cupstern':' Cupsterne'} ohne gespeicherte LK</summary><div class="cup-candidate-list">${cupCandidateLinks(unknown)}</div></details>` : ''}
        </article>`;
      }).join('')}
    </div>`;
}

// ---------------------------------------------------------------------
// V53.3 – Cups & Erfolge mit bestätigbarer Cup-Vorerkennung
// ---------------------------------------------------------------------
function cupAchievementRows() {
  const rows=[];
  for (const horse of TP_HORSES) {
    const results=plannerTournamentResults(horse);
    for (const [discipline,result] of Object.entries(results)) {
      if (!result.first && !result.second && !result.third && !result.cup_star) continue;
      rows.push({horse,discipline,result,progress:plannerCupProgress(horse,discipline)});
    }
    // Altes Cupstern-Schlagwort ohne strukturierte Disziplin sichtbar halten.
    const legacy=(horse?.tags || []).some(t=>(typeof t==='string'?t:t?.label)==='Cupstern');
    if (legacy && !plannerCupStarRows(horse).length && !Object.keys(results).length) {
      rows.push({horse,discipline:'',result:{first:0,second:0,third:0,cup_star:true,cup_lk:''},progress:{wins:0,starts:plannerTournamentStarts(horse),requirementsReached:false,cupStar:true}});
    }
  }
  return rows;
}

function cupProbableUnconfirmedRows(horse) {
  const results=plannerTournamentResults(horse);
  return Object.entries(results)
    .filter(([discipline,row]) => !row.cup_star && plannerCupProgress(horse,discipline).requirementsReached)
    .map(([discipline,row]) => ({discipline,row}));
}

async function confirmProbableCupStar(horseId, discipline) {
  const horse=TP_ALL_HORSES.find(h=>String(h.id)===String(horseId));
  if (!horse) throw new Error('Pferd nicht gefunden.');
  if (!MDR_TOURNAMENT_DISCIPLINES[discipline]) throw new Error('Disziplin nicht erkannt.');
  const progress=plannerCupProgress(horse,discipline);
  if (!progress.requirementsReached && !progress.cupStar) {
    throw new Error('Die bekannten Grundvoraussetzungen (50 Starts + 15 Siege) sind noch nicht erreicht.');
  }

  const raw = horse.tournament_results && typeof horse.tournament_results==='object' && !Array.isArray(horse.tournament_results)
    ? {...horse.tournament_results} : {};
  const existing = raw[discipline] && typeof raw[discipline]==='object' ? {...raw[discipline]} : {};
  raw[discipline] = {
    ...existing,
    first: Number(progress.first || existing.first || 0),
    second: Number(progress.second || existing.second || 0),
    third: Number(progress.third || existing.third || 0),
    cup_star: true,
    // Bei einer manuellen Bestätigung der Vorerkennung ist die Cup-LK noch
    // nicht aus dem MDR-Turnierreiter bekannt. Da ein Pferd je Disziplin nur
    // in seiner durch den schwächsten Leistungswert bestimmten LK starten kann,
    // übernehmen wir diese berechnete LK als sinnvolle Voreinstellung. Sie bleibt
    // auf der Pferdeseite jederzeit korrigierbar.
    cup_lk: existing.cup_lk || progress.cup_lk || plannerTournamentEvaluation(horse, discipline)?.lk || '',
  };

  const tags=Array.isArray(horse.tags) ? horse.tags.map(t=>typeof t==='string'?{label:t}:{...t}) : [];
  if (!tags.some(t=>t?.label==='Cupstern')) tags.push({label:'Cupstern'});
  const legacyCupResults={...(horse.cup_results || {})};
  legacyCupResults[discipline]=Math.max(Number(legacyCupResults[discipline] || 0), Number(progress.first || 0));
  const saved={...horse,tournament_results:raw,cup_results:legacyCupResults,tags,updated_at:new Date().toISOString()};
  await localPut(LOCAL_STORES.horses,saved);

  const replaceIn=(arr)=>{
    const idx=arr.findIndex(h=>String(h.id)===String(horseId));
    if (idx>=0) arr[idx]=saved;
  };
  replaceIn(TP_ALL_HORSES); replaceIn(TP_HORSES);
  renderCupAchievements();
  renderCupCalendar();
  renderBreedingShowOverview();
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

    const confirmed=Boolean(row.result.cup_star);
    const probable=Boolean(row.progress.requirementsReached && !confirmed);
    const wins=Number(row.result.first || 0);
    // Cupsterne und wahrscheinliche Cupsterne bleiben immer sichtbar.
    // Alle anderen Pferde werden erst ab 10 Siegen in dieser Disziplin gezeigt.
    if (!confirmed && !probable && wins < 10) return false;

    if (status==='star' && !confirmed) return false;
    if (status==='no-star' && confirmed) return false;
    if (status==='requirements' && !probable) return false;
    if (status==='near' && !(wins>=10 && wins<15 && !confirmed)) return false;
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
    body.innerHTML='<tr><td colspan="10" class="muted">Keine passenden Cupdaten bzw. noch keine 10 Siege in der gewählten Disziplin.</td></tr>';
    return;
  }

  body.innerHTML=rows.map(({horse,discipline,result,progress,evaluation,tournamentValue})=>{
    const starts=plannerTournamentStarts(horse);
    const probable=progress.requirementsReached && !result.cup_star;
    const confirmButton=probable
      ? `<br><button type="button" class="secondary small cup-confirm-inline" data-confirm-cup data-horse-id="${plannerEscape(horse.id)}" data-discipline="${plannerEscape(discipline)}">⭐ bestätigen</button>`
      : '';
    const statusText=result.cup_star
      ? '<strong>⭐ Cupstern</strong>'
      : probable
        ? `<strong>⭐ Cupstern wahrscheinlich</strong>${confirmButton}`
        : result.first>=10 ? `${result.first}/15 Siege` : 'ohne Cupstern';
    const nextCupDate=discipline ? cupNextDateForDiscipline(discipline) : null;
    const cupDistance=nextCupDate ? cupDayDistance(cupLocalDateOnly(new Date()),nextCupDate) : null;
    const upcomingClass=(result.cup_star || probable) && cupDistance!=null
      ? (cupDistance<=3 ? 'cup-row-urgent' : cupDistance<=7 ? 'cup-row-soon' : '')
      : '';
    const upcomingBadge=(result.cup_star || probable) && cupDistance!=null && cupDistance<=7
      ? `<br><span class="tiny cup-upcoming-badge">📅 ${cupDistance===0?'Cup heute':`Cup in ${cupDistance} Tag${cupDistance===1?'':'en'}`}</span>`
      : '';
    const cupLk=result.cup_lk || progress.cup_lk || evaluation?.lk || '–';
    const tournamentValueText=tournamentValue == null ? '–' : String(Math.round(tournamentValue));
    return `<tr class="${upcomingClass}">
      <td><a href="view.html?id=${encodeURIComponent(horse.id)}"><strong>${plannerEscape(horse.name || '(ohne Name)')}</strong></a><br><span class="tiny muted">${plannerEscape(horse.owner || '')}</span></td>
      <td>${plannerEscape(plannerHorseMainGroup(horse) || '–')} / ${plannerEscape(plannerHorseTalent(horse) || '–')}</td>
      <td>${plannerEscape(discipline || 'Disziplin noch ergänzen')}</td>
      <td>${result.first || 0}</td><td>${result.second || 0}</td><td>${result.third || 0}</td>
      <td>${starts == null ? '–' : starts}</td>
      <td>${statusText}${upcomingBadge}</td>
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
  { key:'disease', label:'Erbkrankheit' },
];

function zsFeatureObject(horse) {
  const s=plannerStats(horse);
  const values={
    gp:Number(s.gp), ext:Number(s.ext), extpct:Number(s.extpct), int:Number(s.int),
    disease:plannerHasActiveDiseaseRisk(horse)?1:0,
  };
  if (['gp','ext','extpct','int'].some(k=>!Number.isFinite(values[k]))) return null;
  return values;
}

function zsHasUnconfirmedProbableCup(horse) {
  return cupProbableUnconfirmedRows(horse).length>0;
}

function zsTrainingStatus(horse) {
  const total=plannerBreedingShowPoints(horse);
  if (total==null) return {eligible:false,reason:'no-zs'};
  const x=zsFeatureObject(horse);
  if (!x) return {eligible:false,reason:'missing-features'};
  // ZS-Anmeldung setzt mindestens eine Platzierung voraus. Sind im lokalen
  // Datensatz trotz ZS-Punkten keine Platzierungen vorhanden, ist der
  // abziehbare Turnierbonus offensichtlich unvollständig und darf das
  // Lernmodell nicht verfälschen.
  if (plannerTournamentPlacements(horse)<1) return {eligible:false,reason:'missing-tournament'};
  // Ein wahrscheinlicher, aber noch nicht bestätigter Cupstern verschiebt
  // den Grundwert um 100 Punkte. Bis zur Bestätigung wird dieses Pferd
  // daher bewusst nicht als Trainingsdatensatz benutzt.
  if (zsHasUnconfirmedProbableCup(horse)) return {eligible:false,reason:'cup-unconfirmed'};
  const y=plannerBreedingShowBase(horse);
  if (y==null || !Number.isFinite(y) || y<0) return {eligible:false,reason:'invalid-base'};
  return {eligible:true,y,x};
}

function zsSolveLinear(A,b) {
  const n=A.length;
  const M=A.map((row,i)=>[...row,b[i]]);
  for (let col=0;col<n;col++) {
    let pivot=col;
    for (let r=col+1;r<n;r++) if (Math.abs(M[r][col])>Math.abs(M[pivot][col])) pivot=r;
    if (Math.abs(M[pivot][col])<1e-10) return null;
    [M[col],M[pivot]]=[M[pivot],M[col]];
    const div=M[col][col];
    for (let c=col;c<=n;c++) M[col][c]/=div;
    for (let r=0;r<n;r++) {
      if (r===col) continue;
      const factor=M[r][col];
      for (let c=col;c<=n;c++) M[r][c]-=factor*M[col][c];
    }
  }
  return M.map(row=>row[n]);
}

function zsFitRidge(rows, featureKeys, lambda) {
  if (!rows.length || !featureKeys.length) return null;
  const means=featureKeys.map(key=>rows.reduce((sum,r)=>sum+r.x[key],0)/rows.length);
  const stds=featureKeys.map((key,j)=>{
    const variance=rows.reduce((sum,r)=>sum+(r.x[key]-means[j])**2,0)/rows.length;
    return Math.sqrt(variance)||1;
  });
  const X=rows.map(r=>[1,...featureKeys.map((key,j)=>(r.x[key]-means[j])/stds[j])]);
  const y=rows.map(r=>r.y);
  const m=featureKeys.length+1;
  const xtx=Array.from({length:m},()=>Array(m).fill(0));
  const xty=Array(m).fill(0);
  for (let r=0;r<X.length;r++) for (let i=0;i<m;i++) {
    xty[i]+=X[r][i]*y[r];
    for (let j=0;j<m;j++) xtx[i][j]+=X[r][i]*X[r][j];
  }
  for (let i=1;i<m;i++) xtx[i][i]+=lambda;
  const beta=zsSolveLinear(xtx,xty);
  if (!beta) return null;
  const rawCoefficients=featureKeys.map((key,j)=>beta[j+1]/stds[j]);
  const rawIntercept=beta[0]-rawCoefficients.reduce((sum,c,j)=>sum+c*means[j],0);
  return {
    lambda, featureKeys, means, stds, beta, rawIntercept, rawCoefficients,
    predictX(x) {
      if (!x) return null;
      if (featureKeys.some(key=>!Number.isFinite(Number(x[key])))) return null;
      return beta[0]+featureKeys.reduce((sum,key,j)=>sum+beta[j+1]*((x[key]-means[j])/stds[j]),0);
    }
  };
}

function zsMetrics(actual,predicted) {
  if (!actual.length || actual.length!==predicted.length) return null;
  const errors=actual.map((y,i)=>predicted[i]-y);
  const mae=errors.reduce((s,e)=>s+Math.abs(e),0)/errors.length;
  const rmse=Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length);
  const mean=actual.reduce((s,v)=>s+v,0)/actual.length;
  const sst=actual.reduce((s,v)=>s+(v-mean)**2,0);
  const sse=errors.reduce((s,e)=>s+e*e,0);
  const r2=sst>0 ? 1-sse/sst : null;
  return {mae,rmse,r2,n:actual.length};
}

function zsCrossValidate(rows, featureKeys, lambda) {
  if (rows.length<8) return null;
  const folds=Math.min(5, Math.max(2, Math.floor(rows.length/4)));
  const actual=[], predicted=[];
  // Sortierte, deterministische Fold-Zuordnung: bei jedem Reload identisch.
  const ordered=[...rows].sort((a,b)=>String(a.horse.id||a.horse.name||'').localeCompare(String(b.horse.id||b.horse.name||''),'de'));
  for (let fold=0;fold<folds;fold++) {
    const train=ordered.filter((_,i)=>i%folds!==fold);
    const test=ordered.filter((_,i)=>i%folds===fold);
    const fit=zsFitRidge(train,featureKeys,lambda);
    if (!fit) return null;
    for (const row of test) {
      const pred=fit.predictX(row.x);
      if (pred==null || !Number.isFinite(pred)) continue;
      actual.push(row.y); predicted.push(pred);
    }
  }
  return zsMetrics(actual,predicted);
}

function zsTrainingRowsAndExclusions() {
  const rows=[];
  const exclusions={noZs:0,missingFeatures:0,missingTournament:0,cupUnconfirmed:0,invalidBase:0};
  for (const horse of TP_ALL_HORSES) {
    const st=zsTrainingStatus(horse);
    if (st.eligible) rows.push({horse,y:st.y,x:st.x});
    else if (st.reason==='no-zs') exclusions.noZs++;
    else if (st.reason==='missing-features') exclusions.missingFeatures++;
    else if (st.reason==='missing-tournament') exclusions.missingTournament++;
    else if (st.reason==='cup-unconfirmed') exclusions.cupUnconfirmed++;
    else if (st.reason==='invalid-base') exclusions.invalidBase++;
  }
  return {rows,exclusions};
}

function zsActiveFeatureKeys(rows) {
  const keys=['gp','ext','extpct','int'];
  // Erbkrankheit nur lernen, wenn beide Gruppen ausreichend vertreten sind.
  // Sonst würde ein einzelnes betroffenes Pferd einen scheinbar präzisen,
  // aber statistisch wertlosen Krankheitskoeffizienten erzeugen.
  const risky=rows.filter(r=>r.x.disease===1).length;
  const clear=rows.length-risky;
  if (risky>=3 && clear>=3) keys.push('disease');
  return {keys,risky,clear};
}

function buildBreedingShowModel() {
  const {rows:training,exclusions}=zsTrainingRowsAndExclusions();
  const featureInfo=zsActiveFeatureKeys(training);
  const base={n:training.length,training,exclusions,featureInfo,predict:()=>null,coefficients:null,diagnostics:null};
  if (training.length<8) return base;

  // V53.1/V53.2 nutzten eine feste Ridge-Stärke 0.15. Mit wachsender
  // Datenbasis kann diese willkürlich zu schwach/stark sein. V53.3 wählt
  // die Stabilisierung per 5-facher Kreuzvalidierung auf den echten ZS-Daten.
  const lambdas=[0.03,0.1,0.3,1,3,10,30,100];
  let best=null;
  for (const lambda of lambdas) {
    const metrics=zsCrossValidate(training,featureInfo.keys,lambda);
    if (!metrics) continue;
    const candidate={lambda,metrics};
    if (!best || metrics.rmse<best.metrics.rmse-1e-9 || (Math.abs(metrics.rmse-best.metrics.rmse)<1e-9 && lambda>best.lambda)) best=candidate;
  }
  const chosen=best?.lambda ?? 0.3;
  const fit=zsFitRidge(training,featureInfo.keys,chosen);
  if (!fit) return base;
  const trainActual=training.map(r=>r.y);
  const trainPred=training.map(r=>fit.predictX(r.x));
  const trainMetrics=zsMetrics(trainActual,trainPred);

  return {
    ...base,
    lambda:chosen,
    fit,
    coefficients:fit.rawCoefficients,
    intercept:fit.rawIntercept,
    diagnostics:{cv:best?.metrics || null,train:trainMetrics},
    predict(horse) {
      const x=zsFeatureObject(horse); if(!x) return null;
      return fit.predictX(x);
    }
  };
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
    parts.push(`${c>=0?'+':'−'} ${Math.abs(c).toFixed(2)} × ${label}`);
  });
  return parts.join(' ');
}

function renderBreedingShowOverview() {
  const body=document.getElementById('tp-zs-body');
  if (!body) return;
  const model=buildBreedingShowModel();
  const info=document.getElementById('tp-zs-model-info');
  const formula=document.getElementById('tp-zs-model-formula');
  if (info) {
    const ex=model.exclusions || {};
    const waiting=[];
    if (ex.cupUnconfirmed) waiting.push(`${ex.cupUnconfirmed} mit noch unbestätigtem wahrscheinlichem Cupstern`);
    if (ex.missingTournament) waiting.push(`${ex.missingTournament} mit fehlenden Turnierplatzierungen`);
    if (ex.missingFeatures) waiting.push(`${ex.missingFeatures} mit unvollständigen GP/Ext/Ext%/Int-Daten`);
    if (model.n<8) {
      info.innerHTML=`Lernmodell: <strong>n=${model.n}</strong> verwertbare echte Zuchtschau-Grundwerte. Ab n=8 startet eine vorsichtige Prognose.${waiting.length?` Noch nicht im Lernmodell: ${waiting.join(' · ')}.`:''}`;
    } else {
      const cv=model.diagnostics?.cv;
      const diseaseNote=model.featureInfo?.keys?.includes('disease')
        ? `Erbkrankheit wird mitgelernt (${model.featureInfo.risky} betroffen / ${model.featureInfo.clear} unauffällig).`
        : `Erbkrankheit wird noch nicht als Koeffizient gelernt (${model.featureInfo?.risky||0} betroffen / ${model.featureInfo?.clear||0} unauffällig; mindestens 3 je Gruppe nötig).`;
      const quality=cv ? ` · Kreuzvalidierung: MAE <strong>${cv.mae.toFixed(0)} Punkte</strong>, RMSE ${cv.rmse.toFixed(0)}${cv.r2==null?'':`, R² ${cv.r2.toFixed(2)}`}` : '';
      info.innerHTML=`Lernmodell: <strong>n=${model.n}</strong> · <strong>${zsModelDataBand(model.n)}</strong>${quality} · Ridge-Stabilisierung λ=${model.lambda}.<br><span class="tiny">${diseaseNote}${waiting.length?` Nicht zum Lernen verwendet: ${waiting.join(' · ')}.`:''}</span>`;
    }
  }
  if (formula) {
    formula.innerHTML=model.fit
      ? `<strong>Aktuell gelernte Formel:</strong> ${plannerEscape(zsFormulaText(model))}<br><span class="muted">Die Formel wird bei jeder Änderung echter ZS-Daten neu aus allen verwertbaren Pferden berechnet. Die Kreuzvalidierung prüft sie auf jeweils zurückgehaltenen Pferden und ist daher aussagekräftiger als die reine Anpassung an die Lerndaten.</span>`
      : 'Noch keine Formel – mindestens 8 verwertbare ZS-Datensätze nötig.';
  }

  const nameQ=(document.getElementById('tp-zs-name')?.value || '').trim().toLowerCase();
  const owner=document.getElementById('tp-zs-owner')?.value || '';
  const breed=document.getElementById('tp-zs-breed')?.value || '';
  const only=document.getElementById('tp-zs-only')?.value || '';
  const breeding=document.getElementById('tp-zs-breeding')?.value || '';
  let rows=TP_ALL_HORSES.filter(h=>{
    if (typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(h)) return false;
    if (nameQ && !(h.name||'').toLowerCase().includes(nameQ)) return false;
    if (owner && h.owner!==owner) return false;
    if (breed && (normalizeBreed(h.breed)||'Rasselos')!==breed) return false;
    const total=plannerBreedingShowPoints(h);
    if (only==='with' && total==null) return false;
    if (only==='forecast' && total!=null) return false;
    if (breeding==='yes' && h.breeding_allowed!==true) return false;
    if (breeding==='no' && h.breeding_allowed!==false) return false;
    if (breeding==='unknown' && h.breeding_allowed!=null) return false;
    return true;
  });
  rows.sort((a,b)=>(plannerBreedingShowPoints(b)??-1)-(plannerBreedingShowPoints(a)??-1) || (a.name||'').localeCompare(b.name||'','de'));
  document.getElementById('tp-zs-count').textContent=`${rows.length} Pferde`;
  if (!rows.length) {
    body.innerHTML='<tr><td colspan="7" class="muted">Noch keine passenden Pferde. ZS-Gesamtpunkte werden auf der Pferdeseite im Reiter Turnierwerte manuell eingetragen.</td></tr>';
    return;
  }
  body.innerHTML=rows.map(h=>{
    const total=plannerBreedingShowPoints(h);
    const turnier=plannerTournamentShowBonus(h);
    const cup=plannerCupShowBonus(h);
    const base=plannerBreedingShowBase(h);
    const pred=model.predict(h);
    const diff=base==null || pred==null ? null : base-pred;
    const st=zsTrainingStatus(h);
    let dataNote='';
    if (total!=null && !st.eligible) {
      const map={
        'missing-tournament':'Turnierdaten fehlen – nicht im Lernmodell',
        'cup-unconfirmed':'Cupstern wahrscheinlich – erst bestätigen',
        'missing-features':'Grundwerte unvollständig – nicht im Lernmodell',
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

