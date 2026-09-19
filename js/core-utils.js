/* MDR V54.0.75 – zentrale Spielwelt- und Pfadhelfer.
   Fachlogik bleibt in den jeweiligen Modulen; hier werden nur wiederkehrende
   Infrastrukturregeln gebündelt, damit DE/EN und interne Seitenpfade überall
   konsistent ausgewertet werden. */
(() => {
  'use strict';

  const ROUTES = Object.freeze({
    database: 'index.html',
    horse: 'horse.html',
    view: 'view.html',
    dashboard: 'dashboard.html',
    average: 'durchschnitt.html',
    breedingPlanner: 'zuchtplaner.html',
    pairing: 'verpaarung.html',
    tournament: 'turnierplaner.html',
    selection: 'aussortierhilfe.html',
    purchase: 'ankaufsberatung.html',
    guide: 'guide.html',
    settings: 'einstellungen.html',
    feed: 'futterabo.html',
    login: 'login.html',
  });

  function normalizeGameWorld(value, fallback = 'UNKNOWN') {
    const raw = String(value ?? '').trim().toUpperCase();
    if (raw === 'DE' || raw === 'EN') return raw;
    const fb = String(fallback ?? 'UNKNOWN').trim().toUpperCase();
    return fb === 'DE' || fb === 'EN' ? fb : 'UNKNOWN';
  }

  function horseGameWorld(horse, fallback = 'UNKNOWN') {
    const server = normalizeGameWorld(horse?.mdr_server);
    if (server !== 'UNKNOWN') return server;
    const version = normalizeGameWorld(horse?.game_version);
    if (version !== 'UNKNOWN') return version;
    return normalizeGameWorld(fallback);
  }

  function horseGameWorldConflict(horse) {
    const server = normalizeGameWorld(horse?.mdr_server);
    const version = normalizeGameWorld(horse?.game_version);
    return server !== 'UNKNOWN' && version !== 'UNKNOWN' && server !== version;
  }

  function horseGameHost(horse, fallback = 'DE') {
    return horseGameWorld(horse, fallback) === 'EN'
      ? 'www.morning-dust-ranch.com'
      : 'www.morning-dust-ranch.de';
  }

  function route(name, params = null, hash = '') {
    const file = ROUTES[name] || (String(name || '').endsWith('.html') ? String(name) : '');
    if (!file) throw new Error(`Unbekannte interne Route: ${name}`);
    const query = new URLSearchParams();
    if (params instanceof URLSearchParams) {
      for (const [key, value] of params.entries()) query.set(key, value);
    } else if (params && typeof params === 'object') {
      for (const [key, value] of Object.entries(params)) {
        if (value == null || value === '') continue;
        query.set(key, String(value));
      }
    }
    const queryString = query.toString();
    const suffix = queryString ? `?${queryString}` : '';
    const cleanHash = String(hash || '').replace(/^#/, '');
    return `${file}${suffix}${cleanHash ? `#${encodeURIComponent(cleanHash)}` : ''}`;
  }

  function currentPage() {
    return (location.pathname.split('/').pop() || ROUTES.database).toLowerCase();
  }

  const LOCAL_MIGRATION_PREFIX = 'mdr-local-migration-v1:';

  async function runLocalMigrationOnce(key, runner) {
    const storageKey = `${LOCAL_MIGRATION_PREFIX}${String(key || '').trim()}`;
    try {
      if (localStorage.getItem(storageKey)) return { skipped:true, migration:key };
    } catch {}
    const result = await runner();
    // Bei einem leeren/offline noch nicht gefüllten Cache nicht markieren:
    // dann darf die Migration beim nächsten Start mit Daten erneut laufen.
    const completed = result?.completed === true || Number(result?.scanned || 0) > 0;
    if (completed) {
      try { localStorage.setItem(storageKey, JSON.stringify({ completed_at:new Date().toISOString() })); } catch {}
    }
    return result;
  }

  function safeInternalRoute(value, fallback = 'database') {
    const fallbackFile = ROUTES[fallback] || ROUTES.database;
    const raw = String(value || '').trim();
    if (!raw || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return fallbackFile;
    const match = raw.match(/^([^?#/]+\.html)([?#].*)?$/i);
    if (!match) return fallbackFile;
    const allowed = new Set(Object.values(ROUTES).map(v => v.toLowerCase()));
    if (!allowed.has(match[1].toLowerCase())) return fallbackFile;
    return `${match[1]}${match[2] || ''}`;
  }

  const api = Object.freeze({
    routes: ROUTES,
    normalizeGameWorld,
    horseGameWorld,
    horseGameWorldConflict,
    horseGameHost,
    route,
    currentPage,
    safeInternalRoute,
    runLocalMigrationOnce,
  });

  window.MDR_CORE = api;
  window.mdrNormalizeGameWorld = normalizeGameWorld;
  window.mdrGameWorld = horseGameWorld;
  window.mdrGameWorldConflict = horseGameWorldConflict;
  window.mdrGameHost = horseGameHost;
  window.mdrRoute = route;
  window.mdrSafeInternalRoute = safeInternalRoute;
  window.mdrRunLocalMigrationOnce = runLocalMigrationOnce;
})();
