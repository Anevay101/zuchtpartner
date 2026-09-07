
const TURNIERZUCHT_DISCIPLINES = {
  'Dressur': { group: 'Englisch', interior: ['Gelehrigkeit', 'Aufmerksamkeit', 'Intelligenz'] },
  'Springen': { group: 'Englisch', interior: ['Furchtlosigkeit', 'Leistungsbereitschaft', 'Temperament'] },
  'Cross Country': { group: 'Englisch', interior: ['Nervenstärke', 'Aufmerksamkeit', 'Leistungsbereitschaft'] },
  'Distanz': { group: 'Englisch', interior: ['Gutmütigkeit', 'Nervenstärke', 'Temperament'] },

  'Flachrennen': { group: 'Rennen', interior: ['Siegeswille', 'Leistungsbereitschaft', 'Temperament'] },
  'Hindernisrennen': { group: 'Rennen', interior: ['Siegeswille', 'Nervenstärke', 'Aufmerksamkeit'] },
  'Seejagdrennen': { group: 'Rennen', interior: ['Siegeswille', 'Nervenstärke', 'Furchtlosigkeit'] },
  'Trabrennen': { group: 'Rennen', interior: ['Temperament', 'Siegeswille', 'Leistungsbereitschaft'] },

  'Reining': { group: 'Western', interior: ['Temperament', 'Leistungsbereitschaft', 'Intelligenz'] },
  'Trail': { group: 'Western', interior: ['Aufmerksamkeit', 'Gelehrigkeit', 'Intelligenz'] },
  'Pleasure': { group: 'Western', interior: ['Sozialverhalten', 'Gutmütigkeit', 'Gelehrigkeit'] },
  'Horsemanship': { group: 'Western', interior: ['Gutmütigkeit', 'Gelehrigkeit', 'Intelligenz'] },

  'Cutting': { group: 'Rodeo', interior: ['Furchtlosigkeit', 'Nervenstärke', 'Intelligenz'] },
  'Roping': { group: 'Rodeo', interior: ['Aufmerksamkeit', 'Furchtlosigkeit', 'Nervenstärke'] },
  'Pole Bending': { group: 'Rodeo', interior: ['Leistungsbereitschaft', 'Siegeswille', 'Temperament'] },
  'Barrel Racing': { group: 'Rodeo', interior: ['Leistungsbereitschaft', 'Siegeswille', 'Temperament'] },

  'Dressurfahren': { group: 'Fahren', interior: ['Sozialverhalten', 'Gelehrigkeit', 'Intelligenz'] },
  'Hindernisfahren': { group: 'Fahren', interior: ['Sozialverhalten', 'Aufmerksamkeit', 'Furchtlosigkeit'] },
  'Geländefahren': { group: 'Fahren', interior: ['Sozialverhalten', 'Nervenstärke', 'Furchtlosigkeit'] },
  'Holzrücken': { group: 'Fahren', interior: ['Nervenstärke', 'Furchtlosigkeit', 'Gutmütigkeit'] },

  'Klassische Dressur': { group: 'Barock', interior: ['Gelehrigkeit', 'Aufmerksamkeit', 'Intelligenz'] },
  'Spanische Gänge': { group: 'Barock', interior: ['Gutmütigkeit', 'Aufmerksamkeit', 'Intelligenz'] },
  'Schulsprünge': { group: 'Barock', interior: ['Temperament', 'Leistungsbereitschaft', 'Nervenstärke'] },
  'Hohe Schule': { group: 'Barock', interior: ['Gelehrigkeit', 'Leistungsbereitschaft', 'Intelligenz'] },

  'Tölt-Prüfung': { group: 'Mehrgang', interior: ['Gutmütigkeit', 'Sozialverhalten', 'Aufmerksamkeit'] },
  'Passrennen': { group: 'Mehrgang', interior: ['Sozialverhalten', 'Siegeswille', 'Temperament'] },
  'Foxtrott Pleasure': { group: 'Mehrgang', interior: ['Gutmütigkeit', 'Sozialverhalten', 'Gelehrigkeit'] },
  'Racking': { group: 'Mehrgang', interior: ['Gutmütigkeit', 'Sozialverhalten', 'Gelehrigkeit'] },
};

const TURNIERZUCHT_ALL_INTERIOR = [
  'Temperament', 'Intelligenz', 'Gelehrigkeit', 'Leistungsbereitschaft',
  'Aufmerksamkeit', 'Gutmütigkeit', 'Nervenstärke', 'Furchtlosigkeit',
  'Siegeswille', 'Sozialverhalten',
];

function turnierzuchtNormalizeDiscipline(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // EN-Pferde können in älteren gespeicherten Datensätzen die Begabung
  // noch auf Englisch tragen, obwohl die Disziplin-Gruppen bereits auf
  // interne deutsche Schlüssel normalisiert sind.
  if (typeof EN_TO_INTERNAL_EXACT !== 'undefined' && EN_TO_INTERNAL_EXACT[raw]) {
    return EN_TO_INTERNAL_EXACT[raw];
  }
  return raw;
}

function turnierzuchtMainGroup(horse) {
  const begabungRaw = horse?.tournament_potential?.['Begabung'];
  const begabung = turnierzuchtNormalizeDiscipline(begabungRaw);

  if (typeof findDisciplineCategory === 'function') {
    const group = findDisciplineCategory(horse?.disciplines, begabung);
    if (group) return group;
  }

  const direct = TURNIERZUCHT_DISCIPLINES[begabung];
  if (direct?.group) return direct.group;

  const groups = new Set(Object.values(TURNIERZUCHT_DISCIPLINES).map((d) => d.group));
  return groups.has(begabung) ? begabung : null;
}

function turnierzuchtWeights(mode, horse, specificDiscipline) {
  const weights = new Map(TURNIERZUCHT_ALL_INTERIOR.map((name) => [name, 1]));
  let label = 'Aus';
  let priority = new Set();

  if (mode === 'main') {
    const group = turnierzuchtMainGroup(horse);
    if (!group) return { weights, priority, label: 'Hauptdisziplin unbekannt', group: null };

    const defs = Object.values(TURNIERZUCHT_DISCIPLINES).filter((d) => d.group === group);
    const counts = new Map();
    for (const def of defs) {
      for (const name of def.interior) counts.set(name, (counts.get(name) || 0) + 1);
    }
    priority = new Set(counts.keys());
    for (const [name, count] of counts) weights.set(name, 1 + count);
    label = group;
    return { weights, priority, label, group };
  }

  if (mode === 'specific') {
    const def = TURNIERZUCHT_DISCIPLINES[specificDiscipline];
    if (!def) return { weights, priority, label: 'Disziplin unbekannt', group: null };
    priority = new Set(def.interior);
    for (const name of def.interior) weights.set(name, 5);
    return { weights, priority, label: specificDiscipline, group: def.group };
  }

  return { weights, priority, label, group: null };
}

function turnierzuchtTemperamentMap(horse) {
  return new Map((horse?.temperament || []).map((r) => [r.label, r.value]));
}

function turnierzuchtCategoryLabel(score) {
  return ({1:'Exzellent',2:'Gut',3:'In Ordnung',4:'Schlecht',5:'Miserabel'})[score] || '–';
}

function turnierzuchtCategoryPoints(score) {
  // V53: Beitrag relativ zu "Gut". Gut ist bewusst der Nullpunkt.
  // Exzellent bringt Bonus, In Ordnung nur einen kleinen Malus;
  // Schlecht/Miserabel werden deutlich stärker abgewertet.
  return ({1:30,2:0,3:-10,4:-42,5:-68})[score] ?? null;
}


// V54.0.20: empirische Interieur-Lernbasis für Turnierzucht.
// Gemessen wird nicht ein erfundener H/h-Genotyp, sondern nur das, was bei
// echten Eltern–Fohlen-Trios mit demselben Eltern-Kategorienpaar für den
// jeweiligen Interieurwert tatsächlich aufgetreten ist.
let TURNIERZUCHT_EMPIRICAL_CACHE_SOURCE = null;
let TURNIERZUCHT_EMPIRICAL_CACHE = null;

function turnierzuchtEmpiricalReferenceHorses(allHorses = null) {
  if (Array.isArray(allHorses) && allHorses.length) return allHorses;
  const globalRows = typeof globalThis !== 'undefined'
    ? globalThis.MDR_INTERIOR_EMPIRICAL_HORSES
    : null;
  return Array.isArray(globalRows) ? globalRows : [];
}

function turnierzuchtEmpiricalIndex(allHorses = null) {
  const source = turnierzuchtEmpiricalReferenceHorses(allHorses);
  if (TURNIERZUCHT_EMPIRICAL_CACHE_SOURCE === source && TURNIERZUCHT_EMPIRICAL_CACHE) {
    return TURNIERZUCHT_EMPIRICAL_CACHE;
  }

  const unique = [];
  const seen = new Set();
  for (const horse of source) {
    const anc = typeof pedigreeAncestorNames === 'function' ? pedigreeAncestorNames(horse) : [];
    const key = [
      String(horse?.external_id || ''),
      typeof normalizeName === 'function' ? normalizeName(horse?.name) : String(horse?.name || '').trim().toLowerCase(),
      ...anc.slice(0,2).map(x => typeof normalizeName === 'function' ? normalizeName(x) : String(x || '').trim().toLowerCase()),
    ].join('||');
    if (!key.replace(/\|/g,'')) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(horse);
  }

  const byName = new Map();
  for (const horse of unique) {
    const key = typeof normalizeName === 'function' ? normalizeName(horse?.name) : String(horse?.name || '').trim().toLowerCase();
    if (key && !byName.has(key)) byName.set(key, horse);
  }

  const index = new Map();
  for (const child of unique) {
    const anc = typeof pedigreeAncestorNames === 'function' ? pedigreeAncestorNames(child) : [];
    const fatherName = anc?.[0];
    const motherName = anc?.[1];
    if (!fatherName || !motherName) continue;
    const father = byName.get(typeof normalizeName === 'function' ? normalizeName(fatherName) : String(fatherName).trim().toLowerCase());
    const mother = byName.get(typeof normalizeName === 'function' ? normalizeName(motherName) : String(motherName).trim().toLowerCase());
    if (!father || !mother) continue;

    const fatherMap = turnierzuchtTemperamentMap(father);
    const motherMap = turnierzuchtTemperamentMap(mother);
    const childMap = turnierzuchtTemperamentMap(child);

    for (const trait of TURNIERZUCHT_ALL_INTERIOR) {
      const a = scoreTemperamentTerm(fatherMap.get(trait));
      const b = scoreTemperamentTerm(motherMap.get(trait));
      const c = scoreTemperamentTerm(childMap.get(trait));
      if (a == null || b == null || c == null) continue;
      const lo = Math.min(a,b), hi = Math.max(a,b);
      const key = `${trait}|${lo}-${hi}`;
      if (!index.has(key)) index.set(key,{ trait, lo, hi, n:0, counts:[0,0,0,0,0,0] });
      const row = index.get(key);
      row.n++;
      row.counts[c] = (row.counts[c] || 0) + 1;
    }
  }

  TURNIERZUCHT_EMPIRICAL_CACHE_SOURCE = source;
  TURNIERZUCHT_EMPIRICAL_CACHE = index;
  return index;
}

function turnierzuchtEmpiricalTraitStats(mare, stallion, traitName, projection = null, allHorses = null) {
  const mareMap = turnierzuchtTemperamentMap(mare);
  const stallionMap = turnierzuchtTemperamentMap(stallion);
  const a = scoreTemperamentTerm(mareMap.get(traitName));
  const b = scoreTemperamentTerm(stallionMap.get(traitName));
  if (a == null || b == null) return null;
  const lo = Math.min(a,b), hi = Math.max(a,b);
  const row = turnierzuchtEmpiricalIndex(allHorses).get(`${traitName}|${lo}-${hi}`);
  if (!row?.n) return { n:0, lo, hi, counts:[0,0,0,0,0,0], distribution:[] };

  const distribution = [1,2,3,4,5]
    .map(score => ({ score, count:row.counts[score] || 0, p:(row.counts[score] || 0)/row.n }))
    .filter(x => x.count > 0);
  const average = distribution.reduce((sum,x)=>sum+x.score*x.count,0)/row.n;
  const best = projection?.best ?? null;
  const worst = projection?.worst ?? null;
  const low = best == null || worst == null ? null : Math.min(best,worst);
  const high = best == null || worst == null ? null : Math.max(best,worst);
  const within = low == null ? null : distribution
    .filter(x=>x.score>=low && x.score<=high)
    .reduce((sum,x)=>sum+x.count,0);

  return {
    n:row.n, lo, hi, counts:[...row.counts], distribution, average,
    withinProjected: within,
    withinProjectedPct: within == null ? null : within/row.n,
  };
}

function turnierzuchtTraitProjection(mare, stallion, traitName) {
  const mareMap = turnierzuchtTemperamentMap(mare);
  const stallionMap = turnierzuchtTemperamentMap(stallion);
  const a = scoreTemperamentTerm(mareMap.get(traitName));
  const b = scoreTemperamentTerm(stallionMap.get(traitName));
  if (a == null || b == null) return null;

  const range = interieurBestWorstForTrait(a, b);
  const bestPts = turnierzuchtCategoryPoints(range.best);
  const worstPts = turnierzuchtCategoryPoints(range.worst);

  return {
    trait: traitName,
    mareScore: a,
    stallionScore: b,
    best: range.best,
    worst: range.worst,
    quality: bestPts * 0.4 + worstPts * 0.6,
  };
}

function turnierzuchtEvaluate(mare, stallion, mode, specificDiscipline, mainHorse = mare) {
  const setup = turnierzuchtWeights(mode, mainHorse, specificDiscipline);
  if (mode === 'off') return { active:false, score:null, rating:'Aus', label:'Aus', rows:[], weakPriority:[], weakOther:[] };

  const rows = [];
  let weighted = 0;
  let totalWeight = 0;

  for (const trait of TURNIERZUCHT_ALL_INTERIOR) {
    const projection = turnierzuchtTraitProjection(mare, stallion, trait);
    if (!projection) continue;

    const weight = setup.weights.get(trait) || 1;
    const isPriority = setup.priority.has(trait);
    const target = isPriority ? 1 : 3;

    const empirical = isPriority
      ? turnierzuchtEmpiricalTraitStats(mare, stallion, trait, projection)
      : null;

    rows.push({
      ...projection,
      weight,
      isPriority,
      target,
      empirical,
      meetsBestTarget: projection.best <= target,
      meetsWorstTarget: projection.worst <= target,
    });

    weighted += projection.quality * weight;
    totalWeight += weight;
  }

  // 70/100 ist die neutrale Basis (= relevante Werte etwa Gut).
  // Dadurch ist die gewünschte Semantik direkt im Ranking sichtbar:
  // Exzellent hebt an, In Ordnung senkt nur leicht, darunter fällt der
  // Score deutlich. Mehrere Exzellent-Werte können ein einzelnes
  // "In Ordnung" problemlos überwiegen.
  let score = totalWeight ? 70 + (weighted / totalWeight) : null;
  const weakOther = rows.filter((r) => !r.isPriority && r.worst > 3);
  const weakPriority = rows.filter((r) => r.isPriority && r.worst > 3);
  const excellentPriority = rows.filter((r) => r.isPriority && r.best === 1);
  const guaranteedExcellentPriority = rows.filter((r) => r.isPriority && r.worst === 1);

  if (score != null) score = Math.max(0, Math.min(100, score));

  let rating = 'nicht berechenbar';
  if (score != null) {
    if (score >= 84) rating = 'sehr gut';
    else if (score >= 70) rating = 'gut';
    else if (score >= 55) rating = 'mittel';
    else rating = 'schwach';
  }

  return {
    active:true,
    score,
    rating,
    label:setup.label,
    group:setup.group,
    rows,
    weakPriority,
    weakOther,
    excellentPriority,
    guaranteedExcellentPriority,
  };
}

function turnierzuchtRankValue(result) {
  return (!result?.active || result.score == null) ? -1 : result.score;
}
