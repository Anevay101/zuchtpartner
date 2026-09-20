// MDR V54.0.83 – LP-Prototypmodell v1.1
// Regelbasiertes Modell aus dem User-LP-Rechner. Rueckwaertsvalidierung an
// bestaetigten LP-Ergebnissen: Praemienhengst/-stute = bestanden, ausdruecklich
// "nicht bestanden" = durchgefallen. "Nein"/leer bedeutet KEIN bestaetigtes
// Ergebnis und wird niemals als negativer Fall gewertet. Keine Punkteprognose.
(() => {
  'use strict';

  const MODEL_VERSION = 'LP-Prototyp v1.1';
  const CORE_GAITS = ['Schritt', 'Trab', 'Galopp', 'Renngalopp'];
  const EXPECTED_INTERIOR = 10;
  const EXPECTED_EXTERIOR = 14;
  const EXPECTED_BASICS = 8;
  const EXPECTED_GAITS = 4;
  const EXPECTED_DISCIPLINES = 4;

  const GROUP_LABELS = {
    disease: { de:'Erbkrankheiten', en:'Hereditary diseases' },
    interior: { de:'Interieur', en:'Temperament' },
    exterior: { de:'Exterieur', en:'Conformation' },
    values: { de:'Werte', en:'Values' },
  };

  const RULE_META = {
    disease_clear: { group:'disease', de:'keine ausgeprägte Erbkrankheit', en:'no expressed hereditary disease' },
    int_no_miserable: { group:'interior', de:'kein miserabler Wert', en:'no miserable value' },
    int_max2_bad: { group:'interior', de:'max. 2 schlechte Werte', en:'max. 2 bad values' },
    int_min5_good: { group:'interior', de:'mind. 5× gut/exzellent', en:'at least 5× good/excellent' },
    ext_max2_verybad: { group:'exterior', de:'max. 2 sehr schlechte Werte', en:'max. 2 very poor values' },
    ext_min5_yellowgreen: { group:'exterior', de:'mind. 5× gelb/grün', en:'at least 5× yellow/green' },
    ext_min1_green: { group:'exterior', de:'mind. 1× grün', en:'at least 1× green' },
    disc_all20: { group:'values', de:'alle 4 Disziplinen ≥20 %', en:'all 4 disciplines ≥20%' },
    disc_one25: { group:'values', de:'mind. 1 Disziplin ≥25 %', en:'at least 1 discipline ≥25%' },
    props_all15: { group:'values', de:'alle 12 Eigenschaften ≥15 %', en:'all 12 traits ≥15%' },
    props_six20: { group:'values', de:'mind. 6 Eigenschaften ≥20 %', en:'at least 6 traits ≥20%' },
    basics_four20: { group:'values', de:'davon mind. 4 Grundlagen ≥20 %', en:'including at least 4 fundamentals ≥20%' },
    gaits_one20: { group:'values', de:'davon mind. 1 Gangart ≥20 %', en:'including at least 1 gait ≥20%' },
  };

  function lang() { return window.MDR_I18N?.language === 'en' ? 'en' : 'de'; }
  function t(de, en) { return lang() === 'en' ? en : de; }
  function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }
  function n(value) {
    if (value == null || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  function norm(value) {
    if (typeof plannerNorm === 'function') return plannerNorm(value);
    return String(value || '').trim().toLocaleLowerCase('de');
  }

  function actualResult(horse) {
    const text = String(horse?.hlp_slp ?? '').trim();
    let points = n(horse?.performance_test_points);
    if (points == null && text) {
      const match = text.match(/(\d+)\s*(?:punkte|points?)/i);
      if (match) points = Number(match[1]);
    }

    // MDR unterscheidet drei Zustaende:
    //   Praemienhengst/-stute bzw. bestanden + Punkte = bestaetigt bestanden
    //   "nicht bestanden" / failed                     = bestaetigt durchgefallen
    //   "Nein" / No / leer                             = kein bestaetigtes Ergebnis
    // Besonders wichtig: das alte strukturierte false-Feld kann aus frueheren
    // Imports von "Nein" stammen und darf deshalb ohne expliziten Fehlertext
    // NICHT als echter Negativfall verwendet werden.
    const noResult = !!text && /^(?:nein|no|false|0)$/i.test(text);
    const failed = !!text && /(?:failed|nicht bestanden|durchgefallen)/i.test(text);
    const positive = !!text && !failed && !noResult && (
      /^(?:ja|yes|true|1)$/i.test(text) ||
      /(?:prämienstute|praemienstute|prämienhengst|praemienhengst|premium mare|premium stallion|\bbestanden\b|\bpassed\b)/i.test(text) ||
      points != null
    );

    let passed = null;
    let status = noResult ? 'none' : 'unknown';
    if (failed) { passed = false; status = 'failed'; }
    else if (positive) { passed = true; status = 'passed'; }
    else if (!text && horse?.performance_test_passed === true) { passed = true; status = 'passed'; }
    // Ein nacktes performance_test_passed=false wird absichtlich ignoriert:
    // V54.0.82 konnte dieses false noch aus "HLP/SLP: Nein" erzeugen.

    return { known: passed !== null, passed, points, text, status, noResult };
  }

  function scoredUnique(rows, scoreFn) {
    const byLabel = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const key = norm(row?.label);
      const score = typeof scoreFn === 'function' ? scoreFn(row?.value) : null;
      if (!key || score == null || !Number.isFinite(Number(score))) continue;
      byLabel.set(key, Number(score));
    }
    return [...byLabel.values()];
  }

  function valueMap(horse) {
    if (typeof plannerHorseValues === 'function') return plannerHorseValues(horse);
    const out = new Map();
    for (const groups of [horse?.disciplines || {}, horse?.traits || {}]) {
      for (const entries of Object.values(groups)) {
        for (const row of entries || []) {
          out.set(norm(row?.name), {
            name: row?.name,
            current: n(row?.current),
            potential: n(row?.potential),
          });
        }
      }
    }
    return out;
  }

  function potentialValues(horse, names) {
    const map = valueMap(horse);
    return names.map(name => {
      const row = map.get(norm(name));
      return n(row?.potential);
    });
  }

  function primaryDisciplineNames(horse) {
    const group = typeof plannerHorseMainGroup === 'function' ? plannerHorseMainGroup(horse) : null;
    const names = group && typeof MDR_TOURNAMENT_GROUPS !== 'undefined' ? MDR_TOURNAMENT_GROUPS[group] : null;
    return Array.isArray(names) && names.length === EXPECTED_DISCIPLINES ? [...names] : [];
  }

  function diseaseStatus(horse) {
    if (typeof plannerHasActiveDiseaseRisk === 'function' && plannerHasActiveDiseaseRisk(horse)) return 'fail';
    if (horse?.disease_free === true) return 'pass';
    if (typeof plannerDiseaseCodes === 'function' && typeof plannerDiseaseState === 'function') {
      const states = plannerDiseaseCodes(horse).map(code => plannerDiseaseState(horse, code));
      if (states.some(state => state === 'affected')) return 'fail';
      if (states.length && states.every(state => state !== 'unknown')) return 'pass';
    }
    return 'unknown';
  }

  function noForbiddenRule(values, expected, isForbidden) {
    const known = values.filter(v => v != null);
    if (known.some(isForbidden)) return 'fail';
    return known.length >= expected ? 'pass' : 'unknown';
  }

  function maxCountRule(values, expected, predicate, max) {
    const known = values.filter(v => v != null);
    const count = known.filter(predicate).length;
    if (count > max) return 'fail';
    return known.length >= expected ? 'pass' : 'unknown';
  }

  function minCountRule(values, expected, predicate, min) {
    const known = values.filter(v => v != null);
    const count = known.filter(predicate).length;
    if (count >= min) return 'pass';
    const missing = Math.max(0, expected - known.length);
    if (count + missing < min || known.length >= expected) return 'fail';
    return 'unknown';
  }

  function makeCriterion(id, status, observed) {
    const meta = RULE_META[id];
    return { id, group:meta.group, label: meta[lang()], labelDe:meta.de, labelEn:meta.en, status, observed };
  }

  function evaluate(horse) {
    const interior = scoredUnique(horse?.temperament, typeof scoreTemperamentTerm === 'function' ? scoreTemperamentTerm : null);
    const exterior = scoredUnique(horse?.exterior_descriptive, typeof scoreExteriorTerm === 'function' ? scoreExteriorTerm : null);
    const disciplineNames = primaryDisciplineNames(horse);
    const disciplines = disciplineNames.length ? potentialValues(horse, disciplineNames) : [];
    const basicsNames = typeof MDR_TOURNAMENT_BASICS !== 'undefined' ? [...MDR_TOURNAMENT_BASICS] : [];
    const basics = basicsNames.length === EXPECTED_BASICS ? potentialValues(horse, basicsNames) : [];
    const gaits = potentialValues(horse, CORE_GAITS);
    const properties = [...basics, ...gaits];

    const criteria = [
      makeCriterion('disease_clear', diseaseStatus(horse), ''),
      makeCriterion('int_no_miserable', noForbiddenRule(interior, EXPECTED_INTERIOR, v => v >= 5), `${interior.length}/${EXPECTED_INTERIOR}`),
      makeCriterion('int_max2_bad', maxCountRule(interior, EXPECTED_INTERIOR, v => v === 4, 2), `${interior.filter(v=>v===4).length} / 2`),
      makeCriterion('int_min5_good', minCountRule(interior, EXPECTED_INTERIOR, v => v <= 2, 5), `${interior.filter(v=>v<=2).length} / 5`),
      makeCriterion('ext_max2_verybad', maxCountRule(exterior, EXPECTED_EXTERIOR, v => v >= 5, 2), `${exterior.filter(v=>v>=5).length} / 2`),
      makeCriterion('ext_min5_yellowgreen', minCountRule(exterior, EXPECTED_EXTERIOR, v => v <= 3, 5), `${exterior.filter(v=>v<=3).length} / 5`),
      makeCriterion('ext_min1_green', minCountRule(exterior, EXPECTED_EXTERIOR, v => v <= 2, 1), `${exterior.filter(v=>v<=2).length} / 1`),
      makeCriterion('disc_all20', noForbiddenRule(disciplines, EXPECTED_DISCIPLINES, v => v < 20), `${disciplines.filter(v=>v!=null).length}/${EXPECTED_DISCIPLINES}`),
      makeCriterion('disc_one25', minCountRule(disciplines, EXPECTED_DISCIPLINES, v => v >= 25, 1), `${disciplines.filter(v=>v!=null && v>=25).length} / 1`),
      makeCriterion('props_all15', noForbiddenRule(properties, EXPECTED_BASICS + EXPECTED_GAITS, v => v < 15), `${properties.filter(v=>v!=null).length}/${EXPECTED_BASICS + EXPECTED_GAITS}`),
      makeCriterion('props_six20', minCountRule(properties, EXPECTED_BASICS + EXPECTED_GAITS, v => v >= 20, 6), `${properties.filter(v=>v!=null && v>=20).length} / 6`),
      makeCriterion('basics_four20', minCountRule(basics, EXPECTED_BASICS, v => v >= 20, 4), `${basics.filter(v=>v!=null && v>=20).length} / 4`),
      makeCriterion('gaits_one20', minCountRule(gaits, EXPECTED_GAITS, v => v >= 20, 1), `${gaits.filter(v=>v!=null && v>=20).length} / 1`),
    ];

    const failed = criteria.filter(c => c.status === 'fail');
    const unknown = criteria.filter(c => c.status === 'unknown');
    const overall = failed.length ? 'fail' : unknown.length ? 'unknown' : 'pass';
    return { overall, criteria, failed, unknown, disciplineNames, coreGaits:[...CORE_GAITS] };
  }

  function horseKey(horse, index) {
    const ext = String(horse?.external_id || '').trim();
    const world = String(horse?.game_version || horse?.mdr_server || '').trim();
    if (ext) return `${world}:${ext}`;
    if (horse?.id != null) return `id:${horse.id}`;
    return `row:${index}:${String(horse?.name || '')}`;
  }

  function confirmedCases(horses) {
    const seen = new Set();
    const passers = [];
    const failures = [];
    (Array.isArray(horses) ? horses : []).forEach((horse,index) => {
      const actual = actualResult(horse);
      if (!actual.known) return;
      const key = horseKey(horse,index);
      if (seen.has(key)) return;
      seen.add(key);
      (actual.passed ? passers : failures).push(horse);
    });
    return { passers, failures };
  }

  function emptyRuleStat() {
    return {
      positive:{pass:0,fail:0,unknown:0},
      negative:{pass:0,fail:0,unknown:0},
    };
  }

  function validationBucket(horses, expectedPassed, ruleStats) {
    let modelPass = 0, modelFail = 0, incomplete = 0;
    const rows = [];
    for (const horse of horses) {
      const ev = evaluate(horse);
      if (ev.overall === 'pass') modelPass++;
      else if (ev.overall === 'fail') modelFail++;
      else incomplete++;
      const side = expectedPassed ? 'positive' : 'negative';
      for (const criterion of ev.criteria) ruleStats[criterion.id][side][criterion.status]++;
      rows.push({horse, evaluation:ev, actual:actualResult(horse)});
    }
    const assessable = modelPass + modelFail;
    const correct = expectedPassed ? modelPass : modelFail;
    return { total:horses.length, modelPass, modelFail, incomplete, assessable, correct, hitRate: assessable ? correct / assessable : null, rows };
  }

  function validate(horses) {
    const {passers, failures} = confirmedCases(horses);
    const ruleStats = Object.fromEntries(Object.keys(RULE_META).map(id => [id,emptyRuleStat()]));
    const positive = validationBucket(passers, true, ruleStats);
    const negative = validationBucket(failures, false, ruleStats);
    return {
      total: positive.total + negative.total,
      positive,
      negative,
      // Rueckwaertskompatible Aliase fuer classify()/aeltere Aufrufer:
      conform: positive.modelPass,
      counterexamples: positive.modelFail,
      incomplete: positive.incomplete,
      ruleStats,
      rows:[...positive.rows, ...negative.rows],
    };
  }

  function supportForRule(stat) {
    const pos = stat?.positive || stat;
    if (!pos) return 'low';
    if (pos.fail > 0) return 'counterexample';
    if (pos.pass >= 10) return 'strong';
    if (pos.pass >= 5) return 'supported';
    return 'low';
  }

  function classify(evaluation, validation) {
    if (evaluation.failed.length) {
      const weakOnly = evaluation.failed.every(c => supportForRule(validation?.ruleStats?.[c.id]) === 'counterexample');
      if (weakOnly) return { key:'yellow', icon:'🟡', label:t('Grenzfall','Borderline') };
      return { key:'red', icon:'🔴', label:t('Nach Modell nicht ausreichend','Not sufficient under current model') };
    }
    if (evaluation.unknown.length) return { key:'neutral', icon:'⚪', label:t('Noch nicht vollständig beurteilbar','Not fully assessable yet') };
    return { key:'green', icon:'🟢', label:t('Voraussetzungen erfüllt','Requirements met') };
  }

  function groupSummary(evaluation, group) {
    const rows = evaluation.criteria.filter(c => c.group === group);
    return {
      pass: rows.filter(c=>c.status==='pass').length,
      fail: rows.filter(c=>c.status==='fail').length,
      unknown: rows.filter(c=>c.status==='unknown').length,
      total: rows.length,
    };
  }

  function statusIcon(status) { return status === 'pass' ? '✓' : status === 'fail' ? '✕' : '?'; }
  function statusClass(status) { return status === 'pass' ? 'lp-rule-pass' : status === 'fail' ? 'lp-rule-fail' : 'lp-rule-unknown'; }

  function pctLabel(rate) {
    return rate == null ? '–' : `${Math.round(rate * 100)} %`;
  }

  function renderValidation(root, horses) {
    if (!root) return;
    const validation = validate(horses);
    const pos = validation.positive;
    const neg = validation.negative;

    if (!validation.total) {
      root.innerHTML = `<p class="muted small">${esc(t('Noch keine bestätigten LP-Ergebnisse im Datenbestand. „Nein“ bzw. ein fehlender LP-Eintrag wird ausdrücklich nicht als Durchfallen gewertet.','No confirmed performance-test results in the dataset yet. “No” or a missing test entry is explicitly not treated as a failed test.'))}</p>`;
      return validation;
    }

    const ruleRows = Object.keys(RULE_META).map(id => {
      const meta = RULE_META[id];
      const stat = validation.ruleStats[id];
      const p = stat.positive;
      const nstat = stat.negative;
      const evaluatedPos = p.pass + p.fail;
      const evaluatedNeg = nstat.pass + nstat.fail;
      const support = supportForRule(stat);
      const supportLabel = support === 'counterexample'
        ? t(`${p.fail} Gegenbeispiel${p.fail===1?'':'e'}`,`${p.fail} counterexample${p.fail===1?'':'s'}`)
        : support === 'strong' ? t('stark gestützt','strongly supported')
        : support === 'supported' ? t('gestützt','supported')
        : t('zu wenig Daten','too little data');
      return `<tr>
        <td><span class="lp-mini-group">${esc(GROUP_LABELS[meta.group][lang()])}</span></td>
        <td>${esc(meta[lang()])}</td>
        <td><strong>${p.pass}/${evaluatedPos || 0}</strong>${p.unknown ? `<span class="tiny muted"> · ${p.unknown} ?</span>` : ''}</td>
        <td><strong>${nstat.fail}/${evaluatedNeg || 0}</strong>${nstat.unknown ? `<span class="tiny muted"> · ${nstat.unknown} ?</span>` : ''}</td>
        <td><span class="lp-support lp-support-${support}">${esc(supportLabel)}</span></td>
      </tr>`;
    }).join('');

    const negativeNote = neg.total
      ? t('Bei bestätigten Nichtbestehern bedeutet „erkannt“, dass das Modell mindestens eine seiner Regeln verletzt sieht. Ein einzelner Nichtbesteher muss nicht jede Regel verletzen.','For confirmed failed tests, “detected” means the model sees at least one violated rule. A single failed horse does not have to violate every rule.')
      : t('Noch keine ausdrücklich als „nicht bestanden“ gespeicherten LP-Fälle vorhanden. Sobald solche Fälle erfasst sind, werden sie automatisch als echte Negativbeispiele ausgewertet.','No performance tests explicitly stored as “failed” yet. As soon as such cases are recorded, they are automatically evaluated as true negative examples.');

    root.innerHTML = `
      <div class="lp-validation-kpis">
        <div><span>${esc(t('bestätigte Besteher','confirmed passers'))}</span><strong>${pos.total}</strong></div>
        <div><span>${esc(t('Besteher korrekt erkannt','passers correctly predicted'))}</span><strong>${pos.assessable ? `${pos.correct}/${pos.assessable}` : '–'}</strong><small>${pctLabel(pos.hitRate)}</small></div>
        <div><span>${esc(t('bestätigte Nichtbesteher','confirmed failed tests'))}</span><strong>${neg.total}</strong></div>
        <div><span>${esc(t('Nichtbesteher erkannt','failed tests detected'))}</span><strong>${neg.assessable ? `${neg.correct}/${neg.assessable}` : '–'}</strong><small>${pctLabel(neg.hitRate)}</small></div>
      </div>
      <p class="tiny muted lp-model-note"><strong>${MODEL_VERSION}.</strong> ${esc(t('Rückwärtsprüfung nur an bestätigten LP-Ergebnissen. Prämienhengst/-stute bzw. „bestanden“ zählt positiv; nur ein ausdrückliches „nicht bestanden“ zählt negativ. „Nein“ und fehlende Einträge bleiben unbewertet.','Backward validation uses confirmed performance-test results only. Premium stallion/mare or “passed” counts as positive; only an explicit “failed” counts as negative. “No” and missing entries remain unlabelled.'))}</p>
      <div class="table-wrap lp-validation-table-wrap"><table class="detail-table lp-validation-table"><thead><tr>
        <th>${esc(t('Bereich','Area'))}</th><th>${esc(t('Regel','Rule'))}</th><th>${esc(t('Besteher erfüllen','passers meeting'))}</th><th>${esc(t('Nichtbesteher verletzt','failed tests violating'))}</th><th>${esc(t('Einordnung','Assessment'))}</th>
      </tr></thead><tbody>${ruleRows}</tbody></table></div>
      <p class="tiny muted lp-model-note">${esc(negativeNote)}</p>
      <p class="tiny muted lp-model-note">${esc(t('Werte-Regeln: 4 Disziplinen der Begabungsgruppe sowie 8 Grundlagen + Schritt, Trab, Galopp und Renngalopp; verwendet werden die Potenzialwerte.','Value rules: the 4 disciplines of the talent group plus 8 fundamentals + walk, trot, canter and gallop; potential values are used.'))}</p>`;
    return validation;
  }

  function renderPredictionSummary(classification) {
    return `<div class="lp-prediction-line">
      <span class="lp-prediction-label">${esc(t('LP-Prognose','Performance-test prediction'))}</span>
      <span class="lp-status-pill lp-status-${classification.key}">${classification.icon} ${esc(classification.label)}</span>
      <span class="tiny muted">${MODEL_VERSION}</span>
    </div>`;
  }

  function renderHorse(root, horse, horses) {
    if (!root) return;
    const actual = actualResult(horse);
    const evaluation = evaluate(horse);
    const validation = validate(horses);
    const classification = classify(evaluation, validation);

    const groups = ['disease','interior','exterior','values'].map(group => {
      const s = groupSummary(evaluation, group);
      const state = s.fail ? 'fail' : s.unknown ? 'unknown' : 'pass';
      return `<div class="lp-group-chip ${statusClass(state)}"><span>${esc(GROUP_LABELS[group][lang()])}</span><strong>${statusIcon(state)} ${s.pass}/${s.total}</strong></div>`;
    }).join('');
    const problems = evaluation.criteria.filter(c => c.status !== 'pass');
    const immediate = problems.length ? `<div class="lp-problem-list">${problems.map(c=>`<div class="lp-problem ${statusClass(c.status)}"><span>${statusIcon(c.status)}</span><span>${esc(c.label)}</span></div>`).join('')}</div>` : '';
    const allRows = evaluation.criteria.map(c => `<div class="lp-rule-row ${statusClass(c.status)}"><span class="lp-rule-icon">${statusIcon(c.status)}</span><span>${esc(c.label)}</span>${c.observed ? `<small>${esc(c.observed)}</small>` : ''}</div>`).join('');
    const details = `
      <div class="lp-group-grid">${groups}</div>
      ${immediate}
      <details class="lp-rule-details"><summary>${esc(t('Alle Kriterien anzeigen','Show all criteria'))}</summary><div class="lp-rule-list">${allRows}</div></details>`;

    if (actual.known) {
      const actualClass = actual.passed ? 'lp-actual-pass' : 'lp-actual-fail';
      const actualLabel = actual.passed ? t('LP bestanden','Performance test passed') : t('LP nicht bestanden','Performance test failed');
      let modelNote;
      if (actual.passed) {
        modelNote = evaluation.overall === 'pass'
          ? t('Echtes Ergebnis und Prototypmodell stimmen überein.','Real result and prototype model agree.')
          : evaluation.overall === 'fail'
            ? t(`Das Prototypmodell widerspricht dem echten Bestehen bei ${evaluation.failed.length} Regel${evaluation.failed.length===1?'':'n'} – dieses Pferd ist damit ein positives Validierungsgegenbeispiel.`,`The prototype model contradicts the confirmed pass on ${evaluation.failed.length} rule${evaluation.failed.length===1?'':'s'} – this horse is therefore a positive validation counterexample.`)
            : t('Das echte Bestehen ist bestätigt; die Modellprognose bleibt wegen fehlender Eingangsdaten unvollständig.','The real pass is confirmed; the model prediction remains incomplete because input data is missing.');
      } else {
        modelNote = evaluation.overall === 'fail'
          ? t('Das Prototypmodell erkennt diesen bestätigten Nichtbesteher ebenfalls als nicht ausreichend.','The prototype model also flags this confirmed failed test as not sufficient.')
          : evaluation.overall === 'pass'
            ? t('Das Prototypmodell hätte dieses Pferd als ausreichend eingeschätzt, obwohl die LP tatsächlich nicht bestanden wurde – ein echter negativer Gegenfall für das Modell.','The prototype model would have rated this horse as sufficient even though the performance test was actually failed – a true negative counterexample for the model.')
            : t('Das echte Nichtbestehen ist bestätigt; die Modellprognose bleibt wegen fehlender Eingangsdaten unvollständig.','The real failed test is confirmed; the model prediction remains incomplete because input data is missing.');
      }
      root.innerHTML = `
        <div class="lp-horse-head ${actualClass}">
          <span class="lp-status-pill">${actual.passed ? '✓' : '✕'} ${esc(actualLabel)}</span>
          ${actual.points != null ? `<strong>${Math.round(actual.points)} ${esc(t('Punkte','points'))}</strong>` : ''}
        </div>
        ${actual.text ? `<div class="small lp-actual-text">${esc(actual.text)}</div>` : ''}
        ${renderPredictionSummary(classification)}
        ${details}
        <p class="tiny muted lp-model-note">${esc(modelNote)}</p>`;
      return { actual, evaluation, validation, classification };
    }

    const actualLabel = actual.status === 'none'
      ? t('Noch kein bestätigtes LP-Ergebnis','No confirmed performance-test result yet')
      : t('Kein bestätigtes LP-Ergebnis','No confirmed performance-test result');
    const rawStatus = actual.text && actual.status !== 'none'
      ? `<div class="small lp-actual-text">${esc(actual.text)}</div>`
      : '';

    root.innerHTML = `
      <div class="lp-horse-head lp-actual-none">
        <span class="lp-status-pill lp-status-neutral">○ ${esc(actualLabel)}</span>
      </div>
      ${rawStatus}
      ${renderPredictionSummary(classification)}
      ${details}
      <p class="tiny muted lp-model-note">${esc(t('Die Prognose ist ein Prototyp aus User-Vermutungen und bestätigten LP-Ergebnissen. „Nein“ bzw. ein fehlender LP-Eintrag bedeutet ausdrücklich nicht „nicht bestanden“. Punkte werden nicht prognostiziert.','The prediction is a prototype based on user-derived assumptions and confirmed performance-test results. “No” or a missing test entry explicitly does not mean “failed”. Points are not predicted.'))}</p>`;
    return { actual, evaluation, validation, classification };
  }

  window.MDR_LP_MODEL = {
    version: MODEL_VERSION,
    coreGaits: [...CORE_GAITS],
    rules: RULE_META,
    actualResult,
    evaluate,
    validate,
    classify,
    renderValidation,
    renderHorse,
  };
})();
