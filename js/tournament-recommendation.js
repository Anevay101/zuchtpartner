/* V54.0.72 – servergetrennte LK-relative Turnierberatung mit realistischer Turnierkurve
   Kernprinzip:
   - Pxx bleibt die relative Basis: exakt dieselbe Disziplin + dieselbe LK innerhalb derselben MDR-Spielwelt (DE/EN).
   - Referenz = alle lokal vorhandenen, vollständig auswertbaren Pferde; Haupt-/Nebenbegabung
     der Referenzpferde spielt keine Rolle.
   - Bei kleiner exakter Stichprobe: Fallback Gruppe+LK, danach gesamte LK.
   - Sichtbar ist nur EIN Empfehlungswert (0–100): Pxx wird mit einer weichen absoluten
     Turnierkurve kombiniert. DE nutzt die bewährten Startbereiche; EN hat eine eigene Kalibrierung.
   - Die Startwerte sind keine harten Kanten; die Kurve steigt davor/danach weich an.
   - Interieur bleibt bewusst separat: <=2,00 sehr gut; <=2,50 gut machbar; >2,50 mühsamer.
*/
const MDR_TOURNAMENT_REFERENCE_MIN_N = 15;
const MDR_TOURNAMENT_REFERENCE_PROVISIONAL_MIN_N = 5;
const MDR_TOURNAMENT_P_VERY_STRONG = 80;
const MDR_TOURNAMENT_P_GOOD = 65;
const MDR_TOURNAMENT_P_AVERAGE = 45;
const MDR_TOURNAMENT_P_WEAK = 25;

// Erfahrungsbasierte Unterkante, ab der reale Turnierchancen in MDR beginnen.
// Sie wird bewusst als weiche Kurve und NICHT als harter Cutoff verwendet.
const MDR_TOURNAMENT_ABSOLUTE_START_BY_LK = Object.freeze({
  LK10: 155,
  LK9: 190,
  LK8: 200,
});

function plannerHorseTournamentServer(horse) {
  const raw=String(horse?.mdr_server || horse?.game_version || '').trim().toUpperCase();
  return raw==='DE' || raw==='EN' ? raw : 'UNKNOWN';
}

function plannerTournamentServerLabel(server) {
  const s=String(server || '').toUpperCase();
  if (s==='DE') return 'DE';
  if (s==='EN') return 'EN';
  return 'unbekannt';
}

function plannerTournamentDerivedAbsoluteStarts(horses, scoreFn, server) {
  const byLk=new Map();
  const horsesByLk=new Map();
  for (const horse of (horses || [])) {
    if (server==='DE' || server==='EN') {
      if (plannerHorseTournamentServer(horse)!==server) continue;
    }
    const mainGroup=typeof plannerHorseMainGroup==='function' ? plannerHorseMainGroup(horse) : null;
    if (!mainGroup) continue;
    const horseKey=String(horse?.id ?? horse?.external_id ?? horse?.name ?? '');
    for (const [discipline,def] of Object.entries(MDR_TOURNAMENT_DISCIPLINES || {})) {
      if (def?.group!==mainGroup) continue;
      const row=scoreFn(horse,discipline);
      if (!row || row.complete===false || !row.lk || !Number.isFinite(Number(row.points))) continue;
      if (!byLk.has(row.lk)) byLk.set(row.lk,[]);
      if (!horsesByLk.has(row.lk)) horsesByLk.set(row.lk,new Set());
      byLk.get(row.lk).push(Number(row.points));
      horsesByLk.get(row.lk).add(horseKey || `row:${byLk.get(row.lk).length}`);
    }
  }
  const starts={};
  const samples={};
  for (const [lk,values] of byLk) {
    const clean=values.filter(Number.isFinite);
    const horseCount=horsesByLk.get(lk)?.size || 0;
    samples[lk]={horses:horseCount,values:clean.length};
    // Eine eigene absolute EN-Kurve wird erst ab mindestens fünf verschiedenen
    // Pferden derselben LK freigeschaltet. So können vier korrelierte Disziplinen
    // eines einzelnen Pferdes nicht allein eine neue Server-Schwelle erzeugen.
    // Das 40. Perzentil ist bewusst eine Einstiegsschwelle und kein Elite-Median.
    if (horseCount>=MDR_TOURNAMENT_REFERENCE_PROVISIONAL_MIN_N) {
      starts[lk]=Math.round(plannerTournamentPercentile(clean,.40));
    }
  }
  return {starts,samples};
}

function plannerTournamentAbsoluteStart(lk, context=null) {
  const key=String(lk||'').trim();
  const contextual=context?.absoluteStarts?.[key];
  if (Number.isFinite(Number(contextual))) return Number(contextual);
  const server=String(context?.server || '').toUpperCase();
  // EN-LK10 ist als Erfahrungswert separat kalibriert. Für höhere EN-LKs
  // wird ausschließlich aus dem EN-Bestand gelernt; niemals auf DE zurückgefallen.
  if (server==='EN') return key==='LK10' ? 130 : null;
  const value=MDR_TOURNAMENT_ABSOLUTE_START_BY_LK[key];
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function plannerTournamentReadinessFactor(points, lk, context=null) {
  const p=Number(points);
  const start=plannerTournamentAbsoluteStart(lk,context);
  if (!Number.isFinite(p) || start == null) return {factor:1,start,calibrated:false,delta:null};
  const delta=p-start;
  // Weiche Kurve um den serverbezogenen Startwert.
  const knots=[[-40,0.10],[-20,0.30],[0,0.72],[20,0.90],[40,1.00]];
  let factor;
  if (delta<=knots[0][0]) factor=knots[0][1];
  else if (delta>=knots[knots.length-1][0]) factor=knots[knots.length-1][1];
  else {
    factor=1;
    for (let i=1;i<knots.length;i++) {
      const [x1,y1]=knots[i-1], [x2,y2]=knots[i];
      if (delta<=x2) {
        const t=(delta-x1)/(x2-x1);
        factor=y1+(y2-y1)*t;
        break;
      }
    }
  }
  return {factor:Math.max(0,Math.min(1,factor)),start,calibrated:true,delta};
}

function plannerTournamentRecommendationScore(row, percentile, context=null) {
  const p=Number(percentile);
  if (!Number.isFinite(p)) return {score:null,percentile:null,...plannerTournamentReadinessFactor(row?.points,row?.lk,context)};
  const readiness=plannerTournamentReadinessFactor(row?.points,row?.lk,context);
  const score=Math.max(0,Math.min(100,Math.round(p*readiness.factor)));
  return {score,percentile:Math.round(p),...readiness};
}

// Alt-Konstanten bleiben aus Kompatibilitätsgründen vorhanden. Sie steuern ab V54.0.58
// keine Turnierempfehlung mehr.
const MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN = 150;
const MDR_TOURNAMENT_MAIN_MIN = 180;
const MDR_TOURNAMENT_MIN_STORAGE_KEY = 'mdr_tournament_absolute_min_v1';
function plannerTournamentAbsoluteMin(fallback = MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN) {
  const n = Number(fallback);
  return Number.isFinite(n) ? n : MDR_TOURNAMENT_DEFAULT_ABSOLUTE_MIN;
}
function plannerSetTournamentAbsoluteMin() {}

function plannerTournamentPercentile(values, q) {
  const sorted = (values || []).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = Math.max(0, Math.min(1, Number(q))) * (sorted.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const f = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * f;
}

function plannerTournamentPercentileRank(values, value) {
  const clean=(values || []).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  const score=Number(value);
  if (!clean.length || !Number.isFinite(score)) return null;
  // Midrank bei Gleichständen: verhindert, dass identische Werte künstlich alle P100 werden.
  let below=0, equal=0;
  for (const v of clean) {
    if (v < score) below++;
    else if (v === score) equal++;
    else break;
  }
  const rank=(below + equal * 0.5) / clean.length;
  return Math.max(0, Math.min(100, Math.round(rank * 100)));
}

function plannerTournamentReferenceMode(n, minN = MDR_TOURNAMENT_REFERENCE_MIN_N) {
  const count = Math.max(0, Number(n) || 0);
  if (count >= minN) return 'normal';
  if (count >= MDR_TOURNAMENT_REFERENCE_PROVISIONAL_MIN_N) return 'provisional';
  return 'small-sample';
}

function plannerTournamentReferenceStats(values, meta={}) {
  const clean=(values || []).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  return {
    ...meta,
    values:clean,
    n:clean.length,
    mode:plannerTournamentReferenceMode(clean.length),
    p25:plannerTournamentPercentile(clean,.25),
    p50:plannerTournamentPercentile(clean,.50),
    p75:plannerTournamentPercentile(clean,.75),
    mean:clean.length ? clean.reduce((a,b)=>a+b,0)/clean.length : null,
  };
}

function plannerTournamentRefKey(...parts) {
  return parts.map(v=>String(v ?? '').trim()).join('|||');
}

function plannerBuildTournamentRelativeModel(horses, scoreFn, minN = MDR_TOURNAMENT_REFERENCE_MIN_N, options = {}) {
  const exactRaw=new Map();
  const groupRaw=new Map();
  const lkRaw=new Map();
  const samples=[];
  const horseIds=new Set();
  const requestedServer=String(options?.server || 'ALL').toUpperCase();

  const pool=(horses || []).filter(h=>{
    if (!h || (typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(h))) return false;
    if (requestedServer==='DE' || requestedServer==='EN') return plannerHorseTournamentServer(h)===requestedServer;
    if (requestedServer==='UNKNOWN') return plannerHorseTournamentServer(h)==='UNKNOWN';
    return true;
  });
  for (const horse of pool) {
    for (const [discipline, def] of Object.entries(MDR_TOURNAMENT_DISCIPLINES || {})) {
      const row=scoreFn(horse,discipline);
      const points=Number(row?.points);
      if (!row || row.complete === false || !row.lk || !Number.isFinite(points)) continue;
      const group=row.group || def?.group || '';
      const exactKey=plannerTournamentRefKey(discipline,row.lk);
      const groupKey=plannerTournamentRefKey(group,row.lk);
      const lkKey=String(row.lk);
      if (!exactRaw.has(exactKey)) exactRaw.set(exactKey,[]);
      if (!groupRaw.has(groupKey)) groupRaw.set(groupKey,[]);
      if (!lkRaw.has(lkKey)) lkRaw.set(lkKey,[]);
      exactRaw.get(exactKey).push(points);
      groupRaw.get(groupKey).push(points);
      lkRaw.get(lkKey).push(points);
      samples.push({horseId:horse.id,horseName:horse.name||'',discipline,group,lk:row.lk,points});
      horseIds.add(String(horse.id ?? horse.name ?? samples.length));
    }
  }

  const exact={};
  for (const [key,values] of exactRaw) {
    const [discipline,lk]=key.split('|||');
    const group=MDR_TOURNAMENT_DISCIPLINES?.[discipline]?.group || '';
    exact[key]=plannerTournamentReferenceStats(values,{source:'discipline-lk',discipline,group,lk});
  }
  const byGroupLk={};
  for (const [key,values] of groupRaw) {
    const [group,lk]=key.split('|||');
    byGroupLk[key]=plannerTournamentReferenceStats(values,{source:'group-lk',group,lk});
  }
  const byLk={};
  for (const [lk,values] of lkRaw) byLk[lk]=plannerTournamentReferenceStats(values,{source:'lk',lk});

  let absoluteStarts={...MDR_TOURNAMENT_ABSOLUTE_START_BY_LK};
  let calibrationSamples={};
  if (requestedServer==='EN') {
    const derived=plannerTournamentDerivedAbsoluteStarts(pool,scoreFn,'EN');
    absoluteStarts={...derived.starts,LK10:130};
    calibrationSamples=derived.samples;
  } else if (requestedServer==='DE') {
    absoluteStarts={...MDR_TOURNAMENT_ABSOLUTE_START_BY_LK};
  }

  return {samples,horseCount:horseIds.size,exact,byGroupLk,byLk,minN:Number(minN)||MDR_TOURNAMENT_REFERENCE_MIN_N,server:requestedServer,absoluteStarts,calibrationSamples};
}

function plannerBuildTournamentModelsByServer(horses, scoreFn, minN = MDR_TOURNAMENT_REFERENCE_MIN_N) {
  return {
    DE: plannerBuildTournamentRelativeModel(horses,scoreFn,minN,{server:'DE'}),
    EN: plannerBuildTournamentRelativeModel(horses,scoreFn,minN,{server:'EN'}),
    UNKNOWN: plannerBuildTournamentRelativeModel(horses,scoreFn,minN,{server:'UNKNOWN'}),
    ALL: plannerBuildTournamentRelativeModel(horses,scoreFn,minN,{server:'ALL'}),
  };
}

function plannerTournamentModelForHorse(horse, models, horses, scoreFn, minN = MDR_TOURNAMENT_REFERENCE_MIN_N) {
  const server=plannerHorseTournamentServer(horse);
  if (server==='DE' || server==='EN') {
    if (models?.[server]) return models[server];
    return plannerBuildTournamentRelativeModel(horses,scoreFn,minN,{server});
  }
  // Unbekannte Altbestände behalten bewusst die bisherige gemischte Bewertung,
  // bis eine eindeutige Serverzuordnung vorliegt.
  if (models?.ALL) return models.ALL;
  return plannerBuildTournamentRelativeModel(horses,scoreFn,minN,{server:'ALL'});
}

// Kompatibilitätsalias: bestehende Aufrufer erhalten ab V54.0.58 das neue Modell.
function plannerBuildTournamentReferences(horses, scoreFn, minN = MDR_TOURNAMENT_REFERENCE_MIN_N) {
  return plannerBuildTournamentRelativeModel(horses,scoreFn,minN,{server:'ALL'});
}

function plannerTournamentReferenceFor(row, model) {
  if (!row?.discipline || !row?.lk || !model) return null;
  const exact=model.exact?.[plannerTournamentRefKey(row.discipline,row.lk)] || null;
  const group=model.byGroupLk?.[plannerTournamentRefKey(row.group,row.lk)] || null;
  const lk=model.byLk?.[row.lk] || null;
  const minN=Math.max(1,Number(model.minN)||MDR_TOURNAMENT_REFERENCE_MIN_N);
  const provisionalMin=MDR_TOURNAMENT_REFERENCE_PROVISIONAL_MIN_N;

  // Erst die fachlich exakte Referenz, wenn sie ausreichend groß ist.
  if (exact && exact.n >= minN) return {...exact, fallback:false, exactN:exact.n};
  if (group && group.n >= minN) return {...group, fallback:true, exactN:exact?.n||0};
  if (lk && lk.n >= minN) return {...lk, fallback:true, exactN:exact?.n||0};

  // Ist keine Ebene >=15, verwenden wir die spezifischste noch vertretbare Basis ab n=5.
  if (exact && exact.n >= provisionalMin) return {...exact, fallback:false, provisional:true, exactN:exact.n};
  if (group && group.n >= provisionalMin) return {...group, fallback:true, provisional:true, exactN:exact?.n||0};
  if (lk && lk.n >= provisionalMin) return {...lk, fallback:true, provisional:true, exactN:exact?.n||0};
  return null;
}

function plannerTournamentRelative(row, model) {
  const reference=plannerTournamentReferenceFor(row,model);
  if (!reference) return {percentile:null,reference:null,usable:false};
  const percentile=plannerTournamentPercentileRank(reference.values,row.points);
  return {percentile,reference,usable:Number.isFinite(percentile)};
}

function plannerTournamentTraffic(percentile) {
  const p=Number(percentile);
  if (!Number.isFinite(p)) return 'neutral';
  if (p >= MDR_TOURNAMENT_P_GOOD) return 'green';
  if (p >= MDR_TOURNAMENT_P_AVERAGE) return 'yellow';
  if (p >= MDR_TOURNAMENT_P_WEAK) return 'orange';
  return 'red';
}

function plannerTournamentInterpretation(score, isMainGroup=false) {
  const p=Number(score);
  if (!Number.isFinite(p)) return {level:'unknown',traffic:'neutral',label:'zu wenig Referenzdaten',suitable:false,mention:false};
  if (p >= MDR_TOURNAMENT_P_VERY_STRONG) return {
    level:'very-strong',traffic:'green',label:isMainGroup?'sehr stark':'Beritt sehr interessant',suitable:true,mention:true,
  };
  if (p >= MDR_TOURNAMENT_P_GOOD) return {
    level:'good',traffic:'green',label:isMainGroup?'gut':'Beritt interessant',suitable:true,mention:true,
  };
  if (p >= MDR_TOURNAMENT_P_AVERAGE) return {
    level:'average',traffic:'yellow',label:isMainGroup?'durchschnittlich':'situativ',suitable:isMainGroup,mention:true,
  };
  if (p >= MDR_TOURNAMENT_P_WEAK) return {
    level:'weak',traffic:'orange',label:isMainGroup?'eher schwach':'Beritt eher nicht sinnvoll',suitable:false,mention:false,
  };
  return {level:'poor',traffic:'red',label:isMainGroup?'schwach':'Beritt nicht empfohlen',suitable:false,mention:false};
}

function plannerTournamentInteriorAssessment(value) {
  const n=Number(value);
  if (!Number.isFinite(n)) return {traffic:'neutral',label:'INT unbekannt'};
  if (n <= 2.0) return {traffic:'green',label:'sehr gut'};
  if (n <= 2.5) return {traffic:'yellow',label:'gut machbar'};
  return {traffic:'red',label:'mühsamer'};
}

function plannerTournamentProof(horse, discipline) {
  let row = null;
  try {
    row = typeof plannerTournamentResults === 'function' ? plannerTournamentResults(horse)?.[discipline] : null;
  } catch (_) {}
  const first = Math.max(0, Number(row?.first) || 0);
  const second = Math.max(0, Number(row?.second) || 0);
  const third = Math.max(0, Number(row?.third) || 0);
  const placements = first + second + third;
  const cupStar = row?.cup_star === true;
  return {first,second,third,placements,cupStar,proven:cupStar || placements > 0};
}

function plannerTournamentSuitability(row, referenceOrModel, _secondaryMin, options = {}) {
  const points=Number(row?.points);
  if (!row || row.complete === false || !Number.isFinite(points)) {
    return {suitable:false,reason:'unvollständig',percentile:null,recommendationScore:null,reference:null,interpretation:plannerTournamentInterpretation(null,options.isMainGroup===true)};
  }
  const relative=referenceOrModel?.exact || referenceOrModel?.byLk
    ? plannerTournamentRelative(row,referenceOrModel)
    : {percentile:null,reference:referenceOrModel||null,usable:false};
  const recommendation=plannerTournamentRecommendationScore(row,relative.percentile,referenceOrModel);
  const interpretation=plannerTournamentInterpretation(recommendation.score,options.isMainGroup===true);
  return {
    suitable:interpretation.suitable,
    mention:interpretation.mention,
    reason:interpretation.label,
    percentile:relative.percentile,
    recommendationScore:recommendation.score,
    recommendation,
    reference:relative.reference,
    referenceUsed:Boolean(relative.reference),
    interpretation,
    proof:options.proof || null,
    proven:options.proof?.proven === true,
    minimum:recommendation.start,secondaryMinimum:null,mainMinimum:null,
  };
}

function plannerAnalyzeTournamentProfile(horse, horses, scoreFn, options = {}) {
  const minN=Number.isFinite(Number(options.minN)) ? Number(options.minN) : MDR_TOURNAMENT_REFERENCE_MIN_N;
  const horseServer=plannerHorseTournamentServer(horse);
  let model=options.relativeModel || options.references || null;
  const wantedServer=(horseServer==='DE' || horseServer==='EN') ? horseServer : 'ALL';
  if (!model || String(model.server || 'ALL').toUpperCase()!==wantedServer) {
    model=plannerBuildTournamentRelativeModel(horses,scoreFn,minN,{server:wantedServer});
  }
  const mainGroup=typeof plannerHorseMainGroup === 'function' ? plannerHorseMainGroup(horse) : null;
  const talent=typeof plannerHorseTalent === 'function' ? plannerHorseTalent(horse) : null;

  const rows=Object.keys(MDR_TOURNAMENT_DISCIPLINES || {})
    .map(name=>scoreFn(horse,name))
    .filter(row=>row && row.complete !== false && Number.isFinite(Number(row.points)))
    .map(row=>{
      const isMainGroup=Boolean(mainGroup && row.group === mainGroup);
      const proof=plannerTournamentProof(horse,row.discipline);
      const relative=plannerTournamentRelative(row,model);
      const recommendation=plannerTournamentRecommendationScore(row,relative.percentile,model);
      const interpretation=plannerTournamentInterpretation(recommendation.score,isMainGroup);
      const interiorAssessment=plannerTournamentInteriorAssessment(row.interior);
      return {
        ...row,
        isMainGroup,proof,proven:proof.proven,
        percentile:relative.percentile,
        recommendationScore:recommendation.score,
        recommendation,
        relative,
        reference:relative.reference,
        interpretation,
        interiorAssessment,
        suitability:{
          suitable:interpretation.suitable,mention:interpretation.mention,reason:interpretation.label,
          percentile:relative.percentile,recommendationScore:recommendation.score,recommendation,
          reference:relative.reference,referenceUsed:Boolean(relative.reference),
          interpretation,proof,proven:proof.proven,minimum:recommendation.start,
        },
        suitable:interpretation.suitable,
        mention:interpretation.mention,
      };
    })
    .sort((a,b)=>{
      const as=Number.isFinite(Number(a.recommendationScore))?Number(a.recommendationScore):-1;
      const bs=Number.isFinite(Number(b.recommendationScore))?Number(b.recommendationScore):-1;
      const ap=Number.isFinite(Number(a.percentile))?Number(a.percentile):-1;
      const bp=Number.isFinite(Number(b.percentile))?Number(b.percentile):-1;
      return bs-as || bp-ap || Number(b.points)-Number(a.points) || (a.interior??99)-(b.interior??99);
    });

  const byRecommendation=(a,b)=>(Number(b.recommendationScore)||-1)-(Number(a.recommendationScore)||-1)||(Number(b.percentile)||-1)-(Number(a.percentile)||-1)||Number(b.points)-Number(a.points);
  const mainRows=rows.filter(r=>r.isMainGroup).sort(byRecommendation);
  const secondaryRows=rows.filter(r=>!r.isMainGroup).sort(byRecommendation);
  const recommendedSecondaryRows=secondaryRows.filter(r=>Number(r.recommendationScore)>=MDR_TOURNAMENT_P_GOOD);
  const situationalSecondaryRows=secondaryRows.filter(r=>Number(r.recommendationScore)>=MDR_TOURNAMENT_P_AVERAGE && Number(r.recommendationScore)<MDR_TOURNAMENT_P_GOOD);
  const suitableRows=[...mainRows.filter(r=>r.suitable),...recommendedSecondaryRows].sort(byRecommendation);

  const groups=(MDR_TOURNAMENT_GROUP_ORDER || []).map(group=>{
    const groupRows=rows.filter(r=>r.group===group);
    if (!groupRows.length) return null;
    const recommended=groupRows.filter(r=>r.suitable);
    return {
      group,rows:recommended,count:recommended.length,
      allRows:groupRows,
      avgPoints:groupRows.reduce((s,r)=>s+Number(r.points),0)/groupRows.length,
      provenCount:groupRows.filter(r=>r.proven).length,
      isMain:group===mainGroup,
      best:groupRows[0]||null,
    };
  }).filter(Boolean);
  const main=groups.find(g=>g.group===mainGroup) || {group:mainGroup,rows:[],allRows:mainRows,count:0,isMain:true,best:mainRows[0]||null,provenCount:0};
  const alternatives=groups.filter(g=>g.group!==mainGroup && g.rows.some(r=>Number(r.recommendationScore)>=MDR_TOURNAMENT_P_GOOD))
    .sort((a,b)=>(Number(b.best?.recommendationScore)||-1)-(Number(a.best?.recommendationScore)||-1));
  const singleAlternatives=[];

  const bestMain=mainRows[0]||null;
  const bestSecondary=secondaryRows[0]||null;
  let recommendation='Keine belastbare Turniereinordnung';
  if (bestMain?.interpretation?.label) recommendation=`Hauptbegabung ${bestMain.interpretation.label}`;
  if (bestSecondary && Number(bestSecondary.recommendationScore)>=MDR_TOURNAMENT_P_GOOD) {
    recommendation += ` · Nebenbegabung ${bestSecondary.interpretation.label.toLowerCase()}`;
  }

  return {
    horse,rows,mainRows,secondaryRows,recommendedSecondaryRows,situationalSecondaryRows,
    suitableRows,groups,mainGroup,talent,main,alternatives,singleAlternatives,recommendation,
    best:rows[0]||null,bestMain,bestSecondary,bestSuitable:suitableRows[0]||null,
    references:model,relativeModel:model,minN,server:horseServer,
    absoluteMin:null,secondaryMin:null,mainMin:null,
  };
}

function plannerFormatTournamentOption(row, includeGroup = false) {
  if (!row) return '';
  const bits=[`${row.discipline} ${Math.round(Number(row.points))}`,`INT ${row.interior==null?'–':Number(row.interior).toFixed(2)}`,row.lk||'LK –'];
  const base=bits.join(' / ');
  return includeGroup ? `${row.group} – ${base}` : base;
}

function plannerTournamentCopyText(profile) {
  if (!profile) return '';
  const lines=[`Hauptbegabung: ${profile.mainGroup || 'unbekannt'}`];
  (profile.mainRows || []).forEach(row=>lines.push(plannerFormatTournamentOption(row,true)));
  const secondaries=[...(profile.recommendedSecondaryRows||[]),...(profile.situationalSecondaryRows||[])];
  if (secondaries.length) {
    lines.push('Nebenbegabungen:');
    secondaries.forEach(row=>lines.push(plannerFormatTournamentOption(row,true)));
  } else lines.push('Nebenbegabungen: keine auffällige');
  return lines.join('\n').trim();
}

function plannerSuitableTournamentCopyText(profile) {
  const rows=[...(profile?.mainRows||[]).filter(r=>r.suitable),...(profile?.recommendedSecondaryRows||[])];
  if (!rows.length) return 'Empfohlene Turnierdisziplinen: keine';
  return ['Empfohlene Turnierdisziplinen:',...rows.map(r=>plannerFormatTournamentOption(r,true))].join('\n');
}

async function plannerCopyText(text, button) {
  const value=String(text||'');
  if (!value) return false;
  let ok=false;
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); ok=true; } } catch (_) {}
  if (!ok) {
    try {
      const ta=document.createElement('textarea'); ta.value=value; ta.setAttribute('readonly','');
      ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select();
      ok=document.execCommand('copy'); ta.remove();
    } catch (_) {}
  }
  if (button) {
    const old=button.textContent; button.textContent=ok?'Kopiert':'Kopieren fehlgeschlagen';
    setTimeout(()=>{button.textContent=old;},1400);
  }
  return ok;
}

function plannerReferenceLabel(reference) {
  if (!reference || !(Number(reference.n)>0)) return 'keine belastbare Referenz';
  const n=Math.max(0,Number(reference.n)||0);
  const quality=plannerTournamentReferenceBasisQuality(n);
  let basis='';
  if (reference.source==='discipline-lk') basis=`${reference.discipline} · ${reference.lk}`;
  else if (reference.source==='group-lk') basis=`${reference.group} · ${reference.lk} (Fallback)`;
  else basis=`${reference.lk} gesamt (Fallback)`;
  return `${basis} · n=${n} · ${quality}`;
}

function plannerTournamentReferenceBasisQuality(n) {
  const count=Math.max(0,Number(n)||0);
  if (count>=50) return 'sehr gute Basis';
  if (count>=30) return 'gute Basis';
  if (count>=MDR_TOURNAMENT_REFERENCE_MIN_N) return 'brauchbare Basis';
  if (count>=MDR_TOURNAMENT_REFERENCE_PROVISIONAL_MIN_N) return 'kleine Basis';
  if (count>0) return 'zu klein';
  return 'keine Daten';
}

function plannerTournamentReferenceGroupSummaries(model) {
  return (MDR_TOURNAMENT_GROUP_ORDER || []).map(group=>{
    const refs=Object.values(model?.exact||{}).filter(r=>r.group===group);
    const ns=refs.map(r=>r.n);
    const minN=ns.length?Math.min(...ns):0, maxN=ns.length?Math.max(...ns):0;
    return {group,minN,maxN,nLabel:minN===maxN?`n=${minN}`:`n=${minN}–${maxN}`,quality:plannerTournamentReferenceBasisQuality(minN)};
  });
}
function plannerTournamentReferenceBasisText(model) {
  const exact=Object.values(model?.exact||{});
  const n=exact.reduce((s,r)=>s+r.n,0);
  const server=String(model?.server || 'ALL').toUpperCase();
  const en=typeof window!=='undefined' && window.MDR_I18N?.language==='en';
  const serverText=server==='DE' || server==='EN' ? ` · ${en?'server':'Server'} ${server}` : server==='UNKNOWN' ? ` · ${en?'server unknown':'Server unbekannt'}` : '';
  return en
    ? `${model?.horseCount||0} horses · ${n} evaluable discipline/level values${serverText} · internal Pxx basis primarily from the exact same discipline + level`
    : `${model?.horseCount||0} Pferde · ${n} auswertbare Disziplin/LK-Werte${serverText} · interne Pxx-Basis primär aus exakt gleicher Disziplin + LK`;
}

function plannerTournamentCalibrationText(model) {
  const server=String(model?.server || 'ALL').toUpperCase();
  const en=typeof window!=='undefined' && window.MDR_I18N?.language==='en';
  if (server==='EN') {
    const starts=model?.absoluteStarts || {};
    const bits=[en?'LK10 from 130':'LK10 ab 130'];
    for (const lk of ['LK9','LK8','LK7','LK6','LK5','LK4','LK3','LK2','LK1']) {
      if (Number.isFinite(Number(starts[lk]))) bits.push(en?`${lk} from ${Math.round(Number(starts[lk]))}`:`${lk} ab ${Math.round(Number(starts[lk]))}`);
    }
    return en
      ? `EN benchmark: ${bits.join(', ')} points. Additional levels are calibrated only from the EN stock when enough EN data is available; there is no DE fallback.`
      : `EN-Benchmark: ${bits.join(', ')} Punkten. Weitere LK werden nur bei ausreichender EN-Datenbasis aus dem EN-Bestand kalibriert; es gibt keinen DE-Fallback.`;
  }
  if (server==='DE') return en ? 'DE benchmark: LK10 from 155, LK9 from 190, LK8 from 200 points.' : 'DE-Benchmark: LK10 ab 155, LK9 ab 190, LK8 ab 200 Punkten.';
  return en
    ? 'Server still unknown: the previous mixed assessment remains active until DE or EN is assigned unambiguously.'
    : 'Server noch unbekannt: vorläufig bleibt die bisherige gemischte Bewertung aktiv, bis DE oder EN eindeutig zugeordnet ist.';
}

function plannerTournamentRelativeHtml(row) {
  // Pxx bleibt intern als Erklärwert verfügbar, ist aber nicht mehr der sichtbare Empfehlungswert.
  const p=Number(row?.percentile);
  if (!Number.isFinite(p)) return '<span class="muted">P–</span>';
  const ref=plannerReferenceLabel(row?.reference);
  const esc=typeof plannerEscape==='function'?plannerEscape:(v=>String(v??''));
  return `<span class="tp-relative-link" title="P${Math.round(p)}: besser als etwa ${Math.round(p)} % der Vergleichswerte. ${esc(ref)}">P${Math.round(p)}</span>`;
}
function plannerTournamentRecommendationHtml(row) {
  const score=Number(row?.recommendationScore);
  if (!Number.isFinite(score)) return '<span class="muted">–</span>';
  const rec=row?.recommendation || plannerTournamentRecommendationScore(row,row?.percentile);
  const ref=plannerReferenceLabel(row?.reference);
  const esc=typeof plannerEscape==='function'?plannerEscape:(v=>String(v??''));
  const threshold=rec?.start==null?'keine absolute LK-Kalibrierung':`Turnierkurve ${row?.lk||''} ab ${Math.round(rec.start)} Punkten`;
  const p=Number.isFinite(Number(row?.percentile))?`intern P${Math.round(Number(row.percentile))}`:'Pxx nicht verfügbar';
  return `<span class="tp-relative-link tp-p-${plannerTournamentTraffic(score)}" title="Empfehlung ${Math.round(score)}/100 · ${p} · ${esc(threshold)} · ${esc(ref)}">${Math.round(score)}/100</span>`;
}
function plannerTournamentTrafficHtml(row) {
  const score=Number(row?.recommendationScore);
  const info=row?.interpretation || plannerTournamentInterpretation(score,Boolean(row?.isMainGroup));
  const esc=typeof plannerEscape==='function'?plannerEscape:(v=>String(v??''));
  const prefix=info.traffic==='green'?'🟢':info.traffic==='yellow'?'🟡':info.traffic==='orange'?'🟠':info.traffic==='red'?'🔴':'⚪';
  return `<span class="tp-eval-chip tp-eval-${info.traffic||'neutral'}">${prefix} ${esc(info.label)}</span>`;
}

function plannerTournamentInteriorHtml(row) {
  const a=row?.interiorAssessment || plannerTournamentInteriorAssessment(row?.interior);
  const esc=typeof plannerEscape==='function'?plannerEscape:(v=>String(v??''));
  const value=row?.interior==null?'–':Number(row.interior).toFixed(2);
  return `<span class="tp-int" title="${esc(a.label)}">${value}</span>`;
}
