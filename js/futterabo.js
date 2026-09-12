document.addEventListener('DOMContentLoaded', initFeedPlanPage);

const MDR_FEED_PRODUCTS = [
  { id:'foal_standard', de:'Fohlen Standard', en:'Foal Standard', price:60, unit:'bag' },
  { id:'youngstock', de:'Aufzucht Futter', en:'Youngstock', price:125, unit:'bag' },
  { id:'broodmare_standard', de:'Zuchtstuten Standard', en:'Broodmare Standard', price:140, unit:'bag' },
  { id:'stallion_standard', de:'Deckhengste Standard', en:'Stallion Standard', price:90, unit:'bag' },
  { id:'combo_competition', de:'Kombifutter Turnier', en:'Combo Competition', price:330, unit:'bag' },
  { id:'performance_gold', de:'Sportpferde Gold', en:'Performance Gold', price:215, unit:'bag' },
  { id:'hay', de:'Heu', en:'Hay', price:60, unit:'bale' },
  { id:'straw', de:'Stroh', en:'Straw', price:30, unit:'bale' },
];

function feedUiText(de,en) {
  return window.MDR_I18N?.language === 'en' ? en : de;
}

function feedEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function feedNumber(value) {
  return new Intl.NumberFormat(window.MDR_I18N?.language === 'en' ? 'en-US' : 'de-DE').format(Number(value || 0));
}

function feedDate(value) {
  if (!value) return '–';
  const d=value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '–';
  return new Intl.DateTimeFormat(window.MDR_I18N?.language === 'en' ? 'en-GB' : 'de-DE', {
    day:'2-digit', month:'2-digit', year:'numeric'
  }).format(d);
}

function feedGender(horse) {
  if (typeof plannerGender === 'function') return plannerGender(horse);
  const raw=String(horse?.gender || '').trim().toLowerCase();
  if (/stute|mare|female/.test(raw)) return 'stute';
  if (/hengst|stallion|male/.test(raw)) return 'hengst';
  if (/wallach|gelding/.test(raw)) return 'wallach';
  return raw;
}

function feedAgeYears(horse) {
  if (typeof plannerAgeYears === 'function') return plannerAgeYears(horse?.birthdate);
  if (typeof gameAgeYears === 'function') return gameAgeYears(horse?.birthdate);
  return null;
}

// Vom Nutzer festgelegte Definition: bestätigter Cupstern = mindestens
// 50 Gesamtstarts UND mindestens 15 Siege in wenigstens einer Disziplin.
// Explizite Alt-Tags allein reichen für die Futterregel bewusst nicht aus.
function feedHasConfirmedCupStar(horse) {
  const starts=typeof plannerTournamentStarts === 'function'
    ? plannerTournamentStarts(horse)
    : Number(horse?.tournament_starts_total);
  if (!Number.isFinite(Number(starts)) || Number(starts) < 50) return false;
  const results=typeof plannerTournamentResults === 'function'
    ? plannerTournamentResults(horse)
    : (horse?.tournament_results || {});
  return Object.values(results || {}).some(row => Number(row?.first || 0) >= 15);
}

// Priorität V54.0.51:
// 1) Hengst + bestätigter Cupstern -> Kombifutter Turnier
// 2) Stute + ZZL -> Zuchtstuten Standard
// 3) Hengst + ZZL -> Deckhengste Standard
// 4) unter 2 -> Fohlen Standard
// 5) 2 bis einschließlich 4 -> Aufzucht
// 6) über 4 -> Sportpferde Gold
function feedClassifyHorse(horse) {
  const gender=feedGender(horse);
  const age=feedAgeYears(horse);
  if (gender === 'hengst' && feedHasConfirmedCupStar(horse)) return 'combo_competition';
  if (gender === 'stute' && horse?.breeding_allowed === true) return 'broodmare_standard';
  if (gender === 'hengst' && horse?.breeding_allowed === true) return 'stallion_standard';
  if (age != null && age < 2) return 'foal_standard';
  if (age != null && age >= 2 && age <= 4) return 'youngstock';
  if (age != null && age > 4) return 'performance_gold';
  return 'unassigned';
}

function feedProduct(id) {
  return MDR_FEED_PRODUCTS.find(x => x.id === id) || null;
}

function feedProductName(product) {
  return feedUiText(product.de,product.en);
}

function feedLoginOwnedHorses(horses,config) {
  const wanted=String(config?.owner_name || '').trim().toLocaleLowerCase('de');
  if (!wanted) return [];
  return (horses || []).filter(h => String(h?.owner || '').trim().toLocaleLowerCase('de') === wanted);
}

function feedBuildModel(horses,config) {
  const active=feedLoginOwnedHorses(horses,config);
  const days=typeof feedPlanIntervalDays === 'function' ? feedPlanIntervalDays(config) : (config.rhythm === 'monthly' ? 30 : 7);
  const groups=new Map(MDR_FEED_PRODUCTS.filter(p=>p.unit === 'bag').map(p=>[p.id,[]]));
  const unassigned=[];
  for (const horse of active) {
    const id=feedClassifyHorse(horse);
    if (groups.has(id)) groups.get(id).push(horse);
    else unassigned.push(horse);
  }

  const rows=[];
  for (const product of MDR_FEED_PRODUCTS) {
    let horseCount=active.length;
    let quantity=0;
    if (product.unit === 'bag') {
      horseCount=(groups.get(product.id) || []).length;
      // MDR: 1 Sack Kraftfutter enthält 30 Einheiten. Ein Pferd braucht
      // 1 Einheit pro Tag, also deckt 1 Sack 30 Pferdetage.
      quantity=Math.ceil(horseCount * days / 30);
    } else {
      // MDR: 1 Ballen Heu/Stroh reicht für 1 Pferd 30 Tage = 30 Pferdetage.
      quantity=Math.ceil(active.length * days / 30);
    }
    rows.push({
      ...product,
      horseCount,
      quantity,
      cost:quantity * product.price,
      horses:product.unit === 'bag' ? (groups.get(product.id) || []) : active,
    });
  }

  return {
    active,
    days,
    rows,
    groups,
    unassigned,
    totalCost:rows.reduce((sum,row)=>sum+row.cost,0),
  };
}

function feedReminderLabel(config) {
  const next=typeof feedPlanNextDueAt === 'function' ? feedPlanNextDueAt(config) : null;
  const due=typeof feedPlanIsDue === 'function' ? feedPlanIsDue(config) : !next || Date.now() >= next.getTime();
  if (due) return feedUiText('Heute fällig','Due now');
  return feedDate(next);
}

function feedRenderSummary(model,config) {
  const root=document.getElementById('feed-plan-summary');
  if (!root) return;
  const owner=String(config?.owner_name || '').trim();
  const rhythm=config.rhythm === 'monthly'
    ? feedUiText('Monatlich · 30 Tage','Monthly · 30 days')
    : feedUiText('Wöchentlich · 7 Tage','Weekly · 7 days');
  root.innerHTML=`
    <div class="settings-stat"><span>${feedUiText('Mein MDR-Name','My MDR username')}</span><strong>${owner ? feedEsc(owner) : '–'}</strong></div>
    <div class="settings-stat"><span>${feedUiText('Berücksichtigte Pferde','Included horses')}</span><strong>${feedNumber(model.active.length)}</strong></div>
    <div class="settings-stat"><span>${feedUiText('Bestellrhythmus','Order interval')}</span><strong>${feedEsc(rhythm)}</strong></div>
    <div class="settings-stat"><span>${feedUiText('Nächste Erinnerung','Next reminder')}</span><strong>${feedEsc(feedReminderLabel(config))}</strong></div>
  `;
}

function feedRenderTable(model) {
  const body=document.getElementById('feed-plan-body');
  if (!body) return;
  body.innerHTML=model.rows.map(row=>{
    const unit=row.unit === 'bale' ? feedUiText('Ballen','bales') : feedUiText('Säcke','bags');
    return `<tr>
      <td><strong>${feedEsc(feedProductName(row))}</strong></td>
      <td>${feedNumber(row.horseCount)}</td>
      <td>${feedNumber(row.quantity)} ${feedEsc(unit)}</td>
      <td>${feedNumber(row.price)} DD</td>
      <td><strong>${feedNumber(row.cost)} DD</strong></td>
    </tr>`;
  }).join('');
  const total=document.getElementById('feed-plan-total');
  if (total) total.textContent=`${feedNumber(model.totalCost)} DD`;
}

function feedRenderAssignments(model) {
  const root=document.getElementById('feed-plan-assignments');
  if (!root) return;
  const sections=[];
  for (const product of MDR_FEED_PRODUCTS.filter(p=>p.unit === 'bag')) {
    const horses=model.groups.get(product.id) || [];
    if (!horses.length) continue;
    sections.push(`<details class="feed-assignment-group">
      <summary><strong>${feedEsc(feedProductName(product))}</strong> · ${feedNumber(horses.length)} ${feedUiText('Pferde','horses')}</summary>
      <div class="feed-horse-list">${horses
        .sort((a,b)=>String(a?.name||'').localeCompare(String(b?.name||''),'de'))
        .map(h=>`<a href="view.html?id=${encodeURIComponent(h.id)}">${feedEsc(h.name || '(ohne Name)')}</a><span>${feedEsc(h.owner || '')}</span>`)
        .join('')}</div>
    </details>`);
  }
  if (model.unassigned.length) {
    sections.unshift(`<div class="notice warning feed-plan-warning"><strong>${feedUiText('Nicht zugeordnet','Unassigned')}:</strong> ${feedNumber(model.unassigned.length)} ${feedUiText('Pferde haben kein auswertbares Alter und keine vorrangige ZZL-/Cupstern-Regel. Für sie wurde bewusst kein Futter geraten.','horses have no usable age and no higher-priority licence/Cup-star rule. No feed was guessed for them.')}</div>`);
    sections.push(`<details class="feed-assignment-group" open>
      <summary><strong>⚠ ${feedUiText('Nicht zugeordnet','Unassigned')}</strong> · ${feedNumber(model.unassigned.length)}</summary>
      <div class="feed-horse-list">${model.unassigned.map(h=>`<a href="view.html?id=${encodeURIComponent(h.id)}">${feedEsc(h.name || '(ohne Name)')}</a><span>${feedEsc(h.owner || '')}</span>`).join('')}</div>
    </details>`);
  }
  root.innerHTML=sections.join('') || `<p class="muted">${feedUiText('Keine Pferde für den hinterlegten MDR-Namen gefunden.','No horses found for the configured MDR username.')}</p>`;
}

function feedRenderRules() {
  const root=document.getElementById('feed-plan-rules');
  if (!root) return;
  const rules=window.MDR_I18N?.language === 'en'
    ? [
      'Stallion with confirmed Cup star (≥ 50 starts and ≥ 15 wins in at least one discipline) → Combo Competition',
      'Mare with breeding licence → Broodmare Standard',
      'Stallion with breeding licence → Stallion Standard',
      'Under 2 years → Foal Standard',
      '2 through 4 years → Youngstock',
      'Over 4 years → Performance Gold',
      'Every included horse also needs hay and straw; one bale covers 30 horse-days.',
    ]
    : [
      'Hengst mit bestätigtem Cupstern (≥ 50 Starts und ≥ 15 Siege in mindestens einer Disziplin) → Kombifutter Turnier',
      'Stute mit ZZL → Zuchtstuten Standard',
      'Hengst mit ZZL → Deckhengste Standard',
      'Unter 2 Jahren → Fohlen Standard',
      '2 bis einschließlich 4 Jahre → Aufzucht Futter',
      'Über 4 Jahre → Sportpferde Gold',
      'Jedes berücksichtigte Pferd braucht zusätzlich Heu und Stroh; ein Ballen deckt 30 Pferdetage.',
    ];
  root.innerHTML=`<ol>${rules.map(x=>`<li>${feedEsc(x)}</li>`).join('')}</ol>`;
}

async function feedMarkCompleted() {
  const button=document.getElementById('feed-plan-complete');
  if (button) button.disabled=true;
  try {
    const dbKey=typeof feedPlanDbKey === 'function' ? feedPlanDbKey() : 'feed_plan_v1';
    const current=await localGet(LOCAL_STORES.userSettings,dbKey) || {key:dbKey};
    const next={
      ...current,
      key:dbKey,
      enabled:true,
      rhythm:current.rhythm === 'monthly' ? 'monthly' : 'weekly',
      last_completed_at:new Date().toISOString(),
      updated_at:new Date().toISOString(),
    };
    await localPut(LOCAL_STORES.userSettings,next);
    if (typeof persistFeedPlanLocal === 'function') persistFeedPlanLocal(next);
    await renderFeedPlanPage();
  } catch (error) {
    alert(feedUiText('Erinnerung konnte nicht aktualisiert werden: ','Reminder could not be updated: ') + error.message);
  } finally {
    if (button) button.disabled=false;
  }
}

async function renderFeedPlanPage() {
  const config=typeof getFeedPlanConfig === 'function' ? getFeedPlanConfig() : {enabled:false,rhythm:'weekly',last_completed_at:null};
  const disabled=document.getElementById('feed-plan-disabled');
  const content=document.getElementById('feed-plan-content');
  if (!config.enabled) {
    if (disabled) disabled.hidden=false;
    if (content) content.hidden=true;
    return;
  }
  if (disabled) disabled.hidden=true;
  if (content) content.hidden=false;

  const ownerName=String(config.owner_name || '').trim();
  const errorRoot=document.getElementById('feed-plan-error');
  if (!ownerName) {
    if (errorRoot) errorRoot.innerHTML=`${feedUiText('Bitte hinterlege unter Einstellungen zuerst deinen MDR-Namen.','Please set your MDR username under Settings first.')} <a href="einstellungen.html">${feedUiText('Zu den Einstellungen','Open Settings')}</a>`;
    return;
  }
  if (errorRoot) errorRoot.textContent='';

  const horses=await localGetAll(LOCAL_STORES.horses);
  const model=feedBuildModel(horses,config);
  feedRenderSummary(model,config);
  feedRenderTable(model);
  feedRenderAssignments(model);
  feedRenderRules();

  const due=typeof feedPlanIsDue === 'function' ? feedPlanIsDue(config) : true;
  const reminder=document.getElementById('feed-plan-reminder');
  if (reminder) {
    reminder.classList.toggle('feed-plan-reminder-due',due);
    reminder.innerHTML=due
      ? `<strong>🔔 ${feedUiText('Futterbestellung ist fällig.','Feed order is due.')}</strong> ${feedUiText('Prüfe die Mengen unten und markiere die Bestellung anschließend als erledigt.','Review the quantities below and then mark the order as completed.')}`
      : `<strong>✅ ${feedUiText('Aktueller Rhythmus läuft.','Current schedule is on track.')}</strong> ${feedUiText('Nächste Erinnerung:','Next reminder:')} ${feedEsc(feedReminderLabel(config))}`;
  }
}

async function initFeedPlanPage() {
  await requireSession();
  await renderSharedNav();
  document.getElementById('feed-plan-complete')?.addEventListener('click',feedMarkCompleted);
  try {
    await renderFeedPlanPage();
  } catch (error) {
    const root=document.getElementById('feed-plan-error');
    if (root) root.textContent=feedUiText('Futterabo konnte nicht berechnet werden: ','Feed plan could not be calculated: ') + error.message;
  }
}
