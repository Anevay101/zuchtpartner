// MDR V54.0.61 – browserlokale Benchmarks aus MDR-Zuchtschau-Ergebnislisten.
// Absichtlich ohne Supabase-Zugriff: Import, Speicherung und Auswertung laufen nur lokal.
(() => {
  'use strict';

  const STORAGE_KEY = 'mdr-breeding-show-benchmarks-v1';
  const STORAGE_VERSION = 1;
  const MAX_STORED_SHOWS_PER_DATASET = 120;
  const BENCHMARK_WINDOW = 50;

  function cleanText(value) {
    return String(value ?? '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
  }

  function normalizeBreedName(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
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
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
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
      if (!gender) continue;
      return { breed: normalizeBreedName(m[1]), gender };
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
    let breed = header.breed;
    let gender = header.gender;
    let currentDate = '';
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
        scores: rows
          .filter(row => Number.isFinite(row.score))
          .sort((a,b) => a.place - b.place)
          .map(row => row.score),
      }))
      .filter(event => event.date && event.scores.length)
      .sort((a,b) => b.date.localeCompare(a.date));

    if (!occupiedEvents.length) throw new Error('Keine belegten Zuchtschauen mit Punkten gefunden.');
    return {
      breed,
      gender,
      events: occupiedEvents,
      shows: occupiedEvents.length,
      entries: occupiedEvents.reduce((sum,event) => sum + event.scores.length, 0),
    };
  }

  function safeLoad() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || parsed.version !== STORAGE_VERSION || !parsed.datasets || typeof parsed.datasets !== 'object') {
        return { version: STORAGE_VERSION, datasets: {} };
      }
      return parsed;
    } catch {
      return { version: STORAGE_VERSION, datasets: {} };
    }
  }

  function save(store) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  function datasetKey(breed, gender) {
    return `${String(breed || '').trim().toLocaleLowerCase('de')}::${gender}`;
  }

  function mergeBreedingShowDataset(parsed) {
    const store = safeLoad();
    const key = datasetKey(parsed.breed, parsed.gender);
    const previous = store.datasets[key] || { breed: parsed.breed, gender: parsed.gender, events: [] };
    const eventMap = new Map((previous.events || []).filter(e => e?.date && Array.isArray(e?.scores)).map(e => [e.date, e]));
    for (const event of parsed.events) eventMap.set(event.date, { date:event.date, scores:event.scores.map(Number).filter(Number.isFinite) });
    const events = [...eventMap.values()]
      .filter(event => event.scores.length)
      .sort((a,b) => b.date.localeCompare(a.date))
      .slice(0, MAX_STORED_SHOWS_PER_DATASET);
    store.datasets[key] = {
      breed: parsed.breed,
      gender: parsed.gender,
      events,
      importedAt: new Date().toISOString(),
    };
    save(store);
    return store.datasets[key];
  }

  function median(values) {
    const nums = (values || []).map(Number).filter(Number.isFinite).sort((a,b) => a-b);
    if (!nums.length) return null;
    const mid = Math.floor(nums.length / 2);
    return nums.length % 2 ? nums[mid] : (nums[mid-1] + nums[mid]) / 2;
  }

  function benchmarkFromDataset(dataset, windowSize = BENCHMARK_WINDOW) {
    const events = (dataset?.events || [])
      .filter(e => e?.date && Array.isArray(e?.scores) && e.scores.length)
      .sort((a,b) => b.date.localeCompare(a.date))
      .slice(0, Math.max(1, Number(windowSize) || BENCHMARK_WINDOW));
    if (!events.length) return null;
    const allScores = events.flatMap(e => e.scores.map(Number).filter(Number.isFinite));
    const winners = events.map(e => Number(e.scores[0])).filter(Number.isFinite);
    const thirdPlaces = events.filter(e => e.scores.length >= 3).map(e => Number(e.scores[2])).filter(Number.isFinite);
    return {
      breed: dataset.breed,
      gender: dataset.gender,
      shows: events.length,
      entries: allScores.length,
      fieldMedian: median(allScores),
      podiumMedian: median(thirdPlaces),
      winnerMedian: median(winners),
      podiumShows: thirdPlaces.length,
      newestDate: events[0]?.date || '',
      oldestDate: events[events.length-1]?.date || '',
      importedAt: dataset.importedAt || '',
    };
  }

  function getBenchmarks(gender = '') {
    const store = safeLoad();
    return Object.values(store.datasets || {})
      .filter(dataset => !gender || dataset.gender === gender)
      .map(dataset => benchmarkFromDataset(dataset))
      .filter(Boolean)
      .sort((a,b) => String(a.breed).localeCompare(String(b.breed), 'de'));
  }

  function formatScore(value) {
    if (!Number.isFinite(Number(value))) return '–';
    return Math.round(Number(value)).toLocaleString('de-DE');
  }

  function formatDate(value) {
    const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return value || '–';
    return `${m[3]}.${m[2]}.${m[1]}`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function t(value) {
    return typeof window.mdrT === 'function' ? window.mdrT(value) : value;
  }

  function renderBenchmarkDashboard(root, options = {}) {
    if (!root) return;
    const gender = options.gender || '';
    let rows = getBenchmarks(gender);
    if (!rows.length) {
      root.innerHTML = `<p class="muted small">${escapeHtml(t('Noch keine passende Ergebnisliste eingelesen.'))}</p>`;
      return;
    }
    const body = rows.map(row => {
      const range = row.oldestDate === row.newestDate ? formatDate(row.newestDate) : `${formatDate(row.oldestDate)}–${formatDate(row.newestDate)}`;
      return `<tr>
        <th>${escapeHtml(row.breed)}</th>
        <td><strong>${formatScore(row.fieldMedian)}</strong></td>
        <td><strong>${formatScore(row.podiumMedian)}</strong></td>
        <td><strong>${formatScore(row.winnerMedian)}</strong></td>
        <td><strong>${row.shows}</strong> ${escapeHtml(t('Schauen'))} · ${row.entries} ${escapeHtml(t('Meldungen'))}<br><span class="tiny muted">${escapeHtml(range)}</span></td>
      </tr>`;
    }).join('');
    root.innerHTML = `<div class="dashboard-zs-benchmark-head"><strong>${escapeHtml(t('Aktuelles Schau-Niveau'))}</strong><span class="tiny muted">${escapeHtml(t('Median der letzten bis zu 50 besetzten Schauen'))}</span></div>
      <div class="table-wrap"><table class="detail-table dashboard-zs-benchmark-table"><thead><tr>
        <th>${escapeHtml(t('Rasse'))}</th><th>${escapeHtml(t('Meldeniveau'))}</th><th>${escapeHtml(t('Podium'))}</th><th>${escapeHtml(t('Siegniveau'))}</th><th>${escapeHtml(t('Datengrundlage'))}</th>
      </tr></thead><tbody>${body}</tbody></table></div>
      <p class="tiny muted">${escapeHtml(t('Meldeniveau = Median aller Meldungen; Podium = typischer 3. Platz; Siegniveau = typischer Gewinner. Leere Schautage werden ignoriert.'))}</p>`;
  }

  function wireImportUi() {
    const toggle = document.getElementById('zs-import-toggle');
    const panel = document.getElementById('zs-import-panel');
    const cancel = document.getElementById('zs-import-cancel');
    const submit = document.getElementById('zs-import-submit');
    const text = document.getElementById('zs-import-text');
    const status = document.getElementById('zs-import-status');
    if (!toggle || !panel || !submit || !text) return;

    const setStatus = (message, type='') => {
      if (!status) return;
      status.textContent = message || '';
      status.className = `small dashboard-zs-import-status${type ? ` ${type}` : ''}`;
    };
    const close = () => { panel.hidden = true; toggle.setAttribute('aria-expanded','false'); };
    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
      if (!panel.hidden) setTimeout(() => text.focus(), 0);
    });
    cancel?.addEventListener('click', close);
    submit.addEventListener('click', () => {
      try {
        const parsed = parseBreedingShowDataset(text.value);
        mergeBreedingShowDataset(parsed);
        setStatus(`${parsed.breed} · ${parsed.gender === 'Stute' ? t('Stuten') : t('Hengste')}: ${parsed.shows} ${t('besetzte Schauen')}, ${parsed.entries} ${t('Meldungen')} ${t('eingelesen')}.`, 'success');
        text.value = '';
        try { window.dispatchEvent(new CustomEvent('mdr:breeding-show-benchmark-changed', { detail:{ breed:parsed.breed, gender:parsed.gender } })); } catch {}
      } catch (error) {
        setStatus(error?.message || String(error), 'error');
      }
    });
  }

  window.MDR_BREEDING_SHOW_BENCHMARK = {
    STORAGE_KEY,
    BENCHMARK_WINDOW,
    parse: parseBreedingShowDataset,
    merge: mergeBreedingShowDataset,
    getBenchmarks,
    benchmarkFromDataset,
    render: renderBenchmarkDashboard,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireImportUi, {once:true});
  else wireImportUi();
})();
