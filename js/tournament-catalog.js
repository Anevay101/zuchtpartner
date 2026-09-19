// MDR V54.0.75 – zentrale Turnier-/Disziplinbegriffe für DE und EN.
// Interne Schlüssel bleiben bewusst deutsch. Anzeige und Parser-Aliase werden
// ausschließlich aus diesem Katalog abgeleitet, damit DE/EN nicht auseinanderlaufen.

const MDR_TOURNAMENT_GROUP_LABELS = {
  Englisch: { en: 'English' },
  Rennen: { en: 'Racing' },
  Western: { en: 'Western' },
  Rodeo: { en: 'Rodeo' },
  Fahren: { en: 'Driving' },
  Barock: { en: 'Baroque' },
  Mehrgang: { en: 'Gaits' },
};

const MDR_TOURNAMENT_DISCIPLINES = {
  'Dressur': { en:'Dressage', aliases:['Dressage'], group:'Englisch', performance:['Dressur','Schritt','Trab','Galopp','Kraft','Präzision','Ausdruck'], interior:['Gelehrigkeit','Aufmerksamkeit','Intelligenz'] },
  'Springen': { en:'Showjumping', aliases:['Show Jumping','Showjumping'], group:'Englisch', performance:['Springen','Galopp','Beschleunigung','Wendigkeit','Kondition','Kraft','Tempo'], interior:['Furchtlosigkeit','Leistungsbereitschaft','Temperament'] },
  'Cross Country': { en:'Cross Country', aliases:['Cross Country'], group:'Englisch', performance:['Cross Country','Galopp','Beschleunigung','Wendigkeit','Kondition','Kraft','Tempo'], interior:['Nervenstärke','Aufmerksamkeit','Leistungsbereitschaft'] },
  'Distanz': { en:'Endurance', aliases:['Endurance'], group:'Englisch', performance:['Distanz','Schritt','Trab','Galopp','Kondition','Tempo','Gelassenheit'], interior:['Gutmütigkeit','Nervenstärke','Temperament'] },

  'Flachrennen': { en:'Flat Racing', aliases:['Flat Racing'], group:'Rennen', performance:['Flachrennen','Renngalopp','Beschleunigung','Kondition','Tempo','Kraft','Gelassenheit'], interior:['Siegeswille','Leistungsbereitschaft','Temperament'] },
  'Hindernisrennen': { en:'Steeplechase', aliases:['Steeplechase','Steeplechasing'], group:'Rennen', performance:['Hindernisrennen','Renngalopp','Beschleunigung','Kondition','Tempo','Kraft','Gelassenheit'], interior:['Siegeswille','Nervenstärke','Aufmerksamkeit'] },
  'Seejagdrennen': { en:'Lake Chase Racing', aliases:['Lake Chase Racing'], group:'Rennen', performance:['Seejagdrennen','Renngalopp','Beschleunigung','Kondition','Tempo','Kraft','Gelassenheit'], interior:['Siegeswille','Nervenstärke','Furchtlosigkeit'] },
  'Trabrennen': { en:'Trot Racing', aliases:['Trot Racing'], group:'Rennen', performance:['Trabrennen','Trab','Beschleunigung','Kondition','Tempo','Kraft','Gelassenheit'], interior:['Temperament','Siegeswille','Leistungsbereitschaft'] },

  'Reining': { en:'Reining', aliases:['Reining'], group:'Western', performance:['Reining','Schritt','Galopp','Beschleunigung','Wendigkeit','Kondition','Präzision'], interior:['Temperament','Leistungsbereitschaft','Intelligenz'] },
  'Trail': { en:'Trail', aliases:['Trail'], group:'Western', performance:['Trail','Schritt','Trab','Galopp','Wendigkeit','Präzision','Gelassenheit'], interior:['Aufmerksamkeit','Gelehrigkeit','Intelligenz'] },
  'Pleasure': { en:'Pleasure', aliases:['Pleasure'], group:'Western', performance:['Pleasure','Schritt','Trab','Galopp','Gelassenheit','Ausdruck','Präzision'], interior:['Sozialverhalten','Gutmütigkeit','Gelehrigkeit'] },
  'Horsemanship': { en:'Horsemanship', aliases:['Horsemanship'], group:'Western', performance:['Horsemanship','Schritt','Trab','Galopp','Gelassenheit','Ausdruck','Präzision'], interior:['Gutmütigkeit','Gelehrigkeit','Intelligenz'] },

  'Cutting': { en:'Cutting', aliases:['Cutting'], group:'Rodeo', performance:['Cutting','Galopp','Beschleunigung','Wendigkeit','Gelassenheit','Kraft','Tempo'], interior:['Furchtlosigkeit','Nervenstärke','Intelligenz'] },
  'Roping': { en:'Roping', aliases:['Roping'], group:'Rodeo', performance:['Roping','Galopp','Beschleunigung','Präzision','Gelassenheit','Kraft','Tempo'], interior:['Aufmerksamkeit','Furchtlosigkeit','Nervenstärke'] },
  'Pole Bending': { en:'Pole Bending', aliases:['Pole Bending'], group:'Rodeo', performance:['Pole Bending','Galopp','Beschleunigung','Wendigkeit','Präzision','Kraft','Tempo'], interior:['Leistungsbereitschaft','Siegeswille','Temperament'] },
  'Barrel Racing': { en:'Barrel Racing', aliases:['Barrel Racing'], group:'Rodeo', performance:['Barrel Racing','Galopp','Beschleunigung','Wendigkeit','Präzision','Kraft','Tempo'], interior:['Leistungsbereitschaft','Siegeswille','Temperament'] },

  'Dressurfahren': { en:'Dressage Driving', aliases:['Dressage Driving'], group:'Fahren', performance:['Dressurfahren','Schritt','Trab','Galopp','Wendigkeit','Präzision','Ausdruck'], interior:['Sozialverhalten','Gelehrigkeit','Intelligenz'] },
  'Hindernisfahren': { en:'Obstacle Driving', aliases:['Obstacle Driving'], group:'Fahren', performance:['Hindernisfahren','Galopp','Tempo','Wendigkeit','Präzision','Kondition','Kraft'], interior:['Sozialverhalten','Aufmerksamkeit','Furchtlosigkeit'] },
  'Geländefahren': { en:'Cross Country Driving', aliases:['Cross Country Driving'], group:'Fahren', performance:['Geländefahren','Galopp','Tempo','Wendigkeit','Gelassenheit','Kondition','Kraft'], interior:['Sozialverhalten','Nervenstärke','Furchtlosigkeit'] },
  'Holzrücken': { en:'Pulling', aliases:['Pulling'], group:'Fahren', performance:['Holzrücken','Schritt','Kraft','Gelassenheit','Kondition','Wendigkeit','Ausdruck'], interior:['Nervenstärke','Furchtlosigkeit','Gutmütigkeit'] },

  'Klassische Dressur': { en:'Classical Dressage', aliases:['Classical Dressage'], group:'Barock', performance:['Klassische Dressur','Schritt','Trab','Galopp','Kraft','Präzision','Ausdruck'], interior:['Gelehrigkeit','Aufmerksamkeit','Intelligenz'] },
  'Spanische Gänge': { en:'Spanish Walk', aliases:['Spanish Walk'], group:'Barock', performance:['Spanische Gänge','Schritt','Trab','Wendigkeit','Präzision','Ausdruck','Gelassenheit'], interior:['Gutmütigkeit','Aufmerksamkeit','Intelligenz'] },
  'Schulsprünge': { en:'School Jumps', aliases:['School Jumps'], group:'Barock', performance:['Schulsprünge','Kraft','Präzision','Ausdruck','Gelassenheit','Kondition','Wendigkeit'], interior:['Temperament','Leistungsbereitschaft','Nervenstärke'] },
  'Hohe Schule': { en:'Haute Ecole', aliases:['Haute Ecole'], group:'Barock', performance:['Hohe Schule','Schritt','Trab','Galopp','Kraft','Präzision','Ausdruck'], interior:['Gelehrigkeit','Leistungsbereitschaft','Intelligenz'] },

  'Tölt-Prüfung': { en:'Tölt Trial', aliases:['Tölt Trial'], group:'Mehrgang', performance:['Tölt-Prüfung','Tölt','Kraft','Präzision','Ausdruck','Kondition','Gelassenheit'], interior:['Gutmütigkeit','Sozialverhalten','Aufmerksamkeit'] },
  'Passrennen': { en:'Pace Racing', aliases:['Pace Racing'], group:'Mehrgang', performance:['Passrennen','Pass','Beschleunigung','Kondition','Tempo','Kraft','Gelassenheit'], interior:['Sozialverhalten','Siegeswille','Temperament'] },
  'Foxtrott Pleasure': { en:'Foxtrot Pleasure', aliases:['Foxtrot Pleasure'], group:'Mehrgang', performance:['Foxtrott Pleasure','Foxtrott','Gelassenheit','Ausdruck','Präzision','Kondition','Wendigkeit'], interior:['Gutmütigkeit','Sozialverhalten','Gelehrigkeit'] },
  'Racking': { en:'Racking', aliases:['Racking'], group:'Mehrgang', performance:['Racking','Rack','Tempo','Ausdruck','Präzision','Kondition','Beschleunigung'], interior:['Gutmütigkeit','Sozialverhalten','Gelehrigkeit'] },
};

const MDR_TOURNAMENT_AUX_TERMS = {
  'Grundlagen': { en:'Fundamentals', aliases:['Fundamentals'] },
  'Gangarten': { en:'Gaits', aliases:['Gaits'] },
  'Wendigkeit': { en:'Agility', aliases:['Agility'] },
  'Gelassenheit': { en:'Serenity', aliases:['Serenity'] },
  'Kraft': { en:'Strength', aliases:['Strength'] },
  'Tempo': { en:'Speed', aliases:['Speed'] },
  'Beschleunigung': { en:'Acceleration', aliases:['Acceleration'] },
  'Kondition': { en:'Stamina', aliases:['Stamina'] },
  'Präzision': { en:'Precision', aliases:['Precision'] },
  'Ausdruck': { en:'Expression', aliases:['Expression'] },
  'Schritt': { en:'Walk', aliases:['Walk'] },
  'Trab': { en:'Trot', aliases:['Trot'] },
  'Galopp': { en:'Canter', aliases:['Canter'] },
  'Renngalopp': { en:'Gallop', aliases:['Gallop'] },
  'Tölt': { en:'Tölt', aliases:['Tölt'] },
  'Pass': { en:'Pace', aliases:['Pace'] },
  'Foxtrott': { en:'Foxtrot', aliases:['Foxtrot'] },
  'Rack': { en:'Rack', aliases:['Rack'] },
};

const MDR_TOURNAMENT_EN_TO_INTERNAL = {};
const MDR_TOURNAMENT_UI_TRANSLATIONS = {};
for (const [internal, def] of Object.entries(MDR_TOURNAMENT_DISCIPLINES)) {
  MDR_TOURNAMENT_UI_TRANSLATIONS[internal] = def.en;
  for (const alias of new Set([def.en, ...(def.aliases || [])])) MDR_TOURNAMENT_EN_TO_INTERNAL[alias] = internal;
}
for (const [internal, def] of Object.entries(MDR_TOURNAMENT_GROUP_LABELS)) {
  MDR_TOURNAMENT_UI_TRANSLATIONS[internal] = def.en;
  MDR_TOURNAMENT_EN_TO_INTERNAL[def.en] = internal;
}
for (const [internal, def] of Object.entries(MDR_TOURNAMENT_AUX_TERMS)) {
  MDR_TOURNAMENT_UI_TRANSLATIONS[internal] = def.en;
  for (const alias of new Set([def.en, ...(def.aliases || [])])) {
    // „Gaits“ ist sowohl die EN-Turniergruppe Mehrgang als auch die
    // Eigenschaften-Gruppe Gangarten. Der generische Disziplin-Normalizer
    // bevorzugt die Turniergruppe; der Parser löst „Gaits“ im Traits-Kontext
    // explizit zu „Gangarten“ auf.
    if (!(alias in MDR_TOURNAMENT_EN_TO_INTERNAL)) MDR_TOURNAMENT_EN_TO_INTERNAL[alias] = internal;
  }
}

function mdrTournamentNormalizeDiscipline(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return MDR_TOURNAMENT_EN_TO_INTERNAL[raw] || raw;
}

function mdrTournamentDisciplineLabel(value, language = null) {
  const internal = mdrTournamentNormalizeDiscipline(value);
  const lang = language || (window.MDR_I18N?.language === 'en' ? 'en' : 'de');
  if (lang !== 'en') return internal;
  return MDR_TOURNAMENT_DISCIPLINES[internal]?.en || internal;
}

function mdrTournamentGroup(value) {
  const internal = mdrTournamentNormalizeDiscipline(value);
  return MDR_TOURNAMENT_DISCIPLINES[internal]?.group || (MDR_TOURNAMENT_GROUP_LABELS[internal] ? internal : null);
}

function mdrTournamentGroupLabel(value, language = null) {
  const internal = MDR_TOURNAMENT_EN_TO_INTERNAL[String(value || '').trim()] || String(value || '').trim();
  const lang = language || (window.MDR_I18N?.language === 'en' ? 'en' : 'de');
  return lang === 'en' ? (MDR_TOURNAMENT_GROUP_LABELS[internal]?.en || internal) : internal;
}

function mdrTournamentAuxLabel(value, language = null) {
  const internal = MDR_TOURNAMENT_EN_TO_INTERNAL[String(value || '').trim()] || String(value || '').trim();
  const lang = language || (window.MDR_I18N?.language === 'en' ? 'en' : 'de');
  return lang === 'en' ? (MDR_TOURNAMENT_AUX_TERMS[internal]?.en || internal) : internal;
}

function findDisciplineCategory(disciplines, name) {
  if (!name) return null;
  const normalized = mdrTournamentNormalizeDiscipline(name);
  const catalogGroup = MDR_TOURNAMENT_DISCIPLINES[normalized]?.group || null;
  if (!disciplines) return catalogGroup;
  for (const [category, entries] of Object.entries(disciplines)) {
    if ((entries || []).some((entry) => mdrTournamentNormalizeDiscipline(entry?.name) === normalized)) return category;
  }
  return catalogGroup;
}

if (typeof window !== 'undefined') {
  window.MDR_TOURNAMENT_CATALOG = {
    groups: MDR_TOURNAMENT_GROUP_LABELS,
    disciplines: MDR_TOURNAMENT_DISCIPLINES,
    auxTerms: MDR_TOURNAMENT_AUX_TERMS,
    enToInternal: MDR_TOURNAMENT_EN_TO_INTERNAL,
    uiTranslations: MDR_TOURNAMENT_UI_TRANSLATIONS,
    normalizeDiscipline: mdrTournamentNormalizeDiscipline,
    disciplineLabel: mdrTournamentDisciplineLabel,
    group: mdrTournamentGroup,
    groupLabel: mdrTournamentGroupLabel,
    auxLabel: mdrTournamentAuxLabel,
  };
}
