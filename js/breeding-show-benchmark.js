// MDR V54.0.63 – gemeinsame, egress-sparsame Zuchtschau-Benchmarks.
// Cloudseitig wird bewusst KEIN neuer store_name angelegt: Die kompakten Shared-Datensätze
// liegen unter einem reservierten Key-Präfix im bereits erlaubten user_settings-Store.
// Pro Rasse + Geschlecht existiert genau ein Datensatz; gespeichert werden ausschließlich
// Datum + Punkteliste der letzten 50 belegten Schauen.
(() => {
  'use strict';

  const STORE_NAME = (typeof LOCAL_STORES !== 'undefined' && LOCAL_STORES.userSettings)
    ? LOCAL_STORES.userSettings
    : 'user_settings';
  const ROW_KEY_PREFIX = 'shared_zs_benchmark_v1::';
  const LEGACY_LOCAL_STORE = (typeof LOCAL_STORES !== 'undefined' && LOCAL_STORES.breedingShowBenchmarks)
    ? LOCAL_STORES.breedingShowBenchmarks
    : 'breeding_show_benchmarks';
  const LEGACY_STORAGE_KEY = 'mdr-breeding-show-benchmarks-v1';
  const MAX_STORED_SHOWS_PER_DATASET = 50;
  const BENCHMARK_WINDOW = 50;
  let sharedRows = [];
  let loaded = false;
  let loadPromise = null;
  let lastRender = null;

  function cleanText(value) {
    return String(value ?? '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
  }

  function normalizeBreedName(value) {
    const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
    try { return typeof normalizeBreed === 'function' ? (normalizeBreed(cleaned) || cleaned) : cleaned; }
    catch { return cleaned; }
  }

  function genderFromLabel(value) {
    const raw = String(value || '').toLowerCase();
    if (/mare|stute|pr[aä]mier/.test(raw)) return 'Stute';
    if (/stallion|hengst|k[oö]r/.test(raw)) return 'Hengst';
    return '';
  }

  function isoDate(value) {
    const m = String(value || '').trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (!m) return '';
    const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
    if (!(day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000)) return '';
    return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  function parseNumber(value) {
    const raw = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
    if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function parseHeader(lines) {
    for (const line of lines) {
      let m = line.match(/^Schwarzes Brett\s*-\s*(.+?)\s*-\s*(.+)$/i);
      if (!m) m = line.match(/^Notice Board\s*-\s*(.+?)\s*-\s*(.+)$/i);
      if (!m) continue;
      const gender = genderFromLabel(m[2]);
      if (gender) return { breed: normalizeBreedName(m[1]), gender };
    }
    return { breed: '', gender: '' };
  }

  function parseEventHeading(line) {
    const m = String(line || '').trim().match(/^(\d{1,2}[./]\d{1,2}[./]\d{4})\s*-\s*(.+)$/);
    if (!m) return null;
    const date = isoDate(m[1]);
    const gender = genderFromLabel(m[2]);
    return date && gender ? { date, gender } : null;
  }

  function parseBreedingShowDataset(text) {
    const raw = cleanText(text);
    if (!raw) throw new Error('Bitte zuerst den kopierten MDR-Seitentext einfügen.');
    const lines = raw.split('\n').map(line => line.trimEnd());
    const header = parseHeader(lines);
    let breed = header.breed, gender = header.gender, currentDate = '';
    const events = new Map();

    for (const line of lines) {
      const heading = parseEventHeading(line);
      if (heading) {
        currentDate = heading.date;
        if (!gender) gender = heading.gender;
        if (!events.has(currentDate)) events.set(currentDate, []);
        continue;
      }
      if (!currentDate || !line.includes('\t')) continue;
      const cols = line.split('\t').map(cell => cell.trim());
      if (cols.length < 2 || !/^\d+$/.test(cols[0])) continue;
      const place = Number(cols[0]);
      const score = parseNumber(cols[1]);
      if (!(place >= 1) || score == null) continue;
      if (!breed && cols[3]) breed = normalizeBreedName(cols[3]);
      const rowDate = cols.length >= 6 ? isoDate(cols[5]) : '';
      const date = rowDate || currentDate;
      if (!events.has(date)) events.set(date, []);
      events.get(date).push({ place, score });
    }

    breed = normalizeBreedName(breed);
    if (!breed) throw new Error('Rasse konnte aus der Ergebnisliste nicht erkannt werden.');
    if (!gender) throw new Error('Körung/Prämierung bzw. Stallions/Mares konnte nicht erkannt werden.');

    const occupiedEvents = [...events.entries()]
      .map(([date, rows]) => ({
        date,
        scores: rows.filter(row => Number.isFinite(row.score)).sort((a,b) => a.place-b.place).map(row => row.score),
      }))
      .filter(event => event.date && event.scores.length)
      .sort((a,b) => b.date.localeCompare(a.date));
    if (!occupiedEvents.length) throw new Error('Keine belegten Zuchtschauen mit Punkten gefunden.');
    return {
      breed, gender, events: occupiedEvents,
      shows: occupiedEvents.length,
      entries: occupiedEvents.reduce((sum,event) => sum + event.scores.length, 0),
    };
  }

  function datasetId(breed, gender) {
    return `${normalizeBreedName(breed).toLocaleLowerCase('de')}::${gender === 'Stute' ? 'm' : 's'}`;
  }

  function rowKey(breed, gender) { return `${ROW_KEY_PREFIX}${datasetId(breed, gender)}`; }
  function isBenchmarkRow(row) { return String(row?.key || '').startsWith(ROW_KEY_PREFIX); }
  function benchmarkRowsOnly(rows) { return (Array.isArray(rows) ? rows : []).filter(isBenchmarkRow); }

  // Kompaktes Cloudformat innerhalb user_settings:
  // key=reservierter Shared-Key, b=Rasse, g=Geschlecht, e=[[Datum,[Punkte...]], ...].
  function packDataset(dataset) {
    const events = (dataset?.events || [])
      .filter(e => e?.date && Array.isArray(e?.scores) && e.scores.length)
      .sort((a,b) => b.date.localeCompare(a.date))
      .slice(0, MAX_STORED_SHOWS_PER_DATASET)
      .map(e => [e.date, e.scores.map(Number).filter(Number.isFinite).map(n => Number.isInteger(n) ? n : Number(n.toFixed(2)))]);
    return { key: rowKey(dataset.breed, dataset.gender), b: normalizeBreedName(dataset.breed), g: dataset.gender, e: events };
  }

  function unpackDataset(row) {
    if (!row) return null;
    // V54.0.62 compact format.
    if (row.b && row.g && Array.isArray(row.e)) {
      return {
        breed: normalizeBreedName(row.b), gender: row.g,
        events: row.e.map(item => ({ date:String(item?.[0] || ''), scores:Array.isArray(item?.[1]) ? item[1].map(Number).filter(Number.isFinite) : [] }))
          .filter(e => e.date && e.scores.length)
          .sort((a,b) => b.date.localeCompare(a.date)),
      };
    }
    // Defensive compatibility with any uncompressed draft row.
    if (row.breed && row.gender && Array.isArray(row.events)) {
      return { breed:normalizeBreedName(row.breed), gender:row.gender, events:row.events };
    }
    return null;
  }

  function mergeDatasets(previous, incoming) {
    const map = new Map((previous?.events || []).filter(e => e?.date && Array.isArray(e.scores)).map(e => [e.date, e]));
    for (const event of incoming.events || []) {
      if (!event?.date || !Array.isArray(event.scores) || !event.scores.length) continue;
      map.set(event.date, { date:event.date, scores:event.scores.map(Number).filter(Number.isFinite) });
    }
    return {
      breed: normalizeBreedName(incoming.breed || previous?.breed),
      gender: incoming.gender || previous?.gender,
      events: [...map.values()].filter(e => e.scores.length).sort((a,b) => b.date.localeCompare(a.date)).slice(0, MAX_STORED_SHOWS_PER_DATASET),
    };
  }

  function median(values) {
    const nums = (values || []).map(Number).filter(Number.isFinite).sort((a,b) => a-b);
    if (!nums.length) return null;
    const mid = Math.floor(nums.length / 2);
    return nums.length % 2 ? nums[mid] : (nums[mid-1] + nums[mid]) / 2;
  }

  function benchmarkFromDataset(dataset, windowSize = BENCHMARK_WINDOW) {
    const events = (dataset?.events || []).filter(e => e?.date && Array.isArray(e?.scores) && e.scores.length)
      .sort((a,b) => b.date.localeCompare(a.date)).slice(0, Math.max(1, Number(windowSize) || BENCHMARK_WINDOW));
    if (!events.length) return null;
    const allScores = events.flatMap(e => e.scores.map(Number).filter(Number.isFinite));
    const winners = events.map(e => Number(e.scores[0])).filter(Number.isFinite);
    const thirdPlaces = events.filter(e => e.scores.length >= 3).map(e => Number(e.scores[2])).filter(Number.isFinite);
    return {
      breed:dataset.breed, gender:dataset.gender, shows:events.length, entries:allScores.length,
      fieldMedian:median(allScores), podiumMedian:median(thirdPlaces), winnerMedian:median(winners), podiumShows:thirdPlaces.length,
      newestDate:events[0]?.date || '', oldestDate:events[events.length-1]?.date || '',
    };
  }

  function datasetsFromRows(rows = sharedRows) { return rows.map(unpackDataset).filter(Boolean); }
  function getBenchmarks(gender = '') {
    return datasetsFromRows().filter(dataset => !gender || dataset.gender === gender)
      .map(dataset => benchmarkFromDataset(dataset)).filter(Boolean)
      .sort((a,b) => String(a.breed).localeCompare(String(b.breed), 'de'));
  }

  function applyRows(rows) {
    sharedRows = benchmarkRowsOnly(rows);
    loaded = true;
    return sharedRows;
  }

  async function refreshSharedRows({force=false}={}) {
    if (force && typeof mdrRefreshStore === 'function') {
      try { return applyRows(await mdrRefreshStore(STORE_NAME)); } catch (error) { console.warn('Zuchtschau-Benchmarks: Cloud-Abgleich fehlgeschlagen:', error); }
    }
    if (typeof localGetAll !== 'function') return applyRows([]);
    return applyRows(await localGetAll(STORE_NAME));
  }

  async function ensureLoaded() {
    if (loaded) return sharedRows;
    if (!loadPromise) loadPromise = (async() => {
      const rows = await refreshSharedRows();
      // V54.0.61 -> V54.0.62: eventuell bereits lokal importierte Daten einmalig gemeinsam übernehmen.
      await migrateLegacyLocal(rows).catch(error => console.warn('Lokale Zuchtschau-Benchmarks konnten nicht migriert werden:', error));
      return sharedRows;
    })().finally(() => { loadPromise = null; });
    return loadPromise;
  }

  async function migrateLegacyLocal(initialRows) {
    let legacy = null;
    try { legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || 'null'); } catch {}
    const legacyDatasets = legacy?.datasets && typeof legacy.datasets === 'object' ? Object.values(legacy.datasets) : [];

    // Falls V54.0.62 trotz abweichender Supabase-Constraint lokal Daten hinterlassen hat,
    // werden auch diese einmalig in das erlaubte user_settings-Namespace übernommen.
    let v62Rows = [];
    try { if (typeof idbGetAll === 'function' && LEGACY_LOCAL_STORE !== STORE_NAME) v62Rows = await idbGetAll(LEGACY_LOCAL_STORE); } catch {}
    const v62Datasets = (v62Rows || []).map(unpackDataset).filter(Boolean);
    const incomingLegacy = [...legacyDatasets, ...v62Datasets];
    if (!incomingLegacy.length) return;

    // Vor dem einmaligen Merge user_settings aktuell holen, damit kein Partner-Datensatz überschrieben wird.
    const rows = typeof mdrRefreshStore === 'function' ? await mdrRefreshStore(STORE_NAME) : (initialRows || []);
    const byId = new Map(benchmarkRowsOnly(rows).map(row => [String(row.key), row]));
    const changed = [];
    for (const legacyDataset of incomingLegacy) {
      if (!legacyDataset?.breed || !legacyDataset?.gender || !Array.isArray(legacyDataset.events)) continue;
      const key = rowKey(legacyDataset.breed, legacyDataset.gender);
      const previous = unpackDataset(byId.get(key));
      const merged = mergeDatasets(previous, legacyDataset);
      const packed = packDataset(merged);
      byId.set(key, packed);
      changed.push(packed);
    }
    if (changed.length) {
      if (typeof localBulkPut === 'function') await localBulkPut(STORE_NAME, changed, 100);
      else for (const row of changed) await localPut(STORE_NAME, row);
      applyRows([...byId.values()]);
    }
    try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch {}
    try { if (typeof idbClear === 'function' && LEGACY_LOCAL_STORE !== STORE_NAME) await idbClear(LEGACY_LOCAL_STORE); } catch {}
  }

  async function mergeBreedingShowDataset(parsed) {
    // Ein Import ist selten. Hier erzwingen wir einmal den kleinen Delta-Abgleich,
    // damit parallele Importe verschiedener Nutzer keine vorhandenen Tage verlieren.
    await refreshSharedRows({force:true});
    const key = rowKey(parsed.breed, parsed.gender);
    const previousRow = sharedRows.find(row => String(row?.key) === key);
    const merged = mergeDatasets(unpackDataset(previousRow), parsed);
    const packed = packDataset(merged);
    await localPut(STORE_NAME, packed); // exakt ein kleiner Upsert im bereits erlaubten user_settings-Store
    const next = sharedRows.filter(row => String(row?.key) !== key);
    next.push(packed);
    applyRows(next);
    return merged;
  }

  function formatScore(value) { return Number.isFinite(Number(value)) ? Math.round(Number(value)).toLocaleString('de-DE') : '–'; }
  function formatDate(value) {
    const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : (value || '–');
  }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function t(value) { return typeof window.mdrT === 'function' ? window.mdrT(value) : value; }

  function paintBenchmarkDashboard(root, options = {}) {
    if (!root) return;
    const rows = getBenchmarks(options.gender || '');
    if (!rows.length) {
      root.innerHTML = `<p class="muted small">${escapeHtml(t('Noch keine passende Ergebnisliste eingelesen.'))}</p>`;
      return;
    }
    const body = rows.map(row => {
      const range = row.oldestDate === row.newestDate ? formatDate(row.newestDate) : `${formatDate(row.oldestDate)}–${formatDate(row.newestDate)}`;
      return `<tr><th>${escapeHtml(row.breed)}</th><td><strong>${formatScore(row.fieldMedian)}</strong></td><td><strong>${formatScore(row.podiumMedian)}</strong></td><td><strong>${formatScore(row.winnerMedian)}</strong></td><td><strong>${row.shows}</strong> ${escapeHtml(t('Schauen'))} · ${row.entries} ${escapeHtml(t('Meldungen'))}<br><span class="tiny muted">${escapeHtml(range)}</span></td></tr>`;
    }).join('');
    root.innerHTML = `<div class="dashboard-zs-benchmark-head"><strong>${escapeHtml(t('Aktuelles Schau-Niveau'))}</strong><span class="tiny muted">${escapeHtml(t('Median der letzten bis zu 50 besetzten Schauen'))}</span></div><div class="table-wrap"><table class="detail-table dashboard-zs-benchmark-table"><thead><tr><th>${escapeHtml(t('Rasse'))}</th><th>${escapeHtml(t('Meldeniveau'))}</th><th>${escapeHtml(t('Podium'))}</th><th>${escapeHtml(t('Siegniveau'))}</th><th>${escapeHtml(t('Datengrundlage'))}</th></tr></thead><tbody>${body}</tbody></table></div><p class="tiny muted">${escapeHtml(t('Meldeniveau = Median aller Meldungen; Podium = typischer 3. Platz; Siegniveau = typischer Gewinner. Leere Schautage werden ignoriert.'))}</p>`;
  }

  async function renderBenchmarkDashboard(root, options = {}) {
    if (!root) return;
    lastRender = { root, options:{...options} };
    if (!loaded) root.innerHTML = `<p class="muted small">${escapeHtml(t('Lade…'))}</p>`;
    await ensureLoaded();
    paintBenchmarkDashboard(root, options);
  }

  function rerender() { if (lastRender?.root) paintBenchmarkDashboard(lastRender.root, lastRender.options || {}); }

  function wireImportUi() {
    const toggle=document.getElementById('zs-import-toggle'), panel=document.getElementById('zs-import-panel'), cancel=document.getElementById('zs-import-cancel'), submit=document.getElementById('zs-import-submit'), text=document.getElementById('zs-import-text'), status=document.getElementById('zs-import-status');
    if (!toggle || !panel || !submit || !text) return;
    const setStatus=(message,type='')=>{ if(status){status.textContent=message||'';status.className=`small dashboard-zs-import-status${type?` ${type}`:''}`;} };
    const close=()=>{panel.hidden=true;toggle.setAttribute('aria-expanded','false');};
    toggle.addEventListener('click',()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',panel.hidden?'false':'true');if(!panel.hidden)setTimeout(()=>text.focus(),0);});
    cancel?.addEventListener('click',close);
    submit.addEventListener('click',async()=>{
      if (submit.disabled) return;
      submit.disabled=true;
      try {
        const parsed=parseBreedingShowDataset(text.value);
        await mergeBreedingShowDataset(parsed);
        setStatus(`${parsed.breed} · ${parsed.gender==='Stute'?t('Stuten'):t('Hengste')}: ${parsed.shows} ${t('besetzte Schauen')}, ${parsed.entries} ${t('Meldungen')} ${t('gemeinsam gespeichert')}.`,'success');
        text.value=''; rerender();
        try{window.dispatchEvent(new CustomEvent('mdr:breeding-show-benchmark-changed',{detail:{breed:parsed.breed,gender:parsed.gender}}));}catch{}
      } catch(error) { setStatus(error?.message||String(error),'error'); }
      finally { submit.disabled=false; }
    });
  }

  window.addEventListener('mdr:store-refreshed', event => {
    if (event?.detail?.storeName !== STORE_NAME) return;
    if (typeof localGetAll === 'function') localGetAll(STORE_NAME).then(rows=>{applyRows(rows);rerender();}).catch(()=>{});
  });

  window.MDR_BREEDING_SHOW_BENCHMARK = { STORE_NAME, ROW_KEY_PREFIX, BENCHMARK_WINDOW, parse:parseBreedingShowDataset, merge:mergeBreedingShowDataset, getBenchmarks, benchmarkFromDataset, render:renderBenchmarkDashboard, refresh:refreshSharedRows };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wireImportUi,{once:true});else wireImportUi();
})();
