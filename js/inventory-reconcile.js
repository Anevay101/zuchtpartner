/* MDR V54.0.73 – lokaler Bestandsabgleich aus kopierten MDR-Profilseiten.
   Abgleich ausschließlich über normalisierte Pferdenamen. Keine automatische
   Löschung oder Besitzeränderung. Der Vergleich arbeitet nur auf dem bereits
   synchronisierten lokalen Pferdebestand.
*/
(() => {
  'use strict';

  function irEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function irNorm(value) {
    return String(value ?? '')
      .normalize('NFC')
      .replace(/[\u200B-\u200D\uFEFF]/g,'')
      .replace(/\u00a0/g,' ')
      .replace(/\s+/g,' ')
      .trim()
      .toLocaleLowerCase('de');
  }
  function irLang() { return window.MDR_I18N?.language === 'en' ? 'en' : 'de'; }
  function irText(de,en) { return irLang()==='en' ? en : de; }
  function irStripMarkdown(value) {
    return String(value ?? '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1')
      .replace(/\[\*\*([^\]]+?)\*\*\]\([^)]*\)/g,'$1')
      .replace(/\[([^\]]+?)\]\([^)]*\)/g,'$1')
      .replace(/\*\*|__|###?|####|~~/g,'')
      .replace(/<br\s*\/?\s*>/gi,' ')
      .replace(/\\([\\*_|])/g,'$1')
      .replace(/\u00a0/g,' ')
      .trim();
  }
  function irPlain(raw) {
    return String(raw || '').replace(/\r\n?/g,'\n').split('\n').map(irStripMarkdown).join('\n');
  }
  function irDetectServer(raw) {
    const text=String(raw || '');
    const plain=irPlain(text);
    // Sprach-/Profilmarker sind stärker als URLs: Beim Hintereinanderkopieren
    // mehrerer Seiten können die ersten Logo-/Background-Links der Folgeseite
    // noch am Ende des vorherigen Textblocks stehen.
    if (/\bPferde anzeigen\??\b|\bDabei seit\b|\bReiterkönnen\b/i.test(plain)) return 'DE';
    if (/\bShow horses\??\b|\bMember since\b|\bRiding Skills\b/i.test(plain)) return 'EN';
    if (/morning-dust-ranch\.de\//i.test(text)) return 'DE';
    if (/morning-dust-ranch\.com\//i.test(text)) return 'EN';
    if (/\bWillkommen\b|\beigene Pferde\b/i.test(plain)) return 'DE';
    if (/\bWelcome\b|\bhorses\b/i.test(plain)) return 'EN';
    return 'UNKNOWN';
  }
  function irLoginOwner(raw) {
    const lines=irPlain(raw).split('\n').map(x=>x.trim());
    for (let i=0;i<lines.length;i++) {
      let m=lines[i].match(/^(?:Username|Benutzername)\s*:\s*(.+)$/i);
      if (m?.[1]) return m[1].trim();
      if (/^(?:Username|Benutzername)\s*:\s*$/i.test(lines[i])) {
        for (let j=i+1;j<Math.min(lines.length,i+4);j++) if (lines[j]) return lines[j];
      }
    }
    for (let i=0;i<lines.length;i++) {
      if (/^(?:Welcome|Willkommen)\s*$/i.test(lines[i])) {
        for (let j=i+1;j<Math.min(lines.length,i+4);j++) if (lines[j]) return lines[j];
      }
      const m=lines[i].match(/^(?:Welcome|Willkommen)\s+(.+)$/i);
      if (m?.[1]) return m[1].trim();
    }
    return '';
  }
  function irProfileOwner(raw) {
    const lines=irPlain(raw).split('\n').map(x=>x.trim());
    for (let i=0;i<lines.length;i++) {
      if (!/^(?:Dabei seit|Member since)\s*:/i.test(lines[i])) continue;
      for (let j=i-1;j>=Math.max(0,i-8);j--) {
        const candidate=lines[j];
        if (!candidate) continue;
        if (/^(?:Profilbild|profile image|Breeding|Zucht)$/i.test(candidate)) continue;
        return candidate;
      }
    }
    // Fallback nur für ungewöhnliche/alte Profilkopien. Auf normalen Seiten ist
    // der Block direkt vor "Dabei seit" / "Member since" maßgeblich.
    return irLoginOwner(raw);
  }
  function irTopHorseCount(raw) {
    const plain=irPlain(raw);
    const m=plain.match(/(?:^|\n)\s*([\d. ,]+)\s+(?:eigene\s+Pferde|horses)\s*(?:\n|$)/i);
    if (!m) return null;
    const n=Number(String(m[1]).replace(/[^0-9]/g,''));
    return Number.isFinite(n) ? n : null;
  }
  function irExpectedCount(raw, profileOwner) {
    const loginOwner=irLoginOwner(raw);
    // Die obere Pferdezahl gehört immer zum eingeloggten Account. Bei einer
    // Partnerprofilseite darf sie daher nur benutzt werden, wenn beide Namen
    // tatsächlich identisch sind.
    if (!loginOwner || !profileOwner || irNorm(loginOwner)!==irNorm(profileOwner)) return null;
    return irTopHorseCount(raw);
  }
  function irSplitProfiles(raw) {
    const text=String(raw || '').replace(/\r\n?/g,'\n');
    const re=/(?:^|\n)[^\n]*(?:Willkommen|Welcome)(?:\s+[^\n]+)?/gi;
    const starts=[];
    let m;
    while ((m=re.exec(text))) starts.push(m.index + (text[m.index]==='\n' ? 1 : 0));
    if (starts.length<=1) return text.trim() ? [text] : [];
    return starts.map((start,i)=>text.slice(start,starts[i+1] ?? text.length)).filter(x=>x.trim());
  }
  function irSectionInfo(raw) {
    const lines=String(raw || '').replace(/\r\n?/g,'\n').split('\n');
    let start=-1, end=lines.length, hasEnd=false;
    for (let i=0;i<lines.length;i++) {
      const p=irStripMarkdown(lines[i]);
      if (start<0 && /^(?:Pferde anzeigen\?|Show horses\?|Show horses)$/i.test(p)) { start=i+1; continue; }
      if (start>=0 && /^(?:Reiterkönnen|Riding skills?|Rider skills?|Equestrian skills?)$/i.test(p)) { end=i; hasEnd=true; break; }
    }
    return {lines:start>=0 ? lines.slice(start,end) : [],hasStart:start>=0,hasEnd};
  }
  function irParseMarkdownHorseRow(line) {
    if (!/^\s*\|/.test(line) || !/site=pferd/i.test(line)) return null;
    const link=line.match(/\[([^\]]+?)\]\([^)]*site=pferd[^)]*\)/i);
    if (!link) return null;
    const name=irStripMarkdown(link[1]);
    if (!name || /^(Pferd|Horse)$/i.test(name)) return null;
    const after=line.slice((link.index || 0)+link[0].length);
    const cells=after.split('|').map(irStripMarkdown).filter(Boolean);
    let gp=null;
    for (const cell of cells) {
      if (/^\d{2,4}$/.test(cell)) { gp=Number(cell); break; }
    }
    return {name, external_id:null, gp, source:'name'};
  }
  function irParseTsvHorseRow(line) {
    if (!line.includes('\t')) return null;
    const cells=line.split('\t').map(irStripMarkdown).filter(Boolean);
    if (cells.length<4) return null;
    if (/^(Pferd|Horse)$/i.test(cells[0]) || /^(PferdRasse|HorseBreed)/i.test(cells[0])) return null;
    const ageIndex=cells.findIndex(c=>/^\d+\s*(?:Jahre?|years?)/i.test(c));
    if (ageIndex<2) return null;
    const gpCell=cells.slice(ageIndex+1).find(c=>/^\d{2,4}$/.test(c));
    return {name:cells[0], external_id:null, gp:gpCell ? Number(gpCell) : null, source:'name'};
  }
  function irParseProfile(raw) {
    const owner=irProfileOwner(raw);
    const server=irDetectServer(raw);
    const expected=irExpectedCount(raw,owner);
    const section=irSectionInfo(raw);
    const horses=[];
    for (const line of section.lines) {
      const row=irParseMarkdownHorseRow(line) || irParseTsvHorseRow(line);
      if (!row?.name) continue;
      horses.push({...row,_nameKey:irNorm(row.name)});
    }
    const structurallyComplete=section.hasStart && section.hasEnd;
    const complete=structurallyComplete && horses.length>0 && (expected==null || expected===horses.length);
    return {owner,server,expected,horses,complete,structurallyComplete,parsedCount:horses.length,loginOwner:irLoginOwner(raw)};
  }
  function irParseProfiles(raw) {
    const parsed=irSplitProfiles(raw).map(irParseProfile).filter(p=>p.owner || p.horses.length);
    // Derselbe Profiltext kann versehentlich doppelt eingefügt werden. Pro
    // Besitzer + Spielwelt behalten wir die vollständigere/größere Variante.
    const best=new Map();
    for (const p of parsed) {
      const key=`${irNorm(p.owner)}|${p.server}`;
      const old=best.get(key);
      if (!old || (p.complete && !old.complete) || (p.complete===old.complete && p.parsedCount>old.parsedCount)) best.set(key,p);
    }
    return [...best.values()];
  }

  function irLearning(horse) {
    try { return typeof mdrIsLearningHorse==='function' && mdrIsLearningHorse(horse); } catch { return false; }
  }
  function irHorseServer(horse) {
    const raw=String(horse?.mdr_server || horse?.game_version || '').trim().toUpperCase();
    return raw==='DE' || raw==='EN' ? raw : 'UNKNOWN';
  }
  function irServerCompatible(horse,profile) {
    const ps=String(profile?.server || '').toUpperCase();
    const hs=irHorseServer(horse);
    if (ps!=='DE' && ps!=='EN') return true;
    return hs==='UNKNOWN' || hs===ps;
  }
  function irCompare(localHorses, profiles, selectedOwners) {
    const selected=new Set([...selectedOwners].map(irNorm));
    const local=(localHorses || []).filter(h=>!irLearning(h));
    const localByName=new Map();
    for (const h of local) {
      const key=irNorm(h.name);
      if (!key) continue;
      if (!localByName.has(key)) localByName.set(key,[]);
      localByName.get(key).push(h);
    }

    const present=[], missing=[], ownerMismatch=[], notInMdr=[], ambiguous=[], profileSummaries=[], unchecked=[];
    const selectedProfiles=(profiles || []).filter(p=>selected.has(irNorm(p.owner)));
    const profilesByOwner=new Map();
    for (const p of selectedProfiles) {
      const ownerKey=irNorm(p.owner);
      if (!profilesByOwner.has(ownerKey)) profilesByOwner.set(ownerKey,[]);
      profilesByOwner.get(ownerKey).push(p);
    }

    // Wenn derselbe Name auf DE und EN vorkommt, darf ein noch nicht klassifiziertes
    // lokales Pferd nicht geraten werden. Bekannte Spielwelten lösen diesen Fall auf.
    const remoteWorlds=new Map();
    for (const p of selectedProfiles) {
      const ownerKey=irNorm(p.owner);
      for (const r of p.horses) {
        const nameKey=r._nameKey || irNorm(r.name);
        if (!nameKey) continue;
        const key=`${ownerKey}|${nameKey}`;
        if (!remoteWorlds.has(key)) remoteWorlds.set(key,new Set());
        if (p.server==='DE' || p.server==='EN') remoteWorlds.get(key).add(p.server);
      }
    }

    for (const ownerKey of selected) {
      const ownerProfiles=profilesByOwner.get(ownerKey) || [];
      if (!ownerProfiles.length) { unchecked.push(ownerKey); continue; }
      profileSummaries.push(...ownerProfiles);

      const ownerMatchedIds=new Set();
      const ownerUncertainIds=new Set();
      const completeServers=new Set();
      const profileForServer=new Map();

      for (const profile of ownerProfiles) {
        if (profile.complete && (profile.server==='DE' || profile.server==='EN')) {
          completeServers.add(profile.server);
          profileForServer.set(profile.server,profile);
        }
        const remoteNameCounts=new Map();
        for (const remote of profile.horses) {
          const key=remote._nameKey || irNorm(remote.name);
          remoteNameCounts.set(key,(remoteNameCounts.get(key)||0)+1);
        }

        for (const remote of profile.horses) {
          const nameKey=remote._nameKey || irNorm(remote.name);
          if (!nameKey) continue;
          const allNameHits=(localByName.get(nameKey) || []).filter(h=>irServerCompatible(h,profile));
          const remoteDuplicate=(remoteNameCounts.get(nameKey)||0)>1;
          const worlds=remoteWorlds.get(`${ownerKey}|${nameKey}`) || new Set();
          const unknownCrossWorld=worlds.size>1 && allNameHits.some(h=>irHorseServer(h)==='UNKNOWN');

          if (remoteDuplicate || allNameHits.length>1 || unknownCrossWorld) {
            for (const h of allNameHits) ownerUncertainIds.add(String(h.id));
            ambiguous.push({remote,profile,local:null,candidates:allNameHits.length,note:irText('Name ist mehrfach vorhanden und kann nicht eindeutig zugeordnet werden.','Name occurs more than once and cannot be matched unambiguously.')});
            continue;
          }

          if (allNameHits.length===1) {
            const match=allNameHits[0];
            if (irNorm(match.owner)===ownerKey) {
              present.push({remote,profile,local:match,matchedBy:'name'});
              ownerMatchedIds.add(String(match.id));
            } else {
              ownerMismatch.push({remote,profile,local:match,note:irText('Gleicher Pferdename ist in der Datenbank einem anderen Besitzer zugeordnet.','The same horse name is assigned to a different owner in the database.')});
            }
            continue;
          }
          missing.push({remote,profile,local:null});
        }
      }

      // Negative Aussagen nur bei vollständig erkannter Spielwelt. Pferde mit
      // unbekannter Spielwelt werden erst dann als "nicht mehr vorhanden" gewertet,
      // wenn für denselben Besitzer DE UND EN vollständig geprüft wurden.
      for (const h of local.filter(x=>irNorm(x.owner)===ownerKey)) {
        const id=String(h.id);
        if (ownerMatchedIds.has(id) || ownerUncertainIds.has(id)) continue;
        const hs=irHorseServer(h);
        if ((hs==='DE' || hs==='EN') && completeServers.has(hs)) {
          notInMdr.push({local:h,profile:profileForServer.get(hs),checkedServers:[hs]});
        } else if (hs==='UNKNOWN' && completeServers.has('DE') && completeServers.has('EN')) {
          notInMdr.push({local:h,profile:profileForServer.get('DE') || profileForServer.get('EN'),checkedServers:['DE','EN']});
        }
      }
    }
    return {present,missing,ownerMismatch,notInMdr,ambiguous,profileSummaries,unchecked};
  }

  async function irAssignDetectedServers(result) {
    // Besitz/Löschstatus werden nie verändert. Eine eindeutige Spielwelt darf nur
    // aus einem eindeutigen Namens-Treffer übernommen werden. Mehrdeutige Namen
    // werden bewusst ausgeschlossen.
    const pending=new Map();
    for (const item of [...(result?.present || []),...(result?.ownerMismatch || [])]) {
      const local=item?.local, server=String(item?.profile?.server || '').toUpperCase();
      if (!local?.id || (server!=='DE' && server!=='EN')) continue;
      if (irHorseServer(local)!=='UNKNOWN') continue;
      pending.set(String(local.id),{local,server});
    }
    if (!pending.size) return {updated:0};
    const now=new Date().toISOString();
    const updates=[...pending.values()].map(({local,server})=>({
      ...local, mdr_server:server, updated_at:now, last_change_source:'Bestandsabgleich'
    }));
    if (typeof localBulkPut==='function') await localBulkPut(LOCAL_STORES.horses,updates,100);
    else for (const row of updates) await localPut(LOCAL_STORES.horses,row);
    for (const {local,server} of pending.values()) local.mdr_server=server;
    return {updated:updates.length};
  }

  function irOwnerLabel(ownerKey, horses) {
    return (horses || []).find(h=>irNorm(h.owner)===ownerKey)?.owner || ownerKey;
  }
  function irRenderOwners(horses) {
    const root=document.getElementById('inventory-owner-options');
    if (!root) return;
    const owners=[...new Set((horses || []).map(h=>String(h.owner||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de'));
    root.innerHTML=owners.map(owner=>`<label class="inventory-owner-chip"><input type="checkbox" value="${irEsc(owner)}"><span>${irEsc(owner)}</span></label>`).join('');
  }
  function irResultTable(rows, type) {
    if (!rows.length) return `<p class="small muted">${irText('Keine Einträge.','No entries.')}</p>`;
    return `<div class="table-wrap"><table class="detail-table inventory-result-table"><thead><tr><th>${irText('Pferd','Horse')}</th><th>${irText('Spielwelt','Game world')}</th><th>${irText('Besitzer','Owner')}</th><th>${irText('Hinweis','Note')}</th><th>${irText('Aktion','Action')}</th></tr></thead><tbody>${rows.map(item=>{
      const local=item.local || null;
      const remote=item.remote || null;
      const horseName=remote?.name || local?.name || '–';
      const server=item.profile?.server || (item.checkedServers?.join('+')) || irHorseServer(local);
      const owner=local?.owner || item.profile?.owner || '–';
      let note='';
      if (type==='present') note=irText('Name stimmt eindeutig überein','unique name match');
      if (type==='missing') note=irText('kein Namens-Treffer in dieser Spielwelt','no name match in this game world');
      if (type==='mismatch') note=item.note || irText('Besitzer abweichend','owner differs');
      if (type==='gone') note=(item.checkedServers?.length||0)>1
        ? irText('auf keiner der vollständig geprüften DE-/EN-Profilseiten enthalten','not present on either fully checked DE/EN profile page')
        : irText('nicht auf der vollständig erkannten MDR-Profilseite enthalten','not present on the fully parsed MDR profile page');
      if (type==='ambiguous') note=item.note || irText('nicht eindeutig','ambiguous');
      const action=local?.id!=null ? `<a class="btn secondary small" href="view.html?id=${encodeURIComponent(local.id)}">${irText('Pferd öffnen','Open horse')}</a>` : '–';
      return `<tr><th>${irEsc(horseName)}</th><td>${irEsc(server||'–')}</td><td>${irEsc(owner)}</td><td>${irEsc(note)}</td><td>${action}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function irRenderResults(result, allHorses) {
    const root=document.getElementById('inventory-results');
    if (!root) return;
    const profileInfo=result.profileSummaries.map(p=>{
      const status=p.complete ? '✓' : '⚠';
      const countText=p.expected==null
        ? irText(`${p.parsedCount} erkannt`,`${p.parsedCount} parsed`)
        : `${p.parsedCount}/${p.expected}`;
      return `<span class="inventory-profile-pill ${p.complete?'ok':'warn'}">${status} ${irEsc(p.owner||'–')} · ${irEsc(p.server)} · ${irEsc(countText)}</span>`;
    }).join('');
    const unchecked=result.unchecked.map(key=>irOwnerLabel(key,allHorses));
    root.innerHTML=`
      <div class="inventory-profile-summary">${profileInfo || `<span class="muted">${irText('Keine ausgewählte Profilseite erkannt.','No selected profile page detected.')}</span>`}</div>
      ${unchecked.length ? `<div class="notice notice-warning small">${irText('Nicht geprüft – keine Profilseite erkannt:','Not checked – no profile page detected:')} ${irEsc(unchecked.join(', '))}</div>` : ''}
      ${result.profileSummaries.some(p=>!p.complete) ? `<div class="notice notice-warning small">${irText('Mindestens eine Profilseite wurde nicht vollständig erkannt. „Nicht mehr im MDR-Bestand“ wird für diese Spielwelt bewusst nicht berechnet.','At least one profile page was not parsed completely. “No longer in MDR stock” is intentionally not calculated for that game world.')}</div>` : ''}
      ${result.ambiguous.length ? `<div class="notice notice-warning small">⚠ ${result.ambiguous.length} ${irText('Namens-Treffer sind nicht eindeutig und werden weder als vorhanden noch als fehlend gewertet.','name matches are ambiguous and are counted as neither present nor missing.')}</div>` : ''}
      ${Number(result.serverAssignments)>0 ? `<div class="notice small">${irText(`Spielwelt bei ${result.serverAssignments} bisher unbekannten Pferd(en) eindeutig ergänzt.`,`Game world assigned unambiguously to ${result.serverAssignments} previously unclassified horse(s).`)}</div>` : ''}
      <div class="inventory-count-grid">
        <div><strong>${result.present.length}</strong><span>✓ ${irText('Vorhanden','Present')}</span></div>
        <div><strong>${result.missing.length}</strong><span>＋ ${irText('Fehlt in der Datenbank','Missing from database')}</span></div>
        <div><strong>${result.notInMdr.length}</strong><span>− ${irText('Nicht mehr im MDR-Bestand','No longer in MDR stock')}</span></div>
        <div><strong>${result.ownerMismatch.length}</strong><span>↔ ${irText('Besitzer abweichend','Owner differs')}</span></div>
      </div>
      ${result.ambiguous.length ? `<details class="inventory-result-group" open><summary>⚠ ${irText('Nicht eindeutig','Ambiguous')} · ${result.ambiguous.length}</summary>${irResultTable(result.ambiguous,'ambiguous')}</details>` : ''}
      <details class="inventory-result-group" ${result.missing.length?'open':''}><summary>＋ ${irText('Fehlt in der Datenbank','Missing from database')} · ${result.missing.length}</summary>${irResultTable(result.missing,'missing')}</details>
      <details class="inventory-result-group" ${result.notInMdr.length?'open':''}><summary>− ${irText('Nicht mehr im MDR-Bestand','No longer in MDR stock')} · ${result.notInMdr.length}</summary>${irResultTable(result.notInMdr,'gone')}</details>
      <details class="inventory-result-group" ${result.ownerMismatch.length?'open':''}><summary>↔ ${irText('Besitzer abweichend','Owner differs')} · ${result.ownerMismatch.length}</summary>${irResultTable(result.ownerMismatch,'mismatch')}</details>
      <details class="inventory-result-group"><summary>✓ ${irText('Vorhanden','Present')} · ${result.present.length}</summary>${irResultTable(result.present,'present')}</details>
      <p class="tiny muted">${irText('Es werden niemals automatisch Pferde gelöscht oder Besitzer geändert. Der Abgleich erfolgt ausschließlich über normalisierte Pferdenamen und nutzt den bereits synchronisierten lokalen Bestand.','Horses are never deleted and owners are never changed automatically. Matching uses normalized horse names only and the already synchronised local stock.')}</p>`;
  }

  let irHorses=[];
  async function irOpen() {
    const modal=document.getElementById('inventory-reconcile-modal');
    if (!modal) return;
    irHorses=(typeof filterOptionHorses!=='undefined' && Array.isArray(filterOptionHorses) && filterOptionHorses.length)
      ? filterOptionHorses.slice()
      : await localGetAll(LOCAL_STORES.horses);
    irRenderOwners(irHorses);
    document.getElementById('inventory-results').innerHTML='';
    document.getElementById('inventory-reconcile-status').textContent='';
    modal.hidden=false;
  }
  function irClose() { const m=document.getElementById('inventory-reconcile-modal'); if (m) m.hidden=true; }
  async function irRun() {
    const status=document.getElementById('inventory-reconcile-status');
    const raw=document.getElementById('inventory-reconcile-text')?.value || '';
    const selected=new Set([...document.querySelectorAll('#inventory-owner-options input:checked')].map(cb=>irNorm(cb.value)));
    if (!selected.size) { if(status)status.textContent=irText('Bitte mindestens einen Besitzer auswählen.','Please select at least one owner.'); return; }
    if (!raw.trim()) { if(status)status.textContent=irText('Bitte mindestens eine MDR-Profilseite einfügen.','Please paste at least one MDR profile page.'); return; }
    const profiles=irParseProfiles(raw);
    const result=irCompare(irHorses,profiles,selected);
    let serverAssignments=0;
    try {
      serverAssignments=(await irAssignDetectedServers(result)).updated || 0;
    } catch (error) {
      console.warn('Spielwelt-Zuordnung aus Bestandsabgleich fehlgeschlagen:',error);
      result.serverAssignmentError=true;
    }
    result.serverAssignments=serverAssignments;
    if(status) status.textContent=irText(
      `${profiles.length} Profilseite(n) erkannt.${result.serverAssignmentError?' Spielwelt-Zuordnung konnte nicht gespeichert werden.':''}`,
      `Detected ${profiles.length} profile page(s).${result.serverAssignmentError?' Game-world assignment could not be saved.':''}`
    );
    irRenderResults(result,irHorses);
  }

  function irInit() {
    document.getElementById('inventory-reconcile-btn')?.addEventListener('click',()=>irOpen().catch(err=>alert(err.message)));
    document.getElementById('inventory-reconcile-close')?.addEventListener('click',irClose);
    document.getElementById('inventory-reconcile-cancel')?.addEventListener('click',irClose);
    document.getElementById('inventory-reconcile-run')?.addEventListener('click',irRun);
    document.getElementById('inventory-owner-all')?.addEventListener('click',()=>document.querySelectorAll('#inventory-owner-options input').forEach(cb=>{cb.checked=true;}));
    document.getElementById('inventory-owner-none')?.addEventListener('click',()=>document.querySelectorAll('#inventory-owner-options input').forEach(cb=>{cb.checked=false;}));
    document.getElementById('inventory-reconcile-modal')?.addEventListener('click',e=>{if(e.target?.id==='inventory-reconcile-modal')irClose();});
  }

  window.MDR_INVENTORY_RECONCILE={parseProfiles:irParseProfiles,parseProfile:irParseProfile,compare:irCompare,assignDetectedServers:irAssignDetectedServers,normalizeName:irNorm};
  if (typeof document!=='undefined') {
    if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',irInit,{once:true}); else irInit();
  }
})();
