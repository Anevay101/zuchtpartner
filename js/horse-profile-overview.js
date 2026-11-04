/* MDR V54.0.101 – getrennte Pferde-/Strategie-Kopierdaten ohne Dopplungen.
   Die Stammdatenseite bleibt eine operative Kurzansicht; Detailanalysen
   bleiben in Genetik, Turnierwerte, Zuchtschau und Zucht & Nachzucht. */

const HORSE_TRAINING_STRATEGIES = Object.freeze({
  'Reining': ['Longieren gering','Freispringen hoch','Hütchen hoch','Stangen gering'],
  'Trail': ['Longieren gering','Stangen mittel','Hütchen hoch'],
  'Pleasure': ['Longieren gering','Stangen mittel','Stangen hoch'],
  'Horsemanship': ['Longieren gering','Stangen mittel','Stangen hoch'],
  'Klassische Dressur': ['Freispringen gering','Stangen mittel','Stangen hoch'],
  'Spanische Gänge': ['Longieren gering','Stangen mittel','Hütchen mittel'],
  'Schulsprünge': ['Freispringen gering','Stangen gering','Longieren gering','Hütchen gering'],
  'Hohe Schule': ['Freispringen gering','Stangen mittel','Stangen hoch'],
});

function horseProfileEsc(value) {
  return typeof plannerEscape === 'function' ? plannerEscape(value) : String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function horseProfileText(value) {
  return value == null || String(value).trim() === '' ? '–' : String(value).trim();
}

function horseProfileFormatDate(value) {
  const m=String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : horseProfileText(value);
}

function horseProfileYesNo(value, unknown='unbekannt') {
  return value === true ? 'Ja' : value === false ? 'Nein' : unknown;
}

function horseProfileTournamentProfile(horse, allHorses) {
  if (typeof plannerAnalyzeTournamentProfile !== 'function' || typeof htpScore !== 'function') return null;
  try { return plannerAnalyzeTournamentProfile(horse, Array.isArray(allHorses) ? allHorses : [horse], htpScore); }
  catch (error) { console.warn('Kompaktes Turnierprofil konnte nicht berechnet werden:', error); return null; }
}

function horseProfileSecondRide(profile) {
  if (!profile?.recommendedSecondaryRows?.length) return null;
  const grouped=new Map();
  for (const row of profile.recommendedSecondaryRows) {
    if (!row?.group || row.group === profile.mainGroup) continue;
    if (!grouped.has(row.group)) grouped.set(row.group,[]);
    grouped.get(row.group).push(row);
  }
  const candidates=[...grouped.entries()]
    .map(([group,rows])=>({
      group,
      rows:rows.slice().sort((a,b)=>(Number(b.recommendationScore)||0)-(Number(a.recommendationScore)||0)||Number(b.points)-Number(a.points)),
    }))
    .filter(item=>item.rows.length>=2)
    .map(item=>({ ...item, score:item.rows.slice(0,2).reduce((sum,row)=>sum+(Number(row.recommendationScore)||0),0) }))
    .sort((a,b)=>b.score-a.score || a.group.localeCompare(b.group,'de'));
  return candidates[0] || null;
}

function horseProfileTournamentFocus(profile, talent) {
  if (!profile) return talent ? [talent] : [];
  const wanted=[];
  const add=(name)=>{ if (name && !wanted.includes(name)) wanted.push(name); };
  add(talent);
  for (const row of profile.mainRows || []) if (row.suitable) add(row.discipline);
  return wanted;
}

function horseProfileLpAssessment(horse, allHorses) {
  const api=window.MDR_LP_MODEL;
  if (!api?.actualResult || !api?.evaluate || !api?.classify) {
    return {symbol:'?',label:'?',detail:'nicht einschätzbar',status:'neutral'};
  }
  try {
    const actual=api.actualResult(horse);
    if (actual?.known) {
      return actual.passed
        ? {symbol:'✓',label:'✓ Ja',detail:'bestätigt',status:'green'}
        : {symbol:'✕',label:'✕ Nein',detail:'bestätigt nicht bestanden',status:'red'};
    }
    const evaluation=api.evaluate(horse);
    const validation=api.validate ? api.validate(Array.isArray(allHorses)?allHorses:[horse]) : null;
    const classification=api.classify(evaluation,validation);
    if (classification?.key==='red') return {symbol:'✕',label:'✕',detail:'Voraussetzungen aktuell nicht erfüllt',status:'red'};
    if (classification?.key==='green') return {symbol:'?',label:'?',detail:'Prognose positiv · noch nicht bestätigt',status:'yellow'};
    return {symbol:'?',label:'?',detail:classification?.label || 'noch offen',status:'neutral'};
  } catch (error) {
    console.warn('LP-Kurzstatus konnte nicht berechnet werden:', error);
    return {symbol:'?',label:'?',detail:'nicht einschätzbar',status:'neutral'};
  }
}

function horseProfileZsAssessment(horse, allHorses) {
  const benchmark=window.MDR_BREEDING_SHOW_BENCHMARK?.getBenchmarkForHorse?.(horse) || null;
  const actual=typeof plannerBreedingShowPoints === 'function' ? plannerBreedingShowPoints(horse) : null;
  if (actual != null) return { label:`ZS eingetragen (${Math.round(actual)})`, status:'green', predicted:null, actual, benchmark, assessment:null };
  if (typeof plannerBuildBreedingShowModel !== 'function') return {label:'nicht einschätzbar',status:'neutral',predicted:null,actual:null,benchmark,assessment:null};
  try {
    const model=plannerBuildBreedingShowModel(Array.isArray(allHorses)?allHorses:[horse]);
    const predicted=typeof model?.predict === 'function' ? model.predict(horse) : null;
    const assessment=window.MDR_BREEDING_SHOW_BENCHMARK?.assessHorseForecast?.(horse,predicted,benchmark) || null;
    if (assessment) return {label:assessment.label,status:assessment.status,predicted,actual:null,benchmark,assessment};
    return {label:predicted == null?'nicht einschätzbar':'Prognose vorhanden',status:predicted==null?'neutral':'yellow',predicted,actual:null,benchmark,assessment:null};
  } catch (error) {
    console.warn('ZS-Kurzbewertung konnte nicht berechnet werden:', error);
    return {label:'nicht einschätzbar',status:'neutral',predicted:null,actual:null,benchmark,assessment:null};
  }
}

function horseProfileBreedingProgress(horse, allHorses) {
  if (typeof bpBuildContext !== 'function' || typeof bpResolveParents !== 'function' || typeof bpEvaluateParentAverage !== 'function') {
    return {label:'noch nicht bewertbar',level:'partial',gpDelta:null,extPctDelta:null,parentLabel:null};
  }
  try {
    const context=bpBuildContext(Array.isArray(allHorses)?allHorses:[horse]);
    const parents=bpResolveParents(horse,context);
    const rec=bpEvaluateParentAverage(horse,parents.father,parents.mother);
    let gpDelta=null, extPctDelta=null, parentLabel=null;
    if (typeof bpBestFoalInfo === 'function' && typeof bpMetricSnapshot === 'function') {
      const info=bpBestFoalInfo(horse,context);
      const own=bpMetricSnapshot(horse);
      const parent=bpMetricSnapshot(info?.sameParent);
      if (own?.gp != null && parent?.gp != null) gpDelta=Number(own.gp)-Number(parent.gp);
      if (own?.extPct != null && parent?.extPct != null) extPctDelta=Number(own.extPct)-Number(parent.extPct);
      parentLabel=info?.sex==='male'?'Vater':info?.sex==='female'?'Mutter':null;
    }
    return {label:rec?.label || 'noch nicht bewertbar',level:rec?.level || 'partial',gpDelta,extPctDelta,parentLabel};
  } catch (error) {
    console.warn('Zuchtfortschritt-Kurzbewertung konnte nicht berechnet werden:', error);
    return {label:'noch nicht bewertbar',level:'partial',gpDelta:null,extPctDelta:null,parentLabel:null};
  }
}

function horseProfileBuildOverview(horse, allHorses) {
  const profile=horseProfileTournamentProfile(horse,allHorses);
  const talent=typeof plannerHorseTalent === 'function' ? plannerHorseTalent(horse) : null;
  const mainGroup=typeof plannerHorseMainGroup === 'function' ? plannerHorseMainGroup(horse) : null;
  const secondRide=horseProfileSecondRide(profile);
  const focus=horseProfileTournamentFocus(profile,talent);
  const training=talent ? (HORSE_TRAINING_STRATEGIES[talent] || null) : null;
  const zs=horseProfileZsAssessment(horse,allHorses);
  const breeding=horseProfileBreedingProgress(horse,allHorses);
  const lp=horseProfileLpAssessment(horse,allHorses);
  const mainRows=profile?.mainRows || [];
  const secondaryRows=[...(profile?.recommendedSecondaryRows||[]),...(profile?.situationalSecondaryRows||[])]
    .sort((a,b)=>(Number(b.recommendationScore)||-1)-(Number(a.recommendationScore)||-1)||Number(b.points)-Number(a.points));
  return {horse,profile,talent,mainGroup,secondRide,focus,training,zs,breeding,lp,mainRows,secondaryRows};
}

function horseProfileRow(label,value,opts={}) {
  const cls=opts.emphasis?' horse-info-row-emphasis':'';
  return `<div class="horse-info-row${cls}"><span>${horseProfileEsc(label)}</span><strong>${horseProfileEsc(horseProfileText(value))}</strong></div>`;
}

function horseProfileRenderBase(data) {
  const horse=data.horse;
  const breed=typeof normalizeBreed === 'function' ? (normalizeBreed(horse?.breed)||'Rasselos') : (horse?.breed||'Rasselos');
  const age=horse?.birthdate && typeof viewAgeLabel === 'function' ? viewAgeLabel(horse.birthdate) : '–';
  const pure=horse?.purebred_pct == null || horse.purebred_pct === '' ? '–' : `${Number(horse.purebred_pct).toFixed(Number(horse.purebred_pct)%1?1:0)} %`;
  const disease=horse?.disease_free===true?'frei von Erbkrankheiten':horse?.disease_free===false?'Erbkrankheit vorhanden':'unbekannt';
  const rows=[
    ['Name',horse?.name],['ID',horse?.external_id],['Geschlecht',horse?.gender],['Rasse',breed],
    ['Geburtstag',`${horseProfileFormatDate(horse?.birthdate)} · ${age}`],['Besitzer',horse?.owner],
    ['Zuchtzulassung',horse?.breeding_allowed===true?'ZZL ✓':horse?.breeding_allowed===false?'ZZL ✗':'ZZL ?'],
    ['Leistungsprüfung',data.lp?.detail ? `${data.lp.label} · ${data.lp.detail}` : (data.lp?.label||'?')],['Reinrassigkeit',pure],['Erbkrankheiten',disease],
  ];
  return rows.map(([l,v])=>horseProfileRow(l,v)).join('');
}

function horseProfileRenderStrategy(data) {
  const {talent,mainGroup,training,secondRide,focus}=data;
  const second=secondRide
    ? `${secondRide.group} empfohlen · ${secondRide.rows.slice(0,3).map(r=>r.discipline).join(', ')}`
    : 'keine Empfehlung';
  const trainingText=training?.length ? training.join(' → ') : (talent ? `Trainingskette für ${talent} noch nicht hinterlegt` : 'Hauptdisziplin noch nicht erkannt');
  const focusText=focus.length ? focus.join(', ') : 'noch nicht einschätzbar';
  return `<div class="horse-strategy-body">
    ${horseProfileRow('Hauptdisziplin',talent && mainGroup ? `${talent} / ${mainGroup}` : (talent||mainGroup||'–'),{emphasis:true})}
    ${horseProfileRow('Vorbereitung','Erziehung abschließen · Bodenarbeit ab 2 J.')}
    ${horseProfileRow('Bodenarbeit',trainingText)}
    ${horseProfileRow('Beritt ab 3 J.',mainGroup || '–')}
    ${horseProfileRow('Danach',talent ? `${talent} vollständig trainieren` : '–')}
    ${horseProfileRow('Zweitberitt',second)}
    ${horseProfileRow('Turnierfokus',focusText)}
  </div>`;
}

function horseProfileRenderTournament(data) {
  const main=data.mainRows.length ? data.mainRows.map(row=>`<div class="horse-tournament-line"><span>${horseProfileEsc(row.group)} – <strong>${horseProfileEsc(row.discipline)}</strong></span><span>${Math.round(Number(row.points))} / INT ${row.interior==null?'–':Number(row.interior).toFixed(2)} / ${horseProfileEsc(row.lk||'LK –')}</span></div>`).join('') : '<p class="small muted">Noch keine vollständigen Turnierwerte vorhanden.</p>';
  const secondary=data.secondaryRows.slice(0,4);
  const secondaryHtml=secondary.length ? `<div class="horse-tournament-subhead">Nebenbegabungen</div>${secondary.map(row=>`<div class="horse-tournament-line horse-tournament-secondary"><span>${horseProfileEsc(row.group)} – <strong>${horseProfileEsc(row.discipline)}</strong></span><span>${Math.round(Number(row.points))} / INT ${row.interior==null?'–':Number(row.interior).toFixed(2)} / ${horseProfileEsc(row.lk||'LK –')}</span></div>`).join('')}${data.secondaryRows.length>secondary.length?`<div class="tiny muted">+ ${data.secondaryRows.length-secondary.length} weitere im Reiter „Turnierwerte“</div>`:''}` : '<div class="horse-tournament-subhead">Nebenbegabungen</div><p class="small muted">Keine auffällige Nebenbegabung nach aktueller Turnierregel.</p>';
  return `<div class="horse-tournament-mainlabel"><strong>Hauptbegabung:</strong> ${horseProfileEsc(data.mainGroup||'–')}</div>${main}${secondaryHtml}`;
}

function horseProfileStatusClass(type,status) {
  if (type==='breeding') return status==='keep'?'good':status==='check'?'warn':status==='cull'?'bad':'neutral';
  return status==='green'?'good':status==='yellow'?'warn':status==='red'?'bad':status==='orange'?'warn':'neutral';
}

function horseProfileRenderAssessment(data) {
  const tournament=data.profile?.bestMain?.interpretation || null;
  const tLabel=tournament?.label || 'nicht einschätzbar';
  const tClass=horseProfileStatusClass('tournament',tournament?.traffic);
  const zClass=horseProfileStatusClass('zs',data.zs?.status);
  const bClass=horseProfileStatusClass('breeding',data.breeding?.level);
  const row=(icon,label,value,cls)=>`<div class="horse-assessment-row"><span class="horse-assessment-label">${icon} <strong>${horseProfileEsc(label)}</strong></span><span class="horse-status-chip horse-status-${cls}">${horseProfileEsc(value)}</span></div>`;
  const lpClass=horseProfileStatusClass('lp',data.lp?.status);
  return row('🏆','Turnierprofil',tLabel,tClass)+row('🏅','ZS-Prognose',data.zs?.label||'nicht einschätzbar',zClass)+row('✓','Leistungsprüfung',data.lp?.label||'?',lpClass)+row('↗','Zuchtfortschritt',data.breeding?.label||'noch nicht bewertbar',bClass);
}

function horseProfileRenderMore(data) {
  const horse=data.horse;
  const flaxen=typeof viewDerivedFlaxenCarrier === 'function' ? viewDerivedFlaxenCarrier(horse) : horse?.flaxen_carrier;
  const rows=[
    ['Spielversion',horse?.game_version],['Rasseanteile',horse?.breed_composition],['Fellfarbe',horse?.coat_color],
    ['Flaxen-Träger',horseProfileYesNo(flaxen)],['Appaloosa-Muster',horse?.appaloosa_pattern],
    ['ICO',horse?.ico==null||horse.ico===''?'–':`${Number(horse.ico).toFixed(3)} %`],
  ];
  if (/hengst|stallion/i.test(String(horse?.gender||''))) {
    rows.push(['Zuchtstation',horseProfileYesNo(horse?.in_breeding_station)],['Decktaxe',horse?.stud_fee==null||horse.stud_fee===''||Number(horse.stud_fee)===0?'kostenlos':`${horse.stud_fee} DD`]);
  }
  rows.push(['Notizen',horse?.notes],['Bild-URL',horse?.image_url]);
  return rows.map(([l,v])=>horseProfileRow(l,v)).join('');
}

function horseProfileMetricCopyData(data) {
  const horse=data.horse;
  const d=typeof viewDerived === 'function' ? viewDerived(horse) : {};
  const gp=d.gp==null||!Number.isFinite(Number(d.gp))?null:Math.round(Number(d.gp));
  const ext=d.ext==null||!Number.isFinite(Number(d.ext))?null:Number(d.ext).toFixed(2);
  const extPct=d.extpct==null||!Number.isFinite(Number(d.extpct))?null:`${Number(d.extpct).toFixed(0)}%`;
  const intVal=d.int==null||!Number.isFinite(Number(d.int))?null:Number(d.int).toFixed(2);
  const offspring=horse?.offspring_count==null||horse.offspring_count===''?null:Math.max(0,Math.round(Number(horse.offspring_count)||0));
  return {gp,ext,extPct,intVal,offspring};
}

function horseProfileHorseDataCopyText(data) {
  const horse=data.horse;
  const breed=typeof normalizeBreed === 'function' ? (normalizeBreed(horse?.breed)||'Rasselos') : (horse?.breed||'Rasselos');
  const zzl=horse?.breeding_allowed===true?'Ja':horse?.breeding_allowed===false?'Nein':'unbekannt';
  const metrics=horseProfileMetricCopyData(data);
  const lines=[
    `${horse?.name || 'Pferd'}`,
    `${horse?.gender || '–'} · ${breed}`,
    ...(data.mainGroup || data.talent ? [`Begabung: ${data.mainGroup || '–'}${data.talent?` / ${data.talent}`:''}`] : []),
    `Zuchtzulassung: ${zzl}`,
    `Leistungsprüfung: ${data.lp?.label || '?'}`,
    '',
    'Datenübersicht',
  ];
  if (metrics.gp!=null) lines.push(`GP: ${metrics.gp}`);
  if (metrics.ext!=null) lines.push(`Ext: ${metrics.ext}`);
  if (metrics.extPct!=null) lines.push(`Ext%: ${metrics.extPct}`);
  if (metrics.intVal!=null) lines.push(`Int: ${metrics.intVal}`);
  if (metrics.offspring!=null) lines.push(`Nachkommen: ${metrics.offspring}`);

  if (data.zs?.actual!=null || data.zs?.predicted!=null || (data.zs?.label && data.zs.label!=='nicht einschätzbar')) {
    lines.push('', 'Zuchtschau');
    if (data.zs.actual!=null) {
      lines.push(`ZS-Wert: ${Math.round(Number(data.zs.actual))}`);
    } else {
      if (data.zs?.label && data.zs.label!=='nicht einschätzbar') lines.push(`Prognose: ${data.zs.label}`);
      if (Number.isFinite(Number(data.zs?.predicted))) lines.push(`Schätzwert: ≈ ${Math.round(Number(data.zs.predicted))}`);
      const target=Number(data.zs?.benchmark?.qualifyingMedian);
      if (Number.isFinite(target)) lines.push(`Typisches Durchkommen: ${Math.round(target)}`);
    }
  }

  if (data.breeding?.gpDelta!=null || data.breeding?.extPctDelta!=null) {
    const parent=data.breeding.parentLabel === 'Mutter' ? 'zur Mutter' : data.breeding.parentLabel === 'Vater' ? 'zum Vater' : 'zum gleichgeschlechtlichen Elternteil';
    lines.push('', `Zuchtfortschritt ${parent}`);
    if (data.breeding.gpDelta!=null) {
      const gpDelta=Number(data.breeding.gpDelta);
      const gpText=Number.isInteger(gpDelta)?String(gpDelta):gpDelta.toFixed(1);
      lines.push(`GP: ${gpDelta>=0?'+':''}${gpText}`);
    }
    if (data.breeding.extPctDelta!=null) lines.push(`Ext%: ${data.breeding.extPctDelta>=0?'+':''}${Number(data.breeding.extPctDelta).toFixed(1)} %-Pkt.`);
  }
  return lines.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}

function horseProfileTournamentStrategyLines(data) {
  const lines=['Turnierstrategie'];
  if (data.mainRows.length) {
    for (const row of data.mainRows) {
      const marker=row.discipline===data.talent ? '★ ' : '';
      lines.push(`${marker}${row.discipline}: ${Math.round(Number(row.points))} / INT ${row.interior==null?'–':Number(row.interior).toFixed(2)} / ${row.lk||'LK –'}`);
    }
  } else {
    lines.push('Noch keine vollständigen Turnierwerte vorhanden.');
  }
  if (data.secondaryRows.length) {
    lines.push('Weitere sinnvolle Turnieroptionen:');
    for (const row of data.secondaryRows) lines.push(`${row.group} – ${row.discipline}: ${Math.round(Number(row.points))} / INT ${row.interior==null?'–':Number(row.interior).toFixed(2)} / ${row.lk||'LK –'}`);
  }
  return lines;
}

function horseProfileStrategyCopyText(data) {
  const second=data.secondRide ? `${data.secondRide.group} empfohlen (${data.secondRide.rows.length} geeignete Disziplinen)` : 'keine Empfehlung';
  const training=data.training?.length ? data.training.join(' → ') : (data.talent?`Trainingskette für ${data.talent} noch nicht hinterlegt`:'noch nicht erkannt');
  return [
    'Trainingsstrategie',
    'Vorbereitung: Erziehung abschließen · Bodenarbeit ab 2 Jahren',
    `Bodenarbeit: ${training}`,
    `Beritt ab 3 J.: ${data.mainGroup || '–'}`,
    `Danach: ${data.talent ? `${data.talent} vollständig trainieren` : '–'}`,
    `Zweitberitt: ${second}`,
    '',
    ...horseProfileTournamentStrategyLines(data),
  ].join('\n').replace(/\n{3,}/g,'\n\n').trim();
}

function horseProfileAllCopyText(data) {
  return `${horseProfileHorseDataCopyText(data)}\n\n${horseProfileStrategyCopyText(data)}`.trim();
}

function renderHorseProfileOverview(horse, allHorses) {
  const data=horseProfileBuildOverview(horse,allHorses);
  const set=(id,html)=>{ const el=document.getElementById(id); if(el) el.innerHTML=html; };
  set('horse-base-data',horseProfileRenderBase(data));
  set('horse-training-strategy',horseProfileRenderStrategy(data));
  set('horse-tournament-compact',horseProfileRenderTournament(data));
  set('horse-quick-assessment',horseProfileRenderAssessment(data));
  set('horse-more-data',horseProfileRenderMore(data));

  document.getElementById('horse-copy-overview')?.addEventListener('click',event=>plannerCopyText(horseProfileHorseDataCopyText(data),event.currentTarget));
  document.getElementById('horse-copy-strategy')?.addEventListener('click',event=>plannerCopyText(horseProfileStrategyCopyText(data),event.currentTarget));
  document.getElementById('horse-copy-all')?.addEventListener('click',event=>plannerCopyText(horseProfileAllCopyText(data),event.currentTarget));
  document.getElementById('horse-show-full-tournament')?.addEventListener('click',()=>{ if(typeof activateTab==='function') activateTab('turnier'); document.querySelector('.horse-view-tabs')?.scrollIntoView({behavior:'smooth',block:'start'}); });
  return data;
}
