// V36 – gemeinsame Fohlen-Prognose-Snapshots für Zuchtplaner + Verpaarungslog.
//
// Die theoretischen Best-/Worst-Cases und die Datenbank-Schätzung werden
// beim Anlegen einer Verpaarung als Snapshot gespeichert. So bleibt später
// nachvollziehbar, was VOR der Geburt tatsächlich prognostiziert wurde,
// selbst wenn Elterndaten oder Berechnungslogik später geändert werden.

const FOAL_PREDICTION_METRICS = [
  { key: 'gp', label: 'GP', decimals: 0 },
  { key: 'ext', label: 'Ext', decimals: 2 },
  { key: 'extPct', label: 'Ext%', decimals: 1, suffix: '%' },
  { key: 'int', label: 'Int', decimals: 2 },
];

function foalPredictionNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function foalActualMetricSnapshot(horse) {
  if (!horse) return { gp: null, ext: null, extPct: null, int: null };
  return {
    gp: foalPredictionNumber(typeof horseGP === 'function' ? horseGP(horse) : horse?.tournament_potential?.['Gesamtpotenzial']),
    ext: foalPredictionNumber(typeof horseExt === 'function' ? horseExt(horse) : null),
    extPct: foalPredictionNumber(typeof horseExtPct === 'function' ? horseExtPct(horse) : horse?.exterior_genetics?.overall?.percent),
    int: foalPredictionNumber(typeof horseInt === 'function' ? horseInt(horse) : null),
  };
}

function foalPredictionEmpiricalRange(snapshotOrEstimate, empiricalDeviations) {
  const range = {};
  for (const { key } of FOAL_PREDICTION_METRICS) {
    const estimate = foalPredictionNumber(
      snapshotOrEstimate?.database?.[key] ?? snapshotOrEstimate?.[key]
    );
    const stats = empiricalDeviations?.[key];
    const lowOffset = foalPredictionNumber(stats?.typicalLowOffset);
    const highOffset = foalPredictionNumber(stats?.typicalHighOffset);

    range[key] = {
      low: estimate == null || lowOffset == null ? null : estimate + lowOffset,
      high: estimate == null || highOffset == null ? null : estimate + highOffset,
      coverage: Number(stats?.typicalCoverage || 0) || null,
      n: Number(stats?.n || 0),
    };
  }
  return range;
}

function enrichFoalPredictionSnapshotWithEmpiricalRange(snapshot, empiricalDeviations, source = 'nachtraeglich-v51') {
  if (!snapshot || snapshot.database_range) return snapshot;
  return {
    ...snapshot,
    database_range: foalPredictionEmpiricalRange(snapshot, empiricalDeviations),
    database_range_source: source,
    database_range_created_at: new Date().toISOString(),
  };
}

function buildFoalPredictionSnapshot(mare, stallion, empiricalDeviations, source = 'verpaarung') {
  if (!mare || !stallion) return null;

  const ext = typeof exteriorFoalRange === 'function'
    ? exteriorFoalRange(mare, stallion)
    : { extBest: null, extWorst: null, extPctBest: null, extPctWorst: null };
  const intR = typeof interieurFoalRange === 'function'
    ? interieurFoalRange(mare, stallion)
    : { intBest: null, intWorst: null };
  const gp = typeof estimateFoalGP === 'function'
    ? estimateFoalGP(mare, stallion)
    : { gpBest: null, gpWorst: null };
  const db = empiricalDeviations && typeof estimateFoalEmpirical === 'function'
    ? estimateFoalEmpirical(mare, stallion, empiricalDeviations)
    : { gp: null, ext: null, extPct: null, int: null };

  const databaseRange = foalPredictionEmpiricalRange(db, empiricalDeviations);

  return {
    version: 2,
    created_at: new Date().toISOString(),
    source,
    mare_id: mare.id ?? null,
    mare_name: mare.name || null,
    stallion_id: stallion.id ?? null,
    stallion_name: stallion.name || null,
    best: {
      gp: foalPredictionNumber(gp.gpBest),
      ext: foalPredictionNumber(ext.extBest),
      extPct: foalPredictionNumber(ext.extPctBest),
      int: foalPredictionNumber(intR.intBest),
    },
    database: {
      gp: foalPredictionNumber(db.gp),
      ext: foalPredictionNumber(db.ext),
      extPct: foalPredictionNumber(db.extPct),
      int: foalPredictionNumber(db.int),
    },
    database_range: databaseRange,
    database_range_source: 'prediction-time-v51',
    worst: {
      gp: foalPredictionNumber(gp.gpWorst),
      ext: foalPredictionNumber(ext.extWorst),
      extPct: foalPredictionNumber(ext.extPctWorst),
      int: foalPredictionNumber(intR.intWorst),
    },
    sample_sizes: Object.fromEntries(
      ['gp', 'ext', 'extPct', 'int'].map((key) => [
        key,
        Number(empiricalDeviations?.[key]?.n || 0),
      ])
    ),
  };
}

function compareFoalPrediction(snapshot, actual) {
  if (!snapshot || !actual) return [];
  return FOAL_PREDICTION_METRICS.map((metric) => {
    const key = metric.key;
    const best = foalPredictionNumber(snapshot.best?.[key]);
    const estimate = foalPredictionNumber(snapshot.database?.[key]);
    const worst = foalPredictionNumber(snapshot.worst?.[key]);
    const actualValue = foalPredictionNumber(actual?.[key]);
    const low = best == null || worst == null ? null : Math.min(best, worst);
    const high = best == null || worst == null ? null : Math.max(best, worst);
    const withinRange = actualValue == null || low == null || high == null
      ? null
      : actualValue >= low - 1e-9 && actualValue <= high + 1e-9;

    const dbLow = foalPredictionNumber(snapshot.database_range?.[key]?.low);
    const dbHigh = foalPredictionNumber(snapshot.database_range?.[key]?.high);
    const withinDatabaseRange = actualValue == null || dbLow == null || dbHigh == null
      ? null
      : actualValue >= Math.min(dbLow, dbHigh) - 1e-9 &&
        actualValue <= Math.max(dbLow, dbHigh) + 1e-9;

    return {
      ...metric,
      best,
      estimate,
      worst,
      actual: actualValue,
      diff: estimate == null || actualValue == null ? null : actualValue - estimate,
      absDiff: estimate == null || actualValue == null ? null : Math.abs(actualValue - estimate),
      withinRange,
      databaseLow: dbLow,
      databaseHigh: dbHigh,
      withinDatabaseRange,
      databaseCoverage: Number(snapshot.database_range?.[key]?.coverage || 0) || null,
      sampleSize: Number(snapshot.sample_sizes?.[key] || snapshot.database_range?.[key]?.n || 0),
    };
  });
}

function foalPredictionHasAnyValue(snapshot) {
  if (!snapshot) return false;
  return ['best', 'database', 'worst'].some((group) =>
    FOAL_PREDICTION_METRICS.some(({ key }) => foalPredictionNumber(snapshot?.[group]?.[key]) != null)
  );
}
