// MDR V54.0.57 – kompakte Ankaufsberatung mit Ampelsystem
// Kaufkandidaten werden nur im Browser analysiert. Es wird kein Datensatz
// geschrieben, bis der Nutzer ausdrücklich „Gekauft – in Datenbank übernehmen“
// wählt und das Pferd anschließend in horse.html speichert.
(() => {
  'use strict';

  const RAW_TO_ADVISOR_KEY = 'mdr-purchase-advisor-raw-v1';
  const RAW_TO_HORSE_KEY = 'mdr-purchase-candidate-raw-v1';
  const GENERATION_WEIGHT = { 1: 1, 2: 0.68, 3: 0.38, 4: 0.18 };
  let allHorses = [];
  let currentCandidate = null;
  let currentRawText = '';
  let currentStoredId = null;

  function t(de, en) {
    return window.MDR_I18N?.language === 'en' ? en : de;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function norm(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');
  }

  function breedKey(horse) {
    const raw = horse?.breed || '';
    try { return norm(typeof normalizeBreed === 'function' ? normalizeBreed(raw) : raw); }
    catch { return norm(raw); }
  }

  function isRealHorse(horse) {
    if (!horse || typeof horse !== 'object') return false;
    if (typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(horse)) return false;
    return horse.learning_file !== true;
  }

  function configuredOwnerName() {
    const configured = String(typeof getFeedPlanConfig === 'function' ? (getFeedPlanConfig()?.owner_name || '') : '').trim();
    if (configured) return configured;
    const defaults = typeof feedPlanDefaultOwnerName === 'function' ? String(feedPlanDefaultOwnerName() || '').trim() : '';
    if (defaults) return defaults;
    const display = typeof mdrDisplayNameFromSession === 'function' ? String(mdrDisplayNameFromSession() || '').trim() : '';
    return display && display !== 'MDR' ? display : '';
  }

  function sameCandidate(a, b) {
    if (!a || !b) return false;
    const aExternal = String(a.external_id || '').trim();
    const bExternal = String(b.external_id || '').trim();
    if (aExternal && bExternal) return aExternal === bExternal;
    const sameName = norm(a.name) && norm(a.name) === norm(b.name);
    const sameBreed = breedKey(a) && breedKey(a) === breedKey(b);
    const aBirth = String(a.birthdate || '').slice(0,10);
    const bBirth = String(b.birthdate || '').slice(0,10);
    return Boolean(sameName && sameBreed && aBirth && bBirth && aBirth === bBirth);
  }

  function directAncestors(horse) {
    const names = typeof pedigreeAncestorNames === 'function' ? pedigreeAncestorNames(horse) : [];
    return names.slice(0, 14).map((name, index) => ({
      name,
      generation: index < 2 ? 1 : index < 6 ? 2 : 3,
      role: index === 0 ? 'Vater' : index === 1 ? 'Mutter' : (index < 6 ? 'Großeltern' : '3. Generation'),
    })).filter(row => row.name && !(typeof isUnknownAncestorName === 'function' && isUnknownAncestorName(row.name)));
  }

  function lineNodes(candidate, comparisonPool) {
    const rows = directAncestors(candidate);
    if (typeof buildPedigreeNameIndex === 'function' && typeof buildDeepPedigree === 'function') {
      const idx = buildPedigreeNameIndex(comparisonPool || []);
      const deep = buildDeepPedigree(candidate, idx, 4)
        .filter(node => Number(node.generation) === 4)
        .map(node => ({ name:node.name, generation:4, role:'4. Generation' }));
      rows.push(...deep);
    }
    const byName = new Map();
    for (const row of rows) {
      const key = norm(row.name);
      if (!key || (typeof isUnknownAncestorName === 'function' && isUnknownAncestorName(row.name))) continue;
      const previous = byName.get(key);
      if (!previous || row.generation < previous.generation) byName.set(key, row);
    }
    return [...byName.values()];
  }

  function pedigreeNameSet(horse, comparisonPool) {
    const set = new Set();
    if (typeof buildPedigreeNameIndex === 'function' && typeof buildDeepPedigree === 'function') {
      const idx = buildPedigreeNameIndex(comparisonPool || []);
      for (const row of buildDeepPedigree(horse, idx, 4)) {
        if (row.generation > 4) continue;
        const key = norm(row.name);
        if (key) set.add(key);
      }
      return set;
    }
    for (const row of directAncestors(horse)) set.add(norm(row.name));
    if (horse?.name) set.add(norm(horse.name));
    return set;
  }

  function computeLineAnalysis(candidate, ownBreed, totalBreed, pedigreePool=totalBreed) {
    const lines = lineNodes(candidate, pedigreePool);
    const ownSets = ownBreed.map(h => pedigreeNameSet(h, pedigreePool));
    const totalSets = totalBreed.map(h => pedigreeNameSet(h, pedigreePool));
    const detailed = lines.map(line => {
      const key = norm(line.name);
      const ownCount = ownSets.filter(set => set.has(key)).length;
      const totalCount = totalSets.filter(set => set.has(key)).length;
      return { ...line, ownCount, totalCount };
    });

    function novelty(referenceCount, which) {
      if (!lines.length) return null;
      if (!referenceCount) return 100;
      let weightedFrequency = 0;
      let weightSum = 0;
      for (const row of detailed) {
        const weight = GENERATION_WEIGHT[row.generation] || 0.1;
        const count = which === 'own' ? row.ownCount : row.totalCount;
        // Im eigenen Bestand ist schon EIN Treffer in einer nahen Linie
        // züchterisch relevant (z.B. vorhandenes Voll-/Halbgeschwister).
        // Häufigkeit verstärkt die Redundanz zusätzlich. Im Gesamtbestand
        // soll dagegen vor allem die tatsächliche Verbreitung der Linie zählen.
        const severity = which === 'own'
          ? (count <= 0 ? 0 : 0.65 + 0.35 * Math.min(1, count / Math.max(1, referenceCount * 0.20)))
          : Math.min(1, count / referenceCount);
        weightedFrequency += weight * severity;
        weightSum += weight;
      }
      return weightSum ? Math.max(0, Math.min(100, Math.round((1 - weightedFrequency / weightSum) * 100))) : null;
    }

    return {
      rows:detailed,
      ownNovelty:novelty(ownBreed.length, 'own'),
      totalNovelty:novelty(totalBreed.length, 'total'),
    };
  }

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function horseMetrics(horse) {
    const gp = num(horse?.tournament_potential?.['Gesamtpotenzial']);
    const ext = typeof averageScore === 'function' && typeof scoreExteriorTerm === 'function'
      ? num(averageScore(horse?.exterior_descriptive, scoreExteriorTerm)) : null;
    const extPct = num(horse?.exterior_genetics?.overall?.percent);
    const intAvg = typeof averageScore === 'function' && typeof scoreTemperamentTerm === 'function'
      ? num(averageScore(horse?.temperament, scoreTemperamentTerm)) : null;
    return { gp, ext, extPct, int:intAvg };
  }

  const METRICS = [
    { key:'gp', label:'GP', lower:false, digits:0 },
    { key:'ext', label:'Ext', lower:true, digits:2 },
    { key:'extPct', label:'Ext%', lower:false, digits:0, suffix:'%' },
    { key:'int', label:'Int', lower:true, digits:2 },
  ];

  function median(values) {
    const arr = values.filter(v => v != null && Number.isFinite(v)).slice().sort((a,b)=>a-b);
    if (!arr.length) return null;
    const mid = Math.floor(arr.length/2);
    return arr.length % 2 ? arr[mid] : (arr[mid-1] + arr[mid]) / 2;
  }

  function percentile(value, values, lowerBetter=false) {
    if (value == null) return null;
    const arr = values.filter(v => v != null && Number.isFinite(v));
    if (!arr.length) return null;
    const betterOrEqual = arr.filter(v => lowerBetter ? value <= v : value >= v).length;
    return Math.round((betterOrEqual / arr.length) * 100);
  }

  function computeQuality(candidate, ownBreed, totalBreed) {
    const current = horseMetrics(candidate);
    const own = ownBreed.map(horseMetrics);
    const total = totalBreed.map(horseMetrics);
    const rows = METRICS.map(metric => {
      const ownValues = own.map(row => row[metric.key]);
      const totalValues = total.map(row => row[metric.key]);
      return {
        ...metric,
        value:current[metric.key],
        ownMedian:median(ownValues),
        ownPercentile:percentile(current[metric.key], ownValues, metric.lower),
        totalPercentile:percentile(current[metric.key], totalValues, metric.lower),
        ownN:ownValues.filter(v=>v!=null).length,
        totalN:totalValues.filter(v=>v!=null).length,
      };
    });
    const ownAvailable = rows.filter(r => r.ownPercentile != null && r.ownN >= 3);
    const totalAvailable = rows.filter(r => r.totalPercentile != null && r.totalN >= 3);
    const source = ownAvailable.length >= 2 ? ownAvailable.map(r=>r.ownPercentile) : totalAvailable.map(r=>r.totalPercentile);
    const score = source.length ? Math.round(source.reduce((a,b)=>a+b,0)/source.length) : null;
    return { rows, score };
  }

  function genderRole(horse) {
    const g = String(horse?.gender || '').toLowerCase();
    if (g.includes('stute') || g.includes('filly') || g.includes('mare')) return 'female';
    if (g.includes('hengst') || g.includes('colt') || g.includes('stallion')) return 'male';
    return null;
  }

  function totalWins(horse) {
    const rows = horse?.tournament_results && typeof horse.tournament_results === 'object' ? horse.tournament_results : {};
    return Object.values(rows).reduce((sum,row)=>sum + Number(row?.first || 0),0);
  }

  function computePartners(candidate, ownBreed, totalReal) {
    const role = genderRole(candidate);
    if (!role) return { role:null, potential:[], inbreedingFree:[], licensedInbreedingFree:[], score:null };
    const wanted = role === 'female' ? 'male' : 'female';
    const potential = ownBreed.filter(h => genderRole(h) === wanted && !sameCandidate(candidate,h));
    const evaluated = potential.map(horse => {
      const relations = typeof findRelations === 'function' ? findRelations(candidate,horse) : [];
      const relatedness = typeof estimateRelatedness === 'function' ? estimateRelatedness(candidate,horse,totalReal,4) : null;
      return { horse, relations, relatedness, inbreedingFree: relations.length === 0 };
    });
    const inbreedingFree = evaluated.filter(x=>x.inbreedingFree);
    const licensedInbreedingFree = inbreedingFree.filter(x=>x.horse?.breeding_allowed === true);
    let score = 0;
    if (potential.length) {
      const freeRatio = inbreedingFree.length / potential.length;
      const licensedFactor = Math.min(1, licensedInbreedingFree.length / 8);
      score = Math.round((freeRatio * 0.55 + licensedFactor * 0.45) * 100);
    }
    return { role, potential, inbreedingFree, licensedInbreedingFree, score };
  }

  function pedigreeCompleteness(candidate) {
    const known = typeof pedigreeDepth === 'function' ? pedigreeDepth(candidate) : directAncestors(candidate).length;
    return { known, max:14, percent:Math.round(Math.min(14,known)/14*100) };
  }

  function weightedScore(parts) {
    const weighted = parts.filter(p=>p.value!=null && Number.isFinite(p.value) && p.weight>0);
    if (!weighted.length) return null;
    const weight = weighted.reduce((sum,p)=>sum+p.weight,0);
    return Math.round(weighted.reduce((sum,p)=>sum+p.value*p.weight,0)/weight);
  }

  function verdictFor(score, confidence) {
    if (score == null) return t('Datenlage unzureichend','Insufficient data');
    let label = score >= 82 ? t('Sehr interessant','Very interesting')
      : score >= 68 ? t('Interessant','Interesting')
      : score >= 52 ? t('Situativ interessant','Situationally interesting')
      : score >= 38 ? t('Eher redundant','Rather redundant')
      : t('Geringer Zuchtnutzen','Low breeding value');
    if (confidence === 'low') label += t(' · Datenlage begrenzt',' · limited data');
    return label;
  }

  function confidenceFor(pedigree, ownBreed, quality) {
    const metricCount = quality.rows.filter(r=>r.value!=null).length;
    if (pedigree.percent >= 80 && ownBreed.length >= 8 && metricCount >= 3) return 'high';
    if (pedigree.percent >= 50 && ownBreed.length >= 3 && metricCount >= 2) return 'medium';
    return 'low';
  }

  function analyzeCandidate(candidate) {
    const ownerName = configuredOwnerName();
    const real = allHorses.filter(isRealHorse).filter(h=>!sameCandidate(candidate,h));
    const breed = breedKey(candidate);
    const totalBreed = real.filter(h => breed && breedKey(h) === breed);
    const ownAll = real.filter(h => ownerName && norm(h.owner) === norm(ownerName));
    const ownBreed = ownAll.filter(h => breed && breedKey(h) === breed);
    const lines = computeLineAnalysis(candidate, ownBreed, totalBreed, real);
    if (!ownerName) lines.ownNovelty = null;
    const quality = computeQuality(candidate, ownBreed, totalBreed);
    const partners = computePartners(candidate, ownBreed, real);
    if (!ownerName) partners.score = null;
    const pedigree = pedigreeCompleteness(candidate);
    const confidence = confidenceFor(pedigree, ownBreed, quality);
    const score = weightedScore([
      {value:lines.ownNovelty,weight:0.40},
      {value:quality.score,weight:0.30},
      {value:partners.score,weight:0.25},
      {value:pedigree.percent,weight:0.05},
    ]);
    return { ownerName, real, totalBreed, ownAll, ownBreed, lines, quality, partners, pedigree, confidence, score, verdict:verdictFor(score,confidence) };
  }

  function fmt(value, digits=0, suffix='') {
    if (value == null || !Number.isFinite(Number(value))) return '–';
    return Number(value).toLocaleString(window.MDR_I18N?.language === 'en' ? 'en-US' : 'de-DE',{minimumFractionDigits:digits,maximumFractionDigits:digits}) + suffix;
  }

  function generationLabel(generation) {
    return ({1:t('Eltern','Parents'),2:t('Großeltern','Grandparents'),3:t('3. Generation','3rd generation'),4:t('4. Generation','4th generation')})[generation] || String(generation);
  }

  function trafficLevel(value, green=70, yellow=45) {
    if (value == null || !Number.isFinite(Number(value))) return 'neutral';
    return Number(value) >= green ? 'green' : Number(value) >= yellow ? 'yellow' : 'red';
  }

  function trafficSymbol(level) {
    return level === 'green' ? '🟢' : level === 'yellow' ? '🟡' : level === 'red' ? '🔴' : '⚪';
  }

  function setTrafficLight(id, level) {
    const el=document.getElementById(id);
    if (!el) return;
    el.textContent=trafficSymbol(level);
    el.className=`purchase-light purchase-light-${level}`;
  }

  function overallTraffic(analysis) {
    return trafficLevel(analysis.score, 68, 45);
  }

  function qualityTraffic(percentileValue) {
    return trafficLevel(percentileValue, 67, 40);
  }

  function buildShortVerdict(analysis) {
    const parts=[];
    const overlaps=analysis.lines.rows.filter(r=>r.ownCount>0);
    if (!overlaps.length) parts.push(t('keine vorhandene Linie im eigenen Bestand erkannt','no existing line detected in your own stock'));
    else {
      const nearest=Math.min(...overlaps.map(r=>r.generation));
      parts.push(t(`${overlaps.length} vorhandene Linienüberschneidung${overlaps.length===1?'':'en'}, nächste in ${generationLabel(nearest)}`,`${overlaps.length} existing line overlap${overlaps.length===1?'':'s'}, nearest in ${generationLabel(nearest)}`));
    }
    if (analysis.quality.score != null) {
      if (analysis.quality.score >= 67) parts.push(t('Qualität überdurchschnittlich','quality above average'));
      else if (analysis.quality.score >= 40) parts.push(t('Qualität im Mittelfeld','quality around the middle'));
      else parts.push(t('Qualität eher unter dem eigenen Vergleich','quality rather below your own comparison'));
    }
    if (analysis.partners.role) parts.push(t(`${analysis.partners.inbreedingFree.length} inzuchtfreie Partner, davon ${analysis.partners.licensedInbreedingFree.length} mit ZZL`,`${analysis.partners.inbreedingFree.length} inbreeding-free partners, ${analysis.partners.licensedInbreedingFree.length} of them licensed`));
    return parts.length ? parts.join(' · ') + '.' : t('Für eine belastbare Kurzbewertung fehlen Vergleichsdaten.','Comparison data is insufficient for a reliable quick assessment.');
  }

  function renderLineAnalysis(analysis) {
    const overlaps=analysis.lines.rows
      .filter(row=>row.ownCount>0)
      .sort((a,b)=>a.generation-b.generation || b.ownCount-a.ownCount || String(a.name).localeCompare(String(b.name),'de'));
    const noOverlap=document.getElementById('purchase-no-overlap');
    const wrap=document.getElementById('purchase-lines-wrap');
    if (!overlaps.length) {
      noOverlap.hidden=false;
      noOverlap.textContent=t('🟢 Keine relevanten Linienüberschneidungen im eigenen Bestand erkannt.','🟢 No relevant line overlaps detected in your own stock.');
      wrap.hidden=true;
      document.getElementById('purchase-lines-body').innerHTML='';
    } else {
      noOverlap.hidden=true;
      wrap.hidden=false;
      document.getElementById('purchase-lines-body').innerHTML=overlaps.map(row=>
        `<tr><td>${esc(row.name)}</td><td>${esc(generationLabel(row.generation))}</td><td>${row.ownCount}×</td></tr>`
      ).join('');
    }
    document.getElementById('purchase-pedigree-quality').textContent=t(
      `Pedigree-Datenqualität: ${analysis.pedigree.known}/14 sichtbare Ahnenplätze (${analysis.pedigree.percent}%).`,
      `Pedigree data quality: ${analysis.pedigree.known}/14 visible ancestor positions (${analysis.pedigree.percent}%).`
    );
  }

  function renderQuality(analysis) {
    document.getElementById('purchase-quality-body').innerHTML=analysis.quality.rows.map(row=>{
      const format=(v)=>fmt(v,row.digits,row.suffix||'');
      const level=qualityTraffic(row.ownPercentile);
      return `<tr><td>${esc(row.label)}</td><td>${format(row.value)}</td><td>${row.ownPercentile==null?'–':row.ownPercentile+'%'}</td><td class="purchase-table-light">${trafficSymbol(level)}</td></tr>`;
    }).join('');
    document.getElementById('purchase-reference-note').textContent=t(
      `Vergleichsbasis: ${analysis.ownBreed.length} eigene Pferde derselben Rasse. Gesamtbestand derselben Rasse: ${analysis.totalBreed.length}.`,
      `Reference base: ${analysis.ownBreed.length} of your own horses of the same breed. Overall database of the same breed: ${analysis.totalBreed.length}.`
    );
  }

  function renderPartners(analysis) {
    const p=analysis.partners;
    const stats=document.getElementById('purchase-partner-stats');
    if (!p.role) {
      stats.innerHTML=`<div class="notice small">${t('Für dieses Geschlecht ist keine Zuchtpartneranalyse möglich.','Breeding-partner analysis is not available for this sex.')}</div>`;
      return;
    }
    stats.innerHTML=`
      <div><strong>${p.inbreedingFree.length}</strong><span>${t('potenzielle inzuchtfreie Partner','potential inbreeding-free partners')}</span></div>
      <div><strong>${p.licensedInbreedingFree.length}</strong><span>${t('davon mit ZZL','of them licensed')}</span></div>`;
  }

  function renderAnalysis(candidate,analysis) {
    document.getElementById('purchase-result').hidden=false;
    document.getElementById('purchase-candidate-heading').textContent=`${candidate.name || t('Kaufkandidat','Purchase candidate')}`;
    document.getElementById('purchase-candidate-meta').textContent=[candidate.gender,candidate.breed,candidate.owner?`${t('aktueller Besitzer','current owner')}: ${candidate.owner}`:''].filter(Boolean).join(' · ');
    document.getElementById('purchase-verdict').textContent=analysis.verdict;
    const confLabel=analysis.confidence==='high'?t('hoch','high'):analysis.confidence==='medium'?t('mittel','medium'):t('niedrig','low');
    document.getElementById('purchase-confidence').textContent=t(`Aussagesicherheit: ${confLabel}`,`Confidence: ${confLabel}`);

    const overlapCount=analysis.lines.rows.filter(r=>r.ownCount>0).length;
    document.getElementById('purchase-line-summary').textContent=overlapCount===0
      ? t('keine vorhandene Linie','no existing line')
      : t(`${overlapCount} Überschneidung${overlapCount===1?'':'en'}`,`${overlapCount} overlap${overlapCount===1?'':'s'}`);
    document.getElementById('purchase-quality-summary').textContent=analysis.quality.score==null
      ? '–'
      : t(`Ø ${analysis.quality.score}. Perzentil`,`avg. ${analysis.quality.score}th percentile`);
    document.getElementById('purchase-partner-summary').textContent=analysis.partners.role
      ? t(`${analysis.partners.inbreedingFree.length} inzuchtfrei · ${analysis.partners.licensedInbreedingFree.length} mit ZZL`,`${analysis.partners.inbreedingFree.length} inbreeding-free · ${analysis.partners.licensedInbreedingFree.length} licensed`)
      : '–';
    document.getElementById('purchase-pedigree-summary').textContent=`${analysis.pedigree.percent}%`;
    document.getElementById('purchase-short-verdict').textContent=buildShortVerdict(analysis);
    document.getElementById('purchase-overall-reference').textContent=t(
      `Eigener rassespezifischer Vergleich: ${analysis.ownBreed.length} Pferde · Gesamtbestand derselben Rasse: ${analysis.totalBreed.length}.`,
      `Own breed-specific comparison: ${analysis.ownBreed.length} horses · overall database of the same breed: ${analysis.totalBreed.length}.`
    );

    setTrafficLight('purchase-verdict-light',overallTraffic(analysis));
    setTrafficLight('purchase-line-light',trafficLevel(analysis.lines.ownNovelty,75,50));
    setTrafficLight('purchase-quality-light',qualityTraffic(analysis.quality.score));
    setTrafficLight('purchase-partner-light',trafficLevel(analysis.partners.score,70,40));
    setTrafficLight('purchase-pedigree-light',trafficLevel(analysis.pedigree.percent,80,55));

    renderLineAnalysis(analysis);
    renderQuality(analysis);
    renderPartners(analysis);

    const adopt=document.getElementById('purchase-adopt-btn');
    const open=document.getElementById('purchase-open-existing');
    adopt.hidden=!currentRawText;
    open.hidden=currentStoredId==null;
    if (currentStoredId!=null) open.href=`view.html?id=${encodeURIComponent(currentStoredId)}`;
  }

  async function analyzeParsed(candidate,{rawText='',storedId=null}={}) {
    const error=document.getElementById('purchase-error');
    error.textContent='';
    if (!candidate?.name) { error.textContent=t('Kein Pferdename erkannt. Bitte vollständigen Seitentext verwenden.','No horse name detected. Please use the complete horse-page text.'); return; }
    if (!candidate?.breed) { error.textContent=t('Keine Rasse erkannt. Für die rassespezifische Beratung wird die Rasse benötigt.','No breed detected. The breed is required for breed-specific advice.'); return; }
    currentCandidate=candidate;
    currentRawText=rawText;
    currentStoredId=storedId;
    const analysis=analyzeCandidate(candidate);
    renderAnalysis(candidate,analysis);
    document.getElementById('purchase-result').scrollIntoView({behavior:'smooth',block:'start'});
  }

  async function analyzeRaw() {
    const text=document.getElementById('purchase-raw-text').value;
    const status=document.getElementById('purchase-parse-status');
    if (!text.trim()) { status.textContent=t('Bitte zuerst Text einfügen.','Please paste the horse-page text first.'); return; }
    try {
      status.textContent=t('Analysiere…','Analysing…');
      const parsed=parseHorseText(text);
      await analyzeParsed(parsed,{rawText:text,storedId:null});
      status.textContent=t(`Erkannt: ${parsed.name || '–'} · ${parsed.breed || '–'} · Kandidat wurde nicht gespeichert.`,`Detected: ${parsed.name || '–'} · ${parsed.breed || '–'} · candidate was not saved.`);
    } catch (error) {
      status.textContent='';
      document.getElementById('purchase-error').textContent=t('Analyse fehlgeschlagen: ','Analysis failed: ')+error.message;
    }
  }

  function resetAnalysis() {
    currentCandidate=null; currentRawText=''; currentStoredId=null;
    document.getElementById('purchase-raw-text').value='';
    document.getElementById('purchase-parse-status').textContent='';
    document.getElementById('purchase-result').hidden=true;
    document.getElementById('purchase-error').textContent='';
  }

  function populateExisting() {
    const select=document.getElementById('purchase-existing-select');
    const rows=allHorses.filter(isRealHorse).slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'de'));
    select.innerHTML=`<option value="">${t('Bitte wählen…','Please select…')}</option>`+rows.map(h=>`<option value="${esc(h.id)}">${esc(h.name||'–')} · ${esc(h.breed||'–')} · ${esc(h.owner||'–')}</option>`).join('');
  }

  function ownerNote() {
    const owner=configuredOwnerName();
    const el=document.getElementById('purchase-owner-note');
    if (owner) el.innerHTML=t(`<strong>Dein Vergleichsbestand:</strong> Besitzer „${esc(owner)}“. Die Auswahl „Aktive Züchter“ beeinflusst diese Beratung nicht.`,`<strong>Your comparison stock:</strong> owner “${esc(owner)}”. The “Active breeders” selection does not affect this advisor.`);
    else el.innerHTML=t('<strong>Hinweis:</strong> Für diesen Login ist noch kein MDR-Name hinterlegt. Bitte unter Einstellungen → Mein MDR-Name zuordnen. Bis dahin ist nur die Einordnung im Gesamtbestand möglich.','<strong>Note:</strong> No MDR username is configured for this login yet. Please assign it under Settings → My MDR username. Until then, only overall-database comparison is available.');
  }

  async function init() {
    const session=await requireSession();
    if (!session) return;
    await renderSharedNav(session);
    allHorses=await localGetAll(LOCAL_STORES.horses);
    ownerNote();
    populateExisting();

    document.getElementById('purchase-analyze-btn').addEventListener('click',analyzeRaw);
    document.getElementById('purchase-reset-btn').addEventListener('click',resetAnalysis);
    document.getElementById('purchase-existing-btn').addEventListener('click',async()=>{
      const id=document.getElementById('purchase-existing-select').value;
      if (!id) return;
      const horse=allHorses.find(h=>String(h.id)===String(id));
      if (horse) await analyzeParsed(horse,{storedId:horse.id});
    });
    document.getElementById('purchase-adopt-btn').addEventListener('click',()=>{
      if (!currentRawText) return;
      try { sessionStorage.setItem(RAW_TO_HORSE_KEY,currentRawText); } catch {}
      location.href='horse.html?purchase=1';
    });

    let transferred='';
    try { transferred=sessionStorage.getItem(RAW_TO_ADVISOR_KEY)||''; sessionStorage.removeItem(RAW_TO_ADVISOR_KEY); } catch {}
    if (transferred) {
      document.getElementById('purchase-raw-text').value=transferred;
      await analyzeRaw();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports={ median, percentile, horseMetrics, pedigreeCompleteness, verdictFor, weightedScore, computeLineAnalysis, computeQuality, computePartners };
  }
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded',()=>{ init().catch(error=>{ const el=document.getElementById('purchase-error'); if(el) el.textContent=t('Ankaufsberatung konnte nicht gestartet werden: ','Purchase advisor could not start: ')+error.message; }); });
})();
