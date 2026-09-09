// MDR V54 – öffentliche Browser-Konfiguration.
// Der Publishable Key ist absichtlich clientseitig. Die Zugriffsrechte werden
// in Supabase über Auth + Row Level Security abgesichert.
const MDR_SUPABASE_URL = 'https://dmhvizuendjgndkyjvzm.supabase.co';
const MDR_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_vcKNID6TStn6iBsnG1wj-Q__2nuZKv1';

const MDR_LOGIN_USERS = Object.freeze({
  anevay: 'anevay@mdr.invalid',
  saeculume: 'saeculume@mdr.invalid',
});

function mdrNormalizeUsername(value) {
  return String(value || '').trim().toLocaleLowerCase('de-DE');
}

function mdrCreateSupabaseClient() {
  if (!globalThis.supabase?.createClient) {
    throw new Error('Supabase-Bibliothek konnte nicht geladen werden. Bitte Internetverbindung prüfen.');
  }
  if (!globalThis.mdrSupabase) {
    globalThis.mdrSupabase = globalThis.supabase.createClient(
      MDR_SUPABASE_URL,
      MDR_SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }
    );
  }
  return globalThis.mdrSupabase;
}

async function mdrGetSupabaseClient() {
  if (!globalThis.supabase?.createClient) {
    if (globalThis.mdrSupabaseLibraryPromise) await globalThis.mdrSupabaseLibraryPromise;
  }
  return mdrCreateSupabaseClient();
}
