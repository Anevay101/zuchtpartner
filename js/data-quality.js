
const DQ_DISCIPLINES = [
  'Dressur','Springen','Cross Country','Distanz',
  'Flachrennen','Hindernisrennen','Seejagdrennen','Trabrennen',
  'Reining','Trail','Pleasure','Horsemanship',
  'Cutting','Roping','Pole Bending','Barrel Racing',
  'Dressurfahren','Hindernisfahren','Geländefahren','Holzrücken',
  'Klassische Dressur','Spanische Gänge','Schulsprünge','Hohe Schule',
  'Tölt-Prüfung','Passrennen','Foxtrott Pleasure','Racking'
];
const DQ_TRAITS = ['Wendigkeit','Gelassenheit','Kraft','Tempo','Beschleunigung','Kondition','Präzision','Ausdruck'];
const DQ_GAITS = ['Schritt','Trab','Galopp','Renngalopp','Foxtrott','Rack','Tölt','Pass'];
const DQ_INTERIOR = [
  'Temperament','Intelligenz','Gelehrigkeit','Leistungsbereitschaft',
  'Aufmerksamkeit','Gutmütigkeit','Nervenstärke','Furchtlosigkeit',
  'Siegeswille','Sozialverhalten'
];

function dqNorm(v) {
  return String(v || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function dqNames(horse) {
  const set = new Set();
  for (const src of [horse?.disciplines || {}, horse?.traits || {}]) {
    for (const rows of Object.values(src)) {
      for (const row of rows || []) if (row?.name) set.add(dqNorm(row.name));
    }
  }
  return set;
}

function dqPedigreeNames(pedigree) {
  const found = [];
  const walk = (value, key = '') => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach(v => walk(v, key));
      return;
    }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([k,v]) => walk(v, k));
      return;
    }
    if (
      typeof value === 'string' &&
      /(name|father|mother|sire|dam|vater|mutter|ancestor)/i.test(key) &&
      value.trim() &&
      !/^(unbekannt|unknown)$/i.test(value.trim())
    ) found.push(value.trim());
  };
  walk(pedigree || {});
  return new Set(found);
}

function analyzeHorseDataQuality(horse) {
  const names = dqNames(horse);
  const interiors = new Set((horse?.temperament || []).map(r => dqNorm(r.label)));
  const count = (arr, set) => arr.filter(x => set.has(dqNorm(x))).length;

  const disciplines = count(DQ_DISCIPLINES, names);
  const traits = count(DQ_TRAITS, names);
  const gaits = count(DQ_GAITS, names);
  const interior = count(DQ_INTERIOR, interiors);

  const geneticRows = horse?.exterior_genetics?.rows || [];
  const hasExteriorGenetics = geneticRows.length >= 10 || !!horse?.exterior_genetics?.overall;
  const hasColorGenetics = !!horse?.colors && Object.keys(horse.colors || {}).length > 0;
  const hasDiseaseGenetics = Array.isArray(horse?.genetic_diseases) && horse.genetic_diseases.length > 0;
  const genetics = hasExteriorGenetics || hasColorGenetics || hasDiseaseGenetics;

  const pedigreeCount = dqPedigreeNames(horse?.pedigree).size;
  const version = horse?.game_version || 'DE';

  const checks = [
    { label:'Spielversion', ok: version === 'DE' || version === 'EN', value: version },
    { label:'Rasse', ok: !!horse?.breed, value: horse?.breed || 'fehlt' },
    { label:'Disziplinen', ok: disciplines >= 28, value: `${disciplines}/28` },
    { label:'Grundlagen', ok: traits >= 8, value: `${traits}/8` },
    { label:'Gangarten', ok: gaits >= 8, value: `${gaits}/8` },
    { label:'Interieur', ok: interior >= 10, value: `${interior}/10` },
    { label:'Genetik', ok: genetics, value: genetics ? 'vorhanden' : 'fehlt/teilweise' },
    { label:'Stammbaum', ok: pedigreeCount >= 2, value: pedigreeCount ? `${pedigreeCount} Namen` : 'fehlt' },
  ];

  const coreComplete = disciplines >= 28 && traits >= 8 && gaits >= 8 && interior >= 10;
  const passed = checks.filter(c => c.ok).length;

  let level = 'red';
  let label = 'unvollständig';
  if (coreComplete && passed >= 7) {
    level = 'green';
    label = 'vollständig';
  } else if (passed >= 5) {
    level = 'yellow';
    label = 'teilweise vollständig';
  }

  return { level, label, checks, counts: { disciplines, traits, gaits, interior, pedigreeCount } };
}

function dataQualityBadgeHtml(horse) {
  const q = analyzeHorseDataQuality(horse);
  const icon = q.level === 'green' ? '🟢' : q.level === 'yellow' ? '🟡' : '🔴';
  return `<span class="data-quality-badge" title="Datenqualität: ${q.label}">${icon} ${q.label}</span>`;
}

function dataQualityPanelHtml(horse) {
  const q = analyzeHorseDataQuality(horse);
  const icon = q.level === 'green' ? '🟢' : q.level === 'yellow' ? '🟡' : '🔴';
  return `
    <div class="data-quality-panel data-quality-${q.level}">
      <h3>${icon} Datenqualität: ${q.label}</h3>
      <div class="data-quality-grid">
        ${q.checks.map(c => `
          <div class="data-quality-item ${c.ok ? 'ok' : 'missing'}">
            <span>${c.ok ? '✓' : '⚠️'} ${c.label}</span>
            <strong>${escapeHtml(c.value)}</strong>
          </div>
        `).join('')}
      </div>
      ${q.level === 'green' ? '<p class="small">✅ Die für Berechnungen wichtigsten Daten sind vollständig vorhanden.</p>' : `
        <p class="small muted">
          Für möglichst vollständige Daten: Gentest/Genetic Tests öffnen, alle Disziplinen ausklappen
          und Rasseanteile/Breed percentages einblenden, danach erneut importieren.
        </p>`}
    </div>
  `;
}
