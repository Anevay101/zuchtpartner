// V53.6 – Lerndatei: Pferde bleiben in der Datenbank und in Lernmodellen,
// werden aber aus operativen Zucht-/Turnier-/Dashboard-Listen ausgeblendet.
const MDR_LEARNING_FILE_SEED_KEY = 'learning_file_seed_v536';
// V54.0.7: reguläre Besitzer bleiben regulär; Besitzerkennungen „(GBH)“ oder „(Friedhof)“ erzwingen die Lerndatei.

function mdrLearningNorm(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');
}

function mdrHorseTagLabelsForLearning(horse) {
  try {
    if (typeof effectiveHorseTags === 'function') {
      return effectiveHorseTags(horse?.tags, horse?.birthdate)
        .map(t => typeof t === 'string' ? t : t?.label)
        .filter(Boolean);
    }
  } catch {}
  return (horse?.tags || []).map(t => typeof t === 'string' ? t : t?.label).filter(Boolean);
}

function mdrHasGbhTag(horse) {
  return mdrHorseTagLabelsForLearning(horse).some(label => mdrLearningNorm(label) === 'gbh');
}

function mdrOwnerHasLearningMarker(horse) {
  if (!horse || typeof horse !== 'object') return false;
  const candidates = [horse.owner, horse.learning_original_owner];
  return candidates.some(value => /\(\s*(?:gbh|friedhof)\s*\)/i.test(String(value || '')));
}

// Rückwärtskompatibilität für ältere Aufrufer.
function mdrOwnerHasGbhMarker(horse) {
  return mdrOwnerHasLearningMarker(horse);
}

function mdrIsLearningHorse(horse) {
  return horse?.learning_file === true || mdrHasGbhTag(horse) || mdrOwnerHasLearningMarker(horse);
}

function mdrLearningSeedCandidate(horse) {
  // Historischer Kompatibilitäts-Hook: Seit V53.6.5 werden reguläre Pferde
  // niemals mehr allein wegen Besitzer/Geschlecht in die Lerndatei verschoben.
  return false;
}

function mdrApplyLearningOwner(payload, desired, previous = null) {
  if (!payload || typeof payload !== 'object') return payload;
  const previousOriginal = String(previous?.learning_original_owner || payload?.learning_original_owner || '').trim();
  const currentOwner = String(payload?.owner || '').trim();
  const previousOwner = String(previous?.owner || '').trim();

  if (desired) {
    const original = previousOriginal
      || (mdrLearningNorm(currentOwner) !== 'lerndatei' ? currentOwner : '')
      || (mdrLearningNorm(previousOwner) !== 'lerndatei' ? previousOwner : '');
    if (original) payload.learning_original_owner = original;
    payload.owner = 'Lerndatei';
    return payload;
  }

  if (mdrLearningNorm(currentOwner) === 'lerndatei' && previousOriginal) {
    payload.owner = previousOriginal;
  }
  delete payload.learning_original_owner;
  return payload;
}

async function mdrEnsureLearningFileRules() {
  if (typeof localGetAll !== 'function' || typeof LOCAL_STORES === 'undefined') return { changed: 0, seeded: false };

  const horses = await localGetAll(LOCAL_STORES.horses);
  const marker = await localGet(LOCAL_STORES.userSettings, MDR_LEARNING_FILE_SEED_KEY).catch(() => null);
  const shouldWriteMarker = !marker && horses.length > 0;
  let changed = 0;

  for (const horse of horses) {
    const desired = horse?.learning_file === true || mdrHasGbhTag(horse) || mdrOwnerHasLearningMarker(horse);
    const updated = { ...horse, learning_file: desired };
    mdrApplyLearningOwner(updated, desired, horse);

    const learningChanged = desired !== (horse?.learning_file === true);
    const ownerChanged = String(updated.owner || '') !== String(horse.owner || '');
    const originalOwnerChanged = String(updated.learning_original_owner || '') !== String(horse.learning_original_owner || '');
    if (!learningChanged && !ownerChanged && !originalOwnerChanged) continue;

    updated.updated_at = horse.updated_at || new Date().toISOString();
    await localPut(LOCAL_STORES.horses, updated);
    changed++;
  }

  if (shouldWriteMarker) {
    await localPut(LOCAL_STORES.userSettings, {
      key: MDR_LEARNING_FILE_SEED_KEY,
      completed_at: new Date().toISOString(),
      rule: 'V54.0.7: vorhandene Lerndatei-Markierung beibehalten; GBH-Schlagwort oder Besitzerkennung (GBH)/(Friedhof) immer Lerndatei; Besitzer von Lerndatei-Pferden = Lerndatei',
    });
  }
  return { changed, seeded: false };
}

function mdrLearningFileForSave(payload, previous = null) {
  if (!payload || typeof payload !== 'object') return payload;
  const forcedLearning = mdrHasGbhTag(payload)
    || mdrOwnerHasLearningMarker(payload)
    || mdrOwnerHasLearningMarker(previous);
  if (forcedLearning) payload.learning_file = true;
  else payload.learning_file = payload.learning_file === true;
  mdrApplyLearningOwner(payload, payload.learning_file === true, previous);
  return payload;
}
