/* V54.0.14 – gemeinsame Turnierempfehlung für Turnierplaner und Pferdeseite
   Hauptdisziplin: mindestens 180 Punkte
   Nebendisziplinen/Alternativen: mindestens 150 Punkte (bzw. höherer Nutzerwert)
   Spezialisten-P25 dient nur noch als Vergleichsinformation und niemals als Ausschlusskriterium. */
const MDR_TOURNAMENT_REFERENCE_MIN_N = 15;
const MDR_TOURNAMENT_REFERENCE_PROVISIONAL_MIN_N = 5;
const MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN = 150;
const MDR_TOURNAMENT_MAIN_MIN = 180;
const MDR_TOURNAMENT_MIN_STORAGE_KEY = 'mdr_tournament_absolute_min_v1';

function plannerTournamentAbsoluteMin(fallback = MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN) {
  const floor = MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN;
  try {
    const raw = Number(localStorage.getItem(MDR_TOURNAMENT_MIN_STORAGE_KEY));
    if (Number.isFinite(raw)) return Math.max(floor, raw);
  } catch (_) {}
  const fb = Number(fallback);
  return Math.max(floor, Number.isFinite(fb) ? fb : floor);
}

function plannerSetTournamentAbsoluteMin(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  const safe = Math.max(MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN, n);
  try { localStorage.setItem(MDR_TOURNAMENT_MIN_STORAGE_KEY, String(safe)); } catch (_) {}
}

function plannerTournamentPercentile(values, q) {
  const sorted = (values || []).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = Math.max(0, Math.min(1, Number(q))) * (sorted.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const f = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * f;
}

function plannerTournamentReferenceMode(n, minN = MDR_TOURNAMENT_REFERENCE_MIN_N) {
  const count = Math.max(0, Number(n) || 0);
  if (count >= minN) return 'normal';
  if (count >= MDR_TOURNAMENT_REFERENCE_PROVISIONAL_MIN_N) return 'provisional-p25';
  return 'small-sample';
}

function plannerBuildTournamentReferences(horses, scoreFn, minN = MDR_TOURNAMENT_REFERENCE_MIN_N) {
  const refs = {};
  const pool = (horses || []).filter(h => h && typeof plannerHorseMainGroup === 'function' && plannerHorseMainGroup(h));

  for (const [discipline, def] of Object.entries(MDR_TOURNAMENT_DISCIPLINES || {})) {
    const values = [];
    for (const horse of pool) {
      // Referenzpferde = Pferde, deren eingetragene Hauptbegabung zur Gruppe
      // der betrachteten Disziplin gehört.
      if (plannerHorseMainGroup(horse) !== def.group) continue;
      const row = scoreFn(horse, discipline);
      const points = Number(row?.points);
      if (!row || row.complete === false || !Number.isFinite(points)) continue;
      values.push(points);
    }
    const mode = plannerTournamentReferenceMode(values.length, minN);
    refs[discipline] = {
      discipline,
      group: def.group,
      n: values.length,
      mode,
      usable: values.length >= MDR_TOURNAMENT_REFERENCE_PROVISIONAL_MIN_N,
      provisional: values.length < minN,
      p25: plannerTournamentPercentile(values, .25),
      p50: plannerTournamentPercentile(values, .50),
      p75: plannerTournamentPercentile(values, .75),
    };
  }
  return refs;
}

function plannerTournamentProof(horse, discipline) {
  let row = null;
  try {
    row = typeof plannerTournamentResults === 'function'
      ? plannerTournamentResults(horse)?.[discipline]
      : null;
  } catch (_) {}
  const first = Math.max(0, Number(row?.first) || 0);
  const second = Math.max(0, Number(row?.second) || 0);
  const third = Math.max(0, Number(row?.third) || 0);
  const placements = first + second + third;
  const cupStar = row?.cup_star === true;
  return {
    first, second, third, placements, cupStar,
    proven: cupStar || placements > 0,
  };
}

function plannerTournamentSuitability(row, reference, secondaryMin = MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN, options = {}) {
  const points = Number(row?.points);
  if (!row || row.complete === false || !Number.isFinite(points)) {
    return { suitable:false, reason:'unvollständig', minimum:null, reference, referenceUsed:false, provisional:false, proven:false };
  }

  const secondaryRaw = Number(secondaryMin);
  const secondaryMinimum = Math.max(
    MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN,
    Number.isFinite(secondaryRaw) ? secondaryRaw : MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN,
  );
  const mainRaw = Number(options.mainMin);
  const mainMinimum = Math.max(MDR_TOURNAMENT_MAIN_MIN, Number.isFinite(mainRaw) ? mainRaw : MDR_TOURNAMENT_MAIN_MIN);
  const isMainGroup = options.isMainGroup === true;
  const minimum = isMainGroup ? mainMinimum : secondaryMinimum;
  const suitable = points >= minimum;
  const proof = options.proof || { proven:false, placements:0, first:0, second:0, third:0, cupStar:false };

  return {
    suitable,
    reason: suitable ? 'geeignet' : (isMainGroup ? 'unter Hauptgrenze' : 'unter Mindestgrenze'),
    minimum,
    secondaryMinimum,
    mainMinimum,
    isMainGroup,
    reference,
    // P25 ist ab V54.0.11 nur Vergleichsinformation.
    referenceUsed: false,
    provisional: false,
    specialistP25: Number.isFinite(Number(reference?.p25)) ? Number(reference.p25) : null,
    proof,
    proven: proof.proven === true,
  };
}

function plannerAnalyzeTournamentProfile(horse, horses, scoreFn, options = {}) {
  const secondaryMin = Number.isFinite(Number(options.absoluteMin))
    ? Math.max(MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN, Number(options.absoluteMin))
    : plannerTournamentAbsoluteMin();
  const mainMin = Number.isFinite(Number(options.mainMin))
    ? Math.max(MDR_TOURNAMENT_MAIN_MIN, Number(options.mainMin))
    : MDR_TOURNAMENT_MAIN_MIN;
  const minN = Number.isFinite(Number(options.minN)) ? Number(options.minN) : MDR_TOURNAMENT_REFERENCE_MIN_N;
  const references = options.references || plannerBuildTournamentReferences(horses, scoreFn, minN);
  const mainGroup = typeof plannerHorseMainGroup === 'function' ? plannerHorseMainGroup(horse) : null;
  const talent = typeof plannerHorseTalent === 'function' ? plannerHorseTalent(horse) : null;

  const rows = Object.keys(MDR_TOURNAMENT_DISCIPLINES || {})
    .map(name => scoreFn(horse, name))
    .filter(row => row && row.complete !== false && Number.isFinite(Number(row.points)))
    .map(row => {
      const reference = references[row.discipline] || null;
      const isMainGroup = Boolean(mainGroup && row.group === mainGroup);
      const proof = plannerTournamentProof(horse, row.discipline);
      const suitability = plannerTournamentSuitability(row, reference, secondaryMin, { isMainGroup, mainMin, proof });
      return {
        ...row,
        reference,
        suitability,
        suitable: suitability.suitable,
        isMainGroup,
        proof,
        proven: proof.proven,
      };
    })
    .sort((a,b) => Number(b.points)-Number(a.points) || (a.interior ?? 99)-(b.interior ?? 99));

  const suitableRows = rows.filter(r => r.suitable);
  const groups = (MDR_TOURNAMENT_GROUP_ORDER || [])
    .map(group => {
      const groupRows = suitableRows.filter(r => r.group === group);
      if (!groupRows.length) return null;
      const avgPoints = groupRows.reduce((s,r)=>s+Number(r.points),0)/groupRows.length;
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
    group:mainGroup, rows:[], count:0, avgPoints:null, provenCount:0, provisional:false, isMain:true,
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
    horse, rows, suitableRows, groups, mainGroup, talent, main,
    alternatives, singleAlternatives, recommendation,
    best: rows[0] || null,
    bestSuitable: suitableRows[0] || null,
    references,
    absoluteMin: secondaryMin, // Kompatibilität mit bestehender Anzeige
    secondaryMin,
    mainMin,
    minN,
  };
}

function plannerFormatTournamentOption(row, includeGroup = false) {
  if (!row) return '';
  const bits = [
    `${row.discipline} ${Math.round(Number(row.points))}`,
    `Int ${row.interior == null ? '–' : Number(row.interior).toFixed(2)}`,
    row.lk || 'LK –',
  ];
  // Copy-Paste bewusst kompakt halten: "bewährt" bleibt eine UI-Information
  // und wird nicht in die Pferdenotizen kopiert.
  const base = bits.join(' / ');
  return includeGroup ? `${base} (${row.group})` : base;
}

function plannerTournamentCopyText(profile) {
  if (!profile) return '';
  const mainLabel = profile.mainGroup || 'unbekannt';
  const mainRows = profile.main?.rows || [];
  const lines = [`Turnier: ${mainLabel}`];

  if (mainRows.length) {
    mainRows.forEach(row => lines.push(plannerFormatTournamentOption(row)));
  } else {
    lines.push('keine geeignete Disziplin');
  }

  const alt = profile.alternatives?.[0] || null;
  if (alt) {
    lines.push(`Alternative: ${alt.group}`);
    alt.rows.forEach(row => lines.push(plannerFormatTournamentOption(row)));
  } else {
    lines.push('Alternative: keine');
  }

  return lines.join('\n').trim();
}

function plannerSuitableTournamentCopyText(profile) {
  if (!profile?.suitableRows?.length) return 'Geeignete Disziplinen: keine';
  return ['Geeignete Disziplinen:', ...profile.suitableRows.map(r => plannerFormatTournamentOption(r, true))].join('\n');
}

async function plannerCopyText(text, button) {
  const value = String(text || '');
  if (!value) return false;
  let ok = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      ok = true;
    }
  } catch (_) {}
  if (!ok) {
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly','');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
    } catch (_) {}
  }
  if (button) {
    const old = button.textContent;
    button.textContent = ok ? 'Kopiert' : 'Kopieren fehlgeschlagen';
    setTimeout(()=>{ button.textContent = old; }, 1400);
  }
  return ok;
}

function plannerReferenceLabel(reference) {
  if (!reference || !Number.isFinite(Number(reference.p25)) || !(Number(reference.n) > 0)) {
    return 'keine Spezialisten-Referenz';
  }
  const n = Math.max(0, Number(reference.n) || 0);
  const suffix = n >= MDR_TOURNAMENT_REFERENCE_MIN_N
    ? ''
    : n >= MDR_TOURNAMENT_REFERENCE_PROVISIONAL_MIN_N
      ? ' · kleine Basis'
      : ' · sehr kleine Basis';
  return `Spezialisten-P25 ${Math.round(reference.p25)} · n=${n}${suffix}`;
}

function plannerTournamentReferenceBasisQuality(n) {
  const count = Math.max(0, Number(n) || 0);
  if (count >= 30) return 'stabil';
  if (count >= MDR_TOURNAMENT_REFERENCE_MIN_N) return 'brauchbar';
  if (count >= MDR_TOURNAMENT_REFERENCE_PROVISIONAL_MIN_N) return 'kleine Basis';
  if (count > 0) return 'sehr klein';
  return 'keine Daten';
}

function plannerTournamentReferenceGroupSummaries(references) {
  return (MDR_TOURNAMENT_GROUP_ORDER || []).map(group => {
    const disciplines = (MDR_TOURNAMENT_GROUPS?.[group] || []).map(name => references?.[name]).filter(Boolean);
    const ns = disciplines.map(r => Math.max(0, Number(r.n) || 0));
    const minN = ns.length ? Math.min(...ns) : 0;
    const maxN = ns.length ? Math.max(...ns) : 0;
    return {
      group,
      minN,
      maxN,
      nLabel: minN === maxN ? `n=${minN}` : `n=${minN}–${maxN}`,
      quality: plannerTournamentReferenceBasisQuality(minN),
    };
  });
}

function plannerTournamentReferenceBasisText(references) {
  return plannerTournamentReferenceGroupSummaries(references)
    .map(x => `${x.group} ${x.nLabel} · ${x.quality}`)
    .join(' · ');
}
