(async function initMdrLogin(){
  const form=document.getElementById('mdr-login-form');
  const username=document.getElementById('mdr-login-username');
  const password=document.getElementById('mdr-login-password');
  const errorBox=document.getElementById('mdr-login-error');
  const submit=document.getElementById('mdr-login-submit');
  const params=new URLSearchParams(location.search);
  const next=params.get('next') || 'index.html';
  const message=params.get('message') || '';
  const messageBox=document.getElementById('mdr-login-message');
  if(message && messageBox){messageBox.textContent=message;messageBox.hidden=false;}

  let client;
  try{client=typeof mdrGetSupabaseClient==='function'?await mdrGetSupabaseClient():mdrCreateSupabaseClient();}
  catch(error){errorBox.textContent=error.message;return;}

  async function isAllowedSession(session){
    if(!session?.user) return false;
    const check=await client.rpc('is_mdr_member');
    return !check.error && check.data===true;
  }

  try{
    const {data}=await client.auth.getSession();
    if(await isAllowedSession(data?.session)){
      location.replace(next);
      return;
    }
  }catch{}

  form?.addEventListener('submit',async(event)=>{
    event.preventDefault();
    errorBox.textContent='';
    const name=mdrNormalizeUsername(username?.value);
    const email=MDR_LOGIN_USERS[name];
    if(!email){errorBox.textContent='Benutzername oder Passwort ist nicht korrekt.';return;}
    if(!password?.value){errorBox.textContent='Bitte Passwort eingeben.';return;}

    submit.disabled=true;
    submit.textContent='Anmeldung läuft…';
    try{
      const {data,error}=await client.auth.signInWithPassword({email,password:password.value});
      if(error || !data?.session) throw error || new Error('Anmeldung fehlgeschlagen.');
      const allowed=await isAllowedSession(data.session);
      if(!allowed){await client.auth.signOut();throw new Error('Dieser Benutzer ist für MDR nicht freigeschaltet.');}
      location.replace(next);
    }catch(error){
      console.warn('MDR Login fehlgeschlagen:',error);
      errorBox.textContent='Benutzername oder Passwort ist nicht korrekt.';
      password.select();
    }finally{
      submit.disabled=false;
      submit.textContent='Anmelden';
    }
  });
})();
