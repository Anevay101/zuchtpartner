
const MDR_TOURNAMENT_DISCIPLINES = {
  'Dressur': {
    group: 'Englisch',
    performance: ['Dressur', 'Schritt', 'Trab', 'Galopp', 'Kraft', 'Präzision', 'Ausdruck'],
    interior: ['Gelehrigkeit', 'Aufmerksamkeit', 'Intelligenz'],
  },
  'Springen': {
    group: 'Englisch',
    performance: ['Springen', 'Galopp', 'Beschleunigung', 'Wendigkeit', 'Kondition', 'Kraft', 'Tempo'],
    interior: ['Furchtlosigkeit', 'Leistungsbereitschaft', 'Temperament'],
  },
  'Cross Country': {
    group: 'Englisch',
    performance: ['Cross Country', 'Galopp', 'Beschleunigung', 'Wendigkeit', 'Kondition', 'Kraft', 'Tempo'],
    interior: ['Nervenstärke', 'Aufmerksamkeit', 'Leistungsbereitschaft'],
  },
  'Distanz': {
    group: 'Englisch',
    performance: ['Distanz', 'Schritt', 'Trab', 'Galopp', 'Kondition', 'Tempo', 'Gelassenheit'],
    interior: ['Gutmütigkeit', 'Nervenstärke', 'Temperament'],
  },

  'Flachrennen': {
    group: 'Rennen',
    performance: ['Flachrennen', 'Renngalopp', 'Beschleunigung', 'Kondition', 'Tempo', 'Kraft', 'Gelassenheit'],
    interior: ['Siegeswille', 'Leistungsbereitschaft', 'Temperament'],
  },
  'Hindernisrennen': {
    group: 'Rennen',
    performance: ['Hindernisrennen', 'Renngalopp', 'Beschleunigung', 'Kondition', 'Tempo', 'Kraft', 'Gelassenheit'],
    interior: ['Siegeswille', 'Nervenstärke', 'Aufmerksamkeit'],
  },
  'Seejagdrennen': {
    group: 'Rennen',
    performance: ['Seejagdrennen', 'Renngalopp', 'Beschleunigung', 'Kondition', 'Tempo', 'Kraft', 'Gelassenheit'],
    interior: ['Siegeswille', 'Nervenstärke', 'Furchtlosigkeit'],
  },
  'Trabrennen': {
    group: 'Rennen',
    performance: ['Trabrennen', 'Trab', 'Beschleunigung', 'Kondition', 'Tempo', 'Kraft', 'Gelassenheit'],
    interior: ['Temperament', 'Siegeswille', 'Leistungsbereitschaft'],
  },

  'Reining': {
    group: 'Western',
    performance: ['Reining', 'Schritt', 'Galopp', 'Beschleunigung', 'Wendigkeit', 'Kondition', 'Präzision'],
    interior: ['Temperament', 'Leistungsbereitschaft', 'Intelligenz'],
  },
  'Trail': {
    group: 'Western',
    performance: ['Trail', 'Schritt', 'Trab', 'Galopp', 'Wendigkeit', 'Präzision', 'Gelassenheit'],
    interior: ['Aufmerksamkeit', 'Gelehrigkeit', 'Intelligenz'],
  },
  'Pleasure': {
    group: 'Western',
    performance: ['Pleasure', 'Schritt', 'Trab', 'Galopp', 'Gelassenheit', 'Ausdruck', 'Präzision'],
    interior: ['Sozialverhalten', 'Gutmütigkeit', 'Gelehrigkeit'],
  },
  'Horsemanship': {
    group: 'Western',
    performance: ['Horsemanship', 'Schritt', 'Trab', 'Galopp', 'Gelassenheit', 'Ausdruck', 'Präzision'],
    interior: ['Gutmütigkeit', 'Gelehrigkeit', 'Intelligenz'],
  },

  'Cutting': {
    group: 'Rodeo',
    performance: ['Cutting', 'Galopp', 'Beschleunigung', 'Wendigkeit', 'Gelassenheit', 'Kraft', 'Tempo'],
    interior: ['Furchtlosigkeit', 'Nervenstärke', 'Intelligenz'],
  },
  'Roping': {
    group: 'Rodeo',
    performance: ['Roping', 'Galopp', 'Beschleunigung', 'Präzision', 'Gelassenheit', 'Kraft', 'Tempo'],
    interior: ['Aufmerksamkeit', 'Furchtlosigkeit', 'Nervenstärke'],
  },
  'Pole Bending': {
    group: 'Rodeo',
    performance: ['Pole Bending', 'Galopp', 'Beschleunigung', 'Wendigkeit', 'Präzision', 'Kraft', 'Tempo'],
    interior: ['Leistungsbereitschaft', 'Siegeswille', 'Temperament'],
  },
  'Barrel Racing': {
    group: 'Rodeo',
    performance: ['Barrel Racing', 'Galopp', 'Beschleunigung', 'Wendigkeit', 'Präzision', 'Kraft', 'Tempo'],
    interior: ['Leistungsbereitschaft', 'Siegeswille', 'Temperament'],
  },

  'Dressurfahren': {
    group: 'Fahren',
    performance: ['Dressurfahren', 'Schritt', 'Trab', 'Galopp', 'Wendigkeit', 'Präzision', 'Ausdruck'],
    interior: ['Sozialverhalten', 'Gelehrigkeit', 'Intelligenz'],
  },
  'Hindernisfahren': {
    group: 'Fahren',
    performance: ['Hindernisfahren', 'Galopp', 'Tempo', 'Wendigkeit', 'Präzision', 'Kondition', 'Kraft'],
    interior: ['Sozialverhalten', 'Aufmerksamkeit', 'Furchtlosigkeit'],
  },
  'Geländefahren': {
    group: 'Fahren',
    performance: ['Geländefahren', 'Galopp', 'Tempo', 'Wendigkeit', 'Gelassenheit', 'Kondition', 'Kraft'],
    interior: ['Sozialverhalten', 'Nervenstärke', 'Furchtlosigkeit'],
  },
  'Holzrücken': {
    group: 'Fahren',
    performance: ['Holzrücken', 'Schritt', 'Kraft', 'Gelassenheit', 'Kondition', 'Wendigkeit', 'Ausdruck'],
    interior: ['Nervenstärke', 'Furchtlosigkeit', 'Gutmütigkeit'],
  },

  'Klassische Dressur': {
    group: 'Barock',
    performance: ['Klassische Dressur', 'Schritt', 'Trab', 'Galopp', 'Kraft', 'Präzision', 'Ausdruck'],
    interior: ['Gelehrigkeit', 'Aufmerksamkeit', 'Intelligenz'],
  },
  'Spanische Gänge': {
    group: 'Barock',
    performance: ['Spanische Gänge', 'Schritt', 'Trab', 'Wendigkeit', 'Präzision', 'Ausdruck', 'Gelassenheit'],
    interior: ['Gutmütigkeit', 'Aufmerksamkeit', 'Intelligenz'],
  },
  'Schulsprünge': {
    group: 'Barock',
    performance: ['Schulsprünge', 'Kraft', 'Präzision', 'Ausdruck', 'Gelassenheit', 'Kondition', 'Wendigkeit'],
    interior: ['Temperament', 'Leistungsbereitschaft', 'Nervenstärke'],
  },
  'Hohe Schule': {
    group: 'Barock',
    performance: ['Hohe Schule', 'Schritt', 'Trab', 'Galopp', 'Kraft', 'Präzision', 'Ausdruck'],
    interior: ['Gelehrigkeit', 'Leistungsbereitschaft', 'Intelligenz'],
  },

  'Tölt-Prüfung': {
    group: 'Mehrgang',
    performance: ['Tölt-Prüfung', 'Tölt', 'Kraft', 'Präzision', 'Ausdruck', 'Kondition', 'Gelassenheit'],
    interior: ['Gutmütigkeit', 'Sozialverhalten', 'Aufmerksamkeit'],
  },
  'Passrennen': {
    group: 'Mehrgang',
    performance: ['Passrennen', 'Pass', 'Beschleunigung', 'Kondition', 'Tempo', 'Kraft', 'Gelassenheit'],
    interior: ['Sozialverhalten', 'Siegeswille', 'Temperament'],
  },
  'Foxtrott Pleasure': {
    group: 'Mehrgang',
    performance: ['Foxtrott Pleasure', 'Foxtrott', 'Gelassenheit', 'Ausdruck', 'Präzision', 'Kondition', 'Wendigkeit'],
    interior: ['Gutmütigkeit', 'Sozialverhalten', 'Gelehrigkeit'],
  },
  'Racking': {
    group: 'Mehrgang',
    performance: ['Racking', 'Rack', 'Tempo', 'Ausdruck', 'Präzision', 'Kondition', 'Beschleunigung'],
    interior: ['Gutmütigkeit', 'Sozialverhalten', 'Gelehrigkeit'],
  },
};

function plannerNorm(value) {
  return String(value ?? '').trim().toLocaleLowerCase('de');
}

function plannerEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function plannerGender(horse) {
  const g = plannerNorm(horse?.gender);
  if (g.includes('stute') || g === 'mare' || g === 'female') return 'stute';
  if (g.includes('hengst') || g === 'stallion' || g === 'male') return 'hengst';
  if (g.includes('wallach') || g.includes('gelding')) return 'wallach';
  return g;
}

function plannerPedigreeNames(horse, maxAncestors = 14) {
  const p = horse?.pedigree;
  if (Array.isArray(p)) return p.slice(1, maxAncestors + 1).map((x) => x?.name).filter(Boolean);
  if (p && Array.isArray(p.ancestors)) return p.ancestors.slice(0, maxAncestors).map((x) => x?.name).filter(Boolean);
  return [];
}

function plannerVisibleFoalAncestors(a, b) {
  const aa = plannerPedigreeNames(a, 6);
  const bb = plannerPedigreeNames(b, 6);
  return [
    a?.name, b?.name,
    ...aa.slice(0, 2), ...bb.slice(0, 2),
    ...aa.slice(2, 6), ...bb.slice(2, 6),
  ].filter(Boolean);
}

function plannerDuplicateAncestors(a, b) {
  const names = plannerVisibleFoalAncestors(a, b)
    .filter((n) => {
      const v = plannerNorm(n);
      return v && !['unbekannt','unknown','n/a','na','-'].includes(v);
    });
  const counts = new Map();
  for (const name of names) {
    const key = plannerNorm(name);
    const row = counts.get(key) || { name, count: 0 };
    row.count += 1;
    counts.set(key, row);
  }
  return [...counts.values()].filter((r) => r.count > 1);
}

function plannerGeneSummary(horse) {
  try {
    return presentGenesSummary(
      horse?.colors,
      horse?.coat_color,
      horse?.notes,
      horse?.name,
      null,
      horse?.color_gene_overrides
    ) || [];
  } catch {
    return [];
  }
}

function plannerHasOvero(horse) {
  return plannerGeneSummary(horse).some((g) =>
    plannerNorm(g.locus) === 'overo' && /O/.test(String(g.alleles || ''))
  );
}

function plannerDiseaseState(horse, code) {
  const override = horse?.disease_gene_overrides?.[code];
  if (override === 'absent') return 'clear';
  if (override === 'het') return 'carrier';
  if (override === 'hom') return 'affected';

  const row = (horse?.genetic_diseases || []).find((d) => d.label === code);
  if (!row || isUntestedLocusValue(row.value)) return 'unknown';

  const cleaned = String(row.value || '').replace(/[\s/|_-]/g, '');
  if (!cleaned) return 'unknown';
  if (/^N+$/.test(cleaned)) return 'clear';

  const hasN = cleaned.includes('N');
  const hasOther = [...cleaned].some((c) => c !== 'N');
  if (hasN && hasOther) return 'carrier';
  if (hasOther) return 'affected';
  return 'unknown';
}

function plannerDiseaseCodes(horse) {
  const out = new Set(typeof KNOWN_DISEASE_CODES !== 'undefined' ? KNOWN_DISEASE_CODES : []);
  for (const d of horse?.genetic_diseases || []) out.add(d.label);
  Object.keys(horse?.disease_gene_overrides || {}).forEach((k) => out.add(k));
  return [...out];
}

function plannerSharedDiseaseRisks(a, b) {
  const codes = new Set([...plannerDiseaseCodes(a), ...plannerDiseaseCodes(b)]);
  const result = [];
  for (const code of codes) {
    const sa = plannerDiseaseState(a, code);
    const sb = plannerDiseaseState(b, code);
    const riskA = sa === 'carrier' || sa === 'affected';
    const riskB = sb === 'carrier' || sb === 'affected';
    if (riskA && riskB) result.push({ code, a: sa, b: sb });
  }
  return result;
}

function plannerAgeYears(birthdate) {
  if (!birthdate) return null;
  if (typeof gameAgeYearsMonths === 'function') {
    const age = gameAgeYearsMonths(birthdate);
    return age?.years ?? null;
  }
  return null;
}

function plannerBreedingEligible(horse) {
  if (horse?.breeding_allowed !== true) return false;
  const age = plannerAgeYears(horse.birthdate);
  if (age != null && age > 25) return false;
  return plannerGender(horse) === 'stute' || plannerGender(horse) === 'hengst';
}

function plannerStats(horse) {
  const gpRaw = horse?.tournament_potential?.['Gesamtpotenzial'];
  return {
    gp: gpRaw != null && gpRaw !== '' ? Number(gpRaw) : null,
    ext: typeof averageScore === 'function'
      ? averageScore(horse?.exterior_descriptive, scoreExteriorTerm)
      : null,
    extpct: horse?.exterior_genetics?.overall?.percent ?? null,
    int: typeof averageScore === 'function'
      ? averageScore(horse?.temperament, scoreTemperamentTerm)
      : null,
  };
}

function plannerMean(a, b) {
  return a == null || b == null || Number.isNaN(a) || Number.isNaN(b) ? null : (a + b) / 2;
}

function plannerFoalEstimate(a, b) {
  const sa = plannerStats(a);
  const sb = plannerStats(b);
  return {
    gp: plannerMean(sa.gp, sb.gp),
    ext: plannerMean(sa.ext, sb.ext),
    extpct: plannerMean(sa.extpct, sb.extpct),
    int: plannerMean(sa.int, sb.int),
  };
}

function plannerMetricQuality(value, key) {
  if (value == null || Number.isNaN(value)) return 0.5;
  if (key === 'gp') return Math.max(0, Math.min(1, value / 1000));
  if (key === 'extpct') return Math.max(0, Math.min(1, value / 100));
  if (key === 'ext' || key === 'int') return Math.max(0, Math.min(1, (5 - value) / 4));
  return 0.5;
}

function plannerMetricLabel(key) {
  return ({ gp: 'GP', ext: 'Ext', extpct: 'Ext%', int: 'Int' })[key] || key;
}

function plannerMetricFormat(value, key) {
  if (value == null || Number.isNaN(value)) return '–';
  if (key === 'gp') return String(Math.round(value));
  if (key === 'extpct') return `${Number(value).toFixed(1)}%`;
  return Number(value).toFixed(2);
}

function plannerHorseValues(horse) {
  const out = new Map();

  for (const groups of [horse?.disciplines || {}, horse?.traits || {}]) {
    for (const entries of Object.values(groups)) {
      for (const e of entries || []) {
        out.set(plannerNorm(e.name), {
          name: e.name,
          current: e.current == null ? null : Number(e.current),
          potential: e.potential == null ? null : Number(e.potential),
        });
      }
    }
  }
  return out;
}

function plannerTemperamentMap(horse) {
  const out = new Map();
  for (const row of horse?.temperament || []) {
    out.set(plannerNorm(row.label), row.value);
  }
  return out;
}

function plannerLKFromPotential(minPotential) {
  if (minPotential == null || Number.isNaN(minPotential)) return null;
  if (minPotential >= 90) return 'LK1';
  if (minPotential >= 80) return 'LK2';
  if (minPotential >= 70) return 'LK3';
  if (minPotential >= 60) return 'LK4';
  if (minPotential >= 50) return 'LK5';
  if (minPotential >= 40) return 'LK6';
  if (minPotential >= 30) return 'LK7';
  if (minPotential >= 20) return 'LK8';
  if (minPotential >= 10) return 'LK9';
  return 'LK10';
}

function plannerLKRank(lk) {
  if (!lk) return 99;
  const n = Number(String(lk).replace('LK', ''));
  return Number.isFinite(n) ? n : 99;
}

function plannerTournamentEvaluation(horse, disciplineName) {
  const def = MDR_TOURNAMENT_DISCIPLINES[disciplineName];
  if (!def) return null;

  const values = plannerHorseValues(horse);
  const perfRows = def.performance.map((name) => {
    const row = values.get(plannerNorm(name));
    return {
      name,
      current: row?.current ?? null,
      potential: row?.potential ?? null,
    };
  });

  const knownPotential = perfRows.filter((r) => r.potential != null);
  const minPotential = knownPotential.length === perfRows.length
    ? Math.min(...knownPotential.map((r) => r.potential))
    : null;
  const avgPotential = knownPotential.length
    ? knownPotential.reduce((a, r) => a + r.potential, 0) / knownPotential.length
    : null;

  const knownCurrent = perfRows.filter((r) => r.current != null);
  const minCurrent = knownCurrent.length === perfRows.length
    ? Math.min(...knownCurrent.map((r) => r.current))
    : null;
  const avgCurrent = knownCurrent.length
    ? knownCurrent.reduce((a, r) => a + r.current, 0) / knownCurrent.length
    : null;

  const temperament = plannerTemperamentMap(horse);
  const interiorRows = def.interior.map((name) => ({
    name,
    value: temperament.get(plannerNorm(name)) ?? null,
  }));
  const scoredInterior = interiorRows
    .map((r) => typeof scoreTemperamentTerm === 'function' ? scoreTemperamentTerm(r.value) : null)
    .filter((v) => v != null && !Number.isNaN(v));
  const interiorAvg = scoredInterior.length
    ? scoredInterior.reduce((a, b) => a + b, 0) / scoredInterior.length
    : null;

  return {
    name: disciplineName,
    group: def.group,
    performance: perfRows,
    interior: interiorRows,
    minPotential,
    avgPotential,
    minCurrent,
    avgCurrent,
    lk: plannerLKFromPotential(minPotential),
    interiorAvg,
    completePotential: knownPotential.length === perfRows.length,
  };
}

function plannerAllTournamentEvaluations(horse) {
  return Object.keys(MDR_TOURNAMENT_DISCIPLINES)
    .map((name) => plannerTournamentEvaluation(horse, name))
    .filter(Boolean);
}

function plannerBestTournament(horse) {
  const rows = plannerAllTournamentEvaluations(horse)
    .filter((r) => r.lk)
    .sort((a, b) => {
      const lk = plannerLKRank(a.lk) - plannerLKRank(b.lk);
      if (lk) return lk;
      return (b.minPotential ?? -1) - (a.minPotential ?? -1);
    });
  return rows[0] || null;
}

function plannerHasActiveDiseaseRisk(horse) {
  return plannerDiseaseCodes(horse).some((code) => {
    const s = plannerDiseaseState(horse, code);
    return s === 'affected';
  });
}

function plannerMissingCoreData(horse) {
  const missing = [];
  if (!horse?.name) missing.push('Name');
  if (!horse?.gender) missing.push('Geschlecht');
  if (!horse?.breed) missing.push('Rasse');
  const s = plannerStats(horse);
  if (s.gp == null) missing.push('GP');
  if (s.ext == null) missing.push('Ext');
  if (s.extpct == null) missing.push('Ext%');
  if (s.int == null) missing.push('Int');
  if (!plannerPedigreeNames(horse).length) missing.push('Stammbaum');
  return missing;
}


// --- V53: gemeinsame Turniergruppen, Cup-Status und Begabungsvererbung ---
const MDR_TOURNAMENT_GROUP_ORDER = ['Englisch','Rennen','Western','Rodeo','Fahren','Barock','Mehrgang'];
const MDR_TOURNAMENT_GROUPS = Object.fromEntries(
  MDR_TOURNAMENT_GROUP_ORDER.map(group => [
    group,
    Object.keys(MDR_TOURNAMENT_DISCIPLINES).filter(name => MDR_TOURNAMENT_DISCIPLINES[name].group === group),
  ])
);
const MDR_TOURNAMENT_BASICS = ['Wendigkeit','Gelassenheit','Kraft','Tempo','Beschleunigung','Kondition','Präzision','Ausdruck'];
const MDR_TOURNAMENT_GAITS = ['Schritt','Trab','Galopp','Renngalopp','Tölt','Pass','Foxtrott','Rack'];

function plannerNormalizeDisciplineName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (typeof EN_TO_INTERNAL_EXACT !== 'undefined' && EN_TO_INTERNAL_EXACT[raw]) return EN_TO_INTERNAL_EXACT[raw];
  return raw;
}

function plannerHorseTalent(horse) {
  return plannerNormalizeDisciplineName(horse?.tournament_potential?.['Begabung']);
}

function plannerHorseMainGroup(horse) {
  const talent = plannerHorseTalent(horse);
  return MDR_TOURNAMENT_DISCIPLINES[talent]?.group || null;
}

function plannerTournamentResults(horse) {
  const raw = horse?.tournament_results;
  const out = {};

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [discipline, value] of Object.entries(raw)) {
      const normalized = plannerNormalizeDisciplineName(discipline);
      if (!MDR_TOURNAMENT_DISCIPLINES[normalized]) continue;
      const row = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      const first = Math.max(0, Math.floor(Number(row.first || 0)));
      const second = Math.max(0, Math.floor(Number(row.second || 0)));
      const third = Math.max(0, Math.floor(Number(row.third || 0)));
      const cupStar = row.cup_star === true;
      const cupLk = /^LK(?:10|[1-9])$/.test(String(row.cup_lk || '')) ? String(row.cup_lk) : '';
      if (first || second || third || cupStar || cupLk) {
        out[normalized] = { first, second, third, cup_star: cupStar, cup_lk: cupLk };
      }
    }
  }

  // V53-Kompatibilität: ältere Cup-Erfassung bestand nur aus Siegen je
  // Disziplin. Diese Werte werden als 1. Plätze übernommen; zusammen mit
  // mindestens 50 Gesamtstarts greift anschließend ebenfalls die automatische
  // 15-Siege-Cupstern-Regel.
  const legacy = horse?.cup_results;
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    for (const [discipline, wins] of Object.entries(legacy)) {
      const normalized = plannerNormalizeDisciplineName(discipline);
      const n = Math.max(0, Math.floor(Number(wins || 0)));
      if (!MDR_TOURNAMENT_DISCIPLINES[normalized] || !n) continue;
      if (!out[normalized]) out[normalized] = { first:n, second:0, third:0, cup_star:false, cup_lk:'' };
      else out[normalized].first = Math.max(out[normalized].first || 0, n);
    }
  }

  // V54.0.15: Cupsterne werden aus den bekannten MDR-Grundkriterien
  // automatisch abgeleitet. Eine explizit ausgelesene Cup-Qualifikation
  // bleibt ebenfalls Cupstern; die Cup-LK wird nur übernommen, wenn sie
  // tatsächlich im Datensatz vorhanden ist.
  const starts = plannerTournamentStarts(horse);
  if (starts != null && starts >= 50) {
    for (const [discipline,row] of Object.entries(out)) {
      if (Number(row.first || 0) < 15) continue;
      row.cup_star = true;
      // Derselbe LK-Fallback, der bisher erst beim Bestätigungs-Klick
      // gesetzt wurde: wenn MDR keine Cup-LK mitliefert, ist die aus den
      // sieben Potenzialwerten berechnete LK die automatische Vorgabe.
      if (!row.cup_lk) row.cup_lk = plannerTournamentEvaluation(horse, discipline)?.lk || '';
    }
  }

  return out;
}

function plannerCupResults(horse) {
  return Object.fromEntries(
    Object.entries(plannerTournamentResults(horse)).map(([discipline,row]) => [discipline, Number(row.first || 0)])
  );
}

function plannerCupStarRows(horse) {
  return Object.entries(plannerTournamentResults(horse))
    .filter(([,row]) => row.cup_star === true)
    .map(([discipline,row]) => ({discipline, lk:row.cup_lk || ''}))
    .sort((a,b)=>a.discipline.localeCompare(b.discipline,'de'));
}

function plannerCupStarDisciplines(horse) {
  return plannerCupStarRows(horse).map(row => row.discipline);
}

function plannerTournamentStarts(horse) {
  const n = Number(horse?.tournament_starts_total);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function plannerTournamentPlacements(horse) {
  const rows = Object.values(plannerTournamentResults(horse));
  return rows.reduce((sum,row) => sum + Number(row.first || 0) + Number(row.second || 0) + Number(row.third || 0), 0);
}

function plannerTournamentShowBonusRaw(horse) {
  const rows = Object.values(plannerTournamentResults(horse));
  return rows.reduce((sum,row) => (
    sum + Number(row.first || 0) * 35 + Number(row.second || 0) * 25 + Number(row.third || 0) * 15
  ), 0);
}

function plannerTournamentShowBonus(horse) {
  return Math.min(500, plannerTournamentShowBonusRaw(horse));
}

function plannerCupShowBonus(horse) {
  return plannerCupStarRows(horse).length * 100;
}

function plannerBreedingShowPoints(horse) {
  const raw=horse?.breeding_show_points;
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const n = Number(raw);
  // V54.0.18: 0 bedeutet in älteren Datensätzen „kein ZS-Wert mehr
  // abrufbar“ und ist keine echte Zuchtschau-Punktangabe. Nur positive
  // Gesamtpunkte dürfen für ZS-Auswertung und Lernmodell verwendet werden.
  return Number.isFinite(n) && n > 0 ? n : null;
}

function plannerBreedingShowBase(horse) {
  const total = plannerBreedingShowPoints(horse);
  if (total == null) return null;
  return total - plannerTournamentShowBonus(horse) - plannerCupShowBonus(horse);
}

function plannerCupProgress(horse, discipline) {
  const row = plannerTournamentResults(horse)[discipline] || {first:0,second:0,third:0,cup_star:false,cup_lk:''};
  const starts = plannerTournamentStarts(horse);
  const wins = Number(row.first || 0);
  const startsOk = starts != null && starts >= 50;
  const winsOk = wins >= 15;
  return {
    ...row,
    wins,
    starts,
    startsOk,
    winsOk,
    requirementsReached: startsOk && winsOk,
    cupStar: row.cup_star === true,
  };
}

function plannerTalentNormName(value) {
  return String(value || '').trim().toLocaleLowerCase('de').replace(/\s+/g,' ');
}

function plannerTalentReferenceHorses(allHorses) {
  const source = Array.isArray(allHorses) && allHorses.length
    ? allHorses
    : (Array.isArray(globalThis?.MDR_TALENT_EMPIRICAL_HORSES) ? globalThis.MDR_TALENT_EMPIRICAL_HORSES : []);
  const seen = new Set();
  const out = [];
  for (const horse of source) {
    const ancestors = horse?.pedigree?.ancestors || [];
    const key = [horse?.external_id || '', plannerTalentNormName(horse?.name), ancestors.slice(0,2).map(a=>plannerTalentNormName(a?.name)).join('|')].join('||');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(horse);
  }
  return out;
}

function plannerTalentTrios(allHorses) {
  const horses = plannerTalentReferenceHorses(allHorses);
  const byName = new Map();
  for (const horse of horses) {
    const key = plannerTalentNormName(horse?.name);
    if (key && !byName.has(key)) byName.set(key, horse);
  }
  const trios = [];
  for (const child of horses) {
    const ancestors = child?.pedigree?.ancestors || [];
    if (ancestors.length < 2) continue;
    const father = byName.get(plannerTalentNormName(ancestors[0]?.name));
    const mother = byName.get(plannerTalentNormName(ancestors[1]?.name));
    if (!father || !mother || !plannerHorseTalent(child)) continue;
    trios.push({child,father,mother});
  }
  return trios;
}

function plannerTalentPairKey(a,b) {
  return [plannerHorseTalent(a),plannerHorseTalent(b)].sort((x,y)=>x.localeCompare(y,'de')).join('|||');
}

function plannerTalentEmpiricalDistribution(mare,stallion,allHorses) {
  const a = plannerHorseTalent(mare);
  const b = plannerHorseTalent(stallion);
  if (!a || !b) return {n:0,rows:[]};
  const key = [a,b].sort((x,y)=>x.localeCompare(y,'de')).join('|||');
  const counts = new Map();
  let n=0;
  for (const trio of plannerTalentTrios(allHorses)) {
    if (plannerTalentPairKey(trio.father,trio.mother) !== key) continue;
    const talent = plannerHorseTalent(trio.child);
    if (!talent) continue;
    n++;
    counts.set(talent,(counts.get(talent)||0)+1);
  }
  return {
    n,
    rows:[...counts.entries()].map(([label,count])=>({label,count,p:n?count/n:0})).sort((x,y)=>y.p-x.p || x.label.localeCompare(y.label,'de'))
  };
}

function plannerTalentWishProjection(mare,stallion,wish,allHorses) {
  if (!wish) return null;
  const normalized = plannerNormalizeDisciplineName(wish);
  const empirical = plannerTalentEmpiricalDistribution(mare,stallion,allHorses);
  const row = empirical.rows.find(r => r.label === normalized);
  if (empirical.n) return {score:row?.p || 0, probability:row?.p || 0, n:empirical.n, source:'empirisch', rows:empirical.rows};

  const a=plannerHorseTalent(mare), b=plannerHorseTalent(stallion);
  const matches=(a===normalized?1:0)+(b===normalized?1:0);
  const score=matches===2 ? .75 : matches===1 ? .45 : .10;
  return {score,probability:null,n:0,source:'Eltern-Tendenz',rows:[]};
}


// ---------------------------------------------------------------------
// V54.0.22 – gemeinsame ZS-Prognose für Turnierplaner und Pferdeansicht
// ---------------------------------------------------------------------
function plannerIsFoal(horse) {
  // Im gespeicherten MDR-Datensatz steht bei jungen Pferden häufig bereits
  // "Stute" bzw. "Hengst" statt "Stutfohlen/Hengstfohlen". Deshalb
  // darf der Fohlenstatus nicht vom Geschlechtstext abhängen. Die App
  // behandelt Pferde bis zum Bild-/Alterswechsel mit 3 Spieljahren als Fohlen.
  if (horse?.birthdate && typeof gameAgeYears === 'function') {
    const years = gameAgeYears(horse.birthdate);
    if (years != null) return years < 3;
  }
  // Fallback für Alt-/Importdaten ohne verwertbares Geburtsdatum.
  const gender = plannerNorm(horse?.gender);
  return /fohlen|foal|colt|filly/.test(gender);
}

function plannerBreedingShowDiseaseValue(horse) {
  // Nicht getestete/unklare EKH-Daten dürfen nicht still als "unauffällig"
  // in das Modell eingehen. Ein sicher betroffener Status hat Vorrang.
  if (plannerHasActiveDiseaseRisk(horse)) return 1;
  if (horse?.disease_free === true) return 0;
  const states=plannerDiseaseCodes(horse).map(code=>plannerDiseaseState(horse,code));
  if (states.length && states.every(state=>state !== 'unknown' && state !== 'affected')) return 0;
  return null;
}

function plannerBreedingShowFeatureObject(horse) {
  const stats = plannerStats(horse);
  const raw = {gp:stats.gp, ext:stats.ext, extpct:stats.extpct, int:stats.int};
  // Number(null) wäre 0 und würde fehlende Grundwerte fälschlich als echte
  // Nullwerte in Lernmodell/Prognose einschleusen. Erst auf Leerwerte prüfen.
  if (Object.values(raw).some(value => value == null || value === '' || !Number.isFinite(Number(value)))) return null;
  return {
    gp: Number(raw.gp),
    ext: Number(raw.ext),
    extpct: Number(raw.extpct),
    int: Number(raw.int),
    disease: plannerBreedingShowDiseaseValue(horse),
  };
}

function plannerBreedingShowTrainingStatus(horse) {
  const total = plannerBreedingShowPoints(horse);
  if (total == null) return {eligible:false, reason:'no-zs'};
  const x = plannerBreedingShowFeatureObject(horse);
  if (!x) return {eligible:false, reason:'missing-features'};
  // Nur echte ZS-Datensätze brauchen Turnierplatzierungen: der Turnierbonus
  // muss für den Lern-Grundwert zuverlässig vom ZS-Gesamtwert abziehbar sein.
  if (plannerTournamentPlacements(horse) < 1) return {eligible:false, reason:'missing-tournament'};
  const y = plannerBreedingShowBase(horse);
  if (y == null || !Number.isFinite(y) || y < 0) return {eligible:false, reason:'invalid-base'};
  return {eligible:true, y, x};
}

function plannerBreedingShowSolveLinear(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col=0; col<n; col++) {
    let pivot = col;
    for (let r=col+1; r<n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-10) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const div = M[col][col];
    for (let c=col; c<=n; c++) M[col][c] /= div;
    for (let r=0; r<n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let c=col; c<=n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map(row => row[n]);
}

function plannerBreedingShowFitRidge(rows, featureKeys, lambda) {
  if (!rows.length || !featureKeys.length) return null;
  const means = featureKeys.map(key => rows.reduce((sum,row) => sum + row.x[key], 0) / rows.length);
  const stds = featureKeys.map((key,j) => {
    const variance = rows.reduce((sum,row) => sum + (row.x[key] - means[j]) ** 2, 0) / rows.length;
    return Math.sqrt(variance) || 1;
  });
  const X = rows.map(row => [1, ...featureKeys.map((key,j) => (row.x[key] - means[j]) / stds[j])]);
  const y = rows.map(row => row.y);
  const m = featureKeys.length + 1;
  const xtx = Array.from({length:m}, () => Array(m).fill(0));
  const xty = Array(m).fill(0);
  for (let r=0; r<X.length; r++) for (let i=0; i<m; i++) {
    xty[i] += X[r][i] * y[r];
    for (let j=0; j<m; j++) xtx[i][j] += X[r][i] * X[r][j];
  }
  for (let i=1; i<m; i++) xtx[i][i] += lambda;
  const beta = plannerBreedingShowSolveLinear(xtx, xty);
  if (!beta) return null;
  const rawCoefficients = featureKeys.map((key,j) => beta[j+1] / stds[j]);
  const rawIntercept = beta[0] - rawCoefficients.reduce((sum,c,j) => sum + c * means[j], 0);
  return {
    lambda, featureKeys, means, stds, beta, rawIntercept, rawCoefficients,
    predictX(x) {
      if (!x) return null;
      if (featureKeys.some(key => !Number.isFinite(Number(x[key])))) return null;
      return beta[0] + featureKeys.reduce((sum,key,j) => sum + beta[j+1] * ((x[key] - means[j]) / stds[j]), 0);
    },
  };
}

function plannerBreedingShowMetrics(actual, predicted) {
  if (!actual.length || actual.length !== predicted.length) return null;
  const errors = actual.map((y,i) => predicted[i] - y);
  const absoluteErrors = errors.map(e => Math.abs(e)).sort((a,b) => a-b);
  const mae = absoluteErrors.reduce((sum,e) => sum + e, 0) / absoluteErrors.length;
  const rmse = Math.sqrt(errors.reduce((sum,e) => sum + e * e, 0) / errors.length);
  const medianAe = absoluteErrors.length % 2
    ? absoluteErrors[(absoluteErrors.length-1)/2]
    : (absoluteErrors[absoluteErrors.length/2-1] + absoluteErrors[absoluteErrors.length/2]) / 2;
  const mean = actual.reduce((sum,v) => sum + v, 0) / actual.length;
  const sst = actual.reduce((sum,v) => sum + (v - mean) ** 2, 0);
  const sse = errors.reduce((sum,e) => sum + e * e, 0);
  const r2 = sst > 0 ? 1 - sse / sst : null;
  return {mae, rmse, medianAe, r2, n:actual.length};
}

function plannerBreedingShowCrossValidate(rows, featureKeys, lambda) {
  if (rows.length < 8) return null;
  const folds = Math.min(5, Math.max(2, Math.floor(rows.length / 4)));
  const actual = [], predicted = [], baselinePredicted = [];
  const ordered = [...rows].sort((a,b) => String(a.horse.id || a.horse.name || '').localeCompare(String(b.horse.id || b.horse.name || ''), 'de'));
  for (let fold=0; fold<folds; fold++) {
    const train = ordered.filter((_,i) => i % folds !== fold);
    const test = ordered.filter((_,i) => i % folds === fold);
    const fit = plannerBreedingShowFitRidge(train, featureKeys, lambda);
    if (!fit) return null;
    const trainingMean = train.reduce((sum,row) => sum + row.y, 0) / Math.max(1, train.length);
    for (const row of test) {
      const pred = fit.predictX(row.x);
      if (pred == null || !Number.isFinite(pred)) continue;
      actual.push(row.y);
      predicted.push(pred);
      baselinePredicted.push(trainingMean);
    }
  }
  const metrics = plannerBreedingShowMetrics(actual, predicted);
  const baseline = plannerBreedingShowMetrics(actual, baselinePredicted);
  if (!metrics) return null;
  const improvementRmsePct = baseline?.rmse > 0 ? ((baseline.rmse - metrics.rmse) / baseline.rmse) * 100 : null;
  const improvementMaePct = baseline?.mae > 0 ? ((baseline.mae - metrics.mae) / baseline.mae) * 100 : null;
  return {...metrics, baseline, improvementRmsePct, improvementMaePct};
}

function plannerBuildBreedingShowModel(allHorses) {
  const training = [];
  const exclusions = {noZs:0, missingFeatures:0, missingTournament:0, invalidBase:0};
  for (const horse of Array.isArray(allHorses) ? allHorses : []) {
    const status = plannerBreedingShowTrainingStatus(horse);
    if (status.eligible) training.push({horse, y:status.y, x:status.x});
    else if (status.reason === 'no-zs') exclusions.noZs++;
    else if (status.reason === 'missing-features') exclusions.missingFeatures++;
    else if (status.reason === 'missing-tournament') exclusions.missingTournament++;
    else if (status.reason === 'invalid-base') exclusions.invalidBase++;
  }

  const featureKeys = ['gp','ext','extpct','int'];
  const risky = training.filter(row => row.x.disease === 1).length;
  const clear = training.filter(row => row.x.disease === 0).length;
  const unknownDisease = training.length - risky - clear;
  // EKH bleibt ein optionaler Koeffizient. Nur wenn der Status in der
  // gesamten Modellstichprobe bekannt und beide Gruppen ausreichend gross
  // sind, wird er zugeschaltet; sonst bleiben alle Kern-Lerndaten erhalten.
  if (risky >= 3 && clear >= 3 && unknownDisease === 0) featureKeys.push('disease');
  const featureInfo = {keys:featureKeys, risky, clear, unknownDisease};
  const base = {
    n: training.length,
    training,
    exclusions,
    featureInfo,
    predict: () => null,
    coefficients: null,
    diagnostics: null,
  };
  if (training.length < 8) return base;

  const lambdas = [0.03,0.1,0.3,1,3,10,30,100];
  let best = null;
  for (const lambda of lambdas) {
    const metrics = plannerBreedingShowCrossValidate(training, featureKeys, lambda);
    if (!metrics) continue;
    const candidate = {lambda, metrics};
    if (!best || metrics.rmse < best.metrics.rmse - 1e-9 || (Math.abs(metrics.rmse - best.metrics.rmse) < 1e-9 && lambda > best.lambda)) best = candidate;
  }
  const chosen = best?.lambda ?? 0.3;
  const fit = plannerBreedingShowFitRidge(training, featureKeys, chosen);
  if (!fit) return base;
  const trainActual = training.map(row => row.y);
  const trainPred = training.map(row => fit.predictX(row.x));
  const trainMetrics = plannerBreedingShowMetrics(trainActual, trainPred);

  return {
    ...base,
    lambda: chosen,
    fit,
    coefficients: fit.rawCoefficients,
    intercept: fit.rawIntercept,
    diagnostics: {cv:best?.metrics || null, train:trainMetrics},
    predict(horse) {
      const x = plannerBreedingShowFeatureObject(horse);
      if (!x) return null;
      return fit.predictX(x);
    },
  };
}
