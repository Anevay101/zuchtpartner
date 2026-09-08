
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
  const root = document.getElementById('horse-tournament-profile');
  if (!root) return;

  root.innerHTML = '<p class="muted">Turnierprofil wird berechnet…</p>';

  let allHorses = Array.isArray(allHorsesArg) && allHorsesArg.length ? allHorsesArg : [horse];
  try {
    if ((!Array.isArray(allHorsesArg) || !allHorsesArg.length) && typeof localGetAll === 'function' && typeof LOCAL_STORES !== 'undefined') {
      allHorses = await localGetAll(LOCAL_STORES.horses);
    }
  } catch (error) {
    console.warn('Turnierreferenzen konnten nicht vollständig geladen werden:', error);
  }

  const talent = plannerHorseTalent(horse);
  const mainGroup = plannerHorseMainGroup(horse);
  const profile = plannerAnalyzeTournamentProfile(horse, allHorses, htpScore, {
    absoluteMin: plannerTournamentAbsoluteMin(150),
  });

  if (!profile.rows.length) {
    root.innerHTML = `
      <p><strong>Hauptdisziplin:</strong> ${plannerEscape(mainGroup || '–')} · <strong>Begabung:</strong> ${plannerEscape(talent || '–')}</p>
      <p class="muted">Noch nicht genügend vollständige Turnierwerte vorhanden. Falls die Werte im Spiel vorhanden sind, Pferd bearbeiten und die Pferdeseite mit ausgeklappten Disziplinen erneut einlesen.</p>`;
    renderHorseCupStatus(horse);
    return;
  }

  const best = profile.best;
  const alt = profile.alternatives[0] || null;
  const alternativeText = alt ? `${plannerEscape(alt.group)} · ${alt.count} geeignete Disziplinen${alt.provenCount ? ` · ${alt.provenCount} bewährt` : ''}` : 'keine';

  const groupRows = profile.groups.length
    ? profile.groups.map(g => {
        const statusBase = g.isMain ? 'Hauptdisziplin' : g.count >= 2 ? 'Alternative prüfen' : 'Einzeloption';
        const status = `${statusBase}${g.provenCount ? ` · ${g.provenCount} bewährt` : ''}`;
        return `<tr><th>${plannerEscape(g.group)}</th><td><strong>${g.count}</strong></td><td>${plannerEscape(status)}</td></tr>`;
      }).join('')
    : '<tr><td colspan="3" class="muted">Keine Hauptgruppe mit geeigneter Disziplin.</td></tr>';

  const suitableRows = profile.suitableRows.length
    ? profile.suitableRows.map(r => `<tr>
        <th>${plannerEscape(r.discipline)}${r.proven ? ' <span class="planner-badge tournament-secondary-badge">bewährt</span>' : ''}</th>
        <td>${plannerEscape(r.group)}</td>
        <td><strong>${Math.round(r.points)}</strong></td>
        <td>${r.interior == null ? '–' : r.interior.toFixed(2)}</td>
        <td>${plannerEscape(r.lk || '–')}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="muted">Keine geeignete Disziplin erkannt.</td></tr>';

  const grouped = MDR_TOURNAMENT_GROUP_ORDER.map(group => ({
    group,
    rows: profile.rows.filter(r => r.group === group),
  })).filter(x => x.rows.length);

  root.innerHTML = `
    <div class="planner-summary horse-tournament-summary tournament-recommendation-card selectable-copy-area">
      <div class="tournament-recommendation-head">
        <div>
          <p class="tournament-recommendation-line"><strong>Empfehlung:</strong> ${plannerEscape(profile.recommendation)}</p>
          <p><strong>Hauptdisziplin:</strong> ${plannerEscape(mainGroup || '–')} · <strong>Begabung:</strong> ${plannerEscape(talent || '–')}</p>
        </div>
        <button type="button" class="secondary small" id="horse-copy-tournament">Für Notizen kopieren</button>
      </div>
      <p>Beste Disziplin: <strong>${plannerEscape(best.discipline)}</strong> · <strong>${Math.round(best.points)} Punkte</strong> · Int <strong>${best.interior == null ? '–' : best.interior.toFixed(2)}</strong> · <strong>${plannerEscape(best.lk || '–')}</strong></p>
      <p class="small"><strong>Alternative:</strong> ${alternativeText}</p>
      <p class="tiny muted">Hauptdisziplin geeignet ab <strong>${Math.round(profile.mainMin)} Punkten</strong> · Nebendisziplinen ab <strong>${Math.round(profile.secondaryMin)} Punkten</strong>. Spezialisten-P25 dient nur als Vergleich und schließt keine Disziplin aus.</p>
    </div>

    <section class="tournament-compact-section selectable-copy-area">
      <h3>Hauptgruppenübersicht</h3>
      <div class="table-wrap"><table class="detail-table tournament-group-overview">
        <thead><tr><th>Hauptgruppe</th><th>Geeignet</th><th>Einordnung</th></tr></thead>
        <tbody>${groupRows}</tbody>
      </table></div>
    </section>

    <section class="tournament-compact-section selectable-copy-area">
      <div class="tournament-section-head"><h3>Geeignete Disziplinen</h3><button type="button" class="secondary small" id="horse-copy-suitable">Geeignete Disziplinen kopieren</button></div>
      <div class="table-wrap"><table class="detail-table tournament-suitable-table">
        <thead><tr><th>Disziplin</th><th>Gruppe</th><th>Punkte</th><th>Int</th><th>LK</th></tr></thead>
        <tbody>${suitableRows}</tbody>
      </table></div>
    </section>

    <details class="horse-all-disciplines tournament-all-details">
      <summary>Alle 28 Disziplinen anzeigen</summary>
      ${grouped.map(g => `
        <div class="group-heading">${plannerEscape(g.group)}</div>
        <div class="table-wrap"><table class="detail-table compact-tournament-table tournament-all-table">
          <thead><tr><th>Disziplin</th><th>Punkte</th><th>Interieur</th><th>LK</th><th>Referenz</th></tr></thead>
          <tbody>${g.rows.map(r=>`<tr>
            <th>${plannerEscape(r.discipline)}${r.proven ? ' <span class="planner-badge tournament-secondary-badge">bewährt</span>' : ''}</th>
            <td>${Math.round(r.points)}</td>
            <td>${r.interior == null ? '–' : r.interior.toFixed(2)}</td>
            <td>${plannerEscape(r.lk || '–')}</td>
            <td>${r.suitable
              ? `<strong>geeignet</strong><br><span class="tiny muted">${plannerEscape(plannerReferenceLabel(r.reference))}</span>`
              : `<span class="muted small">${plannerEscape(r.suitability?.reason || 'nicht geeignet')} (${Math.round(r.suitability?.minimum || 0)} P.)</span><br><span class="tiny muted">${plannerEscape(plannerReferenceLabel(r.reference))}</span>`}</td>
          </tr>`).join('')}</tbody>
        </table></div>`).join('')}
    </details>`;

  document.getElementById('horse-copy-tournament')?.addEventListener('click', e => plannerCopyText(plannerTournamentCopyText(profile), e.currentTarget));
  document.getElementById('horse-copy-suitable')?.addEventListener('click', e => plannerCopyText(plannerSuitableTournamentCopyText(profile), e.currentTarget));

  renderHorseCupStatus(horse);
}
