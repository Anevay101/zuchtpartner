function mdrPregnancyNormalizeName(value) {
  return String(value || '').trim().toLocaleLowerCase('de');
}

function mdrPregnancyLocalTodayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function mdrPregnancySameGameVersion(a, b) {
  return mdrGameWorld(a,'DE') === mdrGameWorld(b,'DE');
}

function mdrPregnancyFindStallion(horses, sireName, mare) {
  const wanted = mdrPregnancyNormalizeName(sireName);
  if (!wanted) return null;

  const sameVersion = horses.filter(
    (h) => mdrPregnancyNormalizeName(h.name) === wanted && mdrPregnancySameGameVersion(h, mare)
  );
  if (sameVersion.length === 1) return sameVersion[0];

  const allMatches = horses.filter((h) => mdrPregnancyNormalizeName(h.name) === wanted);
  return allMatches.length === 1 ? allMatches[0] : null;
}

async function mdrPregnancyEmpiricalDeviations(horses) {
  if (typeof computeEmpiricalDeviations !== 'function') return null;
  const refs = await localGetAll(LOCAL_STORES.foalReferenceData);
  const liveIds = new Set((horses || []).map((h) => String(h.id)));
  const extras = (refs || []).filter((r) => !r.horse_id || !liveIds.has(String(r.horse_id)));
  const combined = [...(horses || []), ...extras];
  return combined.length ? computeEmpiricalDeviations(combined) : null;
}

function mdrPregnancyExactNaturalMatch(pairing, mare, pregnancy) {
  const sameNamesAndDate = (
    mdrPregnancyNormalizeName(pairing?.mare) === mdrPregnancyNormalizeName(mare?.name) &&
    mdrPregnancyNormalizeName(pairing?.stallion) === mdrPregnancyNormalizeName(pregnancy?.sire_name) &&
    String(pairing?.pairing_date || '') === String(pregnancy?.foaling_date || '')
  );
  if (!sameNamesAndDate) return false;

  const storedVersion = String(pairing?.pregnancy_source_game_version || '').toUpperCase();
  return !storedVersion || storedVersion === mdrGameWorld(mare,'DE');
}

function mdrPregnancyIsSameMare(pairing, mare) {
  if (!pairing || !mare) return false;

  const sameName =
    mdrPregnancyNormalizeName(pairing.mare) === mdrPregnancyNormalizeName(mare.name);
  const sameVersion =
    String(pairing.pregnancy_source_game_version || mdrGameWorld(mare,'DE')).toUpperCase() ===
    mdrGameWorld(mare,'DE');

  if (!sameName || !sameVersion) return false;

  const pairingExternal = String(pairing.pregnancy_source_external_id || '').trim();
  const mareExternal = String(mare.external_id || '').trim();
  if (pairingExternal && mareExternal) return pairingExternal === mareExternal;

  const pairingId = String(pairing.pregnancy_source_horse_id || '').trim();
  const mareId = String(mare.id || '').trim();
  if (pairingId && mareId) return pairingId === mareId;

  // Für ältere Auto-Einträge ohne gespeicherte technische ID reichen Name
  // + Spielversion als Fallback. Dadurch bleiben DE/EN gleichnamige Pferde
  // getrennt.
  return true;
}

function mdrPregnancyActiveAutoPairing(pairing, mare) {
  return (
    pairing?.pregnancy_auto === true &&
    mdrPregnancyIsSameMare(pairing, mare) &&
    pairing?.foal_horse_id == null &&
    pairing?.foal_reference_id == null &&
    (!pairing?.pairing_date || String(pairing.pairing_date) >= mdrPregnancyLocalTodayIso())
  );
}

async function syncPregnancyPairingFromSavedHorse(mare, pregnancy, sessionUserId = null) {
  if (!mare || !pregnancy?.detected_from_profile) {
    return { action: 'none', reason: 'no-current-profile-pregnancy' };
  }
  if (String(mare.gender || '').toLowerCase() !== 'stute' || pregnancy.is_pregnant !== true) {
    return { action: 'none', reason: 'not-currently-pregnant-mare' };
  }
  if (!pregnancy.sire_name || !pregnancy.foaling_date) {
    return {
      action: 'incomplete',
      reason: 'missing-sire-or-date',
      sire: pregnancy.sire_name || null,
      foaling_date: pregnancy.foaling_date || null,
    };
  }

  const horses = await localGetAll(LOCAL_STORES.horses);
  const stallion = mdrPregnancyFindStallion(horses, pregnancy.sire_name, mare);
  const deviations = stallion ? await mdrPregnancyEmpiricalDeviations(horses) : null;
  const prediction = stallion && typeof buildFoalPredictionSnapshot === 'function'
    ? buildFoalPredictionSnapshot(mare, stallion, deviations, 'tragende-stute-profil')
    : null;

  const pairings = await localGetAll(LOCAL_STORES.pairings);
  let existing = pairings.find((p) => mdrPregnancyExactNaturalMatch(p, mare, pregnancy)) || null;
  if (!existing) {
    existing = pairings.find((p) => mdrPregnancyActiveAutoPairing(p, mare)) || null;
  }

  const now = new Date().toISOString();
  const metadata = {
    owner: mare.owner || null,
    stallion: pregnancy.sire_name,
    mare: mare.name || null,
    pairing_date: pregnancy.foaling_date,
    pregnancy_auto: true,
    pregnancy_source_horse_id: mare.id ?? null,
    pregnancy_source_external_id: mare.external_id ?? null,
    pregnancy_source_game_version: mdrGameWorld(mare,'DE'),
    pregnancy_detected_at: now,
    expected_foal: {
      mare_id: mare.id ?? null,
      mare_name: mare.name || null,
      stallion_id: stallion?.id ?? null,
      stallion_name: pregnancy.sire_name,
      foaling_date: pregnancy.foaling_date,
      game_version: mdrGameWorld(mare,'DE'),
    },
  };

  if (existing) {
    const update = {
      ...metadata,
      prediction_snapshot: existing.prediction_snapshot || prediction,
      notes: existing.notes || '🤰 Automatisch aus „Tragend?/In foal?“ der Stute übernommen.',
      updated_at: now,
    };
    const updated = await localUpdate(LOCAL_STORES.pairings, existing.id, update);
    return {
      action: 'updated',
      pairing_id: existing.id,
      sire: pregnancy.sire_name,
      sire_found: !!stallion,
      foaling_date: pregnancy.foaling_date,
      prediction_created: !existing.prediction_snapshot && !!prediction,
      record: updated || { ...existing, ...update },
    };
  }

  const record = {
    user_id: sessionUserId || mare.user_id || null,
    ...metadata,
    keep_foal: null,
    notes: '🤰 Automatisch aus „Tragend?/In foal?“ der Stute übernommen.',
    prediction_snapshot: prediction,
    created_at: now,
    updated_at: now,
  };
  const id = await localAdd(LOCAL_STORES.pairings, record);
  return {
    action: 'created',
    pairing_id: id,
    sire: pregnancy.sire_name,
    sire_found: !!stallion,
    foaling_date: pregnancy.foaling_date,
    prediction_created: !!prediction,
    record: { ...record, id },
  };
}


// V54.0.65 – Ein in der normalen Pferdedatenbank gespeichertes Fohlen
// automatisch mit dem Verpaarungslog verbinden. Es wird nur ein wirklich
// sicherer Treffer verwendet: Vater + Mutter aus dem Stammbaum UND das
// gespeicherte Abfohldatum müssen zum Geburtstag des Fohlens passen.
// Dadurch entstehen keine heuristischen Fehlverknüpfungen bei wiederholten
// Verpaarungen derselben Eltern. Die Suche läuft auf dem lokalen/delta-
// gecachten Pairing-Store; bei Treffer wird genau ein kleiner Pairing-
// Datensatz aktualisiert.
function mdrFoalParentNames(horse) {
  const ancestors = Array.isArray(horse?.pedigree)
    ? horse.pedigree.slice(1)
    : (horse?.pedigree?.ancestors || []);
  return {
    sire: String(ancestors[0]?.name || '').trim(),
    dam: String(ancestors[1]?.name || '').trim(),
  };
}

function mdrFoalExactPairingMatch(pairing, horse, parents) {
  if (!pairing || !horse || !parents?.sire || !parents?.dam || !horse.birthdate) return false;
  return (
    mdrPregnancyNormalizeName(pairing.stallion) === mdrPregnancyNormalizeName(parents.sire) &&
    mdrPregnancyNormalizeName(pairing.mare) === mdrPregnancyNormalizeName(parents.dam) &&
    String(pairing.pairing_date || '').slice(0, 10) === String(horse.birthdate || '').slice(0, 10)
  );
}

function mdrFoalLooksYoung(horse) {
  const gender = String(horse?.gender || '').toLowerCase();
  if (/fohlen|foal|colt|filly/.test(gender)) return true;
  const raw = String(horse?.birthdate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const birth = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return false;
  const days = (Date.now() - birth.getTime()) / 86400000;
  // MDR altert deutlich schneller als Echtzeit; dieser großzügige Bereich
  // deckt junge Fohlen ab, ohne bei jedem beliebigen Altpferd den Pairing-
  // Store anzufragen.
  return days >= -2 && days <= 75;
}

async function syncFoalPairingFromSavedHorse(horse, sessionUserId = null) {
  const parents = mdrFoalParentNames(horse);
  if (!horse?.id || !horse?.birthdate || !parents.sire || !parents.dam) {
    return { action: 'none', reason: 'missing-id-birthdate-or-parents' };
  }
  if (!mdrFoalLooksYoung(horse)) {
    return { action: 'none', reason: 'not-young-foal' };
  }

  const pairings = await localGetAll(LOCAL_STORES.pairings);
  const matches = (pairings || []).filter((pairing) => mdrFoalExactPairingMatch(pairing, horse, parents));
  if (matches.length > 1) {
    return { action: 'none', reason: 'ambiguous-exact-pairing', matches: matches.length };
  }

  const actualSnapshot = typeof foalActualMetricSnapshot === 'function'
    ? {
        name: horse.name || null,
        ...foalActualMetricSnapshot(horse),
        captured_at: new Date().toISOString(),
      }
    : null;
  const now = new Date().toISOString();

  if (matches.length === 1) {
    const pairing = matches[0];
    if (pairing.foal_horse_id != null && String(pairing.foal_horse_id) !== String(horse.id)) {
      return {
        action: 'none',
        reason: 'pairing-already-linked-to-other-horse',
        pairing_id: pairing.id,
      };
    }

    const oldReferenceId = pairing.foal_reference_id ?? null;
    await localUpdate(LOCAL_STORES.pairings, pairing.id, {
      prediction_snapshot: pairing.prediction_snapshot || null,
      foal_horse_id: horse.id,
      foal_reference_id: null,
      foal_name: horse.name || null,
      actual_foal_snapshot: actualSnapshot,
      foal_recorded_at: pairing.foal_recorded_at || now,
      updated_at: now,
    });

    // Ein alter Referenzdatensatz aus früheren Versionen ist nach der echten
    // Pferde-Verknüpfung redundant und würde sonst in Lernstatistiken doppelt
    // zählen. Nur den direkt an dieser Verpaarung hängenden Datensatz löschen.
    if (oldReferenceId != null) {
      await localDelete(LOCAL_STORES.foalReferenceData, oldReferenceId).catch(() => {});
    }

    return {
      action: 'linked',
      pairing_id: pairing.id,
      foal_horse_id: horse.id,
      foal_name: horse.name || null,
      sire: parents.sire,
      mare: parents.dam,
      birthdate: horse.birthdate,
      removed_reference_id: oldReferenceId,
    };
  }

  // Gibt es noch keinen Log-Eintrag, darf ein Fohlen aus dem eigenen/
  // aktiv gepflegten Zuchtbestand den Verpaarungslog automatisch ergänzen.
  // Fremde junge Pferde, die nur als Referenz in die große Datenbank
  // aufgenommen werden, erzeugen dagegen bewusst KEINE Verpaarungen.
  const activeOwner = typeof isActiveBreeder === 'function' && isActiveBreeder(horse.owner);
  if (!activeOwner) {
    return { action: 'none', reason: 'no-exact-pairing-and-owner-not-active' };
  }

  const record = {
    user_id: sessionUserId || horse.user_id || null,
    owner: horse.owner || null,
    stallion: parents.sire,
    mare: parents.dam,
    pairing_date: String(horse.birthdate).slice(0, 10),
    keep_foal: null,
    notes: '🐴 Automatisch aus gespeichertem Fohlen übernommen.',
    prediction_snapshot: null,
    foal_horse_id: horse.id,
    foal_reference_id: null,
    foal_name: horse.name || null,
    actual_foal_snapshot: actualSnapshot,
    foal_recorded_at: now,
    created_at: now,
    updated_at: now,
  };
  const id = await localAdd(LOCAL_STORES.pairings, record);
  return {
    action: 'created',
    pairing_id: id,
    foal_horse_id: horse.id,
    foal_name: horse.name || null,
    sire: parents.sire,
    mare: parents.dam,
    birthdate: horse.birthdate,
  };
}
