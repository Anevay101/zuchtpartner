// Parser für den kopierten Text einer Morning-Dust-Ranch Pferdeseite.
//
// Das Spiel liefert keine offizielle API/Export-Funktion. Dieser Parser
// arbeitet daher rein textbasiert (Label-Zeilen, Tab-getrennte Tabellenzeilen,
// Prozent-Paare) und ist bewusst tolerant statt strikt. Er ist "best effort":
// jedes Ergebnis wird dem Nutzer vor dem Speichern zur Kontrolle angezeigt,
// und der komplette Rohtext wird immer mit gespeichert (raw_text), damit
// nichts verloren geht, falls sich das Seitenlayout im Spiel mal ändert.

// Rasse-Kürzel, wie sie im Spiel teils statt des vollen Namens auftauchen
// (z.B. im Stammbaum oder wenn manuell so eingetragen) - werden überall,
// wo eine Rasse gesetzt wird, auf den ausgeschriebenen Namen normalisiert
// (siehe normalizeBreed), damit Anzeige UND Filterung (exakter Abgleich
// auf den gespeicherten Spaltenwert) konsistent den vollen Namen nutzen.
// Zuchtkürzel-Präfixe/-Suffixe, mit denen Züchter ihre Fohlen schon vor der
// eigentlichen Namensgebung markieren (z.B. "~VL~ Namen geben?"). Steht nur
// das Kürzel allein als Name, ist das Fohlen ebenso unbenannt wie bei
// "Unbekannt" oder "Namen geben?" - siehe parseHorseText.
const ZUCHTKUERZEL = ['~VL~', '-Cookie-', '°Sol°', '*Iced*', '*ANE', "Lucky's", '~Ts~', '4Leafs', 'Van Het Dok'];


// --- V17: DE/EN-Spielversion ------------------------------------------------
//
// Beide Spielversionen werden in derselben lokalen Datenbank gespeichert.
// RASSE und FELLFARBE bleiben bewusst im Original der jeweiligen Spielversion.
// Nur berechnungsrelevante Begriffe werden beim Einlesen auf die bereits
// vorhandenen internen deutschen Schlüssel normalisiert.

const EN_TO_INTERNAL_EXACT = {
  // Navigation / Bereiche
  'Hereditary diseases': 'Erbkrankheiten',
  'Colours': 'Farben',
  'Colors': 'Farben',
  'Colour genetics': 'Farben',
  'Color genetics': 'Farben',
  'Colour genes': 'Farben',
  'Color genes': 'Farben',
  'Performance': 'Leistung',
  'Discipline': 'Disziplin',
  'Training condition': 'Trainingszustand',
  'Competition potential': 'Turnierpotenzial',
  'Show all disciplines?': 'Alle Disziplinen anzeigen?',
  'Traits': 'Eigenschaften',
  'Fundamentals': 'Grundlagen',
  'Ownership history': 'Besitzhistorie',
  'Pedigree': 'Stammbaum',
  'Inner values': 'Interieur',
  'Mentality': 'Mentalität',
  'Unknown': 'Unbekannt',

  // Gruppen, Disziplinen, Grundlagen und Gangarten kommen aus tournament-catalog.js.

  // Interieur
  'Temperament': 'Temperament',
  'Docility': 'Gelehrigkeit',
  'Motivation': 'Leistungsbereitschaft',
  'Attention': 'Aufmerksamkeit',
  'Good nature': 'Gutmütigkeit',
  'Calmness': 'Nervenstärke',
  'Intelligence': 'Intelligenz',
  'Competitiveness': 'Siegeswille',
  'Fearlessness': 'Furchtlosigkeit',
  'Social behaviour': 'Sozialverhalten',

  // Interieur-Wertstufen
  'Excellent': 'Exzellent',
  'Good': 'Gut',
  'Okay': 'In Ordnung',
  'Bad': 'Schlecht',
  'Miserable': 'Miserabel',

  // Genetik
  'not tested': 'Nicht getestet',
  'None': 'Keine',
  'Free of hereditary diseases': 'Frei von Erbkrankheiten',
  'Achievements': 'Erfolge',
  'Competitions': 'Turniere',
  'Placements': 'Platzierungen',
  'Placings': 'Platzierungen',
  'Statistics': 'Statistik',
  'Records': 'Erfolge',
  '1st Place': '1. Platz',
  '2nd Place': '2. Platz',
  '3rd Place': '3. Platz',
  'MDR Cup qualification': 'MDR-Cup Qualifikation',
  'MDR-Cup qualification': 'MDR-Cup Qualifikation',
  'Prize money': 'Gewinnsumme',
  'Winnings': 'Gewinnsumme',
  'Competition entries': 'Turniernennungen',
  'Offspring': 'Nachkommen',
  'Breeding': 'Zucht',
  'Papers': 'Papiere',
};
Object.assign(EN_TO_INTERNAL_EXACT, typeof MDR_TOURNAMENT_EN_TO_INTERNAL !== 'undefined' ? MDR_TOURNAMENT_EN_TO_INTERNAL : {});

function detectGameVersion(rawText) {
  const text = String(rawText || '');
  const englishSignals = [
    /\bAbout the horse\b/i,
    /\bGenetic Tests\b/i,
    /\bBreeding licen[cs]e\s*:/i,
    /\bCompetition potential\b/i,
    /\bInner values\b/i,
    /\bShow all disciplines\?/i,
    /\bAchievements\b/i,
    /\bMDR[- ]Cup\s+qualification\b/i,
    /\bCompetition starts\s*:/i,
  ];
  return englishSignals.some((re) => re.test(text)) ? 'EN' : 'DE';
}

function translateEnglishLineForParser(line, state) {
  let s = line;

  // Header: Alter/Geschlecht/Reinrassigkeit.
  s = s.replace(/^(\d+)\s+years?(?:,\s*(\d+)\s+months?)?$/i, (_, y, m) =>
    `${y} Jahre${m != null ? `, ${m} Monate` : ''}`
  );

  const genderMap = {
    'Mare': 'Stute',
    'Stallion': 'Hengst',
    'Gelding': 'Wallach',
    'Colt': 'Hengstfohlen',
    'Filly': 'Stutfohlen',
    'Foal': 'Fohlen',
  };
  if (genderMap[s]) s = genderMap[s];

  s = s.replace(/^([\d.,]+)\s*%\s*Purebred$/i, '$1% Reinrassig');

  // Label-Zeilen. Werte (z.B. Rasse/Fellfarbe) bleiben unverändert.
  const prefixMap = [
    [/^Birthday\s*:/i, 'Geburtstag:'],
    [/^Colour\s*:/i, 'Fellfarbe:'],
    [/^Color\s*:/i, 'Fellfarbe:'],
    [/^Coat colour\s*:/i, 'Fellfarbe:'],
    [/^Coat color\s*:/i, 'Fellfarbe:'],
    [/^Owner\s*:/i, 'Besitzer:'],
    [/^Hereditary disease\s*:/i, 'Erbkrankheit:'],
    [/^Test result\s*:/i, 'Testergebnis:'],
    [/^Breed\s*:/i, 'Rasse:'],
    [/^Purebred\s*:/i, 'Reinrassigkeit:'],
    [/^Breeding licen[cs]e\s*:/i, 'Zuchtzulassung:'],
    [/^Performance test\s*:/i, 'HLP/SLP:'],
    [/^COI\s*:/i, 'ICO:'],
    [/^In foal\?\s*:/i, 'Tragend?:'],
    [/^Foaling date\s*:/i, 'Abfohltermin:'],
    [/^Talent\s*:/i, 'Begabung:'],
    [/^Disciplines\s*:/i, 'Disziplinen:'],
    [/^Overall potential\s*:/i, 'Gesamtpotenzial:'],
    [/^Diff\.-OP Parents\s*:/i, 'Diff.-GP Eltern:'],
    [/^Experience\s*:/i, 'Erfahrung:'],
    [/^Competition starts\s*:/i, 'Turnierstarts:'],
    [/^(?:Offspring(?:\s+in\s+total|\s+total)?|Total\s+offspring)\s*:/i, 'Nachkommen insgesamt:'],
    [/^Starts\s*:/i, 'Starts:'],
    [/^First places\s*:/i, 'Erste Plätze:'],
    [/^Second places\s*:/i, 'Zweite Plätze:'],
    [/^Third places\s*:/i, 'Dritte Plätze:'],
    [/^No placements\s*:/i, 'Keine Platzierungen:'],
  ];
  for (const [re, replacement] of prefixMap) {
    if (re.test(s)) {
      s = s.replace(re, replacement);
      break;
    }
  }
  // "Traits: 237" im Turnierpotenzial darf nicht mit der Überschrift
  // "Traits" verwechselt werden.
  s = s.replace(/^Traits\s*:/i, 'Grundlagen:');

  // Ja/Nein bzw. Status in Label-Zeilen normalisieren.
  s = s.replace(/:\s*Yes\s*$/i, ': Ja');
  s = s.replace(/:\s*No\s*$/i, ': Nein');
  s = s.replace(/Free of hereditary diseases/ig, 'Frei von Erbkrankheiten');

  // Zwei "Conformation"-Bereiche: zuerst Genotyp-Tabelle, später
  // beschreibender Körperbau.
  if (s === 'Conformation') {
    state.conformationCount += 1;
    return state.conformationCount === 1 ? 'Exterieur' : 'Körperbau';
  }

  // "Gaits" ist einmal Turniergruppe (= Mehrgang) und später unter Traits
  // die Gangarten-Gruppe.
  if (s === 'Traits') state.inTraits = true;
  if (s === 'Gaits') return state.inTraits ? 'Gangarten' : 'Mehrgang';

  // Exakte Begriffe / Tabellenzellen übersetzen. Bei tabellarischen Zeilen
  // wird jede Zelle einzeln normalisiert, Pferdenamen/Rassen bleiben dadurch
  // unangetastet.
  const parts = s.split('\t');
  const mapped = parts.map((part) => {
    const t = part.trim();
    return EN_TO_INTERNAL_EXACT[t] || part;
  });
  s = mapped.join('\t');

  return EN_TO_INTERNAL_EXACT[s] || s;
}

// V54.0.42 – Farbgenetik aus DE/EN auf gemeinsame interne Genortnamen
// abbilden. Die englische Spielversion verwendet je nach Ansicht/Übersetzung
// teils andere Schreibweisen (z.B. Gray, Pattern 1, Splashed White oder
// Color/Colour). Rasse und sichtbare Fellfarbe bleiben weiterhin im Original;
// nur die Genort-Bezeichnung wird für Berechnungen vereinheitlicht.
function normalizeEnglishHorseText(rawText) {
  const state = { conformationCount: 0, inTraits: false };
  return String(rawText || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => translateEnglishLineForParser(line.trim(), state))
    .join('\n');
}

// Bei nicht 100% reinrassigen Pferden zeigt das Spiel hinter der
// "Reinrassigkeit:"-Zeile optional eine Rasseanteile-Aufschlüsselung -
// aber nur, wenn "Rasseanteile anzeigen?" vorher im Spiel aufgeklappt
// wurde, bevor die Seite kopiert wurde. Je Zeile ein Prozentwert gefolgt
// von der jeweiligen Rasse, z.B. "50.00 % Knabstrupper".
function parseBreedComposition(lines) {
  const reinIdx = lines.findIndex((l) => /^Reinrassigkeit\s*:/i.test(l));
  if (reinIdx === -1) return null;

  const parts = [];
  for (let i = reinIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const m = line.match(/^([\d.,]+)\s*%\s+(.+)$/);
    if (!m) break;
    const pct = m[1].replace(',', '.');
    parts.push(`${pct}% ${normalizeBreed(m[2].trim())}`);
  }
  return parts.length ? parts.join(', ') : null;
}


function breedingGoalFromTalent(talent) {
  const key = typeof mdrTournamentNormalizeDiscipline === 'function'
    ? mdrTournamentNormalizeDiscipline(talent)
    : String(talent || '').trim();
  return (typeof MDR_TOURNAMENT_DISCIPLINES !== 'undefined' && MDR_TOURNAMENT_DISCIPLINES[key]?.group) || null;
}

// V43: Aktuelle Trächtigkeit aus dem Zuchtbereich auslesen.
// Nach der EN-Normalisierung sehen beide Spielversionen gleich aus:
//   Tragend?: Ja, von <Hengst>
//   Abfohltermin: TT.MM.JJJJ bzw. vorher EN TT/MM/JJJJ
function parsePregnancy(nonEmptyLines) {
  const rawStatus = findValueForLabel(nonEmptyLines, 'Tragend?');
  if (rawStatus == null) return null;

  const isPregnant = /^(ja|yes)\b/i.test(rawStatus);
  const pregnancy = {
    is_pregnant: isPregnant,
    detected_from_profile: true,
  };

  if (isPregnant) {
    const sireMatch = rawStatus.match(/(?:^|,\s*)(?:von|by)\s+(.+)$/i);
    if (sireMatch?.[1]) pregnancy.sire_name = sireMatch[1].trim();

    const foalingRaw = findValueForLabel(nonEmptyLines, 'Abfohltermin');
    const foalingDate = parseGameDate(foalingRaw);
    if (foalingDate) pregnancy.foaling_date = foalingDate;
  }

  return pregnancy;
}


function parseHorseText(rawText) {
  const gameVersion = detectGameVersion(rawText);
  const parserText = gameVersion === 'EN' ? normalizeEnglishHorseText(rawText) : rawText;
  const lines = parserText.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);

  const result = {
    raw_text: rawText,
    game_version: gameVersion,
    // V54.0.72: Turnierreferenzen von DE und EN werden getrennt geführt.
    // Das Servermerkmal wird bewusst zusätzlich zur UI-/Spielversion gespeichert,
    // damit die Benchmark-Welt fachlich eindeutig bleibt.
    mdr_server: gameVersion,
  };

  Object.assign(result, extractHeaderBlock(lines));

  // --- Einfache "Label: Wert" Zeilen ---
  setIf(result, 'coat_color', findValueForLabel(nonEmpty, 'Fellfarbe'));
  if (result.coat_color) {
    const appPattern = detectAppaloosaPatternFromCoatColor(result.coat_color);
    if (appPattern) result.appaloosa_pattern = appPattern;

    // Nachvollziehbare, konservative Hinweise aus der sichtbaren Fellfarbe.
    // Sie sind ausdrücklich als "Fellfarbe" markiert und nicht als Gentest.
    const phenotypeHints = inferGeneticHintsFromPhenotype(result.coat_color)
      .map((h) => ({
        locus: h.locus,
        allele: h.allele,
        label: h.label,
        source: 'Fellfarbe',
      }));
    if (phenotypeHints.length) result.phenotype_gene_hints = phenotypeHints;
  }
  setIf(result, 'owner', findValueForLabel(nonEmpty, 'Besitzer'));
  setIf(result, 'birthdate', parseGameDate(findValueForLabel(nonEmpty, 'Geburtstag')));

  const erbkrankheitStatus =
    findValueForLabel(nonEmpty, 'Testergebnis') || findValueForLabel(nonEmpty, 'Erbkrankheit');
  if (erbkrankheitStatus) {
    result.disease_free = /frei/i.test(erbkrankheitStatus);
  }

  // --- Papiere ---
  const rasse = findValueForLabel(nonEmpty, 'Rasse');
  if (rasse) result.breed = normalizeBreed(rasse);
  const reinrassigkeit = findValueForLabel(nonEmpty, 'Reinrassigkeit');
  if (reinrassigkeit) {
    const m = reinrassigkeit.match(/([\d.,]+)\s*%/);
    if (m) result.purebred_pct = parseFloat(m[1].replace(',', '.'));
  }
  const breedComposition = parseBreedComposition(lines);
  if (breedComposition) result.breed_composition = breedComposition;
  const zuchtzulassungLine = nonEmpty.find((l) => /^Zuchtzulassung\b/i.test(l));
  if (zuchtzulassungLine) {
    const zzlValue = zuchtzulassungLine.replace(/^Zuchtzulassung\s*:?/i, '').trim();
    if (/^(ja|yes)$/i.test(zzlValue)) result.breeding_allowed = true;
    else if (/^(nein|no)$/i.test(zzlValue)) result.breeding_allowed = false;
  }
  setIf(result, 'hlp_slp', findValueForLabel(nonEmpty, 'HLP/SLP'));

  // Anzahl der Nachkommen steht im MDR-Profil dauerhaft im Zuchtbereich.
  // DE: "Nachkommen insgesamt: 3"; EN wird oben auf dasselbe Label
  // normalisiert (u.a. "Offspring: 3" / "Offspring in total: 3").
  // Der Wert wird bewusst als Profilwert gespeichert und nicht aus den
  // aktuell in unserer Datenbank bekannten Fohlen geschätzt, damit der
  // Filter auch dann korrekt bleibt, wenn nicht jeder Nachkomme erfasst ist.
  const offspringRaw = findValueForLabel(nonEmpty, 'Nachkommen insgesamt')
    || findValueForLabel(nonEmpty, 'Nachkommen')
    || findValueForLabel(nonEmpty, 'Offspring in total')
    || findValueForLabel(nonEmpty, 'Offspring total')
    || findValueForLabel(nonEmpty, 'Total offspring')
    || findValueForLabel(nonEmpty, 'Offspring');
  if (offspringRaw != null) {
    const offspringMatch = String(offspringRaw).match(/\d+/);
    if (offspringMatch) result.offspring_count = Math.max(0, Number(offspringMatch[0]));
  }

  // EN Performance Test / DE HLP-SLP: zusätzlich strukturierte Punkte,
  // ohne den Originaltext zu verlieren. Ein ausdrückliches Nein darf dabei
  // keinesfalls als bestandene Leistungsprüfung interpretiert werden.
  if (result.hlp_slp) {
    const performanceText = String(result.hlp_slp).trim();
    const ptPoints = performanceText.match(/(\d+)\s*(?:points?|Punkte)/i);
    if (ptPoints) result.performance_test_points = Number(ptPoints[1]);

    const performanceNegative =
      /^(?:nein|no|false|0)$/i.test(performanceText) ||
      /(?:failed|nicht bestanden|durchgefallen)/i.test(performanceText);
    const performancePositive =
      /^(?:ja|yes|true|1)$/i.test(performanceText) ||
      /(?:prämienstute|praemienstute|prämienhengst|praemienhengst|premium mare|premium stallion|\bbestanden\b|\bpassed\b)/i.test(performanceText) ||
      Boolean(ptPoints);

    if (performanceNegative) result.performance_test_passed = false;
    else if (performancePositive) result.performance_test_passed = true;
  }

  // --- Zucht ---
  const icoVal = findValueForLabel(nonEmpty, 'ICO');
  if (icoVal) result.ico = parseFloat(icoVal.replace(',', '.').replace('%', '').trim());

  const pregnancy = parsePregnancy(nonEmpty);
  if (pregnancy) result.pregnancy = pregnancy;

  // Deckhengst / Zuchtstation. Diese Angaben stehen im MDR-Profil im
  // Zuchtbereich als eigene Label-Zeilen. Ein ausdrückliches Nein wird
  // ebenfalls gespeichert, damit ein früher gesetztes Zuchtstation-Tag
  // beim erneuten Einlesen wieder entfernt werden kann.
  const stationValue = findValueForLabel(nonEmpty, 'In Zuchtstation?');
  if (stationValue) {
    if (/^(ja|yes)$/i.test(stationValue)) result.in_breeding_station = true;
    else if (/^(nein|no)$/i.test(stationValue)) result.in_breeding_station = false;
  }
  const studFeeRaw = findValueForLabel(nonEmpty, 'Decktaxe');
  if (studFeeRaw) {
    if (/kostenlos|free/i.test(String(studFeeRaw))) result.stud_fee = 0;
    else {
      const compact = String(studFeeRaw).replace(/\s+/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
      const feeMatch = compact.match(/(\d+(?:\.\d+)?)/);
      if (feeMatch) result.stud_fee = Number(feeMatch[1]);
    }
  } else if (result.in_breeding_station === false) {
    // Ein ausdrücklich nicht mehr in der Zuchtstation stehender Hengst
    // soll keine alte Decktaxe aus einem früheren Import behalten.
    result.stud_fee = 0;
  }

  // --- Tabellen ---
  result.genetic_diseases = extractSimpleTable(lines, 'Erbkrankheiten', ['Farben']);
  result.colors = extractSimpleTable(lines, 'Farben', ['Exterieur'])
    .filter((r) => r.label !== 'Fellfarbe')
    .map((r) => ({
      ...r,
      label: normalizeColorLocusLabel(r.label),
      value: normalizeColorGenotypeValue(r.value),
    }));

  const exteriorGenetic = parseExteriorGenetics(lines);
  result.exterior_genetics = exteriorGenetic;

  result.exterior_descriptive = extractSimpleTable(lines, 'Körperbau', ['Interieur', 'Mentalität']);
  result.temperament = extractSimpleTable(lines, 'Mentalität', ['Modbox', 'Zucht', 'Nachkommen']);

  // Bei "Begabung"-Disziplinen zeigt die Seite zunächst nur eine Kategorie
  // (z.B. "Western") offen an, gefolgt von Trainingszustand/Turnierpotenzial;
  // die übrigen Kategorien folgen erst danach hinter "Alle Disziplinen
  // anzeigen?". Diese Zwischenzeilen enthalten keine Prozent-Paare und
  // werden vom Gruppen-Erkenner automatisch übersprungen.
  result.disciplines = extractDisciplineGroups(lines);
  result.traits = extractPercentGroupsByLabel(lines, 'Eigenschaften', 'Papiere');

  result.tournament_potential = parseTournamentPotential(lines);

  // V53.1: Turnierdaten aus den MDR-Reitern „Erfolge“ und „Turniere“.
  // Die MDR-Seite rendert diese Inhalte je nach aktivem Reiter getrennt;
  // deshalb darf man beide Ansichten nacheinander einlesen. horseForm.js
  // führt die Teildaten disziplinweise zusammen, statt sie zu ersetzen.
  const placementResults = parseTournamentPlacements(lines);
  const cupQualificationResults = parseCupQualifications(lines);
  const tournamentResults = mergeTournamentResultParts(placementResults, cupQualificationResults);
  if (Object.keys(tournamentResults).length) result.tournament_results = tournamentResults;

  const tournamentStarts = parseTournamentStarts(lines);
  if (tournamentStarts !== null) result.tournament_starts_total = tournamentStarts;

  result.pedigree = parsePedigree(lines, result.breed);

  // Noch unbenannte Fohlen heißen im Spiel schlicht "Unbekannt", zeigen
  // "Namen geben?" (ggf. mit Zuchtkürzel davor/danach), oder tragen noch
  // gar keinen eigenen Namen außer dem bloßen Zuchtkürzel selbst. In allen
  // Fällen wird statt des Platzhaltertexts ein Name aus den Eltern
  // gebildet, damit nicht mehrere Fohlen mit demselben Namen angelegt
  // werden (siehe Dopplungs-Erkennung beim Speichern). Die ersten beiden
  // Stammbaum-Einträge sind laut Spiel immer Vater und Mutter in dieser
  // Reihenfolge (siehe parsePedigree/PEDIGREE_SECTION_LABELS: "Eltern des
  // Vaters" kommt vor "Eltern der Mutter").
  const trimmedName = (result.name || '').trim();
  const hadUnnamedPrompt = result._header_name_action === 'give-name';
  const hadRenamePrompt = result._header_name_action === 'rename';
  const decoratedBreederMarkOnly = /^[~*°'._-]+[A-Za-z0-9]{1,10}[~*°'._-]*$/.test(trimmedName);
  const knownBreederMarkOnly = ZUCHTKUERZEL.some((mark) => mark.toLowerCase() === trimmedName.toLowerCase());
  const unnamedFoal = (
    trimmedName === 'Unbekannt' ||
    /^(?:Unknown|Unbekannt)$/i.test(trimmedName) ||
    /Namen geben\?|Name geben\?|Name horse\??|Name foal\??|Give (?:the )?horse (?:a )?name\??|Rename\?/i.test(trimmedName) ||
    knownBreederMarkOnly ||
    hadUnnamedPrompt ||
    (hadRenamePrompt && (decoratedBreederMarkOnly || knownBreederMarkOnly || !trimmedName))
  );
  if (unnamedFoal) {
    const ancestors = result.pedigree.ancestors || [];
    const vater = ancestors[0]?.name || 'Unbekannt';
    const mutter = ancestors[1]?.name || 'Unbekannt';
    const prefix = gameVersion === 'EN' ? 'Foal_' : 'Fohlen_';
    result.name = `${prefix}${mutter} X ${vater}`;
  }
  delete result._header_name_action;

  // Zuchtziel automatisch aus der Begabung ableiten.
  // Die Begabung ist eine der vier Disziplinen einer Hauptdisziplin.
  // Beispiel: Spanische Gänge -> Barock, Trail -> Western.
  const talentForGoal =
    result?.tournament_potential?.Begabung ||
    result?.tournament_potential?.['Begabung'] ||
    null;
  const automaticGoal = breedingGoalFromTalent(normalizeTournamentDisciplineName(talentForGoal));
  if (automaticGoal) {
    result.breeding_goal = automaticGoal;
    result.breeding_goal_source = 'automatisch aus Begabung';
  }

  // Cupstern/Cup star: nur markieren, wenn er im kopierten Profiltext
  // ausdrücklich erwähnt wird ODER eine echte MDR-Cup-Qualifikation mit
  // Disziplin/LK ausgelesen wurde. Nicht aus Siegen/Punkten herleiten.
  result.cup_star_detected = Object.values(cupQualificationResults).some((row) => row?.cup_star === true)
    || /\b(Cupstern|Cup star|MDR Cup star|qualified for the MDR-?Cup)\b/i.test(rawText);

  return result;
}

function setIf(obj, key, value) {
  if (value !== null && value !== undefined && value !== '') obj[key] = value;
}

// Wandelt ein Datum im Spiel-Format "TT.MM.JJJJ" (z.B. bei "Geburtstag:
// 13.07.2024") in das ISO-Format "JJJJ-MM-TT" um, das die date-Spalte
// (horses.birthdate) sowie das <input type="date"> Formularfeld erwarten.
function parseGameDate(value) {
  if (!value) return null;
  // DE: TT.MM.JJJJ, EN: TT/MM/JJJJ
  const m = value.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (!m) return null;
  const [, day, month, year] = m;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Sucht eine Zeile im Format "Label: Wert" (auch wenn danach noch Text auf
// derselben Zeile folgt, z.B. "Reinrassigkeit: 100.00 % Rasseanteile anzeigen?").
function findValueForLabel(nonEmptyLines, label) {
  const re = new RegExp('^' + escapeRegex(label) + '\\s*:\\s*(.+)$', 'i');
  for (const line of nonEmptyLines) {
    const m = line.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

// Name/Alter/Geschlecht/Rasse/Reinrassigkeit stehen ohne Label direkt
// übereinander, kurz vor dem Link "Zum Pferd". Anker ist die Alterszeile
// ("19 Jahre, 10 Monate").
function extractHeaderBlock(lines) {
  const ageIdx = lines.findIndex((l) => /^\d+\s*Jahre?(,\s*\d+\s*Monate?)?$/i.test(l));
  if (ageIdx === -1) return {};

  let nameIdx = ageIdx - 1;
  while (nameIdx >= 0 && !lines[nameIdx]) nameIdx--;

  const out = {};
  if (nameIdx >= 0) {
    // Eigene Pferde können vor dem Namen die MDR-ID und hinter dem Namen
    // einen Aktionslink tragen. DE: "Ändern?" / "Namen geben?",
    // EN: "Rename?". Diese UI-Texte sind niemals Teil des Pferdenamens.
    // Gerade bei unbenannten EN-Fohlen steht z.B. "ID 216203 *ANE Rename?".
    let rawName = String(lines[nameIdx] || '').trim();
    const idMatch = rawName.match(/^ID\s*:?[\s#]*(\d+)\b/i);
    if (idMatch) {
      out.external_id = idMatch[1];
      rawName = rawName.slice(idMatch[0].length).trim();
    }

    // Unbenannte Fohlen zeigen in der englischen MDR-Version je nach
    // Ansicht nicht "Unknown", sondern nur den Aktionslink "Name horse?".
    // Das ist kein Pferdename, sondern genau wie DE "Namen geben?" ein
    // eindeutiger Hinweis darauf, dass der Fohlenname noch fehlt.
    const giveNamePrompt = /(?:Namen geben|Name geben|Name horse|Name foal|Give (?:the )?horse (?:a )?name)\??\s*$/i;
    if (giveNamePrompt.test(rawName)) out._header_name_action = 'give-name';
    else if (/Rename\?/i.test(rawName)) out._header_name_action = 'rename';

    rawName = rawName
      .replace(/(?:Ändern\?|Rename\?)\s*$/i, '')
      .replace(giveNamePrompt, '')
      .trim();
    if (rawName) out.name = rawName;
  }

  // Beim Kopieren aus EN bzw. mobilen Ansichten können zwischen Alter,
  // Geschlecht, Rasse und Reinrassigkeit Leerzeilen liegen. Deshalb nicht
  // mehr mit starren +1/+2/+3-Indizes arbeiten.
  const after = [];
  for (let i = ageIdx + 1; i < lines.length && after.length < 3; i++) {
    if (lines[i]) after.push(lines[i]);
  }

  const genderLine = after[0];
  if (genderLine && /^(Stute|Hengst|Wallach|Hengstfohlen|Stutfohlen|Fohlen)$/i.test(genderLine)) {
    out.gender = genderLine;
  }
  const breedLine = after[1];
  if (breedLine) out.breed = normalizeBreed(breedLine);

  const purebredLine = after[2] || '';
  const pm = purebredLine.match(/([\d.,]+)\s*%\s*Reinrassig/i);
  if (pm) out.purebred_pct = parseFloat(pm[1].replace(',', '.'));

  return out;
}

// Extrahiert Tab- (oder Mehrfach-Leerzeichen-) getrennte "Label / Wert"
// Zeilen zwischen einer Start-Überschrift und einer der End-Überschriften.
function extractSimpleTable(lines, startLabel, endLabels) {
  const startIdx = lines.indexOf(startLabel);
  if (startIdx === -1) return [];
  const rows = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (endLabels.includes(line)) break;
    if (!line) continue;
    const parts = line.split(/\t+| {2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      rows.push({ label: parts[0], value: parts[1] });
    } else if (parts.length === 1 && rows.length > 0) {
      // z.B. eine weitere Überschrift ohne Tabellenzeile -> Tabelle beenden
      break;
    }
  }
  return rows;
}

// Jedes Körperteil hat einen Genotyp aus 16 Zeichen (2 Gruppen zu je 4
// zweistelligen Allel-Kürzeln, insgesamt 8+8 Buchstaben, getrennt durch
// "|"). Im Optimalfall sind die ersten 8 Buchstaben groß (H) und die
// letzten 8 klein (h) - gezählt wird, wie viele davon tatsächlich passen.
// Das entspricht genau der Punktzahl, die das Spiel selbst als "X/16"
// anzeigt (gegen mehrere echte Beispiele geprüft) - wird hier aber immer
// selbst berechnet, weil die mobile Kopiervariante des Spiels weder die
// einzelnen "X/16"-Werte noch die Gesamtzeile ("141/224 62.95%") enthält.
function computeExteriorScore(genotype) {
  const parts = (genotype || '').split('|').map((s) => s.replace(/\s+/g, ''));
  if (parts.length !== 2 || parts[0].length !== 8 || parts[1].length !== 8) return null;
  const front = [...parts[0]].filter((c) => c === 'H').length;
  const back = [...parts[1]].filter((c) => c === 'h').length;
  return front + back;
}

// Die genetische Exterieur-Tabelle hat 2-3 Spalten (Körperteil / Genotyp /
// ggf. die vom Spiel mitgelieferte Punktzahl - wird ignoriert, siehe oben).
function parseExteriorGenetics(lines) {
  const startIdx = lines.indexOf('Exterieur');
  if (startIdx === -1) return { rows: [], overall: null };
  const rows = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line === 'Leistung' || line === 'Körperbau' || line === 'Disziplin') break;
    if (/^\d+\/\d+\s+[\d.,]+\s*%$/.test(line)) continue; // vom Spiel mitgelieferte Gesamtzeile, wird selbst berechnet
    const parts = line.split(/\t+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2 && parts[1].includes('|')) {
      rows.push({ label: parts[0], genotype: parts[1] });
    }
  }

  let totalScore = 0;
  let totalMax = 0;
  for (const row of rows) {
    const score = computeExteriorScore(row.genotype);
    if (score === null) continue;
    row.score = `${score}/16`;
    totalScore += score;
    totalMax += 16;
  }
  const overall = totalMax > 0
    ? { score: `${totalScore}/${totalMax}`, percent: Math.round((totalScore / totalMax) * 10000) / 100 }
    : null;

  return { rows, overall };
}

// Sucht die erste Zeile mit exaktem Wert ab einem Startindex, oder -1.
function findLineIndex(lines, label, fromIdx = 0) {
  for (let i = fromIdx; i < lines.length; i++) {
    if (lines[i] === label) return i;
  }
  return -1;
}

// Disziplinen und Eigenschaften bestehen aus Gruppen (z.B. "Western",
// "Grundlagen"): eine Zeile ohne folgende Prozentwerte ist eine Gruppen-
// überschrift, eine Zeile gefolgt von zwei "NN %" Zeilen ist ein Eintrag
// mit aktuellem Wert und Potenzial. Manche Einträge (z.B. Gangarten, die
// das Pferd noch nicht "kann", oder die über "Alle Disziplinen anzeigen?"
// nachgeladenen Kategorien) zeigt das Spiel dagegen nur mit einem
// einzigen Prozentwert (Potenzial) an - auch das wird hier erkannt, statt
// diese Einträge komplett zu verlieren.
function extractPercentGroups(lines, startIdx, endIdx) {
  const percentRe = /^\d+(?:[.,]\d+)?\s*%$/;
  const result = {};
  let currentGroup = null;

  // Die englische MDR-Seite erzeugt beim Kopieren je nach Browser deutlich
  // mehr Leerzeilen als die deutsche Ansicht. Deshalb wird dieser Bereich
  // als Folge nichtleerer Tokens ausgewertet. So bleiben auch die zwei
  // Prozentwerte (aktueller Wert + Potenzial) zuverlässig dem richtigen
  // Disziplin-/Eigenschaftsnamen zugeordnet.
  const tokens = lines
    .slice(startIdx, endIdx)
    .map((line) => String(line || '').trim())
    .filter(Boolean);

  for (let i = 0; i < tokens.length; i++) {
    const line = tokens[i];
    const p1 = tokens[i + 1];
    const p2 = tokens[i + 2];
    if (p1 && percentRe.test(p1) && p2 && percentRe.test(p2)) {
      if (!currentGroup) currentGroup = 'Allgemein';
      (result[currentGroup] ||= []).push({
        name: line,
        current: parseFloat(p1.replace(',', '.')),
        potential: parseFloat(p2.replace(',', '.')),
      });
      i += 2;
    } else if (p1 && percentRe.test(p1)) {
      if (!currentGroup) currentGroup = 'Allgemein';
      (result[currentGroup] ||= []).push({
        name: line,
        current: null,
        potential: parseFloat(p1.replace(',', '.')),
      });
      i += 1;
    } else if (!percentRe.test(line)) {
      // Einzelne Prozent-Tokens dürfen niemals versehentlich zur
      // Gruppenüberschrift werden. Das war bei EN-Kopien mit Leerzeilen
      // bislang die Ursache für Gruppen wie "23 %".
      currentGroup = line;
    }
  }
  return result;
}

// Einfacher Fall (Eigenschaften): ein zusammenhängender Bereich zwischen
// zwei Überschriften, ohne Lücken dazwischen.
function extractPercentGroupsByLabel(lines, startLabel, endLabel) {
  const startIdx = lines.indexOf(startLabel);
  if (startIdx === -1) return {};
  const endIdxFound = findLineIndex(lines, endLabel, startIdx + 1);
  const endIdx = endIdxFound === -1 ? lines.length : endIdxFound;
  return extractPercentGroups(lines, startIdx + 1, endIdx);
}

// Disziplinen sind ein Sonderfall: das Spiel zeigt zunächst nur eine
// Kategorie (z.B. "Western") offen an, gefolgt von "Trainingszustand" und
// "Turnierpotenzial" (die einen eigenen Parser haben, s.u.
// parseTournamentPotential); die übrigen Kategorien folgen danach hinter
// "Alle Disziplinen anzeigen?". Der Trainingszustand/Turnierpotenzial-
// Block dazwischen wird hier bewusst übersprungen statt am Stück
// durchgescannt, da er selbst einzelne Prozentwerte enthält (z.B.
// "Fitness: 99 %"), die sonst fälschlich als Disziplinen-Einträge
// landen würden.
function extractDisciplineGroups(lines) {
  const startIdx = lines.indexOf('Disziplin');
  if (startIdx === -1) return {};
  const eigenschaftenIdx = findLineIndex(lines, 'Eigenschaften', startIdx + 1);
  const finalEndIdx = eigenschaftenIdx === -1 ? lines.length : eigenschaftenIdx;

  const trainingszustandIdx = findLineIndex(lines, 'Trainingszustand', startIdx + 1);
  const turnierpotenzialIdx = findLineIndex(lines, 'Turnierpotenzial', startIdx + 1);
  const junkCandidates = [trainingszustandIdx, turnierpotenzialIdx].filter((i) => i !== -1 && i < finalEndIdx);
  const junkStart = junkCandidates.length ? Math.min(...junkCandidates) : finalEndIdx;

  const showAllIdx = findLineIndex(lines, 'Alle Disziplinen anzeigen?', junkStart);
  const resumeIdx = showAllIdx !== -1 && showAllIdx < finalEndIdx ? showAllIdx + 1 : null;

  const result = extractPercentGroups(lines, startIdx + 1, junkStart);
  if (resumeIdx !== null) {
    const rest = extractPercentGroups(lines, resumeIdx, finalEndIdx);
    for (const [group, entries] of Object.entries(rest)) {
      result[group] = result[group] ? [...result[group], ...entries] : entries;
    }
  }
  return result;
}

function parseTournamentPotential(lines) {
  const startIdx = lines.indexOf('Turnierpotenzial');
  if (startIdx === -1) return {};
  const result = {};

  // EN-Seiten liefern diesen Block je nach Browser/Kopierweg in mehreren
  // Formen: einzelne Zeilen, Tabellenspalten per TAB oder beide Zellen in
  // einer Pipe-/Textzeile (z.B. "Talent: Trot Racing | Disciplines: 99").
  // Deshalb nicht mehr nur an TAB trennen, sondern die vier bekannten
  // Labels unabhängig voneinander aus dem kompletten Block herausziehen.
  const block = lines
    .slice(startIdx + 1, Math.min(startIdx + 24, lines.length))
    .filter(Boolean)
    .join('\n');

  const firstMatch = (patterns) => {
    for (const re of patterns) {
      const m = block.match(re);
      if (m) return String(m[1] || '').trim().replace(/^\*+|\*+$/g, '').trim();
    }
    return null;
  };

  const talent = firstMatch([
    /(?:^|[\n|\t])\s*(?:Begabung|Talent)\s*:\s*(.+?)(?=\s*(?:\||\t|\n|Disziplinen\s*:|Disciplines\s*:|$))/im,
    /(?:Begabung|Talent)\s*:\s*(.+?)\s+(?=(?:Disziplinen|Disciplines)\s*:)/i,
  ]);
  const disciplines = firstMatch([
    /(?:Disziplinen|Disciplines)\s*:\s*([\d.,]+)/i,
  ]);
  const overall = firstMatch([
    /(?:Gesamtpotenzial|Overall\s+potential)\s*:\s*([\d.,]+)/i,
  ]);
  const traits = firstMatch([
    /(?:Grundlagen|Traits)\s*:\s*([\d.,]+)/i,
  ]);

  if (talent) result.Begabung = normalizeTournamentDisciplineName(talent);
  if (disciplines) result.Disziplinen = disciplines;
  if (overall) result.Gesamtpotenzial = overall;
  if (traits) result.Grundlagen = traits;

  // Erfahrung/Experience kann ebenfalls als Label+Wert oder auf zwei
  // getrennten Zeilen vorkommen.
  const experienceDirect = firstMatch([
    /(?:Erfahrung|Experience)\s*:\s*([\d.,]+\s*%?)/i,
  ]);
  if (experienceDirect) {
    result.Erfahrung = /%$/.test(experienceDirect) ? experienceDirect : `${experienceDirect}%`;
  } else {
    const tokens = lines.slice(startIdx + 1, Math.min(startIdx + 28, lines.length)).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      if (!/^(?:Erfahrung|Experience)\s*:??$/i.test(String(tokens[i]).trim())) continue;
      const next = String(tokens[i + 1] || '').trim();
      if (/^[\d.,]+\s*%$/.test(next)) result.Erfahrung = next;
      break;
    }
  }

  return result;
}


// --- V53.1: Turniererfolge / MDR-Cup-Qualifikation -------------------------
// MDR zeigt „Erfolge“ und „Turniere“ als getrennte Reiter. Beim Kopieren
// kann deshalb entweder die Platzierungstabelle ODER die Cup-Qualifikation
// enthalten sein. Die Parser liefern absichtlich nur die Felder, die in der
// jeweiligen Ansicht wirklich vorhanden sind; beim erneuten Einlesen werden
// diese später in horseForm.js disziplinweise zusammengeführt.

function normalizeTournamentDisciplineName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return EN_TO_INTERNAL_EXACT[raw] || raw;
}

function tournamentDisciplineSet() {
  return new Set(Object.keys(typeof MDR_TOURNAMENT_DISCIPLINES !== 'undefined' ? MDR_TOURNAMENT_DISCIPLINES : {}));
}

function parseTournamentPlacements(lines) {
  let startIdx = findLineIndex(lines, 'Platzierungen');
  // Zusätzlicher Fallback für bereits gespeicherte/ältere EN-Rohtexte, die
  // vor der Normalisierung noch die MDR-Überschrift "Placings" enthalten.
  if (startIdx === -1) {
    startIdx = lines.findIndex((line) => /^(?:Placings|Placements)$/i.test(String(line || '').trim()));
  }
  if (startIdx === -1) return {};
  const endCandidates = [
    findLineIndex(lines, 'Statistik', startIdx + 1),
    findLineIndex(lines, 'Erfolge', startIdx + 1),
    findLineIndex(lines, 'Stammbaum', startIdx + 1),
  ].filter((i) => i !== -1);
  const endIdx = endCandidates.length ? Math.min(...endCandidates) : Math.min(lines.length, startIdx + 120);
  const known = tournamentDisciplineSet();
  const out = {};

  // Desktop-Kopie: Tabellenzeile als Tab-getrennte Zellen.
  for (let i = startIdx + 1; i < endIdx; i++) {
    const line = String(lines[i] || '').trim();
    if (!line) continue;
    const parts = line.includes('\t')
      ? line.split('\t').map((x) => x.trim()).filter(Boolean)
      : (/^\|.*\|$/.test(line)
        ? line.slice(1, -1).split('|').map((x) => x.trim().replace(/^\*\*|\*\*$/g, '')).filter(Boolean)
        : []);
    if (parts.length < 4) continue;
    const discipline = normalizeTournamentDisciplineName(parts[0]);
    if (!known.has(discipline)) continue;
    const nums = parts.slice(1, 4).map((x) => Number(String(x).replace(/[^0-9-]/g, '')));
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) continue;
    out[discipline] = { first: nums[0], second: nums[1], third: nums[2] };
  }

  // Mobile/abweichende Copy-Formate: Zellen können je eigene Zeilen sein.
  // Nur verwenden, wenn die betreffende Disziplin nicht schon als echte
  // Tabellenzeile erkannt wurde.
  const tokens = lines.slice(startIdx + 1, endIdx).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const discipline = normalizeTournamentDisciplineName(tokens[i]);
    if (!known.has(discipline) || out[discipline]) continue;
    const nums = [];
    for (let j = i + 1; j < Math.min(tokens.length, i + 8) && nums.length < 3; j++) {
      const t = tokens[j];
      if (known.has(normalizeTournamentDisciplineName(t))) break;
      if (/^\d+$/.test(t)) nums.push(Number(t));
    }
    if (nums.length === 3) out[discipline] = { first: nums[0], second: nums[1], third: nums[2] };
  }
  return out;
}

function parseCupQualifications(lines) {
  let startIdx = findLineIndex(lines, 'MDR-Cup Qualifikation');
  if (startIdx === -1) {
    startIdx = lines.findIndex((line) => /^MDR[- ]Cup\s+Qualif(?:ikation|ication|icationen|ications?)$/i.test(String(line || '').trim()));
  }
  if (startIdx === -1) return {};

  const endCandidates = [
    findLineIndex(lines, 'Gewinnsumme', startIdx + 1),
    findLineIndex(lines, 'Turniernennungen', startIdx + 1),
    findLineIndex(lines, 'Stammbaum', startIdx + 1),
  ].filter((i) => i !== -1);
  const endIdx = endCandidates.length ? Math.min(...endCandidates) : Math.min(lines.length, startIdx + 80);
  const known = tournamentDisciplineSet();
  const out = {};

  for (let i = startIdx + 1; i < endIdx; i++) {
    const line = String(lines[i] || '').trim();
    if (!line) continue;
    if (/noch keine .*cup.*qualifikation|no .*cup.*qualif/i.test(line)) return {};

    // DE: „Distanz (LK 10)“ / EN entsprechend mit ggf. englischem Namen.
    const m = line.match(/^(.+?)\s*\(\s*LK\s*(10|[1-9])\s*\)$/i);
    if (!m) continue;
    const discipline = normalizeTournamentDisciplineName(m[1]);
    if (!known.has(discipline)) continue;
    out[discipline] = { cup_star: true, cup_lk: `LK${m[2]}` };
  }
  return out;
}

function parseTournamentStarts(lines) {
  const labels = ['Turnierstarts', 'Starts'];
  for (const label of labels) {
    const direct = findValueForLabel(lines.filter(Boolean), label);
    if (direct != null) {
      const m = String(direct).match(/\d+/);
      if (m) return Number(m[0]);
    }
  }

  // Manche Kopierwege trennen Label und Wert auf zwei Zeilen.
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || '').trim();
    if (!/^(?:Turnierstarts|Starts)\s*:?$/i.test(line)) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const next = String(lines[j] || '').trim();
      if (/^\d+$/.test(next)) return Number(next);
      if (next) break;
    }
  }
  return null;
}

function mergeTournamentResultParts(...parts) {
  const out = {};
  for (const part of parts) {
    for (const [discipline, row] of Object.entries(part || {})) {
      out[discipline] = { ...(out[discipline] || {}), ...row };
    }
  }
  return out;
}

// Beim Kopieren von der mobilen Ansicht liefert das Spiel (anders als am
// Desktop) benannte Abschnittsüberschriften für die Vorfahren, die erst
// nach Klick auf "Großeltern/Urgroßeltern anzeigen?" überhaupt im Text
// auftauchen. Diese Überschriften werden beim Einlesen übersprungen (siehe
// unten), damit sie nicht fälschlich als Pferdename interpretiert werden -
// die Vorfahren selbst werden aber unabhängig von der Kopierquelle
// (Handy/Desktop) einheitlich als einfache Reihenfolge in "ancestors"
// gespeichert, damit beide Varianten identisch abgelegt und dargestellt
// werden.
const PEDIGREE_SECTION_LABELS = new Set([
  'Eltern des Vaters',
  'Eltern der Mutter',
  'Eltern des Großvaters väterlicherseits',
  'Eltern der Großmutter väterlicherseits',
  'Eltern des Großvaters mütterlicherseits',
  'Eltern der Großmutter mütterlicherseits',
]);


function isUnknownPedigreeName(value) {
  const s = String(value || '').trim().toLowerCase();
  return ['unbekannt','unknown','n/a','na','-','?','nicht bekannt','unbekanntes projekt','unknown project'].includes(s);
}


function normalizePedigreeLine(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function isPedigreeSectionHeading(line) {
  const s = normalizePedigreeLine(line);
  if (!s) return false;
  if (PEDIGREE_SECTION_LABELS.has(s)) return true;

  // English pedigree headings vary slightly by layout.
  // They are structural labels, never horse names.
  return /^(?:parents?|grandparents?)\b/i.test(s)
    || /\b(?:parents?|grandparents?)\s+of\s+(?:the\s+)?(?:sire|dam|father|mother|paternal|maternal)\b/i.test(s)
    || /^(?:sire|dam|father|mother|paternal|maternal).*(?:parents?|grandparents?)$/i.test(s);
}

function isPedigreeMetaLine(line) {
  const s = normalizePedigreeLine(line);
  if (!s) return true;
  if (isPedigreeSectionHeading(s)) return true;
  if (/anzeigen\?$|show(?:\s+more)?\?$/i.test(s)) return true;
  if (/^Potential\s*:\s*\d+/i.test(s)) return true;
  if (/^Diff\.-(?:GP Eltern|OP Parents)\s*:/i.test(s)) return true;
  if (/^(?:Pedigree|Stammbaum|Ownership history|Besitzhistorie)$/i.test(s)) return true;
  return false;
}

function isPedigreeBreedLine(line, mainBreed) {
  const s = normalizePedigreeLine(line);
  if (!s) return false;

  const normalized = normalizeBreed(s);
  const main = normalizeBreed(mainBreed || '');
  if (main && String(normalized).toLocaleLowerCase('de') === String(main).toLocaleLowerCase('de')) {
    return true;
  }

  // Common values already present in this local MDR database.
  // Exact mainBreed matching above remains the primary rule.
  const known = new Set([
    'thoroughbred',
    'american paint horse',
    'appaloosa',
    'andalusier',
    'rasselos',
    'grade horse',
    'mixed breed',
  ]);
  if (known.has(String(normalized).toLocaleLowerCase('de'))) return true;

  // Breed-composition rows are never names.
  return /^\d+(?:[.,]\d+)?\s*%\s+/.test(s);
}

function parsePedigree(lines, mainBreed) {
  // Anker ist "Besitzhistorie", nicht "Stammbaum": beim Kopieren von der
  // mobilen Ansicht fehlt die Überschrift "Stammbaum" komplett, während
  // "Besitzhistorie" in beiden Varianten unmittelbar davor steht. Steht
  // "Stammbaum" (Desktop-Navigationspunkt) kurz danach noch im Text, wird
  // es zusätzlich übersprungen, damit es nicht fälschlich als Pferdename
  // interpretiert wird.
  let startIdx = lines.indexOf('Besitzhistorie');
  if (startIdx === -1) {
    startIdx = lines.indexOf('Stammbaum');
    if (startIdx === -1) return { ancestors: [], sections: null };
  } else {
    for (let i = startIdx + 1; i < Math.min(startIdx + 4, lines.length); i++) {
      if (lines[i] === 'Stammbaum') { startIdx = i; break; }
    }
  }
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i] === 'Exterieur' || lines[i] === 'Körperbau') {
      endIdx = i;
      break;
    }
  }
  const segment = lines.slice(startIdx + 1, endIdx).filter(Boolean);

  const ancestors = [];
  let current = null;
  let sawSelf = false;
  let lastEntry = null;

  for (let i = 0; i < segment.length; i++) {
    const line = normalizePedigreeLine(segment[i]);
    if (!line) continue;

    if (isPedigreeSectionHeading(line)) {
      current = null;
      continue;
    }
    if (/anzeigen\?$|show(?:\s+more)?\?$/i.test(line)) continue;

    const potMatch = line.match(/^Potential:\s*(\d+)$/i);
    if (potMatch) {
      if (lastEntry) lastEntry.potential = parseInt(potMatch[1], 10);
      continue;
    }
    if (/^Diff\.-(?:GP Eltern|OP Parents):/i.test(line)) continue;

    if (isUnknownPedigreeName(line) && !current) {
      if (!sawSelf) {
        current = { name: 'Unbekannt' };
        continue;
      }
      const entry = { name: 'Unbekannt', breed: mainBreed || 'Unbekannt' };
      ancestors.push(entry);
      lastEntry = entry;
      continue;
    }

    // A breed line may complete a pending horse, but it may NEVER
    // start a new ancestor. This directly prevents "Thoroughbred"
    // from becoming a shared ancestor name.
    if (isPedigreeBreedLine(line, mainBreed)) {
      if (current && !current.breed) {
        current.breed = normalizeBreed(line);
        if (!sawSelf) {
          sawSelf = true;
        } else {
          ancestors.push(current);
        }
        lastEntry = current;
        current = null;
      }
      continue;
    }

    if (!current) {
      current = { name: line };
      continue;
    }

    // Arbitrary ancestor breed names may differ from mainBreed.
    // If the NEXT line is "Potential: N", the current line is a breed,
    // even when it is not in our known breed list.
    const next = normalizePedigreeLine(segment[i + 1] || '');
    if (/^Potential:\s*\d+$/i.test(next)) {
      current.breed = normalizeBreed(line);
      if (!sawSelf) {
        sawSelf = true;
      } else {
        ancestors.push(current);
      }
      lastEntry = current;
      current = null;
      continue;
    }

    // Two consecutive non-meta/non-breed lines indicate that the first
    // one was most likely an unrecognised EN structural label. Keep the
    // newer line as the horse-name candidate instead of shifting the
    // entire pedigree by one row.
    current = { name: line };
  }

  return { ancestors, sections: null };
}

// Gemeinsame Bewertungs-, Genetik-, Tag-, Alters- und Filterhelfer stehen seit V54.0.75 in horse-data-utils.js.

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseHorseText };
}
