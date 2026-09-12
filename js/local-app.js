// MDR V54 – gemeinsamer Online-Bestand via Supabase.
const MDR_ONLINE_BUILD = true;

const LOCAL_SESSION = { user: null };
let mdrSessionPromise = null;
let mdrAccountUiWired = false;

const MDR_BACKUP_HANDLE_KEY = 'backup_directory_handle';
const MDR_LAST_EXTERNAL_BACKUP_KEY = 'mdr-last-external-backup';
const MDR_LAST_SESSION_BACKUP_KEY = 'mdr-last-session-backup';
const MDR_PENDING_BACKUP_KEY = 'mdr-external-backup-pending';
const MDR_SESSION_ARCHIVE_MARKER_KEY = 'mdr-session-archive-folder';
const MDR_SESSION_BACKUP_PREFIX = 'MDR-Sitzung-';
const MDR_MAX_SESSION_BACKUPS = 3;
const MDR_BACKUP_DEBOUNCE_MS = 2500;

// V41 – Schutz vor leeren/auffällig geschrumpften automatischen Sicherungen.
const MDR_AUTOSAVE_FILENAME = 'MDR-Autosave.json';
const MDR_LAST_GOOD_FILENAME = 'MDR-Letzte-gute-Sicherung.json';
const MDR_VERIFY_FILENAME = 'MDR-Autosave-Pruefung.tmp.json';
const MDR_LAST_GOOD_BACKUP_SUMMARY_KEY = 'mdr-last-good-backup-summary-v41';
const MDR_BACKUP_BLOCKED_KEY = 'mdr-backup-blocked-v41';
const MDR_BACKUP_DROP_RATIO = 0.65;
const MDR_BACKUP_DROP_MIN_HORSES = 20;
const MDR_BACKUP_ZS_DROP_MIN = 3;
const MDR_BACKUP_ZS_DROP_RATIO = 0.75;

// V42 – zusätzlicher Langzeit-Sicherheitsring.
// Ein Kandidat wird mindestens 3 Tage "reifen" gelassen. Nach 3 Tagen
// wird er als 3-Tage-Stand geschützt; nach 7 Tagen zusätzlich als
// 7-Tage-Stand. Erst danach beginnt ein neuer Kandidat.
const MDR_LONGTERM_CANDIDATE_FILENAME = 'MDR-Langzeit-Kandidat.json';
const MDR_LONGTERM_3D_FILENAME = 'MDR-Langzeit-mindestens-3-Tage.json';
const MDR_LONGTERM_7D_FILENAME = 'MDR-Langzeit-mindestens-7-Tage.json';
const MDR_DAY_MS = 24 * 60 * 60 * 1000;

// V46 – zusätzlicher serverseitiger Sicherheits-Spiegel.
// Er liegt direkt im MDR-Projektordner und ist deshalb auch dann lesbar,
// wenn Chrome seinen kompletten IndexedDB-/FileSystemHandle-Speicher
// überraschend leer startet.
const MDR_SERVER_BACKUP_ENDPOINT = '/__mdr_backup__';
const MDR_LAST_SERVER_BACKUP_KEY = 'mdr-last-server-backup-v46';
const MDR_STARTUP_RECOVERY_NOTICE_KEY = 'mdr-startup-recovery-notice-v46';

let mdrBackupTimer = null;
let mdrBackupRunning = false;
let mdrSafetyUiInitialized = false;
let mdrStartupPromise = null;

// Bis die Startprüfung abgeschlossen ist, darf KEIN Autosave/Sitzungsbackup
// einen möglicherweise leeren Browserstand sichern.
window.MDR_AUTO_BACKUP_SUSPENDED = true;

function mdrIsSafeLocalOrigin() {
  // Nur für den lokalen PowerShell-Server-Spiegel. Auf GitHub Pages gibt es
  // bewusst keinen Server-Endpunkt, die Nutzdaten bleiben im Browser.
  return location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname);
}

function mdrIsHostedOnlineOrigin() {
  return location.protocol === 'https:';
}

function mdrCanUseDirectoryBackup() {
  return typeof window.showDirectoryPicker === 'function' && window.isSecureContext === true;
}

function showFileProtocolBlocker() {
  if (document.getElementById('mdr-file-protocol-blocker')) return;
  const overlay = document.createElement('div');
  overlay.id = 'mdr-file-protocol-blocker';
  overlay.className = 'mdr-start-blocker';
  overlay.innerHTML = `
    <div class="mdr-start-blocker-card">
      <h1>Bitte über die Webadresse öffnen</h1>
      <p>Diese GitHub-Pages-Ausgabe wurde direkt als <code>file:///…</code> geöffnet.</p>
      <p><strong>In diesem Modus wird die Pferdedatenbank nicht geöffnet.</strong> Browser behandeln lokale Dateien anders als die veröffentlichte HTTPS-Seite und würden dadurch einen getrennten Datenspeicher verwenden.</p>
      <p>Öffne stattdessen die veröffentlichte GitHub-Pages-Adresse deiner Datenbank.</p>
      <p class="small muted">Die Anwendung wird über GitHub Pages geladen; der gemeinsame Pferdebestand liegt geschützt in Supabase.</p>
    </div>`;
  document.body.appendChild(overlay);
}


function mdrIsConfiguredMemberEmail(email) {
  const normalized=String(email||'').trim().toLowerCase();
  return Object.values(typeof MDR_LOGIN_USERS==='object' && MDR_LOGIN_USERS ? MDR_LOGIN_USERS : {})
    .map(x=>String(x||'').trim().toLowerCase())
    .includes(normalized);
}

async function mdrAwaitOnline(promiseLike,label='Online-Abfrage') {
  if (typeof mdrWithTimeout==='function') return mdrWithTimeout(promiseLike,6500,label);
  return promiseLike;
}

async function requireSession() {
  if (location.protocol === 'file:') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showFileProtocolBlocker, { once:true });
    else showFileProtocolBlocker();
    return new Promise(() => {});
  }

  if (mdrSessionPromise) return mdrSessionPromise;
  mdrSessionPromise = (async () => {
    let client;
    try { client = typeof mdrGetSupabaseClient==='function' ? await mdrGetSupabaseClient() : mdrCreateSupabaseClient(); }
    catch (error) {
      showOnlineConnectionBlocker(error.message);
      throw error;
    }

    let session=null;
    try {
      const { data, error } = await mdrAwaitOnline(client.auth.getSession(),'Supabase-Sitzung');
      if (error) console.warn('Supabase-Sitzung konnte nicht gelesen werden:', error);
      session = data?.session || null;
    } catch (error) {
      console.error('Supabase-Sitzung antwortet nicht:',error);
      showOnlineConnectionBlocker('Die Anmeldung konnte nicht rechtzeitig geprüft werden. Bitte Seite neu laden; deine lokalen Pferdedaten bleiben erhalten.');
      throw error;
    }
    if (!session?.user) {
      redirectToLogin();
      return new Promise(() => {});
    }

    // Mitgliedschaft regulär serverseitig prüfen. Bei einem reinen Timeout/
    // Netzfehler darf ein bereits gültiger, fest konfigurierter MDR-Account
    // jedoch mit seinem lokalen Lesecache starten. Eine explizite Antwort
    // „nicht freigeschaltet“ bleibt weiterhin ein harter Logout.
    try {
      const memberCheck = await mdrAwaitOnline(client.rpc('is_mdr_member'),'MDR-Mitgliedschaft');
      if (!memberCheck.error && memberCheck.data === true) {
        // alles regulär
      } else if (!memberCheck.error && memberCheck.data === false) {
        await client.auth.signOut().catch(()=>{});
        redirectToLogin('Zugriff auf die MDR-Datenbank nicht freigeschaltet.');
        return new Promise(() => {});
      } else if (mdrIsConfiguredMemberEmail(session.user.email)) {
        console.warn('MDR-Mitgliedschaft konnte online nicht bestätigt werden; lokaler Lesestart für bekannten MDR-Account.',memberCheck.error);
        window.MDR_DEGRADED_ONLINE_START = true;
      } else {
        throw memberCheck.error || new Error('MDR-Mitgliedschaft konnte nicht bestätigt werden.');
      }
    } catch (error) {
      if (mdrIsConfiguredMemberEmail(session.user.email)) {
        console.warn('MDR-Mitgliedsprüfung timeout/offline; lokaler Lesestart für bekannten MDR-Account.',error);
        window.MDR_DEGRADED_ONLINE_START = true;
      } else {
        showOnlineConnectionBlocker('Die MDR-Mitgliedschaft konnte nicht geprüft werden.');
        throw error;
      }
    }

    LOCAL_SESSION.user = {
      id: session.user.id,
      email: session.user.email || '',
    };

    // Startkonfiguration darf die eigentliche Pferdeanzeige nicht endlos
    // blockieren; lokale Einstellungen werden seit V54.0.36 sofort gelesen.
    await ensureMdrStartupReady();
    if (typeof plannerEnsureBreedingShowSnapshots === 'function') {
      try { await plannerEnsureBreedingShowSnapshots(); }
      catch (error) { console.warn('ZS-Snapshots konnten nicht vollständig ergänzt werden:', error); }
    }
    if (typeof mdrEnsureLearningFileRules === 'function') {
      try { await mdrEnsureLearningFileRules(); }
      catch (error) { console.warn('Lerndatei-Regeln konnten nicht angewendet werden:', error); }
    }
    wireLogout();
    return LOCAL_SESSION;
  })();
  return mdrSessionPromise;
}

function redirectToLogin(message='') {
  const current = `${location.pathname.split('/').pop() || 'index.html'}${location.search || ''}${location.hash || ''}`;
  const params = new URLSearchParams();
  params.set('next', current);
  if (message) params.set('message', message);
  location.replace(`login.html?${params.toString()}`);
}

function showOnlineConnectionBlocker(message) {
  if (document.getElementById('mdr-online-blocker')) return;
  const overlay=document.createElement('div');
  overlay.id='mdr-online-blocker';
  overlay.className='mdr-start-blocker';
  overlay.innerHTML=`<div class="mdr-start-blocker-card"><h1>Verbindung nicht möglich</h1><p>Die gemeinsame MDR-Datenbank konnte nicht gestartet werden.</p><p class="error">${String(message||'Unbekannter Fehler')}</p><p>Bitte Internetverbindung prüfen und die Seite neu laden.</p></div>`;
  document.body.appendChild(overlay);
}

function isAdminSession() { return true; }

function mdrDisplayNameFromSession() {
  const mail=String(LOCAL_SESSION?.user?.email || '').toLowerCase();
  if (mail === 'anevay@mdr.invalid') return 'Anevay';
  if (mail === 'saeculume@mdr.invalid') return 'Saeculume';
  return mail.split('@')[0] || 'MDR';
}

// Persönliche Besitzer-Zuordnung für nutzerspezifische Hinweise.
// Der gemeinsame Pferdebestand selbst bleibt für beide Konten vollständig sichtbar.
function mdrPersonalOwnerNames(session=LOCAL_SESSION) {
  const mail=String(session?.user?.email || '').trim().toLowerCase();
  if (mail === 'anevay@mdr.invalid') return ['Anevay', 'Wilder Wolf'];
  if (mail === 'saeculume@mdr.invalid') return ['Saeculume'];
  const fallback=mail.split('@')[0];
  return fallback ? [fallback] : [];
}

function mdrHorseBelongsToSession(horse, session=LOCAL_SESSION) {
  const owner=String(horse?.owner || '').trim().toLocaleLowerCase('de');
  if (!owner) return false;
  return mdrPersonalOwnerNames(session).some(name => String(name).trim().toLocaleLowerCase('de') === owner);
}

function mdrPersonalSettingKey(base, session=LOCAL_SESSION) {
  const mail=String(session?.user?.email || '').trim().toLowerCase();
  const slug=(mail.split('@')[0] || 'unknown').replace(/[^a-z0-9_-]+/g,'-');
  return `${base}:${slug}`;
}

// V54.0.52: persönliches, optionales Futterabo / Rhythmus-Erinnerung.
// Die Einstellung wird pro Login in user_settings gespeichert und zusätzlich
// lokal gespiegelt. Der Futterbedarf wird NICHT aus den aktiven Züchtern
// abgeleitet, sondern ausschließlich aus dem je Login hinterlegten MDR-Namen.
// MDR selbst wird dabei nicht automatisiert bedient.
const MDR_FEED_PLAN_SETTING_BASE = 'feed_plan_v1';
const MDR_FEED_PLAN_STORAGE_PREFIX = 'mdr-feed-plan-v1';

function feedPlanDbKey(session=LOCAL_SESSION) {
  return mdrPersonalSettingKey(MDR_FEED_PLAN_SETTING_BASE, session);
}

function feedPlanStorageKey(session=LOCAL_SESSION) {
  const mail=String(session?.user?.email || '').trim().toLowerCase();
  const slug=(mail.split('@')[0] || 'unknown').replace(/[^a-z0-9_-]+/g,'-');
  return `${MDR_FEED_PLAN_STORAGE_PREFIX}:${slug}`;
}

function feedPlanDefaultOwnerName(session=LOCAL_SESSION) {
  const mail=String(session?.user?.email || '').trim().toLowerCase();
  // Bestehende Accounts bekommen beim Upgrade eine sichere, eindeutige
  // Voreinstellung. Wilder Wolf gehört bewusst NICHT mehr zum Anevay-Futterabo.
  if (mail === 'anevay@mdr.invalid') return 'Anevay';
  if (mail === 'saeculume@mdr.invalid') return 'Saeculume';
  return '';
}

function normalizeFeedPlanConfig(value, session=LOCAL_SESSION) {
  const row=value && typeof value === 'object' ? value : {};
  const explicitOwner=String(row.owner_name || row.mdr_username || '').trim();
  return {
    enabled: row.enabled === true,
    rhythm: row.rhythm === 'monthly' ? 'monthly' : 'weekly',
    last_completed_at: row.last_completed_at || null,
    owner_name: explicitOwner || feedPlanDefaultOwnerName(session),
  };
}

function getFeedPlanConfig(session=LOCAL_SESSION) {
  try {
    const raw=localStorage.getItem(feedPlanStorageKey(session));
    return normalizeFeedPlanConfig(raw ? JSON.parse(raw) : null, session);
  } catch {
    return normalizeFeedPlanConfig(null, session);
  }
}

function feedPlanIntervalDays(config=getFeedPlanConfig()) {
  return config?.rhythm === 'monthly' ? 30 : 7;
}

function feedPlanNextDueAt(config=getFeedPlanConfig()) {
  if (!config?.enabled || !config?.last_completed_at) return null;
  const base=new Date(config.last_completed_at);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + feedPlanIntervalDays(config) * 86400000);
}

function feedPlanIsDue(config=getFeedPlanConfig()) {
  if (!config?.enabled) return false;
  const next=feedPlanNextDueAt(config);
  return !next || Date.now() >= next.getTime();
}

function persistFeedPlanLocal(config, session=LOCAL_SESSION) {
  const normalized=normalizeFeedPlanConfig(config, session);
  try { localStorage.setItem(feedPlanStorageKey(session), JSON.stringify(normalized)); } catch {}
  return normalized;
}

function wireLogout() {
  if (mdrAccountUiWired) return;
  const doWire=()=>{
    if (mdrAccountUiWired) return;
    const topbar=document.querySelector('.topbar');
    if (!topbar) return;
    const wrap=document.createElement('div');
    wrap.className='mdr-account-controls';
    wrap.innerHTML=`<span class="mdr-account-name">${mdrDisplayNameFromSession()}</span><button type="button" class="btn secondary mdr-logout-btn">Abmelden</button>`;
    topbar.appendChild(wrap);
    wrap.querySelector('.mdr-logout-btn')?.addEventListener('click',async()=>{
      try {
        if (typeof mdrClearCachedCloudData === 'function') await mdrClearCachedCloudData();
        await mdrCreateSupabaseClient().auth.signOut();
      } finally { location.replace('login.html'); }
    });
    mdrAccountUiWired=true;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',doWire,{once:true});
  else doWire();
}

function backupStoreCounts(payload) {
  const stores = payload?.stores || {};
  const counts = {};
  let totalRecords = 0;
  for (const [name, rows] of Object.entries(stores)) {
    const count = Array.isArray(rows) ? rows.length : 0;
    counts[name] = count;
    totalRecords += count;
  }
  return counts;
}

function mdrHasBreedingShowPoints(horse) {
  const value = horse?.breeding_show_points;
  if (value === null || value === undefined || String(value).trim() === '') return false;
  const n=Number(value);
  return Number.isFinite(n) && n > 0;
}

function backupSummary(payload) {
  const counts = backupStoreCounts(payload);
  const horses = Array.isArray(payload?.stores?.[LOCAL_STORES.horses])
    ? payload.stores[LOCAL_STORES.horses]
    : [];
  const zsRecords = horses.filter(mdrHasBreedingShowPoints).length;
  return {
    horses: Number(counts[LOCAL_STORES.horses] || 0),
    pairings: Number(counts[LOCAL_STORES.pairings] || 0),
    foal_reference_data: Number(counts[LOCAL_STORES.foalReferenceData] || 0),
    zs_records: Number(zsRecords || 0),
    total_records: Object.values(counts).reduce((sum, n) => sum + Number(n || 0), 0),
    stores: counts,
  };
}

async function sha256Text(text) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') return null;
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function attachBackupIntegrity(payload) {
  const summary = backupSummary(payload);
  const storesJson = JSON.stringify(payload?.stores || {});
  payload.backup_integrity = {
    schema: 1,
    checked_at: new Date().toISOString(),
    ...summary,
    sha256_stores: await sha256Text(storesJson),
  };
  return payload;
}

function isMdrBackupPayload(payload) {
  return !!(
    payload &&
    payload.format === 'mdr-datenbank-local-backup' &&
    payload.stores &&
    typeof payload.stores === 'object'
  );
}

function readStoredGoodSummary() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MDR_LAST_GOOD_BACKUP_SUMMARY_KEY) || 'null');
    return parsed && Number.isFinite(Number(parsed.horses)) ? parsed : null;
  } catch {
    return null;
  }
}

function saveStoredGoodSummary(summary) {
  localStorage.setItem(MDR_LAST_GOOD_BACKUP_SUMMARY_KEY, JSON.stringify({
    horses: Number(summary?.horses || 0),
    pairings: Number(summary?.pairings || 0),
    foal_reference_data: Number(summary?.foal_reference_data || 0),
    zs_records: Number(summary?.zs_records || 0),
    total_records: Number(summary?.total_records || 0),
    saved_at: new Date().toISOString(),
  }));
}

function setBackupBlocked(info) {
  localStorage.setItem(MDR_BACKUP_BLOCKED_KEY, JSON.stringify({
    ...info,
    blocked_at: new Date().toISOString(),
  }));
  localStorage.setItem(MDR_PENDING_BACKUP_KEY, '1');
}

function clearBackupBlocked() {
  localStorage.removeItem(MDR_BACKUP_BLOCKED_KEY);
}

function readBackupBlocked() {
  try {
    return JSON.parse(localStorage.getItem(MDR_BACKUP_BLOCKED_KEY) || 'null');
  } catch {
    return null;
  }
}

function mdrUtf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function readServerMirrorBackup() {
  if (!mdrIsSafeLocalOrigin()) return null;
  try {
    const response = await fetch(`${MDR_SERVER_BACKUP_ENDPOINT}?t=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!isMdrBackupPayload(payload)) return null;
    const summary = backupSummary(payload);
    return summary.horses > 0 ? payload : null;
  } catch (error) {
    console.warn('MDR Server-Sicherheits-Spiegel konnte nicht gelesen werden:', error);
    return null;
  }
}

async function writeServerMirrorBackup(payload) {
  if (!mdrIsSafeLocalOrigin() || !isMdrBackupPayload(payload)) return false;
  const summary = backupSummary(payload);
  if (summary.horses <= 0) return false;

  try {
    const json = JSON.stringify(payload);
    const response = await fetch(MDR_SERVER_BACKUP_ENDPOINT, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'text/plain; charset=us-ascii' },
      body: mdrUtf8ToBase64(json),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const result = await response.json().catch(() => ({}));
    if (result?.ok !== true) {
      throw new Error(result?.reason || 'Server bestätigte die Sicherung nicht.');
    }
    localStorage.setItem(MDR_LAST_SERVER_BACKUP_KEY, new Date().toISOString());
    return true;
  } catch (error) {
    console.warn('MDR Server-Sicherheits-Spiegel konnte nicht geschrieben werden:', error);
    return false;
  }
}

async function readStableLocalHorseCount() {
  // Drei kurze Kontrolllesungen: kein Ersatz für Persistenz, aber ein
  // zusätzlicher Schutz gegen einen noch nicht sauber geöffneten Browser-
  // Speicher direkt beim Start.
  const counts = [];
  for (let i = 0; i < 3; i++) {
    try {
      counts.push((await localGetAll(LOCAL_STORES.horses)).length);
    } catch (error) {
      counts.push(-1);
      console.warn('IndexedDB-Startprüfung fehlgeschlagen:', error);
    }
    if (i < 2) await new Promise(resolve => setTimeout(resolve, 120));
  }
  const nonNegative = counts.filter(n => n >= 0);
  return nonNegative.length ? Math.max(...nonNegative) : -1;
}

async function bestStartupRecoveryPayload() {
  const candidates = [];

  const server = await readServerMirrorBackup();
  if (server) {
    candidates.push({
      source: 'MDR-Server-Autosave.json',
      payload: server,
      summary: backupSummary(server),
      priority: 100,
      timestamp: backupPayloadTimestamp(server),
    });
  }

  // Falls das FileSystemHandle noch vorhanden ist, zusätzlich den externen
  // Autosave prüfen. Bei einem vollständigen Chrome-Speicherverlust ist
  // dieses Handle erwartungsgemäß weg – dafür existiert der Server-Spiegel.
  try {
    const handle = await getBackupDirectoryHandle();
    if (handle && await backupHandlePermission(handle, false) === 'granted') {
      for (const [name, priority] of [
        [MDR_AUTOSAVE_FILENAME, 110],
        [MDR_LAST_GOOD_FILENAME, 105],
      ]) {
        const payload = await readJsonFromDirectory(handle, name);
        if (!isMdrBackupPayload(payload)) continue;
        const summary = backupSummary(payload);
        if (summary.horses <= 0) continue;
        candidates.push({
          source: name,
          payload,
          summary,
          priority,
          timestamp: backupPayloadTimestamp(payload),
        });
      }
    }
  } catch (error) {
    console.warn('Externer Backup-Ordner konnte bei der Startprüfung nicht gelesen werden:', error);
  }

  candidates.sort((a, b) => {
    // Beim 0-Pferde-Start zählt zuerst der aktuelle Autosave-Typ und dessen
    // Aktualität – nicht einfach "möglichst viele Pferde". Sonst könnte ein
    // absichtlich verkleinerter, aber neuer Bestand von einem älteren,
    // größeren Langzeitstand überholt werden.
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
    return b.summary.horses - a.summary.horses;
  });
  return candidates[0] || null;
}

async function performAutomaticZeroHorseRecovery() {
  const localCount = await readStableLocalHorseCount();
  if (localCount !== 0) {
    if (localCount > 0) {
      const stored = readStoredGoodSummary();
      if (!stored || localCount >= Number(stored.horses || 0) * MDR_BACKUP_DROP_RATIO) {
        try {
          const current = backupSummary(await createLocalBackupPayload());
          saveStoredGoodSummary(current);
        } catch {}
      }
    }
    return { recovered: false, localCount };
  }

  const recovery = await bestStartupRecoveryPayload();
  if (!recovery || recovery.summary.horses <= 0) {
    return { recovered: false, localCount: 0, reason: 'no-recovery' };
  }

  console.warn(
    `MDR V46: leerer Startbestand erkannt. Stelle automatisch ${recovery.summary.horses} Pferde aus ${recovery.source} wieder her.`
  );

  await importBackupReplace(recovery.payload);

  const verifyPayload = await createLocalBackupPayload();
  const verify = backupSummary(verifyPayload);
  if (verify.horses !== recovery.summary.horses) {
    throw new Error(
      `Automatische Start-Wiederherstellung fehlgeschlagen: erwartet ${recovery.summary.horses}, gelesen ${verify.horses}.`
    );
  }

  saveStoredGoodSummary(verify);
  clearBackupBlocked();
  localStorage.setItem(MDR_PENDING_BACKUP_KEY, '1');
  localStorage.setItem(MDR_STARTUP_RECOVERY_NOTICE_KEY, JSON.stringify({
    restored_at: new Date().toISOString(),
    source: recovery.source,
    horses: verify.horses,
    pairings: verify.pairings,
  }));

  // Der wiederhergestellte Stand wird sofort wieder als lokaler Server-
  // Sicherheits-Spiegel bestätigt. Kein "Vor-Wiederherstellung"-Backup
  // mit 0 Pferden – der technische Leerstart ist kein wertvoller Datenstand.
  await writeServerMirrorBackup(verifyPayload);
  return { recovered: true, localCount: 0, source: recovery.source, summary: verify };
}

async function syncConfiguredHorseTagsFromDatabase() {
  try {
    const row = await localGet(LOCAL_STORES.userSettings, 'horse_tag_options_v47');
    if (Array.isArray(row?.options) && row.options.length) {
      localStorage.setItem('mdr-horse-tag-options-v47', JSON.stringify(row.options));
    }

    const breederDbKey = typeof activeBreedersDbKey === 'function'
      ? activeBreedersDbKey()
      : (typeof mdrPersonalSettingKey === 'function' ? mdrPersonalSettingKey('active_breeders_v54') : 'active_breeders_v48');
    const breeders = await localGet(LOCAL_STORES.userSettings, breederDbKey);
    const breederStorageKey = typeof activeBreedersStorageKey === 'function'
      ? activeBreedersStorageKey()
      : (typeof mdrPersonalSettingKey === 'function' ? `mdr-${mdrPersonalSettingKey('active-breeders-v54')}` : 'mdr-active-breeders-v48');
    if (Array.isArray(breeders?.owners)) {
      localStorage.setItem(breederStorageKey, JSON.stringify(breeders.owners));
    } else if (typeof mdrPersonalOwnerNames === 'function') {
      localStorage.setItem(breederStorageKey, JSON.stringify(mdrPersonalOwnerNames()));
    }


    const feedRow = await localGet(LOCAL_STORES.userSettings, feedPlanDbKey());
    if (feedRow && typeof feedRow === 'object') {
      persistFeedPlanLocal(feedRow);
    } else {
      persistFeedPlanLocal({ enabled:false, rhythm:'weekly', last_completed_at:null, owner_name:feedPlanDefaultOwnerName() });
    }
  } catch (error) {
    console.warn('Einstellungen konnten beim Start nicht vollständig synchronisiert werden:', error);
  }
}

async function ensureMdrStartupReady() {
  if (mdrStartupPromise) return mdrStartupPromise;

  mdrStartupPromise = (async () => {
    window.MDR_AUTO_BACKUP_SUSPENDED = true;
    try {
      // V54: Supabase ist die Quelle der Wahrheit. Bei leerem Cloud-Bestand
      // niemals automatisch eine lokale Sicherung hochladen. Der Erstimport
      // erfolgt bewusst über Einstellungen -> JSON-Backup importieren.
      await syncConfiguredHorseTagsFromDatabase();
      return { recovered:false, reason:'cloud-authoritative' };
    } catch (error) {
      console.error('MDR Online-Startprüfung fehlgeschlagen:', error);
      return { recovered:false, reason:'error', error };
    } finally {
      window.MDR_AUTO_BACKUP_SUSPENDED = false;
    }
  })();

  return mdrStartupPromise;
}

async function createLocalBackupPayload() {
  const payload = {
    format: 'mdr-datenbank-local-backup',
    version: 4,
    exported_at: new Date().toISOString(),
    stores: {},
  };

  // V54.0.18: Die Stores sind voneinander unabhängig. Parallel laden
  // reduziert besonders beim Sitzungs-/JSON-Backup die Wartezeit deutlich,
  // ohne die Sicherungslogik oder Supabase als Quelle der Wahrheit zu ändern.
  const storeEntries = await Promise.all(Object.values(LOCAL_STORES).map(async (storeName) => {
    let rows = await localGetAll(storeName);
    // Ein FileSystemDirectoryHandle gehört nur zu diesem Browser/PC und
    // ist kein sinnvoller Bestandteil einer portablen JSON-Sicherung.
    if (storeName === LOCAL_STORES.userSettings) {
      rows = rows.filter(row => row?.key !== MDR_BACKUP_HANDLE_KEY);
    }
    return [storeName, rows];
  }));
  for (const [storeName, rows] of storeEntries) payload.stores[storeName] = rows;

  await attachBackupIntegrity(payload);
  return payload;
}

function triggerJsonDownload(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportLocalBackup() {
  try {
    const payload = await createLocalBackupPayload();
    const summary = backupSummary(payload);
    if (summary.horses === 0) {
      const ok = confirm(
        '⚠️ Dieses manuelle Backup enthält 0 Pferde.\n\n' +
        'Die automatische Sicherung würde einen solchen Stand aus Sicherheitsgründen NICHT überschreiben. ' +
        'Möchtest du die 0-Pferde-Datei trotzdem nur als Download erstellen?'
      );
      if (!ok) return;
    }
    triggerJsonDownload(payload, `MDR-Backup-${new Date().toISOString().slice(0, 10)}.json`);
  } catch (error) {
    alert('Backup konnte nicht erstellt werden: ' + error.message);
  }
}

async function getBackupDirectoryRecord() {
  try {
    return await localGet(LOCAL_STORES.userSettings, MDR_BACKUP_HANDLE_KEY);
  } catch {
    return null;
  }
}

async function getBackupDirectoryHandle() {
  const row = await getBackupDirectoryRecord();
  return row?.handle || null;
}

async function backupHandlePermission(handle, request = false) {
  if (!handle) return 'denied';
  try {
    const opts = { mode: 'readwrite' };
    let state = await handle.queryPermission(opts);
    if (state !== 'granted' && request) state = await handle.requestPermission(opts);
    return state;
  } catch {
    return 'denied';
  }
}

async function writeJsonToDirectory(handle, filename, payload) {
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(JSON.stringify(payload, null, 2));
  } finally {
    await writable.close();
  }
}

async function readJsonFromDirectory(handle, filename) {
  try {
    const fileHandle = await handle.getFileHandle(filename, { create: false });
    const file = await fileHandle.getFile();
    return JSON.parse(await file.text());
  } catch (error) {
    if (error?.name === 'NotFoundError') return null;
    console.warn(`Backup-Datei ${filename} konnte nicht gelesen werden:`, error);
    return null;
  }
}

async function removeBackupFileIfPresent(handle, filename) {
  if (!handle?.removeEntry) return;
  try {
    await handle.removeEntry(filename);
  } catch (error) {
    if (error?.name !== 'NotFoundError') {
      console.warn(`Temporäre Backup-Datei ${filename} konnte nicht entfernt werden:`, error);
    }
  }
}

async function verifyWrittenBackup(handle, filename, expectedPayload) {
  const stored = await readJsonFromDirectory(handle, filename);
  if (!isMdrBackupPayload(stored)) {
    throw new Error(`${filename} konnte nach dem Schreiben nicht als gültiges MDR-Backup gelesen werden.`);
  }

  const expected = backupSummary(expectedPayload);
  const actual = backupSummary(stored);
  for (const key of ['horses', 'pairings', 'foal_reference_data', 'zs_records', 'total_records']) {
    if (Number(expected[key]) !== Number(actual[key])) {
      throw new Error(`${filename} stimmt nach dem Schreiben nicht mit dem aktuellen Datenbestand überein (${key}).`);
    }
  }

  const expectedHash = expectedPayload?.backup_integrity?.sha256_stores || await sha256Text(JSON.stringify(expectedPayload?.stores || {}));
  const actualHash = await sha256Text(JSON.stringify(stored?.stores || {}));
  if (expectedHash && actualHash && expectedHash !== actualHash) {
    throw new Error(`${filename} hat nach dem Schreiben eine abweichende Prüfsumme.`);
  }
  return stored;
}

async function normalizedBackupForSafetyCopy(payload) {
  if (!isMdrBackupPayload(payload)) return null;
  const clone = JSON.parse(JSON.stringify(payload));
  if (!clone.backup_integrity) await attachBackupIntegrity(clone);
  return clone;
}

async function backupBaseline(handle) {
  // Der zuletzt erfolgreich bestätigte Stand im Browser ist die primäre
  // Vergleichsbasis. Er bleibt absichtlich erhalten, selbst wenn die
  // IndexedDB bei einem späteren Start plötzlich leer erscheint.
  const stored = readStoredGoodSummary();
  if (stored?.horses > 0) {
    return { summary: stored, source: 'zuletzt bestätigte Sicherung' };
  }

  const autosave = await readJsonFromDirectory(handle, MDR_AUTOSAVE_FILENAME);
  if (isMdrBackupPayload(autosave)) {
    const summary = backupSummary(autosave);
    if (summary.horses > 0) return { summary, source: MDR_AUTOSAVE_FILENAME, payload: autosave };
  }

  const lastGood = await readJsonFromDirectory(handle, MDR_LAST_GOOD_FILENAME);
  if (isMdrBackupPayload(lastGood)) {
    const summary = backupSummary(lastGood);
    if (summary.horses > 0) return { summary, source: MDR_LAST_GOOD_FILENAME, payload: lastGood };
  }

  return { summary: null, source: null };
}

function backupPayloadTimestamp(payload) {
  const candidates = [
    payload?.exported_at,
    payload?.last_good_saved_at,
    payload?.session_archived_at,
    payload?.longterm_saved_at,
  ].filter(Boolean);
  for (const value of candidates) {
    const t = new Date(value).getTime();
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

async function recoveryBackupCandidates(handle) {
  const results = [];

  const server = await readServerMirrorBackup();
  if (server) {
    results.push({
      name: 'MDR-Server-Autosave.json',
      priority: 120,
      payload: server,
      summary: backupSummary(server),
      timestamp: backupPayloadTimestamp(server),
      source: 'server',
    });
  }

  if (!handle) return results;

  const fixed = [
    { name: MDR_AUTOSAVE_FILENAME, priority: 100 },
    { name: MDR_LAST_GOOD_FILENAME, priority: 95 },
    { name: MDR_LONGTERM_CANDIDATE_FILENAME, priority: 70 },
    { name: MDR_LONGTERM_3D_FILENAME, priority: 60 },
    { name: MDR_LONGTERM_7D_FILENAME, priority: 50 },
  ];

  for (const item of fixed) {
    const payload = await readJsonFromDirectory(handle, item.name);
    if (!isMdrBackupPayload(payload)) continue;
    const summary = backupSummary(payload);
    if (summary.horses <= 0) continue;
    results.push({
      ...item,
      payload,
      summary,
      timestamp: backupPayloadTimestamp(payload),
    });
  }

  // Sitzungsbackups als zusätzliche Rettungsquelle.
  if (handle.entries) {
    for await (const [name, entry] of handle.entries()) {
      if (entry?.kind !== 'file' || !isManagedSessionBackupFilename(name)) continue;
      const payload = await readJsonFromDirectory(handle, name);
      if (!isMdrBackupPayload(payload)) continue;
      const summary = backupSummary(payload);
      if (summary.horses <= 0) continue;
      let modified = 0;
      try {
        const file = await entry.getFile();
        modified = file.lastModified || 0;
      } catch {}
      results.push({
        name,
        priority: 80,
        payload,
        summary,
        timestamp: modified || backupPayloadTimestamp(payload),
      });
    }
  }

  return results;
}

async function findBestRecoveryBackup(handle, currentHorseCount = 0, expectedHorseCount = 0) {
  const candidates = await recoveryBackupCandidates(handle);
  const larger = candidates.filter((c) => c.summary.horses > Number(currentHorseCount || 0));
  if (!larger.length) return null;

  // Wenn die Sicherheitsmeldung einen vorherigen Bestand nennt, bevorzugen
  // wir Kandidaten, die mindestens diese Größe erreichen. Innerhalb dieser
  // Gruppe zählt zuerst die aktuelle/geschützte Backup-Art, dann Aktualität.
  const expected = Number(expectedHorseCount || 0);
  const sufficient = expected > 0
    ? larger.filter((c) => c.summary.horses >= expected)
    : [];
  const pool = sufficient.length ? sufficient : larger;

  pool.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
    return b.summary.horses - a.summary.horses;
  });
  return pool[0] || null;
}

function recoverySnapshotFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `MDR-Vor-Wiederherstellung-${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.json`;
}

async function restoreLastGoodBackup() {
  const blocked = readBackupBlocked();
  if (!blocked) return;

  const handle = await getBackupDirectoryHandle();
  let writableHandle = null;
  if (handle) {
    const permission = await backupHandlePermission(handle, true);
    if (permission === 'granted') writableHandle = handle;
  }

  const currentPayload = await createLocalBackupPayload();
  const currentSummary = backupSummary(currentPayload);
  const recovery = await findBestRecoveryBackup(
    writableHandle,
    currentSummary.horses,
    Number(blocked.previous_horses || 0)
  );

  if (!recovery) {
    alert(
      `Es wurde keine gültige größere Sicherung gefunden. ` +
      `Aktuell sind ${currentSummary.horses} Pferde in der lokalen Datenbank.`
    );
    return;
  }

  const canSaveBefore = currentSummary.horses > 0 && !!writableHandle;
  const ok = confirm(
    `↩ Letzte gute Sicherung wiederherstellen?\n\n` +
    `Aktueller lokaler Stand: ${currentSummary.horses} Pferd${currentSummary.horses === 1 ? '' : 'e'}\n` +
    `Wiederherstellung aus: ${recovery.name}\n` +
    `Darin enthalten: ${recovery.summary.horses} Pferde und ${recovery.summary.pairings} Verpaarungen\n\n` +
    (canSaveBefore
      ? 'Vorher wird der jetzige kleinere Stand zusätzlich als eigene Datei im Backup-Ordner gesichert.'
      : currentSummary.horses === 0
        ? 'Der technisch leere 0-Pferde-Stand wird nicht als zusätzliche Sicherungsdatei aufgehoben.'
        : 'Ohne freigegebenen externen Backup-Ordner kann der aktuelle kleinere Stand vorher nicht separat archiviert werden.')
  );
  if (!ok) return;

  try {
    let beforeName = null;
    if (canSaveBefore) {
      const beforeRestore = JSON.parse(JSON.stringify(currentPayload));
      beforeRestore.backup_kind = 'before_restore';
      beforeRestore.before_restore_note =
        `Automatisch gesichert unmittelbar vor der Wiederherstellung aus ${recovery.name}.`;
      await attachBackupIntegrity(beforeRestore);
      beforeName = recoverySnapshotFilename();
      await writeJsonToDirectory(writableHandle, beforeName, beforeRestore);
      await verifyWrittenBackup(writableHandle, beforeName, beforeRestore);
    }

    await importBackupReplace(recovery.payload);

    const restoredPayload = await createLocalBackupPayload();
    const restored = backupSummary(restoredPayload);
    if (restored.horses !== recovery.summary.horses) {
      throw new Error(
        `Kontrolle fehlgeschlagen: erwartet ${recovery.summary.horses} Pferde, nach Wiederherstellung wurden ${restored.horses} gelesen.`
      );
    }

    saveStoredGoodSummary(restored);
    clearBackupBlocked();
    localStorage.setItem(MDR_PENDING_BACKUP_KEY, '1');
    await writeServerMirrorBackup(restoredPayload);

    // Der wiederhergestellte größere Stand darf vorhandene externe Backups
    // anschließend regulär aktualisieren.
    await writeExternalBackupNow('nach Rückgängig/Wiederherstellung');

    alert(
      `Wiederherstellung erfolgreich.\n\n` +
      `${restored.horses} Pferde, ${restored.pairings} Verpaarungen und ${restored.zs_records || 0} ZS-Datensätze wurden aus „${recovery.name}“ wiederhergestellt.` +
      (beforeName ? `\nDer vorherige kleinere Stand wurde zusätzlich als „${beforeName}“ gesichert.` : '')
    );
    window.location.reload();
  } catch (error) {
    console.error('Wiederherstellung fehlgeschlagen:', error);
    alert('Wiederherstellung fehlgeschlagen: ' + error.message);
    await updateDataSafetyUi();
  }
}

async function checkAutomaticBackupSafety(handle, payload, { allowSmaller = false } = {}) {
  const current = backupSummary(payload);
  const baseline = await backupBaseline(handle);

  // Ein automatisches 0-Pferde-Backup ist NIE sinnvoll. Selbst bei einer
  // ganz neuen leeren Datenbank wird dadurch nichts Wertvolles gesichert.
  if (current.horses === 0) {
    return {
      ok: false,
      code: 'zero-horses',
      current,
      baseline: baseline.summary,
      source: baseline.source,
      message: baseline.summary?.horses
        ? `Aktuell wurden 0 Pferde gelesen, die letzte gute Sicherung hatte ${baseline.summary.horses}.`
        : 'Aktuell wurden 0 Pferde gelesen. Eine leere automatische Sicherung wird grundsätzlich nicht geschrieben.',
    };
  }

  if (!allowSmaller && baseline.summary?.horses >= MDR_BACKUP_DROP_MIN_HORSES) {
    const previous = Number(baseline.summary.horses);
    const drop = previous - current.horses;
    const ratio = current.horses / previous;
    if (drop >= MDR_BACKUP_DROP_MIN_HORSES && ratio < MDR_BACKUP_DROP_RATIO) {
      return {
        ok: false,
        code: 'large-drop',
        current,
        baseline: baseline.summary,
        source: baseline.source,
        message:
          `Der aktuelle Stand hat nur ${current.horses} ${current.horses === 1 ? 'Pferd' : 'Pferde'}; die letzte gute Sicherung hatte ${previous}. ` +
          `Der Rückgang um ${drop} Pferde ist zu groß für ein automatisches Überschreiben.`,
      };
    }
  }

  // V53.4: Zuchtschaudaten werden unabhängig von der Pferdeanzahl geschützt.
  // Ein technischer Verlust der manuell erfassten ZS-Punkte darf also keinen
  // scheinbar vollständigen Autosave mit gleicher Pferdezahl überschreiben.
  if (!allowSmaller && Number(baseline.summary?.zs_records || 0) >= MDR_BACKUP_ZS_DROP_MIN) {
    const previousZs = Number(baseline.summary.zs_records || 0);
    const currentZs = Number(current.zs_records || 0);
    const dropZs = previousZs - currentZs;
    const ratioZs = previousZs > 0 ? currentZs / previousZs : 1;
    if (dropZs >= MDR_BACKUP_ZS_DROP_MIN && ratioZs < MDR_BACKUP_ZS_DROP_RATIO) {
      return {
        ok: false,
        code: 'zs-drop',
        current,
        baseline: baseline.summary,
        source: baseline.source,
        message:
          `Aktuell wurden nur ${currentZs} Pferde mit ZS-Punkten gelesen; die letzte gute Sicherung hatte ${previousZs}. ` +
          `Der Rückgang um ${dropZs} ZS-Datensätze ist zu groß für ein automatisches Überschreiben.`,
      };
    }
  }

  return { ok: true, current, baseline: baseline.summary, source: baseline.source };
}

async function preserveCurrentAutosaveAsLastGood(handle) {
  const currentAutosave = await readJsonFromDirectory(handle, MDR_AUTOSAVE_FILENAME);
  if (!isMdrBackupPayload(currentAutosave)) return false;
  const summary = backupSummary(currentAutosave);
  if (summary.horses <= 0) return false;

  const safeCopy = await normalizedBackupForSafetyCopy(currentAutosave);
  safeCopy.backup_kind = 'last_good';
  safeCopy.last_good_note =
    'Automatisch erhaltene Schutzkopie des vorherigen gültigen MDR-Autosaves. Sie wird nicht als Sitzungsbackup rotiert.';
  safeCopy.last_good_saved_at = new Date().toISOString();

  await writeJsonToDirectory(handle, MDR_LAST_GOOD_FILENAME, safeCopy);
  await verifyWrittenBackup(handle, MDR_LAST_GOOD_FILENAME, safeCopy);
  return true;
}

async function writeAutosaveSafely(handle, payload) {
  // 1) Vorherigen gültigen Autosave in einer festen Schutzdatei bewahren.
  await preserveCurrentAutosaveAsLastGood(handle);

  // 2) Zuerst in eine temporäre Datei schreiben und vollständig zurücklesen.
  await writeJsonToDirectory(handle, MDR_VERIFY_FILENAME, payload);
  await verifyWrittenBackup(handle, MDR_VERIFY_FILENAME, payload);

  // 3) Erst nach erfolgreicher Prüfung den echten Autosave ersetzen.
  await writeJsonToDirectory(handle, MDR_AUTOSAVE_FILENAME, payload);
  await verifyWrittenBackup(handle, MDR_AUTOSAVE_FILENAME, payload);

  // 4) Temporäre Prüfdatei aufräumen.
  await removeBackupFileIfPresent(handle, MDR_VERIFY_FILENAME);
}


function longTermSnapshotIso(payload) {
  return payload?.longterm_snapshot_at || payload?.exported_at || null;
}

function longTermSnapshotAgeDays(payload, now = Date.now()) {
  const iso = longTermSnapshotIso(payload);
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now - t) / MDR_DAY_MS);
}

function longTermSameSnapshot(a, b) {
  const ai = longTermSnapshotIso(a);
  const bi = longTermSnapshotIso(b);
  return !!ai && !!bi && ai === bi;
}

async function writeLongTermSnapshot(handle, filename, sourcePayload, kind, note) {
  if (!isMdrBackupPayload(sourcePayload)) {
    throw new Error(`Langzeit-Sicherung ${filename}: ungültige Quelldaten.`);
  }
  const summary = backupSummary(sourcePayload);
  if (summary.horses <= 0) {
    throw new Error(`Langzeit-Sicherung ${filename}: 0 Pferde werden nicht archiviert.`);
  }

  const snapshot = JSON.parse(JSON.stringify(sourcePayload));
  snapshot.backup_kind = kind;
  snapshot.longterm_snapshot_at = longTermSnapshotIso(sourcePayload) || new Date().toISOString();
  snapshot.longterm_saved_at = new Date().toISOString();
  snapshot.longterm_note = note;
  await attachBackupIntegrity(snapshot);

  await writeJsonToDirectory(handle, filename, snapshot);
  await verifyWrittenBackup(handle, filename, snapshot);
  return snapshot;
}

// Sicherheitsring mit nur drei zusätzlichen Dateien:
// - Kandidat: noch nicht alt genug, wird NICHT laufend überschrieben
// - 3-Tage-Datei: derselbe Kandidat, sobald er mindestens 3 Tage alt ist
// - 7-Tage-Datei: derselbe Kandidat, sobald er mindestens 7 Tage alt ist
//
// Nach der 7-Tage-Promotion wird der aktuelle gültige Datenstand zum neuen
// Kandidaten. So bleibt immer ein wirklich älterer Stand erhalten und die
// Dateien wachsen nicht unkontrolliert an.
async function rotateLongTermBackups(handle, currentPayload) {
  if (!handle || !isMdrBackupPayload(currentPayload)) return null;
  const currentSummary = backupSummary(currentPayload);
  if (currentSummary.horses <= 0) return null;

  let candidate = await readJsonFromDirectory(handle, MDR_LONGTERM_CANDIDATE_FILENAME);
  if (!isMdrBackupPayload(candidate) || backupSummary(candidate).horses <= 0) {
    candidate = await writeLongTermSnapshot(
      handle,
      MDR_LONGTERM_CANDIDATE_FILENAME,
      currentPayload,
      'longterm_candidate',
      'Technischer Langzeit-Kandidat. Wird nach mindestens 3 Tagen als 3-Tage-Sicherung und nach mindestens 7 Tagen als 7-Tage-Sicherung geschützt.'
    );
    return { candidate, three: null, seven: null };
  }

  const now = Date.now();
  const ageDays = longTermSnapshotAgeDays(candidate, now);
  let three = await readJsonFromDirectory(handle, MDR_LONGTERM_3D_FILENAME);
  let seven = await readJsonFromDirectory(handle, MDR_LONGTERM_7D_FILENAME);

  if (ageDays != null && ageDays >= 3 && !longTermSameSnapshot(three, candidate)) {
    three = await writeLongTermSnapshot(
      handle,
      MDR_LONGTERM_3D_FILENAME,
      candidate,
      'longterm_3day',
      'Geschützter MDR-Datenstand, dessen ursprünglicher Snapshot beim Ablegen mindestens 3 Tage alt war.'
    );
  }

  if (ageDays != null && ageDays >= 7) {
    if (!longTermSameSnapshot(seven, candidate)) {
      seven = await writeLongTermSnapshot(
        handle,
        MDR_LONGTERM_7D_FILENAME,
        candidate,
        'longterm_7day',
        'Geschützter MDR-Datenstand, dessen ursprünglicher Snapshot beim Ablegen mindestens 7 Tage alt war.'
      );
    }

    // Erst NACH erfolgreicher 7-Tage-Sicherung einen neuen Kandidaten starten.
    candidate = await writeLongTermSnapshot(
      handle,
      MDR_LONGTERM_CANDIDATE_FILENAME,
      currentPayload,
      'longterm_candidate',
      'Neuer Langzeit-Kandidat nach erfolgreicher 7-Tage-Promotion des vorherigen Kandidaten.'
    );
  }

  return { candidate, three, seven };
}

async function longTermBackupStatus(handle) {
  if (!handle) return { threeReady: false, sevenReady: false, candidateAge: null };

  const [candidate, three, seven] = await Promise.all([
    readJsonFromDirectory(handle, MDR_LONGTERM_CANDIDATE_FILENAME),
    readJsonFromDirectory(handle, MDR_LONGTERM_3D_FILENAME),
    readJsonFromDirectory(handle, MDR_LONGTERM_7D_FILENAME),
  ]);

  const threeAge = isMdrBackupPayload(three) ? longTermSnapshotAgeDays(three) : null;
  const sevenAge = isMdrBackupPayload(seven) ? longTermSnapshotAgeDays(seven) : null;
  const candidateAge = isMdrBackupPayload(candidate) ? longTermSnapshotAgeDays(candidate) : null;

  return {
    threeReady: threeAge != null && threeAge >= 3 && backupSummary(three).horses > 0,
    sevenReady: sevenAge != null && sevenAge >= 7 && backupSummary(seven).horses > 0,
    threeAge,
    sevenAge,
    candidateAge,
  };
}

function longTermStatusLabel(status) {
  if (!status) return '';
  const three = status.threeReady ? '3T ✓' : '3T im Aufbau';
  const seven = status.sevenReady ? '7T ✓' : '7T im Aufbau';
  return ` · Langzeit: ${three} · ${seven}`;
}

function sessionBackupTimestampForFilename(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + '_' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('-');
}

function isManagedSessionBackupFilename(name) {
  return /^MDR-Sitzung-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d+)?\.json$/i.test(String(name || ''));
}

function isLegacyDailyBackupFilename(name) {
  // V32–V34 erzeugten jeden Tag eine weitere Datei. V35 räumt nur diese
  // automatisch erzeugten Tagesdateien auf; fremde/manuelle JSON-Dateien
  // bleiben unberührt.
  return /^MDR-Backup-\d{4}-\d{2}-\d{2}\.json$/i.test(String(name || ''));
}

async function listSessionBackupFiles(handle) {
  const files = [];
  if (!handle?.entries) return files;

  for await (const [name, entry] of handle.entries()) {
    if (entry?.kind !== 'file' || !isManagedSessionBackupFilename(name)) continue;
    try {
      const file = await entry.getFile();
      files.push({ name, lastModified: file.lastModified || 0 });
    } catch {
      files.push({ name, lastModified: 0 });
    }
  }

  files.sort((a, b) => {
    if (b.lastModified !== a.lastModified) return b.lastModified - a.lastModified;
    return b.name.localeCompare(a.name, 'de');
  });
  return files;
}

async function pruneManagedBackups(handle) {
  if (!handle?.entries || !handle?.removeEntry) return;

  // V41: Ausschließlich die eindeutig von der App erzeugten
  // MDR-Sitzung-*.json-Dateien rotieren. Andere JSON-Dateien werden
  // grundsätzlich NICHT mehr automatisch gelöscht – auch dann nicht,
  // wenn ihr Dateiname zufällig einem alten MDR-Backup-Schema entspricht.
  const sessionFiles = await listSessionBackupFiles(handle);
  for (const old of sessionFiles.slice(MDR_MAX_SESSION_BACKUPS)) {
    try {
      await handle.removeEntry(old.name);
    } catch (error) {
      console.warn('Altes MDR-Sitzungsbackup konnte nicht entfernt werden:', old.name, error);
    }
  }
}

async function nextUniqueSessionBackupFilename(handle, date = new Date()) {
  const base = `${MDR_SESSION_BACKUP_PREFIX}${sessionBackupTimestampForFilename(date)}`;
  let name = `${base}.json`;
  let suffix = 2;
  while (true) {
    try {
      await handle.getFileHandle(name, { create: false });
      name = `${base}-${suffix}.json`;
      suffix += 1;
    } catch {
      return name;
    }
  }
}

// Das zuverlässige Sitzungsprinzip:
// Beim ERSTEN Laden einer neuen Browser-Sitzung wird der aktuelle
// Datenbankstand als Endstand der vorherigen Sitzung archiviert.
// sessionStorage bleibt bei Navigation zwischen index/horse/zuchtplaner
// erhalten, deshalb entsteht nicht bei jedem Seitenwechsel ein Backup.
//
// Ein "Backup beim Fenster-Schließen" wäre weniger zuverlässig, weil
// Browser asynchrone Datei-Schreibvorgänge beim Beenden abbrechen dürfen.
async function archiveCompletedSessionOnce(handle, { force = false } = {}) {
  if (!handle) return false;
  const permission = await backupHandlePermission(handle, false);
  if (permission !== 'granted') return false;

  const folderMarker = handle.name || '(backup-folder)';
  if (!force && sessionStorage.getItem(MDR_SESSION_ARCHIVE_MARKER_KEY) === folderMarker) {
    return false;
  }

  try {
    const payload = await createLocalBackupPayload();
    const safety = await checkAutomaticBackupSafety(handle, payload);
    if (!safety.ok) {
      setBackupBlocked({
        code: safety.code,
        message: safety.message,
        current_horses: safety.current?.horses || 0,
        previous_horses: safety.baseline?.horses || 0,
        current_zs_records: safety.current?.zs_records || 0,
        previous_zs_records: safety.baseline?.zs_records || 0,
        during: 'Sitzungsbackup',
      });
      console.error('MDR Sitzungs-Backup aus Sicherheitsgründen gestoppt:', safety.message);
      await updateDataSafetyUi();
      return false;
    }

    const now = new Date();
    payload.backup_kind = 'session';
    payload.session_archive_note =
      'Dieser Stand wurde beim Start der nächsten MDR-Sitzung archiviert und entspricht dem Endstand der vorherigen Sitzung.';
    payload.session_archived_at = now.toISOString();

    const filename = await nextUniqueSessionBackupFilename(handle, now);
    await writeJsonToDirectory(handle, filename, payload);
    await verifyWrittenBackup(handle, filename, payload);
    await pruneManagedBackups(handle);
    await rotateLongTermBackups(handle, payload);

    const archivedAt = new Date().toISOString();
    localStorage.setItem(MDR_LAST_SESSION_BACKUP_KEY, archivedAt);
    sessionStorage.setItem(MDR_SESSION_ARCHIVE_MARKER_KEY, folderMarker);
    saveStoredGoodSummary(safety.current);
    clearBackupBlocked();
    console.info(`MDR Sitzungs-Backup geschrieben und geprüft: ${filename}`);
    return true;
  } catch (error) {
    console.error('MDR Sitzungs-Backup fehlgeschlagen:', error);
    localStorage.setItem(MDR_PENDING_BACKUP_KEY, '1');
    await updateDataSafetyUi();
    return false;
  }
}

async function sessionBackupCount(handle) {
  try {
    return (await listSessionBackupFiles(handle)).length;
  } catch {
    return 0;
  }
}

function externalBackupTimeLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function updateDataSafetyUi() {
  const btn = document.getElementById('mdr-backup-folder-btn');
  const panelChooseBtn = document.getElementById('mdr-data-safety-panel-btn');
  const panelForgetBtn = document.getElementById('mdr-data-safety-forget-btn');
  const panelAuthorizeBtn = document.getElementById('mdr-data-safety-authorize-btn');
  const panelRestoreBtn = document.getElementById('mdr-data-safety-restore-btn');
  const panelForceBtn = document.getElementById('mdr-data-safety-force-btn');
  const status = document.getElementById('mdr-data-safety-status');
  if (!btn && !panelChooseBtn && !panelForgetBtn && !panelAuthorizeBtn && !panelRestoreBtn && !panelForceBtn && !status) return;

  const supported = mdrCanUseDirectoryBackup();
  const handle = supported ? await getBackupDirectoryHandle() : null;
  const permission = handle ? await backupHandlePermission(handle, false) : 'denied';
  const last = localStorage.getItem(MDR_LAST_EXTERNAL_BACKUP_KEY);
  const lastServer = localStorage.getItem(MDR_LAST_SERVER_BACKUP_KEY);
  const lastSession = localStorage.getItem(MDR_LAST_SESSION_BACKUP_KEY);
  const pending = localStorage.getItem(MDR_PENDING_BACKUP_KEY) === '1';
  const blocked = readBackupBlocked();
  const goodSummary = readStoredGoodSummary();
  const folderName = handle?.name ? `„${handle.name}“` : '';
  const sessionCount = handle && permission === 'granted' ? await sessionBackupCount(handle) : 0;
  const longTermStatus = handle && permission === 'granted'
    ? await longTermBackupStatus(handle)
    : null;
  const longTermLabel = handle && permission === 'granted'
    ? longTermStatusLabel(longTermStatus)
    : '';
  const countLabel = goodSummary?.horses > 0
    ? ` · ${goodSummary.horses} Pferde · ${goodSummary.pairings || 0} Verpaarungen · ${goodSummary.zs_records || 0} ZS-Datensätze`
    : '';

  if (btn) {
    if (!supported) {
      btn.textContent = '🛡️ Externe Sicherung nicht verfügbar';
      btn.disabled = true;
    } else if (!handle) {
      btn.textContent = '🛡️ Backup-Ordner wählen';
      btn.disabled = false;
    } else {
      btn.textContent = '🛡️ Backup-Ordner ändern';
      btn.disabled = false;
      btn.title = `Aktuell: ${handle.name || 'gewählter Ordner'} · klicken, um einen anderen Ordner zu wählen`;
    }
  }

  if (panelChooseBtn) {
    panelChooseBtn.textContent = handle ? 'Backup-Ordner ändern' : 'Backup-Ordner wählen';
    panelChooseBtn.disabled = !supported;
  }

  if (panelForgetBtn) {
    panelForgetBtn.disabled = !supported || !handle;
    panelForgetBtn.hidden = !handle;
  }

  if (panelAuthorizeBtn) {
    panelAuthorizeBtn.hidden = !handle || permission === 'granted';
    panelAuthorizeBtn.disabled = !supported || !handle;
  }

  if (panelRestoreBtn) {
    let canRestore = false;
    let restoreTitle = '';
    if (blocked) {
      const currentHorses = Number(blocked.current_horses || 0);
      const recovery = await findBestRecoveryBackup(
        handle && permission === 'granted' ? handle : null,
        currentHorses,
        Number(blocked.previous_horses || 0)
      );
      canRestore = !!recovery;
      if (recovery) {
        restoreTitle = `${recovery.name}: ${recovery.summary.horses} Pferde · ${recovery.summary.pairings} Verpaarungen · ${recovery.summary.zs_records || 0} ZS-Datensätze`;
      }
    }
    panelRestoreBtn.hidden = !canRestore;
    panelRestoreBtn.disabled = !canRestore;
    panelRestoreBtn.title = restoreTitle;
  }

  if (panelForceBtn) {
    // Einen kleineren, aber NICHT leeren Stand kann der Nutzer bewusst
    // freigeben. 0 Pferde bleiben für automatische Ordnersicherungen immer
    // gesperrt; dafür steht bei Bedarf weiterhin der manuelle Download bereit.
    const canForce = !!blocked && Number(blocked.current_horses || 0) > 0;
    panelForceBtn.hidden = !canForce;
    panelForceBtn.disabled = !canForce;
  }

  if (status) {
    status.classList.toggle('error', !!blocked);
    if (!supported) {
      status.textContent = 'Dieser Browser unterstützt die direkte Ordnersicherung nicht. JSON-Backups können weiterhin heruntergeladen werden.';
    } else if (!handle) {
      status.textContent = mdrIsHostedOnlineOrigin()
        ? 'Online-Version: Der gemeinsame Datenbestand liegt geschützt in Supabase. Noch kein zusätzlicher lokaler Backup-Ordner gewählt; ein JSON-Backup kann jederzeit heruntergeladen werden.'
        : (lastServer
          ? `Interner Sicherheits-Spiegel aktiv · zuletzt ${externalBackupTimeLabel(lastServer)}. Noch kein zusätzlicher externer Backup-Ordner gewählt.`
          : 'Noch kein externer Backup-Ordner gewählt. Der interne Sicherheits-Spiegel wird beim nächsten gültigen Speichern aufgebaut.');
    } else if (permission !== 'granted') {
      status.textContent = `Aktueller Backup-Ordner: ${folderName}. Der Browser benötigt erneut Schreibzugriff. Du kannst ihn freigeben oder einen anderen Ordner wählen.`;
    } else if (blocked) {
      status.textContent =
        `⚠️ SICHERUNG GESTOPPT: ${blocked.message} ` +
        `Der vorhandene gute Autosave wurde NICHT überschrieben.` +
        (Number(blocked.current_horses || 0) === 0
          ? ' Bitte zuerst den richtigen Datenbestand wiederherstellen/importieren.'
          : ' Falls diese starke Reduzierung absichtlich war, kannst du sie unten bewusst freigeben.');
    } else if (pending) {
      status.textContent = `Aktueller Backup-Ordner: ${folderName}. Lokale Änderungen vorhanden – Autosave wird geschrieben.${countLabel} · ${sessionCount}/3 Sitzungs-Backups`;
    } else if (last) {
      status.textContent = `Aktueller Backup-Ordner: ${folderName} · Autosave: ${externalBackupTimeLabel(last)}${countLabel} · ${sessionCount}/3 Sitzungs-Backups` +
        (lastSession ? ` · letzte Sitzungsarchivierung: ${externalBackupTimeLabel(lastSession)}` : '');
    } else {
      status.textContent = `Aktueller Backup-Ordner: ${folderName} · bereit${countLabel} · ${sessionCount}/3 Sitzungs-Backups`;
    }
  }
}

async function forceCurrentSmallerBackup() {
  const blocked = readBackupBlocked();
  if (!blocked || Number(blocked.current_horses || 0) <= 0) return;

  const current = Number(blocked.current_horses || 0);
  const previous = Number(blocked.previous_horses || 0);
  const currentZs = Number(blocked.current_zs_records || 0);
  const previousZs = Number(blocked.previous_zs_records || 0);
  const zsLine = blocked.code === 'zs-drop' || previousZs > 0
    ? `\nZS-Datensätze: vorher ${previousZs}, aktuell ${currentZs}.`
    : '';
  const ok = confirm(
    `⚠️ Sicherheitsfreigabe\n\n` +
    `Die letzte gute Sicherung hatte ${previous || '?'} Pferde, der aktuelle Stand hat ${current}.${zsLine}\n\n` +
    `Nur fortfahren, wenn diese Reduzierung wirklich beabsichtigt ist. ` +
    `Der aktuelle Stand wird danach als neue gültige Basis akzeptiert.`
  );
  if (!ok) return;

  const saved = await writeExternalBackupNow('manuell freigegebener kleinerer Stand', { allowSmaller: true });
  if (saved) {
    alert(`Der aktuelle Stand mit ${current} Pferden und ${currentZs} ZS-Datensätzen wurde bewusst als neue gültige Sicherungsbasis gespeichert.`);
  }
}

async function chooseBackupDirectory() {
  if (!mdrCanUseDirectoryBackup()) {
    alert('Dieser Browser unterstützt die direkte Ordnersicherung hier nicht. Du kannst jederzeit ein JSON-Backup herunterladen.');
    return;
  }

  try {
    const previous = await getBackupDirectoryHandle();

    // WICHTIG V34:
    // Auch wenn bereits ein Ordner gespeichert ist, wird der echte
    // Windows-Ordnerdialog erneut geöffnet. Damit kann der Backup-Ordner
    // jederzeit bewusst gewechselt werden.
    const handle = await window.showDirectoryPicker({
      id: 'mdr-backups',
      mode: 'readwrite',
      startIn: previous || 'documents',
    });

    await localPut(LOCAL_STORES.userSettings, { key: MDR_BACKUP_HANDLE_KEY, handle });

    // Der Zeitstempel des alten Ordners soll nach einem Wechsel nicht so
    // aussehen, als sei der NEUE Ordner bereits aktuell gesichert.
    localStorage.removeItem(MDR_LAST_EXTERNAL_BACKUP_KEY);
    localStorage.removeItem(MDR_LAST_SESSION_BACKUP_KEY);
    sessionStorage.removeItem(MDR_SESSION_ARCHIVE_MARKER_KEY);
    localStorage.setItem(MDR_PENDING_BACKUP_KEY, '1');

    const saved = await writeExternalBackupNow('backup-ordner-neu-gewaehlt');
    await archiveCompletedSessionOnce(handle, { force: true });
    await updateDataSafetyUi();

    if (saved) {
      alert(`Backup-Ordner „${handle.name || 'ausgewählter Ordner'}“ gespeichert und sofort mit einem geprüften aktuellen Backup befüllt.`);
    } else {
      const blocked = readBackupBlocked();
      alert(blocked
        ? `Backup-Ordner „${handle.name || 'ausgewählter Ordner'}“ gespeichert. Die Sicherung wurde aber aus Sicherheitsgründen gestoppt:\n\n${blocked.message}`
        : `Backup-Ordner „${handle.name || 'ausgewählter Ordner'}“ gespeichert. Die automatische Sicherung wird beim nächsten möglichen Schreibzugriff erneut versucht.`);
    }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      alert('Backup-Ordner konnte nicht eingerichtet werden: ' + error.message);
    }
  }
}

async function authorizeExistingBackupDirectory() {
  const handle = await getBackupDirectoryHandle();
  if (!handle) {
    await chooseBackupDirectory();
    return;
  }

  const permission = await backupHandlePermission(handle, true);
  if (permission !== 'granted') {
    alert('Der Browser hat keinen Schreibzugriff auf den bisherigen Backup-Ordner erhalten. Du kannst stattdessen einen anderen Ordner wählen.');
    await updateDataSafetyUi();
    return;
  }

  localStorage.setItem(MDR_PENDING_BACKUP_KEY, '1');
  await writeExternalBackupNow('backup-ordner-freigegeben');
  await archiveCompletedSessionOnce(handle);
  await updateDataSafetyUi();
}

async function forgetBackupDirectory() {
  const handle = await getBackupDirectoryHandle();
  if (!handle) {
    await updateDataSafetyUi();
    return;
  }

  const name = handle.name || 'diesen Ordner';
  const ok = confirm(
    `Backup-Ordner „${name}“ wirklich vergessen?\n\n` +
    'Die bereits vorhandenen JSON-Backups in diesem Windows-Ordner werden NICHT gelöscht. ' +
    'Die MDR-Datenbank schreibt dort danach aber nicht mehr automatisch hinein, bis du einen neuen Backup-Ordner auswählst.'
  );
  if (!ok) return;

  // Beim Entfernen des Handles soll keine Sicherung in den gerade
  // entfernten Ordner mehr angestoßen werden.
  if (mdrBackupTimer) {
    clearTimeout(mdrBackupTimer);
    mdrBackupTimer = null;
  }

  const oldSuspend = window.MDR_AUTO_BACKUP_SUSPENDED;
  window.MDR_AUTO_BACKUP_SUSPENDED = true;
  try {
    await localDelete(LOCAL_STORES.userSettings, MDR_BACKUP_HANDLE_KEY);
  } finally {
    window.MDR_AUTO_BACKUP_SUSPENDED = oldSuspend;
  }

  localStorage.removeItem(MDR_LAST_EXTERNAL_BACKUP_KEY);
  localStorage.removeItem(MDR_LAST_SESSION_BACKUP_KEY);
  sessionStorage.removeItem(MDR_SESSION_ARCHIVE_MARKER_KEY);
  localStorage.setItem(MDR_PENDING_BACKUP_KEY, '1');
  await updateDataSafetyUi();
  alert(`Backup-Ordner „${name}“ wurde aus der MDR-Datenbank entfernt. Die Dateien im Ordner selbst bleiben unverändert erhalten.`);
}

async function writeExternalBackupNow(reason = 'auto', { allowSmaller = false } = {}) {
  if (mdrBackupRunning || window.MDR_AUTO_BACKUP_SUSPENDED) return false;

  const handle = await getBackupDirectoryHandle();
  const permission = handle ? await backupHandlePermission(handle, false) : 'denied';

  // V54: Supabase ist bereits der zentrale, persistente Arbeitsbestand.
  // Ein lokaler Ordner ist nur eine zusätzliche Sicherung und deshalb nicht
  // Voraussetzung dafür, dass ein erfolgreicher Cloud-Speichervorgang als
  // sicher gilt.
  if (typeof MDR_CLOUD_BUILD !== 'undefined' && MDR_CLOUD_BUILD && (!handle || permission !== 'granted')) {
    localStorage.removeItem(MDR_PENDING_BACKUP_KEY);
    clearBackupBlocked();
    await updateDataSafetyUi();
    return true;
  }

  mdrBackupRunning = true;
  try {
    const payload = await createLocalBackupPayload();
    payload.backup_kind = 'autosave';

    const safety = await checkAutomaticBackupSafety(
      permission === 'granted' ? handle : null,
      payload,
      { allowSmaller }
    );
    if (!safety.ok) {
      setBackupBlocked({
        code: safety.code,
        message: safety.message,
        current_horses: safety.current?.horses || 0,
        previous_horses: safety.baseline?.horses || 0,
        current_zs_records: safety.current?.zs_records || 0,
        previous_zs_records: safety.baseline?.zs_records || 0,
        during: 'Autosave',
      });
      console.error('MDR Autosave aus Sicherheitsgründen gestoppt:', safety.message);
      await updateDataSafetyUi();
      return false;
    }

    // 1) Fester projektinterner Sicherheits-Spiegel. Dieser benötigt kein
    // Chrome-Ordnerhandle und bleibt deshalb auch nach einem kompletten
    // IndexedDB-Verlust beim nächsten Start erreichbar.
    const serverSaved = await writeServerMirrorBackup(payload);

    // 2) Zusätzlich weiterhin der vom Nutzer ausgewählte externe Ordner.
    let externalSaved = false;
    let externalError = null;
    if (handle && permission === 'granted') {
      try {
        await writeAutosaveSafely(handle, payload);
        await pruneManagedBackups(handle);
        await rotateLongTermBackups(handle, payload);
        externalSaved = true;
        localStorage.setItem(MDR_LAST_EXTERNAL_BACKUP_KEY, new Date().toISOString());
      } catch (error) {
        externalError = error;
        console.warn('Externe Ordnersicherung fehlgeschlagen, Server-Spiegel bleibt erhalten:', error);
      }
    }

    if (!serverSaved && !externalSaved) {
      throw externalError || new Error('Weder Server-Sicherheits-Spiegel noch externer Backup-Ordner konnten geschrieben werden.');
    }

    // Der Datenstand selbst ist sicher bestätigt, sobald mindestens eine
    // der beiden unabhängigen Sicherungen erfolgreich war.
    localStorage.removeItem(MDR_PENDING_BACKUP_KEY);
    saveStoredGoodSummary(safety.current);
    clearBackupBlocked();

    console.info(
      `MDR Sicherung geschrieben (${reason}): ${safety.current.horses} Pferde, ` +
      `${safety.current.pairings} Verpaarungen · Server=${serverSaved ? 'ok' : 'nein'} · extern=${externalSaved ? 'ok' : 'nein'}.`
    );

    if (externalError) {
      // Die Daten sind durch den Server-Spiegel geschützt; der externe
      // Ordner darf aber sichtbar als nachholbedürftig markiert bleiben.
      localStorage.setItem(MDR_PENDING_BACKUP_KEY, '1');
    }

    await updateDataSafetyUi();
    return true;
  } catch (error) {
    console.error('MDR-Sicherung fehlgeschlagen:', error);
    localStorage.setItem(MDR_PENDING_BACKUP_KEY, '1');
    setBackupBlocked({
      code: 'write-or-verify-failed',
      message: `Schreiben oder Kontrolllesen ist fehlgeschlagen: ${error.message}`,
      current_horses: (await localGetAll(LOCAL_STORES.horses).catch(() => [])).length,
      previous_horses: readStoredGoodSummary()?.horses || 0,
      during: 'Autosave',
    });
    if (handle) await removeBackupFileIfPresent(handle, MDR_VERIFY_FILENAME);
    await updateDataSafetyUi();
    return false;
  } finally {
    mdrBackupRunning = false;
  }
}

window.mdrMarkDataChanged = function mdrMarkDataChanged(storeName) {
  // Das Speichern des Backup-Ordner-Handles selbst löst bewusst keine
  // zusätzliche Sicherungsschleife aus.
  localStorage.setItem(MDR_PENDING_BACKUP_KEY, '1');
  updateDataSafetyUi();
  if (mdrBackupTimer) clearTimeout(mdrBackupTimer);
  mdrBackupTimer = setTimeout(() => {
    mdrBackupTimer = null;
    writeExternalBackupNow(`Aenderung:${storeName || 'Daten'}`);
  }, MDR_BACKUP_DEBOUNCE_MS);
};

async function requestPersistentStorage() {
  const result = { supported: false, persisted: false };
  try {
    if (!navigator.storage?.persisted) return result;
    result.supported = true;
    result.persisted = await navigator.storage.persisted();
    if (!result.persisted && navigator.storage.persist) {
      result.persisted = await navigator.storage.persist();
    }
  } catch (error) {
    console.warn('Persistenter Speicher konnte nicht angefragt werden:', error);
  }
  return result;
}

async function injectDataSafetyPanel() {
  if (document.getElementById('mdr-data-safety-panel')) return;
  const main = document.querySelector('main.container');
  if (!main) return;

  const isSettingsPage = /(?:^|\/)einstellungen\.html$/i.test(location.pathname);
  // Datensicherung wird nur in den Einstellungen angezeigt. Autosave,
  // Wiederherstellung und Sicherheitsprüfungen laufen auf allen Seiten weiter.
  if (!isSettingsPage) return;
  const panel = document.createElement('div');
  panel.id = 'mdr-data-safety-panel';
  panel.className = 'mdr-data-safety-panel';
  panel.innerHTML = `
    <div class="mdr-data-safety-text">
      <strong>🛡️ Datensicherung</strong>
      <span id="mdr-data-safety-status" class="small">Prüfe Sicherung…</span>
    </div>
    <div class="mdr-data-safety-actions">
      ${isSettingsPage
        ? `<button type="button" class="btn secondary small" id="mdr-data-safety-panel-btn">Backup-Ordner wählen</button>
           <button type="button" class="btn secondary small" id="mdr-data-safety-authorize-btn" hidden>Zugriff freigeben</button>
           <button type="button" class="btn secondary small" id="mdr-data-safety-forget-btn" hidden>Backup-Ordner vergessen</button>`
        : `<a class="btn secondary small" href="einstellungen.html">⚙️ Sicherung verwalten</a>`}
      <button type="button" class="btn secondary small mdr-restore-good-btn" id="mdr-data-safety-restore-btn" hidden>↩ Rückgängig – letzte gute Sicherung wiederherstellen</button>
      <button type="button" class="btn secondary small" id="mdr-data-safety-force-btn" hidden>⚠️ Kleineren Stand bewusst sichern</button>
    </div>`;
  main.insertBefore(panel, main.firstChild);

  panel.querySelector('#mdr-data-safety-panel-btn')?.addEventListener('click', chooseBackupDirectory);
  panel.querySelector('#mdr-data-safety-authorize-btn')?.addEventListener('click', authorizeExistingBackupDirectory);
  panel.querySelector('#mdr-data-safety-restore-btn')?.addEventListener('click', restoreLastGoodBackup);
  panel.querySelector('#mdr-data-safety-force-btn')?.addEventListener('click', forceCurrentSmallerBackup);
  panel.querySelector('#mdr-data-safety-forget-btn')?.addEventListener('click', forgetBackupDirectory);
  await updateDataSafetyUi();
}

async function initDataSafety(nav) {
  if (mdrSafetyUiInitialized) return;
  mdrSafetyUiInitialized = true;

  await injectDataSafetyPanel();
  const persistence = await requestPersistentStorage();
  const panel = document.getElementById('mdr-data-safety-panel');
  if (panel) panel.dataset.storagePersisted = persistence.persisted ? '1' : '0';
  await updateDataSafetyUi();

  const startupNoticeRaw = localStorage.getItem(MDR_STARTUP_RECOVERY_NOTICE_KEY);
  if (startupNoticeRaw) {
    try {
      const notice = JSON.parse(startupNoticeRaw);
      const status = document.getElementById('mdr-data-safety-status');
      if (status) {
        status.textContent =
          `✅ Leerer Browser-Start automatisch repariert: ${notice.horses} Pferde und ${notice.pairings} Verpaarungen aus ${notice.source} wiederhergestellt.`;
        status.classList.remove('error');
      }
    } catch {}
    localStorage.removeItem(MDR_STARTUP_RECOVERY_NOTICE_KEY);
  }

  // Einmal pro echter Browser-Sitzung den aktuellen Stand als Endstand
  // der VORHERIGEN Sitzung archivieren. Navigation innerhalb der App
  // erzeugt durch sessionStorage keine zusätzlichen Backups.
  const handle = await getBackupDirectoryHandle();
  if (handle && await backupHandlePermission(handle, false) === 'granted') {
    await archiveCompletedSessionOnce(handle);
  }

  // Falls beim letzten Schließen noch Änderungen offen waren, Autosave nachholen.
  if (localStorage.getItem(MDR_PENDING_BACKUP_KEY) === '1') {
    setTimeout(() => writeExternalBackupNow('offene Aenderung beim Start'), 800);
  }
}

async function renderSharedNav() {
  const nav = document.querySelector('.topbar nav');
  if (!nav || nav.dataset.localNavReady === '1') return;
  nav.dataset.localNavReady = '1';

  // V54.0.51: Der optionale Futterabo-Bereich erscheint nur, wenn er in
  // den persönlichen Einstellungen aktiviert ist. Dadurch bleibt das Feature
  // vollständig ein-/ausschaltbar, ohne alle statischen Navigationen zu duplizieren.
  const feedConfig = getFeedPlanConfig();
  if (feedConfig.enabled && !nav.querySelector('[data-feed-plan-nav]')) {
    const link=document.createElement('a');
    link.className='btn secondary';
    link.href='futterabo.html';
    link.dataset.feedPlanNav='1';
    link.textContent='🌾 Futterabo';
    if (feedPlanIsDue(feedConfig)) {
      link.classList.add('feed-plan-nav-due');
      link.title='Futterbestellung fällig';
    }
    const settingsLink=[...nav.querySelectorAll('a[href]')].find(a=>String(a.getAttribute('href')||'').split(/[?#]/)[0].endsWith('einstellungen.html'));
    if (settingsLink) nav.insertBefore(link,settingsLink);
    else nav.appendChild(link);
  }

  // V54.0.47: Die Hauptnavigation steht bereits statisch identisch in allen
  // App-Seiten. Hier wird nur noch der aktive Bereich markiert. Dadurch
  // springen Guide/Einstellungen nicht mehr erst nach dem JS-Start in die Leiste.
  const currentPage = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const sectionPage = ({
    'horse.html':'index.html',
    'view.html':'index.html',
    'durchschnitt.html':'dashboard.html',
  })[currentPage] || currentPage;
  document.body.dataset.mdrPage = currentPage.replace(/\.html$/,'');
  nav.querySelectorAll('a[href]').forEach(link => {
    const href = String(link.getAttribute('href') || '').split(/[?#]/)[0].split('/').pop().toLowerCase();
    const active = href && href === sectionPage;
    link.classList.toggle('nav-current', active);
    if (active) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });

  // Datensicherheits-UI darf Navigation bzw. Seitendaten nicht blockieren.
  // Die eigentliche Start-/Recovery-Prüfung läuft bereits in requireSession().
  Promise.resolve(initDataSafety(nav)).catch(error =>
    console.warn('Datensicherheits-UI konnte nicht vollständig initialisiert werden:', error)
  );
}

// --- V33: Import wahlweise ergänzen/zusammenführen oder vollständig ersetzen ---

function mdrImportNorm(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');
}

function mdrImportVersion(horse) {
  return String(horse?.game_version || 'DE').toUpperCase();
}

function mdrImportExternalId(horse) {
  return String(horse?.external_id ?? '').trim();
}

function mdrImportIsEmpty(value) {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function mdrImportScoreAverage(rows, scorer) {
  if (!Array.isArray(rows) || !rows.length || typeof scorer !== 'function') return null;
  const vals = rows.map(r => scorer(r?.value)).filter(v => v != null && Number.isFinite(Number(v))).map(Number);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function mdrImportQuickStats(horse) {
  const gpRaw = horse?.tournament_potential?.['Gesamtpotenzial'];
  const gp = gpRaw != null && gpRaw !== '' && Number.isFinite(Number(gpRaw)) ? Number(gpRaw) : null;
  const ext = typeof averageScore === 'function' && typeof scoreExteriorTerm === 'function'
    ? averageScore(horse?.exterior_descriptive, scoreExteriorTerm)
    : mdrImportScoreAverage(horse?.exterior_descriptive, typeof scoreExteriorTerm === 'function' ? scoreExteriorTerm : null);
  const intVal = typeof averageScore === 'function' && typeof scoreTemperamentTerm === 'function'
    ? averageScore(horse?.temperament, scoreTemperamentTerm)
    : mdrImportScoreAverage(horse?.temperament, typeof scoreTemperamentTerm === 'function' ? scoreTemperamentTerm : null);
  const extPctRaw = horse?.exterior_genetics?.overall?.percent;
  const extPct = extPctRaw != null && extPctRaw !== '' && Number.isFinite(Number(extPctRaw)) ? Number(extPctRaw) : null;
  return { gp, ext, extPct, int: intVal };
}

function mdrImportStatsEqual(a, b) {
  const keys = ['gp', 'ext', 'extPct', 'int'];
  return keys.every(k => a[k] != null && b[k] != null && Math.abs(Number(a[k]) - Number(b[k])) < 0.005);
}

function mdrImportSameBreedGender(a, b) {
  const breedA = mdrImportNorm(a?.breed);
  const breedB = mdrImportNorm(b?.breed);
  const genderA = mdrImportNorm(a?.gender);
  const genderB = mdrImportNorm(b?.gender);
  return !!breedA && breedA === breedB && !!genderA && genderA === genderB;
}

function mdrFindHorseImportMatch(imported, existingHorses) {
  const version = mdrImportVersion(imported);
  const pool = (existingHorses || []).filter(h => mdrImportVersion(h) === version);
  const extId = mdrImportExternalId(imported);
  const name = mdrImportNorm(imported?.name);

  const idMatches = extId ? pool.filter(h => mdrImportExternalId(h) === extId) : [];
  const nameMatches = name ? pool.filter(h => mdrImportNorm(h?.name) === name) : [];

  const uniqueById = idMatches.length === 1 ? idMatches[0] : null;
  const uniqueByName = nameMatches.length === 1 ? nameMatches[0] : null;

  if ((idMatches.length > 1) || (nameMatches.length > 1)) {
    return { status: 'conflict', reason: 'ID oder Name ist in der Datenbank mehrfach vorhanden.' };
  }
  if (uniqueById && uniqueByName && uniqueById.id !== uniqueByName.id) {
    return { status: 'conflict', reason: 'MDR-ID und Name zeigen auf zwei verschiedene vorhandene Pferde.' };
  }
  if (uniqueById || uniqueByName) {
    return {
      status: 'exact',
      existing: uniqueById || uniqueByName,
      reason: uniqueById && uniqueByName ? 'gleiche MDR-ID und gleicher Name' : uniqueById ? 'gleiche MDR-ID' : 'gleicher Name',
    };
  }

  const importedStats = mdrImportQuickStats(imported);
  const statMatches = pool.filter(h => mdrImportSameBreedGender(imported, h) && mdrImportStatsEqual(importedStats, mdrImportQuickStats(h)));
  if (statMatches.length === 1) {
    return { status: 'possible', existing: statMatches[0], reason: 'Rasse, Geschlecht sowie GP/Ext/Ext%/Int identisch' };
  }
  return { status: 'new', reason: statMatches.length > 1 ? 'Werte passen zu mehreren Pferden – deshalb keine automatische Zuordnung.' : 'kein vorhandenes Pferd erkannt' };
}

function mdrAnalyzeHorseImport(importedHorses, existingHorses) {
  const rows = (importedHorses || []).map((horse, index) => ({ index, horse, ...mdrFindHorseImportMatch(horse, existingHorses) }));
  return {
    rows,
    exact: rows.filter(r => r.status === 'exact'),
    possible: rows.filter(r => r.status === 'possible'),
    conflicts: rows.filter(r => r.status === 'conflict'),
    fresh: rows.filter(r => r.status === 'new'),
  };
}

function mdrImportClone(value) {
  if (value == null) return value;
  try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); }
}

function mdrImportArrayIdentityKey(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  if (item.label != null) return ['label', mdrImportNorm(item.label)];
  if (item.name != null) return ['name', mdrImportNorm(item.name)];
  if (item.code != null) return ['code', mdrImportNorm(item.code)];
  return null;
}

function mdrMergeSupplementValue(oldValue, newValue, path, stats) {
  if (mdrImportIsEmpty(newValue)) return mdrImportClone(oldValue);
  if (mdrImportIsEmpty(oldValue)) {
    stats.added += 1;
    return mdrImportClone(newValue);
  }

  if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    if (!newValue.length) return mdrImportClone(oldValue);
    if (!oldValue.length) { stats.added += 1; return mdrImportClone(newValue); }

    // Stammbaumpositionen sind positionsgebunden; nicht nach Namen deduplizieren.
    if (path.includes('pedigree') || path.includes('ancestors')) {
      const length = Math.max(oldValue.length, newValue.length);
      const merged = [];
      for (let i = 0; i < length; i++) {
        if (i >= oldValue.length) { stats.added += 1; merged.push(mdrImportClone(newValue[i])); }
        else if (i >= newValue.length) merged.push(mdrImportClone(oldValue[i]));
        else merged.push(mdrMergeSupplementValue(oldValue[i], newValue[i], `${path}[${i}]`, stats));
      }
      return merged;
    }

    const objectItems = [...oldValue, ...newValue].filter(v => v && typeof v === 'object' && !Array.isArray(v));
    const identityAvailable = objectItems.length && objectItems.every(v => mdrImportArrayIdentityKey(v));
    if (identityAvailable) {
      const merged = oldValue.map(mdrImportClone);
      const index = new Map();
      merged.forEach((item, i) => {
        const [kind, key] = mdrImportArrayIdentityKey(item);
        index.set(`${kind}:${key}`, i);
      });
      for (const fresh of newValue) {
        const [kind, key] = mdrImportArrayIdentityKey(fresh);
        const token = `${kind}:${key}`;
        if (!index.has(token)) {
          stats.added += 1;
          index.set(token, merged.length);
          merged.push(mdrImportClone(fresh));
        } else {
          const i = index.get(token);
          merged[i] = mdrMergeSupplementValue(merged[i], fresh, `${path}.${token}`, stats);
        }
      }
      return merged;
    }

    // Primitive Listen: Vereinigungsmenge, vorhandene Reihenfolge bleibt erhalten.
    if ([...oldValue, ...newValue].every(v => v == null || typeof v !== 'object')) {
      const merged = [...oldValue];
      const seen = new Set(oldValue.map(v => JSON.stringify(v)));
      for (const v of newValue) {
        const sig = JSON.stringify(v);
        if (!seen.has(sig)) { seen.add(sig); merged.push(mdrImportClone(v)); stats.added += 1; }
      }
      return merged;
    }

    // Unbekannte komplexe Liste: bestehende Liste schützen, nur komplett neue Objekte anhängen.
    const merged = oldValue.map(mdrImportClone);
    const seen = new Set(oldValue.map(v => JSON.stringify(v)));
    for (const v of newValue) {
      const sig = JSON.stringify(v);
      if (!seen.has(sig)) { seen.add(sig); merged.push(mdrImportClone(v)); stats.added += 1; }
    }
    return merged;
  }

  if (oldValue && newValue && typeof oldValue === 'object' && typeof newValue === 'object' && !Array.isArray(oldValue) && !Array.isArray(newValue)) {
    const merged = { ...mdrImportClone(oldValue) };
    for (const [key, value] of Object.entries(newValue)) {
      merged[key] = mdrMergeSupplementValue(oldValue[key], value, path ? `${path}.${key}` : key, stats);
    }
    return merged;
  }

  if (String(oldValue) === String(newValue)) return mdrImportClone(oldValue);
  stats.conflicts += 1;
  return mdrImportClone(oldValue); // Ergänzen heißt: bestehende, nicht-leere Werte gewinnen.
}

function mdrMergeHorseSupplement(existing, imported) {
  const stats = { added: 0, conflicts: 0 };
  const result = { ...mdrImportClone(existing) };
  const protectedKeys = new Set(['id', 'created_at', 'updated_at']);

  for (const [key, value] of Object.entries(imported || {})) {
    if (protectedKeys.has(key)) continue;
    result[key] = mdrMergeSupplementValue(existing?.[key], value, key, stats);
  }

  result.id = existing.id;
  result.created_at = existing.created_at || imported?.created_at || new Date().toISOString();
  const changed = JSON.stringify(result) !== JSON.stringify(existing);
  if (changed) result.updated_at = new Date().toISOString();
  else if (existing.updated_at) result.updated_at = existing.updated_at;
  return { result, changed, ...stats };
}

function mdrImportStatsText(horse) {
  const s = mdrImportQuickStats(horse);
  const f = v => v == null ? '–' : Number(v).toFixed(2).replace('.00', '');
  return `GP ${f(s.gp)} · Ext ${f(s.ext)} · Ext% ${f(s.extPct)} · Int ${f(s.int)}`;
}

function mdrImportEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function ensureImportModeModal() {
  let modal = document.getElementById('mdr-import-mode-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'mdr-import-mode-modal';
  modal.className = 'modal-overlay mdr-import-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal-box mdr-import-modal-box" role="dialog" aria-modal="true" aria-labelledby="mdr-import-title">
      <h2 id="mdr-import-title">📂 Backup importieren</h2>
      <div id="mdr-import-preview"></div>
      <div class="mdr-import-mode-options">
        <label class="mdr-import-mode-card">
          <input type="radio" name="mdr-import-mode" value="merge" checked>
          <span><strong>➕ Ergänzen / zusammenführen</strong><small>Bestehende Pferde bleiben erhalten. Neue Pferde werden ergänzt; erkannte Dubletten füllen nur fehlende Daten auf. Bei widersprüchlichen, bereits vorhandenen Werten bleibt der bestehende Wert erhalten.</small></span>
        </label>
        <label class="mdr-import-mode-card mdr-import-replace-card">
          <input type="radio" name="mdr-import-mode" value="replace">
          <span><strong>⚠️ Alles ersetzen</strong><small>Wie bisher: Alle im Backup enthaltenen Datenbereiche werden zuerst geleert und anschließend aus der Datei neu eingelesen.</small></span>
        </label>
      </div>
      <div id="mdr-import-possible"></div>
      <div class="notice small mdr-import-other-stores-note">
        Im Modus <strong>Ergänzen</strong> werden ausschließlich die Pferde zusammengeführt. Verpaarungs-Log, Einstellungen, Filter und andere bestehende Bereiche bleiben unverändert. Im Modus <strong>Alles ersetzen</strong> werden alle in der Backup-Datei enthaltenen Bereiche ersetzt.
      </div>
      <div class="modal-actions">
        <button type="button" class="btn secondary" id="mdr-import-cancel">Abbrechen</button>
        <button type="button" class="btn" id="mdr-import-confirm">Import starten</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  return modal;
}

function renderImportPossibleDuplicates(analysis) {
  const root = document.getElementById('mdr-import-possible');
  if (!root) return;
  if (!analysis.possible.length) {
    root.innerHTML = '<p class="small muted"><strong>Mögliche Dubletten nach Werten:</strong> keine.</p>';
    return;
  }

  root.innerHTML = `
    <details class="mdr-import-possible-box" open>
      <summary><strong>🔎 ${analysis.possible.length} mögliche Dublette${analysis.possible.length === 1 ? '' : 'n'} prüfen</strong></summary>
      <p class="small muted">Diese Pferde haben keinen identischen Namen/keine identische MDR-ID, aber Rasse, Geschlecht und GP/Ext/Ext%/Int stimmen exakt überein. Nur anhaken, wenn es wirklich dasselbe Pferd ist.</p>
      <div class="mdr-import-possible-scroll">
        ${analysis.possible.map(row => `
          <label class="mdr-import-possible-row">
            <input type="checkbox" data-import-possible-index="${row.index}" data-existing-id="${mdrImportEscape(row.existing?.id)}">
            <span>
              <strong>Import:</strong> ${mdrImportEscape(row.horse?.name || '(ohne Name)')}<br>
              <strong>Vorhanden:</strong> ${mdrImportEscape(row.existing?.name || '(ohne Name)')}<br>
              <span class="small muted">${mdrImportEscape(mdrImportStatsText(row.horse))}</span>
            </span>
          </label>`).join('')}
      </div>
    </details>`;
}

async function openImportModeDialog(payload, fileName) {
  const importedHorses = payload.stores?.[LOCAL_STORES.horses] || [];
  const existingHorses = await localGetAll(LOCAL_STORES.horses);
  const analysis = mdrAnalyzeHorseImport(importedHorses, existingHorses);
  const pairings = payload.stores?.[LOCAL_STORES.pairings] || [];
  const remembered = payload.stores?.[LOCAL_STORES.pairingNotes] || [];
  const versions = [...new Set(importedHorses.map(h => h.game_version || 'DE'))].sort();
  const incomingSummary = backupSummary(payload);
  const currentZsRecords = existingHorses.filter(mdrHasBreedingShowPoints).length;

  const modal = ensureImportModeModal();
  document.getElementById('mdr-import-preview').innerHTML = `
    <div class="mdr-import-summary">
      <strong>${mdrImportEscape(fileName)}</strong>
      <div class="mdr-import-summary-grid">
        <span>🐴 Import: <strong>${importedHorses.length}</strong></span>
        <span>📚 Bereits vorhanden: <strong>${existingHorses.length}</strong></span>
        <span>✅ Eindeutige Dubletten: <strong>${analysis.exact.length}</strong></span>
        <span>🔎 Mögliche Dubletten: <strong>${analysis.possible.length}</strong></span>
        <span>➕ Sicher neu: <strong>${analysis.fresh.length}</strong></span>
        <span>⚠️ Zuordnungskonflikte: <strong>${analysis.conflicts.length}</strong></span>
        <span>💞 Verpaarungen in Datei: <strong>${pairings.length}</strong></span>
        <span>ZS-Datensätze in Datei: <strong>${incomingSummary.zs_records || 0}</strong></span>
        <span>ZS-Datensätze aktuell: <strong>${currentZsRecords}</strong></span>
        <span>⭐ Gemerkte Vergleiche: <strong>${remembered.length}</strong></span>
        <span>🌍 Versionen: <strong>${mdrImportEscape(versions.length ? versions.join(', ') : 'keine')}</strong></span>
      </div>
      ${incomingSummary.zs_records < currentZsRecords ? `<div class="notice notice-warning small"><strong>⚠️ ZS-Schutz:</strong> Diese Datei enthält nur <strong>${incomingSummary.zs_records}</strong> Pferde mit ZS-Punkten, aktuell sind es <strong>${currentZsRecords}</strong>. <strong>Ergänzen / zusammenführen</strong> schützt die vorhandenen ZS-Werte. Bei <strong>Alles ersetzen</strong> wird vor dem Import noch einmal ausdrücklich gewarnt.</div>` : ''}
      ${analysis.conflicts.length ? `<div class="notice notice-warning small">${analysis.conflicts.length} Pferd${analysis.conflicts.length === 1 ? '' : 'e'} hat/haben eine widersprüchliche Zuordnung (z. B. Name und MDR-ID zeigen auf unterschiedliche Datensätze). Diese werden beim Ergänzen sicherheitshalber <strong>übersprungen</strong>.</div>` : ''}
    </div>`;
  renderImportPossibleDuplicates(analysis);

  const replaceRadio = modal.querySelector('input[value="replace"]');
  const replaceCard = replaceRadio?.closest('.mdr-import-mode-card');
  if (payload.learning_export === true) {
    document.getElementById('mdr-import-preview').insertAdjacentHTML(
      'beforeend',
      '<div class="notice small"><strong>🧠 Bereinigte Lerndatei:</strong> Die enthaltenen Lernpferde werden nur ergänzt/zusammengeführt. Neue Datensätze sind als Lerndatei markiert und verwenden den Besitzer <strong>Lerndatei</strong>; dein eigener aktiver Bestand bleibt erhalten.</div>'
    );
  }

  if (payload.selection_export === true) {
    if (replaceRadio) {
      replaceRadio.checked = false;
      replaceRadio.disabled = true;
    }
    if (replaceCard) {
      replaceCard.classList.add('mdr-import-mode-disabled');
      replaceCard.title = 'Auswahl-Exporte können aus Sicherheitsgründen nur ergänzt/zusammengeführt werden.';
    }
    document.getElementById('mdr-import-preview').insertAdjacentHTML(
      'beforeend',
      '<div class="notice small"><strong>📦 Auswahl-Export:</strong> Diese Datei enthält bewusst nur ausgewählte Pferde. Sie kann deshalb nur über <strong>Ergänzen / zusammenführen</strong> importiert werden.</div>'
    );
  } else {
    if (replaceRadio) replaceRadio.disabled = false;
    if (replaceCard) {
      replaceCard.classList.remove('mdr-import-mode-disabled');
      replaceCard.removeAttribute('title');
    }
  }
  modal.querySelector('input[value="merge"]').checked = true;
  modal.hidden = false;

  return new Promise(resolve => {
    const cancel = document.getElementById('mdr-import-cancel');
    const confirmBtn = document.getElementById('mdr-import-confirm');

    const cleanup = () => {
      cancel.onclick = null;
      confirmBtn.onclick = null;
      modal.hidden = true;
    };
    cancel.onclick = () => { cleanup(); resolve(null); };
    confirmBtn.onclick = () => {
      const mode = modal.querySelector('input[name="mdr-import-mode"]:checked')?.value || 'merge';
      const possibleSelections = new Map();
      modal.querySelectorAll('[data-import-possible-index]:checked').forEach(cb => {
        possibleSelections.set(Number(cb.dataset.importPossibleIndex), String(cb.dataset.existingId));
      });
      cleanup();
      resolve({ mode, possibleSelections, analysis });
    };
  });
}

async function importBackupReplace(payload) {
  // Ein vollständiger Backup-Ersatz ist selbst eine Wiederherstellungsaktion.
  // Ein älterer Pferde-Undo-Punkt wäre danach fachlich nicht mehr gültig.
  if (typeof mdrClearHorseUndoPoint === 'function') await mdrClearHorseUndoPoint();
  const backupHandleRow = await getBackupDirectoryRecord();
  window.MDR_AUTO_BACKUP_SUSPENDED = true;
  try {
    for (const storeName of Object.values(LOCAL_STORES)) {
      if (!(storeName in payload.stores)) continue;
      await localClear(storeName);
      const records = (payload.stores[storeName] || []).filter(record =>
        !(storeName === LOCAL_STORES.userSettings && record?.key === MDR_BACKUP_HANDLE_KEY)
      );
      if (typeof localBulkPut === 'function') await localBulkPut(storeName, records);
      else {
        for (const record of records) await localPut(storeName, record);
      }
    }
    if (backupHandleRow?.handle) await localPut(LOCAL_STORES.userSettings, backupHandleRow);
  } finally {
    window.MDR_AUTO_BACKUP_SUSPENDED = false;
  }
}

async function importBackupMerge(payload, possibleSelections) {
  const importedHorses = payload.stores?.[LOCAL_STORES.horses] || [];
  const working = await localGetAll(LOCAL_STORES.horses);
  const result = { newHorses: 0, updated: 0, unchanged: 0, skippedConflicts: 0, possibleMerged: 0, addedFields: 0, keptConflicts: 0 };
  const undoBefore = [];
  const undoCreated = [];

  window.MDR_AUTO_BACKUP_SUSPENDED = true;
  try {
    for (let index = 0; index < importedHorses.length; index++) {
      const imported = importedHorses[index];
      let match = mdrFindHorseImportMatch(imported, working);

      // Eine in der Vorschau ausdrücklich bestätigte mögliche Dublette darf
      // auch ohne Name/ID-Übereinstimmung zusammengeführt werden.
      if (match.status !== 'exact' && possibleSelections?.has(index)) {
        const selectedId = String(possibleSelections.get(index));
        const selected = working.find(h => String(h.id) === selectedId);
        if (selected) {
          match = { status: 'exact', existing: selected, reason: 'vom Nutzer bestätigte mögliche Dublette', possibleConfirmed: true };
        }
      }

      if (match.status === 'conflict') {
        result.skippedConflicts += 1;
        continue;
      }

      if (match.status === 'exact') {
        const merged = mdrMergeHorseSupplement(match.existing, imported);
        result.addedFields += merged.added;
        result.keptConflicts += merged.conflicts;
        if (match.possibleConfirmed) result.possibleMerged += 1;
        if (merged.changed) {
          const beforeSnapshot = mdrImportClone(match.existing);
          await localPut(LOCAL_STORES.horses, merged.result);
          undoBefore.push(beforeSnapshot);
          const wi = working.findIndex(h => h.id === match.existing.id);
          if (wi >= 0) working[wi] = merged.result;
          result.updated += 1;
        } else {
          result.unchanged += 1;
        }
        continue;
      }

      // Nicht bestätigte mögliche Dubletten werden bewusst als neues Pferd importiert.
      const fresh = mdrImportClone(imported) || {};
      delete fresh.id;
      const newId = await localAdd(LOCAL_STORES.horses, fresh);
      undoCreated.push(newId);
      const added = { ...fresh, id: newId };
      working.push(added);
      result.newHorses += 1;
    }
  } finally {
    window.MDR_AUTO_BACKUP_SUSPENDED = false;
  }
  if ((undoBefore.length || undoCreated.length) && typeof mdrStoreHorseUndoPoint === 'function') {
    await mdrStoreHorseUndoPoint({
      label: `Backup-Ergänzung rückgängig (${undoBefore.length + undoCreated.length} Pferde)`,
      beforeRows: undoBefore,
      createdIds: undoCreated,
    }).catch(error => console.warn('Undo-Punkt für Backup-Ergänzung konnte nicht gespeichert werden:', error));
  }
  return result;
}

async function importLocalBackupFromInput(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;

  try {
    const payload = JSON.parse(await file.text());
    if (payload?.format !== 'mdr-datenbank-local-backup' || !payload.stores) {
      throw new Error('Die Datei ist kein gültiges MDR-Backup.');
    }

    const choice = await openImportModeDialog(payload, file.name);
    if (!choice) return;

    // Sicherheitskopie des IST-Zustands vor JEDEM Import.
    await writeExternalBackupNow('vor Import');

    if (choice.mode === 'replace') {
      if (payload.selection_export === true) {
        alert(
          '🛡️ „Alles ersetzen“ ist für einen Auswahl-Export gesperrt.\n\n' +
          'Diese Datei enthält absichtlich nur ausgewählte Pferde. Bitte „Ergänzen / zusammenführen“ verwenden.'
        );
        return;
      }

      const incomingHorseCount = Array.isArray(payload.stores?.[LOCAL_STORES.horses])
        ? payload.stores[LOCAL_STORES.horses].length
        : 0;
      const currentHorseCount = (await localGetAll(LOCAL_STORES.horses)).length;

      if (incomingHorseCount === 0 && currentHorseCount > 0) {
        alert(
          `🛡️ Import gestoppt: Diese Backup-Datei enthält 0 Pferde, die aktuelle Datenbank aber ${currentHorseCount}.\n\n` +
          '„Alles ersetzen“ würde den vorhandenen Pferdebestand löschen. V41 blockiert diesen Vorgang deshalb vollständig.'
        );
        return;
      }

      const incomingZsCount = backupSummary(payload).zs_records || 0;
      const currentZsCount = (await localGetAll(LOCAL_STORES.horses)).filter(mdrHasBreedingShowPoints).length;
      if (incomingZsCount < currentZsCount) {
        const confirmed = confirm(
          `⚠️ ZS-DATENSCHUTZ\n\n` +
          `Das ausgewählte Backup enthält ${incomingZsCount} Pferde mit ZS-Punkten. ` +
          `In der aktuellen Datenbank sind ${currentZsCount} ZS-Datensätze vorhanden.\n\n` +
          `„Alles ersetzen“ würde damit ${currentZsCount - incomingZsCount} aktuell vorhandene ZS-Datensätze verlieren.\n\n` +
          `Abbrechen = vorhandene Daten schützen und anschließend „Ergänzen / zusammenführen“ verwenden.\n` +
          `OK = trotzdem bewusst ALLES ERSETZEN.`
        );
        if (!confirmed) return;
      }

      await importBackupReplace(payload);
      localStorage.setItem(MDR_PENDING_BACKUP_KEY, '1');
      await writeExternalBackupNow('nach Import - ersetzt');
      alert('Backup wurde vollständig importiert. Die enthaltenen Datenbereiche wurden ersetzt. Die Seite wird neu geladen.');
      window.location.reload();
      return;
    }

    const result = await importBackupMerge(payload, choice.possibleSelections);
    localStorage.setItem(MDR_PENDING_BACKUP_KEY, '1');
    await writeExternalBackupNow('nach Import - zusammengefuehrt');

    alert(
      `Import ergänzt / zusammengeführt.\n\n` +
      `➕ Neue Pferde: ${result.newHorses}\n` +
      `🔄 Bestehende Pferde ergänzt: ${result.updated}\n` +
      `✓ Bereits vollständig / unverändert: ${result.unchanged}\n` +
      `🔎 Bestätigte mögliche Dubletten zusammengeführt: ${result.possibleMerged}\n` +
      `🧩 Ergänzte Datenfelder/-einträge: ${result.addedFields}\n` +
      `🛡️ Abweichende vorhandene Werte beibehalten: ${result.keptConflicts}\n` +
      `⚠️ Widersprüchliche Zuordnungen übersprungen: ${result.skippedConflicts}\n\n` +
      `Andere Datenbereiche wurden im Ergänzen-Modus nicht verändert.`
    );
    window.location.reload();
  } catch (error) {
    window.MDR_AUTO_BACKUP_SUSPENDED = false;
    alert('Import fehlgeschlagen: ' + error.message);
  }
}
