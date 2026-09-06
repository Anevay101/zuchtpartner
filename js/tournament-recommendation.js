/* V54.0.9 – gemeinsame Turnierempfehlung für Turnierplaner und Pferdeseite */
const MDR_TOURNAMENT_REFERENCE_MIN_N = 15;
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

function plannerBuildTournamentReferences(horses, scoreFn, minN = MDR_TOURNAMENT_REFERENCE_MIN_N) {
  const refs = {};
  const pool = (horses || []).filter(h => h && typeof plannerHorseMainGroup === 'function' && plannerHorseMainGroup(h));

  for (const [discipline, def] of Object.entries(MDR_TOURNAMENT_DISCIPLINES || {})) {
    const values = [];
    for (const horse of pool) {
      if (plannerHorseMainGroup(horse) !== def.group) continue;
      const row = scoreFn(horse, discipline);
      const points = Number(row?.points);
      if (!row || row.complete === false || !Number.isFinite(points)) continue;
      values.push(points);
    }
    refs[discipline] = {
      discipline,
      group: def.group,
      n: values.length,
      usable: values.length >= minN,
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
  if (!reference?.usable || !Number.isFinite(Number(reference.p25))) {
    return { suitable:false, reason:'Referenz noch zu klein', reference };
  }
  const abs = Number(absoluteMin);
  const minimum = Math.max(Number.isFinite(abs) ? abs : MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN, Number(reference.p25));
  return {
    suitable: points >= minimum,
    reason: points >= minimum ? 'geeignet' : 'unter Referenz',
    minimum,
    reference,
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
      return {
        group,
        rows: groupRows,
        count: groupRows.length,
        avgPoints,
        avgMargin,
        isMain: group === mainGroup,
      };
    })
    .filter(Boolean);

  const main = groups.find(g => g.group === mainGroup) || { group:mainGroup, rows:[], count:0, avgPoints:null, avgMargin:null, isMain:true };
  const alternatives = groups
    .filter(g => g.group !== mainGroup && g.count >= 2)
    .sort((a,b) => b.count-a.count || b.avgMargin-a.avgMargin || b.avgPoints-a.avgPoints);
  const singleAlternatives = groups
    .filter(g => g.group !== mainGroup && g.count === 1)
    .sort((a,b) => b.avgMargin-a.avgMargin || b.avgPoints-a.avgPoints);

  const mainRawRows = mainGroup ? rows.filter(r => r.group === mainGroup) : [];
  const mainReferenceReady = mainRawRows.some(r => r.reference?.usable);

  let recommendation = 'Keine klare Turnierempfehlung';
  if (mainGroup && main.count >= 2) recommendation = 'Hauptdisziplin sinnvoll';
  else if (alternatives.length) recommendation = 'Alternative prüfen';
  else if (mainGroup && main.count === 1) recommendation = 'Hauptdisziplin mit Einzelstärke';
  else if (mainGroup && mainRawRows.length && !mainReferenceReady) recommendation = 'Referenzbasis noch zu klein';
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
    ? `${alt.group} – ${alt.rows.map(r => plannerFormatTournamentOption(r)).join(' | ')}`
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
  if (!reference) return 'keine Referenz';
  if (!reference.usable) return `Referenz n=${reference.n}`;
  return `P25 ${Math.round(reference.p25)} · n=${reference.n}`;
}
