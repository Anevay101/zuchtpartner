let currentIdentity = '';
let currentPairing = null; // die Verpaarung, fuer die gerade das Fohlen-Popup offen ist
let currentSort = { field: 'pairing_date', dir: 'desc' }; // siehe wireSortableHeaders
// Name (klein, getrimmt) -> Rasse, fuer die Rasse-Spalte/-Filter in der
// Verpaarungs-Tabelle - Deckhengst/Stute sind dort nur Freitext, keine
// Verknuepfung zu horses.id, daher der Umweg ueber den Namen.
let nameToBreed = new Map();
let nameToHorse = new Map();
let horseById = new Map();
let foalReferenceById = new Map();
const PAST_PAIRING_VISIBLE_LIMIT = 50;
let showAllPastPairings = false;
let pairingEmpiricalDeviations = null;
const PAIRING_BREEDER_FILTER_SETTING = 'pairing_log_breeders_v54';
const PAIRING_BREEDER_FILTER_STORAGE = 'pairing-log-breeders-v54';
let pairingFilterOwners = [];


document.addEventListener('DOMContentLoaded', init);

async function init() {
  const session = await requireSession();
  if (!session) return;
  await renderSharedNav(session);
  currentIdentity = session.user.email.split('@')[0];

  await populateHorseNames();
  await refreshPairingPredictionContext();
  await populateOwnerFilter();
  await populateBreedFilter();

  document.querySelector('#pairing-form').addEventListener('submit', onAddPairing);
  document.querySelector('#p-mare').addEventListener('change', syncPairingOwnerFromMare);
  document.querySelector('#p-mare').addEventListener('input', syncPairingOwnerFromMare);
  document.querySelector('#f-owner').addEventListener('change', onPairingBreederFilterChange);
  document.querySelector('#f-breed').addEventListener('change', loadPairings);
  document.querySelector('#foal-modal-skip').addEventListener('click', closeFoalModal);
  document.querySelector('#foal-modal-save').addEventListener('click', onSaveFoal);
  document.querySelector('#foal-existing-link-btn').addEventListener('click', onLinkExistingFoal);
  document.querySelector('#foal-existing-link').addEventListener('input', syncExistingFoalLearningStatus);
  document.querySelector('#foal-existing-link').addEventListener('change', syncExistingFoalLearningStatus);
  // "Automatisch auslesen" im Fohlen-Popup - onParse/fillForm/
  // updateBreedCompositionVisibility sind aus horseForm.js wiederverwendet
  // (siehe dessen init(), das hier wegen des page-title-Guards nicht
  // läuft und diese Buttons deshalb selbst verdrahten muss).
  document.querySelector('#parse-btn').addEventListener('click', onParse);
  document.querySelector('#purebred_pct').addEventListener('input', updateBreedCompositionVisibility);
  wireDuplicateModal();
  wireSortableHeaders();

  await loadPairings();
}

// Deckhengst/Stute als Freitext mit Vorschlägen aus den bereits
// angelegten Pferden (keine feste Verknüpfung, damit auch Pferde
// außerhalb dieser Datenbank eingetragen werden können).
async function populateHorseNames() {
  const data = (await localGetAll(LOCAL_STORES.horses)).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
  const stallionDatalist = document.querySelector('#stallion-horse-names');
  const mareDatalist = document.querySelector('#mare-horse-names');
  const foalDatalist = document.querySelector('#foal-horse-names');
  if (stallionDatalist) stallionDatalist.innerHTML = '';
  if (mareDatalist) mareDatalist.innerHTML = '';
  if (foalDatalist) foalDatalist.innerHTML = '';
  nameToBreed = new Map();
  nameToHorse = new Map();
  horseById = new Map();

  const activeBreeds = new Set(typeof activeBreedingBreeds === 'function'
    ? activeBreedingBreeds(data)
    : data.filter(h => isActiveBreeder(h.owner) && /stute|mare|female/i.test(String(h.gender || ''))).map(h => normalizeBreed(h.breed) || 'Rasselos'));

  const genderOf = (h) => String(h?.gender || '').toLocaleLowerCase('de');
  const isMare = (h) => /stute|mare|female/.test(genderOf(h));
  const isStallion = (h) => /hengst|stallion|male/.test(genderOf(h));
  const isLearning = (h) => typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(h);

  (data || []).forEach((h) => {
    const breed = normalizeBreed(h.breed) || 'Rasselos';
    // Neue Verpaarung: Stutenvorschläge nur aus aktivem Besitz. Hengste
    // dürfen fremden Züchtern gehören, bleiben aber auf die Rassen der aktiven
    // Stuten begrenzt. Freitext bleibt für Sonderfälle weiterhin möglich.
    if (!isLearning(h) && isMare(h) && isActiveBreeder(h.owner) && mareDatalist) {
      const opt = document.createElement('option');
      opt.value = h.name;
      opt.label = [h.owner, breed].filter(Boolean).join(' · ');
      mareDatalist.appendChild(opt);
    }
    if (!isLearning(h) && isStallion(h) && activeBreeds.has(breed) && stallionDatalist) {
      const opt = document.createElement('option');
      opt.value = h.name;
      opt.label = [h.owner, breed].filter(Boolean).join(' · ');
      stallionDatalist.appendChild(opt);
    }
    if (foalDatalist) {
      const foalOpt = document.createElement('option');
      foalOpt.value = h.name;
      foalOpt.label = [h.gender, breed, h.external_id ? `ID ${h.external_id}` : null]
        .filter(Boolean).join(' · ');
      foalDatalist.appendChild(foalOpt);
    }
    const key = (h.name || '').trim().toLowerCase();
    nameToBreed.set(key, breed || '');
    if (key && !nameToHorse.has(key)) nameToHorse.set(key, h);
    if (h.id != null) horseById.set(String(h.id), h);
  });
}

// "American Paint Horse" steht bereits fest im HTML (Standardauswahl,
// siehe f-owner-Analogie in list.js) - hier nur um weitere tatsaechlich
// vorkommende Rassen ergaenzt. Kürzel wie "APH" werden zusätzlich auf den
// vollen Namen normalisiert (siehe normalizeBreed), falls noch nicht
// normalisierte Altdaten vorkommen.
async function populateBreedFilter() {
  const data = await localGetAll(LOCAL_STORES.horses);
  const breeds = typeof activeBreedingBreeds === 'function'
    ? activeBreedingBreeds(data)
    : [...new Set((data || []).filter(h => isActiveBreeder(h.owner) && /stute|mare|female/i.test(String(h.gender || ''))).map((h) => normalizeBreed(h.breed) || 'Rasselos'))].sort((a,b)=>a.localeCompare(b,'de'));

  const sel = document.querySelector('#f-breed');
  const previous = sel.value;
  sel.innerHTML = '<option value="">Alle</option>';
  breeds.forEach((b) => {
    const opt = document.createElement('option');
    opt.value = b;
    opt.textContent = b;
    sel.appendChild(opt);
  });
  sel.value = [...sel.options].some(o => o.value === previous) ? previous : '';
}

// Sichtbare Züchter: nur aktive Züchter, Auswahl pro Login gespeichert.
async function populateOwnerFilter() {
  const [pairings, horses] = await Promise.all([
    localGetAll(LOCAL_STORES.pairings),
    localGetAll(LOCAL_STORES.horses),
  ]);

  const pairingOwners = new Set((pairings || []).map((p) => (p.owner || '').trim()).filter(Boolean));
  const horseOwners = new Set((horses || []).map((h) => (h.owner || '').trim()).filter(Boolean));
  const allKnownOwners=[...new Set([...pairingOwners, ...horseOwners])]
    .filter(owner=>owner && owner.toLowerCase() !== 'local')
    .sort((a,b)=>a.localeCompare(b,'de'));

  // Verpaarungslog: nur aktive Züchter, Auswahl pro Login gespeichert.
  const activeOwners=typeof activeBreederOptions === 'function'
    ? activeBreederOptions(allKnownOwners)
    : allKnownOwners;
  const dbKey=typeof mdrPersonalSettingKey === 'function'
    ? mdrPersonalSettingKey(PAIRING_BREEDER_FILTER_SETTING)
    : PAIRING_BREEDER_FILTER_SETTING;
  const storageKey=typeof mdrPersonalSettingKey === 'function'
    ? `mdr-${mdrPersonalSettingKey(PAIRING_BREEDER_FILTER_STORAGE)}`
    : PAIRING_BREEDER_FILTER_STORAGE;

  let savedOwners=null;
  try {
    const row=await localGet(LOCAL_STORES.userSettings,dbKey);
    if (Array.isArray(row?.owners)) savedOwners=row.owners.map(x=>String(x).trim()).filter(Boolean);
  } catch {}
  if (savedOwners == null) {
    try {
      const parsed=JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (Array.isArray(parsed)) savedOwners=parsed.map(x=>String(x).trim()).filter(Boolean);
    } catch {}
  }

  const activeSet=new Set(activeOwners);
  let selected=(savedOwners || []).filter(owner=>activeSet.has(owner));
  if (savedOwners == null) {
    const personal=typeof mdrPersonalOwnerNames === 'function' ? mdrPersonalOwnerNames() : [];
    selected=personal.filter(owner=>activeSet.has(owner));
    if (!selected.length) selected=activeOwners.slice();
  } else if (!selected.length && activeOwners.length) {
    selected=activeOwners.slice();
  }
  pairingFilterOwners=selected;

  const root=document.querySelector('#f-owner');
  root.innerHTML=activeOwners.length
    ? activeOwners.map(owner=>`<label class="pairing-owner-option"><input type="checkbox" value="${escapeHtml(owner)}" ${selected.includes(owner)?'checked':''}> <span>${escapeHtml(owner)}</span></label>`).join('')
    : '<span class="tiny muted">Keine aktiven Züchter.</span>';
  const status=document.getElementById('f-owner-status');
  if (status) status.textContent=activeOwners.length
    ? `${selected.length} von ${activeOwners.length} aktiv · pro Login gespeichert`
    : 'Keine aktiven Züchter in den Einstellungen.';

  // Neue Verpaarung: bekannte echte Züchter bleiben vollständig auswählbar.
  const ownerSel = document.querySelector('#p-owner');
  const previousOwner = ownerSel.value;
  ownerSel.innerHTML = '<option value="">Bitte auswählen…</option>';
  allKnownOwners.forEach((owner) => {
    const opt = document.createElement('option');
    opt.value = owner;
    opt.textContent = owner;
    ownerSel.appendChild(opt);
  });
  ownerSel.value = [...ownerSel.options].some((o) => o.value === previousOwner)
    ? previousOwner
    : '';

  syncPairingOwnerFromMare();
}

function selectedPairingBreeders() {
  return [...document.querySelectorAll('#f-owner input[type="checkbox"]:checked')]
    .map(cb=>String(cb.value || '').trim()).filter(Boolean);
}

async function onPairingBreederFilterChange() {
  const root=document.querySelector('#f-owner');
  const options=[...root.querySelectorAll('input[type="checkbox"]')];
  let owners=selectedPairingBreeders();
  if (!owners.length && options.length) {
    options[0].checked=true;
    owners=selectedPairingBreeders();
  }
  pairingFilterOwners=owners;
  const dbKey=typeof mdrPersonalSettingKey === 'function'
    ? mdrPersonalSettingKey(PAIRING_BREEDER_FILTER_SETTING)
    : PAIRING_BREEDER_FILTER_SETTING;
  const storageKey=typeof mdrPersonalSettingKey === 'function'
    ? `mdr-${mdrPersonalSettingKey(PAIRING_BREEDER_FILTER_STORAGE)}`
    : PAIRING_BREEDER_FILTER_STORAGE;
  await localPut(LOCAL_STORES.userSettings,{key:dbKey,owners,updated_at:new Date().toISOString()});
  localStorage.setItem(storageKey,JSON.stringify(owners));
  const status=document.getElementById('f-owner-status');
  if (status) status.textContent=`${owners.length} Züchter ausgewählt · gespeichert`;
  await loadPairings();
}

function ensurePairingOwnerOption(owner) {
  const value = String(owner || '').trim();
  if (!value || value.toLowerCase() === 'local') return;
  const sel = document.querySelector('#p-owner');
  if ([...sel.options].some((o) => o.value === value)) return;
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = value;
  sel.appendChild(opt);
}

function syncPairingOwnerFromMare() {
  const mareName = document.querySelector('#p-mare')?.value || '';
  const mare = pairingHorseByName(mareName);
  const owner = String(mare?.owner || '').trim();
  if (!owner || owner.toLowerCase() === 'local') return;
  ensurePairingOwnerOption(owner);
  document.querySelector('#p-owner').value = owner;
}

function pairingHorseByName(name) {
  return nameToHorse.get((name || '').trim().toLowerCase()) || null;
}

async function refreshPairingPredictionContext() {
  // Gleiche Datenbasis wie die "Datenbank-Schätzung" im Zuchtplaner:
  // echte Pferde + nicht separat als Pferd vorhandene Fohlen-Referenzen.
  const horses = await localGetAll(LOCAL_STORES.horses);
  horseById = new Map(horses.filter(h => h.id != null).map(h => [String(h.id), h]));

  const refs = await localGetAll(LOCAL_STORES.foalReferenceData);
  foalReferenceById = new Map(refs.filter(r => r.id != null).map(r => [String(r.id), r]));

  const liveIds = new Set(horses.map(h => String(h.id)));
  const extras = refs.filter(r => !r.horse_id || !liveIds.has(String(r.horse_id)));
  const combined = [...horses, ...extras];
  pairingEmpiricalDeviations = combined.length && typeof computeEmpiricalDeviations === 'function'
    ? computeEmpiricalDeviations(combined)
    : null;
}

function predictionForPairing(pairing, source = 'verpaarungslog') {
  const mare = pairingHorseByName(pairing?.mare);
  const stallion = pairingHorseByName(pairing?.stallion);
  if (!mare || !stallion || typeof buildFoalPredictionSnapshot !== 'function') return null;
  return buildFoalPredictionSnapshot(mare, stallion, pairingEmpiricalDeviations, source);
}

async function ensurePredictionSnapshots(pairings) {
  const result = [];
  for (const pairing of pairings || []) {
    if (pairing?.prediction_snapshot) {
      // V51: alte Prognosen behalten ihre damalige Datenbank-Schätzung,
      // bekommen aber einmalig den neuen empirischen 80%-Bereich um genau
      // diese gespeicherte Schätzung ergänzt. So wird nichts historisch
      // überschrieben, der neue Abgleich ist trotzdem nutzbar.
      if (
        !pairing.prediction_snapshot.database_range &&
        pairingEmpiricalDeviations &&
        typeof enrichFoalPredictionSnapshotWithEmpiricalRange === 'function'
      ) {
        const enriched = enrichFoalPredictionSnapshotWithEmpiricalRange(
          pairing.prediction_snapshot,
          pairingEmpiricalDeviations,
          'nachtraeglich-v51'
        );
        const updated = await localUpdate(LOCAL_STORES.pairings, pairing.id, {
          prediction_snapshot: enriched,
          prediction_range_backfilled_at: new Date().toISOString(),
          // updated_at absichtlich nicht verändern: technische Nachrüstung.
        });
        result.push(updated || { ...pairing, prediction_snapshot: enriched });
      } else {
        result.push(pairing);
      }
      continue;
    }

    const snapshot = predictionForPairing(pairing, 'nachtraeglich-v36');
    if (!snapshot) {
      result.push(pairing);
      continue;
    }
    const updated = await localUpdate(LOCAL_STORES.pairings, pairing.id, {
      prediction_snapshot: snapshot,
      prediction_backfilled_at: new Date().toISOString(),
      // updated_at wird bewusst NICHT verändert: die Prognose-Nachrüstung
      // ist keine fachliche Änderung der ursprünglichen Verpaarung.
    });
    result.push(updated || { ...pairing, prediction_snapshot: snapshot });
  }
  return result;
}

function actualRecordForPairing(pairing) {
  if (pairing?.foal_horse_id != null) {
    const horse = horseById.get(String(pairing.foal_horse_id));
    if (horse) return horse;
  }
  if (pairing?.foal_reference_id != null) {
    const ref = foalReferenceById.get(String(pairing.foal_reference_id));
    if (ref) return ref;
  }
  return pairing?.actual_foal_snapshot || null;
}

function ensurePairingPedigree(payload, pairing) {
  if (!payload || !pairing) return payload;
  const pedigree = payload.pedigree;
  const ancestors = Array.isArray(pedigree)
    ? pedigree.slice(1).map(x => x?.name).filter(Boolean)
    : (pedigree?.ancestors || []).map(x => x?.name).filter(Boolean);

  // Nur ergänzen, wenn aus dem eingefügten Fohlentext noch gar keine
  // Elterninformation vorliegt. Vorhandenen Stammbaum niemals ersetzen.
  if (ancestors.length) return payload;

  payload.pedigree = {
    ...(pedigree && !Array.isArray(pedigree) ? pedigree : {}),
    ancestors: [
      { name: pairing.stallion || 'Unbekannt' },
      { name: pairing.mare || 'Unbekannt' },
    ],
    sections: pedigree && !Array.isArray(pedigree) ? (pedigree.sections ?? null) : null,
    source: 'verpaarungslog',
  };
  return payload;
}

function predictionFormat(metric, value) {
  if (value == null || !Number.isFinite(Number(value))) return '–';
  const n = Number(value);
  return metric.decimals === 0
    ? `${Math.round(n)}${metric.suffix || ''}`
    : `${n.toFixed(metric.decimals)}${metric.suffix || ''}`;
}

function predictionDiffFormat(metric, value) {
  if (value == null || !Number.isFinite(Number(value))) return '–';
  const n = Number(value);
  const abs = Math.abs(n);
  const rendered = metric.decimals === 0 ? Math.round(abs) : abs.toFixed(metric.decimals);
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${rendered}${metric.suffix || ''}`;
}

function pairingPredictionDetailsHtml(pairing) {
  const snapshot = pairing?.prediction_snapshot;
  const actualRecord = actualRecordForPairing(pairing);
  const actual = actualRecord && typeof foalActualMetricSnapshot === 'function'
    ? foalActualMetricSnapshot(actualRecord)
    : null;
  const baseRows = snapshot && actual && typeof compareFoalPrediction === 'function'
    ? compareFoalPrediction(snapshot, actual)
    : (snapshot ? FOAL_PREDICTION_METRICS.map(metric => ({
        ...metric,
        best: snapshot.best?.[metric.key] ?? null,
        estimate: snapshot.database?.[metric.key] ?? null,
        worst: snapshot.worst?.[metric.key] ?? null,
        actual: null,
        diff: null,
        withinRange: null,
        databaseLow: snapshot.database_range?.[metric.key]?.low ?? null,
        databaseHigh: snapshot.database_range?.[metric.key]?.high ?? null,
        withinDatabaseRange: null,
        databaseCoverage: Number(snapshot.database_range?.[metric.key]?.coverage || 0) || null,
        sampleSize: Number(snapshot.sample_sizes?.[metric.key] || snapshot.database_range?.[metric.key]?.n || 0),
      })) : []);
  const rows = baseRows.map(row => ({
    ...row,
    currentSampleSize: Number(pairingEmpiricalDeviations?.[row.key]?.n || 0),
  }));

  const hasPrediction = snapshot && typeof foalPredictionHasAnyValue === 'function'
    ? foalPredictionHasAnyValue(snapshot)
    : !!snapshot;
  const foalName = actualRecord?.name || pairing?.foal_name || null;

  if (!hasPrediction) {
    return `
      <details class="pairing-prediction-details">
        <summary>🔮 Voraussichtliche Fohlendaten</summary>
        <p class="small muted">
          Keine Prognose verfügbar. Für eine Berechnung müssen Deckhengst und Stute
          beide als Pferde in der Datenbank vorhanden sein.
        </p>
      </details>`;
  }

  const sourceNote = snapshot.source === 'nachtraeglich-v36'
    ? 'Diese ältere Verpaarung hatte noch keinen gespeicherten Prognose-Snapshot. Die Werte wurden einmalig mit dem Datenstand beim ersten Öffnen von V36 nachberechnet.'
    : 'Diese Prognose wurde beim Anlegen der Verpaarung gespeichert und bleibt dadurch als damaliger Stand erhalten.';

  const rangeSourceNote = snapshot.database_range_source === 'nachtraeglich-v51'
    ? 'Der typische 80%-Datenbankbereich wurde für diesen älteren Snapshot einmalig in V51 mit der dann vorhandenen Fohlen-Datenbasis ergänzt; die ursprüngliche Datenbank-Schätzung selbst wurde nicht verändert.'
    : snapshot.database_range
      ? 'Der typische 80%-Datenbankbereich wurde zusammen mit dieser Prognose gespeichert.'
      : 'Für diese ältere Prognose ist noch kein empirischer Datenbankbereich gespeichert.';

  return `
    <details class="pairing-prediction-details">
      <summary>
        🔮 Voraussichtliche Fohlendaten
        ${actualRecord ? ` · 🐴 Vergleich mit ${pairingFoalLinkHtml(pairing, actualRecord)}` : ''}
      </summary>
      <div class="pairing-prediction-body">
        <div class="pairing-prediction-family">
          <span><strong>Deckhengst:</strong> ${pairingParentLinkHtml(pairing, 'stallion')}</span>
          <span><strong>Stute:</strong> ${pairingParentLinkHtml(pairing, 'mare')}</span>
          ${actualRecord ? `<span><strong>Fohlen:</strong> ${pairingFoalLinkHtml(pairing, actualRecord)}</span>` : ''}
        </div>
        <table class="prediction-compare-table">
          <thead>
            <tr>
              <th>Wert</th>
              <th>Best Case</th>
              <th>Datenbank-Schätzung</th>
              <th>Typischer DB-Bereich (80%)</th>
              <th>Worst Case</th>
              <th>Tatsächlich</th>
              <th>Abweichung zur Schätzung</th>
              <th>Theoretische Spanne?</th>
              <th>DB-Bereich getroffen?</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <th>${escapeHtml(row.label)}</th>
                <td>${predictionFormat(row, row.best)}</td>
                <td>
                  ${predictionFormat(row, row.estimate)}
                  ${row.sampleSize || row.currentSampleSize ? `<span class="prediction-n">${row.sampleSize ? `damals n=${row.sampleSize}` : ''}${row.sampleSize && row.currentSampleSize && row.currentSampleSize !== row.sampleSize ? ' · ' : ''}${row.currentSampleSize && row.currentSampleSize !== row.sampleSize ? `heute n=${row.currentSampleSize}` : ''}</span>` : ''}
                </td>
                <td>${
                  row.databaseLow != null && row.databaseHigh != null
                    ? `${predictionFormat(row, row.databaseLow)} – ${predictionFormat(row, row.databaseHigh)}`
                    : '–'
                }</td>
                <td>${predictionFormat(row, row.worst)}</td>
                <td>${predictionFormat(row, row.actual)}</td>
                <td>${predictionDiffFormat(row, row.diff)}</td>
                <td>${
                  row.withinRange === true ? '<span class="prediction-ok">✓ innerhalb</span>'
                  : row.withinRange === false ? '<span class="prediction-out">⚠ außerhalb</span>'
                  : '–'
                }</td>
                <td>${
                  row.withinDatabaseRange === true ? '<span class="prediction-ok">✓ getroffen</span>'
                  : row.withinDatabaseRange === false ? '<span class="prediction-out">⚠ außerhalb</span>'
                  : '–'
                }</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <p class="tiny muted">${escapeHtml(sourceNote)}</p>
        <p class="tiny muted">${escapeHtml(rangeSourceNote)}</p>
        <p class="tiny muted">„damals n“ gehört zum gespeicherten Prognose-Snapshot; „heute n“ zeigt die aktuelle Lernbasis. Die historische Prognose wird nicht rückwirkend verändert.</p>
        <p class="tiny muted">
          <strong>Best/Worst</strong> ist die theoretische Prognosespanne.
          Der <strong>typische DB-Bereich</strong> ist etwas anderes: Er umfasst den zentralen 80%-Bereich
          der bisher beobachteten Fehler der Datenbank-Schätzung (10.–90. Perzentil echter Eltern–Fohlen-Vergleiche).
        </p>
        ${actualRecord
          ? `<p class="small"><strong>Vergleich vorhanden.</strong> Bei behaltenen Fohlen werden die tatsächlichen Werte aus dem aktuell verknüpften Pferdedatensatz gelesen – spätere Ergänzungen am Pferd erscheinen also auch hier.</p>`
          : `<p class="small muted">Sobald das Fohlen über „Fohlen eintragen“ erfasst wurde, erscheint hier automatisch der Soll-Ist-Vergleich.</p>`
        }
      </div>
    </details>`;
}

function predictionAccuracySummaryHtml(pairings) {
  const completed = (pairings || []).filter(p => p.prediction_snapshot && actualRecordForPairing(p));
  if (!completed.length) {
    return `
      <strong>📏 Prognose-Genauigkeit</strong><br>
      <span class="small">Noch kein vollständiger Prognosevergleich vorhanden.</span>`;
  }

  const metricStats = {};
  for (const metric of FOAL_PREDICTION_METRICS) {
    const diffs = [];
    let theoreticalInside = 0;
    let theoreticalN = 0;
    let databaseInside = 0;
    let databaseN = 0;

    for (const pairing of completed) {
      const actual = foalActualMetricSnapshot(actualRecordForPairing(pairing));
      const row = compareFoalPrediction(pairing.prediction_snapshot, actual)
        .find(x => x.key === metric.key);
      if (!row) continue;

      if (row.absDiff != null) diffs.push(row.absDiff);
      if (row.withinRange != null) {
        theoreticalN++;
        if (row.withinRange) theoreticalInside++;
      }
      if (row.withinDatabaseRange != null) {
        databaseN++;
        if (row.withinDatabaseRange) databaseInside++;
      }
    }

    metricStats[metric.key] = {
      n:diffs.length,
      mae:diffs.length ? diffs.reduce((a,b)=>a+b,0)/diffs.length : null,
      theoreticalInside,theoreticalN,databaseInside,databaseN,
    };
  }

  const bits = FOAL_PREDICTION_METRICS.map(metric => {
    const s=metricStats[metric.key];
    if (!s?.n) return null;
    const mae=predictionFormat(metric,s.mae);
    const db=s.databaseN ? ` · DB-Bereich ${s.databaseInside}/${s.databaseN}` : '';
    const theoretical=s.theoreticalN ? ` · theoretisch ${s.theoreticalInside}/${s.theoreticalN}` : '';
    return `<strong>${escapeHtml(metric.label)}</strong>: Ø-Abweichung ${mae}${db}${theoretical}`;
  }).filter(Boolean);

  return `
    <strong>📏 Prognose-Genauigkeit · ${completed.length} Fohlenvergleich${completed.length === 1 ? '' : 'e'}</strong><br>
    <span class="small">${bits.join(' &nbsp;|&nbsp; ') || 'Noch zu wenige vollständige Werte.'}</span><br>
    <span class="tiny muted">
      „DB-Bereich“ = zentraler empirischer 80%-Bereich um die Datenbank-Schätzung.
      „theoretisch“ = Best-/Worst-Extremspanne.
    </span>`;
}


function localTodayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatEuropeanDate(value) {
  if (!value) return '-';
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
  const eu = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (eu) return `${String(Number(eu[1])).padStart(2,'0')}.${String(Number(eu[2])).padStart(2,'0')}.${eu[3]}`;
  return raw;
}

function parseEuropeanDateToIso(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  let y, m, d;
  let match = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (match) {
    d = Number(match[1]); m = Number(match[2]); y = Number(match[3]);
  } else {
    match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return undefined;
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  }

  const check = new Date(y, m - 1, d);
  if (check.getFullYear() !== y || check.getMonth() !== m - 1 || check.getDate() !== d) {
    return undefined;
  }
  return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function findExistingFoalFromInput(name) {
  const norm = (s) => String(s || '').trim().toLocaleLowerCase('de');
  const wanted = norm(name);
  if (!wanted) return null;
  return [...horseById.values()].find((h) => norm(h.name) === wanted) || null;
}

function isPastPairing(pairing) {
  const value = String(pairing?.pairing_date || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value < localTodayIso();
}

function sortPairings(data, field, dir) {
  const mult = dir === 'asc' ? 1 : -1;
  return [...data].sort((a, b) => {
    const av = a[field] ?? null;
    const bv = b[field] ?? null;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return String(av).localeCompare(String(bv), 'de') * mult;
  });
}

function sortCurrentPairingsByNextDate(data) {
  return [...data].sort((a, b) => {
    const ad = String(a.pairing_date || '');
    const bd = String(b.pairing_date || '');
    const av = /^\d{4}-\d{2}-\d{2}$/.test(ad) ? ad : '9999-99-99';
    const bv = /^\d{4}-\d{2}-\d{2}$/.test(bd) ? bd : '9999-99-99';
    const byDate = av.localeCompare(bv, 'de');
    if (byDate) return byDate;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''), 'de');
  });
}

function sortPastPairingsNewestFirst(data) {
  return [...data].sort((a, b) => {
    const byDate = String(b.pairing_date || '').localeCompare(String(a.pairing_date || ''), 'de');
    if (byDate) return byDate;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''), 'de');
  });
}

function applyPairingScrollbar(wrapper, tbody, pairingCount) {
  if (!wrapper || !tbody) return;
  wrapper.classList.toggle('is-scrollable', pairingCount >= 10);
  wrapper.style.maxHeight = '';
  if (pairingCount < 10) return;

  const rows = [...tbody.children].slice(0, 20);
  const table = tbody.closest('table');
  const headHeight = table?.tHead?.getBoundingClientRect().height || 44;
  const bodyHeight = rows.reduce((sum, row) => sum + row.getBoundingClientRect().height, 0);
  wrapper.style.maxHeight = `${Math.ceil(headHeight + bodyHeight + 2)}px`;
}

function bindPairingActions(pairings) {
  const byId = new Map((pairings || []).map((p) => [String(p.id), p]));
  document.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => onDeletePairing(btn.dataset.delete));
  });
  document.querySelectorAll('[data-foal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pairing = byId.get(String(btn.dataset.foal));
      if (pairing) openFoalModal(pairing);
    });
  });
  document.querySelectorAll('[data-keepfoal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pairing = byId.get(String(btn.dataset.keepfoal));
      if (pairing) onSetKeepFoal(pairing, btn.dataset.value === 'true');
    });
  });
  document.querySelectorAll('[data-editdate]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pairing = byId.get(String(btn.dataset.editdate));
      if (pairing) onEditDate(pairing);
    });
  });
}


async function onAddPairing(e) {
  e.preventDefault();
  const errorEl = document.querySelector('#pairing-form-error');
  errorEl.textContent = '';
  const session = await requireSession();

  const stallion = document.querySelector('#p-stallion').value.trim();
  const mare = document.querySelector('#p-mare').value.trim();
  if (!stallion || !mare) {
    errorEl.textContent = 'Deckhengst und Stute sind Pflichtfelder.';
    return;
  }

  const pairingDate = parseEuropeanDateToIso(document.querySelector('#p-date').value);
  if (pairingDate === undefined) {
    errorEl.textContent = 'Bitte das Abfohldatum als TT.MM.JJJJ eingeben, z. B. 19.08.2026.';
    return;
  }

  const existingFoalInput = document.querySelector('#p-existing-foal')?.value.trim() || '';
  const existingFoal = existingFoalInput ? findExistingFoalFromInput(existingFoalInput) : null;
  if (existingFoalInput && !existingFoal) {
    errorEl.textContent = 'Das ausgewählte Fohlen wurde nicht in der Pferdedatenbank gefunden. Bitte einen Namen aus der Vorschlagsliste auswählen.';
    return;
  }

  const mareRecord = pairingHorseByName(mare);
  const ownerInput = document.querySelector('#p-owner').value.trim() || String(mareRecord?.owner || '').trim();
  if (!ownerInput || ownerInput.toLowerCase() === 'local') {
    errorEl.textContent = 'Bitte einen Besitzer / Züchter aus der Liste auswählen.';
    return;
  }

  const keepFoalVal = document.querySelector('#p-keep-foal').value;
  const basePairing = {
    user_id: session.user.id,
    owner: ownerInput,
    stallion,
    mare,
    pairing_date: pairingDate,
    keep_foal: keepFoalVal === '' ? null : keepFoalVal === 'true',
    notes: document.querySelector('#p-notes').value.trim() || null,
  };

  const predictionSnapshot = predictionForPairing(basePairing, 'verpaarungslog-manuell');
  const actualSnapshot = existingFoal && typeof foalActualMetricSnapshot === 'function'
    ? {
        name: existingFoal.name || null,
        ...foalActualMetricSnapshot(existingFoal),
        captured_at: new Date().toISOString(),
      }
    : null;

  const payload = {
    ...basePairing,
    prediction_snapshot: predictionSnapshot,
    foal_horse_id: existingFoal?.id ?? null,
    foal_reference_id: null,
    foal_name: existingFoal?.name || null,
    actual_foal_snapshot: actualSnapshot,
    foal_recorded_at: existingFoal ? new Date().toISOString() : null,
  };

  let inserted;
  try {
    const now = new Date().toISOString();
    const id = await localAdd(LOCAL_STORES.pairings, { ...payload, created_at: now, updated_at: now });
    inserted = { ...payload, id, created_at: now, updated_at: now };
  } catch (error) {
    errorEl.textContent = 'Speichern fehlgeschlagen: ' + error.message;
    return;
  }

  document.querySelector('#pairing-form').reset();
  await refreshPairingPredictionContext();
  await populateOwnerFilter();
  await loadPairings();

  if (!existingFoal && payload.keep_foal !== null) {
    openFoalModal(inserted);
  }
}

// Klick auf eine sortierbare Spaltenkopfzeile (Deckhengst/Stute/
// Abfohldatum) sortiert danach; erneuter Klick auf dieselbe Spalte dreht
// die Richtung um - analog zum Sortieren in der Pferde-Uebersicht
// (list.js). Fehlende Werte landen dabei unabhaengig von der Richtung
// immer am Ende, nicht ganz vorn.
function wireSortableHeaders() {
  document.querySelectorAll('#pairing-table th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (currentSort.field === field) {
        currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort = { field, dir: 'asc' };
      }
      loadPairings();
    });
  });
}

async function loadPairings() {
  const currentTbody = document.querySelector('#pairing-table tbody');
  const pastTbody = document.querySelector('#past-pairing-table tbody');
  currentTbody.innerHTML = '<tr><td colspan="8">Lade…</td></tr>';
  pastTbody.innerHTML = '<tr><td colspan="13">Lade…</td></tr>';

  const selectedOwners = selectedPairingBreeders();
  let data;
  try {
    data = await localGetAll(LOCAL_STORES.pairings);
    data = await ensurePredictionSnapshots(data);
  } catch (error) {
    const msg = `<tr><td colspan="8" class="error">Fehler beim Laden: ${escapeHtml(error.message)}</td></tr>`;
    currentTbody.innerHTML = msg;
    pastTbody.innerHTML = `<tr><td colspan="13" class="error">Fehler beim Laden: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  if (document.querySelectorAll('#f-owner input[type="checkbox"]').length) {
    const selectedSet=new Set(selectedOwners.map(owner=>owner.toLocaleLowerCase('de')));
    data=data.filter(p=>selectedSet.has(String(p.owner || '').trim().toLocaleLowerCase('de')));
  }

  const breed = document.querySelector('#f-breed').value;
  if (breed) {
    data = data.filter((p) => breedOf(p.stallion) === breed || breedOf(p.mare) === breed);
  }

  // V46: aktuelle Verpaarungen IMMER nach nächstem Abfohldatum,
  // vergangene IMMER nach jüngster Geburt. Die Reihenfolge wird nicht
  // mehr durch einen zufälligen letzten Tabellen-Sortierklick verändert.
  const currentPairings = sortCurrentPairingsByNextDate(
    data.filter((p) => !isPastPairing(p))
  );
  const allPastPairings = sortPastPairingsNewestFirst(
    data.filter((p) => isPastPairing(p))
  );
  const hiddenPastCount = Math.max(0, allPastPairings.length - PAST_PAIRING_VISIBLE_LIMIT);
  const pastPairings = showAllPastPairings
    ? allPastPairings
    : allPastPairings.slice(0, PAST_PAIRING_VISIBLE_LIMIT);

  currentTbody.innerHTML = currentPairings.length
    ? currentPairings.map(rowHtml).join('')
    : '<tr><td colspan="8">Keine aktuellen Verpaarungen gefunden.</td></tr>';

  const currentCount = document.getElementById('current-pairings-count');
  if (currentCount) currentCount.textContent = `(${currentPairings.length})`;
  const nextDate = currentPairings.find((p) => /^\d{4}-\d{2}-\d{2}$/.test(String(p.pairing_date || '')))?.pairing_date || null;
  const nextDateEl = document.getElementById('current-next-foaling-date');
  if (nextDateEl) nextDateEl.textContent = nextDate ? formatEuropeanDate(nextDate) : '–';

  const pastSection = document.getElementById('past-pairings-section');
  pastSection.hidden = false;
  const pastCount = document.getElementById('past-pairings-count');
  if (pastCount) {
    pastCount.textContent = hiddenPastCount && !showAllPastPairings
      ? `(${pastPairings.length} von ${allPastPairings.length})`
      : `(${allPastPairings.length})`;
  }
  pastTbody.innerHTML = pastPairings.length
    ? pastPairings.map(pastRowHtml).join('')
    : '<tr><td colspan="13">Noch keine vergangenen Verpaarungen gefunden.</td></tr>';

  const archiveControl = document.getElementById('past-pairings-archive-control');
  const archiveButton = document.getElementById('past-pairings-archive-toggle');
  if (archiveControl && archiveButton) {
    archiveControl.hidden = hiddenPastCount <= 0;
    archiveButton.textContent = showAllPastPairings
      ? `↩️ Nur die neuesten ${PAST_PAIRING_VISIBLE_LIMIT} anzeigen`
      : `📦 ${hiddenPastCount} ältere Verpaarung${hiddenPastCount === 1 ? '' : 'en'} anzeigen`;
  }

  // Ältere Verpaarungen werden nur aus der Ansicht archiviert. Sie bleiben
  // vollständig gespeichert und stehen sämtlichen Lern-/Prognosefunktionen weiter zur Verfügung.
  bindPairingActions([...currentPairings, ...pastPairings]);

  requestAnimationFrame(() => {
    applyPairingScrollbar(
      document.getElementById('current-pairings-scroll'),
      currentTbody,
      currentPairings.length
    );
    applyPairingScrollbar(
      document.getElementById('past-pairings-scroll'),
      pastTbody,
      pastPairings.length
    );
  });
}

// V39: Pferdenamen im Verpaarungslog auf die lokale Detailseite verlinken.
// Wenn eine eindeutige ID im Prognose-Snapshot vorhanden ist, hat sie
// Vorrang. Bei älteren Verpaarungen wird als Fallback über den Namen gesucht.
function pairingHorseRecord(name, preferredId = null) {
  if (preferredId != null) {
    const byId = horseById.get(String(preferredId));
    if (byId) return byId;
  }
  return pairingHorseByName(name);
}

function localHorseLinkHtml(horse, fallbackName, className = 'pairing-horse-link') {
  const label = horse?.name || fallbackName || '';
  if (!horse?.id) return escapeHtml(label);
  return `<a class="${className}" href="view.html?id=${encodeURIComponent(horse.id)}" title="Pferdeseite von ${escapeHtml(label)} öffnen">${escapeHtml(label)}</a>`;
}

function pairingParentLinkHtml(pairing, role) {
  const isMare = role === 'mare';
  const name = isMare ? pairing?.mare : pairing?.stallion;
  const preferredId = isMare
    ? pairing?.prediction_snapshot?.mare_id
    : pairing?.prediction_snapshot?.stallion_id;
  const horse = pairingHorseRecord(name, preferredId);
  return localHorseLinkHtml(horse, name);
}

function pairingFoalLinkHtml(pairing, actualRecord = null) {
  const record = actualRecord || actualRecordForPairing(pairing);
  const label = record?.name || pairing?.foal_name || 'erfasstes Fohlen';

  // Nur echte Pferdedatensätze haben eine lokale Pferdeseite.
  // Reine foal_reference_data bleiben bewusst Text.
  const horse = pairing?.foal_horse_id != null
    ? horseById.get(String(pairing.foal_horse_id))
    : (record?.id != null && horseById.has(String(record.id))
        ? horseById.get(String(record.id))
        : null);

  return localHorseLinkHtml(horse, label, 'pairing-horse-link pairing-foal-link');
}

// Rasse eines per Name eingetragenen Deckhengsts/Stute (siehe
// nameToBreed in populateHorseNames) - leer, falls unbekannt (z.B. noch
// nicht in der Datenbank angelegt).
function breedOf(name) {
  return nameToBreed.get((name || '').trim().toLowerCase()) || '';
}

function canDecideKeepFoal(pairing) {
  const date = String(pairing?.pairing_date || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= localTodayIso();
}

function keepFoalButtonsHtml(pairing) {
  const enabled = canDecideKeepFoal(pairing);
  const disabled = enabled ? '' : ' disabled';
  const titleSuffix = enabled
    ? ''
    : ' – erst ab dem Abfohldatum auswählbar';
  return `
    <button type="button" class="keep-foal-btn keep-foal-yes${pairing.keep_foal === true ? ' active' : ''}" data-keepfoal="${pairing.id}" data-value="true" title="Fohlen behalten: Ja${titleSuffix}"${disabled}>✓</button>
    <button type="button" class="keep-foal-btn keep-foal-no${pairing.keep_foal === false ? ' active' : ''}" data-keepfoal="${pairing.id}" data-value="false" title="Fohlen behalten: Nein${titleSuffix}"${disabled}>✗</button>
    ${enabled ? '' : '<span class="tiny muted keep-foal-wait">ab Abfohldatum</span>'}
  `;
}

function completedPredictionRows(pairing) {
  const snapshot = pairing?.prediction_snapshot;
  const actualRecord = actualRecordForPairing(pairing);
  if (!snapshot || !actualRecord || typeof compareFoalPrediction !== 'function' || typeof foalActualMetricSnapshot !== 'function') {
    return [];
  }
  return compareFoalPrediction(snapshot, foalActualMetricSnapshot(actualRecord))
    .filter((row) => row.actual != null || row.estimate != null);
}

function compactPastPredictionHtml(pairing) {
  const rows = completedPredictionRows(pairing);
  if (!rows.length) return '<span class="muted">Noch kein Vergleich</span>';
  return `<div class="past-prediction-compact">${rows.map((row) =>
    `<span><strong>${escapeHtml(row.label)}:</strong> ${predictionFormat(row, row.estimate)} → ${predictionFormat(row, row.actual)}</span>`
  ).join('')}</div>`;
}

function compactPastDeviationHtml(pairing) {
  const rows = completedPredictionRows(pairing).filter((row) => row.diff != null);
  if (!rows.length) return '–';
  return `<div class="past-prediction-compact">${rows.map((row) =>
    `<span><strong>${escapeHtml(row.label)}:</strong> ${predictionDiffFormat(row, row.diff)}</span>`
  ).join('')}</div>`;
}

function pastTheoreticalRangeHtml(pairing) {
  const rows = completedPredictionRows(pairing).filter((row) => row.withinRange != null);
  if (!rows.length) return '<span class="muted">–</span>';

  const inside = rows.filter((row) => row.withinRange === true).length;
  const total = rows.length;
  if (inside === total) {
    return `<span class="prediction-ok" title="Alle ${total} vorhandenen Werte liegen innerhalb der gespeicherten theoretischen Best-/Worst-Spanne.">✓ ${inside}/${total} innerhalb</span>`;
  }
  if (inside > 0) {
    return `<span class="prediction-partial" title="${inside} von ${total} Werten liegen innerhalb der theoretischen Best-/Worst-Spanne.">◑ ${inside}/${total}</span>`;
  }
  return `<span class="prediction-out" title="Keiner der vorhandenen Werte liegt innerhalb der theoretischen Best-/Worst-Spanne.">⚠ 0/${total}</span>`;
}

function pastDatabaseRangeAccuracyHtml(pairing) {
  const rows = completedPredictionRows(pairing).filter((row) => row.withinDatabaseRange != null);
  if (!rows.length) return '<span class="muted">–</span>';

  const inside = rows.filter((row) => row.withinDatabaseRange === true).length;
  const total = rows.length;
  if (inside === total) {
    return `<span class="prediction-ok" title="Alle ${total} vorhandenen Werte liegen im gespeicherten typischen 80%-Bereich der Datenbank-Schätzung.">✓ ${inside}/${total} getroffen</span>`;
  }
  if (inside > 0) {
    return `<span class="prediction-partial" title="${inside} von ${total} Werten liegen im typischen 80%-Bereich der Datenbank-Schätzung.">◑ ${inside}/${total} teilweise</span>`;
  }
  return `<span class="prediction-out" title="Keiner der vorhandenen Werte liegt im typischen 80%-Bereich der Datenbank-Schätzung.">⚠ 0/${total}</span>`;
}

function pastFoalHtml(pairing) {
  const actual = actualRecordForPairing(pairing);
  if (!actual) return '<span class="muted">Noch nicht verknüpft</span>';
  return pairingFoalLinkHtml(pairing, actual);
}

function parentAverageMetricSnapshot(pairing) {
  const mare = pairingHorseRecord(
    pairing?.mare,
    pairing?.prediction_snapshot?.mare_id ?? pairing?.expected_foal?.mare_id ?? null
  );
  const stallion = pairingHorseRecord(
    pairing?.stallion,
    pairing?.prediction_snapshot?.stallion_id ?? pairing?.expected_foal?.stallion_id ?? null
  );
  if (!mare || !stallion || typeof foalActualMetricSnapshot !== 'function') {
    return { mare, stallion, average: { gp:null, ext:null, extPct:null, int:null } };
  }
  const a = foalActualMetricSnapshot(mare);
  const b = foalActualMetricSnapshot(stallion);
  const average = {};
  for (const key of ['gp','ext','extPct','int']) {
    average[key] = a[key] == null || b[key] == null ? null : (Number(a[key]) + Number(b[key])) / 2;
  }
  return { mare, stallion, average };
}

// Zuchtempfehlung V53.6 – Variante B (ausgewogen):
// - Stute/Stutfohlen: Grün ab +5 GP gegenüber dem Elternmittel.
// - Hengst/Hengstfohlen: Grün ab +10 GP gegenüber dem Elternmittel.
// - Auf/über Elternniveau, aber unter der grünen GP-Grenze: Orange.
// - GP unter Elternmittel: immer Rot.
// - Ext/Ext%/Int sind Qualitätskontrolle: leichte Verschlechterungen stufen
//   Grün auf Orange herab, deutliche Verschlechterungen können Rot auslösen.
function foalRecommendationGenderProfile(horse) {
  const gender = String(horse?.gender || '').trim().toLowerCase();
  if (/stute|stutfohlen|mare|filly|female/.test(gender)) {
    return { kind:'mare', label:'Stute', greenGpDelta:5 };
  }
  if (/hengst|hengstfohlen|stallion|colt|male/.test(gender)) {
    return { kind:'stallion', label:'Hengst', greenGpDelta:10 };
  }
  // Ohne eindeutiges Geschlecht wird die strengere Hengst-Grenze verwendet;
  // gleichzeitig verhindert der unvollständige Status unten ein irreführendes Grün.
  return { kind:'unknown', label:'Geschlecht offen', greenGpDelta:10 };
}

function foalBreedingRecommendation(pairing) {
  const actualHorse = actualRecordForPairing(pairing);
  if (!actualHorse) {
    return { level:'missing', label:'Noch offen', reasons:['Für die Ampel muss das tatsächliche Fohlen verknüpft sein.'], evaluated:0 };
  }
  const parents = parentAverageMetricSnapshot(pairing);
  if (typeof bpEvaluateParentAverage === 'function') {
    const rec = bpEvaluateParentAverage(actualHorse, parents.stallion, parents.mare);
    const labelMap = { keep:'Behalten', check:'Prüfen', cull:'Aussortieren empfohlen', partial:'Noch offen' };
    return { ...rec, label:labelMap[rec.level] || 'Noch offen' };
  }
  return { level:'partial', label:'Noch offen', reasons:['Zuchtfortschrittslogik nicht geladen.'], evaluated:0 };
}

function foalBreedingRecommendationHtml(pairing) {
  const rec = foalBreedingRecommendation(pairing);

  const config = {
    cull:    { cls:'traffic-red-pill',    label:'Aussortieren empfohlen' },
    check:   { cls:'traffic-orange-pill', label:'Prüfen' },
    keep:    { cls:'traffic-green-pill',  label:'Behalten' },
    partial: { cls:'traffic-neutral-pill',label:'Noch offen' },
    missing: { cls:'traffic-neutral-pill',label:'Noch offen' },
  }[rec.level] || { cls:'traffic-neutral-pill', label:'Noch offen' };

  // Die ausführlichen Gründe bleiben als Tooltip erhalten, damit die
  // Tabellenspalte selbst ruhig und gut lesbar bleibt.
  const title = rec.reasons.length
    ? rec.reasons.join(' · ')
    : 'Unverbindliche Empfehlung aus dem Vergleich mit dem Mittelwert beider Eltern.';

  return `<span class="foal-traffic-pill ${config.cls}" title="${escapeHtml(title)}">${escapeHtml(config.label)}</span>`;
}

function currentPairingRecommendationHtml(pairing) {
  const actual = actualRecordForPairing(pairing);
  if (actual) return foalBreedingRecommendationHtml(pairing);

  if (canDecideKeepFoal(pairing)) {
    return '<span class="foal-traffic-pill traffic-neutral-pill" title="Für die Ampel muss das tatsächliche Fohlen mit der Verpaarung verknüpft sein.">Fohlen noch verknüpfen</span>';
  }

  return '<span class="foal-traffic-pill traffic-future-pill" title="Die Zuchtempfehlung kann erst ab dem Abfohldatum mit dem tatsächlichen Fohlen berechnet werden.">Bewertung ab Geburt</span>';
}

// "Fohlen behalten" wird per zwei Buttons (✓/✗) direkt in der Tabelle
// gesetzt. Ab V44 sind diese Buttons erst ab dem Abfohldatum aktiv.
function rowHtml(p) {
  const keepFoalCell = keepFoalButtonsHtml(p);
  const breedCell = [breedOf(p.stallion), breedOf(p.mare)].filter(Boolean).join(' / ') || '-';
  const actualRecord = actualRecordForPairing(p);
  const foalBtn = p.keep_foal !== null
    ? `<button type="button" class="secondary small" data-foal="${p.id}">${actualRecord ? 'Fohlen-Verknüpfung öffnen' : 'Fohlen verknüpfen / eintragen'}</button>`
    : '';
  const actualBadge = actualRecord
    ? `<span class="pairing-foal-recorded" title="Fohlendaten sind mit dieser Verpaarung verknüpft">🐴 Fohlen erfasst</span>`
    : '';

  return `<tr>
    <td>${pairingParentLinkHtml(p, 'stallion')}</td>
    <td>${pairingParentLinkHtml(p, 'mare')}</td>
    <td>${escapeHtml(breedCell)}</td>
    <td>${escapeHtml(formatEuropeanDate(p.pairing_date))}</td>
    <td class="keep-foal-cell">${keepFoalCell}</td>
    <td class="foal-recommendation-cell">${currentPairingRecommendationHtml(p)}</td>
    <td>${escapeHtml(p.owner || '')}</td>
    <td class="actions-cell">${actualBadge}${foalBtn}<button type="button" class="secondary small" data-editdate="${p.id}">Bearbeiten</button><button class="danger small" data-delete="${p.id}">Löschen</button></td>
  </tr>
  <tr class="pairing-prediction-row">
    <td colspan="8">${pairingPredictionDetailsHtml(p)}</td>
  </tr>`;
}

function pastRowHtml(p) {
  const breedCell = [breedOf(p.stallion), breedOf(p.mare)].filter(Boolean).join(' / ') || '-';
  const actualRecord = actualRecordForPairing(p);
  const actualBadge = actualRecord
    ? `<span class="pairing-foal-recorded" title="Fohlendaten sind mit dieser Verpaarung verknüpft">🐴 erfasst</span>`
    : '';
  const foalBtn = canDecideKeepFoal(p)
    ? `<button type="button" class="secondary small" data-foal="${p.id}">${actualRecord ? 'Verknüpfung öffnen' : 'Fohlen verknüpfen / eintragen'}</button>`
    : '';

  return `<tr class="past-pairing-main-row">
    <td>${pairingParentLinkHtml(p, 'stallion')}</td>
    <td>${pairingParentLinkHtml(p, 'mare')}</td>
    <td>${escapeHtml(breedCell)}</td>
    <td>${escapeHtml(formatEuropeanDate(p.pairing_date))}</td>
    <td>${pastFoalHtml(p)} ${actualBadge}</td>
    <td>${compactPastPredictionHtml(p)}</td>
    <td>${compactPastDeviationHtml(p)}</td>
    <td>${pastTheoreticalRangeHtml(p)}</td>
    <td>${pastDatabaseRangeAccuracyHtml(p)}</td>
    <td class="foal-recommendation-cell">${foalBreedingRecommendationHtml(p)}</td>
    <td class="keep-foal-cell">${keepFoalButtonsHtml(p)}</td>
    <td>${escapeHtml(p.owner || '')}</td>
    <td class="actions-cell">${foalBtn}<button type="button" class="secondary small" data-editdate="${p.id}">Bearbeiten</button><button class="danger small" data-delete="${p.id}">Löschen</button></td>
  </tr>
  <tr class="pairing-prediction-row">
    <td colspan="13">${pairingPredictionDetailsHtml(p)}</td>
  </tr>`;
}

// Abfohldatum nachtraeglich aendern (z.B. per Decksprung-Button aus dem
// mdr-Planer automatisch auf Verpaarungsdatum + 30 Tage gesetzt, aber
// spaeter bekannt/korrigiert). Einfaches prompt() statt eigenem Modal,
// analog zum bestehenden confirm() bei onDeletePairing.
async function onEditDate(pairing) {
  const input = prompt(
    'Abfohldatum (TT.MM.JJJJ), leer lassen zum Entfernen:',
    pairing.pairing_date ? formatEuropeanDate(pairing.pairing_date) : ''
  );
  if (input === null) return;

  const parsed = parseEuropeanDateToIso(input);
  if (parsed === undefined) {
    alert('Bitte das Datum im Format TT.MM.JJJJ eingeben (z.B. 19.08.2026).');
    return;
  }
  try {
    await localUpdate(LOCAL_STORES.pairings, pairing.id, {
      pairing_date: parsed,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    alert('Speichern fehlgeschlagen: ' + error.message);
    return;
  }
  await loadPairings();
}

// Aendert "Fohlen behalten" nachtraeglich. War der Wert vorher unbekannt
// (null - typischerweise ein per Decksprung-Button automatisch
// angelegter Eintrag), oeffnet sich direkt danach das Fohlen-Popup
// (gleiches Verhalten wie beim erstmaligen Setzen in onAddPairing) -
// war bereits ein Wert gesetzt, nur der Wert aendern, ohne das Popup
// erneut aufzudraengen (dafuer gibt es den separaten "Fohlen eintragen"-
// Button).
async function onSetKeepFoal(pairing, value) {
  if (!canDecideKeepFoal(pairing)) {
    alert('„Fohlen behalten?“ kann erst am Abfohldatum oder danach festgelegt werden.');
    return;
  }
  const wasUnset = pairing.keep_foal === null;
  let updated;
  try {
    updated = await localUpdate(LOCAL_STORES.pairings, pairing.id, {
      keep_foal: value,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    alert('Speichern fehlgeschlagen: ' + error.message);
    return;
  }
  await loadPairings();
  if (wasUnset && !actualRecordForPairing(updated)) openFoalModal(updated);
}

async function onDeletePairing(id) {
  if (!confirm('Diese Verpaarung wirklich unwiderruflich löschen?')) return;
  try {
    const key = /^\d+$/.test(String(id)) ? Number(id) : id;
    await localDelete(LOCAL_STORES.pairings, key);
  } catch (error) {
    alert('Löschen fehlgeschlagen: ' + error.message);
    return;
  }
  await loadPairings();
}

// --- Fohlen-Popup ---
// Nutzt dieselben Feld-IDs wie horse.html und damit dessen (in
// horseForm.js definierte) Funktionen collectForm/fillForm/onParse/
// renderDetailTables wieder, statt sie zu duplizieren. horseForm.js'
// eigenes init() greift hier nicht (siehe Guard dort) - das Wiring der
// Buttons und das eigentliche Speichern übernimmt ausschließlich diese
// Datei.

function resetFoalForm() {
  ['name', 'external_id', 'gender', 'breed', 'coat_color', 'appaloosa_pattern', 'hlp_slp', 'notes', 'image_url',
    'purebred_pct', 'breed_composition', 'ico', 'disease_free', 'breeding_allowed'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('raw-text').value = '';
  document.getElementById('parse-status').textContent = '';
  document.getElementById('form-error').textContent = '';
  document.getElementById('detail-tables').innerHTML = '';
  document.getElementById('detail-fieldset').hidden = true;

  const learningSelect = document.getElementById('learning_file');
  if (learningSelect) learningSelect.value = 'false';
  const existingLink = document.getElementById('foal-existing-link');
  if (existingLink) existingLink.value = '';
  const existingLearning = document.getElementById('foal-existing-learning-file');
  if (existingLearning) existingLearning.value = 'false';
  const existingError = document.getElementById('foal-existing-link-error');
  if (existingError) existingError.textContent = '';

  updateBreedCompositionVisibility();
  extraData = {};
}

function openFoalModal(pairing) {
  currentPairing = pairing;
  resetFoalForm();
  document.getElementById('owner').value = pairing.owner || currentIdentity;

  const title = document.getElementById('foal-modal-title');
  const hint = document.getElementById('foal-modal-hint');
  if (pairing.keep_foal) {
    title.textContent = 'Fohlen verknüpfen oder eintragen';
    hint.textContent = `Deckhengst: ${pairing.stallion} × Stute: ${pairing.mare}. Wenn das Fohlen bereits gespeichert ist, oben einfach auswählen und verknüpfen.`;
  } else {
    title.textContent = 'Fohlen verknüpfen oder Werte erfassen';
    hint.textContent = `Deckhengst: ${pairing.stallion} × Stute: ${pairing.mare}. Ein bereits vorhandenes Pferd kann oben direkt verknüpft werden.`;
  }

  const linked = actualRecordForPairing(pairing);
  if (linked?.name && pairing.foal_horse_id != null) {
    document.getElementById('foal-existing-link').value = linked.name;
    const existingLearning = document.getElementById('foal-existing-learning-file');
    if (existingLearning) existingLearning.value = (typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(linked)) ? 'true' : 'false';
  }

  document.getElementById('foal-modal').hidden = false;
}

function closeFoalModal() {
  document.getElementById('foal-modal').hidden = true;
  currentPairing = null;
}


function inferFoalGameVersion(pairing) {
  const mare = pairingHorseByName(pairing?.mare);
  const stallion = pairingHorseByName(pairing?.stallion);
  const versions = [mare?.game_version, stallion?.game_version]
    .filter(Boolean)
    .map(v => String(v).toUpperCase());
  if (versions.includes('EN')) return 'EN';
  if (versions.includes('DE')) return 'DE';
  return 'DE';
}

// V38: Das kompakte Fohlen-Popup enthält absichtlich weniger Felder als
// horse.html. V37 hat hier fälschlich collectForm() aus horseForm.js
// benutzt; das greift auf nicht vorhandene Elemente wie game_version,
// birthdate und breeding_goal zu und brach deshalb beim Klick auf
// "Speichern" mit einem JavaScript-Fehler ab.
//
// Dieser Collector liest NUR Felder, die im Popup wirklich vorhanden sind.
// Aus dem eingefügten Pferdetext erkannte Zusatzwerte bleiben über extraData
// trotzdem vollständig erhalten.
function collectFoalModalForm() {
  const textIds = [
    'name', 'external_id', 'gender', 'breed', 'breed_composition',
    'coat_color', 'appaloosa_pattern', 'owner', 'hlp_slp', 'notes', 'image_url',
  ];
  const numberIds = ['purebred_pct', 'ico'];
  const booleanIds = ['disease_free', 'breeding_allowed', 'learning_file'];
  const out = {};

  for (const id of textIds) {
    const el = document.getElementById(id);
    const value = el?.value?.trim?.() ?? '';
    out[id] = value === '' ? null : value;
  }
  if (out.breed) out.breed = normalizeBreed(out.breed);
  if (out.external_id) out.external_id = normalizeExternalId(out.external_id);

  for (const id of numberIds) {
    const el = document.getElementById(id);
    out[id] = !el || el.value === '' ? null : Number(el.value);
  }
  for (const id of booleanIds) {
    const el = document.getElementById(id);
    out[id] = !el || el.value === '' ? null : el.value === 'true';
  }

  // Diese Felder gibt es nicht als sichtbare Inputs im kompakten Popup,
  // können aber aus dem kopierten Pferdetext erkannt worden sein.
  out.game_version = extraData?.game_version || inferFoalGameVersion(currentPairing);
  out.birthdate = extraData?.birthdate ?? null;
  out.breeding_goal = extraData?.breeding_goal ?? null;

  return out;
}

function ensureExistingHorsePedigreeFromPairing(horse, pairing) {
  if (!horse || !pairing) return horse;
  const copy = { ...horse };
  ensurePairingPedigree(copy, pairing);
  return copy;
}

async function linkExistingFoalToPairing(pairing, horse) {
  if (!pairing || !horse) throw new Error('Verpaarung oder Fohlen fehlt.');

  // Falls der bestehende Pferdedatensatz noch gar keinen Stammbaum hat,
  // Vater und Mutter aus der Verpaarung ergänzen. Vorhandene Stammbäume
  // werden durch ensurePairingPedigree NICHT überschrieben.
  const withPedigree = ensureExistingHorsePedigreeFromPairing(horse, pairing);
  if (JSON.stringify(withPedigree.pedigree) !== JSON.stringify(horse.pedigree)) {
    await localPut(LOCAL_STORES.horses, {
      ...horse,
      pedigree: withPedigree.pedigree,
      updated_at: new Date().toISOString(),
    });
    horse = await localGet(LOCAL_STORES.horses, horse.id);
  }

  const predictionSnapshot = pairing.prediction_snapshot
    || predictionForPairing(pairing, 'vor-verknuepfung-v38');

  const actualSnapshot = typeof foalActualMetricSnapshot === 'function'
    ? {
        name: horse.name || null,
        ...foalActualMetricSnapshot(horse),
        captured_at: new Date().toISOString(),
      }
    : null;

  await localUpdate(LOCAL_STORES.pairings, pairing.id, {
    prediction_snapshot: predictionSnapshot,
    foal_horse_id: horse.id,
    foal_reference_id: null,
    foal_name: horse.name || null,
    actual_foal_snapshot: actualSnapshot,
    foal_recorded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return horse;
}

function syncExistingFoalLearningStatus() {
  const input = document.getElementById('foal-existing-link');
  const select = document.getElementById('foal-existing-learning-file');
  if (!input || !select) return;
  const horse = findExistingFoalFromInput(input.value.trim());
  select.value = horse && typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(horse) ? 'true' : 'false';
}

async function onLinkExistingFoal() {
  const errorEl = document.getElementById('foal-existing-link-error');
  errorEl.textContent = '';

  if (!currentPairing) {
    errorEl.textContent = 'Keine Verpaarung ausgewählt.';
    return;
  }

  const name = document.getElementById('foal-existing-link').value.trim();
  if (!name) {
    errorEl.textContent = 'Bitte ein bereits gespeichertes Pferd auswählen.';
    return;
  }

  const horse = findExistingFoalFromInput(name);
  if (!horse) {
    errorEl.textContent = 'Dieses Pferd wurde nicht in der Datenbank gefunden. Bitte einen Namen aus der Vorschlagsliste auswählen.';
    return;
  }

  try {
    const desiredLearning = document.getElementById('foal-existing-learning-file')?.value === 'true';
    const updatedHorse = { ...horse, learning_file: desiredLearning };
    if (typeof mdrLearningFileForSave === 'function') mdrLearningFileForSave(updatedHorse, horse);
    if (updatedHorse.learning_file !== horse.learning_file) {
      updatedHorse.updated_at = new Date().toISOString();
      await localPut(LOCAL_STORES.horses, updatedHorse);
      horseById.set(String(updatedHorse.id), updatedHorse);
      nameToHorse.set((updatedHorse.name || '').trim().toLowerCase(), updatedHorse);
    }
    await linkExistingFoalToPairing(currentPairing, updatedHorse);
  } catch (error) {
    errorEl.textContent = 'Verknüpfen fehlgeschlagen: ' + error.message;
    return;
  }

  closeFoalModal();
  await populateHorseNames();
  await refreshPairingPredictionContext();
  await loadPairings();
}

// Sucht (ohne Namensabgleich) ein Pferd, dessen Stammbaum zu Deckhengst
// und Stute der aktuellen Verpaarung passt - Vater/Mutter sind laut
// parser.js/parsePedigree immer die ersten beiden Stammbaum-Einträge.
// Damit lassen sich z.B. Fohlen wiedererkennen, die zuerst automatisch
// als "Fohlen_Mutter X Vater" angelegt und später unter ihrem echten
// Namen erneut eingetragen wurden.
async function findPedigreeCandidate(stallion, mare, excludeName) {
  const data = await localGetAll(LOCAL_STORES.horses);
  const norm = (s) => (s || '').trim().toLowerCase();
  return data.find((h) => {
    if (norm(h.name) === norm(excludeName)) return false;
    const ancestors = Array.isArray(h.pedigree) ? h.pedigree.slice(1) : (h.pedigree?.ancestors || []);
    return norm(ancestors[0]?.name) === norm(stallion) && norm(ancestors[1]?.name) === norm(mare)
      && norm(stallion) && norm(mare);
  }) || null;
}

function wireDuplicateModal() {
  document.getElementById('foal-duplicate-cancel').addEventListener('click', () => {
    document.getElementById('foal-duplicate-modal').hidden = true;
    duplicateResolve?.(false);
  });
  document.getElementById('foal-duplicate-confirm').addEventListener('click', () => {
    document.getElementById('foal-duplicate-modal').hidden = true;
    duplicateResolve?.(true);
  });
}

let duplicateResolve = null;

// Zeigt die Ja/Nein-Nachfrage und liefert true (ist dasselbe Pferd ->
// bestehenden Datensatz aktualisieren) oder false (ist ein anderes Pferd
// -> normal neu anlegen).
function askIsSameHorse(candidateName) {
  document.getElementById('foal-duplicate-text').textContent =
    `Es gibt bereits ein Pferd mit demselben Vater/Mutter: "${candidateName}". Handelt es sich um dasselbe Pferd?`;
  document.getElementById('foal-duplicate-modal').hidden = false;
  return new Promise((resolve) => { duplicateResolve = resolve; });
}

async function onSaveFoal() {
  const errorEl = document.getElementById('form-error');
  errorEl.textContent = '';

  try {
    const session = await requireSession();

    const formData = collectFoalModalForm();
    if (!formData.name) {
      errorEl.textContent = 'Name ist ein Pflichtfeld.';
      return;
    }

    const payload = { ...formData };
    for (const k of JSONB_KEYS) {
      if (extraData[k] !== undefined) payload[k] = extraData[k];
    }
    payload.raw_text = null;
    ensurePairingPedigree(payload, currentPairing);
    if (typeof mdrLearningFileForSave === 'function') mdrLearningFileForSave(payload);

    let savedActualRecord = null;
    let foalHorseId = null;
    let foalReferenceId = null;

    if (currentPairing.keep_foal) {
      const horses = await localGetAll(LOCAL_STORES.horses);
      const norm = (s) => (s || '').trim().toLowerCase();
      const existingByName = horses.find((h) => norm(h.name) === norm(formData.name)) || null;

      let targetId = existingByName?.id || null;
      let existingRecord = existingByName || null;

      if (!targetId) {
        const candidate = await findPedigreeCandidate(
          currentPairing.stallion,
          currentPairing.mare,
          formData.name
        );
        if (candidate) {
          const isSame = await askIsSameHorse(candidate.name);
          if (isSame) {
            targetId = candidate.id;
            existingRecord = await localGet(LOCAL_STORES.horses, targetId);
          }
        }
      }

      const now = new Date().toISOString();
      if (targetId) {
        if (existingRecord) {
          for (const key of Object.keys(payload)) {
            payload[key] = mergeFieldValue(key, existingRecord[key], payload[key]);
          }
        }
        if (typeof mdrLearningFileForSave === 'function') mdrLearningFileForSave(payload);
        await localPut(LOCAL_STORES.horses, {
          ...(existingRecord || {}),
          ...payload,
          id: targetId,
          updated_at: now,
        });
        foalHorseId = targetId;
        savedActualRecord = await localGet(LOCAL_STORES.horses, targetId);
      } else {
        foalHorseId = await localAdd(LOCAL_STORES.horses, {
          ...payload,
          user_id: session.user.id,
          created_at: now,
          updated_at: now,
        });
        savedActualRecord = await localGet(LOCAL_STORES.horses, foalHorseId);
      }
    } else {
      foalReferenceId = await localAdd(LOCAL_STORES.foalReferenceData, {
        ...payload,
        user_id: session.user.id,
        kept: false,
        pairing_id: currentPairing.id,
        created_at: new Date().toISOString(),
      });
      savedActualRecord = await localGet(LOCAL_STORES.foalReferenceData, foalReferenceId);
    }

    // Prognose notfalls noch VOR der Ist-Verknüpfung erzeugen. Für neue
    // Verpaarungen existiert sie bereits; das ist nur eine Sicherheitsleine
    // für ältere oder extern angelegte Einträge.
    const predictionSnapshot = currentPairing.prediction_snapshot
      || predictionForPairing(currentPairing, 'vor-fohlenerfassung-v36');

    const actualSnapshot = savedActualRecord && typeof foalActualMetricSnapshot === 'function'
      ? {
          name: savedActualRecord.name || payload.name || null,
          ...foalActualMetricSnapshot(savedActualRecord),
          captured_at: new Date().toISOString(),
        }
      : null;

    await localUpdate(LOCAL_STORES.pairings, currentPairing.id, {
      prediction_snapshot: predictionSnapshot,
      foal_horse_id: foalHorseId,
      foal_reference_id: foalReferenceId,
      foal_name: savedActualRecord?.name || payload.name || null,
      actual_foal_snapshot: actualSnapshot,
      foal_recorded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    errorEl.textContent = 'Speichern fehlgeschlagen: ' + error.message;
    return;
  }

  closeFoalModal();
  await populateHorseNames();
  await refreshPairingPredictionContext();
  await loadPairings();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}


document.addEventListener('DOMContentLoaded', () => {
  const archiveToggle = document.getElementById('past-pairings-archive-toggle');
  if (archiveToggle) {
    archiveToggle.addEventListener('click', () => {
      showAllPastPairings = !showAllPastPairings;
      loadPairings();
    });
  }
});
