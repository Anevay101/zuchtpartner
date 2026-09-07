const TEXT_FIELDS = [
  'name', 'external_id', 'game_version', 'gender', 'breed', 'breed_composition', 'coat_color', 'appaloosa_pattern', 'owner', 'hlp_slp', 'breeding_goal', 'notes', 'image_url',
];
const DATE_FIELDS = ['birthdate'];
const NUMBER_FIELDS = ['purebred_pct', 'ico', 'stud_fee', 'tournament_starts_total', 'breeding_show_points'];
const BOOLEAN_FIELDS = ['disease_free', 'breeding_allowed', 'learning_file', 'in_breeding_station'];
const JSONB_KEYS = [
  'genetic_diseases', 'colors', 'exterior_genetics', 'exterior_descriptive',
  'temperament', 'disciplines', 'traits', 'tournament_potential', 'pedigree',
  'color_gene_overrides', 'disease_gene_overrides', 'tags', 'pregnancy', 'phenotype_gene_hints', 'cup_results', 'tournament_results',
];

let extraData = {};
let currentParsedPregnancy = null;
let editingId = null;
// Unveränderte Kopie des beim Laden vorgefundenen Datensatzes (siehe
// loadHorse) - anders als extraData (wird bei jedem erneuten "Automatisch
// auslesen" überschrieben) bleibt das der feste Vergleichspunkt für
// computeChangedFields beim Speichern (siehe performSave).
let originalRecord = null;
// Benutzername (vor dem @) des eingeloggten Kontos - wird fuer die
// Pfeil-Navigation (findAdjacentHorseId) gebraucht, damit dort nur durch
// die eigenen Pferde geblaettert wird. Eigener Name (nicht "currentIdentity")
// noetig, weil horseForm.js und verpaarung.js beide als eigene <script>-Tags
// auf verpaarung.html geladen werden und sich denselben globalen Scope
// teilen - eine gleichnamige "let"-Variable in beiden Dateien wuerde einen
// SyntaxError ausloesen, der das komplette zweite Skript (verpaarung.js)
// stumm lahmlegt (siehe Commit-Historie).
let formIdentity = null;
// Die in dieser Sitzung per "Speichern & nächstes Pferd" bereits
// erfassten Pferde (siehe onSaveAndNew/resetFormForNextEntry) - je
// {id, name, updated} ("updated" = Nachtrag zu einem bereits bestehenden
// Pferd statt echter Neuanlage, siehe targetId in performSave). Rein zur
// Anzeige (renderBulkSessionCard) und für den Übersicht-Banner beim
// Abschluss der Sitzung, nicht selbst gespeichert.
let bulkSessionEntries = [];
let currentChangeSource = 'manuell';
let applyingParsedData = false;


function applyDetectedLocalTags(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const starts = Number(parsed.tournament_starts_total);
  const hasAutomaticCup = Number.isFinite(starts) && starts >= 50 &&
    Object.values(parsed.tournament_results || {}).some(row => Number(row?.first || 0) >= 15);
  if (!parsed.cup_star_detected && !hasAutomaticCup) return parsed;
  const tags = Array.isArray(parsed.tags) ? [...parsed.tags] : [];
  const hasCup = tags.some((t) => (typeof t === 'string' ? t : t?.label) === 'Cupstern');
  if (!hasCup) tags.push({ label: 'Cupstern' });
  return { ...parsed, tags };
}

function syncBreedingStationRecord(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const tags = Array.isArray(payload.tags)
    ? payload.tags.map(t => typeof t === 'string' ? {label:t} : {...t})
    : [];
  const hasTag = tags.some(t => t?.label === 'Zuchtstation');

  if (payload.in_breeding_station === true) {
    if (!hasTag) tags.push({label:'Zuchtstation'});
  } else if (payload.in_breeding_station === false) {
    payload.tags = tags.filter(t => t?.label !== 'Zuchtstation');
    return payload;
  } else if (hasTag) {
    // Manuell gesetztes Schlagwort ist ebenfalls eine eindeutige Ja-Angabe.
    payload.in_breeding_station = true;
  }
  payload.tags = tags;
  return payload;
}

document.addEventListener('DOMContentLoaded', init);
document.addEventListener('input', (e) => {
  if (applyingParsedData) return;
  if (e.target.closest('#horse-form')) currentChangeSource = 'manuell geändert';
});
document.addEventListener('change', (e) => {
  if (applyingParsedData) return;
  if (e.target.closest('#horse-form')) currentChangeSource = 'manuell geändert';
});


// Klick auf einen Gen-Bestätigungs-Button (siehe geneOverrideBadge/
// nextOverrideState in parser.js) - per Event-Delegation auf "document",
// damit es unabhaengig davon funktioniert, wie oft renderDetailTables die
// Detail-Tabellen neu aufbaut (dabei wird jedesmal neues HTML erzeugt,
// ein direkt angehefteter Listener wuerde also verloren gehen). Auf der
// reinen Ansichtsseite (view.html, erkennbar an ".view-mode") sind die
// Buttons nur Anzeige, kein Klick-Handling - siehe auch CSS
// (.view-mode .gene-override { pointer-events: none; }).
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-override-locus]');
  if (!btn || document.querySelector('.view-mode')) return;
  // "key" ist entweder ein bloßer Locus-/Krankheits-Name ("Champagne",
  // "CA") oder bei Loci mit mehreren Allelen "Locus:Allel" ("KIT:To"),
  // siehe LOCUS_MULTI_ALLELES in parser.js. "data-override-group"
  // unterscheidet Farbgenetik (color_gene_overrides, Standard) von
  // Erbkrankheiten (disease_gene_overrides).
  const key = btn.dataset.overrideLocus;
  const field = btn.dataset.overrideGroup === 'disease' ? 'disease_gene_overrides' : 'color_gene_overrides';
  const overrides = { ...(extraData[field] || {}) };
  const next = nextOverrideState(key, overrides[key] || null);
  if (next) overrides[key] = next;
  else delete overrides[key];
  extraData[field] = overrides;
  renderDetailTables(extraData);
  if (field === 'color_gene_overrides' && /appaloosa/i.test(String(key))) {
    updateAppaloosaPatternVisibility();
    renderImportReviewPanel(null, extraData);
    maybePromptAppaloosaPattern();
  }
});

// Erlaubt, ein Bild direkt aus der Zwischenablage einzufügen (Screenshot
// oder per Rechtsklick "Bild kopieren" aus dem Browser) statt nur eine
// externe Bild-URL einzutippen - wird in den Supabase-Storage-Bucket
// "horse-images" hochgeladen (siehe migration_019_horse_images_storage.sql),
// die resultierende öffentliche URL landet im Feld. Eine echte http(s)-URL
// (statt z.B. einer data:-URL) wird u.a. für die Bild-Einbettung im
// Discord-Bot gebraucht (embed.setImage() kann keine data:-URLs laden).
// Enthält die Zwischenablage kein Bild (normaler Text/Link), passiert hier
// nichts, der normale Text-Paste läuft unverändert weiter.
const IMAGE_EXTENSION_BY_MIME_TYPE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
document.getElementById('image_url')?.addEventListener('paste', async (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  const file = item.getAsFile();
  if (!file) return;

  const input = e.target;
  const previousValue = input.value;
  input.value = 'Bild wird hochgeladen…';
  input.disabled = true;

  // Lokale Version: Bild direkt als Data-URL im Pferdedatensatz speichern.
  // Dadurch ist kein Supabase-Storage und keine Internetverbindung nötig.
  try {
    input.value = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    updateImagePreview();
  } catch (error) {
    input.value = previousValue;
    alert('Bild konnte lokal nicht übernommen werden: ' + error.message);
  } finally {
    input.disabled = false;
  }
});

// Kopiert man die komplette Pferdeseite aus dem Spiel (z.B. per Ctrl+A,
// Ctrl+C auf der Seite selbst statt nur eines Textabschnitts), legt der
// Browser neben dem reinen Text auch eine HTML-Fassung der Auswahl in die
// Zwischenablage (clipboardData "text/html") - darin sind auch die Bilder
// enthalten, u.a. das eigentliche Pferdebild (im Spiel-HTML eindeutig als
// "id=pferdebild" markiert, nicht zu verwechseln mit Wetter-Icons, Logo
// oder der Mützen-Überlagerung "id=muetze"). Der normale Text-Paste in
// #raw-text läuft unverändert weiter (kein preventDefault) - hier wird nur
// zusätzlich die Bild-URL herausgelesen und automatisch in Bild-URL
// eingetragen, als Link (kein Hochladen/Zwischenspeichern der Bilddaten
// selbst - anders als beim direkten Bild-Paste in #image_url oben, wo nur
// die reinen Bilddaten ohne URL in der Zwischenablage liegen). Der
// Dateiname des Bilds beginnt dabei mit der Spiel-ID des Pferds (z.B.
// "864841_002.png") - wird deshalb hier gleich mit als ID übernommen,
// spart bei komplett kopierten Seiten das manuelle Eintippen der ID.
document.getElementById('raw-text')?.addEventListener('paste', (e) => {
  const html = e.clipboardData?.getData('text/html');
  if (!html) return;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const img = doc.getElementById('pferdebild');
  if (!img?.src) return;
  // img.src ist bereits vom DOMParser gegen die Basis-URL des Dokuments
  // aufgelöst - ohne <base>-Tag im Fragment bleibt ein rein relativer Pfad
  // aus dem Spiel-HTML aber unaufgelöst, deshalb hier zusätzlich explizit
  // gegen die Spiel-Domain auflösen (wie schon bei den Spiel-Links in
  // horseView.js/list.js).
  const rawSrc = img.getAttribute('src');
  const resolved = new URL(rawSrc, 'https://www.morning-dust-ranch.de/').href;
  document.getElementById('image_url').value = resolved;

  // Der Dateiname selbst (letzter Pfadabschnitt, z.B. "864841_002.png")
  // beginnt mit der Spiel-ID - alles danach (Bild-Variante, beim lokalen
  // Speichern vom Browser angehängtes Suffix, Dateiendung) ist dafür
  // unerheblich, es zählen nur die führenden Ziffern.
  const filename = rawSrc.split(/[/\\]/).pop() || '';
  const idMatch = filename.match(/^(\d+)/);
  if (idMatch) document.getElementById('external_id').value = idMatch[1];
});

// Automatisches Auslesen direkt beim Einfügen (Strg+V) in #raw-text, statt
// erst nach Klick auf "Automatisch auslesen" - der Button bleibt trotzdem
// nutzbar (z.B. nach manuellen Korrekturen im Text oder erneutem Auslesen).
// setTimeout(0), weil der eingefügte Text im "paste"-Event selbst noch
// nicht im Feld steht (der Browser fügt ihn erst direkt danach ein) -
// onParse() liest also sonst noch den alten (leeren) Wert.
document.getElementById('raw-text')?.addEventListener('paste', () => {
  setTimeout(onParse, 0);
});

async function init() {
  // Wird dieses Skript auf einer anderen Seite geladen, um einzelne
  // Funktionen wiederzuverwenden (z.B. das Fohlen-Popup in
  // verpaarung.html, das dieselben Feld-IDs nutzt, aber sein eigenes
  // Speichern/Wiring hat), soll das eigene init() hier nicht laufen -
  // "page-title" gibt es nur auf horse.html selbst.
  if (!document.getElementById('page-title')) return;

  const session = await requireSession();
  if (!session) return;
  await renderSharedNav(session);
  formIdentity = session.user.email.split('@')[0];

  const params = new URLSearchParams(window.location.search);
  editingId = params.get('id');

  document.getElementById('parse-btn').addEventListener('click', onParse);
  document.getElementById('horse-form').addEventListener('submit', onSave);
  document.getElementById('delete-btn').addEventListener('click', onDelete);
  document.getElementById('purebred_pct').addEventListener('input', updateBreedCompositionVisibility);
  updateBreedCompositionVisibility();
  wireSaveWarningModal();
  wireDuplicateCheckModal();
  wireTabs();
  renderTagCheckboxes();

  if (editingId) {
    document.getElementById('page-title').textContent = '🐴 Pferd bearbeiten';
    document.getElementById('delete-btn').hidden = false;
    // Pfeile zum Speichern + direkt zum naechsten/vorherigen Pferd
    // (alphabetisch) springen - nur beim Bearbeiten eines bestehenden
    // Pferds sinnvoll, nicht bei der Neuanlage.
    document.getElementById('prev-horse-btn').hidden = false;
    document.getElementById('next-horse-btn').hidden = false;
    document.getElementById('prev-horse-btn').addEventListener('click', () => onSaveAndNavigate('prev'));
    document.getElementById('next-horse-btn').addEventListener('click', () => onSaveAndNavigate('next'));
    // Der Text-Einfuegen-Kasten ist beim Bearbeiten eines bereits
    // angelegten Pferds meist nicht mehr gebraucht - eingeklappt starten,
    // laesst sich bei Bedarf (z.B. erneutes Auslesen) einfach aufklappen.
    document.getElementById('paste-details').open = false;
    await loadHorse(editingId);
  } else {
    // "Massenerfassung": nur bei einer echten Neuanlage sinnvoll (beim
    // Bearbeiten eines bestehenden Pferds gibt es ja nur genau eines).
    document.getElementById('save-and-new-btn').hidden = false;
    document.getElementById('save-and-new-btn').addEventListener('click', onSaveAndNew);
  }
}

function localHorseKey(id) {
  const n = Number(id);
  return Number.isNaN(n) ? id : n;
}

async function loadHorse(id) {
  let data;
  try {
    data = await localGet(LOCAL_STORES.horses, localHorseKey(id));
  } catch (error) {
    document.getElementById('form-error').textContent = 'Konnte Pferd nicht laden: ' + error.message;
    return;
  }
  if (!data) {
    document.getElementById('form-error').textContent = 'Pferd wurde in der lokalen Datenbank nicht gefunden.';
    return;
  }
  syncBreedingStationRecord(data);
  fillForm(data);
  extraData = data;
  updateAppaloosaPatternVisibility();
  originalRecord = data;
  fillTagCheckboxes(data.tags);
  document.getElementById('raw-text').value = data.raw_text || '';
  await renderDetailTables(data);
  if (typeof bpRenderBreedingPanel === 'function') await bpRenderBreedingPanel(data, 'breeding-progress-panel');
}

async function onParse() {
  const text = document.getElementById('raw-text').value;
  const statusEl = document.getElementById('parse-status');
  if (!text.trim()) {
    statusEl.textContent = 'Bitte zuerst Text einfügen.';
    return;
  }
  currentChangeSource = 'importiert';
  applyingParsedData = true;
  const parsed = applyDetectedLocalTags(parseHorseText(text));
  currentParsedPregnancy = parsed.pregnancy || null;
  fillForm(parsed);
  extraData = mergeParsedIntoExisting(extraData, parsed);
  syncBreedingStationRecord(extraData);
  fillTagCheckboxes(extraData.tags);
  updateAppaloosaPatternVisibility();
  activateTab('stammdaten');
  renderImportReviewPanel(parsed, extraData);
  maybePromptAppaloosaPattern();
  await renderDetailTables(extraData);
  if (typeof bpRenderBreedingPanel === 'function') await bpRenderBreedingPanel(extraData, 'breeding-progress-panel');
  renderCupResultsEditor(extraData);
  const qualityBox = document.getElementById('import-quality-check');
  if (qualityBox) qualityBox.innerHTML = dataQualityPanelHtml(extraData);
  const parsedTournamentRows = Object.keys(parsed.tournament_results || {}).length;
  const parsedStars = typeof plannerCupStarRows === 'function' ? plannerCupStarRows(parsed).length : Object.values(parsed.tournament_results || {}).filter((r) => r?.cup_star).length;
  statusEl.textContent =
    'Erkannt: ' + (parsed.name || 'kein Name gefunden') +
    (parsed.breeding_goal ? ` · Zuchtziel automatisch: ${parsed.breeding_goal}` : '') +
    (parsedTournamentRows ? ` · Turnierdaten: ${parsedTournamentRows} Disziplin(en)` : '') +
    (parsedStars ? ` · Cupsterne: ${parsedStars}` : '') +
    (parsed.tournament_starts_total != null ? ` · Starts: ${parsed.tournament_starts_total}` : '') +
    ' — bitte Felder unten prüfen, bevor du speicherst.';
  setTimeout(() => { applyingParsedData = false; }, 0);
}

// Wird beim Bearbeiten eines bereits gespeicherten Pferds erneut "Text
// von der Pferdeseite einfügen" benutzt (z.B. weil inzwischen ein
// Farbgen-Test durchgeführt wurde und jetzt ein sicheres Ergebnis
// vorliegt), soll das nur ERGÄNZEN: tatsächlich neu erkannte Werte
// überschreiben die alten, liefert der aktuelle Text für ein Feld aber
// nichts (z.B. weil diesmal eine kürzere Kopie eingefügt wurde), bleibt
// der bisherige Wert erhalten statt geleert zu werden - siehe
// isEmptyValue. Bei einem neuen Pferd (extraData vorher leer) hat das
// keine Wirkung.
function mergeParsedIntoExisting(oldData, parsed) {
  const merged = { ...oldData, ...parsed };
  for (const key of JSONB_KEYS) {
    merged[key] = mergeFieldValue(key, oldData[key], parsed[key]);
  }
  return merged;
}

function fillForm(data) {
  // Alle vor V17 gespeicherten Datensätze stammen aus der DE-Version.
  if (!data.game_version) data = { ...data, game_version: 'DE' };
  for (const id of TEXT_FIELDS.concat(DATE_FIELDS)) {
    const el = document.getElementById(id);
    if (el && data[id] !== undefined && data[id] !== null) el.value = data[id];
  }
  for (const id of NUMBER_FIELDS) {
    const el = document.getElementById(id);
    if (el && data[id] !== undefined && data[id] !== null) el.value = data[id];
  }
  for (const id of BOOLEAN_FIELDS) {
    const el = document.getElementById(id);
    if (el && data[id] !== undefined && data[id] !== null) el.value = String(data[id]);
  }
  // "Rasselos" ist im Spiel eine echte Ausprägung ("keine Rasse"), keine
  // fehlende Angabe - wird deshalb auch im Bearbeitungsformular als Wert
  // eingetragen statt leer gelassen, konsistent mit der Übersichtstabelle
  // und den Filtern (siehe list.js: normalizeBreed(h.breed) || 'Rasselos').
  const breedEl = document.getElementById('breed');
  if (breedEl && !breedEl.value.trim()) breedEl.value = 'Rasselos';
  updateBreedCompositionVisibility();
  updateAppaloosaPatternVisibility();
  updateStudFeeVisibility();
  renderCupResultsEditor(data);
  updateImagePreview();
}

// Zeigt das Pferdebild (Bild-URL-Feld) direkt an statt nur den reinen
// Link - sowohl bei horse.html (kleine Vorschau neben dem Feld) als auch
// bei view.html (grosse Anzeige, siehe .view-mode .image-preview in
// style.css). Wird bei jedem fillForm() (Laden/Auslesen) aufgerufen sowie
// live beim manuellen Tippen/Einfuegen der URL.
function updateImagePreview() {
  const img = document.getElementById('image-preview');
  if (!img) return;
  const url = document.getElementById('image_url')?.value.trim();
  if (url) {
    img.src = url;
    img.hidden = false;
  } else {
    img.hidden = true;
    img.removeAttribute('src');
  }
}
document.getElementById('image_url')?.addEventListener('input', updateImagePreview);
document.getElementById('coat_color')?.addEventListener('input', updateAppaloosaPatternVisibility);
document.getElementById('gender')?.addEventListener('change', updateStudFeeVisibility);
document.getElementById('tournament_starts_total')?.addEventListener('change', (e) => {
  extraData.tournament_starts_total = e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value) || 0));
  renderCupResultsEditor(extraData);
});
document.getElementById('in_breeding_station')?.addEventListener('change', (e) => {
  const container = document.getElementById('tag-checkboxes');
  const cb = container?.querySelector('[data-tag-checkbox="Zuchtstation"]');
  if (!cb) return;
  if (e.target.value === 'true') cb.checked = true;
  if (e.target.value === 'false') cb.checked = false;
  const noteInput = container.querySelector('[data-tag-note="Zuchtstation"]');
  if (noteInput) { noteInput.disabled = !cb.checked; if (!cb.checked) noteInput.value = ''; }
  syncTagsFromCheckboxes();
});
document.getElementById('breed')?.addEventListener('input', updateAppaloosaPatternVisibility);
document.getElementById('name')?.addEventListener('input', updateAppaloosaPatternVisibility);
document.getElementById('appaloosa_pattern')?.addEventListener('change', updateAppaloosaPatternVisibility);

// Baut die Checkbox-Liste der Schlagwörter einmalig aus HORSE_TAG_OPTIONS
// auf (siehe parser.js) - je Zeile Checkbox + Farbpunkt + optionales
// Zusatztext-Feld. Änderungen aktualisieren extraData.tags direkt (wie
// die Gen-Bestätigungs-Buttons weiter oben), da JSONB_KEYS-Werte beim
// Speichern aus extraData statt aus eigenen Formularfeldern gelesen
// werden (siehe runSaveFlow).
function renderTagCheckboxes() {
  const container = document.getElementById('tag-checkboxes');
  if (!container) return;
  container.innerHTML = getHorseTagOptions().map(({ label, color }) => `
    <label class="tag-checkbox-row">
      <input type="checkbox" data-tag-checkbox="${escapeHtml(label)}" />
      <span class="tag-dot" style="background:${color}"></span>
      ${escapeHtml(label)}
      <input type="text" class="tag-note-input" data-tag-note="${escapeHtml(label)}" placeholder="Zusatz (optional)" disabled />
    </label>
  `).join('');
  container.addEventListener('change', (e) => {
    if (e.target.matches('[data-tag-checkbox]')) {
      const noteInput = container.querySelector(`[data-tag-note="${CSS.escape(e.target.dataset.tagCheckbox)}"]`);
      noteInput.disabled = !e.target.checked;
      if (!e.target.checked) noteInput.value = '';
    }
    syncTagsFromCheckboxes();
  });
  container.addEventListener('input', (e) => {
    if (e.target.matches('[data-tag-note]')) syncTagsFromCheckboxes();
  });
}

function fillTagCheckboxes(tags) {
  const container = document.getElementById('tag-checkboxes');
  if (!container) return;
  const byLabel = new Map((tags || []).map((t) => [t.label, t.note || '']));
  container.querySelectorAll('[data-tag-checkbox]').forEach((cb) => {
    const has = byLabel.has(cb.dataset.tagCheckbox);
    cb.checked = has;
    const noteInput = container.querySelector(`[data-tag-note="${CSS.escape(cb.dataset.tagCheckbox)}"]`);
    noteInput.disabled = !has;
    noteInput.value = has ? byLabel.get(cb.dataset.tagCheckbox) : '';
  });
}

function renderCupResultsEditor(data = extraData) {
  const root = document.getElementById('cup-results-editor');
  if (!root || typeof MDR_TOURNAMENT_GROUPS === 'undefined') return;
  const results = plannerTournamentResults(data || {});
  const rawResults = data?.tournament_results && typeof data.tournament_results === 'object' && !Array.isArray(data.tournament_results)
    ? data.tournament_results : {};
  const mainGroup = plannerHorseMainGroup(data || {});
  const starts = plannerTournamentStarts(data || {});

  root.innerHTML = MDR_TOURNAMENT_GROUP_ORDER.map(group => `
    <details class="cup-group" ${group === mainGroup ? 'open' : ''}>
      <summary>${escapeHtml(group)}</summary>
      <div class="tournament-achievement-head tiny muted">
        <span>Disziplin</span><span>1.</span><span>2.</span><span>3.</span><span>Cupstern</span><span>Cup-LK</span><span>Status</span>
      </div>
      <div class="tournament-achievement-grid">
        ${(MDR_TOURNAMENT_GROUPS[group] || []).map(name => {
          const row = results[name] || {first:0,second:0,third:0,cup_star:false,cup_lk:''};
          const progress = plannerCupProgress({...data,tournament_results:{...rawResults,[name]:rawResults[name] || row}}, name);
          let status = '';
          if (row.cup_star) status = `⭐ Cupstern${row.cup_lk ? ' · '+row.cup_lk : ''}`;
          else if (row.first >= 10) status = `${row.first}/15 Siege`;
          return `
            <div class="tournament-achievement-row">
              <strong>${escapeHtml(name)}</strong>
              <input type="number" min="0" step="1" value="${row.first || ''}" data-tournament-result="${escapeHtml(name)}" data-result-field="first" aria-label="${escapeHtml(name)} 1. Plätze" />
              <input type="number" min="0" step="1" value="${row.second || ''}" data-tournament-result="${escapeHtml(name)}" data-result-field="second" aria-label="${escapeHtml(name)} 2. Plätze" />
              <input type="number" min="0" step="1" value="${row.third || ''}" data-tournament-result="${escapeHtml(name)}" data-result-field="third" aria-label="${escapeHtml(name)} 3. Plätze" />
              <span class="cup-star-auto" title="Cupstern wird automatisch aus 50 Gesamtstarts + 15 Siegen erkannt">${row.cup_star ? '⭐ automatisch' : '–'}</span>
              <select data-tournament-result="${escapeHtml(name)}" data-result-field="cup_lk" aria-label="${escapeHtml(name)} Cup-LK">
                <option value="">–</option>
                ${['LK10','LK9','LK8','LK7','LK6','LK5','LK4','LK3','LK2','LK1'].map(lk=>`<option value="${lk}" ${row.cup_lk===lk?'selected':''}>${lk}</option>`).join('')}
              </select>
              <small>${escapeHtml(status)}</small>
            </div>`;
        }).join('')}
      </div>
    </details>`).join('') + `
      <p class="tiny muted cup-rule-note">
        Cupsterne werden automatisch erkannt: insgesamt mindestens 50 Starts + mindestens 15 Siege in der Disziplin.
        Eine im MDR-Text enthaltene <strong>MDR-Cup Qualifikation</strong> und ihre LK werden direkt übernommen; eine Bestätigung ist nicht mehr nötig.
        ${starts == null ? 'Gesamtstarts sind noch nicht hinterlegt.' : `Aktuell hinterlegte Gesamtstarts: ${starts}.`}
      </p>`;
}

function syncTournamentResultsFromEditor() {
  const root = document.getElementById('cup-results-editor');
  if (!root) return;
  const previousRaw = extraData?.tournament_results && typeof extraData.tournament_results === 'object' && !Array.isArray(extraData.tournament_results)
    ? extraData.tournament_results : {};
  const results = {};
  root.querySelectorAll('[data-tournament-result]').forEach(el => {
    const discipline = el.dataset.tournamentResult;
    const field = el.dataset.resultField;
    if (!results[discipline]) {
      const old = previousRaw[discipline] && typeof previousRaw[discipline] === 'object' ? previousRaw[discipline] : {};
      results[discipline] = {
        first:0, second:0, third:0,
        // Nur ausdrücklich aus MDR-Daten gespeicherte Cupsterne werden roh
        // konserviert. Die 50/15-Regel wird beim Auswerten automatisch
        // hinzugerechnet und muss nicht manuell gespeichert werden.
        cup_star: old.cup_star === true,
        cup_lk: /^LK(?:10|[1-9])$/.test(String(old.cup_lk || '')) ? String(old.cup_lk) : '',
      };
    }
    if (field === 'cup_lk') results[discipline][field] = el.value || '';
    else results[discipline][field] = el.value === '' ? 0 : Math.max(0, Math.floor(Number(el.value) || 0));
  });

  for (const key of Object.keys(results)) {
    const row=results[key];
    if (!row.first && !row.second && !row.third && !row.cup_star && !row.cup_lk) delete results[key];
  }

  extraData.tournament_results = results;
  extraData.cup_results = Object.fromEntries(Object.entries(results).filter(([,r])=>r.first>0).map(([name,r])=>[name,r.first]));
  renderCupResultsEditor(extraData);
}

document.addEventListener('change', (e) => {
  if (e.target.matches?.('[data-tournament-result]')) {
    syncTournamentResultsFromEditor();
    currentChangeSource = 'manuell geändert';
  }
});

function syncAutomaticCupStarsForSave(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const derived = typeof plannerTournamentResults === 'function' ? plannerTournamentResults(payload) : {};
  const raw = payload.tournament_results && typeof payload.tournament_results === 'object' && !Array.isArray(payload.tournament_results)
    ? { ...payload.tournament_results } : {};
  for (const [discipline,row] of Object.entries(derived)) {
    if (!row?.cup_star) continue;
    const old = raw[discipline] && typeof raw[discipline] === 'object' ? raw[discipline] : {};
    raw[discipline] = {
      ...old,
      first: Number(row.first || old.first || 0),
      second: Number(row.second || old.second || 0),
      third: Number(row.third || old.third || 0),
      cup_star: true,
      cup_lk: row.cup_lk || old.cup_lk || '',
    };
  }
  if (Object.keys(raw).length) payload.tournament_results = raw;
  return payload;
}

function syncCupsternTagForSave(payload) {
  const hasStructured = Boolean(payload?.tournament_results && typeof payload.tournament_results === 'object' && Object.keys(payload.tournament_results).length);
  const hasStar = plannerCupStarRows(payload).length > 0;
  const tags = Array.isArray(payload.tags) ? payload.tags.map(t => typeof t === 'string' ? {label:t} : {...t}) : [];
  const hadLegacyTag = tags.some(t => t?.label === 'Cupstern');
  const without = tags.filter(t => t?.label !== 'Cupstern');
  const keepCupTag = hasStructured ? hasStar : hadLegacyTag;
  payload.tags = keepCupTag ? [...without,{label:'Cupstern'}] : without;
  return payload;
}

function syncTagsFromCheckboxes() {
  const container = document.getElementById('tag-checkboxes');
  if (!container) return;
  const tags = [...container.querySelectorAll('[data-tag-checkbox]:checked')].map((cb) => {
    const noteInput = container.querySelector(`[data-tag-note="${CSS.escape(cb.dataset.tagCheckbox)}"]`);
    const note = noteInput.value.trim();
    return note ? { label: cb.dataset.tagCheckbox, note } : { label: cb.dataset.tagCheckbox };
  });
  extraData.tags = tags;
  const station = document.getElementById('in_breeding_station');
  if (station) {
    const hasStation = tags.some(t => t.label === 'Zuchtstation');
    if (hasStation) station.value = 'true';
    else if (station.value === 'true') station.value = 'false';
  }
}

// Das Rasseanteile-Feld ist nur relevant, wenn das Pferd NICHT sicher zu
// 100% reinrassig ist - bei leerem/unbekanntem Reinrassigkeit-Wert bleibt
// es trotzdem sichtbar, damit es sich vorsorglich ausfüllen lässt (siehe
// missingDataLabels: nur bei bekanntem Wert < 100% wird es überhaupt
// verlangt). Wird sowohl bei jedem fillForm() (Laden/Auslesen) als auch
// live beim Tippen im Reinrassigkeit-Feld aufgerufen (siehe init()).
function updateBreedCompositionVisibility() {
  const field = document.getElementById('breed-composition-field');
  if (!field) return;
  const pct = document.getElementById('purebred_pct').value;
  const isKnownFullyPurebred = pct !== '' && Number(pct) === 100;
  field.hidden = isKnownFullyPurebred;
}

function updateStudFeeVisibility() {
  const feeField = document.getElementById('stud-fee-field');
  const stationField = document.getElementById('stud-station-field');
  const gender = String(document.getElementById('gender')?.value || '').toLowerCase();
  const isStallion = gender === 'hengst' || gender === 'stallion';
  if (feeField) feeField.hidden = !isStallion;
  if (stationField) stationField.hidden = !isStallion;
}

function appaloosaPatternTriggerState() {
  const select = document.getElementById('appaloosa_pattern');
  const coat = document.getElementById('coat_color')?.value || '';
  const breed = document.getElementById('breed')?.value || '';
  const name = document.getElementById('name')?.value || '';
  const detected = typeof detectAppaloosaPatternFromCoatColor === 'function'
    ? detectAppaloosaPatternFromCoatColor(coat)
    : null;

  const geneRows = typeof presentGenesSummary === 'function'
    ? presentGenesSummary(
        extraData?.colors || [], coat,
        document.getElementById('notes')?.value || '', name,
        null, extraData?.color_gene_overrides
      )
    : [];
  const lpGene = geneRows.find((g) => g.locus === 'Appaloosa' && /Lp/.test(String(g.alleles || '')));
  const hasLp = Boolean(lpGene);
  const nameTrigger = /\bappaloosa\b/i.test(name);
  const relevant = Boolean(select?.value || detected || nameTrigger || hasLp || /\bappaloosa\b/i.test(breed));
  return { relevant, detected, nameTrigger, hasLp, lpSource: lpGene?.source || '' };
}

function updateAppaloosaPatternVisibility() {
  const field = document.getElementById('appaloosa-pattern-field');
  const select = document.getElementById('appaloosa_pattern');
  if (!field || !select) return;
  const state = appaloosaPatternTriggerState();
  field.dataset.relevant = state.relevant ? 'true' : 'false';
  field.hidden = true;
  if (state.relevant && !select.value && state.detected) select.value = state.detected;
}

function maybePromptAppaloosaPattern() {
  if (document.querySelector('.view-mode')) return;
  const field = document.getElementById('appaloosa-pattern-field');
  const select = document.getElementById('appaloosa_pattern');
  if (!field || !select || field.dataset.relevant !== 'true' || select.value) return;
  if (document.getElementById('appaloosa-pattern-modal')) return;

  activateTab('stammdaten');
  const modal = document.createElement('div');
  modal.id = 'appaloosa-pattern-modal';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-card appaloosa-pattern-modal-card">
      <h2>Appaloosa-Muster prüfen</h2>
      <p class="small">Beim Einlesen wurde Appaloosa im Namen bzw. nachweisbares LP erkannt. Bitte das sichtbare Muster auswählen.</p>
      <label for="appaloosa-pattern-modal-select"><strong>Appaloosa-Muster</strong></label>
      <select id="appaloosa-pattern-modal-select">
        <option value="">Bitte auswählen…</option>
        ${APPALOOSA_PATTERN_OPTIONS.map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}
      </select>
      <div class="modal-actions">
        <button type="button" class="secondary" data-app-pattern-close>Später</button>
        <button type="button" data-app-pattern-save>Übernehmen</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.hidden = false;
  const modalSelect = modal.querySelector('#appaloosa-pattern-modal-select');
  modalSelect?.focus();
  modal.querySelector('[data-app-pattern-save]')?.addEventListener('click', () => {
    const value = modalSelect?.value || '';
    if (!value) return;
    select.value = value;
    currentChangeSource = 'manuell geändert';
    updateAppaloosaPatternVisibility();
    renderImportReviewPanel(null, extraData);
    modal.remove();
  });
  modal.querySelector('[data-app-pattern-close]')?.addEventListener('click', () => modal.remove());
}

function importRecognizedCount(parsed) {
  if (!parsed || typeof parsed !== 'object') return 0;
  const keys = ['name','external_id','game_version','gender','breed','purebred_pct','breed_composition','coat_color','birthdate','owner','disease_free','breeding_allowed','hlp_slp','ico','in_breeding_station','stud_fee','breeding_goal','genetic_diseases','colors','exterior_genetics','exterior_descriptive','temperament','disciplines','traits','tournament_potential','tournament_results','tournament_starts_total','pedigree'];
  return keys.reduce((n,key) => n + (isEmptyValue(key, parsed[key]) ? 0 : 1), 0);
}

function importReviewItems(payload) {
  const items = [];
  const state = appaloosaPatternTriggerState();
  if (state.relevant && !String(document.getElementById('appaloosa_pattern')?.value || '').trim()) {
    items.push({ key:'appaloosa', label:'Appaloosa-Muster auswählen', action:'appaloosa' });
  }
  for (const label of missingDataLabels(payload || {})) items.push({ key:label, label });
  if (!Array.isArray(payload?.colors) || payload.colors.length === 0) items.push({ key:'colors', label:'Farbgenetik / Gentest prüfen' });
  if (payload?.disease_free == null) items.push({ key:'disease', label:'Erbkrankheitsstatus prüfen' });
  return items.filter((item,index,arr)=>arr.findIndex(x=>x.key===item.key)===index);
}

function renderImportReviewPanel(parsed = null, payload = extraData) {
  const panel = document.getElementById('import-review-panel');
  if (!panel) return;
  const items = importReviewItems(payload || {});
  const recognized = parsed ? importRecognizedCount(parsed) : null;
  const summary = recognized == null
    ? `${items.length ? `${items.length} Punkt${items.length===1?'':'e'} noch prüfen` : 'Keine offenen Prüfpunkte'}`
    : `Automatisch erkannt: ${recognized} · noch prüfen: ${items.length}`;
  panel.hidden = false;
  panel.innerHTML = `
    <div class="import-review-head"><strong>Noch prüfen</strong><span class="small muted">${escapeHtml(summary)}</span></div>
    ${items.length ? `<div class="import-review-items">${items.map(item => item.action === 'appaloosa'
      ? `<button type="button" class="secondary small" data-import-review-appaloosa>${escapeHtml(item.label)}</button>`
      : `<span class="import-review-chip">${escapeHtml(item.label)}</span>`).join('')}</div>`
      : '<div class="small import-review-ok">Alle zentralen Import-Prüfpunkte sind vollständig.</div>'}`;
  panel.querySelector('[data-import-review-appaloosa]')?.addEventListener('click', maybePromptAppaloosaPattern);
  panel.scrollIntoView({block:'nearest'});
}


// Extrahiert die reine numerische Spiel-ID aus einem kompletten Link wie
// "https://www.morning-dust-ranch.de/index2.php?site=pferd&id=622070" ->
// "622070". Enthält der Wert kein "id="-Muster (z.B. weil ohnehin schon
// nur die reine ID eingetragen wurde), bleibt er unverändert.
function normalizeExternalId(value) {
  const m = value.match(/[?&]id=(\d+)/);
  return m ? m[1] : value;
}

function collectForm() {
  const out = {};
  for (const id of TEXT_FIELDS.concat(DATE_FIELDS)) {
    const el = document.getElementById(id);
    const v = el.value.trim();
    out[id] = v === '' ? null : v;
  }
  // Rasse-Kürzel (z.B. "APH") auf den ausgeschriebenen Namen normalisieren,
  // falls direkt ins Formular eingetragen statt per Text-Auslesen (dort
  // übernimmt das bereits parser.js) - siehe normalizeBreed.
  if (out.breed) out.breed = normalizeBreed(out.breed);
  // Erlaubt, statt der reinen Spiel-ID auch den kompletten Link zur
  // Pferdeseite einzufügen (z.B. aus der Browser-Adresszeile kopiert) -
  // wird auf die reine ID reduziert, da an anderer Stelle (list.js,
  // horseView.js, Discord-Bot) aus der gespeicherten ID der Link selbst
  // neu gebaut wird.
  if (out.external_id) out.external_id = normalizeExternalId(out.external_id);
  for (const id of NUMBER_FIELDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    out[id] = el.value === '' ? null : Number(el.value);
  }
  for (const id of BOOLEAN_FIELDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    out[id] = el.value === '' ? null : el.value === 'true';
  }
  return out;
}

// Ausführliche Hinweistexte zu missingDataLabels (siehe parser.js) - kein
// Pflichtfeld-Fehler, sondern nur ein Hinweis vor dem Speichern, siehe
// showSaveWarningModal.
const MISSING_DATA_SENTENCES = {
  'Ext%': 'Das Exterieur-Prozentwert (Ext%) konnte nicht berechnet werden.',
  'Stammbaum': 'Der Stammbaum konnte nicht vollständig erfasst werden.',
  'Turnierwerte': 'Die Turnierwerte (GP/Begabung) konnten nicht vollständig erfasst werden.',
  'Rasseanteile': 'Das Pferd ist nicht 100% reinrassig - bitte die Rasseanteile ergänzen.',
};
function appaloosaPatternConsistencyWarnings(payload) {
  const pattern = String(payload?.appaloosa_pattern || '').trim();
  if (!pattern || pattern === 'anderes / unklar') return [];

  const colors = payload?.colors || [];
  const raw = (label) => String(colors.find((r) => r?.label === label)?.value || '').replace(/\s+/g, '');
  const lpRaw = raw('Appaloosa');

  // V51: Keine starren Guide-Regeln mehr wie "Snowcap muss LpLp sein".
  // Die real eingetragenen MDR-Pferde zeigen mehrere Muster für dieselbe
  // LP/PATN1-Kombination. Einzige harte Konsistenzprüfung: lplp bedeutet
  // genetisch kein Lp und passt daher nicht zu sichtbarer Appaloosa-Scheckung.
  if (lpRaw === 'lplp') {
    return [`⚠️ Sichtbares Appaloosa-Muster „${pattern}“ passt nicht zum getesteten lplp (kein Lp). Bitte Gentest oder Muster prüfen.`];
  }
  return [];
}
function missingDataWarnings(payload) {
  return [
    ...missingDataLabels(payload).map((label) => MISSING_DATA_SENTENCES[label]),
    ...appaloosaPatternConsistencyWarnings(payload),
  ];
}

let pendingSave = null;
// Wohin performSave nach erfolgreichem Speichern weiterleitet - normal
// zurueck zur Uebersicht, bei den Pfeil-Buttons (siehe onSaveAndNavigate)
// stattdessen direkt zum naechsten/vorherigen Pferd. null (siehe
// onSaveAndNew) heisst "gar nicht weiterleiten, Formular fuer die
// naechste Neuanlage zuruecksetzen" (Massenerfassung).
let saveRedirect = 'index.html';

async function onSave(e) {
  e.preventDefault();
  saveRedirect = 'index.html';
  await runSaveFlow();
}

// "Massenerfassung": speichert das aktuelle (neue) Pferd wie ein
// normaler Save, leitet danach aber nicht weiter, sondern setzt das
// Formular fuer die naechste Neuanlage zurueck (siehe
// resetFormForNextEntry in performSave) - so laesst sich eine ganze
// Reihe neuer Pferde ohne Umweg ueber die Uebersicht nacheinander
// eintragen.
async function onSaveAndNew(e) {
  e.preventDefault();
  saveRedirect = null;
  await runSaveFlow();
}

// Speichert das aktuelle Pferd wie ein normaler Save, leitet danach aber
// nicht zur Uebersicht, sondern direkt zum alphabetisch naechsten/
// vorherigen Pferd weiter - damit laesst sich eine ganze Liste ohne
// Umweg ueber die Uebersicht durcharbeiten.
async function onSaveAndNavigate(direction) {
  const errorEl = document.getElementById('form-error');
  errorEl.textContent = '';

  const adjacentId = await findAdjacentHorseId(direction);
  if (!adjacentId) {
    errorEl.textContent = direction === 'next'
      ? 'Kein weiteres Pferd (Ende der alphabetischen Liste).'
      : 'Kein vorheriges Pferd (Anfang der alphabetischen Liste).';
    return;
  }

  saveRedirect = `horse.html?id=${adjacentId}`;
  await runSaveFlow();
}

// Gleiche Sortierung wie in der Uebersicht (list.js sortValue "name"),
// damit "naechstes/vorheriges Pferd" hier zur selben Reihenfolge passt,
// die man auch in der Liste sieht. Auf die eigenen Pferde (Besitzer =
// eingeloggter Benutzername) eingeschraenkt, damit man beim Durchklicken
// nicht auch fremde Pferde anderer Nutzer*innen zu sehen bekommt.
async function findAdjacentHorseId(direction) {
  // Lokale Einzelbenutzer-Version: durch alle lokal gespeicherten Pferde
  // blättern, unabhängig vom Besitzer-Feld.
  const data = await localGetAll(LOCAL_STORES.horses);
  data.sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase(), 'de'));
  const currentKey = localHorseKey(editingId);
  const idx = data.findIndex((h) => h.id === currentKey);
  if (idx === -1) return null;
  const adjacentIdx = direction === 'next' ? idx + 1 : idx - 1;
  return data[adjacentIdx]?.id || null;
}

async function runSaveFlow() {
  const errorEl = document.getElementById('form-error');
  errorEl.textContent = '';

  const session = await requireSession();
  if (!session) return;

  const formData = collectForm();
  if (!formData.name) {
    errorEl.textContent = 'Name ist ein Pflichtfeld.';
    return;
  }

  const payload = { ...formData };
  for (const k of JSONB_KEYS) {
    if (extraData[k] !== undefined) payload[k] = extraData[k];
  }
  // Der reinkopierte Rohtext wird nur zum Auslesen gebraucht - nach dem
  // Speichern soll ausschließlich das daraus extrahierte Ergebnis in der
  // Datenbank stehen, nicht der Rohtext selbst.
  payload.raw_text = null;
  syncAutomaticCupStarsForSave(payload);
  syncCupsternTagForSave(payload);
  syncBreedingStationRecord(payload);
  if (typeof mdrLearningFileForSave === 'function') mdrLearningFileForSave(payload);

  // Muss VOR der Vollständigkeits-Prüfung laufen (siehe unten): ist das
  // hier eigentlich nur ein Nachtrag zu einem bereits bestehenden Pferd
  // (Name-/ID-Treffer, siehe resolveSaveTarget), sollen bereits bekannte
  // Werte des bestehenden Datensatzes mitzählen - sonst würde z.B. „Die
  // Turnierwerte fehlen“ auch dann noch angezeigt, wenn sie im
  // bestehenden Datensatz längst erfasst sind und im diesmal
  // eingefügten (kürzeren) Text nur nicht nochmal enthalten waren.
  const resolved = await resolveSaveTarget(formData, payload);
  if (!resolved) return;
  const { targetId, payload: mergedPayload, beforeRecord } = resolved;
  // Zweiter Durchlauf mit dem bestehenden Datensatz: so kann beim Lösen
  // der Lerndatei der zuvor intern gemerkte Besitzer wiederhergestellt werden.
  syncBreedingStationRecord(mergedPayload);
  if (typeof mdrLearningFileForSave === 'function') mdrLearningFileForSave(mergedPayload, beforeRecord);

  const warnings = missingDataWarnings(mergedPayload);
  if (warnings.length) {
    pendingSave = { formData, payload: mergedPayload, session, targetId, beforeRecord };
    const list = document.getElementById('save-warning-list');
    list.innerHTML = warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('');
    document.getElementById('save-warning-modal').hidden = false;
    return;
  }

  await performSave(formData, mergedPayload, session, targetId, beforeRecord);
}

function wireSaveWarningModal() {
  document.getElementById('save-warning-cancel').addEventListener('click', () => {
    document.getElementById('save-warning-modal').hidden = true;
    pendingSave = null;
  });
  document.getElementById('save-warning-confirm').addEventListener('click', async () => {
    document.getElementById('save-warning-modal').hidden = true;
    if (!pendingSave) return;
    const { formData, payload, session, targetId, beforeRecord } = pendingSave;
    pendingSave = null;
    await performSave(formData, payload, session, targetId, beforeRecord);
  });
}

// Ob ein Feldwert als "nichts eingetragen" gilt - Arrays/Objekte, die
// parseHorseText auch bei fehlendem Abschnitt im Text immer zurückgibt
// (z.B. leeres colors-Array statt undefined), zählen hier genauso als
// leer wie null selbst (collectForm wandelt bereits '' in null um).
function isEmptyValue(key, value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (key === 'pedigree') return !hasPedigreeData(value);
  if (key === 'exterior_genetics') return !value.rows || value.rows.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

// Führt einen einzelnen Feldwert beim Aktualisieren zusammen (siehe
// mergeParsedIntoExisting und performSave). "disciplines"/"traits" sind
// nach Kategorie gruppiert (z.B. "Barock", "Western") - zeigt das Spiel
// ohne aufgeklapptes "Alle Disziplinen anzeigen?" nur eine einzelne
// Kategorie, würden die übrigen sonst als "neuer, vollständiger Wert"
// gelten und verschwinden. "tournament_potential" hat dasselbe Problem
// mit seinen einzelnen benannten Werten (Gesamtpotenzial/Begabung/...):
// enthält ein erneut eingefügter Text z.B. nur Gesamtpotenzial, aber
// nicht Begabung, würde Begabung sonst durch das komplette Überschreiben
// verschwinden - obwohl es im Datensatz bereits bekannt war (siehe
// missingDataLabels/showSaveWarningModal, die genau das dann fälschlich
// wieder als "fehlt" anmahnen würden). Deshalb hier bei allen dreien
// feldweise zusammenführen statt alles-oder-nichts: neue Werte ergänzen/
// überschreiben, im neuen Text fehlende Werte bleiben aus dem alten Wert
// erhalten. Für alle anderen Felder gilt weiterhin: neuer Wert leer und
// alter nicht -> alten Wert behalten, sonst neuen Wert übernehmen.
function mergeFieldValue(key, oldValue, newValue) {
  if (newValue === undefined) return oldValue;
  if (key === 'disciplines' || key === 'traits' || key === 'tournament_potential') {
    return { ...(oldValue || {}), ...(newValue || {}) };
  }
  if (key === 'tournament_results') {
    const merged = { ...(oldValue || {}) };
    for (const [discipline, row] of Object.entries(newValue || {})) {
      // „Erfolge“ liefert Platzierungen, „Turniere“ liefert Cupstern/LK.
      // Beides darf nacheinander eingelesen werden, ohne die jeweils
      // andere Hälfte des Datensatzes zu löschen.
      merged[discipline] = { ...(merged[discipline] || {}), ...(row || {}) };
    }
    return merged;
  }
  // "tags": ähnliches Problem, nur als Array statt Objekt - wird das
  // Formular als vermeintlich neues Pferd ausgefüllt und dabei (ohne die
  // bereits vorhandenen Schlagwörter zu sehen, siehe fillTagCheckboxes/
  // loadHorse) z.B. nur "Verkauf" angehakt, würde ein alles-oder-nichts-
  // Ersetzen alle anderen, bereits vorhandenen Schlagwörter des
  // gefundenen Datensatzes stillschweigend löschen. Statt das automatisch
  // zu entscheiden, wird beim Speichern nachgefragt (siehe
  // decideTagsMerge) - aber nur, wenn es dabei wirklich etwas zu
  // entscheiden gibt.
  if (key === 'tags') return decideTagsMerge(oldValue, newValue);
  if (isEmptyValue(key, newValue) && !isEmptyValue(key, oldValue)) return oldValue;
  return newValue;
}

function mergeTagsUnion(oldTags, newTags) {
  const merged = new Map((oldTags || []).map((t) => [t.label, t]));
  for (const t of (newTags || [])) merged.set(t.label, t);
  return [...merged.values()];
}

// Wird nur in den beiden Dopplungs-Merge-Zweigen von performSave gebraucht
// (Namensgleichheit / Dopplungs-Check-Bestätigung) - dort wurde das
// Formular als vermeintlich neues Pferd ausgefüllt, checkt der Nutzer
// dabei ein Schlagwort an, weiß er nichts von eventuell bereits
// vorhandenen Schlagwörtern des gefundenen Datensatzes (die
// Checkbox-Liste wurde nie mit dessen Werten befüllt, siehe
// fillTagCheckboxes/loadHorse). Nur wenn der bestehende Datensatz
// Schlagwörter hat, die im neuen Formular NICHT angehakt sind, gibt es
// überhaupt etwas zu entscheiden - sonst einfach zusammenführen, ohne zu
// fragen.
function decideTagsMerge(oldTags, newTags) {
  const old = oldTags || [];
  const fresh = newTags || [];
  const freshLabels = new Set(fresh.map((t) => t.label));
  const extraOld = old.filter((t) => !freshLabels.has(t.label));
  if (!extraOld.length) return mergeTagsUnion(old, fresh);
  const keepBoth = confirm(
    `Das gefundene Pferd hat bereits folgende Schlagwörter: ${extraOld.map((t) => t.label).join(', ')}.\n\n` +
    `OK = behalten und mit den neu angehakten zusammenführen.\n` +
    `Abbrechen = entfernen, nur die im Formular angehakten Schlagwörter übernehmen.`
  );
  return keepBoth ? mergeTagsUnion(old, fresh) : fresh;
}

// Deutsche Kurz-Labels für den Änderungs-Hinweis im Flash-Banner (siehe
// computeChangedFields/performSave sowie showFlashBanner in list.js) -
// bewusst dieselben Bezeichnungen wie im Formular/der Übersicht (z.B.
// "ZZL" statt "breeding_allowed", passend zur Tabellenspalte in list.js).
const CHANGE_FIELD_LABELS = {
  name: 'Name',
  external_id: 'ID',
  gender: 'Geschlecht',
  breed: 'Rasse',
  breed_composition: 'Rasseanteile',
  coat_color: 'Fellfarbe',
  owner: 'Besitzer',
  hlp_slp: 'HLP/SLP',
  breeding_goal: 'Zuchtziel',
  notes: 'Notizen',
  image_url: 'Bild',
  purebred_pct: 'Reinrassigkeit',
  ico: 'ICO',
  disease_free: 'Erbkrankheitsfrei',
  breeding_allowed: 'ZZL',
  genetic_diseases: 'Erbkrankheiten (Diagnosen)',
  colors: 'Farbgenetik',
  exterior_genetics: 'Exterieur-Genetik',
  exterior_descriptive: 'Körperbau',
  temperament: 'Interieur',
  disciplines: 'Disziplinen',
  traits: 'Eigenschaften',
  tournament_potential: 'Turnierwerte',
  pedigree: 'Stammbaum',
  tags: 'Schlagwörter',
  pregnancy: 'Trächtigkeit',
  appaloosa_pattern: 'Appaloosa-Muster',
  stud_fee: 'Decktaxe',
  tournament_starts_total: 'Turnierstarts',
  breeding_show_points: 'Zuchtschau-Punkte',
  tournament_results: 'Turniererfolge/Cup',
};

// Ob sich ein einzelner Feldwert gegenüber dem vorherigen Datensatz
// tatsächlich geändert hat - bei JSONB-Feldern (Objekte/Arrays) über
// isEmptyValue normalisiert, damit z.B. "{}" und "null" nicht fälschlich
// als Änderung gelten, sonst über einen simplen Wertevergleich (leere
// Strings zählen wie null, siehe collectForm).
function isFieldChanged(key, beforeValue, afterValue) {
  const beforeIsObject = beforeValue !== null && typeof beforeValue === 'object';
  const afterIsObject = afterValue !== null && typeof afterValue === 'object';
  if (beforeIsObject || afterIsObject) {
    if (isEmptyValue(key, beforeValue) && isEmptyValue(key, afterValue)) return false;
    return JSON.stringify(beforeValue) !== JSON.stringify(afterValue);
  }
  const before = beforeValue == null || beforeValue === '' ? null : beforeValue;
  const after = afterValue == null || afterValue === '' ? null : afterValue;
  return before !== after;
}

// Liefert die deutschen Labels aller Felder, die sich zwischen dem vorher
// geladenen Datensatz und dem zu speichernden Payload geändert haben -
// wird im Flash-Banner der Übersicht angezeigt (siehe performSave/
// showFlashBanner), damit beim Aktualisieren sofort ersichtlich ist, was
// sich geändert hat, ohne den alten Stand extra vergleichen zu müssen.
function computeChangedFields(before, after) {
  if (!before) return [];
  const changed = [];
  for (const [key, label] of Object.entries(CHANGE_FIELD_LABELS)) {
    if (isFieldChanged(key, before[key], after[key])) changed.push(label);
  }
  return changed;
}

// GP/Ext/Ext%/Int aus einem Pferde-Datensatz (Payload oder bestehender
// DB-Zeile) berechnen - wie list.js/computeDerived, hier nur die vier für
// den Dopplungs-Check gebrauchten Werte statt aller abgeleiteten Felder.
function quickStatsOf(data) {
  const gpRaw = data.tournament_potential?.['Gesamtpotenzial'];
  return {
    gp: gpRaw != null && gpRaw !== '' ? Number(gpRaw) : null,
    ext: averageScore(data.exterior_descriptive, scoreExteriorTerm),
    extPercent: data.exterior_genetics?.overall?.percent ?? null,
    int: averageScore(data.temperament, scoreTemperamentTerm),
  };
}

// Gilt nur als Übereinstimmung, wenn alle vier Werte auf beiden Seiten
// tatsächlich vorhanden UND exakt gleich sind - sonst würden z.B. zwei
// verschiedene, noch komplett ungetestete Fohlen (überall null) fälschlich
// als Dopplung gelten.
function statsMatch(a, b) {
  return ['gp', 'ext', 'extPercent', 'int'].every((k) => a[k] != null && a[k] === b[k]);
}

let duplicateCheckResolve = null;
function wireDuplicateCheckModal() {
  document.getElementById('duplicate-check-cancel').addEventListener('click', () => {
    document.getElementById('duplicate-check-modal').hidden = true;
    duplicateCheckResolve?.(false);
  });
  document.getElementById('duplicate-check-confirm').addEventListener('click', () => {
    document.getElementById('duplicate-check-modal').hidden = true;
    duplicateCheckResolve?.(true);
  });
}

// Zeigt die Ja/Nein-Nachfrage samt Gegenüberstellung Name/Besitzer/ID/
// GP/Ext/Ext%/Int von neuem und bereits vorhandenem Datensatz - liefert
// true (dasselbe Pferd -> bestehenden Datensatz ergänzen) oder false
// (anderes Pferd -> normal neu anlegen).
function askIsDuplicateHorse(reasonParts, neu, alt) {
  document.getElementById('duplicate-check-reason').textContent =
    `Übereinstimmung: ${reasonParts.join(', ')}.`;
  const rows = [
    ['Name', neu.name, alt.name],
    ['Besitzer', neu.owner, alt.owner],
    ['ID', neu.external_id, alt.external_id],
    ['GP', neu.gp, alt.gp],
    ['Ext', neu.ext != null ? neu.ext.toFixed(2) : null, alt.ext != null ? alt.ext.toFixed(2) : null],
    ['Ext%', neu.extPercent != null ? neu.extPercent + '%' : null, alt.extPercent != null ? alt.extPercent + '%' : null],
    ['Int', neu.int != null ? neu.int.toFixed(2) : null, alt.int != null ? alt.int.toFixed(2) : null],
  ];
  document.getElementById('duplicate-check-body').innerHTML = rows.map(([label, a, b]) =>
    `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(a ?? '-')}</td><td>${escapeHtml(b ?? '-')}</td></tr>`
  ).join('');
  document.getElementById('duplicate-check-modal').hidden = false;
  return new Promise((resolve) => { duplicateCheckResolve = resolve; });
}

// --- Automatische Flaxen-Trägerschaft bei den Eltern (Nutzerwunsch) ---
//
// Ist das gerade gespeicherte Pferd sichtbar Flaxen (reinerbig, "hom" -
// zeigt sich als "flfl"), MÜSSEN beide Eltern zwingend mindestens eine
// Kopie tragen (rezessives Merkmal) - wird hier automatisch als
// Trägerschaft ("het", zeigt sich als "fl") bei den Eltern-Datensätzen
// nachgetragen, falls dort noch nichts (Stärkeres) manuell eingetragen
// ist. Ausgelöst durch BEIDES: automatische Text-Erkennung ("Flaxen" in
// Fellfarbe/Notiz/Name) UND manuelle Bestätigung ("2x vorhanden") - beides
// läuft über dieselbe presentGenesSummary()-Ableitung, die für die
// Anzeige ohnehin schon passiert.
//
// Ein bereits vorhandenes "absent" (bewusst als "nicht vorhanden"
// bestätigt) wird NICHT automatisch überschrieben, da das ein echter
// Widerspruch wäre (kann eigentlich nicht vorkommen) - wird stattdessen
// als Warnung zurückgegeben, die Person muss das manuell auflösen.
async function autoUpdateParentFlaxenCarriers(payload) {
  const genes = presentGenesSummary(
    payload.colors, payload.coat_color, payload.notes, payload.name, null, payload.color_gene_overrides,
  );
  const isVisiblyFlaxen = genes.some((g) => g.locus === 'Flaxen' && g.alleles === 'flfl');
  if (!isVisiblyFlaxen) return { updated: [], warnings: [] };

  const ancestors = Array.isArray(payload.pedigree) ? payload.pedigree.slice(1) : (payload.pedigree?.ancestors || []);
  const parentNames = [ancestors[0]?.name, ancestors[1]?.name].filter(Boolean);
  if (!parentNames.length) return { updated: [], warnings: [] };

  const allHorses = await localGetAll(LOCAL_STORES.horses);
  const nameSet = new Set(parentNames.map((n) => n.toLowerCase()));
  const parents = allHorses.filter((h) => nameSet.has((h.name || '').toLowerCase()));
  if (!parents.length) return { updated: [], warnings: [] };

  const updated = [];
  const warnings = [];
  for (const parent of parents) {
    const overrides = parent.color_gene_overrides || {};
    const current = overrides.Flaxen;
    if (current === 'het' || current === 'hom') continue; // schon (mind.) Träger bestätigt
    if (current === 'absent') {
      warnings.push(parent.name);
      continue;
    }
    try {
      await localPut(LOCAL_STORES.horses, {
        ...parent,
        color_gene_overrides: { ...overrides, Flaxen: 'het' },
        updated_at: new Date().toISOString(),
      });
      updated.push(parent.name);
    } catch {
      // Ein Fehler bei der automatischen Eltern-Markierung soll den
      // eigentlichen Speichervorgang des Pferdes nicht abbrechen.
    }
  }
  return { updated, warnings };
}

// Führt "payload" (das frisch ausgefüllte/geparste Formular) mit einem
// gefundenen bestehenden Datensatz zusammen - für Felder, die in payload
// bereits stehen, per mergeFieldValue (leer im neuen Formular -> alten
// Wert behalten). Die strukturierten JSONB-Felder (Turnierwerte,
// Stammbaum, Farbgenetik, ...) stehen bei einer vermeintlichen Neuanlage
// OHNE eigenes "Automatisch auslesen" aber gar nicht erst in payload
// (siehe runSaveFlow: nur was in extraData steht, landet dort) - ohne
// dieses Nachtragen würden sie beim UPDATE schlicht nicht angefasst
// (bleiben also ohnehin unverändert bestehen), ABER missingDataWarnings
// direkt danach würde sie fälschlich als "fehlt" melden, weil es sie in
// payload gar nicht sieht. Deshalb hier zusätzlich aus dem bestehenden
// Datensatz nachtragen, wenn sie in payload fehlen.
function mergePayloadFromExisting(payload, existing) {
  for (const key of Object.keys(payload)) {
    payload[key] = mergeFieldValue(key, existing[key], payload[key]);
  }
  for (const key of JSONB_KEYS) {
    if (!(key in payload)) payload[key] = existing[key];
  }
}

// Ermittelt, ob dieser Speichervorgang ein neuer Datensatz wird oder
// (still oder nach Rückfrage) ein bestehender Datensatz ergänzt wird -
// inklusive dem eigentlichen Zusammenführen der Feldwerte (mergeFieldValue).
// Bewusst von der eigentlichen DB-Schreiboperation (performSave)
// getrennt: muss VOR der Vollständigkeits-Prüfung in runSaveFlow laufen,
// damit diese den bereits gemergten (statt nur den frisch eingefügten)
// Stand prüft - sonst würde ein bloßer Nachtrag zu einem bereits
// vollständigen Pferd fälschlich als "unvollständig" gemeldet, nur weil
// diesmal ein kürzerer Text eingefügt wurde. Gibt bei einem Lookup-Fehler
// null zurück (Fehlermeldung ist dann bereits in #form-error gesetzt).
async function resolveSaveTarget(formData, payload) {
  const errorEl = document.getElementById('form-error');

  let beforeRecord = editingId ? originalRecord : null;
  let targetId = editingId ? localHorseKey(editingId) : null;

  try {
    if (!targetId) {
      const horses = await localGetAll(LOCAL_STORES.horses);

      const version = payload.game_version || 'DE';
      const existing = horses.find(
        (h) =>
          (h.name || '').toLowerCase() === (formData.name || '').toLowerCase() &&
          (h.game_version || 'DE') === version
      ) || null;

      if (existing) {
        targetId = existing.id;
        beforeRecord = existing;
        mergePayloadFromExisting(payload, existing);
      } else if (payload.external_id) {
        const idMatch = horses.find(
          (h) =>
            String(h.external_id || '') === String(payload.external_id) &&
            (h.game_version || 'DE') === version
        ) || null;
        if (idMatch) {
          targetId = idMatch.id;
          beforeRecord = idMatch;
          mergePayloadFromExisting(payload, idMatch);
        }
      }

      if (!targetId) {
        const newStats = quickStatsOf(payload);
        const candidate = horses.find(
          (h) => (h.game_version || 'DE') === version && statsMatch(newStats, quickStatsOf(h))
        ) || null;

        if (candidate) {
          const isSame = await askIsDuplicateHorse(
            ['GP, Ext, Ext% und Int identisch'],
            { name: formData.name, owner: formData.owner, external_id: formData.external_id, ...newStats },
            { name: candidate.name, owner: candidate.owner, external_id: candidate.external_id, ...quickStatsOf(candidate) },
          );
          if (isSame) {
            targetId = candidate.id;
            beforeRecord = candidate;
            mergePayloadFromExisting(payload, candidate);
          }
        }
      }
    }
  } catch (error) {
    errorEl.textContent = 'Prüfung auf bestehenden Datensatz fehlgeschlagen: ' + error.message;
    return null;
  }

  return { targetId, payload, beforeRecord };
}

async function performSave(formData, payload, session, targetId, beforeRecord) {
  const errorEl = document.getElementById('form-error');

  let insertedId;
  try {
    const now = new Date().toISOString();
    if (targetId) {
      const existing = await localGet(LOCAL_STORES.horses, localHorseKey(targetId));
      await localPut(LOCAL_STORES.horses, {
        ...(existing || {}),
        ...payload,
        id: localHorseKey(targetId),
        created_at: existing?.created_at || beforeRecord?.created_at || now,
        updated_at: now,
        last_change_source: currentChangeSource,
      });
    } else {
      const record = {
        ...payload,
        user_id: session.user.id,
        created_at: now,
        updated_at: now,
        last_change_source: currentChangeSource,
      };
      insertedId = await localAdd(LOCAL_STORES.horses, record);
    }
  } catch (error) {
    errorEl.textContent = 'Speichern fehlgeschlagen: ' + error.message;
    return;
  }

  let pregnancyPairingResult = { action: 'none' };
  const savedHorseId = targetId || insertedId;
  if (
    currentParsedPregnancy?.detected_from_profile &&
    currentParsedPregnancy?.is_pregnant === true &&
    typeof syncPregnancyPairingFromSavedHorse === 'function'
  ) {
    try {
      const savedMare = await localGet(LOCAL_STORES.horses, localHorseKey(savedHorseId));
      pregnancyPairingResult = await syncPregnancyPairingFromSavedHorse(
        savedMare,
        currentParsedPregnancy,
        session.user.id
      );
    } catch (error) {
      pregnancyPairingResult = {
        action: 'error',
        message: error.message,
        sire: currentParsedPregnancy?.sire_name || null,
        foaling_date: currentParsedPregnancy?.foaling_date || null,
      };
      console.error('Automatische Tragend?-Übernahme fehlgeschlagen:', error);
    }
  }

  // Läuft nach dem eigentlichen Speichern, damit "payload" garantiert die
  // endgültigen (u.a. gemergten) Werte enthält - siehe
  // autoUpdateParentFlaxenCarriers weiter oben.
  const flaxenResult = await autoUpdateParentFlaxenCarriers(payload);

  // Bekommt ein Pferd bei diesem Speichervorgang neu die Zuchtzulassung
  // (vorher nicht "Ja", jetzt "Ja") - im Spiel ändert sich dadurch meist
  // auch das Pferdebild, das bisher gespeicherte Bild ist dann veraltet.
  // Nur ein einmaliger Hinweis direkt bei der Änderung, nicht bei jedem
  // weiteren Speichern eines bereits zugelassenen Pferds.
  const zzlJustApproved = Boolean(
    targetId && beforeRecord && beforeRecord.breeding_allowed !== true && payload.breeding_allowed === true,
  );

  // Wird in der Übersicht nach der Weiterleitung als Banner angezeigt und
  // dort direkt wieder aus dem sessionStorage entfernt (siehe list.js) -
  // nur setzen, wenn es auch wirklich dorthin geht (bei den Pfeil-Buttons
  // geht es stattdessen zum naechsten/vorherigen Pferd, siehe
  // onSaveAndNavigate - sonst wuerde der Banner erst beim naechsten
  // zufaelligen Besuch der Uebersicht faelschlich fuer dieses Pferd
  // erscheinen).
  if (saveRedirect === 'index.html') {
    sessionStorage.setItem('mdr_flash', JSON.stringify({
      action: targetId ? 'updated' : 'created',
      name: formData.name,
      // Wurden zuvor bereits Pferde per "Speichern & nächstes Pferd"
      // erfasst (siehe resetFormForNextEntry), zaehlt dieser letzte,
      // regulaer per "Speichern" abgeschlossene Speichervorgang als Ende
      // der Massenerfassung - der Banner in der Uebersicht listet dann
      // ALLE in dieser Sitzung neu angelegten Pferde statt nur dieses
      // eine, damit man den Ueberblick behaelt.
      bulkNames: bulkSessionEntries.length ? [...bulkSessionEntries.map((e) => e.name), formData.name] : null,
      changedFields: targetId ? computeChangedFields(beforeRecord, payload) : [],
      flaxenUpdated: flaxenResult.updated,
      flaxenWarnings: flaxenResult.warnings,
      zzlJustApproved,
      pregnancyPairing: pregnancyPairingResult,
    }));
  }
  if (saveRedirect === null) {
    resetFormForNextEntry(formData.name, targetId || insertedId, Boolean(targetId));
    return;
  }
  window.location.href = saveRedirect;
}

// Setzt das Formular nach "Speichern & nächstes Pferd" auf den Stand
// einer leeren Neuanlage zurück, ohne die Seite neu zu laden (spart bei
// vielen Pferden hintereinander den Umweg über die Übersicht). Native
// form.reset() deckt die meisten Formularfelder ab (Text/Zahl/Auswahl/
// Kästchen inkl. Schlagwörter) - Rohtext-Box und die aus dem Rohtext
// abgeleiteten Detail-Tabellen/Vorschau liegen außerhalb des <form> bzw.
// werden aus extraData gerendert und müssen deshalb manuell geleert
// werden.
async function resetFormForNextEntry(savedName, savedId, wasUpdate) {
  bulkSessionEntries.push({ id: savedId, name: savedName, updated: wasUpdate });
  document.getElementById('horse-form').reset();
  extraData = {};
  currentParsedPregnancy = null;
  originalRecord = null;
  currentChangeSource = 'manuell';
  document.getElementById('raw-text').value = '';
  document.getElementById('paste-details').open = true;
  document.getElementById('parse-status').textContent = '';
  document.getElementById('form-error').textContent = '';
  const reviewPanel = document.getElementById('import-review-panel');
  if (reviewPanel) { reviewPanel.hidden = true; reviewPanel.innerHTML = ''; }
  fillTagCheckboxes([]);
  updateBreedCompositionVisibility();
  updateStudFeeVisibility();
  updateAppaloosaPatternVisibility();
  renderCupResultsEditor(extraData);
  updateImagePreview();
  await renderDetailTables(extraData);
  activateTab('stammdaten');

  renderBulkSessionCard();

  document.getElementById('raw-text').focus();
}

// Baut die Massenerfassung-Karte auf (siehe .bulk-session-card in
// style.css) - Zähler, Liste der bereits erfassten Pferde (grüner Haken
// bei echter Neuanlage, blaues "aktualisiert"-Abzeichen bei einem
// Nachtrag zu einem bereits bestehenden Pferd, siehe bulkSessionEntries)
// sowie ein Button, um die Sitzung ohne eine weitere (leere) Neuanlage
// direkt zu beenden.
function renderBulkSessionCard() {
  const listEl = document.getElementById('bulk-session-list');
  listEl.hidden = false;
  const items = bulkSessionEntries.map((entry) => `
    <li class="bulk-session-item">
      <span class="bulk-session-icon">${entry.updated ? '🔵' : '✅'}</span>
      <a href="horse.html?id=${encodeURIComponent(entry.id)}">${escapeHtml(entry.name)}</a>
      ${entry.updated ? '<span class="bulk-session-badge">aktualisiert</span>' : ''}
    </li>
  `).join('');
  listEl.innerHTML = `
    <div class="bulk-session-count">${bulkSessionEntries.length}</div>
    <div class="bulk-session-label">In dieser Sitzung erfasst</div>
    <ul class="bulk-session-items">${items}</ul>
    <button type="button" id="bulk-session-finish-btn" class="secondary">Fertig / Zur Übersicht</button>
  `;
  document.getElementById('bulk-session-finish-btn').addEventListener('click', onBulkSessionFinish);
}

// Beendet die Massenerfassung-Sitzung direkt von der Karte aus, ohne dass
// dafür noch ein (leeres) weiteres Pferd gespeichert werden muss - zeigt
// in der Übersicht denselben Sammel-Banner wie ein regulärer Abschluss
// per "Speichern" (siehe bulkNames in performSave).
function onBulkSessionFinish() {
  sessionStorage.setItem('mdr_flash', JSON.stringify({
    action: 'created',
    bulkNames: bulkSessionEntries.map((e) => e.name),
  }));
  window.location.href = 'index.html';
}

async function onDelete() {
  if (!editingId) return;
  if (!confirm('Dieses Pferd wirklich unwiderruflich löschen?')) return;
  try {
    await localDelete(LOCAL_STORES.horses, localHorseKey(editingId));
  } catch (error) {
    document.getElementById('form-error').textContent = 'Löschen fehlgeschlagen: ' + error.message;
    return;
  }
  window.location.href = 'index.html';
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
  if (data.colors?.length) {
    const notes = document.getElementById('notes').value;
    const horseName = document.getElementById('name').value;
    const { hints: parentHints, parentMightHavePearl } = await fetchParentColorHints(data.pedigree, data.coat_color, notes, horseName);
    genetikParts.push(colorGeneticsHtml(data.colors, data.coat_color, notes, horseName, parentHints, data.color_gene_overrides, parentMightHavePearl));
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
  renderCupResultsEditor(data);

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
// UND (falls Vater/Mutter in der Datenbank stehen und dort reinerbig
// getestet sind) den Eltern einbezogen (siehe fetchParentColorHints) -
// eine manuelle Bestätigung/Ausschluss (overrides, per Klick-Button,
// siehe geneOverrideBadge) hat dabei Vorrang vor diesen automatischen
// Hinweisen.
function colorGeneticsHtml(rows, coatColorName, notes, horseName, parentHints, overrides, parentMightHavePearl) {
  const ov = overrides || {};
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
          }
        }
        badges += geneOverrideBadge(key, state, allele);
      }
      if (parts.length) value += ' — ' + parts.join(', ');
    } else if (untested) {
      const overrideState = ov[r.label] || null;
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
      }
      badges = geneOverrideBadge(r.label, overrideState, LOCUS_PRIMARY_ALLELE[r.label]);
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

async function fetchParentColorHints(pedigree, coatColorName, notes, horseName) {
  const parents = await fetchParentRecords(pedigree);
  return {
    hints: [
      ...parentColorHints(parents),
      ...pintoParentHints(parents, coatColorName, notes, horseName),
    ],
    parentMightHavePearl: parentsMightHavePearl(parents),
  };
}

// GP (Gesamtpotenzial) und Begabung stehen im Text schon zusammen; die
// Hauptdisziplin (übergeordnete Kategorie der Begabung, z.B. "Western" für
// "Trail") wird hier aus den bereits geparsten Disziplin-Gruppen abgeleitet.
function findDisciplineCategory(disciplines, name) {
  if (!disciplines || !name) return null;
  for (const [category, entries] of Object.entries(disciplines)) {
    if (entries.some((e) => e.name === name)) return category;
  }
  return null;
}

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
  return `<a href="view.html?id=${encodeURIComponent(horse.id)}" title="Pferd in der Datenbank öffnen">${safe}</a>`;
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
