// V53.6.6 – Elternvergleich, Geschwister-Bestwerte und Nachzuchtbilanz.
// Reine Auswertungslogik auf Basis der bereits lokal gespeicherten Pferde.

const BP_METRICS = [
  { key:'gp', label:'GP', decimals:0, higherBetter:true, suffix:'' },
  { key:'ext', label:'Ext', decimals:2, higherBetter:false, suffix:'' },
  { key:'extPct', label:'Ext%', decimals:1, higherBetter:true, suffix:' %' },
  { key:'int', label:'Int', decimals:2, higherBetter:false, suffix:'' },
];

function bpNorm(value) {
  return String(value ?? '').trim().replace(/\s+/g,' ').toLocaleLowerCase('de');
}

function bpEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function bpNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function bpMetricSnapshot(horse) {
  if (!horse) return { gp:null, ext:null, extPct:null, int:null };
  const gp = bpNumber(horse?.tournament_potential?.['Gesamtpotenzial']);
  const ext = typeof averageScore === 'function' && typeof scoreExteriorTerm === 'function'
    ? bpNumber(averageScore(horse?.exterior_descriptive, scoreExteriorTerm))
    : null;
  const extPct = bpNumber(horse?.exterior_genetics?.overall?.percent);
  const int = typeof averageScore === 'function' && typeof scoreTemperamentTerm === 'function'
    ? bpNumber(averageScore(horse?.temperament, scoreTemperamentTerm))
    : null;
  return { gp, ext, extPct, int };
}

function bpParentNames(horse) {
  const pedigree = horse?.pedigree;
  if (Array.isArray(pedigree)) {
    const rows = pedigree.slice(1).map(x => typeof x === 'string' ? x : x?.name).filter(Boolean);
    return { fatherName:rows[0] || null, motherName:rows[1] || null };
  }
  const rows = (pedigree?.ancestors || []).map(x => typeof x === 'string' ? x : x?.name).filter(Boolean);
  return { fatherName:rows[0] || null, motherName:rows[1] || null };
}

function bpSexKind(horse) {
  const gender = String(horse?.gender || '').trim().toLowerCase();
  if (/stute|stutfohlen|mare|filly|female/.test(gender)) return 'female';
  if (/hengst|hengstfohlen|wallach|stallion|colt|gelding|male/.test(gender)) return 'male';
  return 'unknown';
}

function bpGenderProfile(horse) {
  const kind = bpSexKind(horse);
  if (kind === 'female') return { kind, label:'Stute', greenGpDelta:5 };
  if (kind === 'male') return { kind, label:'Hengst', greenGpDelta:10 };
  return { kind:'unknown', label:'Geschlecht offen', greenGpDelta:10 };
}

function bpBuildContext(horses) {
  const list = Array.isArray(horses) ? horses : [];
  const byName = new Map();
  const byId = new Map();
  const sonsByFather = new Map();
  const daughtersByMother = new Map();
  const childrenByParent = new Map();

  for (const horse of list) {
    const nameKey = bpNorm(horse?.name);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, horse);
    if (horse?.id != null) byId.set(String(horse.id), horse);
  }

  const add = (map, key, horse) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(horse);
  };

  for (const horse of list) {
    const { fatherName, motherName } = bpParentNames(horse);
    const fatherKey = bpNorm(fatherName);
    const motherKey = bpNorm(motherName);
    if (fatherKey) add(childrenByParent, fatherKey, horse);
    if (motherKey) add(childrenByParent, motherKey, horse);
    const sex = bpSexKind(horse);
    if (sex === 'male' && fatherKey) add(sonsByFather, fatherKey, horse);
    if (sex === 'female' && motherKey) add(daughtersByMother, motherKey, horse);
  }

  return { horses:list, byName, byId, sonsByFather, daughtersByMother, childrenByParent };
}

function bpResolveParents(horse, context) {
  const { fatherName, motherName } = bpParentNames(horse);
  return {
    fatherName,
    motherName,
    father: context?.byName?.get(bpNorm(fatherName)) || null,
    mother: context?.byName?.get(bpNorm(motherName)) || null,
  };
}

function bpMetricImprovement(childValue, referenceValue, metric) {
  if (childValue == null || referenceValue == null) return null;
  return metric.higherBetter
    ? Number(childValue) - Number(referenceValue)
    : Number(referenceValue) - Number(childValue);
}

function bpRounded(value, decimals) {
  if (value == null) return null;
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}

function bpMetricStatus(childValue, parentValue, metric) {
  if (childValue == null || parentValue == null) return 'missing';
  const childRounded = bpRounded(childValue, metric.decimals);
  const parentRounded = bpRounded(parentValue, metric.decimals);
  if (childRounded === parentRounded) return 'equal';
  const better = metric.higherBetter ? childRounded > parentRounded : childRounded < parentRounded;
  return better ? 'better' : 'worse';
}

function bpBestFoalInfo(horse, context) {
  const sex = bpSexKind(horse);
  const { fatherName, motherName } = bpParentNames(horse);
  const sameParentName = sex === 'male' ? fatherName : sex === 'female' ? motherName : null;
  const sameParent = sex === 'male'
    ? context?.byName?.get(bpNorm(fatherName)) || null
    : sex === 'female'
      ? context?.byName?.get(bpNorm(motherName)) || null
      : null;
  const siblings = sex === 'male'
    ? (context?.sonsByFather?.get(bpNorm(fatherName)) || [])
    : sex === 'female'
      ? (context?.daughtersByMother?.get(bpNorm(motherName)) || [])
      : [];
  const own = bpMetricSnapshot(horse);
  const parentMetrics = bpMetricSnapshot(sameParent);
  const best = {};
  const status = {};
  const comparableCounts = {};

  for (const metric of BP_METRICS) {
    const candidates = siblings
      .map(row => ({ row, value:bpMetricSnapshot(row)[metric.key] }))
      .filter(item => item.value != null);
    comparableCounts[metric.key] = candidates.length;
    if (own[metric.key] == null || candidates.length < 2) {
      best[metric.key] = false;
    } else {
      const target = metric.higherBetter
        ? Math.max(...candidates.map(x => Number(x.value)))
        : Math.min(...candidates.map(x => Number(x.value)));
      best[metric.key] = bpRounded(own[metric.key], metric.decimals) === bpRounded(target, metric.decimals);
    }
    status[metric.key] = bpMetricStatus(own[metric.key], parentMetrics[metric.key], metric);
  }

  return {
    sex,
    sameParentName,
    sameParent,
    siblings,
    best,
    status,
    comparableCounts,
    anyBest: BP_METRICS.some(metric => best[metric.key]),
  };
}

// Variante B: dieselben Grenzen wie im Verpaarungs-Log.
function bpEvaluateParentAverage(horse, father, mother) {
  if (!horse || !father || !mother) {
    return { level:'partial', label:'Noch nicht vollständig bewertbar', reasons:['Beide Eltern müssen in der Datenbank vorhanden sein.'], evaluated:0, gpDelta:null, gender:bpGenderProfile(horse) };
  }
  const actual = bpMetricSnapshot(horse);
  const a = bpMetricSnapshot(father);
  const b = bpMetricSnapshot(mother);
  const average = {};
  for (const metric of BP_METRICS) {
    average[metric.key] = a[metric.key] == null || b[metric.key] == null
      ? null
      : (Number(a[metric.key]) + Number(b[metric.key])) / 2;
  }

  const gender = bpGenderProfile(horse);
  const severe = [];
  const minor = [];
  const missing = [];
  let evaluated = 0;
  let gpDelta = null;

  if (actual.gp != null && average.gp != null) {
    evaluated++;
    gpDelta = Number(actual.gp) - Number(average.gp);
    if (gpDelta < -1e-9) severe.push(`GP ${Math.abs(gpDelta).toFixed(1)} Punkte unter Elternmittel`);
  } else missing.push('GP');

  if (actual.extPct != null && average.extPct != null) {
    evaluated++;
    const worse = Number(average.extPct) - Number(actual.extPct);
    if (worse >= 3 - 1e-9) severe.push(`Ext% ${worse.toFixed(1)} Prozentpunkte unter Elternmittel`);
    else if (worse > 1e-9) minor.push(`Ext% ${worse.toFixed(1)} Prozentpunkte unter Elternmittel`);
  } else missing.push('Ext%');

  if (actual.ext != null && average.ext != null) {
    evaluated++;
    const worse = Number(actual.ext) - Number(average.ext);
    if (worse > 0.60 + 1e-9) severe.push(`Ext ${worse.toFixed(2)} Punkte deutlich schlechter als Elternmittel`);
    else if (worse > 0.30 + 1e-9) minor.push(`Ext ${worse.toFixed(2)} Punkte schlechter als Elternmittel`);
  } else missing.push('Ext');

  if (actual.int != null && average.int != null) {
    evaluated++;
    const worse = Number(actual.int) - Number(average.int);
    if (worse > 0.80 + 1e-9) severe.push(`Int ${worse.toFixed(2)} Punkte deutlich schlechter als Elternmittel`);
    else if (worse > 0.40 + 1e-9) minor.push(`Int ${worse.toFixed(2)} Punkte schlechter als Elternmittel`);
  } else missing.push('Int');

  if (severe.length) return { level:'cull', label:'Rückschritt', reasons:[...severe,...minor], evaluated, gpDelta, gender, average, actual };
  if (gpDelta == null || gender.kind === 'unknown' || missing.length) {
    const reasons = [];
    if (gender.kind === 'unknown') reasons.push('Geschlecht nicht eindeutig');
    if (missing.length) reasons.push(`Fehlende Vergleichswerte: ${missing.join(', ')}`);
    reasons.push(...minor);
    return { level:'partial', label:'Noch nicht vollständig bewertbar', reasons, evaluated, gpDelta, gender, average, actual };
  }
  const belowGreen = gpDelta + 1e-9 < gender.greenGpDelta;
  if (belowGreen || minor.length) {
    const reasons = [];
    if (belowGreen) reasons.push(`${gender.label}: GP +${gpDelta.toFixed(1)}; klare Verbesserung beginnt bei +${gender.greenGpDelta}`);
    reasons.push(...minor);
    return { level:'check', label:'Gemischt / prüfen', reasons, evaluated, gpDelta, gender, average, actual };
  }
  return { level:'keep', label:'Klare Verbesserung', reasons:[`${gender.label}: GP +${gpDelta.toFixed(1)} gegenüber Elternmittel; keine relevante Ext/Ext%/Int-Verschlechterung.`], evaluated, gpDelta, gender, average, actual };
}

function bpFormatMetric(value, metric) {
  if (value == null) return '–';
  const n = Number(value);
  return `${n.toFixed(metric.decimals)}${metric.suffix}`;
}

function bpFormatImprovement(delta, metric) {
  if (delta == null) return '–';
  const abs = Math.abs(Number(delta));
  if (Math.abs(delta) < 10 ** (-(metric.decimals + 2))) return 'gleichauf';
  if (metric.key === 'gp') return delta > 0 ? `+${abs.toFixed(1)}` : `−${abs.toFixed(1)}`;
  if (metric.key === 'extPct') return delta > 0 ? `+${abs.toFixed(1)} %-Pkt.` : `−${abs.toFixed(1)} %-Pkt.`;
  return `${abs.toFixed(metric.decimals)} ${delta > 0 ? 'besser' : 'schlechter'}`;
}

function bpStatusDotHtml(status, title='') {
  if (!status || status === 'missing') return '';
  const labels = { better:'besser', equal:'gleichauf', worse:'schlechter' };
  return `<span class="bp-parent-dot bp-parent-${status}" title="${bpEsc(title || labels[status] || '')}" aria-label="${bpEsc(labels[status] || '')}"></span>`;
}

function bpOverviewMetricMarker(info, metricKey) {
  if (!info || !info.sameParentName) return '';
  const metric = BP_METRICS.find(m => m.key === metricKey);
  const status = info.status?.[metricKey] || 'missing';
  const parentLabel = info.sex === 'male' ? 'Vater' : info.sex === 'female' ? 'Mutter' : 'gleichgeschlechtlicher Elternteil';
  const title = status === 'missing'
    ? ''
    : `${metric?.label || metricKey}: ${status === 'better' ? 'besser als' : status === 'equal' ? 'gleichauf mit' : 'schlechter als'} ${parentLabel}`;
  const star = info.best?.[metricKey]
    ? `<span class="bp-best-star" title="Bestes vergleichbares Fohlen in dieser Geschwistergruppe">★</span>`
    : '';
  return `${bpStatusDotHtml(status,title)}${star}`;
}

function bpAssessmentBadge(rec) {
  const cls = rec?.level === 'keep' ? 'bp-assessment-good'
    : rec?.level === 'check' ? 'bp-assessment-check'
      : rec?.level === 'cull' ? 'bp-assessment-bad' : 'bp-assessment-open';
  const title = (rec?.reasons || []).join(' · ');
  return `<span class="bp-assessment ${cls}" title="${bpEsc(title)}">${bpEsc(rec?.label || 'Noch nicht bewertbar')}</span>`;
}

function bpFindChildren(parentHorse, context, pairings=[]) {
  const parentKey = bpNorm(parentHorse?.name);
  const found = new Map();
  for (const child of context?.childrenByParent?.get(parentKey) || []) {
    if (child?.id != null) found.set(String(child.id), child);
    else if (child?.name) found.set(`name:${bpNorm(child.name)}`, child);
  }
  for (const pairing of pairings || []) {
    const isParent = bpNorm(pairing?.stallion) === parentKey || bpNorm(pairing?.mare) === parentKey;
    if (!isParent) continue;
    let child = pairing?.foal_horse_id != null ? context?.byId?.get(String(pairing.foal_horse_id)) : null;
    if (!child && pairing?.foal_name) child = context?.byName?.get(bpNorm(pairing.foal_name)) || null;
    if (!child) continue;
    if (child?.id != null) found.set(String(child.id), child);
    else if (child?.name) found.set(`name:${bpNorm(child.name)}`, child);
  }
  return [...found.values()].filter(child => String(child?.id) !== String(parentHorse?.id));
}

function bpPairingParentNamesForChild(child, pairings) {
  const id = child?.id != null ? String(child.id) : null;
  const name = bpNorm(child?.name);
  const pairing = (pairings || []).find(p =>
    (id && p?.foal_horse_id != null && String(p.foal_horse_id) === id) ||
    (name && bpNorm(p?.foal_name) === name)
  );
  return pairing ? { fatherName:pairing.stallion || null, motherName:pairing.mare || null } : null;
}

function bpResolveChildParents(child, context, pairings=[]) {
  let names = bpParentNames(child);
  if (!names.fatherName || !names.motherName) {
    const fallback = bpPairingParentNamesForChild(child, pairings);
    names = {
      fatherName:names.fatherName || fallback?.fatherName || null,
      motherName:names.motherName || fallback?.motherName || null,
    };
  }
  return {
    ...names,
    father:context?.byName?.get(bpNorm(names.fatherName)) || null,
    mother:context?.byName?.get(bpNorm(names.motherName)) || null,
  };
}

function bpOffspringAnalysis(parentHorse, context, pairings=[]) {
  const children = bpFindChildren(parentHorse, context, pairings);
  const rows = children.map(child => {
    const parents = bpResolveChildParents(child, context, pairings);
    const rec = bpEvaluateParentAverage(child, parents.father, parents.mother);
    const childMetrics = bpMetricSnapshot(child);
    const fatherMetrics = bpMetricSnapshot(parents.father);
    const motherMetrics = bpMetricSnapshot(parents.mother);
    const improvements = {};
    for (const metric of BP_METRICS) {
      const f = fatherMetrics[metric.key];
      const m = motherMetrics[metric.key];
      const avg = f == null || m == null ? null : (Number(f)+Number(m))/2;
      improvements[metric.key] = bpMetricImprovement(childMetrics[metric.key], avg, metric);
    }
    return { child, parents, rec, improvements };
  });

  const evaluable = rows.filter(row => ['keep','check','cull'].includes(row.rec.level));
  const partial = rows.filter(row => row.rec.level === 'partial');
  const counts = {
    keep:evaluable.filter(row => row.rec.level === 'keep').length,
    check:evaluable.filter(row => row.rec.level === 'check').length,
    cull:evaluable.filter(row => row.rec.level === 'cull').length,
    partial:partial.length,
    open:partial.filter(row => Number(row.rec?.evaluated || 0) === 0).length,
    partialSome:partial.filter(row => Number(row.rec?.evaluated || 0) > 0).length,
  };
  const averages = {};
  const best = {};
  for (const metric of BP_METRICS) {
    const available = rows.filter(row => row.improvements[metric.key] != null);
    averages[metric.key] = available.length
      ? available.reduce((sum,row)=>sum+Number(row.improvements[metric.key]),0)/available.length
      : null;
    best[metric.key] = available.length
      ? available.reduce((a,b)=>Number(b.improvements[metric.key]) > Number(a.improvements[metric.key]) ? b : a)
      : null;
  }
  return { children, rows, evaluable, counts, averages, best };
}

function bpHorseLink(horse) {
  if (!horse) return '–';
  if (horse.id == null) return bpEsc(horse.name || '–');
  return `<a href="view.html?id=${encodeURIComponent(horse.id)}">${bpEsc(horse.name || '(ohne Name)')}</a>`;
}

function bpRenderOwnProgress(horse, context) {
  const parents = bpResolveParents(horse, context);
  const rec = bpEvaluateParentAverage(horse, parents.father, parents.mother);
  const own = bpMetricSnapshot(horse);
  const father = bpMetricSnapshot(parents.father);
  const mother = bpMetricSnapshot(parents.mother);
  const avg = {};
  for (const metric of BP_METRICS) {
    avg[metric.key] = father[metric.key] == null || mother[metric.key] == null
      ? null : (Number(father[metric.key]) + Number(mother[metric.key])) / 2;
  }
  const bestInfo = bpBestFoalInfo(horse, context);
  const sameParentMetrics = bpMetricSnapshot(bestInfo.sameParent);
  const sameLabel = bestInfo.sex === 'male' ? 'zum Vater' : bestInfo.sex === 'female' ? 'zur Mutter' : 'zum gleichgeschlechtlichen Elternteil';
  const bestLabels = BP_METRICS.filter(metric => bestInfo.best[metric.key]).map(metric => metric.label);
  const groupLabel = bestInfo.sex === 'male' ? 'Söhne desselben Vaters' : bestInfo.sex === 'female' ? 'Töchter derselben Mutter' : 'vergleichbare Fohlen';

  const rows = BP_METRICS.map(metric => {
    const vsAvg = bpMetricImprovement(own[metric.key], avg[metric.key], metric);
    const vsSame = bpMetricImprovement(own[metric.key], sameParentMetrics[metric.key], metric);
    return `<tr>
      <th>${metric.label}</th>
      <td>${bpFormatMetric(father[metric.key],metric)}</td>
      <td>${bpFormatMetric(mother[metric.key],metric)}</td>
      <td>${bpFormatMetric(avg[metric.key],metric)}</td>
      <td><strong>${bpFormatMetric(own[metric.key],metric)}</strong></td>
      <td>${bpFormatImprovement(vsAvg,metric)}</td>
      <td>${bpFormatImprovement(vsSame,metric)} ${bpStatusDotHtml(bestInfo.status[metric.key])}${bestInfo.best[metric.key] ? '<span class="bp-best-star" title="Bestes vergleichbares Fohlen">★</span>' : ''}</td>
    </tr>`;
  }).join('');

  const parentMissing = [parents.father ? null : parents.fatherName ? `Vater „${parents.fatherName}“ fehlt in der Datenbank` : 'Vater nicht im Stammbaum erkannt', parents.mother ? null : parents.motherName ? `Mutter „${parents.motherName}“ fehlt in der Datenbank` : 'Mutter nicht im Stammbaum erkannt'].filter(Boolean);

  const parentLine = `<div class="bp-parent-line small"><strong>Mutter:</strong> ${parents.mother ? bpHorseLink(parents.mother) : bpEsc(parents.motherName || '–')} <span class="muted">·</span> <strong>Vater:</strong> ${parents.father ? bpHorseLink(parents.father) : bpEsc(parents.fatherName || '–')}</div>`;

  return `<section class="card bp-section">
    <div class="bp-section-head"><div><h2>Eigener Zuchtfortschritt</h2><p class="small muted">Vergleich zum Mittelwert beider Eltern und zusätzlich zum Elternteil gleichen Geschlechts.</p></div>${bpAssessmentBadge(rec)}</div>
    ${parentLine}
    ${parentMissing.length ? `<div class="notice small">${bpEsc(parentMissing.join(' · '))}</div>` : ''}
    <div class="table-wrap"><table class="detail-table bp-progress-table"><thead><tr><th>Wert</th><th>Vater</th><th>Mutter</th><th>Elternmittel</th><th>Pferd</th><th>ggü. Elternmittel</th><th>${bpEsc(sameLabel)}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="bp-sibling-summary">
      <strong>Geschwistervergleich:</strong> ${bestLabels.length
        ? `Bestes Fohlen bei ${bpEsc(bestLabels.join(', '))} innerhalb der Gruppe „${bpEsc(groupLabel)}“.`
        : bestInfo.siblings.length < 2
          ? 'Noch keine ausreichende gleichgeschlechtliche Geschwistergruppe für einen Bestwert.'
          : 'Aktuell kein Bestwert bei GP, Ext, Ext% oder Int.'}
    </div>
  </section>`;
}

function bpRenderOffspring(parentHorse, context, pairings) {
  const analysis = bpOffspringAnalysis(parentHorse, context, pairings);
  if (!analysis.children.length) {
    return `<section class="card bp-section"><h2>Nachzuchtbilanz</h2><p class="muted">Noch keine Fohlen über Stammbaum oder Verpaarungs-Log verknüpft.</p></section>`;
  }
  const avgBits = BP_METRICS.map(metric => {
    const delta = analysis.averages[metric.key];
    return `<span><strong>${metric.label}</strong> ${bpFormatImprovement(delta,metric)}</span>`;
  }).join('');
  const bestCards = BP_METRICS.map(metric => {
    const row = analysis.best[metric.key];
    return `<div class="bp-best-offspring"><span>${metric.label}</span><strong>${row ? bpHorseLink(row.child) : '–'}</strong><small>${row ? bpFormatImprovement(row.improvements[metric.key],metric) + ' zum jeweiligen Elternmittel' : 'nicht auswertbar'}</small></div>`;
  }).join('');
  const childRows = analysis.rows
    .slice()
    .sort((a,b)=>String(a.child?.name || '').localeCompare(String(b.child?.name || ''),'de'))
    .map(row => `<tr>
      <td>${bpHorseLink(row.child)}</td>
      <td>${bpEsc(row.child?.gender || '–')}</td>
      ${BP_METRICS.map(metric => `<td>${bpFormatImprovement(row.improvements[metric.key],metric)}</td>`).join('')}
      <td>${bpAssessmentBadge(row.rec)}</td>
    </tr>`).join('');

  return `<section class="card bp-section">
    <div class="bp-section-head"><div><h2>Nachzuchtbilanz</h2><p class="small muted">Jedes Fohlen wird fair gegen sein eigenes Elternmittel bewertet. Vollständig bewertbar ist ein Fohlen, wenn Fohlen, Vater und Mutter jeweils GP, Ext, Ext% und Int für den Elternmittel-Vergleich liefern.</p></div><div class="bp-offspring-count"><strong>${analysis.children.length}</strong> Fohlen · <strong>${analysis.evaluable.length}</strong> vollständig bewertbar</div></div>
    <div class="bp-offspring-stats">
      <div><span>Klare Verbesserung</span><strong>${analysis.counts.keep}</strong></div>
      <div><span>Gemischt / prüfen</span><strong>${analysis.counts.check}</strong></div>
      <div><span>Rückschritt</span><strong>${analysis.counts.cull}</strong></div>
      <div><span>Teilweise bewertbar</span><strong>${analysis.counts.partialSome}</strong></div>
      <div><span>Noch offen</span><strong>${analysis.counts.open}</strong></div>
    </div>
    <div class="bp-average-progress"><strong>Durchschnittlicher Zuchtfortschritt</strong><div>${avgBits}</div></div>
    <h3>Beste Fohlen nach Zuchtfortschritt</h3>
    <div class="bp-best-offspring-grid">${bestCards}</div>
    <details class="bp-offspring-details"><summary>Alle ${analysis.children.length} Fohlen im Vergleich anzeigen</summary>
      <div class="table-wrap"><table class="detail-table"><thead><tr><th>Fohlen</th><th>Geschlecht</th><th>GP</th><th>Ext</th><th>Ext%</th><th>Int</th><th>Bewertung</th></tr></thead><tbody>${childRows}</tbody></table></div>
    </details>
  </section>`;
}

async function bpRenderBreedingPanel(horse, rootOrId) {
  const root = typeof rootOrId === 'string' ? document.getElementById(rootOrId) : rootOrId;
  if (!root) return;
  if (!horse || !horse.name) {
    root.innerHTML = '<p class="muted">Noch keine Pferdedaten für die Auswertung vorhanden.</p>';
    return;
  }
  root.innerHTML = '<p class="muted">Zucht- und Nachzuchtdaten werden ausgewertet…</p>';
  try {
    const [horses,pairings] = await Promise.all([
      localGetAll(LOCAL_STORES.horses),
      localGetAll(LOCAL_STORES.pairings),
    ]);
    const merged = horse?.id == null
      ? horses
      : horses.map(row => String(row.id) === String(horse.id) ? horse : row);
    if (horse?.id == null) merged.push(horse);
    const context = bpBuildContext(merged);
    root.innerHTML = bpRenderOwnProgress(horse, context) + bpRenderOffspring(horse, context, pairings);
  } catch (error) {
    root.innerHTML = `<p class="error">Zucht- und Nachzuchtdaten konnten nicht ausgewertet werden: ${bpEsc(error.message)}</p>`;
  }
}
