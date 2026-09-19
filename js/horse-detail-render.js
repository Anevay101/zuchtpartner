// MDR V54.0.75 – gemeinsame Detaildarstellung für Pferd bearbeiten/ansehen.
// Aus horseForm.js herausgezogen, damit view.html nicht mehr das komplette
// Formular-, Import- und Speicher-Modul laden muss.

function appaloosaPatternStatusHtml(data) {
  if (typeof appaloosaPatternStateForHorse !== 'function') return '';
  const info = appaloosaPatternStateForHorse(data);
  if (!info?.relevant) return '';

  const symbol = { yes: '✓', no: '✗', unknown: '?' };
  const cls = { yes: 'yes', no: 'no', unknown: 'unknown' };
  const p1Title = info.testedP1
    ? `P1: ${info.testedP1} (Gentest)`
    : info.states.P1 === 'unknown'
      ? 'P1: unbekannt / nicht ableitbar'
      : `P1: aus sichtbarem Muster ${info.pattern || 'abgeleitet'}`;
  const titleFor = (key) => key === 'P1'
    ? p1Title
    : info.states[key] === 'unknown'
      ? `${key}: durch höheres Pattern verdeckt / unbekannt`
      : `${key}: aus sichtbarem Muster ${info.pattern || 'abgeleitet'} abgeleitet`;
  const chips = ['P1','P2','P3'].map((key) => {
    const state = info.states[key] || 'unknown';
    return `<span class="app-pattern-state app-pattern-${cls[state]}" title="${escapeHtml(titleFor(key))}"><strong>${key}</strong> ${symbol[state]}</span>`;
  }).join('');

  return `<div class="app-pattern-compact">
    <span class="app-pattern-label">Pattern</span>${chips}
    <span class="tiny muted app-pattern-legend">✓ vorhanden · ✗ nicht vorhanden · ? verdeckt/unbekannt</span>
    ${info.contradiction ? '<span class="tiny app-pattern-warning">⚠ PATN1-Test und sichtbares Muster widersprechen sich</span>' : ''}
  </div>`;
}

// --- Detail-Tabellen (nur Anzeige) ---

// Verteilt die erkannten Detaildaten auf die 4 Reiter (Stammdaten/
// Genetik/Turnierwerte/Stammbaum, siehe horse.html/view.html + wireTabs)
// statt sie wie zuvor in einem einzigen Block anzuzeigen. Das
// Fohlen-Popup in verpaarung.html nutzt dieselben Funktionen aber noch
// ein einzelnes "detail-tables" (keine Reiter, dafür kompakter) -
// fillDetailContainer() ist daher pro Container ein No-Op, falls das
// jeweilige Ziel-Element auf der aktuellen Seite gar nicht existiert, und
// am Ende wird zusätzlich - nur falls vorhanden - alles gesammelt in
// "detail-tables" geschrieben.
async function renderDetailTables(data) {
  const genetikParts = [];
  const turnierParts = [];
  const stammbaumParts = [];

  if (data.genetic_diseases?.length || data.colors?.length) {
    genetikParts.push(diseaseTableHtml(data.genetic_diseases, data.disease_gene_overrides));
  }
  const appPatternStatus = appaloosaPatternStatusHtml(data);
  if (appPatternStatus) genetikParts.push(appPatternStatus);
  if (data.colors?.length) {
    const notes = document.getElementById('notes')?.value ?? data?.notes ?? '';
    const horseName = document.getElementById('name')?.value ?? data?.name ?? '';
    const { hints: parentHints, absences: parentAbsences, parentMightHavePearl } = await fetchParentColorHints(data.pedigree, data.coat_color, notes, horseName);
    genetikParts.push(colorGeneticsHtml(data.colors, data.coat_color, notes, horseName, parentHints, data.color_gene_overrides, parentMightHavePearl, parentAbsences));
  }
  if (data.exterior_genetics?.rows?.length) genetikParts.push(exteriorGeneticsHtml(data.exterior_genetics));
  if (data.exterior_descriptive?.length) {
    genetikParts.push(scoredTableHtml(
      'Exterieur (Körperbau)', data.exterior_descriptive, scoreExteriorTerm,
      'Skala 1 = exzellent … 3 = passabel … 5 = stark abweichend',
    ));
  }
  if (data.temperament?.length) {
    genetikParts.push(scoredTableHtml(
      'Interieur (Mentalität)', data.temperament, scoreTemperamentTerm,
      'Skala 1 = exzellent … 4 = schlecht',
    ));
  }

  if (data.tournament_potential && Object.keys(data.tournament_potential).length) {
    turnierParts.push(tournamentSummaryHtml(data.tournament_potential, data.disciplines));
  }
  if (data.disciplines && Object.keys(data.disciplines).length) turnierParts.push(percentGroupsHtml('Disziplinen', data.disciplines, true, data));
  if (data.traits && Object.keys(data.traits).length) turnierParts.push(percentGroupsHtml('Eigenschaften', data.traits, true));

  if (hasPedigreeData(data.pedigree)) {
    const pedigreeLinks = await getPedigreeHorseLinkMap();
    stammbaumParts.push(pedigreeHtml(data.pedigree, pedigreeLinks));
  }

  fillDetailContainer('detail-genetik', genetikParts);
  fillDetailContainer('detail-turnier', turnierParts);
  fillDetailContainer('detail-stammbaum', stammbaumParts);
  if (typeof renderCupResultsEditor === 'function') renderCupResultsEditor(data);

  const legacyContainer = document.getElementById('detail-tables');
  if (legacyContainer) {
    const allParts = [...genetikParts, ...turnierParts, ...stammbaumParts];
    legacyContainer.innerHTML = allParts.join('');
    const legacyFieldset = document.getElementById('detail-fieldset');
    if (legacyFieldset) legacyFieldset.hidden = allParts.length === 0;
  }
}

function fillDetailContainer(id, parts) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = parts.join('');
}

// --- Reiter (Stammdaten/Genetik/Turnierwerte/Stammbaum) ---
// Auf horse.html UND view.html verwendet (siehe wireTabs()-Aufruf in
// init() bzw. horseView.js/initView()) - auf verpaarung.html's
// Fohlen-Popup gibt es keine ".tab-btn"-Elemente, wireTabs() findet dort
// also einfach nichts und tut nichts.
function wireTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });
}

function activateTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== tab;
  });
}

function simpleTableHtml(title, rows) {
  const body = rows.map((r) => `<tr><th>${escapeHtml(r.label)}</th><td>${escapeHtml(r.value)}</td></tr>`).join('');
  return `<div class="group-heading">${escapeHtml(title)}</div><table class="detail-table">${body}</table>`;
}

// Wie geneOverrideBadge, aber mit auf Erbkrankheiten zugeschnittenem
// Wortlaut ("Träger"/"Betroffen"/"Frei" statt "1x/2x vorhanden"/"nicht
// vorhanden") - optisch identisch (dieselben CSS-Klassen und
// Zustandssymbole), nur andere Tooltip-Bedeutung. data-override-group
// unterscheidet im Klick-Handler zwischen Farbgenetik und Erbkrankheiten
// (siehe document.addEventListener('click', ...) oben).
function diseaseOverrideBadge(code, state) {
  const stateInfo = {
    het: { label: '1×', cls: 'het', title: 'Träger (mischerbig)' },
    hom: { label: '2×', cls: 'hom', title: 'Betroffen (reinerbig)' },
    absent: { label: '✗', cls: 'absent', title: 'Frei (kein Risikoallel bekannt)' },
  }[state] || { label: '?', cls: 'unknown', title: 'Unbekannt, ob Träger/betroffen' };
  const label = `${code} ${stateInfo.label}`;
  const title = `${code}: ${stateInfo.title} – zum Ändern klicken`;
  return `<button type="button" class="gene-override gene-override-${stateInfo.cls}" data-override-locus="${escapeHtml(code)}" data-override-group="disease" title="${escapeHtml(title)}">${escapeHtml(label)}</button>`;
}

// Zeigt für jede bekannte Krankheit (KNOWN_DISEASE_CODES, siehe
// parser.js) entweder das tatsächliche Testergebnis (Rohwert wie
// "NN/NN", unverändert) oder - falls die Krankheit im Text komplett
// fehlte ODER dort explizit als "Nicht getestet" stand (beides kommt
// vor, je nach Spielversion/Kopierweg) - eine "Nicht getestet"-Zeile mit
// Klick-Button zur manuellen Träger/Betroffen/Frei-Bestätigung, z.B. für
// junge Fohlen, die noch nicht beim Tierarzt getestet wurden.
function diseaseTableHtml(diseases, overrides) {
  const rows = diseases || [];
  const ov = overrides || {};
  const valueByCode = {};
  for (const r of rows) valueByCode[r.label] = r.value;
  // Krankheiten aus dem Text, die nicht zu den bekannten Kürzeln gehören,
  // trotzdem mit anzeigen (unverändert, ohne Klick-Button) statt sie
  // stillschweigend zu verlieren.
  const extraCodes = rows.map((r) => r.label).filter((code) => !KNOWN_DISEASE_CODES.includes(code));

  const body = [...KNOWN_DISEASE_CODES, ...extraCodes].map((code) => {
    const rawValue = valueByCode[code];
    if (rawValue !== undefined && !isUntestedLocusValue(rawValue)) {
      return `<tr><th>${escapeHtml(code)}</th><td>${escapeHtml(rawValue)}</td></tr>`;
    }
    const state = ov[code] || null;
    let text = 'Nicht getestet';
    if (state === 'het') text += ' — Träger (manuell)';
    else if (state === 'hom') text += ' — betroffen, reinerbig (manuell)';
    else if (state === 'absent') text += ' — frei (manuell)';
    const badge = diseaseOverrideBadge(code, state);
    return `<tr><th>${escapeHtml(code)}</th><td class="gene-cell"><span class="gene-value-text">${text}</span><span class="gene-badges">${badge}</span></td></tr>`;
  }).join('');

  return `<div class="group-heading">Erbkrankheiten</div><table class="detail-table">${body}</table>`;
}

// Wie simpleTableHtml, aber zusätzlich mit berechnetem Durchschnitt anhand
// einer Bewertungsskala (siehe scoreExteriorTerm/scoreTemperamentTerm in
// parser.js).
function scoredTableHtml(title, rows, scoreFn, scaleHint) {
  const base = simpleTableHtml(title, rows);
  const avg = averageScore(rows, scoreFn);
  if (avg === null) return base;
  return `${base}<p class="small muted">Durchschnitt: <strong>${avg.toFixed(2)}</strong> (${escapeHtml(scaleHint)})</p>`;
}

function exteriorGeneticsHtml(ext) {
  const body = ext.rows.map((r) => {
    const pct = fractionToPercent(r.score);
    const pctText = pct !== null ? ` — ${pct.toFixed(1)}%` : '';
    return `<tr><th>${escapeHtml(r.label)}</th><td>${escapeHtml(r.genotype)} — ${escapeHtml(r.score)}${pctText}</td></tr>`;
  }).join('');
  const overall = ext.overall
    ? `<p class="small muted">Exterieur-Gesamtwert (genetisch): <strong>${ext.overall.percent}%</strong> (${escapeHtml(ext.overall.score)})</p>`
    : '';
  return `<div class="group-heading">Exterieur (Genetik)</div><table class="detail-table">${body}</table>${overall}`;
}

// Klick-Button je nicht getestetem Locus/Allel (siehe nextOverrideState in
// parser.js) - Klick-Zyklus: unbekannt -> 1x vorhanden -> 2x vorhanden
// (reinerbig, außer bei Overo) -> nicht vorhanden -> zurück zu unbekannt.
// "key" ist entweder der bloße Locus-Name ("Champagne") oder bei Loci mit
// mehreren Allelen (siehe LOCUS_MULTI_ALLELES) "Locus:Allel" ("KIT:To") -
// "allelePrefix" zeigt dann zusätzlich, welches Allel gemeint ist. Auf der
// reinen Ansichtsseite (view.html, .view-mode) nur Anzeige, siehe CSS und
// den Klick-Handler weiter unten.
function geneOverrideBadge(key, state, allelePrefix) {
  const stateInfo = {
    het: { label: '1×', cls: 'het', title: '1x vorhanden (mischerbig)' },
    hom: { label: '2×', cls: 'hom', title: '2x vorhanden (reinerbig)' },
    absent: { label: '✗', cls: 'absent', title: 'nicht vorhanden' },
  }[state] || { label: '?', cls: 'unknown', title: 'Unbekannt, ob vorhanden' };
  const prefix = allelePrefix ? `${allelePrefix}: ` : '';
  const label = allelePrefix ? `${allelePrefix} ${stateInfo.label}` : stateInfo.label;
  const title = `${prefix}${stateInfo.title} – zum Ändern klicken`;
  return `<button type="button" class="gene-override gene-override-${stateInfo.cls}" data-override-locus="${escapeHtml(key)}" title="${escapeHtml(title)}">${escapeHtml(label)}</button>`;
}

// Name (Fellfarbe) + Rohwerte je Locus + Zusammenfassung der tatsächlich
// vorhandenen Gene (großgeschrieben = vorhanden, Ausnahme "pl"). Bei nicht
// getesteten Loci werden zusätzlich Hinweise aus Fellfarbe-Namen, Notiz
// UND (falls Vater/Mutter in der Datenbank stehen) den Eltern einbezogen:
// reinerbig vorhandene Allele als sichere positive Hinweise und bei BEIDEN
// Eltern sicher fehlende Allele als genetisch ausgeschlossen. -
// eine manuelle Bestätigung/Ausschluss (overrides, per Klick-Button,
// siehe geneOverrideBadge) hat dabei Vorrang vor diesen automatischen
// Hinweisen.
function colorGeneticsHtml(rows, coatColorName, notes, horseName, parentHints, overrides, parentMightHavePearl, parentAbsences) {
  const ov = overrides || {};
  const inheritedAbsences = new Set(parentAbsences || []);
  const hints = [
    ...inferGeneticHintsFromPhenotype(coatColorName, parentMightHavePearl),
    ...inferGeneticHintsFromPhenotype(notes, parentMightHavePearl),
    ...inferGeneticHintsFromPhenotype(horseName, parentMightHavePearl),
    ...(parentHints || []).map((h) => ({ locus: h.locus, allele: h.alleles, fromParent: true })),
  ];
  const hintsByLocus = {};
  for (const h of hints) {
    const list = (hintsByLocus[h.locus] ||= []);
    if (!list.some((x) => x.allele === h.allele)) list.push(h);
  }

  // Flaxen wird vom Spiel nie als eigener Locus getestet (siehe
  // presentGenesSummary in parser.js) und taucht deshalb nie in "rows"
  // auf - trotzdem braucht es eine eigene Zeile mit Klick-Button, damit
  // sich z.B. eine Vererbung vom Elternteil (siehe parentHomozygousLoci)
  // dort auch anzeigen und manuell bestätigen lässt. Nur für die Anzeige
  // ergänzt, presentGenesSummary weiter unten bekommt weiterhin die
  // ungeänderten "rows" (dort wird Flaxen unabhängig davon schon aus
  // Fellfarbe/Notiz/Name/Elternteil abgeleitet).
  const displayRows = [...rows, { label: 'Flaxen', value: 'Nicht getestet' }];

  const body = displayRows.map((r) => {
    let value = escapeHtml(r.value);
    const untested = isUntestedLocusValue(r.value);
    const multiAlleles = LOCUS_MULTI_ALLELES[r.label];
    let badges = '';

    if (untested && multiAlleles) {
      // Loci mit mehreren unabhängigen Allelen (KIT/Agouti) - je Allel
      // eigener Zustand/Text/Klick-Button statt nur einem für den ganzen
      // Locus (siehe LOCUS_MULTI_ALLELES).
      const parts = [];
      for (const allele of multiAlleles) {
        const key = `${r.label}:${allele}`;
        const state = ov[key] || null;
        const inheritedAbsent = !state && inheritedAbsences.has(key);
        if (state === 'absent') {
          parts.push(`${allele}: nicht vorhanden (manuell)`);
        } else if (state) {
          parts.push(`${allele}: ${state === 'hom' ? 'reinerbig' : 'mindestens 1x'} vorhanden (manuell)`);
        } else {
          // Manche abgeleiteten Hinweise sind schon verdoppelt (z.B. "pl"
          // bei Pearl, das nur reinerbig sichtbar ist, siehe
          // PHENOTYPE_GENE_HINTS) - dann nicht nur auf exakte Gleichheit
          // mit dem einfachen Allel-Kürzel prüfen, sondern auch auf die
          // doppelte Form, und den Text entsprechend anpassen.
          const hint = hintsByLocus[r.label]?.find((h) => h.allele === allele || h.allele === allele + allele);
          if (hint) {
            const isDoubled = hint.allele === allele + allele;
            parts.push(`${allele}: ${isDoubled ? 'reinerbig' : 'mindestens 1x'} vorhanden (${hint.fromParent ? 'laut Elternteil' : 'laut Fellfarbe/Notiz'})`);
          } else if (inheritedAbsent) {
            parts.push(`${allele}: nicht vorhanden (durch beide Eltern genetisch ausgeschlossen)`);
          }
        }
        badges += geneOverrideBadge(key, inheritedAbsent ? 'absent' : state, allele);
      }
      if (parts.length) value += ' — ' + parts.join(', ');
    } else if (untested) {
      const overrideState = ov[r.label] || null;
      const inheritedAbsent = !overrideState && inheritedAbsences.has(r.label);
      if (overrideState) {
        const primary = LOCUS_PRIMARY_ALLELE[r.label];
        if (overrideState === 'absent') {
          value += ' — manuell als nicht vorhanden markiert';
        } else if (primary) {
          const code = overrideState === 'hom' ? primary + primary : primary;
          value += ` — ${overrideState === 'hom' ? 'reinerbig' : 'mindestens'} ${escapeHtml(code)} vorhanden (manuell)`;
        } else {
          value += ` — manuell als ${overrideState === 'hom' ? '2x' : '1x'} vorhanden markiert`;
        }
      } else if (hintsByLocus[r.label]) {
        const fromPhenotype = hintsByLocus[r.label].filter((h) => !h.fromParent).map((h) => h.allele);
        const fromParent = hintsByLocus[r.label].filter((h) => h.fromParent).map((h) => h.allele);
        const parts = [];
        if (fromPhenotype.length) parts.push(`mindestens ${escapeHtml(fromPhenotype.join(', '))} (laut Fellfarbe/Notiz)`);
        if (fromParent.length) parts.push(`mindestens ${escapeHtml(fromParent.join(', '))} (laut Elternteil)`);
        value += ' — ' + parts.join(', ');
      } else if (inheritedAbsent) {
        value += ' — nicht vorhanden (durch beide Eltern genetisch ausgeschlossen)';
      }
      badges = geneOverrideBadge(r.label, inheritedAbsent ? 'absent' : overrideState, LOCUS_PRIMARY_ALLELE[r.label]);
    }
    // Text und Klick-Button(s) in getrennten Spans innerhalb einer
    // Flex-Zelle, damit die Buttons unabhängig von der (je Zeile
    // unterschiedlich langen) Hinweis-Textlänge immer an derselben
    // Position stehen und so über alle Zeilen hinweg miteinander
    // ausgerichtet sind (siehe CSS .detail-table td.gene-cell).
    const cellClass = badges ? ' class="gene-cell"' : '';
    const cellContent = badges
      ? `<span class="gene-value-text">${value}</span><span class="gene-badges">${badges}</span>`
      : value;
    return `<tr><th>${escapeHtml(r.label)}</th><td${cellClass}>${cellContent}</td></tr>`;
  }).join('');

  const nameLine = coatColorName ? `<p class="small muted">Name: <strong>${escapeHtml(coatColorName)}</strong></p>` : '';

  const summary = presentGenesSummary(rows, coatColorName, notes, horseName, parentHints, overrides, parentMightHavePearl);
  let summaryHtml = '';
  if (summary.length) {
    const text = summary.map((s) => {
      if (s.source === 'abgeleitet') return `${s.alleles} (abgeleitet)`;
      if (s.source === 'elternteil') return `${s.alleles} (von Elternteil)`;
      if (s.source === 'manuell') return `${s.alleles} (manuell)`;
      return s.alleles;
    }).join(', ');
    summaryHtml = `<p class="small muted">Vorhandene Gene: <strong>${escapeHtml(text)}</strong></p>`;
  } else {
    summaryHtml = '<p class="small muted">Keine vorhandenen Gene erkannt.</p>';
  }

  return `<div class="group-heading">Farbgenetik</div>${nameLine}<table class="detail-table">${body}</table>${summaryHtml}`;
}

// Liest Vater/Mutter aus dem Stammbaum (erste zwei Einträge, siehe
// parser.js/parsePedigree - "Eltern des Vaters" kommt im Text immer vor
// "Eltern der Mutter", die direkten Eltern folgen derselben Reihenfolge)
// und lädt ihre Daten, falls sie unter diesem Namen bereits in der
// Datenbank stehen.
async function fetchParentRecords(pedigree) {
  const ancestors = Array.isArray(pedigree) ? pedigree.slice(1) : (pedigree?.ancestors || []);
  const parentNames = [ancestors[0]?.name, ancestors[1]?.name].filter(Boolean);
  if (!parentNames.length) return [];

  const all = await localGetAll(LOCAL_STORES.horses);
  const nameSet = new Set(parentNames.map((n) => n.toLowerCase()));
  return all.filter((h) => nameSet.has((h.name || '').toLowerCase()));
}

// Reinerbig vorhandene Loci eines Elternteils - sowohl bestätigt
// (getestet) als auch abgeleitet (z.B. aus dem Namen "Cremello" oder
// einem doppelten Kürzel "SPLSPL" in der Notiz), siehe
// presentGenesSummary/isDoubledAllele in parser.js. Ein reinerbiger
// Elternteil vererbt sein Allel garantiert (100%) - beim Fohlen selbst
// bedeutet das aber erstmal nur EINE garantierte Kopie (mischerbig),
// nicht zwangsläufig reinerbig (siehe parentColorHints).
function parentHomozygousLoci(parent) {
  const genes = presentGenesSummary(parent.colors, parent.coat_color, parent.notes, parent.name, null, parent.color_gene_overrides);
  const map = {};
  for (const g of genes) {
    if (isDoubledAllele(g.alleles)) map[g.locus] = halveDoubledAllele(g.alleles);
  }
  return map;
}

// Ist ein Locus bei GENAU EINEM Elternteil reinerbig vorhanden, weiß man
// beim Fohlen (falls dort selbst nicht vollständig getestet) nur, dass
// mindestens eine Kopie davon vorhanden ist (mischerbig) - welches Allel
// der zweite Elternteil weitergibt, ist Zufall. Sind dagegen BEIDE
// Elternteile für denselben Locus reinerbig mit demselben Allel, ist auch
// das Fohlen zwingend reinerbig dafür.
function parentColorHints(parents) {
  const perParent = parents.map(parentHomozygousLoci);
  const loci = new Set();
  perParent.forEach((m) => Object.keys(m).forEach((l) => loci.add(l)));

  const hints = [];
  for (const locus of loci) {
    const values = perParent.map((m) => m[locus]).filter(Boolean);
    const uniqueValues = [...new Set(values)];
    if (uniqueValues.length === 1 && values.length >= 2) {
      hints.push({ locus, alleles: uniqueValues[0] + uniqueValues[0] });
    } else {
      for (const v of uniqueValues) hints.push({ locus, alleles: v });
    }
  }
  return hints;
}

// Sonderfall "Pinto" (siehe pintoPatternsFromColors in parser.js): allein
// aus dem Namen lässt sich nicht sagen, welche 2 der 4 Scheckungs-Muster
// gemeint sind - stehen bei den Eltern zusammen aber genau 2 dieser 4
// Muster getestet vorhanden, muss ein sichtbar "Pinto" bezeichnetes Fohlen
// genau diese geerbt haben.
function pintoParentHints(parents, coatColorName, notes, horseName) {
  const isPinto = /\bpinto\b/i.test(`${coatColorName || ''} ${notes || ''} ${horseName || ''}`);
  if (!isPinto) return [];

  const combined = new Set();
  for (const parent of parents) {
    for (const p of pintoPatternsFromColors(parent.colors)) combined.add(p);
  }
  if (combined.size !== 2) return [];

  return [...combined].map((allele) => ({ locus: PINTO_ALLELE_LOCUS[allele], alleles: allele }));
}

// Ob mindestens ein Elternteil überhaupt ein pl-Allel zeigt - einfach
// (Träger) ODER reinerbig, egal ob getestet oder selbst schon abgeleitet
// (z.B. aus "Apricot" im Namen). Anders als parentHomozygousLoci (nur
// reinerbige Loci, für garantierte Vererbung) zählt hier bereits ein
// einzelnes "pl". Wird für die "ambiguousCream"-Einträge in
// PHENOTYPE_GENE_HINTS gebraucht (Cremello/Perlino/Smoky Cream/...): nur
// wenn ein Elternteil nachweislich pl trägt, könnte das zweite "Cr" des
// Fohlens tatsächlich ein "pl" sein (optisch nicht unterscheidbar) - sonst
// bleibt es beim einfacheren Regelfall CrCr.
function parentsMightHavePearl(parents) {
  return parents.some((p) => {
    const entry = (p.colors || []).find((c) => c.label === 'Cream');
    if (entry && !isUntestedLocusValue(entry.value) && /pl/i.test(entry.value)) return true;
    const genes = presentGenesSummary(p.colors, p.coat_color, p.notes, p.name, null, p.color_gene_overrides);
    return genes.some((g) => g.locus === 'Cream' && /pl/i.test(g.alleles));
  });
}

// Liefert für einen Elternteil alle Farballele, die durch einen echten
// getesteten Genotyp ODER eine bewusste manuelle ✗-Bestätigung sicher
// ausgeschlossen sind. Sichtbare Fellfarbe allein reicht dafür absichtlich
// nicht aus: Die Negativ-Ableitung soll nur auf harter Information beruhen.
//
// Beispiele:
//   Champagne chch -> „Champagne“ ausgeschlossen
//   Silver zz      -> „Silver“ ausgeschlossen
//   Cream Crcr     -> „Cream:pl“ ausgeschlossen, Cr aber vorhanden
//   KIT toto       -> „KIT:To“ ausgeschlossen
function parentConfirmedColorAbsenceKeys(parent) {
  const out = new Set();
  const rows = Array.isArray(parent?.colors) ? parent.colors : [];
  const testedLoci = new Set();

  const hasAllele = (present, allele) => {
    if (!present || !allele) return false;
    return String(present).toLowerCase().includes(String(allele).toLowerCase());
  };

  for (const row of rows) {
    if (!row || isUntestedLocusValue(row.value)) continue;
    const locus = typeof normalizeColorLocusLabel === 'function'
      ? normalizeColorLocusLabel(row.label)
      : row.label;
    testedLoci.add(locus);
    const present = extractPresentAlleles(row.value);
    const multi = LOCUS_MULTI_ALLELES[locus];
    if (multi) {
      for (const allele of multi) {
        if (!hasAllele(present, allele)) out.add(`${locus}:${allele}`);
      }
    } else {
      const allele = LOCUS_PRIMARY_ALLELE[locus];
      if (allele && !hasAllele(present, allele)) out.add(locus);
    }
  }

  // Manuelle ✗-Bestätigungen zählen ebenfalls als sichere Negativangabe,
  // solange kein echter Test für denselben Locus vorliegt. Ein vorhandener
  // Test bleibt immer maßgeblich.
  const overrides = parent?.color_gene_overrides || {};
  for (const [key, state] of Object.entries(overrides)) {
    if (state !== 'absent') continue;
    const locus = localeOfOverrideKey(key);
    if (!testedLoci.has(locus)) out.add(key);
  }
  return out;
}

// Eine Negativ-Aussage fürs Fohlen ist nur dann genetisch sicher, wenn
// BEIDE direkten Eltern genau dieses Allel sicher nicht besitzen. Ein
// fehlender/uneindeutiger Eltern-Datensatz erzeugt daher bewusst keinen
// automatischen ✗-Status.
async function fetchParentColorAbsenceHints(pedigree) {
  const ancestors = Array.isArray(pedigree) ? pedigree.slice(1) : (pedigree?.ancestors || []);
  const parentNames = [ancestors[0]?.name, ancestors[1]?.name].filter(Boolean);
  if (parentNames.length !== 2) return [];

  const all = await localGetAll(LOCAL_STORES.horses);
  const resolved = [];
  for (const name of parentNames) {
    const matches = all.filter((h) => String(h?.name || '').trim().toLowerCase() === String(name).trim().toLowerCase());
    // Bei Namens-Dubletten lieber nichts ableiten als das falsche Pferd
    // als Elternteil zu verwenden.
    if (matches.length !== 1) return [];
    resolved.push(matches[0]);
  }
  if (resolved[0]?.id != null && resolved[1]?.id != null && resolved[0].id === resolved[1].id) return [];

  const left = parentConfirmedColorAbsenceKeys(resolved[0]);
  const right = parentConfirmedColorAbsenceKeys(resolved[1]);
  return [...left].filter((key) => right.has(key));
}

async function fetchParentColorHints(pedigree, coatColorName, notes, horseName) {
  const parents = await fetchParentRecords(pedigree);
  const absences = await fetchParentColorAbsenceHints(pedigree);
  return {
    hints: [
      ...parentColorHints(parents),
      ...pintoParentHints(parents, coatColorName, notes, horseName),
    ],
    absences,
    parentMightHavePearl: parentsMightHavePearl(parents),
  };
}

// GP (Gesamtpotenzial) und Begabung stehen im Text schon zusammen; die
// Hauptdisziplin (übergeordnete Kategorie der Begabung, z.B. "Western" für
// "Trail") wird hier aus den bereits geparsten Disziplin-Gruppen abgeleitet.
function tournamentSummaryHtml(tp, disciplines) {
  const gp = tp['Gesamtpotenzial'];
  const begabung = tp['Begabung'];
  const hauptdisziplin = findDisciplineCategory(disciplines, begabung);

  const rows = [];
  if (gp) rows.push(['GP (Gesamtpotenzial)', gp]);
  if (tp['Disziplinen']) rows.push(['Disziplinen gesamt', tp['Disziplinen']]);
  if (tp['Grundlagen']) rows.push(['Grundlagen gesamt', tp['Grundlagen']]);
  if (hauptdisziplin) rows.push(['Hauptdisziplin', hauptdisziplin]);
  if (begabung) rows.push(['Begabung', begabung]);

  const body = rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('');
  return `<div class="group-heading">Turnierpotenzial – Übersicht</div><table class="detail-table">${body}</table>`;
}

function percentGroupsHtml(title, groups, potentialOnly, horseData = null) {
  let html = `<div class="group-heading">${escapeHtml(title)}</div>`;
  const showLk = title === 'Disziplinen' && horseData && typeof plannerTournamentEvaluation === 'function';
  for (const [group, entries] of Object.entries(groups)) {
    const body = entries.map((e) => {
      const value = potentialOnly ? `${e.potential}%` : `${e.current}% (Potenzial ${e.potential}%)`;
      const evaluation = showLk ? plannerTournamentEvaluation(horseData, e.name) : null;
      const lk = evaluation?.lk || '–';
      return showLk
        ? `<tr><th>${escapeHtml(e.name)}</th><td>${value}</td><td><strong>${escapeHtml(lk)}</strong></td></tr>`
        : `<tr><th>${escapeHtml(e.name)}</th><td>${value}</td></tr>`;
    }).join('');
    const head = showLk ? '<thead><tr><th>Disziplin</th><th>Potenzial</th><th>LK</th></tr></thead>' : '';
    html += `<p class="small muted" style="margin-bottom:0.1rem;">${escapeHtml(group)}</p><table class="detail-table discipline-lk-table">${head}<tbody>${body}</tbody></table>`;
  }
  return html;
}

// hasPedigreeData siehe parser.js (dort geteilt mit list.js).

const PEDIGREE_SECTION_ORDER = [
  'Eltern',
  'Großeltern väterlicherseits', 'Großeltern mütterlicherseits',
  'Urgroßeltern (Großvater väterlicherseits)', 'Urgroßeltern (Großmutter väterlicherseits)',
  'Urgroßeltern (Großvater mütterlicherseits)', 'Urgroßeltern (Großmutter mütterlicherseits)',
];

let pedigreeHorseLinkMapCache = null;

function pedigreeLinkKey(name) {
  return String(name || '').trim().replace(/\s+/g,' ').toLocaleLowerCase('de');
}

async function getPedigreeHorseLinkMap() {
  if (pedigreeHorseLinkMapCache) return pedigreeHorseLinkMapCache;
  const horses = await localGetAll(LOCAL_STORES.horses);
  const byName = new Map();
  const duplicates = new Set();
  for (const horse of horses) {
    const key = pedigreeLinkKey(horse?.name);
    if (!key) continue;
    if (byName.has(key)) duplicates.add(key);
    else byName.set(key, horse);
  }
  for (const key of duplicates) byName.delete(key);
  pedigreeHorseLinkMapCache = byName;
  return byName;
}

function pedigreeNameHtml(name, linkMap) {
  const safe = escapeHtml(name || '');
  const horse = linkMap?.get(pedigreeLinkKey(name));
  if (!horse?.id) return safe;
  return `<a href="${mdrRoute('view',{id:horse.id})}" title="Pferd in der Datenbank öffnen">${safe}</a>`;
}

function pedigreeGroupTableHtml(title, entries, linkMap = null) {
  if (!entries?.length) return '';
  const body = entries.map((p) => `<tr><th>${pedigreeNameHtml(p.name,linkMap)}</th><td>${escapeHtml(normalizeBreed(p.breed) || '')}</td></tr>`).join('');
  return `<p class="small muted" style="margin-bottom:0.1rem;">${escapeHtml(title)}</p><table class="detail-table">${body}</table>`;
}

// "pedigree" ist entweder das alte, flache Array (bereits gespeicherte
// Pferde vor dieser Änderung, Selbst-Eintrag an Position 0) oder das
// Format { ancestors, sections }. Der Parser liefert "sections" nicht mehr
// (Handy- und Desktop-Kopien werden identisch als reine Reihenfolge in
// "ancestors" gespeichert) - das Feld bleibt hier nur zur Anzeige bereits
// vor dieser Änderung gespeicherter Datensätze erhalten, bei denen es noch
// gefüllt ist.
function pedigreeHtml(pedigree, linkMap = null) {
  const isLegacyArray = Array.isArray(pedigree);
  const ancestors = isLegacyArray ? pedigree.slice(1) : (pedigree.ancestors || []);
  const sections = isLegacyArray ? null : pedigree.sections;

  let body;
  let note;
  if (sections) {
    body = PEDIGREE_SECTION_ORDER.map((label) => pedigreeGroupTableHtml(label, sections[label], linkMap)).join('');
    note = 'Einteilung anhand der im Text enthaltenen Abschnittsüberschriften (mobile Ansicht).';
  } else {
    const parents = ancestors.slice(0, 2);
    const grandparents = ancestors.slice(2, 6);
    const greatGrandparents = ancestors.slice(6, 14);
    const rest = ancestors.slice(14);
    body = pedigreeGroupTableHtml('Eltern', parents, linkMap)
      + pedigreeGroupTableHtml('Großeltern', grandparents, linkMap)
      + pedigreeGroupTableHtml('Urgroßeltern', greatGrandparents, linkMap)
      + pedigreeGroupTableHtml('Weitere Vorfahren', rest, linkMap);
    note = 'Einteilung anhand der Reihenfolge im kopierten Text – keine Garantie bei künftigen Layout-Änderungen im Spiel.';
  }

  return `<div class="group-heading">Stammbaum</div><p class="small muted">${escapeHtml(note)}</p>${body}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
