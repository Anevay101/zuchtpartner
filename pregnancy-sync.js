function mdrPregnancyNormalizeName(value) {
  return String(value || '').trim().toLocaleLowerCase('de');
}

function mdrPregnancyLocalTodayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function mdrPregnancySameGameVersion(a, b) {
  return String(a?.game_version || 'DE').toUpperCase() === String(b?.game_version || 'DE').toUpperCase();
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
  return !storedVersion || storedVersion === String(mare?.game_version || 'DE').toUpperCase();
}

function mdrPregnancyIsSameMare(pairing, mare) {
  if (!pairing || !mare) return false;

  const sameName =
    mdrPregnancyNormalizeName(pairing.mare) === mdrPregnancyNormalizeName(mare.name);
  const sameVersion =
    String(pairing.pregnancy_source_game_version || mare.game_version || 'DE').toUpperCase() ===
    String(mare.game_version || 'DE').toUpperCase();

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
    pregnancy_source_game_version: mare.game_version || 'DE',
    pregnancy_detected_at: now,
    expected_foal: {
      mare_id: mare.id ?? null,
      mare_name: mare.name || null,
      stallion_id: stallion?.id ?? null,
      stallion_name: pregnancy.sire_name,
      foaling_date: pregnancy.foaling_date,
      game_version: mare.game_version || 'DE',
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
