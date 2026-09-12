// MDR V54 – gemeinsame Supabase-Datenbank mit browserlokalem IndexedDB-Lesecache.
// Die bekannten local* Funktionen bleiben erhalten, damit die bestehende App
// nicht auf eine zweite Datenzugriffsschicht umgebaut werden muss.
const LOCAL_DB_NAME = 'mdr-datenbank-local';
const LOCAL_DB_VERSION = 3;

const LOCAL_STORES = {
  horses: 'horses',
  pairingNotes: 'pairing_notes',
  pairings: 'pairings',
  foalReferenceData: 'foal_reference_data',
  userSettings: 'user_settings',
  filterPresets: 'filter_presets',
  tagSuggestions: 'tag_suggestions'
};

const MDR_CLOUD_BUILD = true;
const MDR_CLOUD_TABLE = 'mdr_records';
const MDR_CLOUD_PAGE_SIZE = 1000;
const MDR_CLOUD_DELTA_CHUNK_SIZE = 100;
const MDR_SYNC_META_STORE = '__mdr_sync_meta';
const MDR_LAST_UNDO_KEY = 'last_undo_action';
const MDR_LOCAL_ONLY_SETTINGS = new Set(['backup_directory_handle', MDR_LAST_UNDO_KEY]);

// V54.0.49 Egress-Schutz: IndexedDB bleibt der sofortige Lesecache.
// Ein persistenter Cloud-Manifest-Stand (record_key + updated_at) verhindert,
// dass jeder Seitenwechsel erneut sämtliche JSON-Payloads aus Supabase lädt.
// Nach fünf Minuten wird nur das kleine Manifest geprüft; anschließend werden
// ausschließlich geänderte/neue Datensätze nachgeladen und Löschungen lokal
// nachvollzogen. Beim ersten Lauf nach dem Update erfolgt einmalig ein Vollsync.
const MDR_MEMORY_CACHE_STALE_MS = 5 * 60_000;
const MDR_CLOUD_READ_TIMEOUT_MS = 6_500;

function mdrWithTimeout(promiseLike, timeoutMs=MDR_CLOUD_READ_TIMEOUT_MS, label='Cloud-Abfrage') {
  return new Promise((resolve,reject)=>{
    let settled=false;
    const timer=setTimeout(()=>{
      if (settled) return;
      settled=true;
      const error=new Error(`${label} hat nach ${Math.round(timeoutMs/1000)} s nicht geantwortet.`);
      error.code='MDR_TIMEOUT';
      reject(error);
    },Math.max(250,Number(timeoutMs)||MDR_CLOUD_READ_TIMEOUT_MS));
    Promise.resolve(promiseLike).then(value=>{
      if (settled) return;
      settled=true; clearTimeout(timer); resolve(value);
    },error=>{
      if (settled) return;
      settled=true; clearTimeout(timer); reject(error);
    });
  });
}

const MDR_MEMORY_CACHE = new Map();
const MDR_SYNC_META_MEMORY = new Map();
const MDR_GET_ALL_INFLIGHT = new Map();
const MDR_STORE_EPOCH = new Map();
let MDR_MEMORY_CACHE_VERSION = 0;
let MDR_IDB_PROMISE = null;

function localNotifyDataChanged(storeName) {
  try {
    if (window.MDR_AUTO_BACKUP_SUSPENDED) return;
    window.mdrMarkDataChanged?.(storeName);
  } catch (error) {
    console.warn('Automatische MDR-Sicherung konnte nicht vorgemerkt werden:', error);
  }
}

function openLocalDatabase() {
  if (MDR_IDB_PROMISE) return MDR_IDB_PROMISE;
  MDR_IDB_PROMISE = new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    request.onerror = () => {
      MDR_IDB_PROMISE = null;
      reject(request.error);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        try { db.close(); } catch {}
        MDR_IDB_PROMISE = null;
      };
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(LOCAL_STORES.horses)) db.createObjectStore(LOCAL_STORES.horses,{keyPath:'id',autoIncrement:true});
      if (!db.objectStoreNames.contains(LOCAL_STORES.pairingNotes)) db.createObjectStore(LOCAL_STORES.pairingNotes,{keyPath:'id',autoIncrement:true});
      if (!db.objectStoreNames.contains(LOCAL_STORES.pairings)) db.createObjectStore(LOCAL_STORES.pairings,{keyPath:'id',autoIncrement:true});
      if (!db.objectStoreNames.contains(LOCAL_STORES.foalReferenceData)) db.createObjectStore(LOCAL_STORES.foalReferenceData,{keyPath:'id',autoIncrement:true});
      if (!db.objectStoreNames.contains(LOCAL_STORES.userSettings)) db.createObjectStore(LOCAL_STORES.userSettings,{keyPath:'key'});
      if (!db.objectStoreNames.contains(LOCAL_STORES.filterPresets)) db.createObjectStore(LOCAL_STORES.filterPresets,{keyPath:'id',autoIncrement:true});
      if (!db.objectStoreNames.contains(LOCAL_STORES.tagSuggestions)) db.createObjectStore(LOCAL_STORES.tagSuggestions,{keyPath:'id',autoIncrement:true});
      if (!db.objectStoreNames.contains(MDR_SYNC_META_STORE)) db.createObjectStore(MDR_SYNC_META_STORE,{keyPath:'storeName'});
    };
  });
  return MDR_IDB_PROMISE;
}

async function idbGetAll(storeName) {
  const db = await openLocalDatabase();
  return new Promise((resolve,reject)=>{
    const req=db.transaction(storeName,'readonly').objectStore(storeName).getAll();
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
async function idbGet(storeName,key) {
  const db=await openLocalDatabase();
  return new Promise((resolve,reject)=>{const req=db.transaction(storeName,'readonly').objectStore(storeName).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
}
async function idbPut(storeName,value) {
  const db=await openLocalDatabase();
  return new Promise((resolve,reject)=>{const req=db.transaction(storeName,'readwrite').objectStore(storeName).put(value);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
}
async function idbPutMany(storeName, values) {
  const rows=Array.isArray(values)?values:[];
  if (!rows.length) return;
  const db=await openLocalDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,'readwrite');
    const store=tx.objectStore(storeName);
    for (const row of rows) store.put(row);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error || new Error(`IndexedDB-Transaktion abgebrochen (${storeName}).`));
  });
}
async function idbReplaceAll(storeName, values, keepLocal=null) {
  const rows=Array.isArray(values)?values:[];
  const db=await openLocalDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,'readwrite');
    const store=tx.objectStore(storeName);
    store.clear();
    for (const row of rows) store.put(row);
    if (keepLocal?.handle) store.put(keepLocal);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error || new Error(`IndexedDB-Cache konnte nicht ersetzt werden (${storeName}).`));
  });
}
async function idbDelete(storeName,key) {
  const db=await openLocalDatabase();
  return new Promise((resolve,reject)=>{const req=db.transaction(storeName,'readwrite').objectStore(storeName).delete(key);req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);});
}
async function idbClear(storeName) {
  const db=await openLocalDatabase();
  return new Promise((resolve,reject)=>{const req=db.transaction(storeName,'readwrite').objectStore(storeName).clear();req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);});
}

async function idbDeleteMany(storeName, keys) {
  const list=Array.isArray(keys)?keys:[];
  if (!list.length) return;
  const db=await openLocalDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,'readwrite');
    const store=tx.objectStore(storeName);
    for (const key of list) store.delete(key);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error || new Error(`IndexedDB-Löschung abgebrochen (${storeName}).`));
  });
}

async function idbGetSyncMeta(storeName) {
  if (MDR_SYNC_META_MEMORY.has(storeName)) return MDR_SYNC_META_MEMORY.get(storeName);
  const db=await openLocalDatabase();
  const row=await new Promise((resolve,reject)=>{
    const req=db.transaction(MDR_SYNC_META_STORE,'readonly').objectStore(MDR_SYNC_META_STORE).get(storeName);
    req.onsuccess=()=>resolve(req.result || null);
    req.onerror=()=>reject(req.error);
  });
  MDR_SYNC_META_MEMORY.set(storeName,row);
  return row;
}

async function idbPutSyncMeta(row) {
  if (!row?.storeName) return;
  const db=await openLocalDatabase();
  await new Promise((resolve,reject)=>{
    const req=db.transaction(MDR_SYNC_META_STORE,'readwrite').objectStore(MDR_SYNC_META_STORE).put(row);
    req.onsuccess=()=>resolve();
    req.onerror=()=>reject(req.error);
  });
  MDR_SYNC_META_MEMORY.set(row.storeName,row);
}

async function idbClearSyncMeta() {
  const db=await openLocalDatabase();
  await new Promise((resolve,reject)=>{
    const req=db.transaction(MDR_SYNC_META_STORE,'readwrite').objectStore(MDR_SYNC_META_STORE).clear();
    req.onsuccess=()=>resolve();
    req.onerror=()=>reject(req.error);
  });
  MDR_SYNC_META_MEMORY.clear();
}

function mdrTimestampToken(value) {
  const time=Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : 0;
}

function mdrManifestFromRows(rows) {
  const manifest={};
  for (const row of (rows || [])) {
    if (row?.record_key == null) continue;
    manifest[String(row.record_key)]=mdrTimestampToken(row.updated_at);
  }
  return manifest;
}

function mdrPlanManifestDelta(localManifest={}, remoteManifest={}) {
  const changedKeys=[];
  for (const [key,updatedAt] of Object.entries(remoteManifest || {})) {
    if (!(key in (localManifest || {})) || Number(localManifest[key])!==Number(updatedAt)) changedKeys.push(key);
  }
  const deletedKeys=Object.keys(localManifest || {}).filter(key=>!(key in (remoteManifest || {})));
  return {changedKeys,deletedKeys};
}

async function mdrSaveSyncMeta(storeName, manifest, checkedAt=Date.now()) {
  const row={storeName,checkedAt:Number(checkedAt)||Date.now(),manifest:manifest || {}};
  await idbPutSyncMeta(row).catch(error=>console.warn('Sync-Metadaten konnten nicht gespeichert werden:',storeName,error));
  return row;
}

async function mdrPatchSyncMetaRecords(storeName, records) {
  const current=await idbGetSyncMeta(storeName).catch(()=>null);
  if (!current?.manifest) return; // kein Teilmanifest erzeugen; der nächste Bootstrap stellt den Vollstand her
  const manifest={...current.manifest};
  for (const row of (records || [])) {
    if (row?.recordKey == null) continue;
    manifest[String(row.recordKey)]=mdrTimestampToken(row.updatedAt);
  }
  await mdrSaveSyncMeta(storeName,manifest,current.checkedAt);
}

async function mdrRemoveSyncMetaRecords(storeName, keys) {
  const current=await idbGetSyncMeta(storeName).catch(()=>null);
  if (!current?.manifest) return;
  const manifest={...current.manifest};
  for (const key of (keys || [])) delete manifest[String(key)];
  await mdrSaveSyncMeta(storeName,manifest,current.checkedAt);
}

function mdrStoreEpoch(storeName) {
  return Number(MDR_STORE_EPOCH.get(storeName) || 0);
}
function mdrBumpStoreEpoch(storeName) {
  const next=mdrStoreEpoch(storeName)+1;
  MDR_STORE_EPOCH.set(storeName,next);
  return next;
}
function mdrSetMemoryCache(storeName, rows, fetchedAt=Date.now()) {
  MDR_MEMORY_CACHE.set(storeName,{rows:Array.isArray(rows)?rows:[],fetchedAt,version:++MDR_MEMORY_CACHE_VERSION});
}
function mdrStoreCacheVersion(storeName) {
  return Number(MDR_MEMORY_CACHE.get(storeName)?.version || 0);
}
function mdrMemoryRows(storeName) {
  return MDR_MEMORY_CACHE.get(storeName)?.rows || null;
}
function mdrPatchMemoryPut(storeName, payload) {
  const entry=MDR_MEMORY_CACHE.get(storeName);
  if (!entry || !payload) return;
  const key=mdrRecordKey(storeName,payload);
  if (key==null) return;
  const rows=[...entry.rows];
  const idx=rows.findIndex(row=>mdrRecordKey(storeName,row)===key);
  if (idx>=0) rows[idx]=payload; else rows.push(payload);
  mdrSetMemoryCache(storeName,rows,Date.now());
}
function mdrPatchMemoryDelete(storeName, keyOrValue) {
  const entry=MDR_MEMORY_CACHE.get(storeName);
  if (!entry) return;
  const key=mdrRecordKey(storeName,keyOrValue);
  if (key==null) return;
  mdrSetMemoryCache(storeName,entry.rows.filter(row=>mdrRecordKey(storeName,row)!==key),Date.now());
}

function mdrCloudClient() {
  if (typeof mdrCreateSupabaseClient !== 'function') throw new Error('Supabase-Konfiguration fehlt.');
  return mdrCreateSupabaseClient();
}

function mdrRecordKey(storeName, valueOrKey) {
  if (storeName === LOCAL_STORES.userSettings) {
    const key = typeof valueOrKey === 'object' ? valueOrKey?.key : valueOrKey;
    return key == null ? null : String(key);
  }
  const key = typeof valueOrKey === 'object' ? valueOrKey?.id : valueOrKey;
  return key == null ? null : String(key);
}

function mdrIsLocalOnly(storeName, valueOrKey) {
  if (storeName !== LOCAL_STORES.userSettings) return false;
  return MDR_LOCAL_ONLY_SETTINGS.has(String(mdrRecordKey(storeName,valueOrKey) || ''));
}

async function mdrCurrentUser() {
  try {
    const { data } = await mdrCloudClient().auth.getSession();
    return data?.session?.user || null;
  } catch { return null; }
}

function mdrSyncBreedingStationPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const tags = Array.isArray(payload.tags)
    ? payload.tags.map(t => typeof t === 'string' ? {label:t} : {...t})
    : [];
  const hasTag = tags.some(t => t?.label === 'Zuchtstation');
  if (payload.in_breeding_station === true) {
    if (!hasTag) tags.push({label:'Zuchtstation'});
  } else if (payload.in_breeding_station === false) {
    payload.tags = tags.filter(t => t?.label !== 'Zuchtstation');
    return payload;
  } else if (hasTag) {
    payload.in_breeding_station = true;
  }
  payload.tags = tags;
  return payload;
}

async function mdrPreparePayload(storeName, value) {
  const copy = (value && typeof value === 'object') ? structuredClone(value) : value;
  if (storeName === LOCAL_STORES.horses && copy && typeof copy === 'object') {
    mdrSyncBreedingStationPayload(copy);
  }
  if (storeName === LOCAL_STORES.filterPresets && copy && typeof copy === 'object') {
    const user = await mdrCurrentUser();
    if (user?.id && (!copy.user_id || copy.user_id === 'local-user')) copy.user_id = user.id;
  }
  return copy;
}

async function mdrCloudGetAll(storeName) {
  const client = mdrCloudClient();
  const out = [];
  for (let from = 0;; from += MDR_CLOUD_PAGE_SIZE) {
    const to = from + MDR_CLOUD_PAGE_SIZE - 1;
    const { data, error } = await mdrWithTimeout(
      client
        .from(MDR_CLOUD_TABLE)
        .select('record_key,payload,updated_at')
        .eq('store_name', storeName)
        .order('record_key', { ascending: true })
        .range(from, to),
      MDR_CLOUD_READ_TIMEOUT_MS,
      `Supabase-Lesen (${storeName})`
    );
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    out.push(...rows);
    if (rows.length < MDR_CLOUD_PAGE_SIZE) break;
  }
  return out;
}

async function mdrCloudGetManifest(storeName) {
  const client=mdrCloudClient();
  const out=[];
  for (let from=0;;from+=MDR_CLOUD_PAGE_SIZE) {
    const to=from+MDR_CLOUD_PAGE_SIZE-1;
    const {data,error}=await mdrWithTimeout(
      client
        .from(MDR_CLOUD_TABLE)
        .select('record_key,updated_at')
        .eq('store_name',storeName)
        .order('record_key',{ascending:true})
        .range(from,to),
      MDR_CLOUD_READ_TIMEOUT_MS,
      `Supabase-Abgleich (${storeName})`
    );
    if (error) throw error;
    const rows=Array.isArray(data)?data:[];
    out.push(...rows);
    if (rows.length<MDR_CLOUD_PAGE_SIZE) break;
  }
  return out;
}

async function mdrCloudGetByKeys(storeName, recordKeys) {
  const keys=[...new Set((recordKeys || []).map(key=>String(key)))];
  if (!keys.length) return [];
  const client=mdrCloudClient();
  const out=[];
  for (let i=0;i<keys.length;i+=MDR_CLOUD_DELTA_CHUNK_SIZE) {
    const chunk=keys.slice(i,i+MDR_CLOUD_DELTA_CHUNK_SIZE);
    const {data,error}=await mdrWithTimeout(
      client
        .from(MDR_CLOUD_TABLE)
        .select('record_key,payload,updated_at')
        .eq('store_name',storeName)
        .in('record_key',chunk),
      MDR_CLOUD_READ_TIMEOUT_MS,
      `Supabase-Delta (${storeName})`
    );
    if (error) throw error;
    if (Array.isArray(data)) out.push(...data);
  }
  return out;
}

async function mdrReadLocalOnlySettings() {
  const rows = [];
  for (const key of MDR_LOCAL_ONLY_SETTINGS) {
    const row = await idbGet(LOCAL_STORES.userSettings, key).catch(()=>null);
    if (row) rows.push(row);
  }
  return rows;
}

async function mdrSyncCacheStore(storeName, rows) {
  const keepLocal = storeName === LOCAL_STORES.userSettings ? await mdrReadLocalOnlySettings() : [];
  await idbReplaceAll(storeName,rows,null);
  if (keepLocal.length) await idbPutMany(storeName,keepLocal).catch(()=>{});
  return keepLocal;
}

async function mdrMergeLocalOnlyRows(storeName, rows, knownLocalOnly=null) {
  if (storeName !== LOCAL_STORES.userSettings) return rows;
  const localOnly = Array.isArray(knownLocalOnly) ? knownLocalOnly : await mdrReadLocalOnlySettings();
  if (!localOnly.length) return rows;
  const localKeys = new Set(localOnly.map(r => String(r?.key || '')));
  return [...rows.filter(r => !localKeys.has(String(r?.key || ''))), ...localOnly];
}

async function mdrRefreshStore(storeName) {
  if (MDR_GET_ALL_INFLIGHT.has(storeName)) return MDR_GET_ALL_INFLIGHT.get(storeName);
  const startEpoch=mdrStoreEpoch(storeName);
  const promise=(async()=>{
    const previousMeta=await idbGetSyncMeta(storeName).catch(()=>null);

    // Einmaliger Bootstrap nach V54.0.49 (oder nach gelöschtem Browsercache):
    // vollständigen Stand laden und dabei das persistente Änderungsmanifest anlegen.
    if (!previousMeta?.manifest) {
      const cloudRecords=await mdrCloudGetAll(storeName);
      if (mdrStoreEpoch(storeName)!==startEpoch) return mdrMemoryRows(storeName) || cloudRecords.map(row=>row.payload);
      const cloudRows=cloudRecords.map(row=>row.payload);
      const keepLocal=await mdrSyncCacheStore(storeName,cloudRows).catch(error=>{
        console.warn('Lokaler Lesecache konnte nicht aktualisiert werden:',storeName,error);
        return null;
      });
      if (mdrStoreEpoch(storeName)!==startEpoch) return mdrMemoryRows(storeName) || cloudRows;
      await mdrSaveSyncMeta(storeName,mdrManifestFromRows(cloudRecords),Date.now());
      const merged=await mdrMergeLocalOnlyRows(storeName,cloudRows,keepLocal);
      mdrSetMemoryCache(storeName,merged,Date.now());
      try { window.dispatchEvent(new CustomEvent('mdr:store-refreshed',{detail:{storeName,rows:merged.length,mode:'bootstrap',changed:cloudRows.length,deleted:0}})); } catch {}
      return merged;
    }

    // Normalfall: nur record_key + updated_at übertragen. Das ist um Größenordnungen
    // kleiner als die JSON-Payloads und reicht, um Änderungen/Löschungen zu erkennen.
    const remoteManifestRows=await mdrCloudGetManifest(storeName);
    if (mdrStoreEpoch(storeName)!==startEpoch) return mdrMemoryRows(storeName) || await idbGetAll(storeName).catch(()=>[]);
    const remoteManifest=mdrManifestFromRows(remoteManifestRows);
    const localManifest=previousMeta.manifest || {};
    const {changedKeys,deletedKeys}=mdrPlanManifestDelta(localManifest,remoteManifest);

    if (!changedKeys.length && !deletedKeys.length) {
      await mdrSaveSyncMeta(storeName,remoteManifest,Date.now());
      const current=mdrMemoryRows(storeName) || await idbGetAll(storeName).catch(()=>[]);
      mdrSetMemoryCache(storeName,current,Date.now());
      return current;
    }

    const changedRecords=await mdrCloudGetByKeys(storeName,changedKeys);
    if (mdrStoreEpoch(storeName)!==startEpoch) return mdrMemoryRows(storeName) || await idbGetAll(storeName).catch(()=>[]);

    const payloads=changedRecords.map(row=>row.payload).filter(Boolean);
    if (payloads.length) await idbPutMany(storeName,payloads).catch(error=>console.warn('Delta-Cache konnte nicht aktualisiert werden:',storeName,error));
    if (deletedKeys.length) {
      // record_key liegt in Supabase als Text vor; IndexedDB verwendet bei den
      // meisten Stores numerische id-Schlüssel. Deshalb den tatsächlichen lokalen
      // Primärschlüssel ermitteln, statt z.B. Zahl 49 mit String "49" zu löschen.
      const currentRows=mdrMemoryRows(storeName) || await idbGetAll(storeName).catch(()=>[]);
      const byRecordKey=new Map(currentRows.map(row=>[mdrRecordKey(storeName,row),row]));
      const localDeleteKeys=deletedKeys.map(key=>{
        const row=byRecordKey.get(String(key));
        if (!row) return key;
        return storeName===LOCAL_STORES.userSettings ? row.key : row.id;
      });
      await idbDeleteMany(storeName,localDeleteKeys).catch(error=>console.warn('Gelöschte Cloud-Datensätze konnten lokal nicht entfernt werden:',storeName,error));
    }

    // Falls ein Datensatz zwischen Manifest- und Delta-Abfrage gelöscht wurde, beim
    // nächsten Manifestlauf korrigieren; jetzt keine möglicherweise neue lokale Zeile löschen.
    await mdrSaveSyncMeta(storeName,remoteManifest,Date.now());
    const localRows=await idbGetAll(storeName).catch(()=>[]);
    const merged=await mdrMergeLocalOnlyRows(storeName,localRows);
    mdrSetMemoryCache(storeName,merged,Date.now());
    try { window.dispatchEvent(new CustomEvent('mdr:store-refreshed',{detail:{storeName,rows:merged.length,mode:'delta',changed:payloads.length,deleted:deletedKeys.length}})); } catch {}
    return merged;
  })();
  MDR_GET_ALL_INFLIGHT.set(storeName,promise);
  try {
    return await promise;
  } finally {
    if (MDR_GET_ALL_INFLIGHT.get(storeName)===promise) MDR_GET_ALL_INFLIGHT.delete(storeName);
  }
}

async function localGetAll(storeName) {
  const cached=MDR_MEMORY_CACHE.get(storeName);
  if (cached) {
    if (Date.now()-cached.fetchedAt>MDR_MEMORY_CACHE_STALE_MS && !MDR_GET_ALL_INFLIGHT.has(storeName)) {
      mdrRefreshStore(storeName).catch(error=>console.warn(`Supabase-Hintergrundaktualisierung fehlgeschlagen (${storeName}):`,error));
    }
    return [...cached.rows];
  }

  // V54.0.36: IndexedDB ist der sofortige Lesestand – auch wenn der Store
  // tatsächlich leer ist. Ein leerer lokaler Hilfs-Store (z.B. Filtervorlagen)
  // darf den kompletten Seitenstart nicht mehr blockieren. Supabase wird nur nach
  // Ablauf des persistenten 5-Minuten-Fensters abgeglichen und meldet Änderungen
  // anschließend per Event.
  try {
    const [localRows,syncMeta]=await Promise.all([
      idbGetAll(storeName),
      idbGetSyncMeta(storeName).catch(()=>null),
    ]);
    const lastChecked=Number(syncMeta?.checkedAt || 0);
    mdrSetMemoryCache(storeName,localRows,lastChecked);
    if (Date.now()-lastChecked>MDR_MEMORY_CACHE_STALE_MS && !MDR_GET_ALL_INFLIGHT.has(storeName)) {
      mdrRefreshStore(storeName).catch(error=>console.warn(`Supabase-Hintergrundaktualisierung fehlgeschlagen (${storeName}):`,error));
    }
    return [...localRows];
  } catch (error) {
    console.warn(`Lokaler Lesecache konnte nicht vorgeladen werden (${storeName}):`,error);
  }

  // Nur wenn IndexedDB selbst nicht lesbar ist, warten wir begrenzt auf die
  // Cloud. Auch dieser Pfad kann dank Timeout nicht mehr endlos bei „Lade…“ hängen.
  try {
    const rows=await mdrRefreshStore(storeName);
    return [...rows];
  } catch (error) {
    console.warn(`Supabase-Lesen fehlgeschlagen (${storeName}); verwende leeren Fallback:`,error);
    mdrSetMemoryCache(storeName,[],Date.now());
    return [];
  }
}

async function localGet(storeName, key) {
  if (mdrIsLocalOnly(storeName,key)) return idbGet(storeName,key);
  const recordKey = mdrRecordKey(storeName,key);
  const cached=MDR_MEMORY_CACHE.get(storeName);
  if (cached) {
    const hit=cached.rows.find(row=>mdrRecordKey(storeName,row)===recordKey);
    if (hit) {
      if (Date.now()-cached.fetchedAt>MDR_MEMORY_CACHE_STALE_MS && !MDR_GET_ALL_INFLIGHT.has(storeName)) {
        mdrRefreshStore(storeName).catch(()=>{});
      }
      return hit;
    }
  }

  // V54.0.36: einzelne Einstellungen zuerst lokal lesen. Vorher konnte schon
  // requireSession()/Startkonfiguration an einer einzelnen Supabase-Abfrage hängen,
  // obwohl der Datensatz im Browsercache vorhanden war.
  try {
    const localHit=await idbGet(storeName,key);
    if (localHit != null) {
      const syncMeta=await idbGetSyncMeta(storeName).catch(()=>null);
      const lastChecked=Number(syncMeta?.checkedAt || 0);
      if (Date.now()-lastChecked>MDR_MEMORY_CACHE_STALE_MS && !MDR_GET_ALL_INFLIGHT.has(storeName)) mdrRefreshStore(storeName).catch(()=>{});
      return localHit;
    }
  } catch (error) {
    console.warn(`Lokaler Einzelcache konnte nicht gelesen werden (${storeName}/${recordKey}):`,error);
  }

  // Fehlende Hilfs-/Einstellungswerte bedeuten lokal schlicht „nicht gesetzt“.
  // Die Hintergrundsynchronisierung füllt sie später nach, ohne den Seitenstart
  // zu blockieren. Pferde-Einzelaufrufe dürfen dagegen kurz auf die Cloud warten.
  if (storeName !== LOCAL_STORES.horses) {
    const syncMeta=await idbGetSyncMeta(storeName).catch(()=>null);
    const lastChecked=Number(syncMeta?.checkedAt || 0);
    if (Date.now()-lastChecked>MDR_MEMORY_CACHE_STALE_MS && !MDR_GET_ALL_INFLIGHT.has(storeName)) mdrRefreshStore(storeName).catch(()=>{});
    return null;
  }

  try {
    const { data, error } = await mdrWithTimeout(
      mdrCloudClient()
        .from(MDR_CLOUD_TABLE)
        .select('payload,updated_at')
        .eq('store_name',storeName)
        .eq('record_key',recordKey)
        .maybeSingle(),
      MDR_CLOUD_READ_TIMEOUT_MS,
      `Supabase-Lesen (${storeName}/${recordKey})`
    );
    if (error) throw error;
    if (data?.payload != null) {
      await idbPut(storeName,data.payload).catch(()=>{});
      mdrPatchMemoryPut(storeName,data.payload);
      await mdrPatchSyncMetaRecords(storeName,[{recordKey,updatedAt:data.updated_at}]);
    } else {
      await idbDelete(storeName,key).catch(()=>{});
      mdrPatchMemoryDelete(storeName,key);
      await mdrRemoveSyncMetaRecords(storeName,[recordKey]);
    }
    return data?.payload ?? null;
  } catch (error) {
    console.warn(`Supabase-Lesen fehlgeschlagen (${storeName}/${recordKey}); verwende Cache:`,error);
    return idbGet(storeName,key).catch(()=>null);
  }
}

async function mdrNextNumericId() {
  const { data, error } = await mdrCloudClient().rpc('mdr_next_numeric_id');
  if (error) throw error;
  const id = Number(data);
  if (!Number.isSafeInteger(id)) throw new Error('Supabase hat keine gültige neue MDR-ID geliefert.');
  return id;
}


function mdrHorseExternalIdToken(horse) {
  const externalId = String(horse?.external_id ?? '').trim();
  if (!externalId) return '';
  return `${String(horse?.game_version || 'DE').toUpperCase()}|${externalId}`;
}

async function mdrAssertHorseExternalIdUnique(horse) {
  if (!horse || typeof horse !== 'object') return;
  const token = mdrHorseExternalIdToken(horse);
  if (!token) return;
  const rows = mdrMemoryRows(LOCAL_STORES.horses) || await localGetAll(LOCAL_STORES.horses);
  const duplicate = rows.find(row =>
    mdrHorseExternalIdToken(row) === token && String(row?.id) !== String(horse?.id ?? '')
  );
  if (!duplicate) return;
  const error = new Error(`MDR-ID ${horse.external_id} ist bereits bei „${duplicate.name || 'anderes Pferd'}“ gespeichert.`);
  error.code = 'MDR_DUPLICATE_EXTERNAL_ID';
  error.duplicateHorse = duplicate;
  throw error;
}

async function mdrCloudUpsert(storeName, value) {
  const payload = await mdrPreparePayload(storeName,value);
  if (storeName === LOCAL_STORES.horses) await mdrAssertHorseExternalIdUnique(payload);
  const recordKey = mdrRecordKey(storeName,payload);
  if (recordKey == null) throw new Error(`Datensatz in ${storeName} besitzt keinen Schlüssel.`);
  const user = await mdrCurrentUser();
  const now = new Date().toISOString();
  const { error } = await mdrCloudClient()
    .from(MDR_CLOUD_TABLE)
    .upsert({store_name:storeName,record_key:recordKey,payload,updated_at:now,updated_by:user?.id || null},{onConflict:'store_name,record_key'});
  if (error) throw error;
  await idbPut(storeName,payload).catch(()=>{});
  mdrPatchMemoryPut(storeName,payload);
  await mdrPatchSyncMetaRecords(storeName,[{recordKey,updatedAt:now}]);
  return payload;
}

async function localAdd(storeName, value) {
  mdrBumpStoreEpoch(storeName);
  if (mdrIsLocalOnly(storeName,value)) {
    const result=await idbPut(storeName,value);
    mdrPatchMemoryPut(storeName,value);
    localNotifyDataChanged(storeName);
    return result;
  }
  let payload = await mdrPreparePayload(storeName,value);
  if (storeName === LOCAL_STORES.horses) await mdrAssertHorseExternalIdUnique(payload);
  if (storeName === LOCAL_STORES.userSettings) {
    if (!payload?.key) throw new Error('Einstellung besitzt keinen Schlüssel.');
  } else if (payload?.id == null) {
    payload = { ...payload, id: await mdrNextNumericId() };
  }
  const recordKey = mdrRecordKey(storeName,payload);
  const user = await mdrCurrentUser();
  const now=new Date().toISOString();
  const { error } = await mdrCloudClient().from(MDR_CLOUD_TABLE).insert({
    store_name:storeName,
    record_key:recordKey,
    payload,
    updated_at:now,
    updated_by:user?.id || null,
  });
  if (error) throw error;
  await idbPut(storeName,payload).catch(()=>{});
  mdrPatchMemoryPut(storeName,payload);
  await mdrPatchSyncMetaRecords(storeName,[{recordKey,updatedAt:now}]);
  localNotifyDataChanged(storeName);
  return storeName === LOCAL_STORES.userSettings ? payload.key : payload.id;
}

async function localPut(storeName, value) {
  mdrBumpStoreEpoch(storeName);
  if (mdrIsLocalOnly(storeName,value)) {
    const result=await idbPut(storeName,value);
    mdrPatchMemoryPut(storeName,value);
    localNotifyDataChanged(storeName);
    return result;
  }
  const payload = await mdrCloudUpsert(storeName,value);
  localNotifyDataChanged(storeName);
  return storeName === LOCAL_STORES.userSettings ? payload.key : payload.id;
}

async function localDelete(storeName, key) {
  mdrBumpStoreEpoch(storeName);
  if (mdrIsLocalOnly(storeName,key)) {
    await idbDelete(storeName,key);
    mdrPatchMemoryDelete(storeName,key);
    localNotifyDataChanged(storeName);
    return;
  }
  const recordKey=mdrRecordKey(storeName,key);
  const { error } = await mdrCloudClient().from(MDR_CLOUD_TABLE).delete().eq('store_name',storeName).eq('record_key',recordKey);
  if (error) throw error;
  await idbDelete(storeName,key).catch(()=>{});
  mdrPatchMemoryDelete(storeName,key);
  await mdrRemoveSyncMetaRecords(storeName,[recordKey]);
  localNotifyDataChanged(storeName);
}

async function localClear(storeName) {
  mdrBumpStoreEpoch(storeName);
  const localOnlyRows = storeName === LOCAL_STORES.userSettings ? await mdrReadLocalOnlySettings() : [];
  const { error } = await mdrCloudClient().from(MDR_CLOUD_TABLE).delete().eq('store_name',storeName);
  if (error) throw error;
  await idbClear(storeName);
  if (localOnlyRows.length) await idbPutMany(storeName,localOnlyRows).catch(()=>{});
  mdrSetMemoryCache(storeName,[...localOnlyRows],Date.now());
  await mdrSaveSyncMeta(storeName,{},Date.now());
  localNotifyDataChanged(storeName);
}

async function localFind(storeName, predicate) {
  return (await localGetAll(storeName)).filter(predicate);
}
async function localFindOne(storeName, predicate) {
  return (await localGetAll(storeName)).find(predicate) || null;
}
async function localUpdate(storeName, key, changes) {
  const current=await localGet(storeName,key);
  if (!current) return null;
  const updated={...current,...changes};
  if (storeName !== LOCAL_STORES.userSettings) updated.id=current.id ?? key;
  await localPut(storeName,updated);
  return updated;
}


function mdrUndoClone(value) {
  if (value == null) return value;
  try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); }
}

// Ein bewusst kleiner Ein-Schritt-Undo für kritische Pferdeaktionen. Der
// Snapshot bleibt nur auf diesem Gerät in IndexedDB und wird bei der nächsten
// kritischen Aktion ersetzt. Dadurch gibt es Sicherheit ohne vollständiges
// Änderungsprotokoll in der gemeinsamen Supabase-Datenbank.
async function mdrStoreHorseUndoPoint({ label, beforeRows = [], createdIds = [] } = {}) {
  const uniqueBefore = [];
  const seen = new Set();
  for (const row of (beforeRows || [])) {
    if (!row || row.id == null) continue;
    const key = String(row.id);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueBefore.push(mdrUndoClone(row));
  }
  const uniqueCreated = [...new Set((createdIds || []).filter(id => id != null).map(id => String(id)))];
  if (!uniqueBefore.length && !uniqueCreated.length) return null;
  const user = await mdrCurrentUser().catch(() => null);
  const point = {
    key: MDR_LAST_UNDO_KEY,
    kind: 'horses',
    user_id: user?.id || null,
    label: String(label || 'Letzte Änderung'),
    created_at: new Date().toISOString(),
    before_rows: uniqueBefore,
    created_ids: uniqueCreated,
  };
  await idbPut(LOCAL_STORES.userSettings, point);
  return point;
}

async function mdrGetHorseUndoPoint() {
  const point = await idbGet(LOCAL_STORES.userSettings, MDR_LAST_UNDO_KEY).catch(() => null);
  if (!point) return null;
  const user = await mdrCurrentUser().catch(() => null);
  if (point.user_id && user?.id && point.user_id !== user.id) return null;
  return point;
}

async function mdrClearHorseUndoPoint() {
  await idbDelete(LOCAL_STORES.userSettings, MDR_LAST_UNDO_KEY).catch(() => {});
}

async function mdrUndoLastHorseAction() {
  const point = await mdrGetHorseUndoPoint();
  if (!point) return { restored: 0, removed: 0, label: '' };
  let restored = 0;
  let removed = 0;
  window.MDR_AUTO_BACKUP_SUSPENDED = true;
  try {
    for (const id of (point.created_ids || [])) {
      const current = await localGet(LOCAL_STORES.horses, id).catch(() => null);
      if (!current) continue;
      await localDelete(LOCAL_STORES.horses, current.id);
      removed++;
    }
    for (const row of (point.before_rows || [])) {
      await localPut(LOCAL_STORES.horses, mdrUndoClone(row));
      restored++;
    }
  } finally {
    window.MDR_AUTO_BACKUP_SUSPENDED = false;
  }
  await mdrClearHorseUndoPoint();
  localNotifyDataChanged(LOCAL_STORES.horses);
  return { restored, removed, label: point.label || 'Letzte Änderung' };
}


console.log('MDR V54.0.49 Supabase-Datenbank mit persistentem Delta-Lesecache wurde geladen.');

// Für vollständige JSON-Importe: Datensätze in kleinen Paketen übertragen,
// damit ein Erstimport nicht hunderte einzelne HTTP-Anfragen erzeugt.
async function localBulkPut(storeName, values, chunkSize=100) {
  const input=Array.isArray(values)?values:[];
  if (!input.length) return [];
  if (storeName === LOCAL_STORES.horses) {
    const existingRows = mdrMemoryRows(LOCAL_STORES.horses) || await localGetAll(LOCAL_STORES.horses);
    const byToken = new Map();
    for (const row of existingRows) {
      const token = mdrHorseExternalIdToken(row);
      if (token) byToken.set(token, String(row.id));
    }
    for (const row of input) {
      const token = mdrHorseExternalIdToken(row);
      if (!token) continue;
      const existingId = byToken.get(token);
      if (existingId != null && String(existingId) !== String(row?.id ?? '')) {
        const error = new Error(`MDR-ID ${row.external_id} kommt im Import mehrfach bzw. bei einem anderen Pferd vor.`);
        error.code = 'MDR_DUPLICATE_EXTERNAL_ID';
        throw error;
      }
      byToken.set(token, String(row?.id ?? ''));
    }
  }
  mdrBumpStoreEpoch(storeName);
  const cloudPayloads=[];
  const localOnlyPayloads=[];
  for (const value of input) {
    if (mdrIsLocalOnly(storeName,value)) {
      localOnlyPayloads.push(value);
      continue;
    }
    let payload=await mdrPreparePayload(storeName,value);
    if (storeName !== LOCAL_STORES.userSettings && payload?.id == null) {
      payload={...payload,id:await mdrNextNumericId()};
    }
    const recordKey=mdrRecordKey(storeName,payload);
    if (recordKey == null) throw new Error(`Datensatz in ${storeName} besitzt keinen Schlüssel.`);
    cloudPayloads.push({payload,recordKey});
  }
  if (localOnlyPayloads.length) {
    await idbPutMany(storeName,localOnlyPayloads);
    localOnlyPayloads.forEach(payload=>mdrPatchMemoryPut(storeName,payload));
  }
  const user=await mdrCurrentUser();
  for(let i=0;i<cloudPayloads.length;i+=chunkSize){
    const chunk=cloudPayloads.slice(i,i+chunkSize);
    const now=new Date().toISOString();
    const batch=chunk.map(item=>({
      store_name:storeName,
      record_key:item.recordKey,
      payload:item.payload,
      updated_at:now,
      updated_by:user?.id || null,
    }));
    const {error}=await mdrCloudClient().from(MDR_CLOUD_TABLE).upsert(batch,{onConflict:'store_name,record_key'});
    if(error) throw error;
    await idbPutMany(storeName,chunk.map(item=>item.payload)).catch(error=>console.warn('Bulk-Cache konnte nicht vollständig aktualisiert werden:',storeName,error));
    chunk.forEach(item=>mdrPatchMemoryPut(storeName,item.payload));
    await mdrPatchSyncMetaRecords(storeName,chunk.map(item=>({recordKey:item.recordKey,updatedAt:now})));
  }
  localNotifyDataChanged(storeName);
  return [
    ...localOnlyPayloads.map(item=>storeName===LOCAL_STORES.userSettings?item.key:item.id),
    ...cloudPayloads.map(item=>storeName===LOCAL_STORES.userSettings?item.payload.key:item.payload.id),
  ];
}

async function mdrClearCachedCloudData() {
  MDR_MEMORY_CACHE.clear();
  MDR_SYNC_META_MEMORY.clear();
  await idbClearSyncMeta().catch(()=>{});
  for (const storeName of Object.values(LOCAL_STORES)) {
    mdrBumpStoreEpoch(storeName);
    const keepLocal = storeName === LOCAL_STORES.userSettings ? await mdrReadLocalOnlySettings() : [];
    await idbClear(storeName).catch(()=>{});
    if (keepLocal.length) await idbPutMany(storeName,keepLocal).catch(()=>{});
  }
}
