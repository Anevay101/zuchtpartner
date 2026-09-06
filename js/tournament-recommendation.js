/* V54.0.10 – gemeinsame Turnierempfehlung für Turnierplaner und Pferdeseite */
const MDR_TOURNAMENT_REFERENCE_MIN_N = 15;
const MDR_TOURNAMENT_REFERENCE_PROVISIONAL_MIN_N = 5;
const MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN = 150;
const MDR_TOURNAMENT_MIN_STORAGE_KEY = 'mdr_tournament_absolute_min_v1';

function plannerTournamentAbsoluteMin(fallback = MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN) {
  try {
    const raw = localStorage.getItem(MDR_TOURNAMENT_MIN_STORAGE_KEY);
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  } catch (_) {}
  const fb = Number(fallback);
  return Number.isFinite(fb) && fb >= 0 ? fb : MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN;
}

function plannerSetTournamentAbsoluteMin(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return;
  try { localStorage.setItem(MDR_TOURNAMENT_MIN_STORAGE_KEY, String(n)); } catch (_) {}
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
  return 'absolute-only';
}

function plannerBuildTournamentReferences(horses, scoreFn, minN = MDR_TOURNAMENT_REFERENCE_MIN_N) {
  const refs = {};
  const pool = (horses || []).filter(h => h && typeof plannerHorseMainGroup === 'function' && plannerHorseMainGroup(h));

  for (const [discipline, def] of Object.entries(MDR_TOURNAMENT_DISCIPLINES || {})) {
    const values = [];
    for (const horse of pool) {
      // „Echt“ bedeutet hier: Die eingetragene Hauptdisziplin des Pferdes
      // gehört zur Gruppe der betrachteten Disziplin.
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
      usable: mode !== 'absolute-only', // V54.0.9-Kompatibilität: „usable“ = P25 darf benutzt werden
      provisional: mode !== 'normal',
      p25: plannerTournamentPercentile(values, .25),
      p50: plannerTournamentPercentile(values, .50),
      p75: plannerTournamentPercentile(values, .75),
    };
  }
  return refs;
}

function plannerTournamentSuitability(row, reference, absoluteMin = MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN) {
  const points = Number(row?.points);
  if (!row || row.complete === false || !Number.isFinite(points)) return { suitable:false, reason:'unvollständig' };

  const abs = Number(absoluteMin);
  const absoluteMinimum = Number.isFinite(abs) ? abs : MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN;
  const mode = reference?.mode || plannerTournamentReferenceMode(reference?.n || 0);
  const useP25 = mode !== 'absolute-only' && Number.isFinite(Number(reference?.p25));
  const minimum = useP25 ? Math.max(absoluteMinimum, Number(reference.p25)) : absoluteMinimum;
  const suitable = points >= minimum;
  const provisional = mode !== 'normal';

  let reason;
  if (suitable) reason = provisional ? 'geeignet · vorläufig' : 'geeignet';
  else if (useP25) reason = provisional ? 'unter vorläufiger Referenz' : 'unter Referenz';
  else reason = 'unter Mindestgrenze';

  return {
    suitable,
    reason,
    minimum,
    reference,
    referenceMode: mode,
    referenceUsed: useP25,
    provisional,
  };
}

function plannerAnalyzeTournamentProfile(horse, horses, scoreFn, options = {}) {
  const absoluteMin = Number.isFinite(Number(options.absoluteMin))
    ? Number(options.absoluteMin)
    : plannerTournamentAbsoluteMin();
  const minN = Number.isFinite(Number(options.minN)) ? Number(options.minN) : MDR_TOURNAMENT_REFERENCE_MIN_N;
  const references = options.references || plannerBuildTournamentReferences(horses, scoreFn, minN);
  const mainGroup = typeof plannerHorseMainGroup === 'function' ? plannerHorseMainGroup(horse) : null;
  const talent = typeof plannerHorseTalent === 'function' ? plannerHorseTalent(horse) : null;

  const rows = Object.keys(MDR_TOURNAMENT_DISCIPLINES || {})
    .map(name => scoreFn(horse, name))
    .filter(row => row && row.complete !== false && Number.isFinite(Number(row.points)))
    .map(row => {
      const reference = references[row.discipline] || null;
      const suitability = plannerTournamentSuitability(row, reference, absoluteMin);
      return { ...row, reference, suitability, suitable:suitability.suitable };
    })
    .sort((a,b) => Number(b.points)-Number(a.points) || (a.interior ?? 99)-(b.interior ?? 99));

  const suitableRows = rows.filter(r => r.suitable);
  const groups = (MDR_TOURNAMENT_GROUP_ORDER || [])
    .map(group => {
      const groupRows = suitableRows.filter(r => r.group === group);
      if (!groupRows.length) return null;
      const avgPoints = groupRows.reduce((s,r)=>s+Number(r.points),0)/groupRows.length;
      const avgMargin = groupRows.reduce((s,r)=>s+(Number(r.points)-Number(r.suitability.minimum || 0)),0)/groupRows.length;
      const provisional = groupRows.some(r => r.suitability?.provisional);
      return {
        group,
        rows: groupRows,
        count: groupRows.length,
        avgPoints,
        avgMargin,
        provisional,
        isMain: group === mainGroup,
      };
    })
    .filter(Boolean);

  const main = groups.find(g => g.group === mainGroup) || { group:mainGroup, rows:[], count:0, avgPoints:null, avgMargin:null, provisional:false, isMain:true };
  const alternatives = groups
    .filter(g => g.group !== mainGroup && g.count >= 2)
    .sort((a,b) => b.count-a.count || Number(a.provisional)-Number(b.provisional) || b.avgMargin-a.avgMargin || b.avgPoints-a.avgPoints);
  const singleAlternatives = groups
    .filter(g => g.group !== mainGroup && g.count === 1)
    .sort((a,b) => Number(a.provisional)-Number(b.provisional) || b.avgMargin-a.avgMargin || b.avgPoints-a.avgPoints);

  let recommendation = 'Keine klare Turnierempfehlung';
  if (mainGroup && main.count >= 2) recommendation = main.provisional ? 'Hauptdisziplin sinnvoll (vorläufig)' : 'Hauptdisziplin sinnvoll';
  else if (alternatives.length) recommendation = alternatives[0].provisional ? 'Alternative prüfen (vorläufig)' : 'Alternative prüfen';
  else if (mainGroup && main.count === 1) recommendation = main.provisional ? 'Hauptdisziplin mit Einzelstärke (vorläufig)' : 'Hauptdisziplin mit Einzelstärke';
  else if (!mainGroup && groups.some(g => g.count >= 2)) recommendation = 'Geeignete Turniergruppe gefunden';

  return {
    horse, rows, suitableRows, groups, mainGroup, talent, main,
    alternatives, singleAlternatives, recommendation,
    best: rows[0] || null,
    bestSuitable: suitableRows[0] || null,
    references, absoluteMin, minN,
  };
}

function plannerFormatTournamentOption(row, includeGroup = false) {
  if (!row) return '';
  const bits = [
    `${row.discipline} ${Math.round(Number(row.points))}`,
    `Int ${row.interior == null ? '–' : Number(row.interior).toFixed(2)}`,
    row.lk || 'LK –',
  ];
  const base = bits.join(' / ');
  return includeGroup ? `${base} (${row.group})` : base;
}

function plannerTournamentCopyText(profile) {
  if (!profile) return '';
  const mainLabel = profile.mainGroup || 'unbekannt';
  const mainRows = profile.main?.rows || [];
  const mainText = mainRows.length
    ? mainRows.map(r => plannerFormatTournamentOption(r)).join(' | ')
    : 'keine geeignete Disziplin';
  const alt = profile.alternatives?.[0] || null;
  const altText = alt
    ? `${alt.group}${alt.provisional ? ' (vorläufig)' : ''} – ${alt.rows.map(r => plannerFormatTournamentOption(r)).join(' | ')}`
    : 'keine';
  return `Turnier: ${mainLabel} ${mainText} Alternative: ${altText}`.replace(/\s+/g,' ').trim();
}

function plannerSuitableTournamentCopyText(profile) {
  if (!profile?.suitableRows?.length) return 'Geeignete Disziplinen: keine';
  return `Geeignete Disziplinen: ${profile.suitableRows.map(r => plannerFormatTournamentOption(r, true)).join(' | ')}`;
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
  if (!reference) return 'nur Mindestgrenze · n=0 · vorläufig';
  const mode = reference.mode || plannerTournamentReferenceMode(reference.n || 0);
  if (mode === 'normal' && Number.isFinite(Number(reference.p25))) {
    return `P25 ${Math.round(reference.p25)} · n=${reference.n}`;
  }
  if (mode === 'provisional-p25' && Number.isFinite(Number(reference.p25))) {
    return `P25 ${Math.round(reference.p25)} · n=${reference.n} · vorläufig`;
  }
  return `nur Mindestgrenze · n=${reference.n || 0} · vorläufig`;
}

function plannerTournamentReferenceBasisQuality(n) {
  const count = Math.max(0, Number(n) || 0);
  if (count >= 30) return 'stabil';
  if (count >= MDR_TOURNAMENT_REFERENCE_MIN_N) return 'brauchbar';
  if (count >= MDR_TOURNAMENT_REFERENCE_PROVISIONAL_MIN_N) return 'vorläufig';
  return 'nur Mindestgrenze';
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
