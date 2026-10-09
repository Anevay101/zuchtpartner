/* MDR V54.0.92 – Bestands-, Zuchtgemeinschafts- und Deckstationsabgleich aus kopierten MDR-Seiten.
   Eindeutige normalisierte Pferdenamen sind der primäre Match-Schlüssel.
   Spielwelt, Geschlecht, Besitzer, Rasse und GP dienen bei Mehrdeutigkeiten
   bzw. als Plausibilitäts-Hinweise. Kritische Bestandsaktionen sind explizit
   auswählbar und nutzen den bestehenden Ein-Schritt-Undo.
*/
(() => {
  'use strict';

  function irEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function irDecodeEntities(value) {
    const named={nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
    let out=String(value ?? '');
    // Mehrfaches Dekodieren ist absichtlich auf wenige Durchläufe begrenzt,
    // weil MDR-/Markdown-Kopien gelegentlich bereits einmal HTML-escaped sind.
    for (let pass=0;pass<3;pass++) {
      const next=out.replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi,(m,code)=>{
        if (code[0]==='#') {
          const hex=/^#x/i.test(code);
          const n=parseInt(code.slice(hex?2:1),hex?16:10);
          return Number.isFinite(n) ? String.fromCodePoint(n) : m;
        }
        return named[String(code).toLowerCase()] ?? m;
      });
      if (next===out) break;
      out=next;
    }
    return out;
  }
  function irNorm(value) {
    return irDecodeEntities(String(value ?? ''))
      .replace(/\\~/g,'~')
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
    // Wichtig: Tilden sind bei MDR reguläre Bestandteile vieler Pferdenamen
    // (z. B. ~Ts~ oder ~~APH~~) und dürfen daher NICHT als Markdown-Strikethrough
    // entfernt werden. Ebenso werden HTML-Leerzeichen wie &#x20; dekodiert.
    return irDecodeEntities(String(value ?? '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1')
      .replace(/\[\*\*([^\]]+?)\*\*\]\([^)]*\)/g,'$1')
      .replace(/\[([^\]]+?)\]\([^)]*\)/g,'$1')
      .replace(/\*\*|__|###?|####/g,'')
      .replace(/<br\s*\/?\s*>/gi,' ')
      .replace(/\\([\\*_|~])/g,'$1'))
      .replace(/\u00a0/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }
  function irHorseName(value) {
    return irStripMarkdown(value)
      .replace(/[\u200B-\u200D\uFEFF]/g,'')
      .replace(/\s+/g,' ')
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
  function irSexKey(value) {
    const raw=irNorm(value);
    if (/^(?:hengst|stallion|male|colt)$/.test(raw)) return 'stallion';
    if (/^(?:stute|mare|female|filly)$/.test(raw)) return 'mare';
    if (/^(?:wallach|gelding)$/.test(raw)) return 'gelding';
    return '';
  }
  function irParseProfileHorseCells(name, cells) {
    const clean=(cells||[]).map(irStripMarkdown);
    const ageIndex=clean.findIndex(c=>/^\d+\s*(?:Jahre?|years?)/i.test(c));
    if (ageIndex<2) return null;
    const breed=String(clean[ageIndex-2]||'').trim();
    const sexRaw=String(clean[ageIndex-1]||'').trim();
    const gpCell=clean.slice(ageIndex+1).find(c=>/^\d{2,4}$/.test(c));
    return {
      name:irHorseName(name), external_id:null, breed, sex:irSexKey(sexRaw), sex_raw:sexRaw,
      gp:gpCell ? Number(gpCell) : null, source:'name'
    };
  }
  function irParseMarkdownHorseRow(line) {
    if (!/^\s*\|/.test(line) || !/site=pferd/i.test(line)) return null;
    const link=line.match(/\[([^\]]+?)\]\([^)]*site=pferd[^)]*\)/i);
    if (!link) return null;
    const name=irStripMarkdown(link[1]);
    if (!name || /^(Pferd|Horse)$/i.test(name)) return null;
    const after=line.slice((link.index || 0)+link[0].length);
    const cells=after.split('|').map(irStripMarkdown).filter(Boolean);
    return irParseProfileHorseCells(name,cells);
  }
  function irParseTsvHorseRow(line) {
    if (!line.includes('\t')) return null;
    const cells=line.split('\t').map(irStripMarkdown);
    while (cells.length && !String(cells[0]||'').trim()) cells.shift();
    while (cells.length && !String(cells[cells.length-1]||'').trim()) cells.pop();
    if (cells.length<4) return null;
    if (/^(Pferd|Horse)$/i.test(cells[0]) || /^(PferdRasse|HorseBreed)/i.test(cells[0])) return null;
    return irParseProfileHorseCells(cells[0],cells.slice(1));
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
    try { return typeof mdrIsLearningHorse==='function' && mdrIsLearningHorse(horse); } catch { return horse?.learning_file===true; }
  }
  function irComparableOwner(horse) {
    if (!horse || typeof horse!=='object') return '';
    const original=String(horse.learning_original_owner||'').trim();
    if (irLearning(horse) && original) return original;
    return String(horse.owner||'').trim();
  }
  function irHorseServer(horse) {
    return mdrGameWorld(horse, 'UNKNOWN');
  }
  function irServerCompatible(horse,profile) {
    const ps=String(profile?.server || '').toUpperCase();
    const hs=irHorseServer(horse);
    if (ps!=='DE' && ps!=='EN') return true;
    return hs==='UNKNOWN' || hs===ps;
  }
  function irLocalSex(horse) {
    return irSexKey(horse?.gender || horse?.sex || horse?.geschlecht || '');
  }
  function irLocalGp(horse) {
    const values=[horse?.gp,horse?.overall_potential,horse?.gesamtpotential];
    for (const value of values) {
      const n=Number(value);
      if (Number.isFinite(n)) return n;
    }
    try {
      if (typeof computeDerived==='function') {
        const n=Number(computeDerived(horse)?.gp);
        if (Number.isFinite(n)) return n;
      }
    } catch {}
    return null;
  }
  function irNarrowCandidates(candidates,predicate) {
    const narrowed=(candidates||[]).filter(predicate);
    return narrowed.length ? narrowed : candidates;
  }
  function irResolveProfileNameMatch(remote,profile,localByName) {
    const nameKey=remote?._nameKey || irNorm(remote?.name);
    const all=(localByName.get(nameKey) || []).slice();
    if (!all.length) return {state:'missing',local:null,candidates:0,all:[]};
    if (all.length===1) return {state:'matched',local:all[0],candidates:1,all};

    let pool=all.slice();
    const ps=String(profile?.server||'').toUpperCase();
    if (ps==='DE' || ps==='EN') {
      const exact=pool.filter(h=>irHorseServer(h)===ps);
      if (exact.length) pool=exact;
    }
    if (remote?.sex) pool=irNarrowCandidates(pool,h=>irLocalSex(h)===remote.sex);
    if (remote?.breed) pool=irNarrowCandidates(pool,h=>irNorm(h?.breed)===irNorm(remote.breed));
    if (Number.isFinite(Number(remote?.gp))) pool=irNarrowCandidates(pool,h=>Number(irLocalGp(h))===Number(remote.gp));
    const ownerKey=irNorm(profile?.owner);
    if (ownerKey) pool=irNarrowCandidates(pool,h=>irNorm(irComparableOwner(h))===ownerKey);

    if (pool.length===1) return {state:'matched',local:pool[0],candidates:all.length,all};
    return {state:'ambiguous',local:null,candidates:all.length,all};
  }
  function irMatchWarnings(local,remote,profile) {
    if (!local) return [];
    const warnings=[];
    const ps=String(profile?.server||'').toUpperCase();
    const hs=irHorseServer(local);
    if ((ps==='DE'||ps==='EN') && (hs==='DE'||hs==='EN') && ps!==hs) {
      warnings.push(irText(`Spielwelt abweichend (DB ${hs}, Profil ${ps})`,`game world differs (DB ${hs}, profile ${ps})`));
    }
    const ls=irLocalSex(local);
    if (remote?.sex && ls && remote.sex!==ls) warnings.push(irText('Geschlecht abweichend','sex differs'));
    if (remote?.breed && local?.breed && irNorm(remote.breed)!==irNorm(local.breed)) warnings.push(irText('Rasse abweichend','breed differs'));
    const rgp=Number(remote?.gp), lgp=Number(irLocalGp(local));
    if (Number.isFinite(rgp) && Number.isFinite(lgp) && rgp!==lgp) warnings.push(`GP/OP ${lgp}→${rgp}`);
    if (irLearning(local)) warnings.push(irText('DB: GBH/Lerndatei','DB: GBH/learning file'));
    return warnings;
  }
  function irCompare(localHorses, profiles, selectedOwners) {
    const selected=new Set([...selectedOwners].map(irNorm));
    // V54.0.92: Lerndatei-/GBH-Pferde bleiben Teil des Bestandsabgleichs.
    // Sonst würden gerade bereits aussortierte/alte Pferde aus negativen
    // Bestandsaussagen verschwinden.
    const local=(localHorses || []).slice();
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
          const remoteDuplicate=(remoteNameCounts.get(nameKey)||0)>1;
          const resolved=irResolveProfileNameMatch(remote,profile,localByName);

          if (remoteDuplicate || resolved.state==='ambiguous') {
            for (const h of resolved.all||[]) ownerUncertainIds.add(String(h.id));
            ambiguous.push({remote,profile,local:null,candidates:resolved.candidates,note:irText('Name ist mehrfach vorhanden und kann trotz Spielwelt/Geschlecht/Rasse/GP nicht eindeutig zugeordnet werden.','Name occurs more than once and remains ambiguous after game world/sex/breed/OP checks.')});
            continue;
          }

          if (resolved.state==='matched' && resolved.local) {
            const match=resolved.local;
            const warnings=irMatchWarnings(match,remote,profile);
            if (irNorm(irComparableOwner(match))===ownerKey) {
              present.push({remote,profile,local:match,matchedBy:'name',warnings});
              ownerMatchedIds.add(String(match.id));
            } else {
              ownerMismatch.push({
                remote,profile,local:match,warnings,
                note:irText('Gleicher Pferdename ist in der Datenbank einem anderen Besitzer zugeordnet.','The same horse name is assigned to a different owner in the database.')
              });
            }
            continue;
          }
          missing.push({remote,profile,local:null});
        }
      }

      // Negative Aussagen nur bei vollständig erkannter Spielwelt. Lern-/GBH-
      // Pferde werden über ihren ursprünglichen Besitzer einsortiert.
      for (const h of local.filter(x=>irNorm(irComparableOwner(x))===ownerKey)) {
        const id=String(h.id);
        if (ownerMatchedIds.has(id) || ownerUncertainIds.has(id)) continue;
        const hs=irHorseServer(h);
        if ((hs==='DE' || hs==='EN') && completeServers.has(hs)) {
          notInMdr.push({local:h,profile:profileForServer.get(hs),checkedServers:[hs],warnings:irLearning(h)?[irText('DB: GBH/Lerndatei','DB: GBH/learning file')]:[]});
        } else if (hs==='UNKNOWN' && completeServers.has('DE') && completeServers.has('EN')) {
          notInMdr.push({local:h,profile:profileForServer.get('DE') || profileForServer.get('EN'),checkedServers:['DE','EN'],warnings:irLearning(h)?[irText('DB: GBH/Lerndatei','DB: GBH/learning file')]:[]});
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
      ...local, mdr_server:server, game_version:server, updated_at:now, last_change_source:'Bestandsabgleich'
    }));
    if (typeof localBulkPut==='function') await localBulkPut(LOCAL_STORES.horses,updates,100);
    else for (const row of updates) await localPut(LOCAL_STORES.horses,row);
    for (const {local,server} of pending.values()) { local.mdr_server=server; local.game_version=server; }
    return {updated:updates.length};
  }

  function irOwnerLabel(ownerKey, horses) {
    return (horses || []).find(h=>irNorm(irComparableOwner(h))===ownerKey)?.learning_original_owner
      || (horses || []).find(h=>irNorm(irComparableOwner(h))===ownerKey)?.owner
      || ownerKey;
  }
  function irRenderOwners(horses) {
    const root=document.getElementById('inventory-owner-options');
    if (!root) return;
    const owners=[...new Set((horses || []).map(irComparableOwner).map(v=>String(v||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de'));
    root.innerHTML=owners.map(owner=>`<label class="inventory-owner-chip"><input type="checkbox" value="${irEsc(owner)}"><span>${irEsc(owner)}</span></label>`).join('');
  }

  let irStockSelectedIds=new Set();
  let irLastStockResult=null;

  function irStockItemMap(result) {
    const map=new Map();
    for (const [type,rows] of [
      ['mismatch',result?.ownerMismatch||[]],['gone',result?.notInMdr||[]],['present',result?.present||[]]
    ]) {
      for (const item of rows) {
        if (item?.local?.id==null) continue;
        const id=String(item.local.id);
        if (!map.has(id) || type==='mismatch') map.set(id,{item,type});
      }
    }
    return map;
  }
  function irStockSelectedRows() {
    const map=irStockItemMap(irLastStockResult);
    return [...irStockSelectedIds].map(id=>map.get(String(id))).filter(Boolean);
  }
  function irStockOwnerUpdateTargets() {
    const targets=new Map();
    for (const entry of irStockSelectedRows()) {
      if (entry.type!=='mismatch') continue;
      const id=String(entry.item.local.id);
      const target=String(entry.item.profile?.owner||'').trim();
      if (!target) continue;
      if (!targets.has(id)) targets.set(id,new Set());
      targets.get(id).add(target);
    }
    return [...targets.entries()].filter(([,owners])=>owners.size===1).map(([id,owners])=>({id,owner:[...owners][0]}));
  }
  function irUpdateStockBulkBar() {
    const bar=document.getElementById('inventory-bulk-actions');
    if (!bar) return;
    // Entfernte/neu gerenderte Zeilen automatisch aus der Auswahl lösen.
    const available=new Set([...document.querySelectorAll('#inventory-results [data-inventory-select]')].map(cb=>String(cb.dataset.inventorySelect)));
    irStockSelectedIds=new Set([...irStockSelectedIds].filter(id=>available.has(String(id))));
    document.querySelectorAll('#inventory-results [data-inventory-select]').forEach(cb=>{cb.checked=irStockSelectedIds.has(String(cb.dataset.inventorySelect));});
    const count=irStockSelectedIds.size;
    bar.hidden=count===0;
    const label=document.getElementById('inventory-bulk-count');
    if (label) label.textContent=irText(`${count} Pferd${count===1?'':'e'} ausgewählt`,`${count} horse${count===1?'':'s'} selected`);
    const ownerBtn=document.querySelector('#inventory-bulk-actions [data-inventory-bulk="owner"]');
    const ownerTargets=irStockOwnerUpdateTargets();
    if (ownerBtn) {
      ownerBtn.disabled=ownerTargets.length===0;
      ownerBtn.textContent=irText(`Besitzer aktualisieren${ownerTargets.length?` (${ownerTargets.length})`:''}`,`Update owner${ownerTargets.length?` (${ownerTargets.length})`:''}`);
    }
    document.querySelectorAll('#inventory-results [data-inventory-select-group]').forEach(master=>{
      const type=master.dataset.inventorySelectGroup;
      const boxes=[...document.querySelectorAll(`#inventory-results [data-inventory-select-type="${CSS.escape(type)}"]`)];
      const checked=boxes.filter(cb=>irStockSelectedIds.has(String(cb.dataset.inventorySelect))).length;
      master.checked=boxes.length>0 && checked===boxes.length;
      master.indeterminate=checked>0 && checked<boxes.length;
    });
  }
  function irStockWarningsHtml(item) {
    const warnings=Array.isArray(item?.warnings)?item.warnings.filter(Boolean):[];
    return warnings.length ? `<br><span class="tiny inventory-stock-warning">⚠ ${irEsc(warnings.join(' · '))}</span>` : '';
  }
  function irResultTable(rows, type) {
    if (!rows.length) return `<p class="small muted">${irText('Keine Einträge.','No entries.')}</p>`;
    const selectable=rows.some(item=>item?.local?.id!=null);
    const selectHead=selectable
      ? `<label class="inventory-select-all" title="${irText('Alle in dieser Gruppe auswählen','Select all in this group')}"><input type="checkbox" data-inventory-select-group="${irEsc(type)}"><span>${irText('Alle','All')}</span></label>`
      : '–';
    return `<div class="table-wrap"><table class="detail-table inventory-result-table"><thead><tr><th>${irText('Pferd','Horse')}</th><th>${irText('Spielwelt','Game world')}</th><th>${irText('Besitzer','Owner')}</th><th>${irText('Hinweis','Note')}</th><th class="inventory-select-head">${selectHead}</th></tr></thead><tbody>${rows.map(item=>{
      const local=item.local || null;
      const remote=item.remote || null;
      const horseName=remote?.name || local?.name || '–';
      const server=item.profile?.server || (item.checkedServers?.join('+')) || irHorseServer(local);
      const comparableOwner=local ? irComparableOwner(local) : '';
      const owner=comparableOwner || item.profile?.owner || '–';
      let note='';
      if (type==='present') note=irText('Name eindeutig in der Datenbank gefunden','unique name found in database');
      if (type==='missing') note=irText('kein Pferd mit diesem Namen in der Datenbank','no horse with this name in the database');
      if (type==='mismatch') {
        const target=String(item.profile?.owner||'').trim();
        note=target
          ? irText(`Besitzer DB: ${owner} → MDR: ${target}`,`Owner DB: ${owner} → MDR: ${target}`)
          : (item.note || irText('Besitzer abweichend','owner differs'));
      }
      if (type==='gone') note=(item.checkedServers?.length||0)>1
        ? irText('auf keiner der vollständig geprüften DE-/EN-Profilseiten enthalten','not present on either fully checked DE/EN profile page')
        : irText('nicht auf der vollständig erkannten MDR-Profilseite enthalten','not present on the fully parsed MDR profile page');
      if (type==='ambiguous') note=item.note || irText('nicht eindeutig','ambiguous');
      const action=local?.id!=null
        ? `<label class="inventory-row-select" title="${irText('Für Mehrfachaktion auswählen','Select for bulk action')}"><input type="checkbox" data-inventory-select="${irEsc(local.id)}" data-inventory-select-type="${irEsc(type)}"><span class="sr-only">${irText('Auswählen','Select')}</span></label>`
        : '–';
      const ownerSuffix=local && irLearning(local) ? `<br><span class="tiny muted">${irText('GBH/Lerndatei','GBH/learning file')}</span>` : '';
      return `<tr><td class="inventory-stock-name-cell">${irEsc(horseName)}</td><td>${irEsc(server||'–')}</td><td>${irEsc(owner)}${ownerSuffix}</td><td>${irEsc(note)}${irStockWarningsHtml(item)}</td><td class="inventory-select-cell">${action}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function irRenderResults(result, allHorses) {
    const root=document.getElementById('inventory-results');
    if (!root) return;
    irLastStockResult=result;
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
      ${result.ambiguous.length ? `<div class="notice notice-warning small">⚠ ${result.ambiguous.length} ${irText('Namens-Treffer sind nicht eindeutig. Sie werden nicht als „fehlt“ gewertet.','name matches are ambiguous. They are not counted as missing.')}</div>` : ''}
      ${Number(result.serverAssignments)>0 ? `<div class="notice small">${irText(`Spielwelt bei ${result.serverAssignments} bisher unbekannten Pferd(en) eindeutig ergänzt.`,`Game world assigned unambiguously to ${result.serverAssignments} previously unclassified horse(s).`)}</div>` : ''}
      <div class="inventory-count-grid">
        <div><strong>${result.present.length}</strong><span>✓ ${irText('Vorhanden','Present')}</span></div>
        <div><strong>${result.missing.length}</strong><span>＋ ${irText('Fehlt in der Datenbank','Missing from database')}</span></div>
        <div><strong>${result.notInMdr.length}</strong><span>− ${irText('Nicht mehr im MDR-Bestand','No longer in MDR stock')}</span></div>
        <div><strong>${result.ownerMismatch.length}</strong><span>↔ ${irText('Besitzer abweichend','Owner differs')}</span></div>
      </div>
      <div id="inventory-bulk-actions" class="inventory-bulk-actions" hidden>
        <strong id="inventory-bulk-count"></strong>
        <div class="inventory-bulk-buttons">
          <button type="button" class="secondary small" data-inventory-bulk="owner" disabled>${irText('Besitzer aktualisieren','Update owner')}</button>
          <button type="button" class="secondary small" data-inventory-bulk="learning">${irText('Auf GBH / Lerndatei','Move to GBH / learning file')}</button>
          <button type="button" class="danger small" data-inventory-bulk="delete">${irText('Aus Datenbank löschen','Delete from database')}</button>
          <button type="button" class="link-button small" data-inventory-bulk="clear">${irText('Auswahl aufheben','Clear selection')}</button>
        </div>
      </div>
      ${result.ambiguous.length ? `<details class="inventory-result-group" open><summary>⚠ ${irText('Nicht eindeutig','Ambiguous')} · ${result.ambiguous.length}</summary>${irResultTable(result.ambiguous,'ambiguous')}</details>` : ''}
      <details class="inventory-result-group" ${result.missing.length?'open':''}><summary>＋ ${irText('Fehlt in der Datenbank','Missing from database')} · ${result.missing.length}</summary>${irResultTable(result.missing,'missing')}</details>
      <details class="inventory-result-group" ${result.notInMdr.length?'open':''}><summary>− ${irText('Nicht mehr im MDR-Bestand','No longer in MDR stock')} · ${result.notInMdr.length}</summary>${irResultTable(result.notInMdr,'gone')}</details>
      <details class="inventory-result-group" ${result.ownerMismatch.length?'open':''}><summary>↔ ${irText('Besitzer abweichend','Owner differs')} · ${result.ownerMismatch.length}</summary>${irResultTable(result.ownerMismatch,'mismatch')}</details>
      <details class="inventory-result-group"><summary>✓ ${irText('Vorhanden','Present')} · ${result.present.length}</summary>${irResultTable(result.present,'present')}</details>
      <p class="tiny muted">${irText('Eindeutige Pferdenamen gelten als Treffer – auch wenn Spielwelt, Geschlecht oder andere Plausibilitätsdaten in der DB abweichen. Änderungen passieren nur über deine Auswahl und können über den vorhandenen Rückgängig-Punkt abgesichert werden.','A unique horse name counts as a match even when game world, sex, or other plausibility data differs in the database. Changes only happen through your selection and use the existing undo point.')}</p>`;
    irUpdateStockBulkBar();
  }

  async function irGetLocalHorseById(id) {
    let row=await localGet(LOCAL_STORES.horses,id).catch(()=>null);
    if (row) return row;
    const n=Number(id);
    if (Number.isFinite(n) && String(n)===String(id)) row=await localGet(LOCAL_STORES.horses,n).catch(()=>null);
    return row||null;
  }
  async function irRefreshStockAfterMutation(message='') {
    irHorses=await localGetAll(LOCAL_STORES.horses);
    if (typeof loadHorses==='function') {
      try { await loadHorses(); } catch (error) { console.warn('Datenbankliste konnte nach Bestandsaktion nicht neu geladen werden:',error); }
    }
    irStockSelectedIds.clear();
    await irRun({fromMutation:true});
    if (typeof renderUndoActionBar==='function') {
      try { await renderUndoActionBar(); } catch {}
    }
    if (message) {
      const status=document.getElementById('inventory-reconcile-status');
      if (status) status.textContent=`${status.textContent ? `${status.textContent} ` : ''}${message}`;
    }
  }
  async function irBulkDeleteSelected() {
    const ids=[...irStockSelectedIds];
    if (!ids.length) return;
    const rows=(await Promise.all(ids.map(irGetLocalHorseById))).filter(Boolean);
    if (!rows.length) return;
    const ok=window.confirm(irText(
      `${rows.length} ausgewählte${rows.length===1?'s':'e'} Pferd${rows.length===1?'':'e'} wirklich aus der Datenbank löschen? Die letzte Löschaktion kann rückgängig gemacht werden.`,
      `Really delete ${rows.length} selected horse${rows.length===1?'':'s'} from the database? The latest deletion can be undone.`
    ));
    if (!ok) return;
    if (rows.length>1 && typeof writeExternalBackupNow==='function') {
      try { await writeExternalBackupNow('vor Mehrfachlöschung im Bestandsabgleich'); } catch {}
    }
    if (typeof mdrStoreHorseUndoPoint==='function') await mdrStoreHorseUndoPoint({
      label:irText(`${rows.length} Pferd${rows.length===1?'':'e'} wiederherstellen`,`${rows.length} horse${rows.length===1?'':'s'} restore`),
      beforeRows:rows.map(r=>JSON.parse(JSON.stringify(r)))
    });
    for (const row of rows) await localDelete(LOCAL_STORES.horses,row.id);
    await irRefreshStockAfterMutation(irText(`${rows.length} Pferd${rows.length===1?'':'e'} gelöscht.`,`${rows.length} horse${rows.length===1?'':'s'} deleted.`));
  }
  async function irBulkMoveLearningSelected() {
    const ids=[...irStockSelectedIds];
    if (!ids.length) return;
    const before=[],updates=[];
    for (const id of ids) {
      const stored=await irGetLocalHorseById(id);
      if (!stored) continue;
      const updated={...stored};
      const tags=Array.isArray(stored.tags) ? stored.tags.map(t=>(t && typeof t==='object')?{...t}:t) : [];
      if (!tags.some(t=>irNorm(typeof t==='string'?t:t?.label)==='gbh')) tags.push({label:'GBH'});
      updated.tags=tags;
      updated.learning_file=true;
      if (typeof mdrLearningFileForSave==='function') mdrLearningFileForSave(updated,stored);
      updated.updated_at=new Date().toISOString();
      updated.last_change_source='Bestandsabgleich: GBH/Lerndatei';
      if (JSON.stringify(updated)===JSON.stringify(stored)) continue;
      before.push(JSON.parse(JSON.stringify(stored)));
      updates.push(updated);
    }
    if (!updates.length) return;
    if (typeof mdrStoreHorseUndoPoint==='function') await mdrStoreHorseUndoPoint({
      label:irText(`GBH/Lerndatei rückgängig (${updates.length} Pferde)`,`Undo GBH/learning file (${updates.length} horses)`),beforeRows:before
    });
    if (typeof localBulkPut==='function') await localBulkPut(LOCAL_STORES.horses,updates,100);
    else for (const row of updates) await localPut(LOCAL_STORES.horses,row);
    await irRefreshStockAfterMutation(irText(`${updates.length} Pferd${updates.length===1?'':'e'} auf GBH/Lerndatei gestellt.`,`${updates.length} horse${updates.length===1?'':'s'} moved to GBH/learning file.`));
  }
  async function irBulkUpdateOwnersSelected() {
    const targets=irStockOwnerUpdateTargets();
    if (!targets.length) return;
    const before=[],updates=[];
    for (const target of targets) {
      const stored=await irGetLocalHorseById(target.id);
      if (!stored) continue;
      const updated={...stored};
      if (irLearning(stored)) {
        updated.learning_original_owner=target.owner;
        updated.owner='Lerndatei';
      } else {
        updated.owner=target.owner;
      }
      updated.updated_at=new Date().toISOString();
      updated.last_change_source='Bestandsabgleich: Besitzer aktualisiert';
      if (JSON.stringify(updated)===JSON.stringify(stored)) continue;
      before.push(JSON.parse(JSON.stringify(stored)));
      updates.push(updated);
    }
    if (!updates.length) return;
    if (typeof mdrStoreHorseUndoPoint==='function') await mdrStoreHorseUndoPoint({
      label:irText(`Besitzeränderung rückgängig (${updates.length} Pferde)`,`Undo owner update (${updates.length} horses)`),beforeRows:before
    });
    if (typeof localBulkPut==='function') await localBulkPut(LOCAL_STORES.horses,updates,100);
    else for (const row of updates) await localPut(LOCAL_STORES.horses,row);
    await irRefreshStockAfterMutation(irText(`${updates.length} Besitzer aktualisiert.`,`${updates.length} owner value${updates.length===1?'':'s'} updated.`));
  }


  // ---------------------------------------------------------------------------
  // V54.0.88 – Zuchtgemeinschaft / Breeding Club
  // ---------------------------------------------------------------------------
  const IR_CLUB_SNAPSHOT_PREFIX='breeding_club_snapshot_v1:';
  const IR_STATION_SNAPSHOT_PREFIX='breeding_station_snapshot_v1:';

  function irClubNumber(value) {
    const raw=String(value ?? '').trim();
    if (!raw || raw==='–' || raw==='-') return null;
    const cleaned=raw.replace(/\u00a0/g,' ').replace(/[^\d,.\-]/g,'');
    if (!cleaned) return null;
    // MDR-Werte hier sind Ganzzahlen. Punkte/Kommas fungieren in DD/GP-Angaben
    // überwiegend als Tausendertrenner; für diese Felder reicht eine Ziffernlese.
    const digits=cleaned.replace(/[^\d\-]/g,'');
    if (!digits || digits==='-') return null;
    const n=Number(digits);
    return Number.isFinite(n) ? n : null;
  }

  function irClubCells(line) {
    const raw=String(line ?? '');
    let cells=null;
    if (raw.includes('\t')) cells=raw.split('\t').map(irStripMarkdown);
    else if (/^\s*\|/.test(raw) && raw.includes('|')) cells=raw.split('|').map(irStripMarkdown);
    if (!cells) return [];
    while (cells.length && !String(cells[0]||'').trim()) cells.shift();
    while (cells.length && !String(cells[cells.length-1]||'').trim()) cells.pop();
    return cells.map(c=>String(c||'').trim());
  }

  function irClubColumnKey(label) {
    const key=irNorm(label).replace(/[?:]/g,'').trim();
    const map={
      'pferd':'name','horse':'name',
      'rasse':'breed','breed':'breed',
      'begabung':'talent','talent':'talent',
      'alter':'age','age':'age',
      'gp':'gp','op':'gp',
      'fellfarbe':'color','farbe':'color','colour':'color','color':'color',
      'decktaxe':'stud_fee','stud fee':'stud_fee',
      'nk':'offspring_count','offspring':'offspring_count',
      'gs':'club_metric','cm':'club_metric',
      'besitzer':'owner','owner':'owner',
      'tragend':'in_foal','in foal':'in_foal'
    };
    return map[key] || '';
  }

  function irClubIsHeader(cells, kind) {
    if (!Array.isArray(cells) || cells.length<5) return false;
    const keys=cells.map(irClubColumnKey).filter(Boolean);
    if (!keys.includes('name') || !keys.includes('breed') || !keys.includes('owner') || !keys.includes('gp')) return false;
    if (kind==='stallions') return true;
    if (kind==='mares') return true;
    return false;
  }

  function irClubParseRow(cells, header, kind) {
    if (!cells.length || !header.length) return null;
    if (/^[-:]+$/.test(cells.join('').replace(/\s/g,''))) return null;
    const row={kind};
    for (let i=0;i<header.length;i++) {
      const field=irClubColumnKey(header[i]);
      if (!field) continue;
      const value=cells[i] ?? '';
      row[field]=value;
    }
    row.name=irHorseName(row.name);
    if (!row.name || /^(?:Pferd|Horse)$/i.test(row.name)) return null;
    row.owner=String(row.owner||'').trim();
    row.breed=String(row.breed||'').trim();
    row.talent=String(row.talent||'').trim();
    row.color=String(row.color||'').trim();
    row.gp=irClubNumber(row.gp);
    row.age=irClubNumber(row.age);
    row.offspring_count=irClubNumber(row.offspring_count);
    row.club_metric=irClubNumber(row.club_metric);
    // null = Spalte/Wert nicht vorhanden; 0 = ausdrücklich kostenlos.
    row.stud_fee=Object.prototype.hasOwnProperty.call(row,'stud_fee') ? irClubNumber(row.stud_fee) : null;
    row._nameKey=irNorm(row.name);
    row._ownerKey=irNorm(row.owner);
    return row;
  }

  function irClubExtractTable(lines, kind) {
    const headingRe=kind==='stallions'
      ? /^(?:Die\s+Zuchthengste|The\s+Stallions)$/i
      : /^(?:Die\s+Zuchtstuten|The\s+Broodmares)$/i;
    const stopRe=kind==='stallions'
      ? /^(?:Die\s+Zuchtstuten|The\s+Broodmares|Modbox)$/i
      : /^(?:Modbox|Das\s+Team|The\s+Team)$/i;

    let heading=-1, headerIndex=-1, end=lines.length, hasEnd=false;
    for (let i=0;i<lines.length;i++) {
      const plain=irStripMarkdown(lines[i]).trim();
      if (heading<0 && headingRe.test(plain)) { heading=i; continue; }
      if (heading>=0 && headerIndex<0) {
        const cells=irClubCells(lines[i]);
        if (irClubIsHeader(cells,kind)) { headerIndex=i; continue; }
      }
      if (headerIndex>=0 && stopRe.test(plain)) { end=i; hasEnd=true; break; }
    }
    if (heading<0 || headerIndex<0) return {rows:[],found:false,complete:false,heading,headerIndex,end};
    const header=irClubCells(lines[headerIndex]);
    const rows=[];
    for (let i=headerIndex+1;i<end;i++) {
      const plain=irStripMarkdown(lines[i]).trim();
      if (!plain) continue;
      if (stopRe.test(plain)) { hasEnd=true; break; }
      const cells=irClubCells(lines[i]);
      if (!cells.length) continue;
      // Tabellenkopien können vorne eine leere Bildspalte enthalten. Wenn die
      // Zeile eine Zelle mehr als der Header hat, die führende Leerspalte ist
      // durch irClubCells bereits entfernt; weitere Überhänge ignorieren wir.
      const row=irClubParseRow(cells,header,kind);
      if (row) rows.push(row);
    }
    return {rows,found:true,complete:hasEnd && rows.length>=0,heading,headerIndex,end};
  }

  function irClubName(lines) {
    for (let i=0;i<lines.length;i++) {
      const plain=irStripMarkdown(lines[i]).trim();
      if (!/^(?:Gründer|Founder)\s*:/i.test(plain)) continue;
      for (let j=i-1;j>=Math.max(0,i-12);j--) {
        const candidate=irStripMarkdown(lines[j]).trim();
        if (!candidate) continue;
        if (/^(?:Zucht|Breeding|Über uns|About Us|Maximal \d+ Zeichen|Maximum \d+ characters)$/i.test(candidate)) continue;
        if (/^(?:Gründer|Founder|Gründungsdatum|Date of foundation|Spezialisierung|Specialisation)\s*:/i.test(candidate)) continue;
        return candidate;
      }
    }
    return '';
  }

  function irClubParsePage(raw) {
    const text=String(raw||'').replace(/\r\n?/g,'\n');
    const lines=text.split('\n');
    const plain=irPlain(text);
    const server=/\bGründer\s*:|\bZuchthengste\b|\bZuchtstuten\b/i.test(plain)
      ? 'DE'
      : (/\bFounder\s*:|\bThe Stallions\b|\bThe Broodmares\b/i.test(plain) ? 'EN' : irDetectServer(text));
    const stallionTable=irClubExtractTable(lines,'stallions');
    const mareTable=irClubExtractTable(lines,'mares');
    const name=irClubName(lines);
    const founderMatch=plain.match(/^(?:Gründer|Founder)\s*:\s*(.+)$/im);
    const spec1=plain.match(/^(?:Spezialisierung 1|Specialisation 1)\s*:\s*(.+)$/im);
    const spec2=plain.match(/^(?:Spezialisierung 2|Specialisation 2)\s*:\s*(.+)$/im);
    const result={
      sourceType:'club',
      name,
      server,
      founder:founderMatch?.[1]?.trim() || '',
      specialisation1:spec1?.[1]?.trim() || '',
      specialisation2:spec2?.[1]?.trim() || '',
      stallions:stallionTable.rows,
      mares:mareTable.rows,
      stallionsComplete:stallionTable.complete,
      maresComplete:mareTable.complete,
      valid:!!name && stallionTable.found,
    };
    result.stallions.forEach(row=>{row._sourceType='club';});
    result.mares.forEach(row=>{row._sourceType='club';});
    return result;
  }

  function irStationAvailability(note) {
    const n=irNorm(note);
    if (/deckt\s+nicht\s+extern|not\s+available\s+externally|does\s+not\s+cover\s+externally/.test(n)) return 'not_external';
    if (/nur\s+zur\s+übersicht|zur\s+übersicht|overview\s+only|for\s+overview/.test(n)) return 'overview';
    return 'external';
  }

  function irStationParsePage(raw) {
    const text=String(raw||'').replace(/\r\n?/g,'\n');
    const rawLines=text.split('\n');
    let headingIndex=-1, stationBreed='', server='UNKNOWN';
    for (let i=0;i<rawLines.length;i++) {
      const plain=irStripMarkdown(rawLines[i]).trim();
      let m=plain.match(/^Deckstation\s*:\s*(.+)$/i);
      if (m) { headingIndex=i; stationBreed=m[1].trim(); server='DE'; break; }
      m=plain.match(/^(?:Stud\s+Station|Breeding\s+Station)\s*:\s*(.+)$/i);
      if (m) { headingIndex=i; stationBreed=m[1].trim(); server='EN'; break; }
    }
    if (headingIndex<0) return {sourceType:'station',name:'',server:irDetectServer(text),stationBreed:'',stallions:[],mares:[],stallionsComplete:false,maresComplete:false,valid:false};
    if (server==='UNKNOWN') server=irDetectServer(text);

    let endIndex=rawLines.length, hasEnd=false;
    for (let i=headingIndex+1;i<rawLines.length;i++) {
      const plain=irStripMarkdown(rawLines[i]).trim();
      if (/^(?:Zurück|Back|Modbox)(?:\s|$)/i.test(plain)) { endIndex=i; hasEnd=true; break; }
    }

    // Tabellenkopien aus MDR können Zellen sowohl per Tab als auch per Zeilenumbruch
    // liefern. Wir flachen beides in Tokens ab und orientieren uns am stabilen
    // Titelmarker „Prämienhengst … Punkte“ / „Premium stallion … points“.
    const tokens=[];
    for (const line of rawLines.slice(headingIndex+1,endIndex)) {
      const parts=String(line).includes('\t') ? String(line).split('\t') : [line];
      for (const part of parts) {
        const clean=irStripMarkdown(part).trim();
        if (clean) tokens.push(clean);
      }
    }
    const titleRe=/(?:Prämienhengst|Premium\s+stallion)/i;
    const rows=[];
    for (let i=0;i<tokens.length;i++) {
      if (!titleRe.test(tokens[i])) continue;
      let title=tokens[i];
      let name='';
      const embedded=tokens[i].match(/^(.*?)\s*((?:Prämienhengst|Premium\s+stallion).*)$/i);
      if (embedded && embedded[1].trim()) {
        name=embedded[1].trim();
        title=embedded[2].trim();
      } else {
        name=tokens[i-1] || '';
      }
      name=irHorseName(name);
      if (!name || /^(?:Pferd|Horse|Titel|Title|Decken|Cover)$/i.test(name)) continue;

      let pointText=title;
      if (i+1<tokens.length && /^(?:mit|with)\s+\d+\s*(?:Punkten|points?)/i.test(tokens[i+1])) pointText+=` ${tokens[i+1]}`;
      const pointsMatch=pointText.match(/(?:mit|with)\s+(\d+)\s*(?:Punkten|points?)/i);
      const performancePoints=pointsMatch ? Number(pointsMatch[1]) : null;

      let gpIndex=-1;
      for (let j=i+1;j<Math.min(tokens.length,i+10);j++) {
        if (/^\d{2,4}$/.test(tokens[j])) { gpIndex=j; break; }
        if (j>i+1 && titleRe.test(tokens[j])) break;
      }
      if (gpIndex<0) continue;
      let talent=tokens[gpIndex-1] || '';
      if (/^(?:mit|with)\s+\d+\s*(?:Punkten|points?)/i.test(talent)) talent='';
      const color=tokens[gpIndex+1] || '';
      let feeIndex=-1;
      for (let j=gpIndex+2;j<Math.min(tokens.length,gpIndex+7);j++) {
        if (/\bDD\b/i.test(tokens[j]) && /\d/.test(tokens[j])) { feeIndex=j; break; }
      }
      if (feeIndex<0) continue;
      const ownerIndex=feeIndex+1;
      const owner=(tokens[ownerIndex] && !/^(?:Decken|Cover)$/i.test(tokens[ownerIndex])) ? tokens[ownerIndex].trim() : '';
      if (!owner) continue;

      let noteEnd=tokens.length;
      for (let j=ownerIndex+1;j<tokens.length;j++) {
        if (/^(?:Decken|Cover)$/i.test(tokens[j])) { noteEnd=j; break; }
        if (titleRe.test(tokens[j])) { noteEnd=Math.max(ownerIndex+1,j-1); break; }
      }
      const noteRaw=tokens.slice(ownerIndex+1,noteEnd).join(' ').trim();
      const availability=irStationAvailability(noteRaw);
      const note=/deckt\s+nicht\s+extern|zur\s+übersicht|not\s+available\s+externally|overview\s+only|for\s+overview/i.test(noteRaw) ? noteRaw : '';
      const row={
        kind:'stallions',_sourceType:'station',name,breed:stationBreed,talent,
        gp:irClubNumber(tokens[gpIndex]),color:String(color||'').trim(),
        stud_fee:irClubNumber(tokens[feeIndex]),owner:String(owner||'').trim(),
        title:pointText,performance_test_points:performancePoints,
        station_availability:availability,station_note:note
      };
      row._nameKey=irNorm(row.name);
      row._ownerKey=irNorm(row.owner);
      rows.push(row);
    }

    // Doppelte Titel-/Copy-Artefakte nicht doppelt anzeigen. Besitzer wird in den
    // Schlüssel aufgenommen, weil identische Pferdenamen spielweit vorkommen können.
    const unique=[];
    const seen=new Set();
    for (const row of rows) {
      const key=`${row._nameKey}|${row._ownerKey}`;
      if (!row._nameKey || seen.has(key)) continue;
      seen.add(key); unique.push(row);
    }
    return {
      sourceType:'station',
      name:server==='EN' ? `Stud Station: ${stationBreed}` : `Deckstation: ${stationBreed}`,
      server,stationBreed,founder:'',specialisation1:stationBreed,specialisation2:'',
      stallions:unique,mares:[],stallionsComplete:hasEnd && unique.length>0,maresComplete:true,
      valid:unique.length>0
    };
  }

  function irParseBreedingSource(raw) {
    const station=irStationParsePage(raw);
    if (station.valid) return station;
    return irClubParsePage(raw);
  }

  function irClubGender(horse) {
    const raw=irNorm(horse?.gender || horse?.sex || horse?.geschlecht || '');
    if (/hengst|stallion|male|colt/.test(raw)) return 'stallion';
    if (/stute|mare|female|filly/.test(raw)) return 'mare';
    if (/wallach|gelding/.test(raw)) return 'gelding';
    return '';
  }

  function irClubBreed(value) {
    try { return typeof normalizeBreed==='function' ? normalizeBreed(value) : String(value||'').trim(); }
    catch { return String(value||'').trim(); }
  }

  function irClubLocalGp(horse) {
    try {
      if (typeof computeDerived==='function') {
        const gp=Number(computeDerived(horse)?.gp);
        if (Number.isFinite(gp)) return gp;
      }
    } catch {}
    const candidates=[horse?.gp,horse?.overall_potential,horse?.gesamtpotential];
    for (const value of candidates) {
      const n=Number(value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  function irClubLocalTalent(horse) {
    try {
      if (typeof plannerHorseTalent==='function') return String(plannerHorseTalent(horse)||'').trim();
    } catch {}
    return String(horse?.talent || horse?.Begabung || '').trim();
  }

  function irClubLocalFee(horse) {
    const raw=horse?.stud_fee;
    if (raw==null || raw==='') return 0;
    const n=Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  function irClubMatchRemote(remote, localHorses, server, kind) {
    const nameKey=remote?._nameKey || irNorm(remote?.name);
    const all=(localHorses||[]).filter(h=>irNorm(h.name)===nameKey);
    // V54.0.92: Ein eindeutiger Name ist auch im ZG-/Deckstationsabgleich der
    // primäre Beweis. Falsche/veraltete Spielwelt-, Geschlechts- oder
    // Lerndatei-Metadaten dürfen einen real vorhandenen Hengst nicht zu
    // „Fehlt in DB“ machen. Zusatzdaten lösen nur echte Namens-Dubletten auf.
    if (!all.length) return {state:'missing',local:null,candidates:0};
    if (all.length===1) return {state:'matched',local:all[0],candidates:1};

    let candidates=all.slice();
    const ps=String(server||'').toUpperCase();
    if (ps==='DE' || ps==='EN') {
      const exact=candidates.filter(h=>irHorseServer(h)===ps);
      if (exact.length) candidates=exact;
    }
    if (kind==='stallions') candidates=irNarrowCandidates(candidates,h=>irClubGender(h)==='stallion');
    if (kind==='mares') candidates=irNarrowCandidates(candidates,h=>irClubGender(h)==='mare');
    if (remote?.breed) candidates=irNarrowCandidates(candidates,h=>irNorm(irClubBreed(h?.breed))===irNorm(irClubBreed(remote.breed)));
    if (Number.isFinite(Number(remote?.gp))) candidates=irNarrowCandidates(candidates,h=>Number(irClubLocalGp(h))===Number(remote.gp));
    if (remote?._ownerKey) candidates=irNarrowCandidates(candidates,h=>irNorm(irComparableOwner(h))===remote._ownerKey);

    if (candidates.length===1) return {state:'matched',local:candidates[0],candidates:all.length};
    return {state:'ambiguous',local:null,candidates:all.length};
  }

  function irClubRefreshItem(item) {
    const remote=item?.remote, local=item?.local;
    item.ownerDiff=!!(remote && local && remote.owner && irNorm(remote.owner)!==irNorm(irComparableOwner(local)));
    item.learningStatus=!!(local && irLearning(local));
    item.breedDiff=!!(remote && local && remote.breed && irClubBreed(remote.breed) && irNorm(irClubBreed(remote.breed))!==irNorm(irClubBreed(local.breed)));
    const rgp=Number(remote?.gp), lgp=Number(irClubLocalGp(local));
    item.localGp=Number.isFinite(lgp) ? lgp : null;
    item.gpDiff=!!(local && Number.isFinite(rgp) && Number.isFinite(lgp) && Math.abs(rgp-lgp)>=1);
    item.feeComparable=!!(local && remote?.stud_fee!=null && Number.isFinite(Number(remote.stud_fee)));
    item.localFee=local ? irClubLocalFee(local) : null;
    item.feeDiff=!!(item.feeComparable && Number(remote.stud_fee)!==Number(item.localFee));
    item.talentDiff=!!(remote && local && remote.talent && irClubLocalTalent(local) && irNorm(remote.talent)!==irNorm(irClubLocalTalent(local)));
    return item;
  }

  function irClubCompareRows(rows, localHorses, server, kind, sourceType='club') {
    return (rows||[]).map(remote=>{
      const match=irClubMatchRemote(remote,localHorses,server,kind);
      return irClubRefreshItem({remote,local:match.local,matchState:match.state,candidates:match.candidates,kind,isRemoved:false,sourceType:remote?._sourceType||sourceType});
    });
  }

  function irClubSnapshotKey(club) {
    const safe=irNorm(club?.name).replace(/[^a-z0-9äöüß._-]+/gi,'-').slice(0,90) || 'unknown';
    const prefix=club?.sourceType==='station' ? IR_STATION_SNAPSHOT_PREFIX : IR_CLUB_SNAPSHOT_PREFIX;
    return `${prefix}${String(club?.server||'UNKNOWN').toUpperCase()}:${safe}`;
  }

  function irClubSnapshotRow(remote, item, old, now) {
    return {
      name:remote.name,
      name_key:remote._nameKey || irNorm(remote.name),
      owner:remote.owner || '',
      breed:remote.breed || '',
      talent:remote.talent || '',
      gp:remote.gp,
      color:remote.color || '',
      stud_fee:remote.stud_fee,
      offspring_count:remote.offspring_count,
      club_metric:remote.club_metric,
      title:remote.title || '',
      performance_test_points:remote.performance_test_points ?? null,
      station_availability:remote.station_availability || '',
      station_note:remote.station_note || '',
      local_id:item?.local?.id ?? old?.local_id ?? null,
      first_seen:old?.first_seen || now,
      last_seen:now,
      active:true,
      removed_at:null
    };
  }

  function irClubMergeSnapshot(club, previous, comparedStallions) {
    const now=new Date().toISOString();
    const oldRows=Array.isArray(previous?.known_stallions) ? previous.known_stallions : [];
    const map=new Map(oldRows.map(r=>[String(r.name_key||irNorm(r.name)),{...r}]));
    const currentKeys=new Set();

    for (const item of comparedStallions) {
      const remote=item.remote;
      const key=remote._nameKey || irNorm(remote.name);
      currentKeys.add(key);
      const old=map.get(key);
      map.set(key,irClubSnapshotRow(remote,item,old,now));
    }

    if (club.stallionsComplete) {
      for (const [key,row] of map) {
        if (currentKeys.has(key)) continue;
        if (row.active!==false) {
          row.active=false;
          row.removed_at=row.removed_at || now;
        }
      }
    }

    return {
      key:irClubSnapshotKey(club),
      type:club?.sourceType==='station' ? 'breeding_station_snapshot_v1' : 'breeding_club_snapshot_v1',
      source_type:club?.sourceType || 'club',
      club_name:club.name,
      station_breed:club?.stationBreed || '',
      server:club.server,
      founder:club.founder || '',
      specialisation1:club.specialisation1 || '',
      specialisation2:club.specialisation2 || '',
      known_stallions:[...map.values()],
      last_complete_stallion_import:club.stallionsComplete ? now : (previous?.last_complete_stallion_import || null),
      updated_at:now
    };
  }

  function irClubRemovedItems(snapshot, localHorses, server) {
    const out=[];
    for (const row of snapshot?.known_stallions || []) {
      if (row.active!==false) continue;
      let local=null;
      if (row.local_id!=null) local=(localHorses||[]).find(h=>String(h.id)===String(row.local_id)) || null;
      const remote={
        name:row.name,owner:row.owner,breed:row.breed,talent:row.talent,gp:row.gp,
        color:row.color,stud_fee:row.stud_fee,offspring_count:row.offspring_count,club_metric:row.club_metric,
        title:row.title||'',performance_test_points:row.performance_test_points??null,station_availability:row.station_availability||'',station_note:row.station_note||'',
        _nameKey:row.name_key || irNorm(row.name),_ownerKey:irNorm(row.owner),_sourceType:snapshot?.source_type || 'club'
      };
      if (!local) local=irClubMatchRemote(remote,localHorses,server,'stallions').local;
      // Gewünscht ist explizit "in der Datenbank, aber nicht mehr in der ZG".
      if (!local) continue;
      out.push(irClubRefreshItem({
        remote,local,matchState:'matched',candidates:1,kind:'stallions',isRemoved:true,sourceType:snapshot?.source_type || 'club',
        removedAt:row.removed_at || null,lastSeen:row.last_seen || null
      }));
    }
    return out;
  }

  function irClubCurrentDbOnlyItems(club, localHorses, currentStallions, snapshot=null) {
    if (club?.sourceType==='station' || !club?.stallionsComplete) return [];

    // V54.0.92: Der aktuelle ZG-Abgleich ist absichtlich direkt. Für dieselbe
    // Spielwelt und die in der aktuellen Hengstliste vertretenen Rassen gilt:
    // Steht ein DB-Hengst nicht in der eingelesenen Liste, wird er als
    // „nicht in aktueller ZG-Liste“ gezeigt. Zuchtzulassung und Besitzerstatus
    // sind keine Filterkriterien – dadurch bleiben Rentner und verkaufte Hengste
    // im Vergleich sichtbar.
    const breeds=new Set((club?.stallions||[]).map(r=>irNorm(irClubBreed(r.breed))).filter(Boolean));
    if (!breeds.size) return [];

    const currentNames=new Set((club?.stallions||[]).map(r=>r._nameKey||irNorm(r.name)).filter(Boolean));
    const currentLocalIds=new Set((currentStallions||[]).map(x=>String(x.local?.id??'')).filter(Boolean));
    const snapshotRows=Array.isArray(snapshot?.known_stallions) ? snapshot.known_stallions : [];
    const result=[];

    for (const h of (localHorses||[])) {
      if (irClubGender(h)!=='stallion') continue;
      if (!irServerCompatible(h,{server:club.server})) continue;
      if (!breeds.has(irNorm(irClubBreed(h.breed)))) continue;

      const nameKey=irNorm(h.name);
      const localId=String(h.id??'');
      if (!nameKey || currentNames.has(nameKey) || (localId && currentLocalIds.has(localId))) continue;

      const historical=snapshotRows.find(row=>
        (row.local_id!=null && localId && String(row.local_id)===localId) ||
        String(row.name_key||irNorm(row.name))===nameKey
      ) || null;

      const remote={
        name:String(h.name||'').trim(), owner:String(irComparableOwner(h)||'').trim(),
        breed:String(h.breed||'').trim(), talent:'', gp:null, color:'',
        stud_fee:null, offspring_count:null, club_metric:null,
        _nameKey:nameKey, _ownerKey:irNorm(irComparableOwner(h)), _sourceType:'club'
      };
      result.push(irClubRefreshItem({
        remote, local:h, matchState:'matched', candidates:1, kind:'stallions',
        isRemoved:false, isCurrentUnlisted:true,
        wasPreviouslyListed:!!historical,
        removedAt:historical?.active===false ? (historical.removed_at||null) : null,
        sourceType:'club'
      }));
    }
    return result;
  }

  function irClubFeeLabel(value, known=true) {
    if (!known || value==null || !Number.isFinite(Number(value))) return '–';
    const n=Number(value);
    return n===0 ? irText('kostenlos','free') : `${n.toLocaleString(irLang()==='en'?'en-US':'de-DE')} DD`;
  }

  function irClubStatus(item) {
    if (item.isCurrentUnlisted) return {key:'not_listed',label:irText('○ Nicht in aktueller ZG-Liste','○ Not in current club list'),cls:'neutral'};
    if (item.isRemoved) return item?.sourceType==='station'
      ? {key:'removed',label:irText('⚠ Nicht mehr in Deckstation','⚠ No longer in stud station'),cls:'warn'}
      : {key:'removed',label:irText('⚠ Nicht mehr in Zuchtgemeinschaft','⚠ No longer in breeding club'),cls:'warn'};
    if (item.matchState==='missing') return {key:'missing',label:irText('＋ Fehlt in DB','＋ Missing from DB'),cls:'bad'};
    if (item.matchState==='ambiguous') return {key:'ambiguous',label:irText('⚠ Nicht eindeutig','⚠ Ambiguous'),cls:'warn'};
    const diffs=[];
    if (item.feeDiff) diffs.push(irText('Decktaxe','Stud fee'));
    if (item.ownerDiff) diffs.push(irText('Besitzer','Owner'));
    if (item.gpDiff) diffs.push('GP');
    if (item.breedDiff) diffs.push(irText('Rasse','Breed'));
    if (item.talentDiff) diffs.push(irText('Begabung','Talent'));
    if (diffs.length) return {key:item.feeDiff?'fee':'diff',label:`△ ${diffs.join(', ')}`,cls:'warn'};
    return {key:'ok',label:irText('✓ stimmt','✓ matches'),cls:'ok'};
  }

  function irClubDataQuality(item) {
    if (!item?.local) return {level:'none',label:'',icon:'',rank:3};
    try {
      if (typeof analyzeHorseDataQuality==='function') {
        const q=analyzeHorseDataQuality(item.local) || {};
        if (q.level==='green') return {level:'green',label:irText('vollständig','complete'),icon:'🟢',rank:0};
        if (q.level==='yellow') return {level:'yellow',label:irText('teilweise vollständig','partly complete'),icon:'🟡',rank:1};
        if (q.level==='red') return {level:'red',label:irText('unvollständig','incomplete'),icon:'🔴',rank:2};
      }
    } catch {}
    return {level:'unknown',label:irText('Datenqualität unbekannt','data quality unknown'),icon:'○',rank:2};
  }

  function irClubSortRank(item) {
    const status=irClubStatus(item);
    // Fehlende Pferde bewusst ganz ans Ende. Davor kommen historische/unklare
    // Fälle; vorhandene DB-Pferde werden zuerst nach Datenqualität sortiert.
    if (status.key==='missing') return 900;
    if (status.key==='ambiguous') return 800;
    if (status.key==='removed') return 700;
    if (status.key==='not_listed') return 650;
    const quality=irClubDataQuality(item);
    const diffPenalty=status.key==='ok' ? 0 : 20;
    return quality.rank*100 + diffPenalty;
  }

  function irClubSortStallions(items) {
    return [...(items||[])].sort((a,b)=>{
      const rank=irClubSortRank(a)-irClubSortRank(b);
      if (rank) return rank;
      const owner=String(a.remote?.owner||irComparableOwner(a.local)||'').localeCompare(String(b.remote?.owner||irComparableOwner(b.local)||''),irLang()==='en'?'en':'de',{sensitivity:'base'});
      if (owner) return owner;
      return String(a.remote?.name||a.local?.name||'').localeCompare(String(b.remote?.name||b.local?.name||''),irLang()==='en'?'en':'de',{sensitivity:'base'});
    });
  }

  function irClubCopyNameHtml(name) {
    const safe=String(name||'–');
    return `<div class="inventory-club-name-wrap"><span class="inventory-copyable-name">${irEsc(safe)}</span>${safe!=='–'?`<button type="button" class="inventory-copy-name" data-club-copy-name="${irEsc(safe)}" title="${irText('Namen kopieren','Copy name')}" aria-label="${irText('Namen kopieren','Copy name')}">⧉</button>`:''}</div>`;
  }

  function irClubQualityHtml(item) {
    const q=irClubDataQuality(item);
    if (!item?.local || q.level==='none') return '';
    return `<span class="inventory-club-quality ${irEsc(q.level)}">${q.icon} ${irEsc(q.label)}</span>`;
  }

  function irStationAvailabilityLabel(remote) {
    const key=remote?.station_availability || 'external';
    if (key==='not_external') return {key,label:irText('Nicht extern','Not external'),cls:'warn'};
    if (key==='overview') return {key,label:irText('Nur Übersicht','Overview only'),cls:'neutral'};
    return {key:'external',label:irText('Extern verfügbar','Externally available'),cls:'ok'};
  }

  function irClubRowHtml(item) {
    const remote=item.remote || {};
    const local=item.local || null;
    const status=irClubStatus(item);
    const station=item?.sourceType==='station' || irClubLast?.club?.sourceType==='station';
    const rgp=Number.isFinite(Number(remote.gp)) ? Number(remote.gp) : null;
    const lgp=item.localGp;
    const remoteFee=item.isCurrentUnlisted
      ? '<span class="muted">–</span>'
      : (item.isRemoved
        ? `<span class="muted">–</span><br><span class="tiny muted">${irText('zuletzt','last')}: ${irEsc(irClubFeeLabel(remote.stud_fee,remote.stud_fee!=null))}</span>`
        : irEsc(irClubFeeLabel(remote.stud_fee,remote.stud_fee!=null)));
    const localFee=local ? irEsc(irClubFeeLabel(irClubLocalFee(local),true)) : '–';
    const actionBits=[];
    if (local?.id!=null) actionBits.push(`<a class="btn secondary small" href="${mdrRoute('view',{id:local.id})}">${irText('Öffnen','Open')}</a>`);
    if (!item.isRemoved && !item.isCurrentUnlisted && item.feeDiff && local?.id!=null && remote.stud_fee!=null) {
      actionBits.push(`<button type="button" class="small" data-club-fee-apply="${irEsc(local.id)}">${irText('Decktaxe übernehmen','Apply stud fee')}</button>`);
    }
    const removedHint=item.isCurrentUnlisted && item.wasPreviouslyListed
      ? `<br><span class="tiny muted">${item.removedAt ? `${irText('seit','since')} ${irEsc(new Date(item.removedAt).toLocaleDateString(irLang()==='en'?'en-GB':'de-DE'))} · ` : ''}${irText('zuvor gelistet','previously listed')}</span>`
      : (item.isRemoved && item.removedAt
        ? `<br><span class="tiny muted">${irText('seit','since')} ${irEsc(new Date(item.removedAt).toLocaleDateString(irLang()==='en'?'en-GB':'de-DE'))}</span>`
        : '');
    const availability=irStationAvailabilityLabel(remote);
    const availabilityCell=station
      ? `<td class="inventory-club-availability"><span class="inventory-availability ${availability.cls}">${irEsc(availability.label)}</span>${remote.station_note?`<br><span class="tiny muted">${irEsc(remote.station_note)}</span>`:''}${Number.isFinite(Number(remote.performance_test_points))?`<br><span class="tiny muted">HLP/SLP: ${Number(remote.performance_test_points)}</span>`:''}</td>`
      : '';
    return `<tr data-club-status="${irEsc(status.key)}" data-club-owner="${irEsc(remote.owner||irComparableOwner(local)||'')}" data-club-breed="${irEsc(remote.breed||local?.breed||'')}" data-club-availability="${irEsc(remote.station_availability||'')}">
      <td class="inventory-club-name-cell">${irClubCopyNameHtml(remote.name||local?.name||'–')}</td>
      <td>${irEsc(remote.owner||'–')}${item.ownerDiff && local ? `<br><span class="tiny muted">DB: ${irEsc(irComparableOwner(local)||'–')}</span>`:''}</td>
      <td>${irEsc(remote.breed||'–')}</td>
      <td class="inventory-club-number">${rgp??'–'}${local ? `<br><span class="tiny ${item.gpDiff?'inventory-diff':''}">DB: ${lgp??'–'}</span>`:''}</td>
      <td class="inventory-club-fee">${remoteFee}</td>
      <td class="inventory-club-fee ${item.feeDiff?'inventory-diff':''}">${localFee}</td>
      ${availabilityCell}
      <td class="inventory-club-status-cell"><span class="inventory-status ${status.cls}">${irEsc(status.label)}</span>${irClubQualityHtml(item)}${removedHint}</td>
      <td><div class="inventory-club-actions">${actionBits.join(' ') || '–'}</div></td>
    </tr>`;
  }

  function irClubMareTable(items) {
    if (!items.length) return `<p class="small muted">${irText('Keine Zuchtstuten erkannt.','No broodmares detected.')}</p>`;
    return `<div class="table-wrap"><table class="detail-table inventory-result-table inventory-club-mare-table">
      <thead><tr><th>${irText('Pferd','Horse')}</th><th>${irText('Besitzer','Owner')}</th><th>${irText('Rasse','Breed')}</th><th>GP</th><th>${irText('Status','Status')}</th><th>${irText('Aktion','Action')}</th></tr></thead>
      <tbody>${items.map(item=>{
        const status=irClubStatus(item);
        const rgp=Number.isFinite(Number(item.remote?.gp)) ? Number(item.remote.gp) : null;
        const action=item.local?.id!=null ? `<a class="btn secondary small" href="${mdrRoute('view',{id:item.local.id})}">${irText('Öffnen','Open')}</a>`:'–';
        return `<tr><td class="inventory-club-name-cell">${irClubCopyNameHtml(item.remote?.name||'–')}</td><td>${irEsc(item.remote?.owner||'–')}</td><td>${irEsc(item.remote?.breed||'–')}</td><td>${rgp??'–'}${item.local?`<br><span class="tiny ${item.gpDiff?'inventory-diff':''}">DB: ${item.localGp??'–'}</span>`:''}</td><td class="inventory-club-status-cell"><span class="inventory-status ${status.cls}">${irEsc(status.label)}</span>${irClubQualityHtml(item)}</td><td>${action}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  let irClubLast=null;

  function irClubFilteredStallions() {
    if (!irClubLast) return [];
    const search=irNorm(document.getElementById('club-filter-search')?.value || '');
    const owner=irNorm(document.getElementById('club-filter-owner')?.value || '');
    const breed=irNorm(document.getElementById('club-filter-breed')?.value || '');
    const status=document.getElementById('club-filter-status')?.value || 'all';
    const availability=document.getElementById('club-filter-availability')?.value || 'all';
    const filtered=irClubLast.stallionItems.filter(item=>{
      const st=irClubStatus(item).key;
      const quality=irClubDataQuality(item);
      const remoteAvailability=item.remote?.station_availability || 'external';
      if (search && !irNorm(`${item.remote?.name||''} ${item.remote?.owner||''} ${item.remote?.breed||''}`).includes(search)) return false;
      if (owner && irNorm(item.remote?.owner||irComparableOwner(item.local)||'')!==owner) return false;
      if (breed && irNorm(item.remote?.breed||item.local?.breed||'')!==breed) return false;
      if (availability!=='all' && remoteAvailability!==availability) return false;
      if (status==='fee' && !item.feeDiff) return false;
      if (status==='complete' && (!item.local || quality.level!=='green')) return false;
      if (status==='incomplete' && (!item.local || quality.level==='green')) return false;
      if (status==='missing' && st!=='missing') return false;
      if (status==='removed' && st!=='removed') return false;
      if (status==='not_listed' && st!=='not_listed') return false;
      if (status==='diff' && !['fee','diff'].includes(st)) return false;
      return true;
    });
    return irClubSortStallions(filtered);
  }

  function irClubRenderStallionBody() {
    const body=document.getElementById('club-stallion-body');
    const count=document.getElementById('club-filter-count');
    if (!body || !irClubLast) return;
    const rows=irClubFilteredStallions();
    const cols=irClubLast?.club?.sourceType==='station' ? 9 : 8;
    body.innerHTML=rows.length ? rows.map(irClubRowHtml).join('') : `<tr><td colspan="${cols}" class="muted">${irText('Keine Treffer für diese Filter.','No matches for these filters.')}</td></tr>`;
    if (count) count.textContent=irText(`${rows.length} Hengste angezeigt`,`${rows.length} stallions shown`);
  }

  function irClubOptionHtml(values) {
    return values.map(v=>`<option value="${irEsc(v)}">${irEsc(v)}</option>`).join('');
  }

  function irRenderClubResults(state) {
    irClubLast=state;
    const root=document.getElementById('club-results');
    if (!root) return;
    const {club,currentStallions,removedStallions,currentDbOnly=[],mares,hadPrevious}=state;
    const isStation=club?.sourceType==='station';
    const stallionItems=[...currentStallions,...(isStation?removedStallions:currentDbOnly)];
    state.stallionItems=stallionItems;
    stallionItems.forEach(irClubRefreshItem);
    mares.forEach(irClubRefreshItem);

    const matched=currentStallions.filter(x=>x.matchState==='matched').length;
    const missing=currentStallions.filter(x=>x.matchState==='missing').length;
    const ambiguous=currentStallions.filter(x=>x.matchState==='ambiguous').length;
    const feeDiff=currentStallions.filter(x=>x.feeDiff).length;
    const owners=[...new Set(stallionItems.map(x=>x.remote?.owner||irComparableOwner(x.local)||'').filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de'));
    const breeds=[...new Set(stallionItems.map(x=>x.remote?.breed||x.local?.breed||'').filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de'));

    const snapshotNotice=!hadPrevious
      ? `<div class="notice small">${isStation
          ? irText('Erster Abgleich für diese Deckstation: Der erkannte Hengstbestand wird als Ausgangsstand gespeichert. Ab dem nächsten vollständigen Import können zuvor gelistete, jetzt fehlende Hengste erkannt werden.','First comparison for this stud station: the detected stallion list is stored as the baseline. From the next complete import onward, stallions that were previously listed but are now missing can be detected.')
          : irText('Der ZG-Status wird direkt aus der aktuell eingelesenen Hengstliste bestimmt. Der erste vollständige Import wird zusätzlich als Verlauf gespeichert, damit spätere Abgänge mit „zuvor gelistet“ ergänzt werden können.','Club membership is determined directly from the currently pasted stallion list. The first complete import is also stored as history so later removals can be annotated as “previously listed”.')}</div>`
      : '';
    const incompleteNotice=!club.stallionsComplete
      ? `<div class="notice notice-warning small">${isStation
          ? irText('Die Deckstationsliste wurde nicht als vollständig erkannt. Der aktuelle Stand wird verglichen, aber es werden keine Hengste als „nicht mehr in der Deckstation“ markiert.','The stud-station list was not detected as complete. Current rows are compared, but no stallions are marked as “no longer in the stud station”.')
          : irText('Die Hengsttabelle wurde nicht vollständig erkannt. Die gelesenen Zeilen werden abgeglichen, aber DB-Hengste werden vorsichtshalber nicht als „nicht in aktueller ZG-Liste“ markiert.','The stallion table was not parsed completely. Parsed rows are compared, but DB stallions are not marked as “not in current club list” to avoid false positives.')}</div>`
      : '';

    const remoteFeeLabel=isStation ? irText('Decktaxe Station','Station stud fee') : irText('Decktaxe ZG','Club stud fee');
    const removedLabel=isStation ? irText('nicht mehr in Deckstation','no longer in station') : irText('nicht in aktueller ZG-Liste','not in current club list');
    const availabilityFilter=isStation ? `<label>${irText('Deckstatus','Availability')}<select id="club-filter-availability">
          <option value="all">${irText('Alle','All')}</option>
          <option value="external">${irText('Extern verfügbar','Externally available')}</option>
          <option value="not_external">${irText('Nicht extern','Not external')}</option>
          <option value="overview">${irText('Nur Übersicht','Overview only')}</option>
        </select></label>` : '';
    const availabilityHeader=isStation ? `<th>${irText('Deckstatus','Availability')}</th>` : '';

    root.innerHTML=`
      <div class="inventory-club-head">
        <div>
          <h3>${irEsc(club.name||irText('Zuchtgemeinschaft','Breeding club'))}</h3>
          <p class="small muted">${irEsc(club.server)}${club.founder?` · ${irText('Gründer','Founder')}: ${irEsc(club.founder)}`:''}${club.specialisation1?` · ${irEsc(club.specialisation1)}`:''}</p>
        </div>
        ${feeDiff ? `<button type="button" id="club-apply-all-fees">${irText(`Alle eindeutigen Decktaxen übernehmen (${feeDiff})`,`Apply all unambiguous stud fees (${feeDiff})`)}</button>`:''}
      </div>
      ${snapshotNotice}${incompleteNotice}
      <div class="inventory-count-grid inventory-club-count-grid">
        <div><strong>${matched}</strong><span>✓ ${irText('in DB gefunden','found in DB')}</span></div>
        <div><strong>${feeDiff}</strong><span>△ ${irText('Decktaxe abweichend','stud fee differs')}</span></div>
        <div><strong>${missing}</strong><span>＋ ${irText('fehlt in DB','missing from DB')}</span></div>
        <div><strong>${isStation?removedStallions.length:currentDbOnly.length}</strong><span>− ${removedLabel}</span></div>
      </div>
      ${ambiguous?`<div class="notice notice-warning small">⚠ ${ambiguous} ${irText('Hengst(e) konnten wegen mehrfacher Namens-Treffer nicht eindeutig zugeordnet werden.','stallion(s) could not be matched unambiguously because the name occurs more than once.')}</div>`:''}

      <div class="inventory-club-filters ${isStation?'has-availability':''}">
        <label>${irText('Suche','Search')}<input id="club-filter-search" type="search" placeholder="${irText('Pferd oder Besitzer …','Horse or owner …')}"></label>
        <label>${irText('Besitzer','Owner')}<select id="club-filter-owner"><option value="">${irText('Alle','All')}</option>${irClubOptionHtml(owners)}</select></label>
        <label>${irText('Rasse','Breed')}<select id="club-filter-breed"><option value="">${irText('Alle','All')}</option>${irClubOptionHtml(breeds)}</select></label>
        <label>${irText('Status','Status')}<select id="club-filter-status">
          <option value="all">${irText('Alle','All')}</option>
          <option value="complete">${irText('DB vollständig','DB complete')}</option>
          <option value="incomplete">${irText('DB unvollständig','DB incomplete')}</option>
          <option value="diff">${irText('Nur Abweichungen','Differences only')}</option>
          <option value="fee">${irText('Decktaxe abweichend','Stud fee differs')}</option>
          <option value="missing">${irText('Fehlt in DB','Missing from DB')}</option>
          ${isStation
            ? `<option value="removed">${irText('Nicht mehr in Deckstation','No longer in stud station')}</option>`
            : `<option value="not_listed">${irText('Nicht in aktueller ZG-Liste','Not in current club list')}</option>`}
        </select></label>
        ${availabilityFilter}
        <span id="club-filter-count" class="small muted"></span>
      </div>

      <p class="tiny muted inventory-club-sort-hint">${irText('Sortierung: vollständige DB-Treffer zuerst, danach teilweise/unvollständige bzw. abweichende Treffer; DB-Hengste außerhalb der aktuellen ZG-Liste folgen danach, fehlende DB-Pferde stehen ganz am Ende. Pferdenamen sind markierbar und über ⧉ direkt kopierbar.','Sorting: complete DB matches first, followed by partly complete/incomplete or differing matches; DB stallions outside the current club list follow, and horses missing from the DB are listed last. Horse names can be selected and copied directly via ⧉.')}</p>
      <div class="table-wrap"><table class="detail-table inventory-result-table inventory-club-stallion-table ${isStation?'inventory-station-table':''}">
        <thead><tr>
          <th>${irText('Hengst','Stallion')}</th><th>${irText('Besitzer','Owner')}</th><th>${irText('Rasse','Breed')}</th><th>GP/OP</th>
          <th>${remoteFeeLabel}</th><th>${irText('Decktaxe DB','DB stud fee')}</th>${availabilityHeader}<th>${irText('Status','Status')}</th><th>${irText('Aktion','Action')}</th>
        </tr></thead>
        <tbody id="club-stallion-body"></tbody>
      </table></div>

      ${!isStation?`<details class="inventory-result-group">
        <summary>${irText('Zuchtstuten','Broodmares')} · ${mares.length}</summary>
        <p class="tiny muted">${irText('Stuten werden ebenfalls eingelesen und auf Name, Besitzer, Rasse und GP abgeglichen. Die historische „nicht mehr gelistet“-Überwachung ist in dieser Version bewusst auf Hengste beschränkt.','Broodmares are also parsed and compared by name, owner, breed and OP. Historical “no longer listed” tracking is intentionally limited to stallions in this version.')}</p>
        ${irClubMareTable(mares)}
      </details>`:''}
      <p class="tiny muted">${isStation
        ? irText('Decktaxen werden nie still überschrieben. Nur eindeutige Treffer können einzeln oder gesammelt übernommen werden. GP/OP, Besitzer und andere Felder werden ausschließlich angezeigt und nicht automatisch verändert.','Stud fees are never overwritten silently. Only unambiguous matches can be applied individually or in bulk. OP, owner and other fields are display-only and are not changed automatically.')
        : irText('ZG-Status = aktueller Listenabgleich: Für dieselbe Spielwelt und die aktuell vertretenen Hengstrassen wird jeder DB-Hengst entweder in der ZG-Liste gefunden oder als „nicht in aktueller ZG-Liste“ gezeigt. Zuchtzulassung und aktueller Besitzerstatus filtern diese Prüfung nicht. Decktaxen werden nie still überschrieben.','Club status = current-list comparison: for the same game world and stallion breeds currently represented, every DB stallion is either found in the club list or shown as “not in current club list”. Breeding approval and current owner status do not filter this check. Stud fees are never overwritten silently.')}</p>`;

    irClubRenderStallionBody();
    for (const id of ['club-filter-search','club-filter-owner','club-filter-breed','club-filter-status','club-filter-availability']) {
      const el=document.getElementById(id);
      if (el) el.addEventListener(id==='club-filter-search'?'input':'change',irClubRenderStallionBody);
    }
    document.getElementById('club-apply-all-fees')?.addEventListener('click',()=>irClubApplyAllFees().catch(err=>alert(err.message)));
  }

  async function irClubApplyFeeItem(item) {
    if (!item?.local?.id || !item.feeDiff || item.remote?.stud_fee==null) return false;
    const updated={
      ...item.local,
      stud_fee:Number(item.remote.stud_fee),
      updated_at:new Date().toISOString(),
      last_change_source:item?.sourceType==='station' ? 'Deckstations-Abgleich' : 'ZG-Abgleich'
    };
    await localPut(LOCAL_STORES.horses,updated);
    Object.assign(item.local,updated);
    const memory=(irHorses||[]).find(h=>String(h.id)===String(updated.id));
    if (memory && memory!==item.local) Object.assign(memory,updated);
    irClubRefreshItem(item);
    return true;
  }

  async function irClubApplyAllFees() {
    if (!irClubLast) return;
    const targets=irClubLast.currentStallions.filter(x=>x.feeDiff && x.local?.id!=null && x.remote?.stud_fee!=null);
    if (!targets.length) return;
    const ok=confirm(irText(
      irClubLast?.club?.sourceType==='station'
        ? `${targets.length} eindeutige Decktaxe(n) aus der Deckstation in die Datenbank übernehmen?`
        : `${targets.length} eindeutige Decktaxe(n) aus der Zuchtgemeinschaft in die Datenbank übernehmen?`,
      irClubLast?.club?.sourceType==='station'
        ? `Apply ${targets.length} unambiguous stud fee(s) from the stud station to the database?`
        : `Apply ${targets.length} unambiguous stud fee(s) from the breeding club to the database?`
    ));
    if (!ok) return;
    let changed=0;
    for (const item of targets) if (await irClubApplyFeeItem(item)) changed++;
    irRenderClubResults(irClubLast);
    const status=document.getElementById('club-reconcile-status');
    if (status) status.textContent=irText(`${changed} Decktaxe(n) übernommen.`,`${changed} stud fee(s) applied.`);
  }

  async function irClubApplyFeeByLocalId(localId) {
    if (!irClubLast) return;
    const item=irClubLast.currentStallions.find(x=>String(x.local?.id)===String(localId) && x.feeDiff);
    if (!item) return;
    if (await irClubApplyFeeItem(item)) {
      irRenderClubResults(irClubLast);
      const status=document.getElementById('club-reconcile-status');
      if (status) status.textContent=irText(`Decktaxe für ${item.remote.name} übernommen.`,`Stud fee applied for ${item.remote.name}.`);
    }
  }

  async function irClubRun() {
    const status=document.getElementById('club-reconcile-status');
    const raw=document.getElementById('club-reconcile-text')?.value || '';
    if (!raw.trim()) {
      if (status) status.textContent=irText('Bitte eine vollständige Zuchtgemeinschafts- oder Deckstationsseite einfügen.','Please paste a complete breeding-club or stud-station page.');
      return;
    }
    if (!irHorses.length) irHorses=await localGetAll(LOCAL_STORES.horses);
    const club=irParseBreedingSource(raw);
    if (!club.valid) {
      if (status) status.textContent=irText('Keine Zuchtgemeinschafts- oder Deckstations-Hengstliste erkannt. Bitte die vollständige MDR-Seite einfügen.','No breeding-club or stud-station stallion list was detected. Please paste the complete MDR page.');
      return;
    }

    const currentStallions=irClubCompareRows(club.stallions,irHorses,club.server,'stallions',club.sourceType);
    const mares=irClubCompareRows(club.mares,irHorses,club.server,'mares',club.sourceType);
    const key=irClubSnapshotKey(club);
    const previous=await localGet(LOCAL_STORES.userSettings,key).catch(()=>null);
    const snapshot=irClubMergeSnapshot(club,previous,currentStallions);
    const removedStallions=club.sourceType==='station' && previous ? irClubRemovedItems(snapshot,irHorses,club.server) : [];
    const currentDbOnly=club.sourceType==='club' ? irClubCurrentDbOnlyItems(club,irHorses,currentStallions,snapshot) : [];

    // Ein unvollständiger Import darf zwar den zuletzt gesehenen Datenstand
    // aktualisieren, aber niemals vorhandene Hengste als entfernt markieren.
    // Bei ZGs ist der Snapshot nur Verlauf; der aktuelle Status kommt direkt
    // aus der eingelesenen Liste.
    await localPut(LOCAL_STORES.userSettings,snapshot);

    const state={club,currentStallions,removedStallions,currentDbOnly,mares,hadPrevious:!!previous,snapshot};
    if (status) status.textContent=club.sourceType==='station'
      ? irText(`${club.stallions.length} Hengste aus ${club.name} erkannt · ${club.server}.`,`${club.stallions.length} stallions detected from ${club.name} · ${club.server}.`)
      : irText(`${club.stallions.length} Hengste und ${club.mares.length} Stuten erkannt · ${club.server}.`,`${club.stallions.length} stallions and ${club.mares.length} broodmares detected · ${club.server}.`);
    irRenderClubResults(state);
  }

  function irSelectTab(tab) {
    const next=tab==='club'?'club':'stock';
    document.querySelectorAll('.inventory-reconcile-tab').forEach(btn=>{
      const active=btn.dataset.irTab===next;
      btn.classList.toggle('active',active);
      btn.setAttribute('aria-selected',active?'true':'false');
    });
    document.querySelectorAll('.inventory-reconcile-pane').forEach(pane=>{
      pane.hidden=pane.dataset.irPane!==next;
    });
    const subtitle=document.getElementById('inventory-reconcile-subtitle');
    if (subtitle) subtitle.textContent=next==='club'
      ? irText('Zuchtgemeinschaft oder Deckstation einlesen, Hengste mit der Datenbank vergleichen und Decktaxen gezielt übernehmen.','Parse a breeding club or stud station, compare stallions with the database, and selectively apply stud fees.')
      : irText('Eine oder mehrere vollständige MDR-Profilseiten einfügen und mit frei gewählten Besitzern aus der Datenbank vergleichen.','Paste one or more complete MDR profile pages and compare them with selected owners in the database.');
  }

  let irHorses=[];
  async function irOpen() {
    const modal=document.getElementById('inventory-reconcile-modal');
    if (!modal) return;
    irHorses=(typeof filterOptionHorses!=='undefined' && Array.isArray(filterOptionHorses) && filterOptionHorses.length)
      ? filterOptionHorses.slice()
      : await localGetAll(LOCAL_STORES.horses);
    irRenderOwners(irHorses);
    const stockResults=document.getElementById('inventory-results');
    const stockStatus=document.getElementById('inventory-reconcile-status');
    const clubResults=document.getElementById('club-results');
    const clubStatus=document.getElementById('club-reconcile-status');
    if (stockResults) stockResults.innerHTML='';
    if (stockStatus) stockStatus.textContent='';
    if (clubResults) clubResults.innerHTML='';
    if (clubStatus) clubStatus.textContent='';
    irClubLast=null;
    irStockSelectedIds.clear();
    irLastStockResult=null;
    irSelectTab('stock');
    modal.hidden=false;
  }
  function irClose() { const m=document.getElementById('inventory-reconcile-modal'); if (m) m.hidden=true; }
  async function irRun(options={}) {
    const status=document.getElementById('inventory-reconcile-status');
    const raw=document.getElementById('inventory-reconcile-text')?.value || '';
    const selected=new Set([...document.querySelectorAll('#inventory-owner-options input:checked')].map(cb=>irNorm(cb.value)));
    if (!selected.size) { if(status)status.textContent=irText('Bitte mindestens einen Besitzer auswählen.','Please select at least one owner.'); return; }
    if (!raw.trim()) { if(status)status.textContent=irText('Bitte mindestens eine MDR-Profilseite einfügen.','Please paste at least one MDR profile page.'); return; }
    const profiles=irParseProfiles(raw);
    if (!options.fromMutation) irStockSelectedIds.clear();
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

  async function irClubCopyText(value, button) {
    const text=String(value||'').trim();
    if (!text) return;
    let copied=false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied=true;
      }
    } catch {}
    if (!copied) {
      try {
        const ta=document.createElement('textarea');
        ta.value=text;
        ta.setAttribute('readonly','');
        ta.style.position='fixed';
        ta.style.opacity='0';
        document.body.appendChild(ta);
        ta.select();
        copied=document.execCommand('copy');
        ta.remove();
      } catch {}
    }
    if (button && copied) {
      const old=button.textContent;
      button.textContent='✓';
      button.classList.add('copied');
      setTimeout(()=>{button.textContent=old;button.classList.remove('copied');},900);
    }
  }

  function irInit() {
    document.getElementById('inventory-reconcile-btn')?.addEventListener('click',()=>irOpen().catch(err=>alert(err.message)));
    document.getElementById('inventory-reconcile-close')?.addEventListener('click',irClose);
    document.getElementById('inventory-reconcile-cancel')?.addEventListener('click',irClose);
    document.getElementById('club-reconcile-cancel')?.addEventListener('click',irClose);
    document.getElementById('inventory-reconcile-run')?.addEventListener('click',irRun);
    document.getElementById('club-reconcile-run')?.addEventListener('click',()=>irClubRun().catch(err=>{
      console.error('Zucht-/Deckstationsabgleich fehlgeschlagen:',err);
      const status=document.getElementById('club-reconcile-status');
      if (status) status.textContent=irText(`Zucht-/Deckstationsabgleich fehlgeschlagen: ${err?.message||err}`,`Breeding/stud-station comparison failed: ${err?.message||err}`);
    }));
    document.querySelectorAll('.inventory-reconcile-tab').forEach(btn=>btn.addEventListener('click',()=>irSelectTab(btn.dataset.irTab)));
    document.getElementById('inventory-owner-all')?.addEventListener('click',()=>document.querySelectorAll('#inventory-owner-options input').forEach(cb=>{cb.checked=true;}));
    document.getElementById('inventory-owner-none')?.addEventListener('click',()=>document.querySelectorAll('#inventory-owner-options input').forEach(cb=>{cb.checked=false;}));
    document.getElementById('club-results')?.addEventListener('click',event=>{
      const copyBtn=event.target.closest('[data-club-copy-name]');
      if (copyBtn) {
        irClubCopyText(copyBtn.dataset.clubCopyName,copyBtn);
        return;
      }
      const btn=event.target.closest('[data-club-fee-apply]');
      if (btn) irClubApplyFeeByLocalId(btn.dataset.clubFeeApply).catch(err=>alert(err.message));
    });
    document.getElementById('inventory-results')?.addEventListener('change',event=>{
      const master=event.target.closest('[data-inventory-select-group]');
      if (master) {
        const type=master.dataset.inventorySelectGroup;
        document.querySelectorAll(`#inventory-results [data-inventory-select-type=\"${CSS.escape(type)}\"]`).forEach(cb=>{
          cb.checked=master.checked;
          const id=String(cb.dataset.inventorySelect);
          if (master.checked) irStockSelectedIds.add(id); else irStockSelectedIds.delete(id);
        });
        irUpdateStockBulkBar();
        return;
      }
      const cb=event.target.closest('[data-inventory-select]');
      if (!cb) return;
      const id=String(cb.dataset.inventorySelect);
      if (cb.checked) irStockSelectedIds.add(id); else irStockSelectedIds.delete(id);
      irUpdateStockBulkBar();
    });
    document.getElementById('inventory-results')?.addEventListener('click',event=>{
      const btn=event.target.closest('[data-inventory-bulk]');
      if (!btn) return;
      const action=btn.dataset.inventoryBulk;
      if (action==='clear') { irStockSelectedIds.clear(); irUpdateStockBulkBar(); return; }
      btn.disabled=true;
      const task=action==='delete' ? irBulkDeleteSelected()
        : action==='learning' ? irBulkMoveLearningSelected()
        : action==='owner' ? irBulkUpdateOwnersSelected()
        : Promise.resolve();
      Promise.resolve(task).catch(err=>alert(err?.message||err)).finally(()=>{ if (document.body.contains(btn)) { btn.disabled=false; irUpdateStockBulkBar(); } });
    });
    document.getElementById('inventory-reconcile-modal')?.addEventListener('click',e=>{if(e.target?.id==='inventory-reconcile-modal')irClose();});
  }

  window.MDR_INVENTORY_RECONCILE={
    parseProfiles:irParseProfiles,
    parseProfile:irParseProfile,
    compare:irCompare,
    assignDetectedServers:irAssignDetectedServers,
    normalizeName:irNorm,
    parseClub:irClubParsePage,
    parseStudStation:irStationParsePage,
    parseBreedingSource:irParseBreedingSource,
    cleanHorseName:irHorseName,
    compareClubRows:irClubCompareRows,
    currentClubDbOnly:irClubCurrentDbOnlyItems,
    mergeClubSnapshot:irClubMergeSnapshot,
    clubSnapshotKey:irClubSnapshotKey
  };
  if (typeof document!=='undefined') {
    if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',irInit,{once:true}); else irInit();
  }
})();
