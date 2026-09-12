document.addEventListener('DOMContentLoaded', initSettings);

const SETTINGS_SYSTEM_TAGS = new Set(['GBH','Cupstern','Zuchtstation']);

async function initSettings() {
  await requireSession();
  await renderSharedNav();

  wireSettingsBackup();
  await renderSettingsBackupOverview();
  document.getElementById('settings-save-last-filter').addEventListener('click', saveLastDatabaseFilterAsPreset);
  await renderPresetManager();
  await renderDashboardTileManager();
  await wireOverviewDisplaySettings();
  await wireFeedPlanSettings();
  await renderActiveBreedersManager();
  await ensureTagConfigInitialized();
  renderTagManager();
}


async function wireOverviewDisplaySettings() {
  const cb = document.getElementById('settings-show-best-foal');
  if (!cb) return;
  const row = await localGet(LOCAL_STORES.userSettings, 'settings');
  cb.checked = row?.show_best_foal_overview !== false;
  cb.addEventListener('change', async () => {
    const current = await localGet(LOCAL_STORES.userSettings, 'settings') || { key:'settings' };
    await localPut(LOCAL_STORES.userSettings, {
      ...current,
      key:'settings',
      show_best_foal_overview: cb.checked,
      updated_at:new Date().toISOString(),
    });
  });
}


function settingsFeedText(de,en) {
  return window.MDR_I18N?.language === 'en' ? en : de;
}

async function wireFeedPlanSettings() {
  const enabled=document.getElementById('settings-feed-plan-enabled');
  const rhythm=document.getElementById('settings-feed-plan-rhythm');
  const ownerInput=document.getElementById('settings-feed-plan-owner');
  const ownerList=document.getElementById('settings-feed-plan-owner-list');
  const status=document.getElementById('settings-feed-plan-status');
  const openLink=document.getElementById('settings-feed-plan-open');
  if (!enabled || !rhythm || !ownerInput) return;

  // Besitzer aus dem gemeinsamen Pferdebestand nur als komfortable Vorschläge.
  // Freie Eingabe bleibt möglich, damit ein neuer Account schon vor dem ersten
  // Pferdeimport korrekt konfiguriert werden kann.
  try {
    const horses=await localGetAll(LOCAL_STORES.horses);
    const owners=[...new Set(horses.map(h=>String(h?.owner||'').trim()).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'de'));
    if (ownerList) ownerList.innerHTML=owners.map(owner=>`<option value="${settingsEsc(owner)}"></option>`).join('');
  } catch (error) {
    console.warn('MDR-Namen konnten für das Futterabo nicht vorgeschlagen werden:',error);
  }

  const dbKey=typeof feedPlanDbKey === 'function' ? feedPlanDbKey() : 'feed_plan_v1';
  const row=await localGet(LOCAL_STORES.userSettings, dbKey);
  const config=typeof normalizeFeedPlanConfig === 'function'
    ? normalizeFeedPlanConfig(row || (typeof getFeedPlanConfig === 'function' ? getFeedPlanConfig() : null))
    : {enabled:row?.enabled === true,rhythm:row?.rhythm === 'monthly' ? 'monthly' : 'weekly',last_completed_at:row?.last_completed_at || null,owner_name:String(row?.owner_name||'').trim()};

  enabled.checked=config.enabled;
  rhythm.value=config.rhythm;
  ownerInput.value=config.owner_name || '';
  rhythm.disabled=!config.enabled;
  if (openLink) openLink.hidden=!config.enabled;

  const updateStatus=()=>{
    if (!status) return;
    const owner=String(ownerInput.value||'').trim();
    if (!enabled.checked) {
      status.textContent=settingsFeedText('Futterabo ist ausgeschaltet.','Feed plan is disabled.');
      return;
    }
    if (!owner) {
      status.textContent=settingsFeedText(
        'Bitte zuerst deinen MDR-Namen eintragen. Ohne Zuordnung wird kein Pferd für das Futterabo berücksichtigt.',
        'Please enter your MDR username first. Without this mapping, no horses are included in the feed plan.'
      );
      return;
    }
    const label=rhythm.value === 'monthly'
      ? settingsFeedText('monatlich (30 Tage)','monthly (30 days)')
      : settingsFeedText('wöchentlich (7 Tage)','weekly (7 days)');
    status.textContent=settingsFeedText(
      `Futterabo aktiv · MDR-Name: ${owner} · Rhythmus: ${label}. Berücksichtigt werden ausschließlich Pferde mit diesem Besitzer.`,
      `Feed plan active · MDR username: ${owner} · interval: ${label}. Only horses with this owner are included.`
    );
  };

  const save=async()=>{
    rhythm.disabled=!enabled.checked;
    if (openLink) openLink.hidden=!enabled.checked;
    const current=await localGet(LOCAL_STORES.userSettings, dbKey) || {key:dbKey};
    const nextRhythm=rhythm.value === 'monthly' ? 'monthly' : 'weekly';
    const nextOwner=String(ownerInput.value||'').trim();
    const previousOwner=String(current.owner_name || config.owner_name || '').trim();
    const previousRhythm=(current.rhythm === 'monthly' || current.rhythm === 'weekly') ? current.rhythm : (config.rhythm === 'monthly' ? 'monthly' : 'weekly');
    const planBasisChanged=previousOwner !== nextOwner || previousRhythm !== nextRhythm;
    const next={
      ...current,
      key:dbKey,
      enabled:enabled.checked,
      rhythm:nextRhythm,
      owner_name:nextOwner,
      // Restbestand ist an Besitzer + Rhythmus gekoppelt. Wird einer davon
      // geaendert, startet die Erinnerung bewusst neu statt Altbestand falsch
      // auf einen anderen Plan zu uebertragen.
      last_completed_at:planBasisChanged ? null : (current.last_completed_at || config.last_completed_at || null),
      carry_units:planBasisChanged ? {} : (current.carry_units || config.carry_units || {}),
      updated_at:new Date().toISOString(),
    };
    await localPut(LOCAL_STORES.userSettings,next);
    if (typeof persistFeedPlanLocal === 'function') persistFeedPlanLocal(next);
    updateStatus();
  };

  enabled.addEventListener('change',save);
  rhythm.addEventListener('change',save);
  ownerInput.addEventListener('change',save);
  ownerInput.addEventListener('blur',save);
  updateStatus();
}

function settingsEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

async function renderSettingsBackupOverview() {
  const root = document.getElementById('settings-backup-overview');
  if (!root) return;

  const [horses,pairings,handle] = await Promise.all([
    localGetAll(LOCAL_STORES.horses),
    localGetAll(LOCAL_STORES.pairings),
    getBackupDirectoryHandle().catch(() => null),
  ]);

  const lastServer = localStorage.getItem(MDR_LAST_SERVER_BACKUP_KEY);
  const lastExternal = localStorage.getItem(MDR_LAST_EXTERNAL_BACKUP_KEY);
  const zsCount = horses.filter(h => typeof mdrHasBreedingShowPoints === 'function' ? mdrHasBreedingShowPoints(h) : (h?.breeding_show_points !== null && h?.breeding_show_points !== undefined && String(h.breeding_show_points).trim() !== '' && Number(h.breeding_show_points) > 0)).length;
  const online = typeof mdrIsHostedOnlineOrigin === 'function' && mdrIsHostedOnlineOrigin();
  root.innerHTML = `
    <div class="settings-stat"><span>Gemeinsamer Bestand</span><strong>${horses.length} Pferde</strong></div>
    <div class="settings-stat"><span>Zuchtschau-Daten</span><strong>${zsCount} Pferde mit ZS-Punkten</strong></div>
    <div class="settings-stat"><span>Verpaarungen</span><strong>${pairings.length}</strong></div>
    <div class="settings-stat"><span>Externer Ordner</span><strong>${settingsEsc(handle?.name || 'nicht gewählt')}</strong></div>
    <div class="settings-stat"><span>Betriebsart</span><strong>${online ? 'Online / Browser-Speicher' : 'Lokaler Server'}</strong></div>
    <div class="settings-stat"><span>Externer Autosave</span><strong>${lastExternal ? externalBackupTimeLabel(lastExternal) : 'noch nicht bestätigt'}</strong></div>
  `;
}

function wireSettingsBackup() {
  document.getElementById('settings-backup-download').addEventListener('click', exportLocalBackup);
  document.getElementById('settings-learning-export')?.addEventListener('click', exportCleanLearningFile);
  document.getElementById('settings-backup-write').addEventListener('click', async () => {
    const ok = await writeExternalBackupNow('manuell über Einstellungen');
    alert(ok ? 'Sicherung wurde geschrieben und geprüft.' : 'Sicherung konnte nicht vollständig geschrieben werden. Bitte die Sicherheitsanzeige oben prüfen.');
    await renderSettingsBackupOverview();
  });
  document.getElementById('settings-folder-btn').addEventListener('click', async () => {
    await chooseBackupDirectory();
    await renderSettingsBackupOverview();
  });
  document.getElementById('settings-folder-authorize').addEventListener('click', async () => {
    await authorizeExistingBackupDirectory();
    await renderSettingsBackupOverview();
  });
  document.getElementById('settings-folder-forget').addEventListener('click', async () => {
    await forgetBackupDirectory();
    await renderSettingsBackupOverview();
  });

  const input = document.getElementById('settings-import-file');
  input.addEventListener('change', async (event) => {
    await importLocalBackupFromInput(event);
    await renderSettingsBackupOverview();
    await renderPresetManager();
    await renderDashboardTileManager();
  });
  document.getElementById('settings-import-btn').addEventListener('click', () => {
    input.value = '';
    input.click();
  });
}


function learningExportNorm(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');
}

function learningExportParentNames(horse) {
  const pedigree = horse?.pedigree;
  if (Array.isArray(pedigree)) {
    return pedigree.slice(1).map(x => typeof x === 'string' ? x : x?.name).filter(Boolean).slice(0,2);
  }
  if (pedigree && typeof pedigree === 'object') {
    return (pedigree.ancestors || []).map(x => typeof x === 'string' ? x : x?.name).filter(Boolean).slice(0,2);
  }
  return [];
}

function learningExportHasZs(horse) {
  const raw=horse?.breeding_show_points;
  if (raw === null || raw === undefined || String(raw).trim() === '') return false;
  const n=Number(raw);
  return Number.isFinite(n) && n > 0;
}

function learningExportCleanHorse(source) {
  const keep = [
    'name','game_version','gender','breed','breed_composition','purebred_pct','coat_color','appaloosa_pattern',
    'ico','disease_free','genetic_diseases','colors','color_gene_overrides','phenotype_gene_hints',
    'exterior_genetics','exterior_descriptive','temperament','disciplines','traits','tournament_potential',
    'pedigree','tournament_starts_total','tournament_results','cup_results','breeding_show_points','breeding_show_snapshot'
  ];
  const out = {};
  for (const key of keep) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== '') out[key] = typeof mdrImportClone === 'function' ? mdrImportClone(value) : JSON.parse(JSON.stringify(value));
  }

  const systemTags = (source?.tags || []).filter(tag => {
    const label = typeof tag === 'string' ? tag : tag?.label;
    const n = learningExportNorm(label);
    return n === 'gbh' || n === 'cupstern';
  });
  if (systemTags.length) out.tags = typeof mdrImportClone === 'function' ? mdrImportClone(systemTags) : JSON.parse(JSON.stringify(systemTags));

  out.owner = 'Lerndatei';
  out.learning_file = true;
  return out;
}

async function buildCleanLearningExportPayload() {
  if (typeof mdrEnsureLearningFileRules === 'function') await mdrEnsureLearningFileRules();
  const [horses, refs] = await Promise.all([
    localGetAll(LOCAL_STORES.horses),
    localGetAll(LOCAL_STORES.foalReferenceData),
  ]);

  // Echte Pferde haben bei gleichem Namen Vorrang vor reinen Fohlen-Referenzen.
  const byName = new Map();
  for (const row of [...horses, ...refs]) {
    const key = learningExportNorm(row?.name);
    if (key && !byName.has(key)) byName.set(key,row);
  }

  const required = new Set();
  for (const horse of horses) {
    if ((typeof mdrIsLearningHorse === 'function' && mdrIsLearningHorse(horse)) || horse?.learning_file === true) {
      const key = learningExportNorm(horse?.name);
      if (key) required.add(key);
    }
    if (learningExportHasZs(horse)) {
      const key = learningExportNorm(horse?.name);
      if (key) required.add(key);
    }
  }

  // Für die empirische Eltern→Fohlen-Schätzung werden vollständige Trios benötigt.
  for (const child of byName.values()) {
    const parents = learningExportParentNames(child);
    if (parents.length < 2) continue;
    const father = learningExportNorm(parents[0]);
    const mother = learningExportNorm(parents[1]);
    if (!byName.has(father) || !byName.has(mother)) continue;
    const childKey = learningExportNorm(child?.name);
    if (childKey) required.add(childKey);
    required.add(father);
    required.add(mother);
  }

  const cleanHorses = [...required]
    .map(key => byName.get(key))
    .filter(Boolean)
    .map(learningExportCleanHorse)
    .sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''),'de'));

  const zsRecords = cleanHorses.filter(learningExportHasZs).length;
  return {
    format: 'mdr-datenbank-local-backup',
    version: 4,
    exported_at: new Date().toISOString(),
    selection_export: true,
    learning_export: true,
    sanitized_learning_export: true,
    learning_export_note: 'Bereinigter Lernexport: nur lernrelevante Pferde/Fohlen; Besitzer=Lerndatei; keine persönlichen Verwaltungsdaten.',
    stores: {
      horses: cleanHorses,
      pairing_notes: [],
      pairings: [],
      foal_reference_data: [],
      user_settings: [],
      filter_presets: [],
      tag_suggestions: [],
    },
    learning_export_summary: {
      horses: cleanHorses.length,
      zs_records: zsRecords,
      source_horses: horses.length,
      source_foal_references: refs.length,
    },
  };
}

async function exportCleanLearningFile() {
  try {
    const payload = await buildCleanLearningExportPayload();
    const stamp = new Date().toISOString().slice(0,10);
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MDR-Lerndatei-bereinigt-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    alert(`Bereinigte Lerndatei erstellt: ${payload.learning_export_summary.horses} Pferde/Fohlen, davon ${payload.learning_export_summary.zs_records} mit echten ZS-Punkten. Besitzer aller exportierten Datensätze: Lerndatei.`);
  } catch (error) {
    alert('Lerndatei konnte nicht erstellt werden: ' + error.message);
  }
}

async function saveLastDatabaseFilterAsPreset() {
  let filters = null;
  try {
    filters = JSON.parse(localStorage.getItem('mdr-last-filter-state-v47') || 'null');
  } catch {}

  if (!filters || typeof filters !== 'object') {
    alert('Es wurde noch kein aktueller Datenbankfilter gespeichert. Bitte zuerst die Pferdedatenbank öffnen und dort filtern.');
    return;
  }

  const name = prompt('Name für diese Filter-Vorlage:');
  if (!name?.trim()) return;

  const all = await localGetAll(LOCAL_STORES.filterPresets);
  const existing = all.find(p =>
    String(p.name || '').toLocaleLowerCase('de') === name.trim().toLocaleLowerCase('de')
  );

  await localPut(LOCAL_STORES.filterPresets,{
    ...(existing || {}),
    user_id:LOCAL_SESSION.user.id,
    name:name.trim(),
    filters,
  });

  await renderPresetManager();
}

async function renderPresetManager() {
  const root = document.getElementById('settings-presets');
  const rows = (await localGetAll(LOCAL_STORES.filterPresets))
    .sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''),'de'));

  if (!rows.length) {
    root.innerHTML = '<p class="muted">Noch keine Filtervorlagen gespeichert.</p>';
    return;
  }

  root.innerHTML = `
    <div class="table-wrap">
      <table class="detail-table settings-table">
        <thead><tr><th>Name</th><th>Enthaltene Einstellungen</th><th>Aktionen</th></tr></thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              <td><strong>${settingsEsc(row.name || '(ohne Name)')}</strong></td>
              <td class="small muted">${settingsPresetSummary(row.filters)}</td>
              <td class="actions-cell">
                <button type="button" class="secondary small" data-preset-rename="${row.id}">Umbenennen</button>
                <button type="button" class="danger small" data-preset-delete="${row.id}">Löschen</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;

  root.querySelectorAll('[data-preset-rename]').forEach(btn => btn.addEventListener('click', async () => {
    const id = Number(btn.dataset.presetRename);
    const row = rows.find(x => Number(x.id) === id);
    if (!row) return;
    const name = prompt('Neuer Name der Filtervorlage:', row.name || '');
    if (!name?.trim()) return;
    row.name = name.trim();
    await localPut(LOCAL_STORES.filterPresets,row);
    await renderPresetManager();
    await renderDashboardTileManager();
  }));

  root.querySelectorAll('[data-preset-delete]').forEach(btn => btn.addEventListener('click', async () => {
    const id = Number(btn.dataset.presetDelete);
    const row = rows.find(x => Number(x.id) === id);
    if (!row) return;
    if (!confirm(`Filtervorlage „${row.name || 'ohne Name'}“ wirklich löschen?`)) return;
    await localDelete(LOCAL_STORES.filterPresets,id);
    const {tiles}=await getDashboardTilesSetting();
    const kept=tiles.filter(t=>String(t.preset_id)!==String(id));
    if(kept.length!==tiles.length) await saveDashboardTilesSetting(kept);
    await renderPresetManager();
    await renderDashboardTileManager();
  }));
}

const DASHBOARD_TILE_METRIC_LABELS = { count:'Anzahl Pferde', gp:'Ø GP', ext:'Ø Ext', extpct:'Ø Ext%', int:'Ø Int' };
async function getDashboardTilesSetting() {
  const row=await localGet(LOCAL_STORES.userSettings,'settings')||{key:'settings'};
  return {row,tiles:Array.isArray(row.dashboard_tiles)?row.dashboard_tiles:[]};
}
async function saveDashboardTilesSetting(tiles) {
  const {row}=await getDashboardTilesSetting();
  await localPut(LOCAL_STORES.userSettings,{...row,key:'settings',dashboard_tiles:tiles,updated_at:new Date().toISOString()});
}
async function renderDashboardTileManager() {
  const root=document.getElementById('settings-dashboard-tiles');
  const presetSelect=document.getElementById('settings-dashboard-tile-preset');
  const addBtn=document.getElementById('settings-dashboard-tile-add');
  if (!root||!presetSelect||!addBtn) return;
  const presets=(await localGetAll(LOCAL_STORES.filterPresets)).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'de'));
  const presetById=new Map(presets.map(p=>[String(p.id),p]));
  const {tiles}=await getDashboardTilesSetting();
  presetSelect.innerHTML='<option value="">Bitte wählen…</option>'+presets.map(p=>`<option value="${settingsEsc(p.id)}">${settingsEsc(p.name||'(ohne Name)')}</option>`).join('');
  root.innerHTML=tiles.length?`<div class="table-wrap"><table class="detail-table settings-table"><thead><tr><th>Titel</th><th>Filtervorlage</th><th>Kennzahl</th><th>Aktion</th></tr></thead><tbody>${tiles.map(tile=>{const preset=presetById.get(String(tile.preset_id));return `<tr><td><strong>${settingsEsc(tile.title||preset?.name||'Dashboard-Kachel')}</strong></td><td>${settingsEsc(preset?.name||'Vorlage nicht mehr vorhanden')}</td><td>${settingsEsc(DASHBOARD_TILE_METRIC_LABELS[tile.metric]||tile.metric||'Anzahl Pferde')}</td><td><button type="button" class="danger small" data-dashboard-tile-delete="${settingsEsc(tile.id)}">Löschen</button></td></tr>`;}).join('')}</tbody></table></div>`:'<p class="muted">Noch keine Dashboard-Kacheln angelegt.</p>';
  addBtn.onclick=async()=>{
    const presetId=presetSelect.value; if(!presetId){alert('Bitte zuerst eine Filtervorlage auswählen.');return;}
    const metric=document.getElementById('settings-dashboard-tile-metric')?.value||'count';
    const title=document.getElementById('settings-dashboard-tile-title')?.value.trim()||'';
    const {tiles:current}=await getDashboardTilesSetting(); const nextId=current.reduce((m,t)=>Math.max(m,Number(t.id)||0),0)+1;
    await saveDashboardTilesSetting([...current,{id:nextId,preset_id:presetId,metric,title}]);
    document.getElementById('settings-dashboard-tile-title').value=''; await renderDashboardTileManager();
  };
  root.querySelectorAll('[data-dashboard-tile-delete]').forEach(btn=>btn.addEventListener('click',async()=>{const id=String(btn.dataset.dashboardTileDelete);const {tiles:current}=await getDashboardTilesSetting();await saveDashboardTilesSetting(current.filter(t=>String(t.id)!==id));await renderDashboardTileManager();}));
}

function settingsPresetSummary(filters) {
  const f = filters || {};
  const bits = [];
  if (f.owner) bits.push(`Besitzer: ${settingsEsc(f.owner)}`);
  if (f.breed) bits.push(`Rasse: ${settingsEsc(f.breed)}`);
  if (f.gender) bits.push(`Geschlecht: ${settingsEsc(f.gender)}`);
  if (f.gameVersion) bits.push(`Version: ${settingsEsc(f.gameVersion)}`);
  if (f.breedingStation) bits.push(`Zuchtstation: ${f.breedingStation === 'true' ? 'Ja' : 'Nein'}`);
  if (f.dataQuality) bits.push(`Datenqualität: ${settingsEsc(f.dataQuality)}`);
  const triSummary=(label,value)=>{const t=typeof normalizeTriStateSavedState==='function'?normalizeTriStateSavedState(value):(Array.isArray(value)?{include:value,exclude:[]}:{include:[],exclude:[]});if(t.include.length)bits.push(`${label} +: ${t.include.map(settingsEsc).join(', ')}`);if(t.exclude.length)bits.push(`${label} −: ${t.exclude.map(settingsEsc).join(', ')}`);};
  triSummary('Tags',f.tags); triSummary('Genetik',f.genetik); triSummary('EKH',f.ekh);
  return bits.length ? bits.join(' · ') : 'Allgemeine/weitere Filtereinstellungen gespeichert';
}

async function renderActiveBreedersManager() {
  const root=document.getElementById('settings-active-breeders');
  if (!root) return;
  const horses=await localGetAll(LOCAL_STORES.horses);
  const owners=[...new Set(horses.map(h=>String(h.owner||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de'));
  const configured=getActiveBreeders();
  const selected=new Set(configured==null ? owners : configured);

  root.innerHTML=owners.length
    ? owners.map(owner=>`<label class="active-breeder-option"><input type="checkbox" value="${settingsEsc(owner)}" ${selected.has(owner)?'checked':''}> <span>${settingsEsc(owner)}</span></label>`).join('')
    : '<p class="muted">Noch keine Besitzer/Züchter in der Datenbank vorhanden.</p>';

  document.getElementById('active-breeders-all').onclick=()=>root.querySelectorAll('input[type="checkbox"]').forEach(cb=>cb.checked=true);
  document.getElementById('active-breeders-none').onclick=()=>root.querySelectorAll('input[type="checkbox"]').forEach(cb=>cb.checked=false);
  document.getElementById('active-breeders-save').onclick=saveActiveBreeders;

  const status=document.getElementById('active-breeders-status');
  if (status) status.textContent = configured==null
    ? 'Noch keine Einschränkung gespeichert – derzeit gelten alle Züchter als aktiv.'
    : `${configured.length} aktive Züchter gespeichert.`;
}

async function saveActiveBreeders() {
  const owners=[...document.querySelectorAll('#settings-active-breeders input[type="checkbox"]:checked')].map(cb=>cb.value);
  const dbKey=typeof activeBreedersDbKey === 'function' ? activeBreedersDbKey() : ACTIVE_BREEDERS_DB_KEY;
  const storageKey=typeof activeBreedersStorageKey === 'function' ? activeBreedersStorageKey() : ACTIVE_BREEDERS_STORAGE_KEY;
  await localPut(LOCAL_STORES.userSettings,{
    key:dbKey,
    owners,
    updated_at:new Date().toISOString(),
  });
  localStorage.setItem(storageKey,JSON.stringify(owners));
  const status=document.getElementById('active-breeders-status');
  if (status) status.textContent=`Gespeichert: ${owners.length} aktive Züchter. Dashboard, Turnierplaner und Aussortierhilfe nutzen diese Züchter. Rassefilter richten sich nach deren aktuellem Bestand; im Zuchtplaner stammen Stuten nur von aktiven Züchtern, Hengste dürfen fremden Besitzern gehören, wenn ihre Rasse bei einer aktiven Stute vorkommt.`;
}

async function ensureTagConfigInitialized() {
  const dbRow = await localGet(LOCAL_STORES.userSettings,HORSE_TAG_CONFIG_DB_KEY);
  if (Array.isArray(dbRow?.options) && dbRow.options.length) {
    localStorage.setItem(HORSE_TAG_CONFIG_STORAGE_KEY,JSON.stringify(dbRow.options));
    return;
  }

  const options = getHorseTagOptions();
  await localPut(LOCAL_STORES.userSettings,{
    key:HORSE_TAG_CONFIG_DB_KEY,
    options,
    updated_at:new Date().toISOString(),
  });
  localStorage.setItem(HORSE_TAG_CONFIG_STORAGE_KEY,JSON.stringify(options));
}

function settingsColorHex(color,label) {
  if (/^#[0-9a-f]{6}$/i.test(String(color || ''))) return color;
  return ({
    Verkauf:'#c84149',
    GBH:'#8a5fb0',
    Cupstern:'#4f83cc',
    Zuchtstation:'#6b9d00',
    Favorit:'#b48a22',
  })[label] || '#6b9d00';
}

function renderTagManager() {
  const root = document.getElementById('settings-tags');
  const options = getHorseTagOptions();

  root.innerHTML = `
    <div class="settings-tag-list">
      ${options.map((tag,index) => {
        const system = SETTINGS_SYSTEM_TAGS.has(tag.label);
        return `
          <div class="settings-tag-row" data-tag-index="${index}" data-old-label="${settingsEsc(tag.label)}">
            <input class="settings-tag-label" value="${settingsEsc(tag.label)}" ${system ? 'disabled' : ''} aria-label="Schlagwortname" />
            <input class="settings-tag-color" type="color" value="${settingsColorHex(tag.color,tag.label)}" aria-label="Farbe" />
            <span class="horse-tag-badge" style="background:${settingsColorHex(tag.color,tag.label)}">${settingsEsc(tag.label)}</span>
            ${system
              ? '<span class="small muted">System-Schlagwort</span>'
              : '<button type="button" class="danger small settings-tag-delete">Löschen</button>'}
          </div>`;
      }).join('')}
    </div>
    <div class="actions"><button id="settings-save-tags" type="button">Änderungen an Schlagwörtern speichern</button></div>
  `;

  document.getElementById('settings-save-tags').addEventListener('click',saveEditedTags);
  root.querySelectorAll('.settings-tag-delete').forEach(btn => btn.addEventListener('click',async () => {
    const row = btn.closest('.settings-tag-row');
    const oldLabel = row.dataset.oldLabel;
    if (!confirm(`Schlagwort „${oldLabel}“ löschen? Vorhandene Zuordnungen bei Pferden werden ebenfalls entfernt.`)) return;
    const next = getHorseTagOptions().filter(x => x.label !== oldLabel);
    await removeOrRenameHorseTag(oldLabel,null);
    await saveTagOptions(next);
    renderTagManager();
  }));
}

async function saveEditedTags() {
  const rows = [...document.querySelectorAll('.settings-tag-row')];
  const oldOptions = getHorseTagOptions();
  const next = [];
  const renames = [];

  for (const row of rows) {
    const oldLabel = row.dataset.oldLabel;
    const input = row.querySelector('.settings-tag-label');
    const label = String(input?.value || oldLabel).trim();
    const color = row.querySelector('.settings-tag-color')?.value || '#6b9d00';
    if (!label) {
      alert('Ein Schlagwort darf keinen leeren Namen haben.');
      return;
    }
    if (next.some(x => x.label.toLocaleLowerCase('de') === label.toLocaleLowerCase('de'))) {
      alert(`Das Schlagwort „${label}“ kommt doppelt vor.`);
      return;
    }
    next.push({label,color});
    if (oldLabel !== label && !SETTINGS_SYSTEM_TAGS.has(oldLabel)) renames.push([oldLabel,label]);
  }

  for (const [oldLabel,newLabel] of renames) {
    await removeOrRenameHorseTag(oldLabel,newLabel);
  }
  await saveTagOptions(next);
  alert('Schlagwörter wurden gespeichert.');
  renderTagManager();
}

async function removeOrRenameHorseTag(oldLabel,newLabel) {
  const [horses,presets] = await Promise.all([
    localGetAll(LOCAL_STORES.horses),
    localGetAll(LOCAL_STORES.filterPresets),
  ]);
  const oldKey = String(oldLabel).toLocaleLowerCase('de');

  for (const horse of horses) {
    const tags = Array.isArray(horse.tags) ? horse.tags : [];
    let changed = false;
    const nextTags = [];

    for (const tag of tags) {
      const label = typeof tag === 'string' ? tag : tag?.label;
      if (String(label || '').toLocaleLowerCase('de') !== oldKey) {
        nextTags.push(tag);
        continue;
      }
      changed = true;
      if (newLabel) {
        nextTags.push(typeof tag === 'string' ? newLabel : {...tag,label:newLabel});
      }
    }

    if (changed) await localPut(LOCAL_STORES.horses,{...horse,tags:nextTags,updated_at:new Date().toISOString()});
  }

  // Gespeicherte Filtervorlagen sollen nach einer Umbenennung/Löschung
  // nicht auf ein unsichtbares altes Schlagwort zeigen.
  for (const preset of presets) {
    const original=preset?.filters?.tags;
    const state=typeof normalizeTriStateSavedState==='function'?normalizeTriStateSavedState(original):(Array.isArray(original)?{include:original,exclude:[]}:{include:[],exclude:[]});
    const contains=[...state.include,...state.exclude].some(t=>String(t).toLocaleLowerCase('de')===oldKey);
    if(!contains) continue;
    const mapList=arr=>arr.flatMap(t=>String(t).toLocaleLowerCase('de')===oldKey?(newLabel?[newLabel]:[]):[t]);
    await localPut(LOCAL_STORES.filterPresets,{...preset,filters:{...preset.filters,tags:{include:mapList(state.include),exclude:mapList(state.exclude)}}});
  }
}

async function saveTagOptions(options) {
  // Systemschlagwörter dürfen nicht versehentlich verschwinden.
  const defaults = HORSE_TAG_DEFAULT_OPTIONS;
  for (const systemLabel of SETTINGS_SYSTEM_TAGS) {
    if (!options.some(x => x.label === systemLabel)) {
      options.push({...defaults.find(x => x.label === systemLabel)});
    }
  }

  await localPut(LOCAL_STORES.userSettings,{
    key:HORSE_TAG_CONFIG_DB_KEY,
    options,
    updated_at:new Date().toISOString(),
  });
  localStorage.setItem(HORSE_TAG_CONFIG_STORAGE_KEY,JSON.stringify(options));
}

document.getElementById('settings-add-tag')?.addEventListener('click',async () => {
  const label = document.getElementById('new-tag-label').value.trim();
  const color = document.getElementById('new-tag-color').value;
  if (!label) return;
  const options = getHorseTagOptions();
  if (options.some(x => x.label.toLocaleLowerCase('de') === label.toLocaleLowerCase('de'))) {
    alert('Dieses Schlagwort gibt es bereits.');
    return;
  }
  options.push({label,color});
  await saveTagOptions(options);
  document.getElementById('new-tag-label').value='';
  renderTagManager();
});
