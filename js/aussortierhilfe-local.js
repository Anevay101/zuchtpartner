
let AH_HORSES = [];
let AH_LAST_EVALUATED = [];
let AH_VERDICT_FILTER = 'all';

document.addEventListener('DOMContentLoaded', initAussort);

async function initAussort() {
  await requireSession();
  await renderSharedNav();
  AH_HORSES = (await localGetAll(LOCAL_STORES.horses)).filter(h => isActiveBreeder(h.owner) && !(typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(h)));

  wireCheckDropdowns();
  populateCheckDropdown('ah-owner-drop', [...new Set(AH_HORSES.map(h => h.owner).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de')));
  fillFilter('ah-breed', [...new Set(AH_HORSES.map(h => normalizeBreed(h.breed) || 'Rasselos').filter(Boolean))]);
  fillFilter('ah-gender', [...new Set(AH_HORSES.map(h => h.gender).filter(Boolean))]);

  document.getElementById('ah-run').addEventListener('click', runAussort);
  document.querySelector('#ah-owner-drop .checkdrop-panel').addEventListener('change', () => {
    if (!document.getElementById('ah-summary').hidden) runAussort();
  });
  document.getElementById('ah-mode').addEventListener('change', () => {
    renderAussortModeInfo();
    runAussort();
  });
  renderAussortModeInfo();

  document.getElementById('ah-target-reset').addEventListener('click', () => {
    ['ah-target-gp','ah-target-ext','ah-target-extpct','ah-target-int'].forEach(id => {
      document.getElementById(id).value = '';
    });
    runAussort();
  });
}

function fillFilter(id, vals) {
  vals.sort((a,b) => a.localeCompare(b,'de'));
  document.getElementById(id).innerHTML =
    '<option value="">Alle</option>' + vals.map((v) => `<option value="${plannerEscape(v)}">${plannerEscape(v)}</option>`).join('');
}

function percentileRanks(rows, getter, higherBetter = true) {
  const known = rows
    .map((h) => ({ h, v: getter(h) }))
    .filter((x) => x.v != null && !Number.isNaN(x.v))
    .sort((a,b) => higherBetter ? a.v - b.v : b.v - a.v);
  const map = new Map();
  if (known.length === 1) {
    map.set(String(known[0].h.id), 0.5);
  } else {
    known.forEach((x, i) => map.set(String(x.h.id), i / Math.max(1, known.length - 1)));
  }
  return map;
}


function readOptionalNumber(id) {
  const raw = document.getElementById(id).value.trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function targetMetricScore(value, target, higherBetter) {
  // Fehlende Pferdedaten bleiben Unsicherheit und werden nicht als 0 gewertet.
  if (value == null || Number.isNaN(value)) return null;
  if (target == null) return null;

  if (higherBetter) {
    if (target <= 0) return 1;
    return Math.max(0, Math.min(1, value / target));
  }

  // Ext/Int: kleinere Werte sind besser.
  if (value <= target) return 1;
  if (value <= 0) return 1;
  return Math.max(0, Math.min(1, target / value));
}

function metricAssessment(name, value, target, higherBetter) {
  if (target == null) return null;
  if (value == null || Number.isNaN(value)) return `${name}: Ziel gesetzt, Wert fehlt`;

  const ok = higherBetter ? value >= target : value <= target;
  const sign = higherBetter ? '≥' : '≤';
  return `${name} ${ok ? '✓' : '⚠️'} ${plannerMetricFormat(value, name === 'Ext%' ? 'extpct' : name.toLowerCase())} (Ziel ${sign} ${target})`;
}


function renderAussortModeInfo() {
  const mode = document.getElementById('ah-mode').value;
  const root = document.getElementById('ah-mode-info');
  if (!root) return;

  const texts = {
    genetics: `
      <strong>Genetik:</strong>
      Bewertet <strong>GP</strong> und <strong>Ext%</strong> gleichgewichtet.
      Ohne eigene Zielwerte zählt die Rangposition innerhalb des gefilterten Bestands.
      Ausgeprägte Erbkrankheiten werden als Warnhinweis angezeigt, verändern den Score aber nicht automatisch.
    `,
    exterior: `
      <strong>Exterieur:</strong>
      Bewertet den durchschnittlichen sichtbaren Körperbauwert <strong>Ext</strong>.
      Niedrigere Werte sind besser. Ext% bleibt sichtbar, gehört aber im Schwerpunkt Genetik zum Score.
    `,
    interior: `
      <strong>Interieur:</strong>
      Bewertet den durchschnittlichen <strong>Int</strong>-Wert. Niedrigere Werte sind besser.
    `,
    tournament: `
      <strong>Turnier:</strong>
      Vergleicht die beste Turnierdisziplin jedes Pferdes innerhalb des aktuell gefilterten Bestands.
      Turnierpunkte zählen 65%, passendes Interieur 20% und LK 15%.
    `,
  };

  root.innerHTML = texts[mode] || '';
}
function tournamentPointsFromEvaluation(ev) {
  if (!ev?.completePotential || !Array.isArray(ev.performance) || ev.performance.length !== 7) return null;
  const vals = ev.performance.map(r => Number(r.potential));
  if (vals.some(v => !Number.isFinite(v))) return null;
  return 3 * vals[0] + vals.slice(1).reduce((a,b) => a+b, 0);
}

function bestTournamentForAussort(horse) {
  const rows = plannerAllTournamentEvaluations(horse)
    .map(ev => ({ ...ev, points: tournamentPointsFromEvaluation(ev) }))
    .filter(ev => ev.points != null)
    .sort((a,b) => {
      const p = b.points - a.points;
      if (p) return p;
      const ai = a.interiorAvg ?? 99;
      const bi = b.interiorAvg ?? 99;
      if (ai !== bi) return ai - bi;
      return plannerLKRank(a.lk) - plannerLKRank(b.lk);
    });
  return rows[0] || null;
}

function rankMapFromEvaluated(items, getter, higherBetter = true) {
  const known = items
    .map(item => ({ item, v: getter(item) }))
    .filter(x => x.v != null && Number.isFinite(x.v))
    .sort((a,b) => higherBetter ? a.v - b.v : b.v - a.v);

  const map = new Map();
  if (known.length === 1) {
    map.set(String(known[0].item.h.id), 0.5);
  } else {
    known.forEach((x,i) => map.set(String(x.item.h.id), i / Math.max(1, known.length - 1)));
  }
  return map;
}

function ahComponent(value, fallback = null) {
  return value == null || Number.isNaN(value) ? fallback : value;
}

function ahMean(values) {
  const nums = values.filter(v => v != null && Number.isFinite(v));
  return nums.length ? nums.reduce((a,b)=>a+b,0) / nums.length : 0.5;
}

function ahScoreForMode(mode, x, ranks, targets) {
  if (mode === 'genetics') {
    return ahMean([
      targets.gp != null
        ? targetMetricScore(x.stats.gp, targets.gp, true)
        : ranks.gp.get(String(x.h.id)),
      targets.extpct != null
        ? targetMetricScore(x.stats.extpct, targets.extpct, true)
        : ranks.extpct.get(String(x.h.id)),
    ]);
  }

  if (mode === 'exterior') {
    return ahMean([
      targets.ext != null
        ? targetMetricScore(x.stats.ext, targets.ext, false)
        : ranks.ext.get(String(x.h.id)),
    ]);
  }

  if (mode === 'interior') {
    return ahMean([
      targets.int != null
        ? targetMetricScore(x.stats.int, targets.int, false)
        : ranks.int.get(String(x.h.id)),
    ]);
  }

  return x.tournament;
}

function ahVerdictKey(label) {
  if (label === 'behalten') return 'keep';
  if (label === 'prüfen') return 'check';
  return 'sort';
}

function setAhVerdictFilter(value) {
  AH_VERDICT_FILTER = value || 'all';
  renderAussortResults();
}

function renderAussortResults() {
  const root = document.getElementById('ah-results');
  if (!root) return;

  const visible = AH_VERDICT_FILTER === 'all'
    ? AH_LAST_EVALUATED
    : AH_LAST_EVALUATED.filter(x => ahVerdictKey(x.label) === AH_VERDICT_FILTER);

  const scrollBox = document.getElementById('ah-results-scroll');
  if (scrollBox) scrollBox.classList.toggle('ah-scroll-5', visible.length > 5);

  if (!visible.length) {
    root.innerHTML = '<section class="card"><p class="muted">Für diesen Ergebnisfilter gibt es keine Pferde.</p></section>';
    return;
  }

  root.innerHTML = visible.map((x, idx) => `
    <article class="card planner-candidate ah-result-card">
      <div class="planner-rank">${idx + 1}</div>
      <div class="planner-candidate-main">
        <h3>${plannerEscape(x.h.name || '(ohne Name)')} <span class="planner-badge">${plannerEscape(x.label)}</span></h3>
        <div class="ah-horse-meta">${plannerEscape(normalizeBreed(x.h.breed) || 'Rasselos')} · ${plannerEscape(x.h.gender || '')} · ${plannerEscape(x.h.owner || '')}</div>

        <div class="planner-metrics ah-white-metrics">
          <span>GP <strong>${plannerMetricFormat(x.stats.gp,'gp')}</strong></span>
          <span>Ext <strong>${plannerMetricFormat(x.stats.ext,'ext')}</strong></span>
          <span>Ext% <strong>${plannerMetricFormat(x.stats.extpct,'extpct')}</strong></span>
          <span>Int <strong>${plannerMetricFormat(x.stats.int,'int')}</strong></span>
          <span>Score <strong>${Math.round(x.score * 100)}</strong></span>
          ${x.mode === 'tournament' ? `<span>Turniervergleich <strong>${Math.round(x.tournament * 100)}</strong></span>` : ''}
        </div>

        <div class="ah-result-reasons">
          ${x.recommendationReason ? `<div class="ah-primary-reason"><strong>Empfehlung aufgrund:</strong> ${plannerEscape(x.recommendationReason)}</div>` : ''}
          ${x.reasons.length ? x.reasons.map(r => `<div>${plannerEscape(r)}</div>`).join('') : '<div class="muted">Keine zusätzlichen Hinweise.</div>'}
        </div>
      </div>
      <div class="planner-candidate-actions">
        <a class="btn secondary" href="view.html?id=${encodeURIComponent(x.h.id)}">Ansehen</a>
        <a class="btn secondary" href="horse.html?id=${encodeURIComponent(x.h.id)}">Bearbeiten</a>
      </div>
    </article>
  `).join('');
}

function renderAussortSummary(mode, hasManualTargets) {
  const summary = document.getElementById('ah-summary');
  summary.hidden = false;

  const counts = {
    keep: AH_LAST_EVALUATED.filter(x => x.label === 'behalten').length,
    check: AH_LAST_EVALUATED.filter(x => x.label === 'prüfen').length,
    sort: AH_LAST_EVALUATED.filter(x => x.label === 'aussortieren empfohlen').length,
  };

  const modeLabel = {
    genetics:'Genetik',
    exterior:'Exterieur',
    interior:'Interieur',
    tournament:'Turnier',
  }[mode] || mode;

  summary.innerHTML = `
    <div class="ah-summary-head">
      <div>
        <h2>Analyse · ${modeLabel}</h2>
        <p class="small muted">${AH_LAST_EVALUATED.length} Pferde im aktuell gefilterten Vergleichsbestand.</p>
      </div>
      <div class="ah-verdict-filters" role="group" aria-label="Ergebnis filtern">
        <button type="button" class="secondary ${AH_VERDICT_FILTER === 'all' ? 'active' : ''}" data-ah-verdict="all">Alle ${AH_LAST_EVALUATED.length}</button>
        <button type="button" class="secondary ${AH_VERDICT_FILTER === 'keep' ? 'active' : ''}" data-ah-verdict="keep">✓ Behalten ${counts.keep}</button>
        <button type="button" class="secondary ${AH_VERDICT_FILTER === 'check' ? 'active' : ''}" data-ah-verdict="check">? Prüfen ${counts.check}</button>
        <button type="button" class="secondary ${AH_VERDICT_FILTER === 'sort' ? 'active' : ''}" data-ah-verdict="sort">↓ Aussortieren ${counts.sort}</button>
      </div>
    </div>
    <p class="muted small">
      ${hasManualTargets
        ? 'Passende eigene Zielwerte sind aktiv und ersetzen in diesem Schwerpunkt den relativen Vergleich.'
        : 'Ohne passende eigene Zielwerte zählt die Rangposition innerhalb des aktuell gefilterten Bestands.'}
      Zuchtzulassung und Alter verändern den Score nicht.
    </p>
  `;

  summary.querySelectorAll('[data-ah-verdict]').forEach(btn => {
    btn.addEventListener('click', () => {
      AH_VERDICT_FILTER = btn.dataset.ahVerdict;
      renderAussortSummary(mode,hasManualTargets);
      renderAussortResults();
    });
  });
}

function runAussort() {
  const owners = getCheckDropdownSelected('ah-owner-drop');
  const breed = document.getElementById('ah-breed').value;
  const gender = document.getElementById('ah-gender').value;
  const mode = document.getElementById('ah-mode').value;

  const targets = {
    gp: readOptionalNumber('ah-target-gp'),
    ext: readOptionalNumber('ah-target-ext'),
    extpct: readOptionalNumber('ah-target-extpct'),
    int: readOptionalNumber('ah-target-int'),
  };

  const relevantTargets = mode === 'genetics'
    ? [targets.gp,targets.extpct]
    : mode === 'exterior'
      ? [targets.ext]
      : mode === 'interior'
        ? [targets.int]
        : [];
  const hasManualTargets = relevantTargets.some(v => v != null);

  const rows = AH_HORSES.filter((h) => {
    if (owners.length && !owners.includes(h.owner)) return false;
    if (breed && (normalizeBreed(h.breed) || 'Rasselos') !== breed) return false;
    if (gender && h.gender !== gender) return false;
    return true;
  });

  const ranks = {
    gp: percentileRanks(rows, h => plannerStats(h).gp, true),
    ext: percentileRanks(rows, h => plannerStats(h).ext, false),
    extpct: percentileRanks(rows, h => plannerStats(h).extpct, true),
    int: percentileRanks(rows, h => plannerStats(h).int, false),
  };

  let evaluated = rows.map((h) => {
    const stats = plannerStats(h);
    const bestTournament = bestTournamentForAussort(h);
    const reasons = [];
    const missing = plannerMissingCoreData(h);

    if (missing.length) reasons.push(`Datenlücken: ${missing.join(', ')}`);
    if (plannerHasActiveDiseaseRisk(h)) reasons.push('Hinweis: ausgeprägte Erbkrankheit – nicht automatisch im Score abgezogen');

    if (mode === 'genetics') {
      if (targets.gp != null) {
        const r = metricAssessment('GP',stats.gp,targets.gp,true); if (r) reasons.push(r);
      }
      if (targets.extpct != null) {
        const r = metricAssessment('Ext%',stats.extpct,targets.extpct,true); if (r) reasons.push(r);
      }
    } else if (mode === 'exterior' && targets.ext != null) {
      const r = metricAssessment('Ext',stats.ext,targets.ext,false); if (r) reasons.push(r);
    } else if (mode === 'interior' && targets.int != null) {
      const r = metricAssessment('Int',stats.int,targets.int,false); if (r) reasons.push(r);
    }

    return {
      h,stats,bestTournament,reasons,missing,
      tournament:0.5,
      score:0.5,
      label:'prüfen',
      mode,
    };
  });

  // Turniervergleich relativ innerhalb genau derselben gefilterten Gruppe.
  const tournamentPointRank = rankMapFromEvaluated(evaluated,x=>x.bestTournament?.points,true);
  const tournamentInteriorRank = rankMapFromEvaluated(evaluated,x=>x.bestTournament?.interiorAvg,false);
  const tournamentLkRank = rankMapFromEvaluated(evaluated,x=>x.bestTournament?.lk ? plannerLKRank(x.bestTournament.lk) : null,false);

  evaluated.forEach(x => {
    const parts = [
      {value:tournamentPointRank.get(String(x.h.id)),weight:.65},
      {value:tournamentInteriorRank.get(String(x.h.id)),weight:.20},
      {value:tournamentLkRank.get(String(x.h.id)),weight:.15},
    ].filter(p=>p.value != null);
    const sum=parts.reduce((s,p)=>s+p.weight,0);
    x.tournament=sum ? parts.reduce((s,p)=>s+p.value*p.weight,0)/sum : .5;

    x.score=ahScoreForMode(mode,x,ranks,targets);
    x.label=x.score >= .67 ? 'behalten' : x.score >= .40 ? 'prüfen' : 'aussortieren empfohlen';

    const scorePct = Math.round(x.score * 100);
    if (x.label === 'aussortieren empfohlen') {
      if (mode === 'genetics') x.recommendationReason = `Genetik im unteren Bereich des Vergleichsbestands (${scorePct}/100)`;
      else if (mode === 'exterior') x.recommendationReason = `Exterieur im unteren Bereich des Vergleichsbestands (${scorePct}/100)`;
      else if (mode === 'interior') x.recommendationReason = `Interieur im unteren Bereich des Vergleichsbestands (${scorePct}/100)`;
      else x.recommendationReason = `Turnierprofil im unteren Bereich des Vergleichsbestands (${scorePct}/100)`;
    } else if (x.label === 'prüfen') {
      x.recommendationReason = `${({genetics:'Genetik',exterior:'Exterieur',interior:'Interieur',tournament:'Turnierprofil'})[mode]} liegt im mittleren Vergleichsbereich (${scorePct}/100)`;
    } else {
      x.recommendationReason = `${({genetics:'Genetik',exterior:'Exterieur',interior:'Interieur',tournament:'Turnierprofil'})[mode]} liegt im oberen Vergleichsbereich (${scorePct}/100)`;
    }

    if (mode === 'tournament' && x.bestTournament) {
      x.reasons.push(
        `beste Turnieroption ${x.bestTournament.name}: ${Math.round(x.bestTournament.points)} Punkte · ` +
        `${x.bestTournament.interiorAvg == null ? 'Interieur –' : 'Interieur ' + x.bestTournament.interiorAvg.toFixed(2)} · ` +
        `${x.bestTournament.lk || 'LK –'}`
      );
    }
  });

  evaluated.sort((a,b)=>b.score-a.score);
  AH_LAST_EVALUATED=evaluated;

  // Nach einer neuen Analyse wieder alle zeigen; danach kann über die
  // Ergebnis-Chips gezielt Behalten/Prüfen/Aussortieren gewählt werden.
  AH_VERDICT_FILTER='all';
  renderAussortSummary(mode,hasManualTargets);
  renderAussortResults();
}

