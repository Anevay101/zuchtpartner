// MDR V54 – gemeinsame Supabase-Datenbank mit browserlokalem IndexedDB-Lesecache.
// Die bekannten local* Funktionen bleiben erhalten, damit die bestehende App
// nicht auf eine zweite Datenzugriffsschicht umgebaut werden muss.
const LOCAL_DB_NAME = 'mdr-datenbank-local';
const LOCAL_DB_VERSION = 2;

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
const MDR_LOCAL_ONLY_SETTINGS = new Set(['backup_directory_handle']);

// V54.0.18 Performance: pro Seitenaufruf wird jeder Store nur einmal
// blockierend aus Supabase geladen. Weitere Leser verwenden den gemeinsamen
// Arbeitsspeicher-Cache; nach kurzer Zeit wird im Hintergrund aktualisiert.
// Dadurch bleiben Filter/Ansichten sofort reaktionsfähig, ohne Supabase als
// maßgeblichen gemeinsamen Datenbestand abzulösen.
const MDR_MEMORY_CACHE_STALE_MS = 20_000;
const MDR_MEMORY_CACHE = new Map();
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
    const { data, error } = await client
      .from(MDR_CLOUD_TABLE)
      .select('record_key,payload')
      .eq('store_name', storeName)
      .order('record_key', { ascending: true })
      .range(from, to);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    out.push(...rows.map(row => row.payload));
    if (rows.length < MDR_CLOUD_PAGE_SIZE) break;
  }
  return out;
}

async function mdrSyncCacheStore(storeName, rows) {
  const keepLocal = storeName === LOCAL_STORES.userSettings
    ? await idbGet(storeName,'backup_directory_handle').catch(()=>null)
    : null;
  await idbReplaceAll(storeName,rows,keepLocal);
  return keepLocal;
}

async function mdrMergeLocalOnlyRows(storeName, rows, knownLocalOnly=null) {
  if (storeName !== LOCAL_STORES.userSettings) return rows;
  const localOnly=knownLocalOnly || await idbGet(storeName,'backup_directory_handle').catch(()=>null);
  return localOnly
    ? [...rows.filter(r=>r?.key!=='backup_directory_handle'), localOnly]
    : rows;
}

async function mdrRefreshStore(storeName) {
  if (MDR_GET_ALL_INFLIGHT.has(storeName)) return MDR_GET_ALL_INFLIGHT.get(storeName);
  const startEpoch=mdrStoreEpoch(storeName);
  const promise=(async()=>{
    const cloudRows=await mdrCloudGetAll(storeName);
    // Falls während des Cloud-Lesens lokal gespeichert/gelöscht wurde,
    // darf die ältere Antwort den gerade geschriebenen Stand nicht wieder
    // überschreiben. Der nächste Hintergrundlauf holt dann den neuen Stand.
    if (mdrStoreEpoch(storeName)!==startEpoch) {
      return mdrMemoryRows(storeName) || cloudRows;
    }
    const keepLocal=await mdrSyncCacheStore(storeName,cloudRows).catch(error=>{
      console.warn('Lokaler Lesecache konnte nicht aktualisiert werden:',storeName,error);
      return null;
    });
    if (mdrStoreEpoch(storeName)!==startEpoch) {
      return mdrMemoryRows(storeName) || cloudRows;
    }
    const merged=await mdrMergeLocalOnlyRows(storeName,cloudRows,keepLocal);
    mdrSetMemoryCache(storeName,merged,Date.now());
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
    // Stale-while-revalidate: Anzeige/Filter bleiben sofort, eine ältere
    // Seiteninstanz prüft Supabase im Hintergrund und aktualisiert den
    // gemeinsamen Arbeitsspeicher für den nächsten Renderdurchlauf.
    if (Date.now()-cached.fetchedAt>MDR_MEMORY_CACHE_STALE_MS && !MDR_GET_ALL_INFLIGHT.has(storeName)) {
      mdrRefreshStore(storeName).catch(error=>console.warn(`Supabase-Hintergrundaktualisierung fehlgeschlagen (${storeName}):`,error));
    }
    return [...cached.rows];
  }
  try {
    const rows=await mdrRefreshStore(storeName);
    return [...rows];
  } catch (error) {
    console.warn(`Supabase-Lesen fehlgeschlagen (${storeName}); verwende lokalen Lesecache:`,error);
    const rows=await idbGetAll(storeName);
    mdrSetMemoryCache(storeName,rows,Date.now());
    return [...rows];
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
  try {
    const { data, error } = await mdrCloudClient()
      .from(MDR_CLOUD_TABLE)
      .select('payload')
      .eq('store_name',storeName)
      .eq('record_key',recordKey)
      .maybeSingle();
    if (error) throw error;
    if (data?.payload != null) {
      await idbPut(storeName,data.payload).catch(()=>{});
      mdrPatchMemoryPut(storeName,data.payload);
    } else {
      await idbDelete(storeName,key).catch(()=>{});
      mdrPatchMemoryDelete(storeName,key);
    }
    return data?.payload ?? null;
  } catch (error) {
    console.warn(`Supabase-Lesen fehlgeschlagen (${storeName}/${recordKey}); verwende Cache:`,error);
    return idbGet(storeName,key);
  }
}

async function mdrNextNumericId() {
  const { data, error } = await mdrCloudClient().rpc('mdr_next_numeric_id');
  if (error) throw error;
  const id = Number(data);
  if (!Number.isSafeInteger(id)) throw new Error('Supabase hat keine gültige neue MDR-ID geliefert.');
  return id;
}

async function mdrCloudUpsert(storeName, value) {
  const payload = await mdrPreparePayload(storeName,value);
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
  if (storeName === LOCAL_STORES.userSettings) {
    if (!payload?.key) throw new Error('Einstellung besitzt keinen Schlüssel.');
  } else if (payload?.id == null) {
    payload = { ...payload, id: await mdrNextNumericId() };
  }
  const recordKey = mdrRecordKey(storeName,payload);
  const user = await mdrCurrentUser();
  const { error } = await mdrCloudClient().from(MDR_CLOUD_TABLE).insert({
    store_name:storeName,
    record_key:recordKey,
    payload,
    updated_at:new Date().toISOString(),
    updated_by:user?.id || null,
  });
  if (error) throw error;
  await idbPut(storeName,payload).catch(()=>{});
  mdrPatchMemoryPut(storeName,payload);
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
  localNotifyDataChanged(storeName);
}

async function localClear(storeName) {
  mdrBumpStoreEpoch(storeName);
  const localHandle = storeName === LOCAL_STORES.userSettings ? await idbGet(storeName,'backup_directory_handle').catch(()=>null) : null;
  const { error } = await mdrCloudClient().from(MDR_CLOUD_TABLE).delete().eq('store_name',storeName);
  if (error) throw error;
  await idbClear(storeName);
  if (localHandle?.handle) await idbPut(storeName,localHandle).catch(()=>{});
  mdrSetMemoryCache(storeName,localHandle?.handle?[localHandle]:[],Date.now());
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

console.log('MDR V54.0.18 Supabase-Datenbank mit optimiertem Lesecache wurde geladen.');

// Für vollständige JSON-Importe: Datensätze in kleinen Paketen übertragen,
// damit ein Erstimport nicht hunderte einzelne HTTP-Anfragen erzeugt.
async function localBulkPut(storeName, values, chunkSize=100) {
  const input=Array.isArray(values)?values:[];
  if (!input.length) return [];
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
  }
  localNotifyDataChanged(storeName);
  return [
    ...localOnlyPayloads.map(item=>storeName===LOCAL_STORES.userSettings?item.key:item.id),
    ...cloudPayloads.map(item=>storeName===LOCAL_STORES.userSettings?item.payload.key:item.payload.id),
  ];
}

async function mdrClearCachedCloudData() {
  MDR_MEMORY_CACHE.clear();
  for (const storeName of Object.values(LOCAL_STORES)) {
    mdrBumpStoreEpoch(storeName);
    const keepLocal = storeName === LOCAL_STORES.userSettings
      ? await idbGet(storeName,'backup_directory_handle').catch(()=>null)
      : null;
    await idbClear(storeName).catch(()=>{});
    if (keepLocal?.handle) await idbPut(storeName,keepLocal).catch(()=>{});
  }
}
