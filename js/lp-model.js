// MDR V54.0.82 – LP-Prototypmodell v1
// Regelbasiertes Modell aus dem User-LP-Rechner. Es wird bewusst nur an
// bestaetigten Bestehern rueckwaerts validiert; fehlender Praemienstatus gilt
// NICHT als Nichtbestehen. Keine Punkteprognose.
(() => {
  'use strict';

  const MODEL_VERSION = 'LP-Prototyp v1';
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

    const negative = text && (
      /^(?:nein|no|false|0)$/i.test(text) ||
      /(?:failed|nicht bestanden|durchgefallen)/i.test(text)
    );
    const positive = text && !negative && (
      /^(?:ja|yes|true|1)$/i.test(text) ||
      /(?:prämienstute|praemienstute|prämienhengst|praemienhengst|premium mare|premium stallion|\bbestanden\b|\bpassed\b)/i.test(text) ||
      points != null
    );

    let passed = null;
    if (negative) passed = false;
    else if (positive) passed = true;
    else if (horse?.performance_test_passed === true) passed = true;
    else if (horse?.performance_test_passed === false) passed = false;

    return { known: passed !== null, passed, points, text };
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

  function confirmedPassers(horses) {
    const seen = new Set();
    const out = [];
    (Array.isArray(horses) ? horses : []).forEach((horse,index) => {
      const actual = actualResult(horse);
      if (actual.passed !== true) return;
      const key = horseKey(horse,index);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(horse);
    });
    return out;
  }

  function validate(horses) {
    const passers = confirmedPassers(horses);
    const ruleStats = Object.fromEntries(Object.keys(RULE_META).map(id => [id,{pass:0,fail:0,unknown:0}]));
    let conform = 0, counterexamples = 0, incomplete = 0;
    const rows = [];
    for (const horse of passers) {
      const ev = evaluate(horse);
      if (ev.overall === 'pass') conform++;
      else if (ev.overall === 'fail') counterexamples++;
      else incomplete++;
      for (const criterion of ev.criteria) ruleStats[criterion.id][criterion.status]++;
      rows.push({horse, evaluation:ev, actual:actualResult(horse)});
    }
    return { total:passers.length, conform, counterexamples, incomplete, ruleStats, rows };
  }

  function supportForRule(stat) {
    if (!stat) return 'low';
    if (stat.fail > 0) return 'counterexample';
    if (stat.pass >= 10) return 'strong';
    if (stat.pass >= 5) return 'supported';
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

  function renderValidation(root, horses) {
    if (!root) return;
    const validation = validate(horses);
    if (!validation.total) {
      root.innerHTML = `<p class="muted small">${esc(t('Noch keine bestätigten LP-Besteher im Datenbestand. Pferde ohne LP-Eintrag werden nicht als Nichtbesteher gewertet.','No confirmed performance-test passers in the dataset yet. Horses without a test entry are not treated as failures.'))}</p>`;
      return validation;
    }

    const ruleRows = Object.keys(RULE_META).map(id => {
      const meta = RULE_META[id];
      const stat = validation.ruleStats[id];
      const evaluated = stat.pass + stat.fail;
      const support = supportForRule(stat);
      const supportLabel = support === 'counterexample'
        ? t(`${stat.fail} Gegenbeispiel${stat.fail===1?'':'e'}`,`${stat.fail} counterexample${stat.fail===1?'':'s'}`)
        : support === 'strong' ? t('stark gestützt','strongly supported')
        : support === 'supported' ? t('gestützt','supported')
        : t('zu wenig Daten','too little data');
      return `<tr>
        <td><span class="lp-mini-group">${esc(GROUP_LABELS[meta.group][lang()])}</span></td>
        <td>${esc(meta[lang()])}</td>
        <td><strong>${stat.pass}/${evaluated || 0}</strong>${stat.unknown ? `<span class="tiny muted"> · ${stat.unknown} ?</span>` : ''}</td>
        <td><span class="lp-support lp-support-${support}">${esc(supportLabel)}</span></td>
      </tr>`;
    }).join('');

    root.innerHTML = `
      <div class="lp-validation-kpis">
        <div><span>${esc(t('bestätigte Besteher','confirmed passers'))}</span><strong>${validation.total}</strong></div>
        <div><span>${esc(t('voll modellkonform','fully model-conform'))}</span><strong>${validation.conform}</strong></div>
        <div><span>${esc(t('Gegenbeispiele','counterexamples'))}</span><strong>${validation.counterexamples}</strong></div>
        <div><span>${esc(t('unvollständig prüfbar','incompletely assessable'))}</span><strong>${validation.incomplete}</strong></div>
      </div>
      <p class="tiny muted lp-model-note"><strong>${MODEL_VERSION}.</strong> ${esc(t('Rückwärtsprüfung nur an bestätigten Prämienhengsten/-stuten; fehlender Prämienstatus ist kein negatives Ergebnis. Die Quelle bezeichnet besonders die Interieur-Regeln selbst als noch unsicher.','Backward validation uses confirmed premium stallions/mares only; missing premium status is not a negative result. The source itself marks the temperament rules as still uncertain.'))}</p>
      <div class="table-wrap lp-validation-table-wrap"><table class="detail-table lp-validation-table"><thead><tr>
        <th>${esc(t('Bereich','Area'))}</th><th>${esc(t('Regel','Rule'))}</th><th>${esc(t('erfüllt / prüfbar','met / assessable'))}</th><th>${esc(t('Einordnung','Assessment'))}</th>
      </tr></thead><tbody>${ruleRows}</tbody></table></div>
      <p class="tiny muted lp-model-note">${esc(t('Werte-Regeln: 4 Disziplinen der Begabungsgruppe sowie 8 Grundlagen + Schritt, Trab, Galopp und Renngalopp; verwendet werden die Potenzialwerte.','Value rules: the 4 disciplines of the talent group plus 8 fundamentals + walk, trot, canter and gallop; potential values are used.'))}</p>`;
    return validation;
  }

  function renderHorse(root, horse, horses) {
    if (!root) return;
    const actual = actualResult(horse);
    const evaluation = evaluate(horse);
    const validation = validate(horses);

    if (actual.known) {
      const actualClass = actual.passed ? 'lp-actual-pass' : 'lp-actual-fail';
      const actualLabel = actual.passed ? t('LP bestanden','Performance test passed') : t('LP nicht bestanden','Performance test failed');
      const modelNote = actual.passed
        ? evaluation.overall === 'pass'
          ? t('Das Prototypmodell erfüllt bei diesem bestätigten Besteher alle aktuell prüfbaren Regeln.','The prototype model meets all currently assessable rules for this confirmed passer.')
          : evaluation.overall === 'fail'
            ? t(`Das Prototypmodell widerspricht dem echten Ergebnis bei ${evaluation.failed.length} Regel${evaluation.failed.length===1?'':'n'} – dieses Pferd zählt damit als Validierungsgegenbeispiel.`,`The prototype model contradicts the real result on ${evaluation.failed.length} rule${evaluation.failed.length===1?'':'s'} – this horse therefore counts as a validation counterexample.`)
            : t('Das echte Ergebnis ist bestätigt; das Prototypmodell ist wegen fehlender Eingangsdaten nicht vollständig prüfbar.','The real result is confirmed; the prototype model cannot be fully assessed because input data is missing.')
        : t('Ein echtes LP-Ergebnis ist gespeichert. Nichtbesteher werden in LP-Prototyp v1 noch nicht zur Modellvalidierung verwendet.','A real performance-test result is stored. Failed tests are not yet used for validation in LP Prototype v1.');
      root.innerHTML = `
        <div class="lp-horse-head ${actualClass}">
          <span class="lp-status-pill">${actual.passed ? '✓' : '✕'} ${esc(actualLabel)}</span>
          ${actual.points != null ? `<strong>${Math.round(actual.points)} ${esc(t('Punkte','points'))}</strong>` : ''}
        </div>
        ${actual.text ? `<div class="small lp-actual-text">${esc(actual.text)}</div>` : ''}
        <p class="tiny muted lp-model-note">${esc(modelNote)}</p>`;
      return { actual, evaluation, validation };
    }

    const classification = classify(evaluation, validation);
    const groups = ['disease','interior','exterior','values'].map(group => {
      const s = groupSummary(evaluation, group);
      const state = s.fail ? 'fail' : s.unknown ? 'unknown' : 'pass';
      return `<div class="lp-group-chip ${statusClass(state)}"><span>${esc(GROUP_LABELS[group][lang()])}</span><strong>${statusIcon(state)} ${s.pass}/${s.total}</strong></div>`;
    }).join('');
    const problems = evaluation.criteria.filter(c => c.status !== 'pass');
    const immediate = problems.length ? `<div class="lp-problem-list">${problems.map(c=>`<div class="lp-problem ${statusClass(c.status)}"><span>${statusIcon(c.status)}</span><span>${esc(c.label)}</span></div>`).join('')}</div>` : '';
    const allRows = evaluation.criteria.map(c => `<div class="lp-rule-row ${statusClass(c.status)}"><span class="lp-rule-icon">${statusIcon(c.status)}</span><span>${esc(c.label)}</span>${c.observed ? `<small>${esc(c.observed)}</small>` : ''}</div>`).join('');

    root.innerHTML = `
      <div class="lp-horse-head">
        <span class="lp-status-pill lp-status-${classification.key}">${classification.icon} ${esc(classification.label)}</span>
        <span class="tiny muted">${MODEL_VERSION}</span>
      </div>
      <div class="lp-group-grid">${groups}</div>
      ${immediate}
      <details class="lp-rule-details"><summary>${esc(t('Alle Kriterien anzeigen','Show all criteria'))}</summary><div class="lp-rule-list">${allRows}</div></details>
      <p class="tiny muted lp-model-note">${esc(t('Prognose aus User-Vermutungen, rückwärts an bestätigten Bestehern geprüft. Kein LP-Eintrag wird nicht als Durchfallen gewertet; Punkte werden nicht prognostiziert.','Prediction from user-derived assumptions, backward-validated on confirmed passers. Missing test status is not treated as failure; points are not predicted.'))}</p>`;
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
