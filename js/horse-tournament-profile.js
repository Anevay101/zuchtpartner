let HTP_RELATIVE_MODEL = null;
let HTP_RELATIVE_SOURCE = null;


function htpValueMap(horse) {
  const m = new Map();
  for (const src of [horse?.disciplines || {}, horse?.traits || {}]) {
    for (const rows of Object.values(src)) {
      for (const row of rows || []) {
        const val = Number(row?.potential);
        if (row?.name && Number.isFinite(val)) m.set(plannerNorm(row.name), val);
      }
    }
  }
  return m;
}

function htpInteriorMap(horse) {
  return new Map((horse?.temperament || []).map(r => [plannerNorm(r.label), r.value]));
}

function htpScore(horse, disciplineName) {
  const def = MDR_TOURNAMENT_DISCIPLINES?.[disciplineName];
  if (!def) return null;
  const vm = htpValueMap(horse);
  const vals = def.performance.map(n => vm.get(plannerNorm(n)));
  if (vals.some(v => !Number.isFinite(v))) return null;

  const points = 3 * vals[0] + vals.slice(1).reduce((a,b) => a+b, 0);
  const lk = plannerLKFromPotential(Math.min(...vals));
  const im = htpInteriorMap(horse);
  const iv = def.interior
    .map(n => scoreTemperamentTerm(im.get(plannerNorm(n))))
    .filter(v => v != null);

  return {
    discipline: disciplineName,
    group: def.group,
    points,
    lk,
    interior: iv.length === 3 ? iv.reduce((a,b) => a+b,0) / 3 : null,
  };
}

function renderHorseCupStatus(horse) {
  const root = document.getElementById('horse-cup-status');
  if (!root) return;

  const results = plannerTournamentResults(horse);
  const starts = plannerTournamentStarts(horse);
  const stars = plannerCupStarRows(horse);
  const currentTournamentBonus = plannerTournamentShowBonus(horse);
  const currentCupBonus = plannerCupShowBonus(horse);
  const zsTotal = plannerBreedingShowPoints(horse);
  const zsSnapshot = typeof plannerBreedingShowSnapshot === 'function' ? plannerBreedingShowSnapshot(horse) : null;
  const zsSnapshotDate = typeof plannerBreedingShowSnapshotDate === 'function' ? plannerBreedingShowSnapshotDate(horse) : null;
  const zsTournamentBonus = zsSnapshot ? Number(zsSnapshot.tournament_bonus || 0) : currentTournamentBonus;
  const zsCupBonus = zsSnapshot ? Number(zsSnapshot.cup_bonus || 0) : currentCupBonus;
  const zsBase = plannerBreedingShowBase(horse);

  const rows = Object.entries(results)
    .filter(([,row]) => row.first || row.second || row.third || row.cup_star)
    .sort((a,b) => Number(b[1].cup_star)-Number(a[1].cup_star) || Number(b[1].first)-Number(a[1].first) || a[0].localeCompare(b[0],'de'));

  const legacyCup = (horse?.tags || []).some(t => (typeof t === 'string' ? t : t?.label) === 'Cupstern');
  const summary = `
    <div class="cup-quick-summary">
      <span><strong>Starts:</strong> ${starts == null ? '–' : starts}</span>
      <span><strong>Platzierungen:</strong> ${plannerTournamentPlacements(horse)}</span>
      <span><strong>Aktueller Turnierbonus:</strong> ${currentTournamentBonus}/500</span>
      <span><strong>Aktueller Cupbonus:</strong> ${currentCupBonus}</span>
    </div>`;

  const zs = zsTotal == null ? '' : `
    <div class="breeding-show-mini">
      <strong>Zuchtschau:</strong> Gesamt ${Math.round(zsTotal)} · Bonusstand${zsSnapshotDate ? ` ${plannerEscape(new Date(`${zsSnapshotDate}T12:00:00`).toLocaleDateString('de-DE'))}` : ''}: Turniere −${zsTournamentBonus} · Cup −${zsCupBonus} · <strong>Grundwert ${Math.round(zsBase)}</strong>
    </div>`;

  if (!rows.length) {
    root.innerHTML = summary + zs + (legacyCup
      ? '<p class="small">⭐ Cupstern-Schlagwort ist vorhanden, aber Disziplin/LK wurden noch nicht strukturiert hinterlegt.</p>'
      : '<p class="small muted">Noch keine Turniererfolge oder Cupsterne eingelesen bzw. hinterlegt.</p>') +
      '<p class="tiny muted">Zum Ergänzen auf „Bearbeiten“ gehen: MDR-Reiter „Erfolge“ und/oder „Turniere“ einfügen; die Werte werden automatisch erkannt und können anschließend korrigiert werden.</p>';
    return;
  }

  root.innerHTML = `
    ${summary}
    ${zs}
    ${stars.length ? `<p><strong>⭐ Cupsterne:</strong> ${stars.map(r=>`${plannerEscape(r.discipline)}${r.lk ? ` (${plannerEscape(r.lk)})` : ''}`).join(' · ')}</p>` : ''}
    <div class="cup-status-grid">
      ${rows.map(([discipline,row]) => {
        const progress=plannerCupProgress(horse,discipline);
        const status=row.cup_star
          ? `⭐ Cupstern${row.cup_lk ? ' '+plannerEscape(row.cup_lk) : ''}`
          : progress.requirementsReached
            ? 'Grundvoraussetzungen erreicht'
            : `${row.first}/15 Siege${starts == null ? '' : ` · ${starts}/50 Starts`}`;
        return `
          <div class="cup-status-row ${row.cup_star ? 'cup-star-reached' : ''}">
            <strong>${plannerEscape(discipline)}</strong>
            <span>1.: ${row.first} · 2.: ${row.second} · 3.: ${row.third}</span>
            <span>${status}</span>
          </div>`;
      }).join('')}
    </div>
    <p class="tiny muted">Cupstern und Cup-LK werden aus „MDR-Cup Qualifikation“ automatisch übernommen und bleiben auf der Bearbeitungsseite korrigierbar; 15 Siege allein erzeugen keinen Cupstern.</p>`;
}

async function renderHorseTournamentProfile(horse, allHorsesArg = null) {
  const root=document.getElementById('horse-tournament-profile');
  if(!root)return;
  root.innerHTML='<p class="muted">Turnierprofil wird berechnet…</p>';

  let allHorses=Array.isArray(allHorsesArg)&&allHorsesArg.length?allHorsesArg:[horse];
  try {
    if((!Array.isArray(allHorsesArg)||!allHorsesArg.length)&&typeof localGetAll==='function'&&typeof LOCAL_STORES!=='undefined') {
      allHorses=await localGetAll(LOCAL_STORES.horses);
    }
  } catch(error){ console.warn('Turnierreferenzen konnten nicht vollständig geladen werden:',error); }

  // Keine neue Cloud-Abfrage: allHorses stammt bereits aus dem lokal synchronisierten Bestand.
  if(HTP_RELATIVE_SOURCE!==allHorses){
    HTP_RELATIVE_MODEL=plannerBuildTournamentRelativeModel(allHorses,htpScore);
    HTP_RELATIVE_SOURCE=allHorses;
  }
  const profile=plannerAnalyzeTournamentProfile(horse,allHorses,htpScore,{relativeModel:HTP_RELATIVE_MODEL});
  const talent=plannerHorseTalent(horse);
  const mainGroup=plannerHorseMainGroup(horse);

  if(!profile.rows.length){
    root.innerHTML=`<p><strong>Hauptbegabung:</strong> ${plannerEscape(mainGroup||'–')} · <strong>Begabung:</strong> ${plannerEscape(talent||'–')}</p><p class="muted">Noch nicht genügend vollständige Turnierwerte vorhanden. Falls die Werte im Spiel vorhanden sind, Pferd bearbeiten und die Pferdeseite mit ausgeklappten Disziplinen erneut einlesen.</p>`;
    renderHorseCupStatus(horse); return;
  }

  const mainBest=profile.bestMain;
  const secondaryMention=[...profile.recommendedSecondaryRows,...profile.situationalSecondaryRows]
    .sort((a,b)=>(Number(b.percentile)||-1)-(Number(a.percentile)||-1)||Number(b.points)-Number(a.points));
  const secondaryBest=secondaryMention[0]||null;

  const mainRows=profile.mainRows.length?profile.mainRows.map(r=>`<tr>
      <td>${plannerTournamentTrafficHtml(r)}</td><th>${plannerEscape(r.discipline)}${r.proven?' <span class="planner-badge tournament-secondary-badge">bewährt</span>':''}</th>
      <td>${Math.round(r.points)}</td><td>${plannerEscape(r.lk||'–')}</td><td><strong>${plannerTournamentRelativeHtml(r)}</strong></td><td>${plannerTournamentInteriorHtml(r)}</td>
    </tr>`).join(''):'<tr><td colspan="6" class="muted">Keine auswertbare Disziplin in der Hauptbegabung.</td></tr>';

  const secondaryRows=secondaryMention.length?secondaryMention.map(r=>`<tr>
      <td>${plannerTournamentTrafficHtml(r)}</td><th>${plannerEscape(r.discipline)}${r.proven?' <span class="planner-badge tournament-secondary-badge">bewährt</span>':''}</th>
      <td>${plannerEscape(r.group)}</td><td>${Math.round(r.points)}</td><td>${plannerEscape(r.lk||'–')}</td><td><strong>${plannerTournamentRelativeHtml(r)}</strong></td><td>${plannerTournamentInteriorHtml(r)}</td>
    </tr>`).join(''):'<tr><td colspan="7" class="muted">Keine Nebenbegabung ab P45 erkannt.</td></tr>';

  const grouped=MDR_TOURNAMENT_GROUP_ORDER.map(group=>({group,rows:profile.rows.filter(r=>r.group===group)})).filter(x=>x.rows.length);
  const allDetails=grouped.map(g=>`<div class="group-heading">${plannerEscape(g.group)}</div><div class="table-wrap"><table class="detail-table compact-tournament-table tournament-all-table">
      <thead><tr><th>Disziplin</th><th>Punkte</th><th>LK</th><th>Pxx</th><th>INT</th><th>Einordnung / Referenz</th></tr></thead><tbody>${g.rows.map(r=>`<tr>
        <th>${plannerEscape(r.discipline)}</th><td>${Math.round(r.points)}</td><td>${plannerEscape(r.lk||'–')}</td><td>${plannerTournamentRelativeHtml(r)}</td><td>${plannerTournamentInteriorHtml(r)}</td>
        <td>${plannerTournamentTrafficHtml(r)}<br><span class="tiny muted">${plannerEscape(plannerReferenceLabel(r.reference))}</span></td>
      </tr>`).join('')}</tbody></table></div>`).join('');

  root.innerHTML=`
    <div class="planner-summary horse-tournament-summary tournament-recommendation-card selectable-copy-area">
      <div class="tournament-recommendation-head"><div>
        <p class="tournament-recommendation-line"><strong>Hauptbegabung:</strong> ${plannerEscape(mainGroup||'–')} ${mainBest?'· '+plannerTournamentTrafficHtml(mainBest):''}</p>
        <p class="small"><strong>Begabung:</strong> ${plannerEscape(talent||'–')}</p>
      </div><button type="button" class="secondary small" id="horse-copy-tournament">Für Notizen kopieren</button></div>
      ${mainBest?`<p><strong>Stärkste Hauptdisziplin:</strong> ${plannerEscape(mainBest.discipline)} · ${Math.round(mainBest.points)} P. · ${plannerEscape(mainBest.lk||'LK –')} · ${plannerTournamentRelativeHtml(mainBest)} · INT ${plannerTournamentInteriorHtml(mainBest)}</p>`:''}
      <p class="small"><strong>Beste Nebenbegabung:</strong> ${secondaryBest?`${plannerEscape(secondaryBest.discipline)} · ${plannerTournamentRelativeHtml(secondaryBest)} · ${plannerTournamentTrafficHtml(secondaryBest)}`:'<span class="muted">keine auffällige ab P45</span>'}</p>
      <details class="tp-relative-help tp-relative-help-inline"><summary><span class="tp-info-dot">i</span> Pxx &amp; INT</summary><p class="tiny">Pxx vergleicht exakt dieselbe Disziplin und LK mit allen vollständig auswertbaren Pferden der lokalen Datenbank. Bei kleiner Stichprobe wird auf Gruppe+LK bzw. LK gesamt zurückgefallen. Hauptbegabung: P80+ sehr stark, P65–79 gut, P45–64 durchschnittlich. Nebenbegabung: P80+ Beritt sehr interessant, P65–79 interessant, P45–64 situativ. INT: ≤2,00 sehr gut, 2,01–2,50 gut machbar, &gt;2,50 mühsamer.</p></details>
    </div>

    <section class="tournament-compact-section selectable-copy-area"><h3>Hauptbegabung · ${plannerEscape(mainGroup||'–')}</h3>
      <div class="table-wrap"><table class="detail-table tournament-suitable-table"><thead><tr><th>Ampel</th><th>Disziplin</th><th>Punkte</th><th>LK</th><th>Pxx</th><th>INT</th></tr></thead><tbody>${mainRows}</tbody></table></div>
    </section>

    <section class="tournament-compact-section selectable-copy-area"><div class="tournament-section-head"><div><h3>Nebenbegabungen · Beritt prüfen</h3><p class="tiny muted">Nur P45+ wird hervorgehoben.</p></div><button type="button" class="secondary small" id="horse-copy-suitable">Empfehlungen kopieren</button></div>
      <div class="table-wrap"><table class="detail-table tournament-suitable-table"><thead><tr><th>Ampel</th><th>Disziplin</th><th>Gruppe</th><th>Punkte</th><th>LK</th><th>Pxx</th><th>INT</th></tr></thead><tbody>${secondaryRows}</tbody></table></div>
    </section>

    <details class="horse-all-disciplines tournament-all-details"><summary>Alle 28 Disziplinen anzeigen</summary>${allDetails}</details>`;

  document.getElementById('horse-copy-tournament')?.addEventListener('click',e=>plannerCopyText(plannerTournamentCopyText(profile),e.currentTarget));
  document.getElementById('horse-copy-suitable')?.addEventListener('click',e=>plannerCopyText(plannerSuitableTournamentCopyText(profile),e.currentTarget));
  renderHorseCupStatus(horse);
}

