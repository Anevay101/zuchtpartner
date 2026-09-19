/* MDR V54.0.72 – lokaler Bestandsabgleich aus kopierten MDR-Profilseiten.
   Keine automatische Löschung oder Besitzeränderung. Der Vergleich arbeitet
   ausschließlich auf dem bereits synchronisierten Pferdebestand.
*/
(() => {
  'use strict';

  function irEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function irNorm(value) {
    return String(value ?? '').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ').trim().toLocaleLowerCase('de');
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
    if (/morning-dust-ranch\.com\//i.test(text)) return 'EN';
    if (/morning-dust-ranch\.de\//i.test(text)) return 'DE';
    const plain=irPlain(text);
    if (/\bWelcome\b|\bown horses\b|\bShow horses\??\b/i.test(plain)) return 'EN';
    if (/\bWillkommen\b|\beigene Pferde\b|\bPferde anzeigen\??\b/i.test(plain)) return 'DE';
    return 'UNKNOWN';
  }
  function irProfileOwner(raw) {
    const plain=irPlain(raw);
    let m=plain.match(/(?:^|\n)\s*(?:Username|Benutzername)\s*:\s*\n+\s*([^\n]+)/i);
    if (m?.[1]) return m[1].trim();
    m=plain.match(/(?:^|\n)\s*(?:Welcome|Willkommen)\s+([^\n]+)/i);
    return m?.[1]?.trim() || '';
  }
  function irExpectedCount(raw) {
    const plain=irPlain(raw);
    const m=plain.match(/\b([\d. ,]+)\s+(?:eigene\s+Pferde|own\s+horses)\b/i);
    if (!m) return null;
    const n=Number(String(m[1]).replace(/[^0-9]/g,''));
    return Number.isFinite(n) ? n : null;
  }
  function irSplitProfiles(raw) {
    const text=String(raw || '').replace(/\r\n?/g,'\n');
    const re=/(?:^|\n)[^\n]*(?:Willkommen|Welcome)\s+[^\n]+/gi;
    const starts=[];
    let m;
    while ((m=re.exec(text))) starts.push(m.index + (text[m.index]==='\n' ? 1 : 0));
    if (starts.length<=1) return text.trim() ? [text] : [];
    return starts.map((start,i)=>text.slice(start,starts[i+1] ?? text.length)).filter(x=>x.trim());
  }
  function irSectionLines(raw) {
    const lines=String(raw || '').replace(/\r\n?/g,'\n').split('\n');
    let start=-1, end=lines.length;
    for (let i=0;i<lines.length;i++) {
      const p=irStripMarkdown(lines[i]);
      if (start<0 && /^(?:Pferde anzeigen\?|Show horses\?|Show horses)$/i.test(p)) { start=i+1; continue; }
      if (start>=0 && /^(?:Reiterkönnen|Riding skills?|Rider skills?|Equestrian skills?)$/i.test(p)) { end=i; break; }
    }
    return start>=0 ? lines.slice(start,end) : [];
  }
  function irParseMarkdownHorseRow(line) {
    if (!/^\s*\|/.test(line) || !/site=pferd/i.test(line)) return null;
    const link=line.match(/\[([^\]]+?)\]\(([^)]*site=pferd[^)]*id=(\d+)[^)]*)\)/i);
    if (!link) return null;
    const name=irStripMarkdown(link[1]);
    if (!name || /^(Pferd|Horse)$/i.test(name)) return null;
    const after=line.slice((link.index || 0)+link[0].length);
    const cells=after.split('|').map(irStripMarkdown).filter(Boolean);
    let gp=null;
    for (const cell of cells) {
      if (/^\d{2,4}$/.test(cell)) { gp=Number(cell); break; }
    }
    return {name, external_id:link[3], gp, source:'id'};
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
    const expected=irExpectedCount(raw);
    const lines=irSectionLines(raw);
    const horses=[];
    const seen=new Set();
    for (const line of lines) {
      const row=irParseMarkdownHorseRow(line) || irParseTsvHorseRow(line);
      if (!row?.name) continue;
      const key=row.external_id ? `id:${row.external_id}` : `name:${irNorm(row.name)}`;
      if (seen.has(key)) continue;
      seen.add(key); horses.push(row);
    }
    const complete=expected != null && expected===horses.length;
    return {owner,server,expected,horses,complete,parsedCount:horses.length};
  }
  function irParseProfiles(raw) {
    return irSplitProfiles(raw).map(irParseProfile).filter(p=>p.owner || p.horses.length);
  }

  function irLearning(horse) {
    try { return typeof mdrIsLearningHorse==='function' && mdrIsLearningHorse(horse); } catch { return false; }
  }
  function irHorseServer(horse) {
    const raw=String(horse?.mdr_server || horse?.game_version || '').trim().toUpperCase();
    return raw==='DE' || raw==='EN' ? raw : 'UNKNOWN';
  }
  function irCompare(localHorses, profiles, selectedOwners) {
    const selected=new Set([...selectedOwners].map(irNorm));
    const local=(localHorses || []).filter(h=>!irLearning(h));
    const localById=new Map();
    for (const h of local) {
      const id=String(h?.external_id || '').trim();
      if (id) localById.set(id,h);
    }
    const present=[], missing=[], ownerMismatch=[], notInMdr=[], profileSummaries=[], unchecked=[];
    const profileByOwner=new Map();
    for (const p of profiles || []) if (selected.has(irNorm(p.owner))) profileByOwner.set(irNorm(p.owner),p);

    for (const ownerKey of selected) {
      const profile=profileByOwner.get(ownerKey);
      if (!profile) { unchecked.push(ownerKey); continue; }
      profileSummaries.push(profile);
      const localsForOwner=local.filter(h=>irNorm(h.owner)===ownerKey);
      const localNameBuckets=new Map();
      for (const h of localsForOwner) {
        const k=irNorm(h.name); if (!k) continue;
        if (!localNameBuckets.has(k)) localNameBuckets.set(k,[]);
        localNameBuckets.get(k).push(h);
      }
      const matchedLocalIds=new Set();
      for (const remote of profile.horses) {
        let match=null;
        if (remote.external_id) {
          const idHit=localById.get(String(remote.external_id));
          if (idHit) {
            if (irNorm(idHit.owner)!==ownerKey) {
              ownerMismatch.push({remote,profile,local:idHit,note:irText('MDR-ID gehört in der Datenbank einem anderen Besitzer.','MDR ID belongs to a different owner in the database.')});
              matchedLocalIds.add(String(idHit.id));
              continue;
            }
            match=idHit;
          }
        }
        if (!match) {
          const nameHits=localNameBuckets.get(irNorm(remote.name)) || [];
          if (nameHits.length===1) match=nameHits[0];
        }
        if (match) {
          present.push({remote,profile,local:match,matchedBy:remote.external_id && String(match.external_id||'')===String(remote.external_id) ? 'id' : 'name'});
          matchedLocalIds.add(String(match.id));
        } else {
          missing.push({remote,profile,local:null});
        }
      }
      if (profile.complete) {
        for (const h of localsForOwner) {
          if (!matchedLocalIds.has(String(h.id))) notInMdr.push({local:h,profile});
        }
      }
    }
    return {present,missing,ownerMismatch,notInMdr,profileSummaries,unchecked};
  }

  async function irAssignDetectedServers(result) {
    // Der Bestandsabgleich darf Besitz/Löschstatus niemals verändern. Eine eindeutige
    // DE/EN-Zuordnung ist dagegen ein technisches Benchmark-Merkmal, das der Nutzer
    // ausdrücklich automatisch aus einer Profilseite übernehmen möchte. Um Egress
    // klein zu halten, schreiben wir nur Pferde, deren Spielwelt bisher wirklich
    // unbekannt ist, und übertragen sie gesammelt statt mit Einzelrequests.
    const pending=new Map();
    for (const item of [...(result?.present || []),...(result?.ownerMismatch || [])]) {
      const local=item?.local, server=String(item?.profile?.server || '').toUpperCase();
      if (!local?.id || (server!=='DE' && server!=='EN')) continue;
      if (irHorseServer(local)!=='UNKNOWN') continue;
      // Besitzerabweichungen werden nur bei exakter MDR-ID als sichere Serverquelle genutzt.
      if (item?.remote?.external_id && String(local.external_id||'')!==String(item.remote.external_id)) continue;
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
    return `<div class="table-wrap"><table class="detail-table inventory-result-table"><thead><tr><th>${irText('Pferd','Horse')}</th><th>MDR-ID</th><th>${irText('Besitzer','Owner')}</th><th>${irText('Hinweis','Note')}</th><th>${irText('Aktion','Action')}</th></tr></thead><tbody>${rows.map(item=>{
      const local=item.local || null;
      const remote=item.remote || null;
      const horseName=remote?.name || local?.name || '–';
      const ext=remote?.external_id || local?.external_id || '–';
      const owner=local?.owner || item.profile?.owner || '–';
      let note='';
      if (type==='present') note=item.matchedBy==='id' ? irText('MDR-ID stimmt überein','MDR ID matches') : irText('über Namen abgeglichen','matched by name');
      if (type==='missing') note=remote?.external_id ? irText('nicht in der Datenbank gefunden','not found in database') : irText('kein eindeutiger Namens-Treffer','no unique name match');
      if (type==='mismatch') note=item.note || irText('Besitzer abweichend','owner differs');
      if (type==='gone') note=irText('nicht auf der vollständig erkannten MDR-Profilseite enthalten','not present on the fully parsed MDR profile page');
      const action=local?.id!=null ? `<a class="btn secondary small" href="view.html?id=${encodeURIComponent(local.id)}">${irText('Pferd öffnen','Open horse')}</a>` : '–';
      return `<tr><th>${irEsc(horseName)}</th><td>${irEsc(ext)}</td><td>${irEsc(owner)}</td><td>${irEsc(note)}</td><td>${action}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function irRenderResults(result, allHorses) {
    const root=document.getElementById('inventory-results');
    if (!root) return;
    const profileInfo=result.profileSummaries.map(p=>{
      const count=p.expected==null ? '–' : p.expected;
      const status=p.complete ? '✓' : '⚠';
      return `<span class="inventory-profile-pill ${p.complete?'ok':'warn'}">${status} ${irEsc(p.owner||'–')} · ${irEsc(p.server)} · ${p.parsedCount}/${count}</span>`;
    }).join('');
    const unchecked=result.unchecked.map(key=>irOwnerLabel(key,allHorses));
    root.innerHTML=`
      <div class="inventory-profile-summary">${profileInfo || `<span class="muted">${irText('Keine ausgewählte Profilseite erkannt.','No selected profile page detected.')}</span>`}</div>
      ${unchecked.length ? `<div class="notice notice-warning small">${irText('Nicht geprüft – keine Profilseite erkannt:','Not checked – no profile page detected:')} ${irEsc(unchecked.join(', '))}</div>` : ''}
      ${result.profileSummaries.some(p=>!p.complete) ? `<div class="notice notice-warning small">${irText('Mindestens eine Profilseite wurde nicht vollständig erkannt. „Nicht mehr im MDR-Bestand“ wird für diese Besitzer bewusst nicht berechnet.','At least one profile page was not parsed completely. “No longer in MDR stock” is intentionally not calculated for those owners.')}</div>` : ''}
      ${Number(result.serverAssignments)>0 ? `<div class="notice small">${irText(`Spielwelt bei ${result.serverAssignments} bisher unbekannten Pferd(en) eindeutig ergänzt.`,`Game world assigned unambiguously to ${result.serverAssignments} previously unclassified horse(s).`)}</div>` : ''}
      <div class="inventory-count-grid">
        <div><strong>${result.present.length}</strong><span>✓ ${irText('Vorhanden','Present')}</span></div>
        <div><strong>${result.missing.length}</strong><span>＋ ${irText('Fehlt in der Datenbank','Missing from database')}</span></div>
        <div><strong>${result.notInMdr.length}</strong><span>− ${irText('Nicht mehr im MDR-Bestand','No longer in MDR stock')}</span></div>
        <div><strong>${result.ownerMismatch.length}</strong><span>↔ ${irText('Besitzer abweichend','Owner differs')}</span></div>
      </div>
      <details class="inventory-result-group" ${result.missing.length?'open':''}><summary>＋ ${irText('Fehlt in der Datenbank','Missing from database')} · ${result.missing.length}</summary>${irResultTable(result.missing,'missing')}</details>
      <details class="inventory-result-group" ${result.notInMdr.length?'open':''}><summary>− ${irText('Nicht mehr im MDR-Bestand','No longer in MDR stock')} · ${result.notInMdr.length}</summary>${irResultTable(result.notInMdr,'gone')}</details>
      <details class="inventory-result-group" ${result.ownerMismatch.length?'open':''}><summary>↔ ${irText('Besitzer abweichend','Owner differs')} · ${result.ownerMismatch.length}</summary>${irResultTable(result.ownerMismatch,'mismatch')}</details>
      <details class="inventory-result-group"><summary>✓ ${irText('Vorhanden','Present')} · ${result.present.length}</summary>${irResultTable(result.present,'present')}</details>
      <p class="tiny muted">${irText('Es werden niemals automatisch Pferde gelöscht oder Besitzer geändert. Der Abgleich nutzt den bereits synchronisierten lokalen Bestand und löst keine zusätzliche Vollabfrage des Pferdebestands aus.','Horses are never deleted and owners are never changed automatically. The comparison uses the already synchronised local stock and does not trigger an additional full download of the horse database.')}</p>`;
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

  window.MDR_INVENTORY_RECONCILE={parseProfiles:irParseProfiles,parseProfile:irParseProfile,compare:irCompare,assignDetectedServers:irAssignDetectedServers};
  if (typeof document!=='undefined') {
    if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',irInit,{once:true}); else irInit();
  }
})();
