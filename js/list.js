// Lokale Version: Supabase-Zugriffe dieser Datei wurden auf IndexedDB umgestellt.
let currentSort = { field: 'name', dir: 'asc' };
let selectedIds = new Set();
let lastRenderedRows = [];
let pendingDeleteIds = [];
// Bevorzugte Rassen aus den persönlichen Einstellungen (siehe
// einstellungen.html) - null/leer = keine persönliche Rassenauswahl.
// Diese Auswahl wirkt nur noch bei der ausdrücklichen Filteroption
// "Meine Rassenauswahl". "Alle" bedeutet seit V53.3 wirklich alle Rassen.
let preferredBreeds = null;
// Ø-Vergleich (Checkbox "Ø-Vergleich anzeigen", siehe wireCompareAvg) -
// null = aus, sonst {gp, ext, extPercent, int} als Vergleichsbasis für
// die Grün/Rot-Markierung in rowHtml.
let compareBaseline = null;
// Persönliche Toleranzwerte für den Ø-Vergleich (Einstellungen, siehe
// migration_027_compare_tolerances.sql) - {gp, ext, extPercent, int},
// jeweils "wie viel schlechter als der Durchschnitt zählt noch als
// akzeptabel" (0/fehlend = keine Toleranz, wie bisher). Siehe cmpClass.
let compareTolerances = {};
// Häkchen "Toleranz berücksichtigen" (siehe wireCompareAvg) - bei false
// wirkt effectiveTolerance() überall wie 0, d.h. keine grüne Toleranzzone,
// nur noch strikt besser (grün) / schlechter (rot) wie vor diesem Feature.
let compareToleranceEnabled = true;
// Eingeloggtes Konto - wird u.a. von saveFilterPreset() gebraucht (siehe
// wireFilterPresets), sonst nur lokal in init() gebraucht.
let currentSession = null;
// Benutzername (vor dem @) des lokalen Kontos - nur fuer persoenliche
// Datenqualitaets- und Alters-Hinweise; kein Besitzer-Schnellfilter.
let currentIdentity = null;
let bestFoalOverviewEnabled = true;
let breedingOverviewContext = null;
let breedingOverviewContextVersion = -1;
const derivedHorseCache = new WeakMap();

document.addEventListener('DOMContentLoaded', init);

// --- Lokale IndexedDB-Hilfsfunktionen ---------------------------------
// IDs aus HTML-data-Attributen kommen als Strings zurück. IndexedDB kann
// jedoch numerische autoIncrement-IDs enthalten. Diese Helfer finden den
// Datensatz deshalb zuverlässig unabhängig davon, ob die ID Zahl/String ist.
async function getLocalRecordById(storeName, id) {
  let record = await localGet(storeName, id);
  if (record) return record;
  const numericId = Number(id);
  if (!Number.isNaN(numericId) && String(numericId) === String(id)) {
    record = await localGet(storeName, numericId);
  }
  return record || null;
}

async function deleteLocalRecordById(storeName, id) {
  const record = await getLocalRecordById(storeName, id);
  if (!record) return;
  await localDelete(storeName, record.id);
}

async function getLocalHorseById(id) {
  return getLocalRecordById(LOCAL_STORES.horses, id);
}

async function init() {
  const session = await requireSession();
  if (!session) return;
  currentSession = session;
  currentIdentity = session.user.email.split('@')[0];
  await renderSharedNav(session);

  // Die zuletzt in Übersicht oder Pferdeseite gewählte Reihenfolge bleibt
  // erhalten und wird auch für das Vor-/Zurück-Blättern verwendet.
  try {
    const savedSort = JSON.parse(localStorage.getItem('mdr-horse-view-sort-v5367') || 'null');
    if (savedSort?.field && ['name','gender','breed','coat_color','gp','ext','extpct','int','hlpslp','zzl','owner','birthdate','updated_at'].includes(savedSort.field)) {
      currentSort = { field: savedSort.field, dir: savedSort.dir === 'desc' ? 'desc' : 'asc' };
    }
  } catch {}

  // In der lokalen Version gehört die Datenbank vollständig dem lokalen
  // Benutzer; Löschen wird daher nicht über die frühere Admin-Rolle gesperrt.
  wireFilterForm();
  wireBestFoalFilter();
  wireSortableHeaders();
  wireSelection();
  wireCheckDropdowns();
  wireDeleteModal();
  wireExportCsv();
  wireCompareAvg();
  wireFilterPresets();
  wireScrollTop();
  showFlashBanner();
  await loadUserSettings(session);
  await showMissingDataNotice(session);
  await checkAgeNotices(session);
  // Diese drei Bereiche sind voneinander unabhängig. Nach dem einmaligen
  // Pferde-Ladevorgang dürfen ihre restlichen Stores parallel aus Supabase
  // kommen statt drei Warteketten nacheinander zu bilden.
  await Promise.all([
    loadTagSuggestions(),
    populateFilterOptions(),
    loadFilterPresets(),
  ]);
  await loadHorses();
}

// Lädt die in einstellungen.html gewählten persönlichen Einstellungen für
// das eingeloggte Konto (siehe migration_017/018) und wendet die
// bevorzugten Rassen für die ausdrückliche Option "Meine Rassenauswahl". Das
// Aus-/Einblenden des "Verpaarungs-Log"-Menüpunkts übernimmt zentral
// renderSharedNav() (js/nav.js), da das jetzt auf jeder Seite gilt, nicht
// nur hier.
async function loadUserSettings(session) {
  // Lokal gibt es nur einen Benutzer. Einstellungen werden unter einem
  // festen Schlüssel gespeichert; fehlt der Datensatz, gelten Standards.
  const data = await localGet(LOCAL_STORES.userSettings, 'settings');
  preferredBreeds = data?.preferred_breeds?.length ? data.preferred_breeds : null;
  compareTolerances = data?.compare_tolerances || {};
  bestFoalOverviewEnabled = data?.show_best_foal_overview !== false;
  syncBestFoalFeatureVisibility();
}

// Zeigt einen Hinweis über den Filtern, wenn bei den EIGENEN Pferden
// (Besitzer-Feld entspricht dem eingeloggten Benutzernamen) noch Daten
// fehlen (siehe missingDataLabels in parser.js) - z.B. weil beim Kopieren
// aus dem Spiel nicht die ganze Seite markiert wurde. Andere Nutzer*innen
// sehen diesen Hinweis nur für ihre eigenen Pferde, nicht für die anderer.
async function showMissingDataNotice(session) {
  const all = await localGetAll(LOCAL_STORES.horses);
  const data = typeof mdrHorseBelongsToSession === 'function'
    ? all.filter((h) => mdrHorseBelongsToSession(h, session))
    : all.filter((h) => (h.owner || '').toLowerCase() === String(currentIdentity || session.user.email.split('@')[0]).toLowerCase());

  const noticeState = await loadPersonalNoticeState(session);
  const dismissed = new Set(Array.isArray(noticeState?.missingData) ? noticeState.missingData.map(String) : []);
  const incomplete = data
    .map((h) => ({ id: h.id, name: h.name, missing: missingDataLabels(h) }))
    .filter((h) => h.missing.length && !dismissed.has(String(h.id)));

  const notice = document.querySelector('#missing-data-notice');
  if (!incomplete.length) {
    notice.hidden = true;
    return;
  }
  notice.classList.add('personal-dismissible-notice');
  const list = incomplete
    .map((h) => `<li data-horse-id="${escapeHtml(String(h.id))}"><span class="age-notice-horse"><a class="btn secondary icon-btn" href="horse.html?id=${h.id}" title="Bearbeiten">✏️</a> <span>${escapeHtml(h.name)} - ${escapeHtml(h.missing.join(', '))}</span></span><button type="button" class="btn secondary age-notice-done" data-dismiss-horse="${escapeHtml(String(h.id))}">Erledigt</button></li>`)
    .join('');
  notice.innerHTML = `<summary><strong>Hinweis:</strong> Es fehlen noch Daten bei ${incomplete.length} Pferd${incomplete.length === 1 ? '' : 'en'}</summary><p>Es fehlen noch folgende Daten:</p><ul>${list}</ul>`;
  notice.hidden = false;
  wirePersonalNoticeDismissButtons(notice, session, 'missingData', (remaining) =>
    `Es fehlen noch Daten bei ${remaining} Pferd${remaining === 1 ? '' : 'en'}`
  );
}

// Drei Alters-Hinweise (Geburtsdatum -> Spieljahre/-monate, siehe
// gameAgeYearsMonths in parser.js), wie showMissingDataNotice nur für
// die eigenen Pferde:
// - Fohlen, die genau 6 Spielmonate alt sind (noch im 1. Spieljahr) -
//   Erinnerung, dass sie einen Stall brauchen, verschwindet von selbst
//   wieder mit 7 Monaten.
// - Pferde, die genau 3 Spieljahre alt sind (ihr viertes Spieljahr läuft
//   gerade) - im Spiel ändert sich das Pferdebild meist mit 3 Jahren,
//   der Hinweis verschwindet von selbst wieder, sobald das Pferd 4 wird.
// - Pferde über 25 Spieljahre - bekommen automatisch das Schlagwort
//   "GBH" zugewiesen, falls noch nicht vorhanden, und werden hier als
//   Bestätigung aufgelistet.
async function checkAgeNotices(session) {
  const identity = currentIdentity || session.user.email.split('@')[0];
  const all = await localGetAll(LOCAL_STORES.horses);

  // GBH ist kein manuell zu pflegender Altersstatus mehr:
  // ab 25 vollen Spieljahren wird das Schlagwort für ALLE lokalen Pferde
  // automatisch in der Datenbank ergänzt.
  for (const horse of all) {
    if (gameAgeYears(horse.birthdate) >= 25) {
      const cleaned = effectiveHorseTags(horse.tags, horse.birthdate);
      const differs = JSON.stringify(cleaned) !== JSON.stringify(horse.tags || []);
      if (differs) {
        await localPut(LOCAL_STORES.horses, {
          ...horse,
          tags: cleaned,
          updated_at: new Date().toISOString(),
        });
        horse.tags = cleaned;
      }
    }
  }

  // Persönliche Erinnerungsboxen: Anevay sieht Anevay + Wilder Wolf,
  // Saeculume ausschließlich Saeculume. Der gemeinsame Tabellenbestand bleibt unberührt.
  const data = typeof mdrHorseBelongsToSession === 'function'
    ? all.filter((h) => mdrHorseBelongsToSession(h, session))
    : all.filter((h) => (h.owner || '').toLowerCase() === identity.toLowerCase());

  const noticeState = await loadPersonalNoticeState(session);
  const dismissedFoalStall = new Set(Array.isArray(noticeState?.foalStall) ? noticeState.foalStall.map(String) : []);
  const dismissedAge3 = new Set(Array.isArray(noticeState?.age3) ? noticeState.age3.map(String) : []);
  const dismissedAge25 = new Set(Array.isArray(noticeState?.age25) ? noticeState.age25.map(String) : []);

  const withAge = data
    .map((h) => ({ ...h, age: gameAgeYearsMonths(h.birthdate) }))
    .filter((h) => h.age != null);

  const needsStall = withAge.filter((h) => h.age.years === 0 && h.age.months === 6 && !dismissedFoalStall.has(String(h.id)));
  renderAgeNotice(
    '#foal-stall-notice',
    needsStall,
    `${needsStall.length} Fohlen ${needsStall.length === 1 ? 'ist' : 'sind'} 6 Monate alt`,
    '<p>Fohlen brauchen ab 6 Monaten einen eigenen Stall:</p>',
    { dismissType:'foalStall', session },
  );

  const turningThree = withAge.filter((h) => {
    if (dismissedAge3.has(String(h.id))) return false;
    if (h.age.years !== 3) return false;
    const turnedThreeAt = new Date(h.birthdate).getTime() + 3 * REAL_DAYS_PER_GAME_YEAR * 86400000;
    const createdAt = h.created_at ? new Date(h.created_at).getTime() : 0;
    if (createdAt >= turnedThreeAt) return false;
    const savedAt = h.updated_at ? new Date(h.updated_at).getTime() : 0;
    return savedAt < turnedThreeAt;
  });
  renderAgeNotice(
    '#age3-notice',
    turningThree,
    `${turningThree.length} Pferd${turningThree.length === 1 ? '' : 'e'} ${turningThree.length === 1 ? 'ist' : 'sind'} 3 Jahre alt geworden`,
    '<p>Im Spiel ändert sich das Pferdebild meist mit 3 Jahren - bitte prüfen und ggf. aktualisieren:</p>',
    { dismissType:'age3', session },
  );

  const over25 = withAge.filter((h) => h.age.years >= 25 && !dismissedAge25.has(String(h.id)));
  renderAgeNotice(
    '#age25-notice',
    over25,
    `${over25.length} Pferd${over25.length === 1 ? '' : 'e'} ab 25 Jahren - automatisch mit „GBH" markiert`,
    '<p>Pferde ab 25 Spieljahren werden automatisch mit dem Schlagwort „GBH" (Gnadenbrot) markiert:</p>',
    { dismissType:'age25', session },
  );
}

function personalNoticeMirrorKey(session) {
  const slug = typeof mdrPersonalSettingKey === 'function'
    ? mdrPersonalSettingKey('personal_notice_state', session)
    : `personal_notice_state:${String(session?.user?.email || 'unknown').split('@')[0].toLowerCase()}`;
  return `mdr-${slug}-mirror-v5404`;
}

function normalizePersonalNoticeState(raw, key) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    ...source,
    key: source.key || key,
    missingData: Array.isArray(source.missingData) ? source.missingData.map(String) : [],
    foalStall: Array.isArray(source.foalStall) ? source.foalStall.map(String) : [],
    age3: Array.isArray(source.age3) ? source.age3.map(String) : [],
    age25: Array.isArray(source.age25) ? source.age25.map(String) : [],
  };
}

function mergePersonalNoticeStates(a, b, key) {
  const left = normalizePersonalNoticeState(a, key);
  const right = normalizePersonalNoticeState(b, key);
  const merged = { ...left, ...right, key };
  for (const field of ['missingData','foalStall','age3','age25']) {
    merged[field] = [...new Set([...(left[field] || []), ...(right[field] || [])].map(String))];
  }
  return merged;
}

function readPersonalNoticeMirror(session, key) {
  try {
    return normalizePersonalNoticeState(JSON.parse(localStorage.getItem(personalNoticeMirrorKey(session)) || 'null'), key);
  } catch {
    return normalizePersonalNoticeState(null, key);
  }
}

function writePersonalNoticeMirror(session, state) {
  try { localStorage.setItem(personalNoticeMirrorKey(session), JSON.stringify(state)); } catch {}
}

async function loadPersonalNoticeState(session) {
  const key = typeof mdrPersonalSettingKey === 'function'
    ? mdrPersonalSettingKey('personal_notice_state',session)
    : `personal_notice_state:${String(session?.user?.email || 'unknown').split('@')[0].toLowerCase()}`;
  const mirror = readPersonalNoticeMirror(session, key);
  let remote = null;
  try { remote = await localGet(LOCAL_STORES.userSettings,key); } catch (error) {
    console.warn('Persönlicher Hinweisstatus konnte nicht aus Supabase gelesen werden:', error);
  }
  const merged = mergePersonalNoticeStates(remote, mirror, key);
  writePersonalNoticeMirror(session, merged);

  // Falls der lokale Spiegel mehr erledigte Hinweise kennt (z.B. nach einem
  // kurzzeitigen Verbindungsproblem), wird der Cloud-Stand automatisch geheilt.
  const remoteNorm = normalizePersonalNoticeState(remote, key);
  const fields = ['missingData','foalStall','age3','age25'];
  const needsHeal = fields.some(field => merged[field].some(id => !remoteNorm[field].includes(id)));
  if (needsHeal) {
    try {
      await localPut(LOCAL_STORES.userSettings, { ...merged, updated_at:new Date().toISOString() });
    } catch (error) {
      console.warn('Persönlicher Hinweisstatus konnte nicht zurück nach Supabase synchronisiert werden:', error);
    }
  }
  return merged;
}

async function dismissPersonalNotice(session, type, horseId) {
  const key = typeof mdrPersonalSettingKey === 'function'
    ? mdrPersonalSettingKey('personal_notice_state',session)
    : `personal_notice_state:${String(session?.user?.email || 'unknown').split('@')[0].toLowerCase()}`;
  const current = await loadPersonalNoticeState(session);
  const values = new Set(Array.isArray(current[type]) ? current[type].map(String) : []);
  values.add(String(horseId));
  const next = normalizePersonalNoticeState({
    ...current,
    key,
    [type]: [...values],
    updated_at: new Date().toISOString(),
  }, key);

  // Erst Cloud schreiben und anschließend verifizieren. Der Button verschwindet
  // erst, wenn der persistierte Zustand wirklich wieder gelesen werden kann.
  await localPut(LOCAL_STORES.userSettings,next);
  const verify = normalizePersonalNoticeState(await localGet(LOCAL_STORES.userSettings,key), key);
  if (!verify[type].includes(String(horseId))) {
    throw new Error('Supabase hat den Erledigt-Status nicht bestätigt.');
  }
  writePersonalNoticeMirror(session, mergePersonalNoticeStates(verify, next, key));
}

function personalNoticeSummary(type, remaining) {
  if (type === 'missingData') return `Es fehlen noch Daten bei ${remaining} Pferd${remaining === 1 ? '' : 'en'}`;
  if (type === 'foalStall') return `${remaining} Fohlen ${remaining === 1 ? 'ist' : 'sind'} 6 Monate alt`;
  if (type === 'age3') return `${remaining} Pferd${remaining === 1 ? '' : 'e'} ${remaining === 1 ? 'ist' : 'sind'} 3 Jahre alt geworden`;
  if (type === 'age25') return `${remaining} Pferd${remaining === 1 ? '' : 'e'} ab 25 Jahren - automatisch mit „GBH" markiert`;
  return `${remaining} Hinweis${remaining === 1 ? '' : 'e'}`;
}

function wirePersonalNoticeDismissButtons(notice, session, dismissType, summaryBuilder=null) {
  notice.querySelectorAll('[data-dismiss-horse]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const horseId = btn.dataset.dismissHorse;
      btn.disabled = true;
      btn.textContent = 'Speichert…';
      try {
        await dismissPersonalNotice(session,dismissType,horseId);
        btn.closest('li')?.remove();
        const remaining = notice.querySelectorAll('li').length;
        if (!remaining) {
          notice.hidden = true;
        } else {
          const summary = notice.querySelector('summary');
          const text = summaryBuilder ? summaryBuilder(remaining) : personalNoticeSummary(dismissType, remaining);
          if (summary) summary.innerHTML = `<strong>Hinweis:</strong> ${text}`;
        }
      } catch (error) {
        console.error('Hinweis konnte nicht als erledigt gespeichert werden:',error);
        btn.disabled = false;
        btn.textContent = 'Erledigt';
        alert('Der Erledigt-Status konnte nicht dauerhaft gespeichert werden. Bitte erneut versuchen.');
      }
    });
  });
}

function renderAgeNotice(selector, horses, summaryText, introHtml, options={}) {
  const notice = document.querySelector(selector);
  if (!horses.length) {
    notice.hidden = true;
    return;
  }
  const dismissable = Boolean(options.dismissType && options.session);
  if (dismissable) notice.classList.add('personal-dismissible-notice');
  const list = horses
    .map((h) => `<li data-horse-id="${escapeHtml(String(h.id))}"><span class="age-notice-horse"><a class="btn secondary icon-btn" href="horse.html?id=${h.id}" title="Bearbeiten">✏️</a> <span>${escapeHtml(h.name)}</span></span>${dismissable ? `<button type="button" class="btn secondary age-notice-done" data-dismiss-horse="${escapeHtml(String(h.id))}">Erledigt</button>` : ''}</li>`)
    .join('');
  notice.innerHTML = `<summary><strong>Hinweis:</strong> ${summaryText}</summary>${introHtml}<ul>${list}</ul>`;
  notice.hidden = false;

  if (dismissable) wirePersonalNoticeDismissButtons(notice, options.session, options.dismissType, options.summaryBuilder || null);
}

// Vorgeschlagene Schlagwörter (Staging-Tabelle "tag_suggestions", siehe
// migration_023_tag_suggestions.sql) - z.B. vom MDR-Planer eingetragen.
// Wirken sich NICHT sofort auf horses.tags aus, sondern erscheinen hier
// zum manuellen Übernehmen oder Verwerfen. Nutzerwunsch: nur für das
// eigene Pferd sichtbar (horses.owner === currentIdentity, case-
// insensitiv anhand der lokalen Identität), nicht für alle Konten - andere
// Vorschläge existieren zwar weiter in der Tabelle, werden hier aber
// ausgefiltert.
async function loadTagSuggestions() {
  const notice = document.querySelector('#tag-suggestions-notice');
  const suggestions = await localGetAll(LOCAL_STORES.tagSuggestions);
  const horses = await localGetAll(LOCAL_STORES.horses);
  const horseMap = new Map(horses.map((h) => [String(h.id), h]));
  const data = suggestions.map((s) => ({ ...s, horses: horseMap.get(String(s.horse_id)) || null }));
  const own = typeof mdrHorseBelongsToSession === 'function'
    ? data.filter((s) => mdrHorseBelongsToSession(s.horses, currentSession))
    : data.filter((s) => (s.horses?.owner || '').toLowerCase() === currentIdentity.toLowerCase());
  if (!own.length) {
    notice.hidden = true;
    return;
  }

  const list = own.map((s) => {
    const horseName = s.horses?.name || '(unbekanntes Pferd)';
    const badgeText = s.note ? `${s.label}: ${s.note}` : s.label;
    const sourceText = s.source ? ` <span class="muted small">(aus ${escapeHtml(s.source)})</span>` : '';
    return `<li>
      <span class="horse-tag-badge" style="background:${tagColor(s.label)}">${escapeHtml(badgeText)}</span>
      für <a href="horse.html?id=${s.horse_id}">${escapeHtml(horseName)}</a>${sourceText}
      <button type="button" class="secondary icon-btn" data-accept-suggestion="${s.id}" title="Übernehmen">✓</button>
      <button type="button" class="secondary icon-btn" data-discard-suggestion="${s.id}" title="Verwerfen">✗</button>
    </li>`;
  }).join('');

  notice.innerHTML = `<summary><strong>Hinweis:</strong> ${own.length} vorgeschlagene${own.length === 1 ? 's' : ''} Schlagwort${own.length === 1 ? '' : 'e'} aus dem MDR-Planer</summary><ul>${list}</ul>`;
  notice.hidden = false;

  notice.querySelectorAll('[data-accept-suggestion]').forEach((btn) => {
    btn.addEventListener('click', () => onAcceptTagSuggestion(btn.dataset.acceptSuggestion));
  });
  notice.querySelectorAll('[data-discard-suggestion]').forEach((btn) => {
    btn.addEventListener('click', () => onDiscardTagSuggestion(btn.dataset.discardSuggestion));
  });
}

// Übernimmt einen Vorschlag ins eigentliche horses.tags (nach Label
// zusammengeführt - ein gleichlautendes bereits vorhandenes Schlagwort
// wird durch den Vorschlag samt seinem Zusatztext ersetzt, andere
// bleiben erhalten) und entfernt ihn danach aus der Staging-Tabelle.
async function onAcceptTagSuggestion(id) {
  const suggestion = await getLocalRecordById(LOCAL_STORES.tagSuggestions, id);
  if (!suggestion) return;

  const horse = await getLocalHorseById(suggestion.horse_id);
  if (!horse) return;

  const newTag = suggestion.note ? { label: suggestion.label, note: suggestion.note } : { label: suggestion.label };
  const merged = new Map((horse.tags || []).map((t) => [t.label, t]));
  merged.set(newTag.label, newTag);

  await localPut(LOCAL_STORES.horses, {
    ...horse,
    tags: [...merged.values()],
    updated_at: new Date().toISOString(),
  });
  await deleteLocalRecordById(LOCAL_STORES.tagSuggestions, id);
  await loadTagSuggestions();
  await loadHorses();
}

async function onDiscardTagSuggestion(id) {
  await deleteLocalRecordById(LOCAL_STORES.tagSuggestions, id);
  await loadTagSuggestions();
}

// Zeigt nach dem Anlegen/Aktualisieren eines Pferds (siehe horseForm.js)
// einmalig einen Banner mit dessen Namen. "Einmalig" heißt: sofort nach
// dem Anzeigen aus dem sessionStorage entfernt (ein erneutes Laden der
// Seite zeigt ihn also nicht nochmal), und zusätzlich bei der nächsten
// Interaktion (Filtern, Sortieren, Auswählen, Klick irgendwo) sofort
// ausgeblendet.
function showFlashBanner() {
  const raw = sessionStorage.getItem('mdr_flash');
  if (!raw) return;
  sessionStorage.removeItem('mdr_flash');

  let flash;
  try {
    flash = JSON.parse(raw);
  } catch {
    return;
  }
  const banner = document.querySelector('#flash-banner');
  const verb = flash.action === 'updated' ? 'aktualisiert' : 'neu angelegt';
  // Massenerfassung (siehe "Speichern & nächstes Pferd" in horseForm.js):
  // statt nur des zuletzt gespeicherten Pferds werden alle in dieser
  // Sitzung neu angelegten Pferde aufgelistet.
  let text = flash.bulkNames?.length
    ? `${flash.bulkNames.length} Pferde neu angelegt: ${flash.bulkNames.map((n) => `„${n}"`).join(', ')}.`
    : `„${flash.name}" wurde ${verb}.`;
  // Nur beim Aktualisieren sinnvoll (bei einer Neuanlage ist ohnehin
  // "alles neu") - zeigt, welche Felder sich durch diesen Speichervorgang
  // gegenüber dem vorherigen Stand tatsächlich geändert haben (siehe
  // computeChangedFields in horseForm.js).
  if (flash.action === 'updated' && flash.changedFields?.length) {
    text += ` Geändert: ${flash.changedFields.join(', ')}.`;
  }
  // Siehe autoUpdateParentFlaxenCarriers in horseForm.js: automatische
  // Flaxen-Trägerschaft bei den Eltern, wenn dieses Pferd sichtbar Flaxen
  // ist.
  if (flash.flaxenUpdated?.length) {
    text += ` Elternteil${flash.flaxenUpdated.length > 1 ? 'e' : ''} automatisch als Flaxen-Träger markiert: ${flash.flaxenUpdated.join(', ')}.`;
  }
  if (flash.flaxenWarnings?.length) {
    text += ` ⚠️ Widerspruch: ${flash.flaxenWarnings.join(', ')} ${flash.flaxenWarnings.length > 1 ? 'sind' : 'ist'} als "Flaxen nicht vorhanden" markiert, müsste laut diesem Fohlen aber Träger sein - bitte manuell prüfen.`;
  }
  // Siehe zzlJustApproved in horseForm.js: die Zuchtzulassung wurde bei
  // diesem Speichervorgang neu auf "Ja" gesetzt - im Spiel ändert sich
  // dadurch meist auch das Pferdebild.
  if (flash.zzlJustApproved) {
    text += ` 🖼️ Zuchtzulassung wurde auf „Ja" gesetzt – bitte das Bild aktualisieren.`;
  }

  if (flash.pregnancyPairing?.action === 'created' || flash.pregnancyPairing?.action === 'updated') {
    const p = flash.pregnancyPairing;
    const date = p.foaling_date
      ? String(p.foaling_date).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3.$2.$1')
      : 'ohne Termin';
    text += ` 🤰 Tragende Stute erkannt: Verpaarung mit „${p.sire || 'unbekannter Hengst'}" zum ${date} wurde automatisch ins Verpaarungs-Log ${p.action === 'created' ? 'eingetragen' : 'aktualisiert'}.`;
    if (!p.sire_found) {
      text += ' Der Hengst ist noch nicht als passendes Pferd in der Datenbank gefunden – die Prognose wird ergänzt, sobald beide Eltern vorhanden sind.';
    } else if (p.prediction_created) {
      text += ' Die Fohlen-Prognose wurde direkt gespeichert.';
    }
  } else if (flash.pregnancyPairing?.action === 'incomplete') {
    text += ' ⚠️ Tragende Stute erkannt, aber Hengst oder Abfohltermin konnte nicht vollständig ausgelesen werden. Daher wurde keine automatische Verpaarung angelegt.';
  } else if (flash.pregnancyPairing?.action === 'error') {
    text += ` ⚠️ Die Stute wurde gespeichert, aber die automatische Verpaarung konnte nicht angelegt werden: ${flash.pregnancyPairing.message || 'unbekannter Fehler'}.`;
  }

  banner.textContent = text;
  banner.hidden = false;

  const dismiss = () => { banner.hidden = true; };
  document.addEventListener('click', dismiss, { once: true });
  document.addEventListener('change', dismiss, { once: true });
  document.addEventListener('submit', dismiss, { once: true });
}

async function populateFilterOptions() {
  const data = await localGetAll(LOCAL_STORES.horses);

  fillSelect('#f-owner', [...new Set(data.map((d) => d.owner).filter(Boolean))].sort());
  fillSelect('#f-gender', [...new Set(data.map((d) => d.gender).filter(Boolean))].sort());
  const breeds = new Set(data.map((d) => normalizeBreed(d.breed)).filter(Boolean));
  breeds.add('American Paint Horse');
  breeds.add('Rasselos');
  // 'Alle' muss wirklich alle Rassen bedeuten. Die bisherige V47-Logik
  // hat bei gesetzter Rassenauswahl im Hintergrund bereits bei 'Alle'
  // eingeschränkt – dadurch wirkte der sichtbare Filter defekt.
  fillSelect('#f-breed', [...breeds].sort());

  fillSelect('#cmp-breed', [...breeds].sort());
  fillSelect('#cmp-owner', [...new Set(data.map((d) => d.owner).filter(Boolean))].sort());
  fillSelect('#cmp-gender', [...new Set(data.map((d) => d.gender).filter(Boolean))].sort());

  const diseaseLabels = new Set();
  const locusLabels = new Set();
  for (const row of data) {
    for (const d of row.genetic_diseases || []) diseaseLabels.add(d.label);
    for (const c of row.colors || []) locusLabels.add(c.label);
  }
  populateTriStateDropdown('f-ekh-drop', [...diseaseLabels].sort(), { noneOption: 'Keine' });
  locusLabels.delete('KIT');
  populateTriStateDropdown('f-genetik-drop', [...locusLabels].sort(), {
    extra: [
      { value: '__pearl__', label: 'pl – Pearl (mind. 1x)' },
      { value: '__pearl_doubled__', label: 'plpl – Pearl (reinerbig)' },
      { value: '__flaxen__', label: 'fl – Flaxen (mind. 1x)' },
      { value: '__flaxen_doubled__', label: 'flfl – Flaxen (reinerbig)' },
      { value: '__kit_sb__', label: 'Sabino' },
      { value: '__kit_rn__', label: 'Roan' },
      { value: '__kit_to__', label: 'Tobiano' },
    ],
  });

  populateTriStateDropdown('f-tag-drop', getHorseTagOptions().map((t) => t.label), { noneOption: 'Kein Schlagwort' });
}

function fillSelect(selector, values) {
  const sel = document.querySelector(selector);
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }
}

function databaseHorseHasConfirmedCupStar(row) {
  // V54.0.15: Neben ausdrücklich gespeicherten Cupsternen gilt die bekannte
  // MDR-Grundregel automatisch: mindestens 50 Gesamtstarts + mindestens
  // 15 Siege in einer Disziplin. Dadurch funktionieren auch Datenbankfilter
  // sofort, ohne dass ein Pferd erst erneut gespeichert werden muss.
  const structured = Object.values(row?.tournament_results || {}).some((result) => result?.cup_star === true);
  const starts = Number(row?.tournament_starts_total);
  const automatic = Number.isFinite(starts) && starts >= 50 && (
    Object.values(row?.tournament_results || {}).some(result => Number(result?.first || 0) >= 15) ||
    Object.values(row?.cup_results || {}).some(wins => Number(wins || 0) >= 15)
  );
  if (structured || automatic) return true;
  return (row?.tags || []).some((tag) => (typeof tag === 'string' ? tag : tag?.label) === 'Cupstern');
}

async function buildQuery() {
  let data = await localGetAll(LOCAL_STORES.horses);

  const name = document.querySelector('#f-name').value.trim().toLowerCase();
  const owner = document.querySelector('#f-owner').value;
  const gender = document.querySelector('#f-gender').value;
  const breed = document.querySelector('#f-breed').value;
  const gameVersion = document.querySelector('#f-game-version').value;
  const zzl = document.querySelector('#f-zzl').value;
  const breedingStation = document.querySelector('#f-breeding-station')?.value || '';
  const dataQuality = document.querySelector('#f-data-quality').value;
  const learningFile = document.querySelector('#f-learning-file')?.value || 'exclude';
  const cupStarOnly = Boolean(document.querySelector('#f-cupstar')?.checked);

  data = data.filter((row) => {
    if (name && !(row.name || '').toLowerCase().includes(name)) return false;
    if (owner && row.owner !== owner) return false;
    if (gender && row.gender !== gender) return false;

    const rowGameVersion = row.game_version || 'DE';
    if (gameVersion && rowGameVersion !== gameVersion) return false;

    const normalized = normalizeBreed(row.breed) || 'Rasselos';
    if (breed === '__preferred__') {
      if (!preferredBreeds || !preferredBreeds.includes(normalized)) return false;
    } else {
      if (breed === 'Rasselos' && normalized !== 'Rasselos') return false;
      if (breed && breed !== '__unrestricted__' && breed !== 'Rasselos' && normalized !== breed) return false;
    }

    if (zzl === 'true' && row.breeding_allowed !== true) return false;
    if (zzl === 'false' && row.breeding_allowed === true) return false;

    const stationTag = (row.tags || []).some(tag => (typeof tag === 'string' ? tag : tag?.label) === 'Zuchtstation');
    const isInStation = row.in_breeding_station === true || stationTag;
    if (breedingStation === 'true' && !isInStation) return false;
    if (breedingStation === 'false' && isInStation) return false;

    const isLearning = typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(row);
    if (learningFile === 'exclude' && isLearning) return false;
    if (learningFile === 'only' && !isLearning) return false;

    if (cupStarOnly && !databaseHorseHasConfirmedCupStar(row)) return false;

    if (dataQuality) {
      const quality = typeof analyzeHorseDataQuality === 'function'
        ? analyzeHorseDataQuality(row)
        : null;
      if (!quality) return false;

      if (dataQuality === 'not-complete') {
        if (quality.level === 'green') return false;
      } else if (quality.level !== dataQuality) {
        return false;
      }
    }

    return true;
  });

  // Die endgültige Sortierung passiert zentral in applySort(); ein zweiter
  // Namens-Sortierlauf hier wäre bei jedem Filter unnötige Arbeit.
  return { data, error: null };
}

function colorCodeOf(row) {
  return (row.colors || []).map((c) => c.value).join(' ');
}

// GP/Ext/Ext%/Int existieren nicht als eigene Spalten in der Datenbank,
// sondern werden aus den bereits geladenen JSON-Feldern berechnet - hier
// zentral, damit Anzeige (rowHtml) und Filterung (applyClientFilters)
// exakt dieselben Werte verwenden.
function computeDerived(h) {
  if (h && typeof h === 'object' && derivedHorseCache.has(h)) return derivedHorseCache.get(h);
  const gpRaw = h.tournament_potential?.['Gesamtpotenzial'];
  const genes = presentGenesSummary(h.colors, h.coat_color, h.notes, h.name, null, h.color_gene_overrides);
  const derived={
    colorCode: colorCodeOf(h),
    presentGenes: genes.map((g) => g.alleles).join(' '),
    gp: gpRaw != null && gpRaw !== '' ? Number(gpRaw) : null,
    extAvg: averageScore(h.exterior_descriptive, scoreExteriorTerm),
    extPercent: h.exterior_genetics?.overall?.percent ?? null,
    intAvg: averageScore(h.temperament, scoreTemperamentTerm),
  };
  if (h && typeof h === 'object') derivedHorseCache.set(h,derived);
  return derived;
}

// --- Ø-Vergleich (Checkbox "Ø-Vergleich anzeigen") ---

function wireCompareAvg() {
  const toggle = document.querySelector('#compare-avg-toggle');
  const panel = document.querySelector('#compare-avg-panel');
  const toleranceToggle = document.querySelector('#compare-tolerance-toggle');
  const recompute = async () => {
    if (!toggle.checked) return;
    compareBaseline = await computeCompareBaseline();
    renderCompareAvgValues();
    await loadHorses();
  };
  toggle.addEventListener('change', async () => {
    panel.hidden = !toggle.checked;
    compareBaseline = toggle.checked ? await computeCompareBaseline() : null;
    renderCompareAvgValues();
    await loadHorses();
  });
  ['#cmp-breed', '#cmp-zzl', '#cmp-owner', '#cmp-gender'].forEach((sel) => {
    document.querySelector(sel).addEventListener('change', recompute);
  });
  toleranceToggle.addEventListener('change', async () => {
    compareToleranceEnabled = toleranceToggle.checked;
    renderCompareAvgValues();
    await loadHorses();
  });
}

// Wie weit ein Wert schlechter als der Durchschnitt sein darf und trotzdem
// nicht als "richtig schlecht" (cmp-bad), sondern nur als "durch Toleranz
// akzeptabel" (cmp-tolerance) gilt - 0, wenn das Toleranz-Häkchen aus ist
// oder für den jeweiligen Wert keine Toleranz hinterlegt ist.
function effectiveTolerance(key) {
  return compareToleranceEnabled ? (compareTolerances[key] || 0) : 0;
}

// Zeigt die aus der aktuellen Vergleichsbasis berechneten Ø-Werte neben den
// Basis-Dropdowns an, inkl. der jeweils wirksamen Toleranz in Klammern
// (siehe effectiveTolerance) - nur informativ, ohne Einfluss auf die
// Berechnung selbst (die passiert weiterhin in cmpClass/overallCmpClass).
function renderCompareAvgValues() {
  const el = document.querySelector('#compare-avg-values');
  if (!compareBaseline) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  const part = (label, value, decimals, suffix, tolerance) => {
    if (value == null) return `${label}: –`;
    const val = value.toFixed(decimals) + (suffix || '');
    const tolText = tolerance ? ` (±${tolerance.toFixed ? tolerance.toFixed(decimals) : tolerance}${suffix || ''})` : '';
    return `${label}: ${val}${tolText}`;
  };
  el.textContent = [
    part('Ø GP', compareBaseline.gp, 0, '', effectiveTolerance('gp')),
    part('Ø Ext', compareBaseline.ext, 2, '', effectiveTolerance('ext')),
    part('Ø Ext%', compareBaseline.extPercent, 0, '%', effectiveTolerance('extPercent')),
    part('Ø Int', compareBaseline.int, 2, '', effectiveTolerance('int')),
  ].join(' · ');
  el.hidden = false;
}

// "Nach oben"-Pfeil (siehe .scroll-top-btn in style.css) - je nach
// Bildschirmbreite scrollt entweder nur die Tabelle selbst (Desktop, "nur
// die Tabelle scrollt"-Layout weiter unten) oder die ganze Seite
// (Tablet/Handy) - deshalb auf beide möglichen Scroll-Quellen hören und
// bei Klick beide zurücksetzen (das jeweils nicht betroffene scrollTo ist
// dann einfach wirkungslos).
function wireScrollTop() {
  const btn = document.querySelector('#scroll-top-btn');
  const tableWrap = document.querySelector('.table-wrap');
  const threshold = 400;
  const updateVisibility = () => {
    const scrolled = window.scrollY > threshold || tableWrap.scrollTop > threshold;
    btn.hidden = !scrolled;
  };
  window.addEventListener('scroll', updateVisibility);
  tableWrap.addEventListener('scroll', updateVisibility);
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    tableWrap.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// Durchschnitt von GP/Ext/Ext%/Int über die per Rasse/ZZL/Besitzer/
// Geschlecht eingeschränkte Vergleichsbasis (eigene Auswahl, unabhängig
// von den Übersichts-Filtern) - wie durchschnitt.js, aber nur die vier
// hier gebrauchten Werte statt der vollen Ergebnis-Tabelle.
async function computeCompareBaseline() {
  let data = await localGetAll(LOCAL_STORES.horses);
  const breed = document.querySelector('#cmp-breed').value;
  const zzl = document.querySelector('#cmp-zzl').value;
  const owner = document.querySelector('#cmp-owner').value;
  const gender = document.querySelector('#cmp-gender').value;

  data = data.filter((h) => {
    const normalized = normalizeBreed(h.breed) || 'Rasselos';
    if (breed === 'Rasselos' && normalized !== 'Rasselos') return false;
    if (breed && breed !== 'Rasselos' && normalized !== breed) return false;
    if (zzl === 'true' && h.breeding_allowed !== true) return false;
    if (zzl === 'false' && h.breeding_allowed === true) return false;
    if (owner && h.owner !== owner) return false;
    if (gender && h.gender !== gender) return false;
    return true;
  });

  if (!data.length) return null;

  const avg = (values) => {
    const nums = values.filter((v) => v != null && !Number.isNaN(v));
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  };
  const derived=data.map(computeDerived);
  return {
    gp: avg(derived.map((d) => d.gp)),
    ext: avg(derived.map((d) => d.extAvg)),
    extPercent: avg(derived.map((d) => d.extPercent)),
    int: avg(derived.map((d) => d.intAvg)),
  };
}

// Klasse für eine einzelne Werte-Zelle (GP/Ext/Ext%/Int) - grün, wenn der
// Wert im Vergleich zur Basis "besser" ist, rot wenn "schlechter". Bei GP
// und Ext% ist ein höherer Wert besser; bei Ext und Int ist es dagegen ein
// NIEDRIGERER Wert (Skala 1=exzellent...4/5=schlecht, siehe
// scoreExteriorTerm/scoreTemperamentTerm) - daher "lowerIsBetter" je
// Aufruf mitgeben. Nichts bei fehlendem Wert auf einer der beiden Seiten.
// "tolerance" (siehe compareTolerances/Einstellungen, effectiveTolerance)
// verschiebt nur die "schlechter"-Schwelle, nicht die "besser"-Schwelle:
// ein Wert, der bis zu "tolerance" schlechter als der Durchschnitt ist,
// gilt dann als "durch Toleranz akzeptabel" (eigener Grünton, cmp-tolerance)
// statt rot - für eine großzügigere Auswahl in der Übersicht, ohne die
// Definition von "besser" (cmp-good) zu verwässern. Ist der Wert weiter als
// "tolerance" schlechter, bleibt es bei rot (cmp-bad).
function cmpClass(value, baseline, lowerIsBetter, tolerance = 0) {
  if (!compareBaseline || value == null || baseline == null) return '';
  const better = lowerIsBetter ? value < baseline : value > baseline;
  if (better) return 'cmp-good';
  const worse = lowerIsBetter ? value > baseline : value < baseline;
  if (!worse) return '';
  const beyondTolerance = lowerIsBetter ? value > baseline + tolerance : value < baseline - tolerance;
  return beyondTolerance ? 'cmp-bad' : 'cmp-tolerance';
}

// Klasse für die Name-Zelle - Mehrheitsentscheid über die vier Werte
// (mehr "besser" als "schlechter/toleriert" -> grün, umgekehrt bei
// überwiegend "schlechter" rot bzw. bei überwiegend "toleriert" der
// Toleranz-Grünton, sonst nichts).
function overallCmpClass(d) {
  if (!compareBaseline) return '';
  const pairs = [
    [d.gp, compareBaseline.gp, false, effectiveTolerance('gp')],
    [d.extAvg, compareBaseline.ext, true, effectiveTolerance('ext')],
    [d.extPercent, compareBaseline.extPercent, false, effectiveTolerance('extPercent')],
    [d.intAvg, compareBaseline.int, true, effectiveTolerance('int')],
  ].filter(([v, b]) => v != null && b != null);
  if (!pairs.length) return '';
  const classes = pairs.map(([v, b, lowerIsBetter, tolerance]) => cmpClass(v, b, lowerIsBetter, tolerance));
  const good = classes.filter((c) => c === 'cmp-good').length;
  const bad = classes.filter((c) => c === 'cmp-bad').length;
  const tolerated = classes.filter((c) => c === 'cmp-tolerance').length;
  const notGood = bad + tolerated;
  if (good > notGood) return 'cmp-good';
  if (notGood > good) return bad >= tolerated ? 'cmp-bad' : 'cmp-tolerance';
  return '';
}

// Ob ein Locus sein dominantes/sichtbares Allel trägt, nach der vom Nutzer
// bereitgestellten MDR-Farbvererbungs-Dokumentation. KIT gilt als "trägt
// das Merkmal", wenn der Wert nicht ausschließlich aus "0" besteht (laut
// Spiel: getestet, aber kein Tobiano/Sabino/Dominant White/Roan).
const LOCUS_DOMINANT_CHECK = {
  Extension: (v) => v.includes('E'),
  Dun: (v) => v.includes('D'),
  Champagne: (v) => v.includes('Ch'),
  Grey: (v) => v.includes('G'),
  Silver: (v) => v.includes('Z'),
  Overo: (v) => v.includes('O'),
  Splashed: (v) => v.includes('SPL'),
  Appaloosa: (v) => v.includes('Lp'),
  PATN1: (v) => v.includes('P1'),
  Agouti: (v) => /Ap|A1|At/.test(v),
  Cream: (v) => /Cr|pl/.test(v),
  KIT: (v) => !!v && !/^0+$/.test(v),
};

// Pearl liegt auf demselben Locus wie Cream (siehe parser.js) - ein
// getesteter Rohwert wie "Crpl" (Cream+Pearl-Trägerin) oder "plpl"
// (reinerbig Pearl) soll hier also schon bei einem bloßen "pl"-Vorkommen
// zählen, unabhängig von Groß-/Kleinschreibung und auch mischerbig -
// anders als LOCUS_DOMINANT_CHECK.Cream, das nur die sichtbare Ausprägung
// prüft. Ist Cream nicht getestet, zählt zusätzlich eine aus Fellfarbe/
// Notiz/Name abgeleitete Pearl-Vermutung (presentGenesSummary).
function hasPearlGene(row) {
  const entry = (row.colors || []).find((c) => c.label === 'Cream');
  if (entry && !isUntestedLocusValue(entry.value) && /pl/i.test(entry.value)) return true;
  const genes = presentGenesSummary(row.colors, row.coat_color, row.notes, row.name, null, row.color_gene_overrides);
  return genes.some((g) => g.locus === 'Cream' && /pl/i.test(g.alleles));
}

// Wie hasPearlGene, aber nur reinerbig ("plpl") statt schon bei einer
// einzelnen Kopie - für die separate "plpl"-Filteroption.
function hasPearlGeneDoubled(row) {
  const entry = (row.colors || []).find((c) => c.label === 'Cream');
  if (entry && !isUntestedLocusValue(entry.value) && /^plpl$/i.test(entry.value)) return true;
  const genes = presentGenesSummary(row.colors, row.coat_color, row.notes, row.name, null, row.color_gene_overrides);
  return genes.some((g) => g.locus === 'Cream' && /^plpl$/i.test(g.alleles));
}

// Flaxen wird vom Spiel nicht als eigener Locus getestet (siehe
// parser.js) - daher ausschließlich aus Fellfarbe/Notiz/Name ableitbar,
// sowohl als Träger (fl) als auch reinerbig (flfl).
function hasFlaxenGene(row) {
  const genes = presentGenesSummary(row.colors, row.coat_color, row.notes, row.name, null, row.color_gene_overrides);
  return genes.some((g) => g.locus === 'Flaxen');
}

// Wie hasFlaxenGene, aber nur reinerbig ("flfl") - für die separate
// "flfl"-Filteroption.
function hasFlaxenGeneDoubled(row) {
  const genes = presentGenesSummary(row.colors, row.coat_color, row.notes, row.name, null, row.color_gene_overrides);
  return genes.some((g) => g.locus === 'Flaxen' && /^flfl$/i.test(g.alleles));
}

// KIT ist ein Sammel-Locus für mehrere unabhängige Merkmale (Tobiano/
// Sabino/Roan/Dominant White), die im Rohwert als aneinandergereihte
// Zwei-Buchstaben-Kürzel stehen (z.B. "RnTO" = Roan + Tobiano). Für die
// Filterung wird daher gezielt nach dem jeweiligen Kürzel gesucht statt
// nur (wie LOCUS_DOMINANT_CHECK.KIT) pauschal "irgendetwas vorhanden".
function hasKitTrait(row, code) {
  const entry = (row.colors || []).find((c) => c.label === 'KIT');
  if (!entry || isUntestedLocusValue(entry.value)) return false;
  return new RegExp(code, 'i').test(entry.value);
}

function matchesGenetikLocus(row, locusName) {
  if (locusName === '__pearl__') return hasPearlGene(row);
  if (locusName === '__pearl_doubled__') return hasPearlGeneDoubled(row);
  if (locusName === '__flaxen__') return hasFlaxenGene(row);
  if (locusName === '__flaxen_doubled__') return hasFlaxenGeneDoubled(row);
  if (locusName === '__kit_sb__') return hasKitTrait(row, 'sb');
  if (locusName === '__kit_rn__') return hasKitTrait(row, 'rn');
  if (locusName === '__kit_to__') return hasKitTrait(row, 'to');
  const entry = (row.colors || []).find((c) => c.label === locusName);
  if (!entry || isUntestedLocusValue(entry.value)) return false;
  const check = LOCUS_DOMINANT_CHECK[locusName];
  return check ? check(entry.value) : false;
}

// Ein Erbkrankheiten-Locuswert gilt als unauffällig, wenn er (ohne die
// "/"-Trenner) ausschließlich aus großem "N" (normal) besteht - jede
// Abweichung bedeutet Träger/betroffen. Wichtig: das Risikoallel-Kürzel
// ist nicht immer klein geschrieben (z.B. "LF/NN" bei LFS, komplett groß)
// - ein reiner Kleinbuchstaben-Check (wie zuvor) übersieht solche Fälle.
function isDiseaseClear(value) {
  const cleaned = (value || '').replace(/\//g, '');
  return cleaned === '' || /^N+$/.test(cleaned);
}

// Zusätzlich zu tatsächlich getesteten (und auffälligen) Erbkrankheiten
// auch manuell als Träger/betroffen bestätigte, noch nicht getestete
// Krankheiten mit einbeziehen (siehe diseaseOverrideBadge in
// horseForm.js) - "frei"/unbekannt zählt dagegen nicht als betroffen.
function affectedDiseaseLabels(row) {
  // Manche Datensätze enthalten pro Krankheit auch dann eine Zeile, wenn
  // sie gar nicht getestet wurde (Rohwert wörtlich "Nicht getestet" statt
  // fehlender Zeile, siehe diseaseTableHtml in horseForm.js) - die zählen
  // hier weder als getestet noch als betroffen.
  const diseases = (row.genetic_diseases || []).filter((d) => !isUntestedLocusValue(d.value));
  const tested = diseases.filter((d) => !isDiseaseClear(d.value)).map((d) => d.label);
  const testedCodes = new Set(diseases.map((d) => d.label));
  const ov = row.disease_gene_overrides || {};
  const manual = Object.keys(ov).filter((code) => (ov[code] === 'het' || ov[code] === 'hom') && !testedCodes.has(code));
  return [...tested, ...manual];
}

function matchesEkh(row, selectedCodes) {
  return selectedCodes.some((code) => {
    if (code === '__none__') return row.disease_free === true;
    return affectedDiseaseLabels(row).includes(code);
  });
}

function compareValue(value, op, targetStr) {
  if (targetStr === '') return true;
  if (value === null || value === undefined || Number.isNaN(value)) return false;
  const target = Number(targetStr);
  return op === 'lt' ? value < target : value > target;
}

function applyClientFilters(rows) {
  const breed = document.querySelector('#f-breed').value;
  const genetikState = getTriStateDropdownState('f-genetik-drop');
  const ekhState = getTriStateDropdownState('f-ekh-drop');
  const tagState = getTriStateDropdownState('f-tag-drop');

  const gpOp = document.querySelector('#f-gp-op').value;
  const gpVal = document.querySelector('#f-gp-val').value;
  const extOp = document.querySelector('#f-ext-op').value;
  const extVal = document.querySelector('#f-ext-val').value;
  const extpctOp = document.querySelector('#f-extpct-op').value;
  const extpctVal = document.querySelector('#f-extpct-val').value;
  const intOp = document.querySelector('#f-int-op').value;
  const intVal = document.querySelector('#f-int-val').value;
  const bestFoalMode = bestFoalOverviewEnabled ? (document.querySelector('#f-best-foal-toggle')?.dataset.state || 'off') : 'off';

  return rows.filter((row) => {
    const d = computeDerived(row);

    // Drei-Zustandsfilter: Genetik-Einschlüsse bleiben UND-verknüpft,
    // EKH/Schlagwörter wie bisher ODER-verknüpft. Ausschlüsse entfernen
    // jedes Pferd, das mindestens einen ausgeschlossenen Wert erfüllt.
    if (genetikState.include.length && !genetikState.include.every((locus) => matchesGenetikLocus(row, locus))) return false;
    if (genetikState.exclude.some((locus) => matchesGenetikLocus(row, locus))) return false;
    if (ekhState.include.length && !matchesEkh(row, ekhState.include)) return false;
    if (ekhState.exclude.length && matchesEkh(row, ekhState.exclude)) return false;
    if (tagState.include.length && !matchesTags(row, tagState.include)) return false;
    if (tagState.exclude.length && matchesTags(row, tagState.exclude)) return false;
    if (!compareValue(d.gp, gpOp, gpVal)) return false;
    if (!compareValue(d.extAvg, extOp, extVal)) return false;
    if (!compareValue(d.extPercent, extpctOp, extpctVal)) return false;
    if (!compareValue(d.intAvg, intOp, intVal)) return false;

    if (bestFoalMode !== 'off' && typeof bpBestFoalInfo === 'function' && breedingOverviewContext) {
      const info = bpBestFoalInfo(row, breedingOverviewContext);
      if (bestFoalMode === 'only' && !info.anyBest) return false;
      if (bestFoalMode === 'exclude' && info.anyBest) return false;
    }

    return true;
  });
}

function sortValue(row, field) {
  switch (field) {
    case 'name': return (row.name || '').toLowerCase();
    case 'gender': return (row.gender || '').toLowerCase();
    case 'breed': return (row.breed || '').toLowerCase();
    case 'coat_color': return (row.coat_color || '').toLowerCase();
    case 'owner': return (row.owner || '').toLowerCase();
    case 'gp': return computeDerived(row).gp;
    case 'ext': return computeDerived(row).extAvg;
    case 'extpct': return computeDerived(row).extPercent;
    case 'int': return computeDerived(row).intAvg;
    case 'hlpslp': {
      const n = Number(hlpSlpDisplay(row.hlp_slp));
      return Number.isNaN(n) ? null : n;
    }
    case 'zzl': return row.breeding_allowed == null ? null : (row.breeding_allowed ? 1 : 0);
    case 'birthdate': {
      if (!row.birthdate) return null;
      const t = new Date(row.birthdate).getTime();
      return Number.isFinite(t) ? Date.now() - t : null;
    }
    case 'updated_at': return row.updated_at || null;
    default: return null;
  }
}

// Fehlende Werte (null) landen unabhängig von der Richtung immer am Ende,
// damit A-Z/Z-A bzw. 1-x/x-1 nicht durch Lücken durcheinandergeraten.
function applySort(rows) {
  const { field, dir } = currentSort;
  const mult = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, field);
    const vb = sortValue(b, field);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'string') return va.localeCompare(vb, 'de') * mult;
    return (va - vb) * mult;
  });
}

function databaseFilterActiveCount() {
  const state = collectFilterState();
  let count = 0;
  const filled = [state.name,state.owner,state.gender,state.breed,state.gameVersion,state.zzl,state.breedingStation,state.dataQuality,state.gpVal,state.extVal,state.extpctVal,state.intVal];
  count += filled.filter(v => String(v ?? '').trim() !== '').length;
  count += [state.tags,state.genetik,state.ekh].filter(v => { const t = normalizeTriStateSavedState(v); return t.include.length || t.exclude.length; }).length;
  // 'Alle' bedeutet keine Lerndatei-Einschränkung; sowohl Ausblenden als auch
  // Nur Lerndatei sind echte Filter und werden deshalb im geschlossenen Kopf gezählt.
  if (state.learningFile && state.learningFile !== 'all') count++;
  if (state.cupStarOnly) count++;
  if (state.bestFoalMode && state.bestFoalMode !== 'off') count++;
  if (state.compareAvgEnabled) count++;
  return count;
}

function updateDatabaseFilterSummary(resultCount = null) {
  const el = document.getElementById('database-filter-summary');
  if (!el) return;
  const active = databaseFilterActiveCount();
  const countText = resultCount == null ? '– Pferde' : `${resultCount} Pferd${resultCount===1?'':'e'}`;
  el.textContent = `${active} aktiv · ${countText}`;
}

async function loadHorses() {
  const tbody = document.querySelector('#horse-table tbody');
  const countEl = document.querySelector('#result-count');
  tbody.innerHTML = '<tr><td colspan="21">Lade…</td></tr>';
  selectedIds = new Set();
  updateBulkBar();

  const { data, error } = await buildQuery();

  if (typeof bpBuildContext === 'function') {
    const cacheVersion=typeof mdrStoreCacheVersion === 'function' ? mdrStoreCacheVersion(LOCAL_STORES.horses) : 0;
    if (!breedingOverviewContext || breedingOverviewContextVersion !== cacheVersion) {
      const allHorsesForBreeding = await localGetAll(LOCAL_STORES.horses);
      breedingOverviewContext = bpBuildContext(allHorsesForBreeding);
      breedingOverviewContextVersion = typeof mdrStoreCacheVersion === 'function' ? mdrStoreCacheVersion(LOCAL_STORES.horses) : cacheVersion;
    }
  }

  if (error) {
    tbody.innerHTML = `<tr><td colspan="21" class="error">Fehler beim Laden: ${escapeHtml(error.message)}</td></tr>`;
    countEl.textContent = '';
    updateDatabaseFilterSummary(null);
    return;
  }

  const filtered = applySort(applyClientFilters(data));

  // Sortierung wird für das Blättern auf der Pferdeseite mitgegeben.
  try { localStorage.setItem('mdr-horse-view-sort-v5367', JSON.stringify(currentSort)); } catch {}

  // V47: letzten verwendeten Datenbankfilter lokal merken, damit er auf
  // der zentralen Einstellungsseite direkt als Vorlage gespeichert werden kann.
  try {
    localStorage.setItem('mdr-last-filter-state-v47', JSON.stringify(collectFilterState()));
  } catch {}

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="21">Keine Pferde gefunden.</td></tr>';
    countEl.textContent = '0 Pferde';
    lastRenderedRows = [];
    updateDatabaseFilterSummary(0);
    return;
  }

  countEl.textContent = `${filtered.length} Pferd${filtered.length === 1 ? '' : 'e'}`;
  updateDatabaseFilterSummary(filtered.length);
  lastRenderedRows = filtered;
  tbody.innerHTML = filtered.map(rowHtml).join('');
  tbody.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => onDelete(btn.dataset.delete));
  });
  tbody.querySelectorAll('[data-select]').forEach((cb) => {
    cb.addEventListener('change', () => onRowSelect(cb.dataset.select, cb.checked));
  });
  document.querySelectorAll('#select-all, #select-all-mobile').forEach((box) => { box.checked = false; });
}

// "data-label" wird nur für die mobile Kartenansicht gebraucht (siehe
// style.css) - dort ersetzt CSS-generierter Inhalt (attr(data-label)) die
// sonst fehlenden Spaltenüberschriften, da <thead> dort ausgeblendet ist.
function rowHtml(h) {
  const d = computeDerived(h);
  const affected = affectedDiseaseLabels(h);
  const ekhText = affected.length ? affected.join(', ') : '-';

  // Name öffnet die reine Ansichtsseite (view.html) - Bearbeiten passiert
  // über den eigenen Stift-Button in der Aktionen-Spalte, der externe
  // Spiel-Link über den eigenen 🔗-Button (nur falls external_id gesetzt).
  // Schlagwort-Badges (siehe HORSE_TAG_OPTIONS in parser.js) direkt daneben,
  // statt einer eigenen Spalte - die Tabelle ist ohnehin schon sehr breit.
  // .name-cell selbst bleibt ein normales table-cell-Element (display:flex
  // DIREKT auf einem <td> nimmt es aus dem Tabellen-Zeilenlayout heraus -
  // es wuerde dann nicht mehr automatisch auf die Zeilenhoehe der
  // Geschwister-Zellen gestreckt, wodurch seine eigene Trennlinie
  // "hoeher" als der Rest der Zeile sass, siehe Nutzer-Feedback). Die
  // Flex-Anordnung fuer Name+Badges sitzt deshalb auf einem inneren Span
  // statt auf dem <td> selbst.
  const gameVersion = h.game_version || 'DE';
  const versionBadge = `<span class="game-version-badge game-version-${gameVersion.toLowerCase()}">${escapeHtml(gameVersion)}</span>`;
  const learningBadge = (typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(h))
    ? '<span class="learning-file-badge" title="Dieses Pferd bleibt als Lerndatei erhalten, wird aber aus operativen Planerlisten ausgeblendet.">🧠 Lerndatei</span>'
    : '';
  const nameCell = `<span class="name-cell-inner"><a href="view.html?id=${h.id}">${escapeHtml(h.name || '(ohne Name)')}</a>${versionBadge}${learningBadge}${dataQualityBadgeHtml(h)}</span>`;
  const tagsCell = tagsBadgesHtml(h.tags, h.birthdate);
  const nameTitle = [h.name || '(ohne Name)', ...(h.tags || []).map((t) => t.note ? `${t.label}: ${t.note}` : t.label)].join(' – ');
  const gameHost = gameVersion === 'EN' ? 'www.morning-dust-ranch.com' : 'www.morning-dust-ranch.de';
  const linkCell = h.external_id
    ? `<a class="btn secondary icon-btn" href="https://${gameHost}/index2.php?site=pferd&id=${encodeURIComponent(h.external_id)}" target="_blank" rel="noopener" title="Zum Pferd im Spiel">🔗</a>`
    : '';
  const imageCell = h.image_url
    ? `<a href="view.html?id=${h.id}"><img class="table-thumb" src="${escapeHtml(h.image_url)}" alt="" loading="lazy" /></a>`
    : '';
  const nameCls = ['name-cell', overallCmpClass(d)].filter(Boolean).join(' ');
  const breedingInfo = bestFoalOverviewEnabled && breedingOverviewContext && typeof bpBestFoalInfo === 'function'
    ? bpBestFoalInfo(h, breedingOverviewContext)
    : null;
  const aggregateBest = breedingInfo?.anyBest
    ? '<span class="bp-best-star bp-best-star-aggregate" title="Bestes Fohlen in mindestens einem Vergleichswert">★</span>'
    : '';

  return `<tr>
    <td data-label="Auswählen"><input type="checkbox" class="horse-select-checkbox" data-select="${h.id}" aria-label="${escapeHtml(`Pferd ${h.name || h.id} auswählen`)}" /></td>
    <td data-label="Bestes Fohlen" class="bp-best-aggregate-cell">${aggregateBest}</td>
    <td data-label="Bild">${imageCell}</td>
    <td data-label="Link">${linkCell}</td>
    <td data-label="Name" class="${nameCls}" title="${escapeHtml(nameTitle)}">${nameCell}</td>
    <td data-label="Schlagwörter" class="horse-tags-cell">${tagsCell}</td>
    <td data-label="Geschlecht">${escapeHtml(h.gender || '')}</td>
    <td data-label="Rasse" title="${escapeHtml(normalizeBreed(h.breed) || 'Rasselos')}">${escapeHtml(normalizeBreed(h.breed) || 'Rasselos')}</td>
    <td data-label="Farbe" title="${escapeHtml(h.coat_color || '')}">${escapeHtml(h.coat_color || '')}</td>
    <td data-label="Genetik" class="small genetik-cell" style="font-family: ui-monospace, monospace;" title="${escapeHtml(d.presentGenes)}">${escapeHtml(d.presentGenes)}</td>
    <td data-label="GP" class="${cmpClass(d.gp, compareBaseline?.gp, false, effectiveTolerance('gp'))}">${d.gp != null ? escapeHtml(String(d.gp)) : ''}${breedingInfo && typeof bpOverviewMetricMarker === 'function' ? bpOverviewMetricMarker(breedingInfo,'gp') : ''}</td>
    <td data-label="Ext" class="${cmpClass(d.extAvg, compareBaseline?.ext, true, effectiveTolerance('ext'))}">${d.extAvg != null ? d.extAvg.toFixed(2) : ''}${breedingInfo && typeof bpOverviewMetricMarker === 'function' ? bpOverviewMetricMarker(breedingInfo,'ext') : ''}</td>
    <td data-label="Ext%" class="${cmpClass(d.extPercent, compareBaseline?.extPercent, false, effectiveTolerance('extPercent'))}">${d.extPercent != null ? d.extPercent + '%' : ''}${breedingInfo && typeof bpOverviewMetricMarker === 'function' ? bpOverviewMetricMarker(breedingInfo,'extPct') : ''}</td>
    <td data-label="Int" class="${cmpClass(d.intAvg, compareBaseline?.int, true, effectiveTolerance('int'))}">${d.intAvg != null ? d.intAvg.toFixed(2) : ''}${breedingInfo && typeof bpOverviewMetricMarker === 'function' ? bpOverviewMetricMarker(breedingInfo,'int') : ''}</td>
    <td data-label="HLP/SLP">${escapeHtml(hlpSlpDisplay(h.hlp_slp))}</td>
    <td data-label="ZZL">${zzlDisplay(h.breeding_allowed)}</td>
    <td data-label="EKH">${escapeHtml(ekhText)}</td>
    <td data-label="Besitzer" title="${escapeHtml(h.owner || '')}">${escapeHtml(h.owner || '')}</td>
    <td data-label="Alter">${h.birthdate ? escapeHtml(formatAge(h.birthdate)) : ''}</td>
    <td data-label="Zuletzt bearbeitet">${h.updated_at ? escapeHtml(formatTimestamp(h.updated_at)) : ''}</td>
    <td data-label="Aktionen" class="actions-cell">
      <a class="btn secondary icon-btn" href="horse.html?id=${h.id}" title="Bearbeiten">✏️</a>
      <button class="danger icon-btn" data-delete="${h.id}" title="Löschen">✗</button>
    </td>
  </tr>`;
}

// Zeigt die HLP/SLP-Punktzahl, falls im Text eine Zahl steht (bestandene
// Prüfung), sonst "-" (z.B. bei "nicht bestanden"/"nicht absolviert").
function hlpSlpDisplay(text) {
  if (!text) return '-';
  const m = text.match(/\d+([.,]\d+)?/);
  return m ? m[0] : '-';
}

function zzlDisplay(breedingAllowed) {
  if (breedingAllowed === true) return 'Ja';
  if (breedingAllowed === false) return 'Nein';
  return '-';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function onDelete(id) {
  const row = lastRenderedRows.find((r) => String(r.id) === String(id));
  openDeleteModal(row ? [row] : [{ id, name: '(unbekannt)', owner: '' }]);
}

// --- Lösch-Bestätigung (Popup statt native confirm()) ---

function wireDeleteModal() {
  document.querySelector('#delete-modal-cancel').addEventListener('click', closeDeleteModal);
  document.querySelector('#delete-modal-confirm').addEventListener('click', confirmDelete);
  document.querySelector('#delete-modal').addEventListener('click', (e) => {
    if (e.target.id === 'delete-modal') closeDeleteModal();
  });
}

function openDeleteModal(rows) {
  pendingDeleteIds = rows.map((r) => r.id);
  const list = document.querySelector('#delete-modal-list');
  list.innerHTML = rows.map((r) => {
    const owner = r.owner ? ` — Besitzer: ${escapeHtml(r.owner)}` : '';
    return `<li>${escapeHtml(r.name || '(ohne Name)')}${owner}</li>`;
  }).join('');

  const multi = rows.length > 1;
  document.querySelector('#delete-modal-title').textContent =
    multi ? 'Ausgewählte Pferde löschen?' : 'Pferd löschen?';
  document.querySelector('#delete-modal-count').textContent =
    multi
      ? `Bist du sicher? ${rows.length} ausgewählte Pferde werden unwiderruflich aus der Datenbank gelöscht.`
      : 'Bist du sicher? Dieses Pferd wird unwiderruflich aus der Datenbank gelöscht.';
  document.querySelector('#delete-modal-confirm').textContent =
    multi ? `Ja, ${rows.length} Pferde löschen` : 'Ja, Pferd löschen';
  document.querySelector('#delete-modal').hidden = false;
}

function closeDeleteModal() {
  document.querySelector('#delete-modal').hidden = true;
  pendingDeleteIds = [];
}

async function confirmDelete() {
  const ids = pendingDeleteIds;
  closeDeleteModal();
  if (!ids.length) return;

  // Bei Mehrfachlöschung wird – sofern der freigegebene Backup-Ordner
  // erreichbar ist – unmittelbar vorher noch einmal der vollständige
  // aktuelle Stand gesichert. Die Löschung selbst hängt aber nicht von
  // der Ordnerberechtigung ab.
  if (ids.length > 1 && typeof writeExternalBackupNow === 'function') {
    await writeExternalBackupNow('vor Mehrfachlöschung');
  }

  try {
    for (const id of ids) {
      await deleteLocalRecordById(LOCAL_STORES.horses, id);
    }
  } catch (error) {
    alert('Löschen fehlgeschlagen: ' + error.message);
    return;
  }
  await loadHorses();
}

function wireFilterForm() {
  const form = document.querySelector('#filter-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    loadHorses();
  });

  // Filter reagieren nun auch direkt. Das behebt sowohl Form-Restore-
  // Effekte des Browsers als auch den Eindruck, einzelne Selects würden
  // nichts tun. Texte/Zahlen werden kurz entprellt, Selects sofort.
  let filterTimer = null;
  form.addEventListener('change', (e) => {
    if (!e.target.matches('input,select,.checkdrop-tristate-item')) return;
    clearTimeout(filterTimer);
    loadHorses();
  });
  form.addEventListener('input', (e) => {
    if (!e.target.matches('input[type="text"],input[type="number"]')) return;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(loadHorses, 180);
  });

  document.querySelector('#reset-filters').addEventListener('click', () => {
    document.querySelector('#filter-form').reset();
    resetTriStateDropdown('f-ekh-drop');
    resetTriStateDropdown('f-genetik-drop');
    resetTriStateDropdown('f-tag-drop');
    if (document.querySelector('#f-learning-file')) document.querySelector('#f-learning-file').value = 'exclude';
    if (document.querySelector('#f-best-foal-toggle')) {
      document.querySelector('#f-best-foal-toggle').dataset.state = 'off';
      syncBestFoalToggleLabel();
    }
    loadHorses();
  });
  document.querySelector('#f-data-quality').addEventListener('change', loadHorses);
}

function bestFoalModeLabel(state) {
  if (state === 'only') return '★ Bestes Fohlen: Nur anzeigen';
  if (state === 'exclude') return '★ Bestes Fohlen: Ausschließen';
  return '★ Bestes Fohlen: Aus';
}

function syncBestFoalToggleLabel() {
  const btn = document.getElementById('f-best-foal-toggle');
  if (!btn) return;
  btn.textContent = bestFoalModeLabel(btn.dataset.state || 'off');
  btn.classList.toggle('active', (btn.dataset.state || 'off') !== 'off');
}

function syncBestFoalFeatureVisibility() {
  const field = document.getElementById('best-foal-filter-field');
  const btn = document.getElementById('f-best-foal-toggle');
  if (field) field.hidden = !bestFoalOverviewEnabled;
  document.body.classList.toggle('hide-best-foal-overview', !bestFoalOverviewEnabled);
  if (!bestFoalOverviewEnabled && btn) btn.dataset.state = 'off';
  syncBestFoalToggleLabel();
}

function wireBestFoalFilter() {
  const btn = document.getElementById('f-best-foal-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const state = btn.dataset.state || 'off';
    btn.dataset.state = state === 'off' ? 'only' : state === 'only' ? 'exclude' : 'off';
    syncBestFoalToggleLabel();
    loadHorses();
  });
  syncBestFoalToggleLabel();
}

function wireSortableHeaders() {
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (currentSort.field === field) {
        currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort = { field, dir: 'asc' };
      }
      syncMobileSortControls();
      loadHorses();
    });
  });

  // Mobile Alternative zum Klick auf die (dort ausgeblendete)
  // Tabellenkopfzeile - siehe .mobile-sort in style.css.
  const fieldSel = document.querySelector('#f-sort-field');
  const dirSel = document.querySelector('#f-sort-dir');
  [fieldSel, dirSel].forEach((sel) => {
    sel.addEventListener('change', () => {
      currentSort = { field: fieldSel.value, dir: dirSel.value };
      loadHorses();
    });
  });
  syncMobileSortControls();
}

function syncMobileSortControls() {
  const fieldSel = document.querySelector('#f-sort-field');
  const dirSel = document.querySelector('#f-sort-dir');
  fieldSel.value = currentSort.field;
  dirSel.value = currentSort.dir;
}

// --- Filter-Vorlagen (gespeicherte Filter-/Sucheinstellungen je Konto,
// siehe migration_022_filter_presets.sql) ---

// Liest den kompletten Zustand aller Filter-/Suchfelder aus (nicht die
// Ø-Vergleich-Vergleichsbasis - eigenes, unabhängiges Feature).
function collectFilterState() {
  return {
    name: document.querySelector('#f-name').value,
    owner: document.querySelector('#f-owner').value,
    gender: document.querySelector('#f-gender').value,
    breed: document.querySelector('#f-breed').value,
    gameVersion: document.querySelector('#f-game-version').value,
    zzl: document.querySelector('#f-zzl').value,
    breedingStation: document.querySelector('#f-breeding-station')?.value || '',
    dataQuality: document.querySelector('#f-data-quality').value,
    learningFile: document.querySelector('#f-learning-file')?.value || 'exclude',
    cupStarOnly: Boolean(document.querySelector('#f-cupstar')?.checked),
    bestFoalMode: document.querySelector('#f-best-foal-toggle')?.dataset.state || 'off',
    tags: getTriStateDropdownState('f-tag-drop'),
    genetik: getTriStateDropdownState('f-genetik-drop'),
    ekh: getTriStateDropdownState('f-ekh-drop'),
    gpOp: document.querySelector('#f-gp-op').value,
    gpVal: document.querySelector('#f-gp-val').value,
    extOp: document.querySelector('#f-ext-op').value,
    extVal: document.querySelector('#f-ext-val').value,
    extpctOp: document.querySelector('#f-extpct-op').value,
    extpctVal: document.querySelector('#f-extpct-val').value,
    intOp: document.querySelector('#f-int-op').value,
    intVal: document.querySelector('#f-int-val').value,
    sortField: currentSort.field,
    sortDir: currentSort.dir,
    compareAvgEnabled: document.querySelector('#compare-avg-toggle').checked,
    cmpBreed: document.querySelector('#cmp-breed').value,
    cmpZzl: document.querySelector('#cmp-zzl').value,
    cmpOwner: document.querySelector('#cmp-owner').value,
    cmpGender: document.querySelector('#cmp-gender').value,
  };
}

// Setzt alle Filter-/Suchfelder auf einen gespeicherten Zustand und
// wendet ihn direkt an. Werte, die in den Auswahllisten (Besitzer/Rasse/
// Geschlecht) inzwischen nicht mehr vorkommen (z.B. Pferd umbenannt/
// gelöscht), bleiben dabei einfach unwirksam - kein Fehler.
async function applyFilterState(state) {
  document.querySelector('#f-name').value = state.name || '';
  document.querySelector('#f-owner').value = state.owner || '';
  document.querySelector('#f-gender').value = state.gender || '';
  document.querySelector('#f-breed').value = state.breed || '';
  document.querySelector('#f-game-version').value = state.gameVersion || '';
  document.querySelector('#f-zzl').value = state.zzl || '';
  if (document.querySelector('#f-breeding-station')) document.querySelector('#f-breeding-station').value = state.breedingStation || '';
  document.querySelector('#f-data-quality').value = state.dataQuality || '';
  if (document.querySelector('#f-learning-file')) document.querySelector('#f-learning-file').value = state.learningFile || 'exclude';
  if (document.querySelector('#f-cupstar')) document.querySelector('#f-cupstar').checked = Boolean(state.cupStarOnly);
  if (document.querySelector('#f-best-foal-toggle')) {
    document.querySelector('#f-best-foal-toggle').dataset.state = bestFoalOverviewEnabled ? (state.bestFoalMode || 'off') : 'off';
    syncBestFoalToggleLabel();
  }
  setTriStateDropdownState('f-tag-drop', state.tags);
  setTriStateDropdownState('f-genetik-drop', state.genetik);
  setTriStateDropdownState('f-ekh-drop', state.ekh);
  document.querySelector('#f-gp-op').value = state.gpOp || 'gt';
  document.querySelector('#f-gp-val').value = state.gpVal || '';
  document.querySelector('#f-ext-op').value = state.extOp || 'gt';
  document.querySelector('#f-ext-val').value = state.extVal || '';
  document.querySelector('#f-extpct-op').value = state.extpctOp || 'gt';
  document.querySelector('#f-extpct-val').value = state.extpctVal || '';
  document.querySelector('#f-int-op').value = state.intOp || 'gt';
  document.querySelector('#f-int-val').value = state.intVal || '';

  currentSort = { field: state.sortField || 'name', dir: state.sortDir || 'asc' };
  syncMobileSortControls();

  // Ø-Vergleich-Vergleichsbasis (eigenes Feature, siehe wireCompareAvg) -
  // mit in der Vorlage gespeichert, damit "Vorlage laden" wirklich den
  // kompletten zuletzt gesehenen Zustand wiederherstellt.
  const toggle = document.querySelector('#compare-avg-toggle');
  toggle.checked = Boolean(state.compareAvgEnabled);
  document.querySelector('#compare-avg-panel').hidden = !toggle.checked;
  document.querySelector('#cmp-breed').value = state.cmpBreed || '';
  document.querySelector('#cmp-zzl').value = state.cmpZzl || '';
  document.querySelector('#cmp-owner').value = state.cmpOwner || '';
  document.querySelector('#cmp-gender').value = state.cmpGender || '';
  compareBaseline = toggle.checked ? await computeCompareBaseline() : null;
  renderCompareAvgValues();

  loadHorses();
}

async function loadFilterPresets() {
  const select = document.querySelector('#filter-preset-select');
  select.innerHTML = '<option value="">Vorlage laden…</option>';
  if (!currentSession) return;

  const all = await localGetAll(LOCAL_STORES.filterPresets);
  const data = all
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));

  for (const preset of data) {
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent = preset.name;
    opt.dataset.filters = JSON.stringify(preset.filters);
    select.appendChild(opt);
  }
}

function wireFilterPresets() {
  document.querySelector('#filter-preset-select').addEventListener('change', async (e) => {
    const opt = e.target.selectedOptions[0];
    if (!opt.value) return;
    await applyFilterState(JSON.parse(opt.dataset.filters));
  });
  document.querySelector('#save-filter-preset-btn').addEventListener('click', saveFilterPreset);
}

async function saveFilterPreset() {
  const name = prompt('Name für diese Filter-Vorlage:');
  if (!name || !name.trim()) return;

  try {
    const all = await localGetAll(LOCAL_STORES.filterPresets);
    const existing = all.find((p) => p.name === name.trim());
    const record = {
      ...(existing || {}),
      user_id: currentSession.user.id,
      name: name.trim(),
      filters: collectFilterState(),
    };
    await localPut(LOCAL_STORES.filterPresets, record);
  } catch (error) {
    alert('Vorlage konnte nicht gespeichert werden: ' + error.message);
    return;
  }
  await loadFilterPresets();
}

// --- Mehrfachauswahl (Zeilen) ---

// "#select-all" (Tabellenkopf) und "#select-all-mobile" (Listenkopf, nur
// in der mobilen Kartenansicht sichtbar, da <thead> dort ausgeblendet
// ist) steuern dieselbe Auswahl und werden dabei synchron gehalten.
function wireSelection() {
  const selectAllBoxes = document.querySelectorAll('#select-all, #select-all-mobile');
  selectAllBoxes.forEach((box) => {
    box.addEventListener('change', (e) => {
      const checked = e.target.checked;
      selectAllBoxes.forEach((other) => { other.checked = checked; });
      document.querySelectorAll('#horse-table tbody [data-select]').forEach((cb) => {
        cb.checked = checked;
        onRowSelect(cb.dataset.select, checked, false);
      });
      updateBulkBar();
    });
  });
  document.querySelector('#bulk-delete-btn').addEventListener('click', onBulkDelete);
  document.querySelector('#bulk-export-btn').addEventListener('click', exportSelectedHorses);
  document.querySelector('#bulk-tag-btn').addEventListener('click', () => onBulkTag('add'));
  document.querySelector('#bulk-tag-remove-btn').addEventListener('click', () => onBulkTag('remove'));
  document.querySelector('#bulk-learning-add-btn')?.addEventListener('click', () => onBulkLearningFile(true));
  document.querySelector('#bulk-learning-remove-btn')?.addEventListener('click', () => onBulkLearningFile(false));
  wireBulkTagModal();
}

function onRowSelect(id, checked, refreshBar = true) {
  if (checked) selectedIds.add(id);
  else selectedIds.delete(id);
  if (refreshBar) updateBulkBar();
}

function updateBulkBar() {
  const bar = document.querySelector('#bulk-actions');
  const countEl = document.querySelector('#selected-count');
  if (selectedIds.size > 0) {
    bar.hidden = false;
    countEl.textContent = `${selectedIds.size} Pferd${selectedIds.size === 1 ? '' : 'e'}`;
  } else {
    bar.hidden = true;
  }
}

function selectedHorseRows() {
  return lastRenderedRows.filter(
    (r) => selectedIds.has(String(r.id)) || selectedIds.has(r.id)
  );
}

async function exportSelectedHorses() {
  const rows = selectedHorseRows();
  if (!rows.length) {
    alert('Bitte zuerst mindestens ein Pferd über das Häkchen auswählen.');
    return;
  }

  const payload = {
    format: 'mdr-datenbank-local-backup',
    version: 4,
    exported_at: new Date().toISOString(),
    backup_kind: 'horse_selection_export',
    selection_export: true,
    selection_count: rows.length,
    selection_note:
      'Dieser Export enthält bewusst nur ausgewählte Pferde. Beim Import ausschließlich Ergänzen / zusammenführen verwenden.',
    stores: {
      [LOCAL_STORES.horses]: rows.map((row) => JSON.parse(JSON.stringify(row))),
    },
  };

  if (typeof attachBackupIntegrity === 'function') {
    await attachBackupIntegrity(payload);
  }

  const date = new Date().toISOString().slice(0, 10);
  const filename = `MDR-Auswahl-${rows.length}-Pferde-${date}.json`;
  if (typeof triggerJsonDownload === 'function') {
    triggerJsonDownload(payload, filename);
  } else {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}

function onBulkDelete() {
  const rows = selectedHorseRows();
  if (!rows.length) return;
  openDeleteModal(rows);
}

// --- Schlagwörter für mehrere ausgewählte Pferde auf einmal (siehe
// HORSE_TAG_OPTIONS in parser.js) - je nach Modus entweder Hinzufügen
// (ergänzt nur, lässt bestehende Schlagwörter und deren Zusatztexte
// unangetastet) oder Entfernen (löscht die angehakten, falls vorhanden).
// Zusatztext einzeln setzen bleibt dem Formular in horse.html vorbehalten.
let bulkTagMode = 'add';

function renderBulkTagCheckboxes() {
  const container = document.querySelector('#bulk-tag-checkboxes');
  container.innerHTML = getHorseTagOptions().map(({ label, color }) => `
    <label class="tag-checkbox-row">
      <input type="checkbox" data-bulk-tag-checkbox="${escapeHtml(label)}" />
      <span class="tag-dot" style="background:${color}"></span>
      ${escapeHtml(label)}
    </label>
  `).join('');
}

function wireBulkTagModal() {
  renderBulkTagCheckboxes();
  document.querySelector('#bulk-tag-cancel').addEventListener('click', () => {
    document.querySelector('#bulk-tag-modal').hidden = true;
  });
  document.querySelector('#bulk-tag-confirm').addEventListener('click', confirmBulkTag);
}

function onBulkTag(mode) {
  bulkTagMode = mode;
  const rows = selectedHorseRows();
  if (!rows.length) return;
  document.querySelectorAll('#bulk-tag-checkboxes [data-bulk-tag-checkbox]').forEach((cb) => { cb.checked = false; });
  document.querySelector('#bulk-tag-count').textContent = `${rows.length} Pferd${rows.length === 1 ? '' : 'e'} ausgewählt`;
  document.querySelector('#bulk-tag-modal-title').textContent = mode === 'add' ? 'Schlagwort zuweisen' : 'Schlagwort entfernen';
  document.querySelector('#bulk-tag-hint').textContent = mode === 'add'
    ? 'Ausgewählte Schlagwörter werden ergänzt, bestehende bleiben erhalten. Zusatztext (z.B. wer reserviert hat) lässt sich nur einzeln je Pferd im Bearbeiten-Formular eintragen.'
    : 'Ausgewählte Schlagwörter werden bei allen ausgewählten Pferden entfernt, falls vorhanden - andere Schlagwörter bleiben erhalten.';
  document.querySelector('#bulk-tag-confirm').textContent = mode === 'add' ? 'Zuweisen' : 'Entfernen';
  document.querySelector('#bulk-tag-modal').hidden = false;
}

async function confirmBulkTag() {
  const chosen = [...document.querySelectorAll('#bulk-tag-checkboxes [data-bulk-tag-checkbox]:checked')].map((cb) => cb.dataset.bulkTagCheckbox);
  document.querySelector('#bulk-tag-modal').hidden = true;
  if (!chosen.length) return;

  const rows = selectedHorseRows();
  const failed = [];
  for (const row of rows) {
    try {
      let newTags;
      if (bulkTagMode === 'remove') {
        newTags = (row.tags || []).filter((t) => !chosen.includes(t.label));
      } else {
        const existingLabels = new Set((row.tags || []).map((t) => t.label));
        newTags = [...(row.tags || []), ...chosen.filter((label) => !existingLabels.has(label)).map((label) => ({ label }))];
      }
      const stored = await getLocalHorseById(row.id);
      if (stored) {
        await localPut(LOCAL_STORES.horses, { ...stored, tags: newTags, updated_at: new Date().toISOString() });
      }
    } catch (error) {
      failed.push(error);
    }
  }
  if (failed.length) alert(`${failed.length} von ${rows.length} Pferden konnten nicht aktualisiert werden: ${failed[0].message}`);
  await loadHorses();
}

async function onBulkLearningFile(value) {
  const rows = selectedHorseRows();
  if (!rows.length) return;
  let gbhLocked = 0;
  let changed = 0;
  for (const row of rows) {
    const stored = await getLocalHorseById(row.id);
    if (!stored) continue;
    let desired = Boolean(value);
    const forcedGbhLearning = (typeof mdrHasGbhTag === 'function' && mdrHasGbhTag(stored))
      || (typeof mdrOwnerHasLearningMarker === 'function' && mdrOwnerHasLearningMarker(stored))
      || (typeof mdrOwnerHasGbhMarker === 'function' && mdrOwnerHasGbhMarker(stored));
    if (!desired && forcedGbhLearning) {
      desired = true;
      gbhLocked++;
    }
    const updated = { ...stored, learning_file: desired };
    if (typeof mdrLearningFileForSave === 'function') mdrLearningFileForSave(updated, stored);
    const differs = JSON.stringify(updated) !== JSON.stringify(stored);
    if (!differs) continue;
    updated.updated_at = new Date().toISOString();
    await localPut(LOCAL_STORES.horses, updated);
    changed++;
  }
  if (gbhLocked) {
    alert(`${gbhLocked} Pferd${gbhLocked===1?'':'e'} ${gbhLocked===1?'bleibt':'bleiben'} automatisch Lerndatei (GBH-Schlagwort oder Besitzer mit „(GBH)“/„(Friedhof)“).`);
  }
  await loadHorses();
}

// --- CSV-Export ---

const CSV_COLUMNS = ['Name', 'Geschlecht', 'Rasse - Rasseanteile', 'Farbe Genetik', 'GP', 'Ext', 'Ext%', 'Int', 'Besitzer', 'Schlagwörter', 'MDR-Link'];

// Semikolon statt Komma als Trennzeichen, da deutsches Excel Kommas als
// Dezimaltrennzeichen liest und eine mit Komma getrennte CSV-Datei sonst
// nicht automatisch in Spalten aufgeteilt würde.
function csvEscape(value) {
  const str = String(value ?? '');
  return /[;"\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}

// Deutsches Dezimalkomma statt Punkt - mit Punkt liest Excel (deutsches
// Gebietsschema) Werte wie "2.10" sonst fälschlich als Datum (2. Oktober)
// statt als Zahl.
function deDecimal(value) {
  return String(value).replace('.', ',');
}

function csvRowOf(h) {
  const d = computeDerived(h);
  const breed = normalizeBreed(h.breed) || 'Rasselos';
  const breedCell = h.breed_composition ? `${breed} - ${h.breed_composition}` : breed;
  const colorGeneticsCell = [h.coat_color, d.presentGenes].filter(Boolean).join(' ');
  const mdrLink = h.external_id
    ? `https://www.morning-dust-ranch.de/index2.php?site=pferd&id=${encodeURIComponent(h.external_id)}`
    : '';
  const tagsCell = (h.tags || []).map((t) => t.note ? `${t.label}: ${t.note}` : t.label).join(', ');
  return [
    h.name || '',
    h.gender || '',
    breedCell,
    colorGeneticsCell,
    d.gp ?? '',
    d.extAvg != null ? deDecimal(d.extAvg.toFixed(2)) : '',
    d.extPercent != null ? deDecimal(d.extPercent) + '%' : '',
    d.intAvg != null ? deDecimal(d.intAvg.toFixed(2)) : '',
    h.owner || '',
    tagsCell,
    mdrLink,
  ];
}

// Sind über die Kästchen einzelne Pferde ausgewählt, werden nur diese
// exportiert - ohne Auswahl exportiert der Button stattdessen alle
// aktuell gefilterten/sortierten Zeilen (lastRenderedRows, siehe
// loadHorses), berücksichtigt also automatisch alle aktiven Filter.
function exportCsv() {
  const rows = selectedIds.size > 0
    ? lastRenderedRows.filter((r) => selectedIds.has(r.id))
    : lastRenderedRows;

  if (!rows.length) {
    alert('Keine Pferde zum Exportieren (Filter ergibt keine Treffer).');
    return;
  }

  const lines = [CSV_COLUMNS, ...rows.map(csvRowOf)]
    .map((row) => row.map(csvEscape).join(';'));
  // BOM voranstellen, damit Excel die UTF-8-Kodierung (Umlaute) korrekt erkennt.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pferde_export_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function wireExportCsv() {
  document.querySelector('#export-csv-btn').addEventListener('click', exportCsv);
}
