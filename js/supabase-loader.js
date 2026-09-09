// V54.0.36 – nicht blockierender Supabase-Bibliotheksloader.
// Ein langsames CDN darf die statischen MDR-Skripte nicht mehr daran hindern,
// überhaupt zu starten. Zwei öffentliche CDN-Endpunkte werden nacheinander
// versucht; requireSession() wartet begrenzt auf dieses Promise.
(function initMdrSupabaseLoader(){
  if (globalThis.supabase?.createClient) {
    globalThis.mdrSupabaseLibraryPromise=Promise.resolve(globalThis.supabase);
    return;
  }
  const urls=[
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://unpkg.com/@supabase/supabase-js@2'
  ];
  function loadOne(url,timeoutMs=5500){
    return new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      let done=false;
      const finish=(ok,error)=>{
        if(done)return; done=true; clearTimeout(timer);
        script.onload=null; script.onerror=null;
        if(ok && globalThis.supabase?.createClient) resolve(globalThis.supabase);
        else { try{script.remove();}catch{} reject(error||new Error(`Supabase-Bibliothek konnte nicht geladen werden: ${url}`)); }
      };
      const timer=setTimeout(()=>finish(false,new Error(`Supabase-CDN Timeout: ${url}`)),timeoutMs);
      script.src=url; script.async=true; script.crossOrigin='anonymous';
      script.onload=()=>finish(true);
      script.onerror=()=>finish(false,new Error(`Supabase-CDN nicht erreichbar: ${url}`));
      document.head.appendChild(script);
    });
  }
  globalThis.mdrSupabaseLibraryPromise=(async()=>{
    let lastError=null;
    for(const url of urls){
      try{return await loadOne(url);}catch(error){lastError=error;console.warn(error.message);}
    }
    throw lastError||new Error('Supabase-Bibliothek konnte nicht geladen werden.');
  })();
})();
