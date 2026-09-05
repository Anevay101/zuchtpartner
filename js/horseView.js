
let viewHorseId = null;
let viewHorseList = [];
let viewHorseIndex = -1;
let swipeStartX = null;
let viewSort = { field: 'name', dir: 'asc' };

document.addEventListener('DOMContentLoaded', initView);

function viewHorseKey(id) {
  const n = Number(id);
  return Number.isNaN(n) ? id : n;
}

function viewTagLabels(horse) {
  return (horse?.tags || []).map(t => typeof t === 'string' ? t : t?.label).filter(Boolean);
}

function viewImportantMissing(horse) {
  const missing = [];
  if (!horse?.external_id) missing.push('MDR-ID');
  if (!plannerHorseTalent(horse)) missing.push('Begabung');
  if (!horse?.disciplines || Object.keys(horse.disciplines).length < 1) missing.push('Disziplinwerte');
  if (!horse?.traits || Object.keys(horse.traits).length < 1) missing.push('Grundlagen/Gangarten');

  const isAppaloosa = /appaloosa|leopard|few\s*spot|blanket|snowcap|varnish|snowflake/i.test(`${horse?.coat_color || ''} ${horse?.appaloosa_pattern || ''}`);
  if (isAppaloosa) {
    const p1 = (horse?.colors || []).find(r => r?.label === 'PATN1');
    if (!p1?.value || /nicht getestet/i.test(String(p1.value))) missing.push('PATN1');
  }

  const hasLegacyCup = viewTagLabels(horse).includes('Cupstern');
  if (hasLegacyCup && !Object.keys(plannerCupResults(horse)).length) missing.push('Cup-Siege/Disziplin');
  return missing;
}

function renderHorseViewHeader(horse) {
  const chips = document.getElementById('horse-summary-chips');
  if (chips) {
    const age = horse?.birthdate ? viewAgeLabel(horse.birthdate) : null;
    const talent = plannerHorseTalent(horse);
    const group = plannerHorseMainGroup(horse);
    const stars = plannerCupStarRows(horse);
    const bits = [
      normalizeBreed(horse?.breed) || 'Rasselos',
      horse?.gender || null,
      age || null,
      group ? `${group}${talent ? ' / ' + talent : ''}` : talent || null,
      horse?.breeding_allowed === true ? 'ZZL ✓' : null,
      stars.length ? `⭐ ${stars.map(r=>r.discipline + (r.lk ? ' '+r.lk : '')).join(', ')}` : null,
    ];
    if (/hengst|stallion/i.test(String(horse?.gender || ''))) {
      bits.push(`Decktaxe: ${horse?.stud_fee == null || horse?.stud_fee === '' || Number(horse.stud_fee) === 0 ? 'kostenlos' : horse.stud_fee}`);
    }
    chips.innerHTML = bits.filter(Boolean).map(x => `<span>${plannerEscape(x)}</span>`).join('');
  }

  const missing = viewImportantMissing(horse);
  const missRoot = document.getElementById('horse-important-missing');
  if (missRoot) {
    missRoot.hidden = !missing.length;
    missRoot.innerHTML = missing.length ? `<strong>Noch ergänzen für vollständige Auswertung:</strong> ${missing.map(plannerEscape).join(' · ')}` : '';
  }

  const placeholder = document.getElementById('horse-image-placeholder');
  const image = document.getElementById('image-preview');
  if (placeholder) placeholder.hidden = Boolean(image && !image.hidden);
}

function viewDerived(horse) {
  const gpRaw = horse?.tournament_potential?.['Gesamtpotenzial'];
  return {
    gp: gpRaw != null && gpRaw !== '' ? Number(gpRaw) : null,
    ext: averageScore(horse?.exterior_descriptive, scoreExteriorTerm),
    extpct: horse?.exterior_genetics?.overall?.percent ?? null,
    int: averageScore(horse?.temperament, scoreTemperamentTerm),
  };
}
function viewSortValue(horse, field) {
  if (field === 'name') return String(horse?.name || '').toLocaleLowerCase('de');
  if (field === 'age') {
    if (!horse?.birthdate) return null;
    const t = new Date(horse.birthdate).getTime();
    return Number.isFinite(t) ? Date.now() - t : null;
  }
  if (field === 'updated_at') {
    const t = horse?.updated_at ? new Date(horse.updated_at).getTime() : NaN;
    return Number.isFinite(t) ? t : null;
  }
  return viewDerived(horse)[field] ?? null;
}
function sortViewHorseList() {
  const mult = viewSort.dir === 'desc' ? -1 : 1;
  viewHorseList.sort((a,b) => {
    const av=viewSortValue(a,viewSort.field), bv=viewSortValue(b,viewSort.field);
    if (av == null && bv == null) return String(a.name||'').localeCompare(String(b.name||''),'de');
    if (av == null) return 1; if (bv == null) return -1;
    const c = typeof av === 'string' ? av.localeCompare(bv,'de') : av-bv;
    return c ? c*mult : String(a.name||'').localeCompare(String(b.name||''),'de');
  });
  viewHorseIndex=viewHorseList.findIndex(h=>String(h.id)===String(viewHorseId));
}
function loadViewSortPreference() {
  try {
    const saved=JSON.parse(localStorage.getItem('mdr-horse-view-sort-v5367')||'null');
    const field=({birthdate:'age'})[saved?.field]||saved?.field;
    if (['name','age','updated_at','gp','ext','extpct','int'].includes(field)) viewSort={field,dir:saved?.dir==='desc'?'desc':'asc'};
  } catch {}
}
function wireViewSortControls() {
  const field=document.getElementById('view-sort-field'), dir=document.getElementById('view-sort-dir');
  if (!field || !dir) return;
  field.value=viewSort.field; dir.value=viewSort.dir;
  const apply=()=>{
    viewSort={field:field.value,dir:dir.value==='desc'?'desc':'asc'};
    try { localStorage.setItem('mdr-horse-view-sort-v5367',JSON.stringify({field:viewSort.field==='age'?'birthdate':viewSort.field,dir:viewSort.dir})); } catch {}
    sortViewHorseList();
  };
  field.addEventListener('change',apply); dir.addEventListener('change',apply);
}
function viewAgeLabel(birthdate) { return typeof formatAgeShort === 'function' ? formatAgeShort(birthdate) : formatAge(birthdate); }

async function initView() {
  const session = await requireSession();
  if (!session) return;
  await renderSharedNav(session);

  const params = new URLSearchParams(window.location.search);
  viewHorseId = params.get('id');
  if (!viewHorseId) { window.location.href = 'index.html'; return; }

  document.getElementById('edit-link').href = `horse.html?id=${encodeURIComponent(viewHorseId)}`;
  document.getElementById('delete-btn').addEventListener('click', onDeleteView);
  document.getElementById('prev-horse-btn').addEventListener('click', () => onNavigateView('prev'));
  document.getElementById('next-horse-btn').addEventListener('click', () => onNavigateView('next'));
  wireTabs();
  loadViewSortPreference();
  wireViewSortControls();

  viewHorseList = await localGetAll(LOCAL_STORES.horses);
  sortViewHorseList();

  await loadHorse(viewHorseId);
  if (!extraData?.id) return;

  document.getElementById('tag-badges').innerHTML = tagsBadgesHtml(extraData.tags, extraData.birthdate);
  document.getElementById('last-edited').textContent = extraData.updated_at ? `Zuletzt aktualisiert: ${formatTimestamp(extraData.updated_at)} · ${extraData.last_change_source || 'unbekannt'}` : '';
  document.getElementById('horse-age').textContent = extraData.birthdate ? `Alter: ${viewAgeLabel(extraData.birthdate)}` : '';

  const name = document.getElementById('name').value;
  document.getElementById('page-heading').textContent = '🐴 ' + (name || '(ohne Name)');
  document.title = (name || 'Pferd') + ' – MDR Pferdedatenbank lokal';

  renderHorseViewHeader(extraData);
  renderHorseTournamentProfile(extraData);
  if (typeof bpRenderBreedingPanel === 'function') await bpRenderBreedingPanel(extraData, 'breeding-progress-panel');

  const externalId = document.getElementById('external_id').value;
  const linkBtn = document.getElementById('mdr-link-btn');
  const missingLink = document.getElementById('mdr-link-missing');
  if (externalId) {
    const gameHost = (extraData.game_version || 'DE') === 'EN' ? 'www.morning-dust-ranch.com' : 'www.morning-dust-ranch.de';
    linkBtn.href = `https://${gameHost}/index2.php?site=pferd&id=${encodeURIComponent(externalId)}`;
    linkBtn.hidden = false;
    missingLink.hidden = true;
  } else {
    linkBtn.hidden = true;
    missingLink.hidden = false;
  }

  const swipe = document.getElementById('horse-swipe-area');
  swipe?.addEventListener('touchstart', e => { swipeStartX = e.changedTouches?.[0]?.clientX ?? null; }, {passive:true});
  swipe?.addEventListener('touchend', e => {
    if (swipeStartX == null) return;
    const endX = e.changedTouches?.[0]?.clientX;
    if (endX == null) return;
    const delta = endX - swipeStartX;
    swipeStartX = null;
    if (Math.abs(delta) < 70) return;
    onNavigateView(delta < 0 ? 'next' : 'prev');
  }, {passive:true});
}

async function onDeleteView() {
  if (!confirm('Dieses Pferd wirklich unwiderruflich löschen?')) return;
  try { await localDelete(LOCAL_STORES.horses, viewHorseKey(viewHorseId)); }
  catch (error) { document.getElementById('form-error').textContent = 'Löschen fehlgeschlagen: ' + error.message; return; }
  window.location.href = 'index.html';
}

async function onNavigateView(direction) {
  const errorEl = document.getElementById('form-error');
  errorEl.textContent = '';
  if (!viewHorseList.length) {
    viewHorseList = await localGetAll(LOCAL_STORES.horses);
    sortViewHorseList();
  }
  const adjacent = viewHorseList[direction === 'next' ? viewHorseIndex + 1 : viewHorseIndex - 1];
  if (!adjacent) {
    errorEl.textContent = direction === 'next' ? 'Kein weiteres Pferd (Ende der gewählten Sortierung).' : 'Kein vorheriges Pferd (Anfang der gewählten Sortierung).';
    return;
  }
  window.location.href = `view.html?id=${encodeURIComponent(adjacent.id)}`;
}
