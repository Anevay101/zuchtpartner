
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
  const tournamentBonus = plannerTournamentShowBonus(horse);
  const cupBonus = plannerCupShowBonus(horse);
  const zsTotal = plannerBreedingShowPoints(horse);
  const zsBase = plannerBreedingShowBase(horse);

  const rows = Object.entries(results)
    .filter(([,row]) => row.first || row.second || row.third || row.cup_star)
    .sort((a,b) => Number(b[1].cup_star)-Number(a[1].cup_star) || Number(b[1].first)-Number(a[1].first) || a[0].localeCompare(b[0],'de'));

  const legacyCup = (horse?.tags || []).some(t => (typeof t === 'string' ? t : t?.label) === 'Cupstern');
  const summary = `
    <div class="cup-quick-summary">
      <span><strong>Starts:</strong> ${starts == null ? '–' : starts}</span>
      <span><strong>Platzierungen:</strong> ${plannerTournamentPlacements(horse)}</span>
      <span><strong>ZS-Turnierbonus:</strong> ${tournamentBonus}/500</span>
      <span><strong>Cupbonus:</strong> ${cupBonus}</span>
    </div>`;

  const zs = zsTotal == null ? '' : `
    <div class="breeding-show-mini">
      <strong>🌿 Zuchtschau:</strong> Gesamt ${Math.round(zsTotal)} · Turniere −${tournamentBonus} · Cup −${cupBonus} · <strong>Grundwert ${Math.round(zsBase)}</strong>
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

function renderHorseTournamentProfile(horse) {
  const root = document.getElementById('horse-tournament-profile');
  if (!root) return;

  const results = Object.keys(MDR_TOURNAMENT_DISCIPLINES || {})
    .map(name => htpScore(horse, name))
    .filter(Boolean)
    .sort((a,b) => b.points - a.points || (a.interior ?? 99) - (b.interior ?? 99));

  const talent = plannerHorseTalent(horse);
  const mainGroup = plannerHorseMainGroup(horse);

  if (!results.length) {
    root.innerHTML = `
      <p><strong>Hauptdisziplin:</strong> ${plannerEscape(mainGroup || '–')} · <strong>Begabung:</strong> ${plannerEscape(talent || '–')}</p>
      <p class="muted">Noch nicht genügend vollständige Turnierwerte vorhanden. Falls die Werte im Spiel vorhanden sind, Pferd bearbeiten und die Pferdeseite mit ausgeklappten Disziplinen erneut einlesen.</p>`;
    renderHorseCupStatus(horse);
    return;
  }

  const best = results[0];
  const grouped = MDR_TOURNAMENT_GROUP_ORDER.map(group => ({
    group,
    rows: results.filter(r => r.group === group),
  })).filter(x => x.rows.length);

  root.innerHTML = `
    <div class="planner-summary horse-tournament-summary">
      <p><strong>Hauptdisziplin:</strong> ${plannerEscape(mainGroup || best.group || '–')} · <strong>Begabung:</strong> ${plannerEscape(talent || '–')}</p>
      <p>Beste berechnete Disziplin: <strong>${plannerEscape(best.discipline)}</strong> · <strong>${Math.round(best.points)} Punkte</strong> · <strong>${plannerEscape(best.lk || '–')}</strong> · Interieur <strong>${best.interior == null ? '–' : best.interior.toFixed(2)}</strong></p>
    </div>
    <details class="horse-all-disciplines">
      <summary>Alle 28 Disziplinen anzeigen</summary>
      ${grouped.map(g => `
        <div class="group-heading">${plannerEscape(g.group)}</div>
        <div class="table-wrap"><table class="detail-table compact-tournament-table">
          <thead><tr><th>Disziplin</th><th>Punkte</th><th>Interieur</th><th>LK</th></tr></thead>
          <tbody>${g.rows.map(r=>`<tr><th>${plannerEscape(r.discipline)}</th><td>${Math.round(r.points)}</td><td>${r.interior == null ? '–' : r.interior.toFixed(2)}</td><td>${plannerEscape(r.lk || '–')}</td></tr>`).join('')}</tbody>
        </table></div>`).join('')}
    </details>`;
  renderHorseCupStatus(horse);
}
