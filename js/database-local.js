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

function localNotifyDataChanged(storeName) {
  try {
    if (window.MDR_AUTO_BACKUP_SUSPENDED) return;
    window.mdrMarkDataChanged?.(storeName);
  } catch (error) {
    console.warn('Automatische MDR-Sicherung konnte nicht vorgemerkt werden:', error);
  }
}

function openLocalDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
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
async function idbDelete(storeName,key) {
  const db=await openLocalDatabase();
  return new Promise((resolve,reject)=>{const req=db.transaction(storeName,'readwrite').objectStore(storeName).delete(key);req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);});
}
async function idbClear(storeName) {
  const db=await openLocalDatabase();
  return new Promise((resolve,reject)=>{const req=db.transaction(storeName,'readwrite').objectStore(storeName).clear();req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);});
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

async function mdrPreparePayload(storeName, value) {
  const copy = (value && typeof value === 'object') ? structuredClone(value) : value;
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
  await idbClear(storeName);
  for (const row of rows || []) {
    try { await idbPut(storeName,row); } catch (error) { console.warn('Cache-Datensatz konnte nicht geschrieben werden:',storeName,error); }
  }
  if (keepLocal?.handle) await idbPut(storeName,keepLocal).catch(()=>{});
}

async function localGetAll(storeName) {
  try {
    const rows = await mdrCloudGetAll(storeName);
    await mdrSyncCacheStore(storeName,rows).catch(()=>{});
    if (storeName === LOCAL_STORES.userSettings) {
      const localOnly = await idbGet(storeName,'backup_directory_handle').catch(()=>null);
      return localOnly ? [...rows.filter(r=>r?.key!=='backup_directory_handle'), localOnly] : rows;
    }
    return rows;
  } catch (error) {
    console.warn(`Supabase-Lesen fehlgeschlagen (${storeName}); verwende lokalen Lesecache:`,error);
    return idbGetAll(storeName);
  }
}

async function localGet(storeName, key) {
  if (mdrIsLocalOnly(storeName,key)) return idbGet(storeName,key);
  const recordKey = mdrRecordKey(storeName,key);
  try {
    const { data, error } = await mdrCloudClient()
      .from(MDR_CLOUD_TABLE)
      .select('payload')
      .eq('store_name',storeName)
      .eq('record_key',recordKey)
      .maybeSingle();
    if (error) throw error;
    if (data?.payload != null) await idbPut(storeName,data.payload).catch(()=>{});
    else await idbDelete(storeName,key).catch(()=>{});
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
  return payload;
}

async function localAdd(storeName, value) {
  if (mdrIsLocalOnly(storeName,value)) {
    const result=await idbPut(storeName,value); localNotifyDataChanged(storeName); return result;
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
  localNotifyDataChanged(storeName);
  return storeName === LOCAL_STORES.userSettings ? payload.key : payload.id;
}

async function localPut(storeName, value) {
  if (mdrIsLocalOnly(storeName,value)) {
    const result=await idbPut(storeName,value); localNotifyDataChanged(storeName); return result;
  }
  const payload = await mdrCloudUpsert(storeName,value);
  localNotifyDataChanged(storeName);
  return storeName === LOCAL_STORES.userSettings ? payload.key : payload.id;
}

async function localDelete(storeName, key) {
  if (mdrIsLocalOnly(storeName,key)) {
    await idbDelete(storeName,key); localNotifyDataChanged(storeName); return;
  }
  const recordKey=mdrRecordKey(storeName,key);
  const { error } = await mdrCloudClient().from(MDR_CLOUD_TABLE).delete().eq('store_name',storeName).eq('record_key',recordKey);
  if (error) throw error;
  await idbDelete(storeName,key).catch(()=>{});
  localNotifyDataChanged(storeName);
}

async function localClear(storeName) {
  const localHandle = storeName === LOCAL_STORES.userSettings ? await idbGet(storeName,'backup_directory_handle').catch(()=>null) : null;
  const { error } = await mdrCloudClient().from(MDR_CLOUD_TABLE).delete().eq('store_name',storeName);
  if (error) throw error;
  await idbClear(storeName);
  if (localHandle?.handle) await idbPut(storeName,localHandle).catch(()=>{});
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

console.log('MDR V54 Supabase-Datenbank mit lokalem Lesecache wurde geladen.');

// Für vollständige JSON-Importe: Datensätze in kleinen Paketen übertragen,
// damit ein Erstimport nicht hunderte einzelne HTTP-Anfragen erzeugt.
async function localBulkPut(storeName, values, chunkSize=100) {
  const input=Array.isArray(values)?values:[];
  const cloudPayloads=[];
  for (const value of input) {
    if (mdrIsLocalOnly(storeName,value)) {
      await idbPut(storeName,value);
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
  const user=await mdrCurrentUser();
  for(let i=0;i<cloudPayloads.length;i+=chunkSize){
    const now=new Date().toISOString();
    const batch=cloudPayloads.slice(i,i+chunkSize).map(item=>({
      store_name:storeName,
      record_key:item.recordKey,
      payload:item.payload,
      updated_at:now,
      updated_by:user?.id || null,
    }));
    const {error}=await mdrCloudClient().from(MDR_CLOUD_TABLE).upsert(batch,{onConflict:'store_name,record_key'});
    if(error) throw error;
    for(const item of cloudPayloads.slice(i,i+chunkSize)) await idbPut(storeName,item.payload).catch(()=>{});
  }
  localNotifyDataChanged(storeName);
  return cloudPayloads.map(item=>storeName===LOCAL_STORES.userSettings?item.payload.key:item.payload.id);
}

async function mdrClearCachedCloudData() {
  for (const storeName of Object.values(LOCAL_STORES)) {
    const keepLocal = storeName === LOCAL_STORES.userSettings
      ? await idbGet(storeName,'backup_directory_handle').catch(()=>null)
      : null;
    await idbClear(storeName).catch(()=>{});
    if (keepLocal?.handle) await idbPut(storeName,keepLocal).catch(()=>{});
  }
}
