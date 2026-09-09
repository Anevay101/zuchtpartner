// V46 Farbguide – konservative MDR-Farbvererbung.
//
// Grundprinzip:
// 1) Getestete Genotypen haben Vorrang.
// 2) Sichtbare Fellfarben dürfen einen MINDEST-Zustand beweisen
//    (z.B. Dun -> D_ = mindestens ein D), werden aber nicht als Gentest
//    ausgegeben.
// 3) Eine einzelne Prozentzahl wird nur gezeigt, wenn sie aus den bekannten
//    bzw. ableitbaren Zuständen eindeutig berechenbar ist. Sonst: nicht vorhersehbar.
// 4) Unbekannte Gene blockieren nicht mehr die übrigen bekannten
//    Farbvorhersagen.
// 5) Cream/Pearl werden als gemeinsamer Locus behandelt.
// 6) cKit (Tobiano/Sabino/Dominant White/Roan) ist ein gemeinsamer Locus
//    mit insgesamt zwei Allelen.
// 7) Appaloosa: LP und PATN1 werden genetisch vererbt. PATN2 existiert laut
//    MDR-Farbguide als internes Pattern, ist im Spiel aber nicht separat testbar.
//    Deshalb wird niemals ein individueller PATN2-Genotyp erfunden. Die sichtbare
//    Musterverteilung wird aus den tatsächlich eingetragenen MDR-Pferden gelernt.
//    Snowflake läuft dabei als eigenes beobachtetes Muster.

const CG_SHADE_SCALES = {
  Chestnut: ['Light Chestnut','Gold Chestnut','Sorrel Chestnut','Chestnut','Copper Chestnut','Dark Chestnut','Liver Chestnut','Dark Liver Chestnut'],
  Bay: ['Light Bay','Gold Bay','Bay','Blood Bay','Copper Bay','Russet Bay','Mahagony Bay','Dark Bay'],
  Sealbrown: ['Light Sealbrown','Sealbrown','Dark Sealbrown','Black Sealbrown'],
  Black: ['Coal Black','Black','Pitch Black','Jet Black'],
};

const CG_ALLELES = {
  Extension: ['E','e'],
  Agouti: ['Ap','A1','At','a0'],
  Cream: ['Cr','cr','pl'],
  Dun: ['D','d'],
  Champagne: ['Ch','ch'],
  Grey: ['G','g'],
  Silver: ['Z','z'],
  Appaloosa: ['Lp','lp'],
  PATN1: ['P1','p1'],
  Overo: ['O','o'],
  Splashed: ['SPL','spl'],
};

function cgEsc(value) {
  if (typeof esc === 'function') return esc(value);
  if (typeof escapeHtml === 'function') return escapeHtml(value);
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function cgPct(v) {
  const n = Math.round(Number(v || 0) * 1000) / 10;
  return `${n.toFixed(n % 1 ? 1 : 0)}%`;
}

function cgRangeText(min, max) {
  if (min == null || max == null) return 'unbekannt';
  return Math.abs(Number(max) - Number(min)) < 1e-9
    ? cgPct(min)
    : 'nicht vorhersehbar';
}

function cgRaw(v) {
  return String(v || '').replace(/\s+/g, '').replace(/\//g, '');
}

function cgUntested(v) {
  return !v || /nicht getestet|not tested/i.test(String(v));
}

function cgRow(horse, label) {
  return (horse?.colors || []).find(
    r => String(r?.label || '').toLowerCase() === String(label || '').toLowerCase()
  ) || null;
}

function cgSplit(raw, alleles) {
  if (!raw || cgUntested(raw)) return null;
  const s = cgRaw(raw);
  const ordered = [...alleles].sort((a,b) => b.length - a.length);
  for (const a of ordered) {
    if (!s.startsWith(a)) continue;
    const rest = s.slice(a.length);
    for (const b of ordered) {
      if (rest === b) return [a,b];
    }
  }
  return null;
}

function cgUniqueStates(states) {
  const seen = new Set();
  return (states || []).filter(Boolean).filter(state => {
    const key = [...state].sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cgTestedState(horse, locus) {
  const row = cgRow(horse, locus);
  if (!row || cgUntested(row.value)) return null;
  const exact = cgSplit(row.value, CG_ALLELES[locus] || []);
  if (exact) return { states:[exact], tested:true, source:`getestet: ${row.value}` };

  // Manche MDR-Datensätze enthalten einen einzelnen, bereits bestätigten
  // Allelwert (z.B. "D", "Lp", "Cr"). Das bedeutet "mindestens einmal",
  // nicht automatisch heterozygot.
  const single = cgRaw(row.value);
  const alleles = CG_ALLELES[locus] || [];
  if (alleles.includes(single)) {
    let states = [[single,single]];

    if (locus === 'Agouti') {
      const dominance = ['Ap','A1','At','a0'];
      const idx = dominance.indexOf(single);
      states = dominance.slice(idx).map(other => [single,other]);
    } else if (locus === 'Cream') {
      // Cream und Pearl teilen sich denselben Locus.
      states = single === 'Cr'
        ? [['Cr','Cr'],['Cr','cr'],['Cr','pl']]
        : single === 'pl'
          ? [['pl','pl'],['pl','cr'],['pl','Cr']]
          : [['cr','cr']];
    } else {
      const recessive = alleles.find(x => x !== single && x.toLowerCase() === x);
      states = recessive
        ? [[single,single],[single,recessive]]
        : [[single,single]];
    }

    return { states:cgUniqueStates(states), tested:true, source:`getestet: mindestens 1× ${single}` };
  }
  return null;
}

function cgPhenotypeHints(horse) {
  if (typeof inferGeneticHintsFromPhenotype !== 'function') return [];
  const chunks = [horse?.coat_color, horse?.notes, horse?.name].filter(Boolean);
  const out = [];
  for (const chunk of chunks) {
    for (const h of inferGeneticHintsFromPhenotype(chunk) || []) {
      out.push({ ...h, source:'aus Fellfarbe/Phänotyp abgeleitet' });
    }
  }
  return out;
}

function cgHintForLocus(horse, locus) {
  return cgPhenotypeHints(horse).filter(h => h.locus === locus);
}

function cgDominantKnowledge(horse, locus, presentAllele, absentAllele) {
  const tested = cgTestedState(horse, locus);
  if (tested) return tested;

  const hints = cgHintForLocus(horse, locus);
  const doubled = hints.find(h => h.allele === presentAllele + presentAllele);
  if (doubled) {
    return {
      states:[[presentAllele,presentAllele]],
      tested:false,
      source:`${doubled.label || presentAllele}: aus Fellfarbe abgeleitet`,
    };
  }
  const present = hints.find(h => String(h.allele || '').includes(presentAllele));
  if (present) {
    return {
      states:[[presentAllele,presentAllele],[presentAllele,absentAllele]],
      tested:false,
      source:`${present.label || presentAllele}: mindestens 1× aus Fellfarbe abgeleitet`,
    };
  }
  return null;
}

function cgBasePhenotypeKnowledge(horse, locus) {
  const tested = cgTestedState(horse, locus);
  if (tested) return tested;

  const coat = String(horse?.coat_color || '');
  if (locus === 'Extension') {
    // Sichtbarer Fuchs ist zwingend ee. Alle sichtbaren schwarzen
    // Grundfarben benötigen mindestens ein E.
    if (/chestnut|sorrel|liver chestnut|dunalino|cremello|palomino|apricot/i.test(coat)) {
      return { states:[['e','e']], tested:false, source:'Chestnut-Basis aus Fellfarbe abgeleitet' };
    }
    if (/wildbay|\bbay\b|sealbrown|\bblack\b|grulla|buckskin|dunskin|smoky|amber|sable|classic|perlino/i.test(coat)) {
      return { states:[['E','E'],['E','e']], tested:false, source:'schwarze Pigmentbasis E_ aus Fellfarbe abgeleitet' };
    }
  }

  if (locus === 'Agouti') {
    if (/wildbay/i.test(coat)) {
      return {
        states:[['Ap','Ap'],['Ap','A1'],['Ap','At'],['Ap','a0']],
        tested:false, source:'Wildbay (Ap_) aus Fellfarbe abgeleitet'
      };
    }
    if (/sealbrown/i.test(coat)) {
      return {
        states:[['At','At'],['At','a0']],
        tested:false, source:'Sealbrown (At_) aus Fellfarbe abgeleitet'
      };
    }
    // Nur ein ausdrücklich genanntes Bay/Buckskin/Dunskin/Amber (nicht
    // Wildbay) wird als A1_ gewertet.
    if (/\b(bay|buckskin|dunskin|amber)\b/i.test(coat) && !/wildbay/i.test(coat)) {
      return {
        states:[['A1','A1'],['A1','At'],['A1','a0']],
        tested:false, source:'Bay-Basis (A1_) aus Fellfarbe abgeleitet'
      };
    }
    if (/\bblack\b|grulla|smoky black|classic champagne/i.test(coat)) {
      return { states:[['a0','a0']], tested:false, source:'Black-Basis (a0a0) aus Fellfarbe abgeleitet' };
    }
  }
  return null;
}

function cgCreamKnowledge(horse) {
  const tested = cgTestedState(horse, 'Cream');
  if (tested) return tested;

  const coat = String(horse?.coat_color || '');
  if (/\b(pearl|apricot)\b/i.test(coat)) {
    return { states:[['pl','pl']], tested:false, source:'sichtbares Pearl (plpl) aus Fellfarbe abgeleitet' };
  }
  if (/\b(palomino|buckskin|smoky brown|smoky black|dunalino|dunskin)\b/i.test(coat)) {
    return { states:[['Cr','cr']], tested:false, source:'einfaches Cream (Cr/cr) aus Fellfarbe abgeleitet' };
  }
  if (/\b(cremello|perlino|sealbrown cream|smoky cream)\b/i.test(coat)) {
    return {
      states:[['Cr','Cr'],['Cr','pl']],
      tested:false,
      source:'doppelte Cream-Aufhellung: CrCr oder Cr/pl aus Fellfarbe ableitbar'
    };
  }
  return null;
}

function cgKnowledge(horse, locus) {
  if (locus === 'Extension' || locus === 'Agouti') return cgBasePhenotypeKnowledge(horse, locus);
  if (locus === 'Cream') return cgCreamKnowledge(horse);
  if (locus === 'Dun') return cgDominantKnowledge(horse, 'Dun', 'D', 'd');
  if (locus === 'Champagne') return cgDominantKnowledge(horse, 'Champagne', 'Ch', 'ch');
  if (locus === 'Grey') return cgDominantKnowledge(horse, 'Grey', 'G', 'g');
  if (locus === 'Silver') return cgDominantKnowledge(horse, 'Silver', 'Z', 'z');
  if (locus === 'Overo') return cgDominantKnowledge(horse, 'Overo', 'O', 'o');
  if (locus === 'Splashed') return cgDominantKnowledge(horse, 'Splashed', 'SPL', 'spl');
  return cgTestedState(horse, locus);
}

function cgGametes(genotype) {
  if (!genotype) return null;
  return genotype[0] === genotype[1]
    ? new Map([[genotype[0], 1]])
    : new Map([[genotype[0], .5],[genotype[1], .5]]);
}

function cgCrossPair(a,b) {
  const ga = cgGametes(a), gb = cgGametes(b);
  if (!ga || !gb) return null;
  const out = new Map();
  for (const [x,px] of ga) for (const [y,py] of gb) {
    const key = [x,y].sort().join('|');
    out.set(key,(out.get(key)||0)+px*py);
  }
  return out;
}

function cgAllCrosses(ka,kb) {
  if (!ka?.states?.length || !kb?.states?.length) return [];
  const out = [];
  for (const a of ka.states) for (const b of kb.states) out.push(cgCrossPair(a,b));
  return out.filter(Boolean);
}

function cgPair(key) { return key.split('|'); }
function cgCount(pair, allele) { return pair.filter(x => x === allele).length; }

function cgProbabilityRange(crosses, predicate) {
  if (!crosses?.length) return null;
  const vals = crosses.map(cross => {
    let p = 0;
    for (const [key,prob] of cross) if (predicate(cgPair(key))) p += prob;
    return p;
  });
  return { min:Math.min(...vals), max:Math.max(...vals) };
}

function cgDominantRange(mare, stallion, locus, allele, absentAllele) {
  const mk = cgKnowledge(mare,locus);
  const sk = cgKnowledge(stallion,locus);
  if (!mk && !sk) return null;

  // Unbekannter zweiter Elternteil: komplett unbekannt, damit das bekannte
  // Elternteil einen belastbaren MINDESTwert liefert, der Maximalwert aber
  // nicht künstlich begrenzt wird.
  const unknown = { states:[[absentAllele,absentAllele],[allele,absentAllele],[allele,allele]], tested:false, source:'unbekannt' };
  const crosses = cgAllCrosses(mk || unknown, sk || unknown);
  const range = cgProbabilityRange(crosses, pair => pair.includes(allele));
  return range ? { ...range, mare:mk, stallion:sk } : null;
}

function cgBaseName(extension, agouti) {
  if (cgCount(extension,'e') === 2) return 'Chestnut';
  for (const allele of ['Ap','A1','At','a0']) {
    if (!agouti.includes(allele)) continue;
    return allele === 'Ap' ? 'Wildbay' : allele === 'A1' ? 'Bay' : allele === 'At' ? 'Sealbrown' : 'Black';
  }
  return null;
}

function cgRangeRowsFromCrosses(crossSets, labels, classify) {
  if (!crossSets.length) return null;
  const maps = crossSets.map(set => {
    const out = new Map();
    for (const item of set) {
      const label = classify(item);
      if (label) out.set(label,(out.get(label)||0)+item.p);
    }
    return out;
  });
  return labels.map(label => {
    const vals = maps.map(m => m.get(label)||0);
    return { label, min:Math.min(...vals), max:Math.max(...vals) };
  }).filter(r => r.max > 0.00001);
}

function cgBaseColors(mare, stallion) {
  const me = cgKnowledge(mare,'Extension'), se = cgKnowledge(stallion,'Extension');
  const ma = cgKnowledge(mare,'Agouti'), sa = cgKnowledge(stallion,'Agouti');
  if (!me || !se || !ma || !sa) return null;

  const sets = [];
  for (const eg of cgAllCrosses(me,se)) {
    for (const ag of cgAllCrosses(ma,sa)) {
      const rows = [];
      for (const [ek,ep] of eg) for (const [ak,ap] of ag) {
        rows.push({ extension:cgPair(ek), agouti:cgPair(ak), p:ep*ap });
      }
      sets.push(rows);
    }
  }
  const rows = cgRangeRowsFromCrosses(
    sets,
    ['Chestnut','Wildbay','Bay','Sealbrown','Black'],
    item => cgBaseName(item.extension,item.agouti)
  );

  // V50: Grundfarben wie die Appaloosa-Muster nach Wahrscheinlichkeit
  // staffeln – höchste mögliche Wahrscheinlichkeit zuerst, bei gleicher
  // Obergrenze die höhere Mindestwahrscheinlichkeit.
  return (rows || []).sort((a,b)=>
    (b.max-a.max) ||
    (b.min-a.min) ||
    (((b.min+b.max)/2)-((a.min+a.max)/2)) ||
    a.label.localeCompare(b.label,'de')
  );
}

function cgCreamState(pair) {
  const cr = cgCount(pair,'Cr'), pl = cgCount(pair,'pl');
  if (cr === 2 || (cr === 1 && pl === 1)) return 'double';
  if (cr === 1) return 'cream';
  if (pl === 2) return 'pearl';
  return 'none';
}

const CG_CREAM = {Chestnut:'Palomino',Wildbay:'Buckskin',Bay:'Buckskin',Sealbrown:'Smoky Brown',Black:'Smoky Black'};
const CG_DOUBLE = {Chestnut:'Cremello',Wildbay:'Perlino',Bay:'Perlino',Sealbrown:'Sealbrown Cream',Black:'Smoky Cream'};
const CG_PEARL = {Chestnut:'Apricot',Wildbay:'Pearl Bay',Bay:'Pearl Bay',Sealbrown:'Pearl Brown',Black:'Pearl Black'};
const CG_DUN = {Chestnut:'Red Dun',Wildbay:'Classic Dun',Bay:'Classic Dun',Sealbrown:'Brown Dun',Black:'Grulla'};
const CG_CH = {Chestnut:'Gold Champagne',Wildbay:'Amber Champagne',Bay:'Amber Champagne',Sealbrown:'Sable Champagne',Black:'Classic Champagne'};

const CG_COMBO = {
  Chestnut:{'dun+cream':'Dunalino','dun+champagne':'Gold Dun','champagne+cream':'Gold Cream','dun+pearl':'Apricot Dun','champagne+pearl':'Gold Pearl','dun+double':'Cremello Dun','champagne+double':'Cremello Champagne','dun+champagne+cream':'Gold Dun Cream','dun+champagne+pearl':'Gold Dun Pearl'},
  Wildbay:{'dun+cream':'Wild Dunskin','dun+champagne':'Amber Dun','champagne+cream':'Amber Cream','dun+pearl':'Pearl Bay Dun','champagne+pearl':'Amber Pearl','dun+double':'Perlino Dun','champagne+double':'Perlino Champagne','dun+champagne+cream':'Amber Dun Cream','dun+champagne+pearl':'Amber Dun Pearl'},
  Bay:{'dun+cream':'Dunskin','dun+champagne':'Amber Dun','champagne+cream':'Amber Cream','dun+pearl':'Pearl Bay Dun','champagne+pearl':'Amber Pearl','dun+double':'Perlino Dun','champagne+double':'Perlino Champagne','dun+champagne+cream':'Amber Dun Cream','dun+champagne+pearl':'Amber Dun Pearl'},
  Sealbrown:{'dun+cream':'Smoky Brown Dun','dun+champagne':'Sable Dun','champagne+cream':'Sable Cream','dun+pearl':'Pearl Brown Dun','champagne+pearl':'Sable Pearl','dun+double':'Sealbrown Cream Dun','champagne+double':'Sealbrown Cream Champagne','dun+champagne+cream':'Sable Dun Cream','dun+champagne+pearl':'Sable Dun Pearl'},
  Black:{'dun+cream':'Smoky Grulla','dun+champagne':'Classic Dun','champagne+cream':'Classic Cream','dun+pearl':'Pearl Black Dun','champagne+pearl':'Classic Pearl','dun+double':'Smoky Cream Dun','champagne+double':'Smoky Cream Champagne','dun+champagne+cream':'Classic Dun Cream','dun+champagne+pearl':'Classic Dun Pearl'}
};

function cgCoreName(base, creamState, dun, champagne) {
  const key = [dun?'dun':null,champagne?'champagne':null,creamState!=='none'?creamState:null].filter(Boolean).join('+');
  if (key && CG_COMBO[base]?.[key]) return CG_COMBO[base][key];
  if (creamState === 'cream' && !dun && !champagne) return CG_CREAM[base] || base;
  if (creamState === 'double' && !dun && !champagne) return CG_DOUBLE[base] || base;
  if (creamState === 'pearl' && !dun && !champagne) return CG_PEARL[base] || base;
  if (dun && creamState === 'none' && !champagne) return CG_DUN[base] || base;
  if (champagne && creamState === 'none' && !dun) return CG_CH[base] || base;
  if (!key) return base;
  return `${base} + ${[dun?'Dun':null,champagne?'Champagne':null,creamState==='cream'?'Cream':creamState==='double'?'doppel Cream/Cream+Pearl':creamState==='pearl'?'Pearl':null].filter(Boolean).join(' + ')}`;
}

function cgCoreColors(mare, stallion) {
  const loci = ['Extension','Agouti','Cream','Dun','Champagne'];
  const mk = Object.fromEntries(loci.map(l => [l,cgKnowledge(mare,l)]));
  const sk = Object.fromEntries(loci.map(l => [l,cgKnowledge(stallion,l)]));
  if (loci.some(l => !mk[l] || !sk[l])) return null;

  const resultMaps = [];
  for (const me of mk.Extension.states) for (const se of sk.Extension.states)
  for (const ma of mk.Agouti.states) for (const sa of sk.Agouti.states)
  for (const mc of mk.Cream.states) for (const sc of sk.Cream.states)
  for (const md of mk.Dun.states) for (const sd of sk.Dun.states)
  for (const mh of mk.Champagne.states) for (const sh of sk.Champagne.states) {
    const eg=cgCrossPair(me,se), ag=cgCrossPair(ma,sa), cg=cgCrossPair(mc,sc), dg=cgCrossPair(md,sd), hg=cgCrossPair(mh,sh);
    const map = new Map();
    for (const [ek,ep] of eg) for (const [ak,ap] of ag)
    for (const [ck,cp] of cg) for (const [dk,dp] of dg) for (const [hk,hp] of hg) {
      const base = cgBaseName(cgPair(ek),cgPair(ak));
      if (!base) continue;
      const name = cgCoreName(
        base,
        cgCreamState(cgPair(ck)),
        cgPair(dk).includes('D'),
        cgPair(hk).includes('Ch')
      );
      map.set(name,(map.get(name)||0)+ep*ap*cp*dp*hp);
    }
    resultMaps.push(map);
  }

  const labels = [...new Set(resultMaps.flatMap(m => [...m.keys()]))];
  return labels.map(label => {
    const vals = resultMaps.map(m => m.get(label)||0);
    return { label,min:Math.min(...vals),max:Math.max(...vals) };
  }).filter(r => r.max > .00001).sort((a,b)=>b.max-a.max);
}

function cgSourceLabel(k) {
  return k?.source || 'unbekannt';
}

// -------- cKit: genau zwei Allele, vier mögliche Varianten -------------
const CG_KIT_ALLELES = ['TO','SB','Rn','WI','00'];

function cgNormalizeKitAllele(value) {
  const s = String(value || '');
  if (s === '00') return '00';
  if (/^to$/i.test(s)) return 'TO';
  if (/^sb$/i.test(s)) return 'SB';
  if (/^rn$/i.test(s)) return 'Rn';
  if (/^wi$/i.test(s)) return 'WI';
  return s;
}

function cgKitTested(horse) {
  const row = cgRow(horse,'KIT');
  if (!row || cgUntested(row.value)) return null;
  const raw = cgRaw(row.value);
  if (raw.length === 4) {
    const a = cgNormalizeKitAllele(raw.slice(0,2));
    const b = cgNormalizeKitAllele(raw.slice(2,4));
    if (CG_KIT_ALLELES.includes(a) && CG_KIT_ALLELES.includes(b)) {
      return { states:[[a,b]], tested:true, source:`getestet: ${row.value}` };
    }
  }
  const single = cgNormalizeKitAllele(raw);
  if (CG_KIT_ALLELES.includes(single)) {
    return {
      states:[[single,'00'],[single,single]],
      tested:true,
      source:`getestet: mindestens 1× ${single}`,
    };
  }
  return null;
}

function cgKitVisibleAlleles(horse) {
  const coat = String(horse?.coat_color || '');
  const found = [];
  if (/\btobiano\b/i.test(coat)) found.push('TO');
  if (/\bsabino\b/i.test(coat)) found.push('SB');
  if (/\broan\b/i.test(coat) && !/varnish\s*roan/i.test(coat)) found.push('Rn');
  return [...new Set(found)];
}

function cgKitKnowledge(horse) {
  const tested = cgKitTested(horse);
  if (tested) return tested;

  // In einigen vorhandenen MDR-Datensätzen liegt Dominant White noch als
  // eigene Zeile "White: WI" vor. Fachlich wird es trotzdem als cKit-Allel
  // behandelt.
  const whiteRow = cgRow(horse,'White');
  if (whiteRow && !cgUntested(whiteRow.value) && /WI/i.test(String(whiteRow.value))) {
    return {
      states:[['WI','00'],['WI','WI']],
      tested:true,
      source:`White-Test ${whiteRow.value} → cKit WI mindestens 1×`,
    };
  }

  const visible = cgKitVisibleAlleles(horse);
  if (!visible.length) return null;
  if (visible.length >= 2) {
    return {
      states:[[visible[0],visible[1]]],
      tested:false,
      source:`${visible.join(' + ')} aus Fellfarbe abgeleitet`,
    };
  }
  const a = visible[0];
  return {
    // Nur die tatsächlich sichtbare cKit-Variante berücksichtigen.
    // Andere cKit-Allele werden nicht allein deshalb angenommen, weil sie
    // am selben Genort liegen. Die zweite Kopie bleibt 00 oder dieselbe
    // sichtbare Variante, solange nichts Weiteres belegt ist.
    states:[[a,'00'],[a,a]],
    tested:false,
    source:`${a} aus Fellfarbe abgeleitet`,
  };
}

function cgKitEvidenceAlleles(horse) {
  const knowledge = cgKitKnowledge(horse);
  if (!knowledge?.states?.length) return [];
  return [...new Set(knowledge.states.flat().filter(a => a && a !== '00' && CG_KIT_ALLELES.includes(a)))];
}

function cgKitAlleleRange(mare,stallion,allele) {
  const mk = cgKitKnowledge(mare), sk = cgKitKnowledge(stallion);
  if (!mk && !sk) return null;

  const allStates = [];
  for (const a of CG_KIT_ALLELES) for (const b of CG_KIT_ALLELES) allStates.push([a,b]);
  const unknown = { states:allStates, source:'unbekannt' };
  const crosses = cgAllCrosses(mk || unknown, sk || unknown);
  const range = cgProbabilityRange(crosses, pair => pair.includes(allele));
  return range ? {...range,mare:mk,stallion:sk} : null;
}

// -------- Appaloosa ---------------------------------------------------
// V51/V54.0.34: LP und PATN1 werden mendelnd vererbt. Die sichtbare
// Musterverteilung wird danach aus den TATSÄCHLICH eingetragenen Pferden gelernt.
// PATN2 ist laut MDR-Farbguide ein internes Pattern (u.a. Blanket/Snowcap), aber
// nicht separat testbar. Darum wird hier kein individueller PATN2-Genotyp erzeugt.

function cgPatternHint(horse) {
  const manual = String(horse?.appaloosa_pattern || '').trim();
  if (manual) return manual;
  if (typeof detectAppaloosaPatternFromCoatColor === 'function') {
    const detected = detectAppaloosaPatternFromCoatColor(horse?.coat_color);
    if (detected) return detected;
  }
  return null;
}

function cgAppaloosaReferenceHorses(allHorses = null) {
  if (Array.isArray(allHorses) && allHorses.length) return allHorses;
  const globalRows = typeof globalThis !== 'undefined'
    ? globalThis.MDR_APPALOOSA_EMPIRICAL_HORSES
    : null;
  return Array.isArray(globalRows) ? globalRows : [];
}

function cgNormalizeLpTestValue(value) {
  const s = String(value || '').replace(/\s+/g,'');
  if (s === 'LpLp') return 'LpLp';
  if (s === 'Lplp' || s === 'lpLp') return 'Lplp';
  if (s === 'lplp') return 'lplp';
  return null;
}

function cgNormalizePatn1TestValue(value) {
  const s = String(value || '').replace(/\s+/g,'');
  if (s === 'P1P1') return 'P1P1';
  if (s === 'P1p1' || s === 'p1P1') return 'P1p1';
  if (s === 'p1p1') return 'p1p1';
  return null;
}

function cgLpStateFromCategory(category) {
  if (category === 'LpLp') return ['Lp','Lp'];
  if (category === 'Lplp') return ['Lp','lp'];
  if (category === 'lplp') return ['lp','lp'];
  return null;
}

function cgPatn1StateFromCategory(category) {
  if (category === 'P1P1') return ['P1','P1'];
  if (category === 'P1p1') return ['P1','p1'];
  if (category === 'p1p1') return ['p1','p1'];
  return null;
}

function cgTestedAppaloosaCategories(horse) {
  const lp = cgNormalizeLpTestValue(cgRow(horse,'Appaloosa')?.value);
  const p1 = cgNormalizePatn1TestValue(cgRow(horse,'PATN1')?.value);
  return { lp, p1 };
}

function cgObservedGenotypeStatesForPattern(pattern, allHorses, kind) {
  if (!pattern) return [];
  const states = [];
  for (const horse of cgAppaloosaReferenceHorses(allHorses)) {
    if (cgPatternHint(horse) !== pattern) continue;
    const tested = cgTestedAppaloosaCategories(horse);
    const state = kind === 'lp'
      ? cgLpStateFromCategory(tested.lp)
      : cgPatn1StateFromCategory(tested.p1);
    if (state) states.push(state);
  }
  return cgUniqueStates(states);
}

function cgLpKnowledge(horse, allHorses = null) {
  const tested = cgTestedState(horse,'Appaloosa');
  if (tested) return tested;

  const pattern = cgPatternHint(horse);
  const observed = cgObservedGenotypeStatesForPattern(pattern,allHorses,'lp');
  if (observed.length) {
    return {
      states:observed,
      tested:false,
      source:`${pattern}: aus bisher beobachteten LP-Genotypen abgeleitet`,
    };
  }

  if (pattern || /\bappaloosa\b/i.test(String(horse?.coat_color||''))) {
    return {
      states:[['Lp','Lp'],['Lp','lp']],
      tested:false,
      source:'sichtbare Appaloosa-Scheckung: mindestens 1× Lp',
    };
  }
  return null;
}

function cgPatn1Knowledge(horse, allHorses = null) {
  const tested = cgTestedState(horse,'PATN1');
  if (tested) return tested;

  const pattern = cgPatternHint(horse);
  const observed = cgObservedGenotypeStatesForPattern(pattern,allHorses,'p1');
  if (observed.length) {
    return {
      states:observed,
      tested:false,
      source:`${pattern}: aus bisher beobachteten PATN1-Genotypen abgeleitet`,
    };
  }

  if (pattern) {
    return {
      states:[['P1','P1'],['P1','p1'],['p1','p1']],
      tested:false,
      source:`${pattern}: PATN1-Zustand noch nicht ausreichend beobachtet`,
    };
  }
  return null;
}

function cgLpChildCategory(pair) {
  const n=pair.filter(x=>x==='Lp').length;
  return n===2 ? 'LpLp' : n===1 ? 'Lplp' : 'lplp';
}

function cgPatn1ChildCategory(pair) {
  const n=pair.filter(x=>x==='P1').length;
  return n===0 ? 'p1p1' : 'P1_';
}

function cgAppaloosaEmpiricalModel(allHorses = null) {
  const model = new Map();

  for (const horse of cgAppaloosaReferenceHorses(allHorses)) {
    const pattern = cgPatternHint(horse);
    if (!pattern || pattern === 'anderes / unklar') continue;

    const tested = cgTestedAppaloosaCategories(horse);
    if (!tested.lp || !tested.p1) continue;

    const lpCategory = tested.lp === 'lplp' ? 'lplp' : tested.lp;
    const p1Category = tested.p1 === 'p1p1' ? 'p1p1' : 'P1_';
    const key = `${lpCategory}|${p1Category}`;

    if (!model.has(key)) model.set(key,{n:0,patterns:new Map()});
    const row=model.get(key);
    row.n++;
    row.patterns.set(pattern,(row.patterns.get(pattern)||0)+1);
  }

  return model;
}

function cgAppaloosaEmpiricalDistribution(model, lpCategory, p1Category) {
  if (lpCategory === 'lplp') {
    return {
      n:null,
      source:'genetisch ohne Lp',
      probabilities:new Map([['Keine Appaloosa-Scheckung',1]]),
    };
  }

  const key=`${lpCategory}|${p1Category}`;
  const row=model.get(key);
  if (row?.n) {
    return {
      n:row.n,
      source:'lokale MDR-Datenbank',
      probabilities:new Map([...row.patterns.entries()].map(([label,count])=>[label,count/row.n])),
    };
  }

  // Nur als Rückfall, wenn für eine künftig auftauchende Kombination noch
  // kein einziges reales Vergleichspferd vorhanden ist.
  if (p1Category === 'P1_') {
    return {
      n:0,
      source:'Guide-Fallback ohne Vergleichspferd',
      probabilities:new Map([[lpCategory==='LpLp' ? 'Few Spot' : 'Leopard',1]]),
    };
  }

  return {
    n:0,
    source:'noch keine empirische Musterbasis',
    probabilities:new Map([['Appaloosa-Muster noch nicht empirisch belegt',1]]),
  };
}

function cgAppaloosaGenotypeScenarioMap(lpA,lpB,p1A,p1B,model) {
  const lpCross=cgCrossPair(lpA,lpB);
  const p1Cross=cgCrossPair(p1A,p1B);
  const patterns=new Map();
  const genotypeKeys=new Map();

  for(const [lk,lpProb] of lpCross) {
    const lpCategory=cgLpChildCategory(cgPair(lk));
    for(const [pk,p1Prob] of p1Cross) {
      const p1Category=cgPatn1ChildCategory(cgPair(pk));
      const genotypeProb=lpProb*p1Prob;
      const key=`${lpCategory}|${p1Category}`;
      genotypeKeys.set(key,(genotypeKeys.get(key)||0)+genotypeProb);

      const dist=cgAppaloosaEmpiricalDistribution(model,lpCategory,p1Category);
      for(const [pattern,patternProb] of dist.probabilities) {
        patterns.set(pattern,(patterns.get(pattern)||0)+genotypeProb*patternProb);
      }
    }
  }

  return {patterns,genotypeKeys};
}

function cgAppaloosa(mare,stallion,allHorses = null) {
  const referenceHorses=cgAppaloosaReferenceHorses(allHorses);
  const model=cgAppaloosaEmpiricalModel(referenceHorses);

  const ml=cgLpKnowledge(mare,referenceHorses);
  const sl=cgLpKnowledge(stallion,referenceHorses);
  const mp=cgPatn1Knowledge(mare,referenceHorses);
  const sp=cgPatn1Knowledge(stallion,referenceHorses);

  if (!ml && !sl) {
    return {
      rows:null,lpRows:null,patternRows:null,exact:false,
      reason:'Bei keinem Elternteil ist Lp getestet oder aus sichtbarem Appaloosa-Phänotyp ableitbar.',
      empiricalBasis:[],
    };
  }

  // Unbekannt bleibt wirklich unbekannt. Das führt zu einer Spanne statt
  // zu einer stillen Annahme "Gen nicht vorhanden".
  const lpUnknown={states:[['lp','lp'],['Lp','lp'],['Lp','Lp']],source:'unbekannt'};
  const p1Unknown={states:[['p1','p1'],['P1','p1'],['P1','P1']],source:'unbekannt'};
  const L1=ml||lpUnknown,L2=sl||lpUnknown,P1=mp||p1Unknown,P2=sp||p1Unknown;

  const lpMaps=[];
  for(const a of L1.states) for(const b of L2.states) lpMaps.push(cgCrossPair(a,b));
  const lpDefs=[
    {label:'LpLp',pred:p=>cgLpChildCategory(p)==='LpLp'},
    {label:'Lplp',pred:p=>cgLpChildCategory(p)==='Lplp'},
    {label:'lplp',pred:p=>cgLpChildCategory(p)==='lplp'},
  ];
  const lpRows=lpDefs.map(x=>{
    const vals=lpMaps.map(map=>{
      let q=0; for(const [k,p] of map) if(x.pred(cgPair(k))) q+=p; return q;
    });
    return {label:x.label,min:Math.min(...vals),max:Math.max(...vals)};
  }).filter(r=>r.max>.00001);

  const p1Maps=[];
  for(const a of P1.states) for(const b of P2.states) p1Maps.push(cgCrossPair(a,b));
  const p1Defs=[
    {label:'P1_',pred:p=>p.includes('P1')},
    {label:'p1p1',pred:p=>!p.includes('P1')},
  ];
  const patternRows=p1Defs.map(x=>{
    const vals=p1Maps.map(map=>{
      let q=0; for(const [k,p] of map) if(x.pred(cgPair(k))) q+=p; return q;
    });
    return {label:x.label,min:Math.min(...vals),max:Math.max(...vals)};
  }).filter(r=>r.max>.00001);

  const scenarioMaps=[];
  for(const a of L1.states) for(const b of L2.states)
  for(const c of P1.states) for(const d of P2.states) {
    scenarioMaps.push(cgAppaloosaGenotypeScenarioMap(a,b,c,d,model));
  }

  const labels=[...new Set(scenarioMaps.flatMap(x=>[...x.patterns.keys()]))];
  const rows=labels.map(label=>{
    const vals=scenarioMaps.map(x=>x.patterns.get(label)||0);
    return {label,min:Math.min(...vals),max:Math.max(...vals)};
  })
  .filter(r=>r.max>.00001)
  .sort((a,b)=>
    (b.max-a.max) ||
    (b.min-a.min) ||
    (((b.min+b.max)/2)-((a.min+a.max)/2)) ||
    a.label.localeCompare(b.label,'de')
  );

  const empiricalBasis=[...model.entries()]
    .map(([key,row])=>({
      key,
      n:row.n,
      patterns:[...row.patterns.entries()]
        .sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0],'de'))
        .map(([label,count])=>({label,count,p:count/row.n})),
    }))
    .filter(row=>row.n>0)
    .sort((a,b)=>a.key.localeCompare(b.key,'de'));

  return {
    rows,lpRows,patternRows,
    exact:rows.every(r=>Math.abs(r.max-r.min)<1e-9),
    empiricalBasis,
    sources:{
      mareLp:cgSourceLabel(ml),
      stallionLp:cgSourceLabel(sl),
      marePat:cgSourceLabel(mp),
      stallionPat:cgSourceLabel(sp),
    }
  };
}

function cgAppaloosaWishScore(mare,stallion,wish,allHorses = null) {
  if (!wish || wish === 'any') return null;
  const normalized = wish === 'Blanket' ? 'Spotted Blanket' : wish === 'snowflake' ? 'Snowflake' : wish;
  const app=cgAppaloosa(mare,stallion,allHorses);
  if (!app.rows) return null;
  const row=app.rows.find(r=>r.label===normalized);
  // Ranking bleibt konservativ: Mindestwahrscheinlichkeit.
  return row ? row.min : 0;
}



// -------- Empirische Farbvererbung ------------------------------------
// Ergänzt die genetische Berechnung um das, was in der lokalen MDR-Datenbank
// bei echten Eltern–Fohlen-Kombinationen bisher tatsächlich beobachtet wurde.
// Die Rohhäufigkeiten ersetzen NICHT die Mendel-Logik; sie sind eine zweite
// Erfahrungs-Ebene und werden immer zusammen mit n angezeigt.

function cgEmpiricalNormalizeName(value) {
  return String(value || '').trim().toLocaleLowerCase('de').replace(/\s+/g,' ');
}

function cgEmpiricalUniqueHorses(allHorses = null) {
  const source = Array.isArray(allHorses) && allHorses.length
    ? allHorses
    : (Array.isArray(globalThis?.MDR_COLOR_EMPIRICAL_HORSES)
      ? globalThis.MDR_COLOR_EMPIRICAL_HORSES
      : []);

  const seen = new Set();
  const out = [];
  for (const horse of source) {
    const ancestors = horse?.pedigree?.ancestors || [];
    const parentKey = ancestors.slice(0,2).map(x => cgEmpiricalNormalizeName(x?.name)).join('|');
    const key = [
      String(horse?.external_id || ''),
      cgEmpiricalNormalizeName(horse?.name),
      parentKey,
      String(horse?.coat_color || '').trim().toLocaleLowerCase('de')
    ].join('||');

    // Referenz-Fohlen können technisch doppelt im Backup liegen. Für
    // empirische Prozentwerte darf dasselbe reale Fohlen nur einmal zählen.
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(horse);
  }
  return out;
}

function cgEmpiricalTrios(allHorses = null) {
  const horses = cgEmpiricalUniqueHorses(allHorses);
  const byName = new Map();

  for (const horse of horses) {
    const key = cgEmpiricalNormalizeName(horse?.name);
    if (key && !byName.has(key)) byName.set(key,horse);
  }

  const trios = [];
  for (const child of horses) {
    const ancestors = child?.pedigree?.ancestors || [];
    if (ancestors.length < 2) continue;

    const father = byName.get(cgEmpiricalNormalizeName(ancestors[0]?.name));
    const mother = byName.get(cgEmpiricalNormalizeName(ancestors[1]?.name));
    if (!father || !mother) continue;

    trios.push({ child, father, mother });
  }
  return trios;
}

function cgEmpiricalPairKey(a,b) {
  return [String(a ?? ''),String(b ?? '')]
    .sort((x,y)=>x.localeCompare(y,'de'))
    .join('|||');
}

function cgEmpiricalObservedDistribution(mare,stallion,trios,classifier) {
  const mareClass = classifier(mare);
  const stallionClass = classifier(stallion);
  if (!mareClass || !stallionClass) return null;

  const targetKey = cgEmpiricalPairKey(mareClass,stallionClass);
  const counts = new Map();
  let n = 0;

  for (const trio of trios) {
    const fatherClass = classifier(trio.father);
    const motherClass = classifier(trio.mother);
    const childClass = classifier(trio.child);
    if (!fatherClass || !motherClass || !childClass) continue;
    if (cgEmpiricalPairKey(fatherClass,motherClass) !== targetKey) continue;

    n++;
    counts.set(childClass,(counts.get(childClass)||0)+1);
  }

  if (!n) return { n:0,mareClass,stallionClass,rows:[] };

  const rows = [...counts.entries()]
    .map(([label,count])=>({ label,count,p:count/n }))
    .sort((a,b)=>b.p-a.p || b.count-a.count || a.label.localeCompare(b.label,'de'));

  return { n,mareClass,stallionClass,rows };
}

function cgEmpiricalResolvedBase(horse) {
  const extension = cgKnowledge(horse,'Extension');
  if (!extension?.states?.length) return null;

  if (extension.states.every(s => s.filter(x=>x==='e').length===2)) return 'Chestnut';

  const agouti = cgKnowledge(horse,'Agouti');
  if (!agouti?.states?.length) return null;

  const labels = new Set();
  for (const e of extension.states) for (const a of agouti.states) {
    labels.add(cgBaseName(e,a));
  }
  return labels.size === 1 ? [...labels][0] : null;
}

function cgEmpiricalCreamCategory(horse) {
  const knowledge = cgCreamKnowledge(horse);
  if (!knowledge?.states?.length) return null;

  const labels = new Set(knowledge.states.map(state=>{
    const cr = state.filter(x=>x==='Cr').length;
    const pl = state.filter(x=>x==='pl').length;

    if (cr===0 && pl===0) return 'kein Cream/Pearl';
    if (cr===1 && pl===0) return '1× Cream';
    if (cr===2 || (cr===1 && pl===1)) return 'doppelte Cream-Aufhellung';
    if (cr===0 && pl===1) return 'Pearl-Träger';
    if (cr===0 && pl===2) return 'sichtbares Pearl';
    return 'Cream/Pearl sonstig';
  }));

  return labels.size === 1 ? [...labels][0] : null;
}

function cgEmpiricalDominantCategory(horse,locus,allele,label) {
  const knowledge = cgKnowledge(horse,locus);
  if (!knowledge?.states?.length) return null;

  const present = knowledge.states.map(state=>state.includes(allele));
  if (present.every(Boolean)) return `${label} vorhanden`;
  if (present.every(x=>!x)) return `kein ${label}`;
  return null;
}

function cgEmpiricalKitCategory(horse,allele,label) {
  const knowledge = cgKitKnowledge(horse);
  if (!knowledge?.states?.length) return null;

  const present = knowledge.states.map(state=>state.includes(allele));
  if (present.every(Boolean)) return `${label} vorhanden`;
  if (present.every(x=>!x)) return `kein ${label}`;
  return null;
}

function cgEmpiricalVisibleTrait(horse,regex,label) {
  const coat = String(horse?.coat_color || '');
  return regex.test(coat) ? `${label} sichtbar` : `${label} nicht sichtbar`;
}

function cgEmpiricalExactCoat(horse) {
  const coat = String(horse?.coat_color || '').trim();
  return coat || null;
}

function cgEmpiricalSectionHtml(title,result,{ exact = false } = {}) {
  if (!result || !result.n || !result.rows?.length) return '';

  const basis = result.n < 3
    ? 'sehr kleine Datenbasis'
    : result.n < 8
      ? 'kleine Datenbasis'
      : 'wachsende Datenbasis';

  return `
    <div class="empirical-color-block">
      <div class="empirical-color-head">
        <strong>${cgEsc(title)}</strong>
        <span class="prediction-n">n=${result.n}</span>
      </div>
      <div class="tiny muted">
        Vergleichbare Eltern: ${cgEsc(result.mareClass)} × ${cgEsc(result.stallionClass)}
        · ${basis}${exact ? ' · exakter Fellfarben-Paarvergleich' : ''}
      </div>
      <div class="color-prob-grid empirical-color-grid">
        ${result.rows.map(row=>`
          <div class="color-prob-row">
            <span>${cgEsc(row.label)} <small>${row.count}/${result.n} beobachtet</small></span>
            <strong>${cgPct(row.p)}</strong>
          </div>`).join('')}
      </div>
    </div>`;
}

function cgEmpiricalColorInheritance(mare,stallion,allHorses = null) {
  const trios = cgEmpiricalTrios(allHorses);
  if (!trios.length) return { trios:0,sections:[] };

  const sections = [];
  // Empirische Genblöcke nur für Merkmale zeigen, die bei dieser konkreten
  // Verpaarung genetisch überhaupt eine Chance >0 haben. Damit tauchen
  // z.B. Dun/Sooty nicht als bloßes "100 % nicht sichtbar" auf.
  const possibleModifierLabels = new Set(
    cgModifierRows(mare,stallion)
      .filter(row=>Number(row.max ?? row.p ?? 0) > 1e-9)
      .map(row=>row.label)
  );

  const exact = cgEmpiricalObservedDistribution(
    mare,stallion,trios,cgEmpiricalExactCoat
  );
  if (exact?.n) {
    sections.push({
      title:'Komplette Fellfarbe – exakt gleiche elterliche Fellfarben',
      result:exact,
      exact:true,
    });
  }

  const base = cgEmpiricalObservedDistribution(
    mare,stallion,trios,cgEmpiricalResolvedBase
  );
  if (base?.n) sections.push({ title:'Grundfarbe',result:base });

  if ([...possibleModifierLabels].some(label=>/Cream|Pearl/i.test(label))) {
    const cream = cgEmpiricalObservedDistribution(
      mare,stallion,trios,cgEmpiricalCreamCategory
    );
    if (cream?.n) sections.push({ title:'Cream / Pearl',result:cream });
  }

  for (const [title,locus,allele,label] of [
    ['Dun','Dun','D','Dun'],
    ['Champagne','Champagne','Ch','Champagne'],
    ['Grey','Grey','G','Grey'],
    ['Silver','Silver','Z','Silver'],
    ['Overo','Overo','O','Overo'],
    ['Splashed White','Splashed','SPL','Splashed White'],
  ]) {
    if (!possibleModifierLabels.has(title)) continue;
    const classifier = horse => cgEmpiricalDominantCategory(horse,locus,allele,label);
    const result = cgEmpiricalObservedDistribution(mare,stallion,trios,classifier);
    if (result?.n) sections.push({ title,result });
  }

  for (const [title,allele,label] of [
    ['cKit: Tobiano','TO','Tobiano'],
    ['cKit: Sabino','SB','Sabino'],
    ['cKit: Roan','Rn','Roan'],
    ['cKit: Dominant White','WI','Dominant White'],
  ]) {
    if (!possibleModifierLabels.has(title)) continue;
    const classifier = horse => cgEmpiricalKitCategory(horse,allele,label);
    const result = cgEmpiricalObservedDistribution(mare,stallion,trios,classifier);
    if (result?.n) sections.push({ title,result });
  }

  for (const [title,regex,label] of [
    ['Sooty (sichtbar)',/\bsooty\b/i,'Sooty'],
    ['Pangare (sichtbar)',/\bpangar[eé]\b/i,'Pangare'],
    ['Rabicano (sichtbar)',/\brabicano\b/i,'Rabicano'],
    ['Flaxen (sichtbar)',/\bflaxen\b/i,'Flaxen'],
  ]) {
    const modifierLabel = title.replace(' (sichtbar)','');
    if (!possibleModifierLabels.has(modifierLabel) && !possibleModifierLabels.has(title)) continue;
    const classifier = horse => cgEmpiricalVisibleTrait(horse,regex,label);
    const result = cgEmpiricalObservedDistribution(mare,stallion,trios,classifier);
    if (result?.n) sections.push({ title,result });
  }

  return { trios:trios.length,sections };
}

function cgEmpiricalColorHtml(mare,stallion,allHorses = null) {
  const empirical = cgEmpiricalColorInheritance(mare,stallion,allHorses);
  if (!empirical.trios) {
    return '<p class="small muted">Noch keine auswertbaren Eltern–Fohlen-Farbvergleiche vorhanden.</p>';
  }

  if (!empirical.sections.length) {
    return `
      <p class="small muted">
        In der Datenbank gibt es bereits ${empirical.trios} echte Eltern–Fohlen-Farbvergleiche,
        aber für genau die aktuell bekannten Farbzustände dieser beiden Eltern noch keine
        vergleichbare Gruppe. Die genetische Berechnung oben bleibt davon unberührt.
      </p>`;
  }

  return `
    <p class="small">
      Zusätzlich zur genetischen Berechnung zeigt diese Ebene, was bei <strong>vergleichbaren echten
      Eltern–Fohlen-Kombinationen</strong> bisher tatsächlich aufgetreten ist.
      Prozentwerte sind Rohhäufigkeiten und werden deshalb immer zusammen mit <strong>n</strong> angezeigt.
    </p>
    <p class="tiny muted">
      0-%-Ergebnisse werden nicht aufgeführt. Kleine n sind ausdrücklich noch keine feste Vererbungsregel.
      Bei „komplette Fellfarbe“ werden nur exakt gleiche elterliche Fellfarben verglichen; bei den
      Genblöcken werden passende bekannte Gen-/Phänotypzustände verglichen.
    </p>
    <div class="empirical-color-list">
      ${empirical.sections.map(section=>
        cgEmpiricalSectionHtml(section.title,section.result,{exact:section.exact})
      ).join('')}
    </div>
    <p class="tiny muted">Aktuell auswertbare Eltern–Fohlen-Trios für Farbe: ${empirical.trios}.</p>`;
}


// -------- Darstellung / weitere Gene ---------------------------------
function cgRows(rows) {
  if (!rows?.length) return '<p class="small muted">Nicht vorhersehbar.</p>';

  const normalized = rows.map(r => ({
    ...r,
    _min:Number(r.min ?? r.p ?? 0),
    _max:Number(r.max ?? r.p ?? 0),
  }));
  const uncertain = normalized.filter(r => Math.abs(r._max-r._min) >= 1e-9);

  // Bei einer unsicheren Verteilung nicht mehrere theoretische Min-Max-
  // Möglichkeiten auflisten. Nur sicher berechenbare positive Anteile
  // zeigen und den unbekannten Rest kompakt kennzeichnen.
  if (uncertain.length) {
    const exactPositive = normalized.filter(r =>
      Math.abs(r._max-r._min) < 1e-9 && r._min > 1e-9
    );
    const parts = exactPositive.map(r =>
      `<div class="color-prob-row"><span>${cgEsc(r.label)}</span><strong>${cgPct(r._min)}</strong></div>`
    );
    parts.push('<div class="color-prob-row"><span>Verteilung</span><strong>nicht vorhersehbar</strong></div>');
    return `<div class="color-prob-grid">${parts.join('')}</div>`;
  }

  return `<div class="color-prob-grid">${normalized
    .filter(r => r._max > 1e-9)
    .map(r => `<div class="color-prob-row"><span>${cgEsc(r.label)}</span><strong>${cgPct(r._min)}</strong></div>`)
    .join('')}</div>`;
}

function cgEvidenceText(mare,stallion,locus) {
  const a=cgKnowledge(mare,locus), b=cgKnowledge(stallion,locus);
  return [a?`${cgEsc(mare?.name||'Stute')}: ${cgEsc(a.source)}`:null,b?`${cgEsc(stallion?.name||'Hengst')}: ${cgEsc(b.source)}`:null]
    .filter(Boolean).join(' · ');
}

function cgCreamModifierRows(mare,stallion) {
  const mk=cgCreamKnowledge(mare), sk=cgCreamKnowledge(stallion);
  if (!mk && !sk) return [];

  const unknown={
    states:[['cr','cr'],['Cr','cr'],['Cr','Cr'],['pl','cr'],['pl','pl'],['Cr','pl']],
    source:'unbekannt'
  };
  const crosses=cgAllCrosses(mk||unknown,sk||unknown);
  const defs=[
    {label:'mindestens 1× Cream (Cr)',pred:p=>p.includes('Cr')},
    {label:'doppelte Cream-Aufhellung (CrCr oder Cr/pl)',pred:p=>cgCreamState(p)==='double'},
    {label:'einfaches Pearl / Pearl-Träger (pl/cr)',pred:p=>cgCount(p,'pl')===1 && cgCount(p,'Cr')===0},
    {label:'sichtbares Pearl (plpl)',pred:p=>cgCreamState(p)==='pearl'},
  ];
  return defs.map(def=>{
    const range=cgProbabilityRange(crosses,def.pred);
    return range?{label:def.label,...range}:null;
  }).filter(Boolean);
}

function cgSummaryGeneKnowledge(horse, locus, { recessiveVisible = false } = {}) {
  if (typeof presentGenesSummary !== 'function') return null;
  const entries = presentGenesSummary(
    horse?.colors, horse?.coat_color, horse?.notes, horse?.name,
    null, horse?.color_gene_overrides
  ).filter(g => g.locus === locus);
  if (!entries.length) return null;

  const combined = entries.map(e => String(e.alleles || '')).join(' ');
  const source = entries.map(e => e.source).filter(Boolean).join('/') || 'bekannt';

  if (recessiveVisible) {
    if (/flfl/i.test(combined)) {
      return { states:[['fl','fl']], source:`${source}: flfl` };
    }
    if (/\bfl\b/i.test(combined) || /fl/i.test(combined)) {
      return { states:[['fl','F']], source:`${source}: mindestens Träger fl` };
    }
    return null;
  }

  // Für diese nicht bzw. nicht vollständig testbaren dominanten Merkmale
  // beweist der sichtbare/abgeleitete Eintrag mindestens eine Kopie.
  return {
    states:[['X','x'],['X','X']],
    source:`${source}: mindestens 1× vorhanden`,
  };
}

function cgSummaryDominantRange(mare,stallion,locus,label) {
  const mk=cgSummaryGeneKnowledge(mare,locus), sk=cgSummaryGeneKnowledge(stallion,locus);
  if(!mk&&!sk) return null;
  const unknown={states:[['x','x'],['X','x'],['X','X']],source:'unbekannt'};
  const crosses=cgAllCrosses(mk||unknown,sk||unknown);
  const range=cgProbabilityRange(crosses,pair=>pair.includes('X'));
  return range ? {
    label,...range,
    source:[mk?`${mare?.name||'Stute'}: ${mk.source}`:null,sk?`${stallion?.name||'Hengst'}: ${sk.source}`:null].filter(Boolean).join(' · ')
  } : null;
}

function cgFlaxenRange(mare,stallion) {
  const mk=cgSummaryGeneKnowledge(mare,'Flaxen',{recessiveVisible:true});
  const sk=cgSummaryGeneKnowledge(stallion,'Flaxen',{recessiveVisible:true});
  if(!mk&&!sk) return null;
  // Unbekannt bedeutet bei einem rezessiven Merkmal genetisch: F/F, F/fl
  // oder fl/fl möglich. Deshalb wird eine Spanne statt "nicht vorhanden"
  // angenommen.
  const unknown={states:[['F','F'],['F','fl'],['fl','fl']],source:'unbekannt'};
  const crosses=cgAllCrosses(mk||unknown,sk||unknown);
  const range=cgProbabilityRange(crosses,pair=>pair.filter(x=>x==='fl').length===2);
  return range ? {
    label:'Flaxen sichtbar (flfl)',...range,
    source:[mk?`${mare?.name||'Stute'}: ${mk.source}`:null,sk?`${stallion?.name||'Hengst'}: ${sk.source}`:null].filter(Boolean).join(' · ')
  } : null;
}

function cgModifierRows(mare,stallion) {
  const rows=[];
  for(const [label,locus,allele,absent] of [
    ['Dun','Dun','D','d'],
    ['Champagne','Champagne','Ch','ch'],
    ['Grey','Grey','G','g'],
    ['Silver','Silver','Z','z'],
    ['Overo','Overo','O','o'],
    ['Splashed White','Splashed','SPL','spl'],
  ]) {
    const range=cgDominantRange(mare,stallion,locus,allele,absent);
    if (!range) continue;
    rows.push({label,...range,source:cgEvidenceText(mare,stallion,locus)});
  }

  for(const row of cgCreamModifierRows(mare,stallion)) {
    row.source=[cgCreamKnowledge(mare)?`${mare?.name||'Stute'}: ${cgCreamKnowledge(mare).source}`:null,cgCreamKnowledge(stallion)?`${stallion?.name||'Hengst'}: ${cgCreamKnowledge(stallion).source}`:null].filter(Boolean).join(' · ');
    rows.push(row);
  }

  // cKit: Nur Varianten anzeigen, die bei mindestens einem Elternteil
  // getestet oder aus der Fellfarbe ableitbar sind. Andere cKit-Varianten
  // werden nicht als theoretische Möglichkeiten eingeblendet.
  const kitM=cgKitKnowledge(mare), kitS=cgKitKnowledge(stallion);
  const kitEvidence = new Set([
    ...cgKitEvidenceAlleles(mare),
    ...cgKitEvidenceAlleles(stallion),
  ]);
  const kitLabels = {TO:'Tobiano',SB:'Sabino',Rn:'Roan',WI:'Dominant White'};
  for (const allele of ['TO','SB','Rn','WI']) {
    if (!kitEvidence.has(allele)) continue;
    const range=cgKitAlleleRange(mare,stallion,allele);
    if (range) rows.push({
      label:kitLabels[allele],
      ...range,
      source:[kitM?`${mare?.name||'Stute'}: ${kitM.source}`:null,kitS?`${stallion?.name||'Hengst'}: ${kitS.source}`:null].filter(Boolean).join(' · ')
    });
  }

  // Weitere MDR-Farbgene nur, wenn bei mindestens einem Elternteil ein
  // getesteter/manuell bestätigter oder phänotypisch abgeleiteter Hinweis
  // existiert. Kein "unbekannt"-Katalog mehr.
  for (const [locus,label] of [
    ['Pangare','Pangare'],
    ['Sooty','Sooty'],
    ['Rabicano','Rabicano'],
  ]) {
    const row=cgSummaryDominantRange(mare,stallion,locus,label);
    if(row) rows.push(row);
  }
  const flaxen=cgFlaxenRange(mare,stallion);
  if(flaxen) rows.push(flaxen);

  return rows;
}

function cgModifierHtml(rows) {
  // V52: 0%-Möglichkeiten nicht mehr als unnötige Zeile anzeigen.
  const visibleRows = (rows || []).filter(r => Number(r.max ?? r.p ?? 0) > 1e-9);
  if (!visibleRows.length) return '<p class="small muted">Keine weiteren Farbgene sicher vorhersehbar.</p>';
  return `<div class="color-prob-grid">${visibleRows.map(r=>`
    <div class="color-prob-row color-prob-row-with-source">
      <span>${cgEsc(r.label)}<small>${cgEsc(r.source||'')}</small></span>
      <strong>${cgRangeText(r.min,r.max)}</strong>
    </div>`).join('')}</div>`;
}

function cgLethalWarnings(mare,stallion) {
  const warnings=[];
  const overoM=cgKnowledge(mare,'Overo'),overoS=cgKnowledge(stallion,'Overo');
  const hasO=k=>k?.states?.some(g=>g.includes('O'));
  if(hasO(overoM)&&hasO(overoS)) {
    warnings.push('⚠️ Overo × Overo: Ein OO-Fohlen ist laut MDR-Farbguide letal. Diese Verpaarung bitte besonders prüfen.');
  }

  const kitM=cgKitKnowledge(mare),kitS=cgKitKnowledge(stallion);
  const hasWI=k=>k?.states?.some(g=>g.includes('WI'));
  if(hasWI(kitM)&&hasWI(kitS)) {
    warnings.push('⚠️ Dominant White × Dominant White: WW kann entstehen und ist laut MDR-Farbguide letal.');
  }
  return warnings;
}

function cgShade(horse) {
  const coat=String(horse?.coat_color||'');
  for(const [base,scale] of Object.entries(CG_SHADE_SCALES)) {
    // längste Namen zuerst, damit "Dark Liver Chestnut" nicht als
    // bloßes "Chestnut" endet.
    const ordered=[...scale].sort((a,b)=>b.length-a.length);
    const shade=ordered.find(x=>coat.toLowerCase().includes(x.toLowerCase()));
    if(shade) return {base,shade,index:scale.indexOf(shade),scale};
  }
  return null;
}

function cgShadeHtml(mare,stallion) {
  const a=cgShade(mare),b=cgShade(stallion);
  const parents=[
    a?`${cgEsc(mare?.name||'Stute')}: ${cgEsc(a.shade)}`:`${cgEsc(mare?.name||'Stute')}: keine Grundfarben-Schattierung erkannt`,
    b?`${cgEsc(stallion?.name||'Hengst')}: ${cgEsc(b.shade)}`:`${cgEsc(stallion?.name||'Hengst')}: keine Grundfarben-Schattierung erkannt`
  ].join(' · ');
  let scale='';
  if(a&&b&&a.base===b.base) {
    scale=`<br><span class="tiny">Skala ${cgEsc(a.base)} (hell → dunkel): ${a.scale.map((x,i)=>(i===a.index||i===b.index)?`<strong>${cgEsc(x)}</strong>`:cgEsc(x)).join(' → ')}</span>`;
  }
  return `<p class="small">${parents}${scale}</p>
    <p class="tiny muted">Keine Prozentzahl: Die genaue MDR-Genetik der Farbschattierungen ist nicht veröffentlicht.</p>`;
}

function cgKnowledgeDisplayAlleles(horse, locus, knowledge) {
  const row = cgRow(horse,locus);
  if (row && !cgUntested(row.value)) return String(row.value);
  const states = knowledge?.states || [];
  if (!states.length) return '';
  const keys = [...new Set(states.map(s => s.join('')))];
  if (keys.length === 1) return keys[0];

  if (locus === 'Extension') {
    if (states.every(s => s.includes('E'))) return 'E_';
    if (states.every(s => s[0] === 'e' && s[1] === 'e')) return 'ee';
  }
  if (locus === 'Agouti') {
    if (states.every(s => s[0] === 'a0' && s[1] === 'a0')) return 'a0a0';
    for (const a of ['Ap','A1','At']) if (states.every(s => s.includes(a))) return `${a}_`;
  }
  if (locus === 'Cream') {
    if (states.every(s => s.includes('Cr'))) return 'Cr_';
    if (states.every(s => s[0] === 'pl' && s[1] === 'pl')) return 'plpl';
  }
  const dominant = {Dun:'D',Champagne:'Ch',Grey:'G',Silver:'Z',Overo:'O',Splashed:'SPL'}[locus];
  if (dominant && states.every(s => s.includes(dominant))) return `${dominant}_`;
  return keys.join('/');
}

function cgHorseGeneticsSummary(horse) {
  if (!horse) return '–';
  const bits=[];
  const used=new Set();
  for (const locus of ['Extension','Agouti','Cream','Dun','Champagne','Grey','Silver']) {
    const k=cgKnowledge(horse,locus);
    if (!k) continue;
    const alleles=cgKnowledgeDisplayAlleles(horse,locus,k);
    if (!alleles) continue;
    const source=k.tested ? 'getestet' : 'aus Fellfarbe abgeleitet';
    bits.push(`${locus}: ${alleles} (${source})`);
    used.add(locus);
  }

  const lp=cgLpKnowledge(horse);
  if (lp) {
    const row=cgRow(horse,'Appaloosa');
    const alleles=row && !cgUntested(row.value)
      ? String(row.value)
      : (lp.states?.length===1 && lp.states[0].filter(x=>x==='Lp').length===2 ? 'LpLp' : 'Lp_');
    bits.push(`Appaloosa: ${alleles} (${lp.tested ? 'getestet' : 'aus Phänotyp abgeleitet'})`);
    used.add('Appaloosa');
  }

  const pat1=cgRow(horse,'PATN1');
  if (pat1 && !cgUntested(pat1.value)) {
    bits.push(`PATN1: ${pat1.value} (getestet)`);
    used.add('PATN1');
  }

  const pattern=cgPatternHint(horse);
  if (pattern) bits.push(`Muster: ${pattern} (sichtbar/abgeleitet)`);

  // Übrige Gene (Tobiano, Sabino, Roan, Overo, Flaxen...) weiterhin aus
  // der gemeinsamen MDR-Genetik-Zusammenfassung ergänzen.
  if (typeof presentGenesSummary === 'function') {
    for (const g of presentGenesSummary(horse.colors,horse.coat_color,horse.notes,horse.name,null,horse.color_gene_overrides) || []) {
      if (used.has(g.locus)) continue;
      bits.push(`${g.locus}: ${g.alleles} (${g.source === 'getestet' ? 'getestet' : 'abgeleitet'})`);
      used.add(g.locus);
    }
  }
  return bits.length ? bits.join(' · ') : '–';
}

function cgKnowledgeSummaryHtml(mare,stallion) {
  const loci=['Extension','Agouti','Cream','Dun','Champagne','Grey','Silver'];
  const rows=[];
  for(const locus of loci) {
    const a=cgKnowledge(mare,locus),b=cgKnowledge(stallion,locus);
    if(!a&&!b) continue;
    rows.push(`<tr><th>${cgEsc(locus)}</th><td>${cgEsc(a?.source||'unbekannt')}</td><td>${cgEsc(b?.source||'unbekannt')}</td></tr>`);
  }
  if(!rows.length) return '';
  return `<details class="color-source-details"><summary>🔎 Welche Geninformationen wurden verwendet?</summary>
    <table class="detail-table"><thead><tr><th>Genort</th><th>${cgEsc(mare?.name||'Stute')}</th><th>${cgEsc(stallion?.name||'Hengst')}</th></tr></thead><tbody>${rows.join('')}</tbody></table>
  </details>`;
}

function colorGuideHtml(mare,stallion,allHorses = null) {
  if(!mare||!stallion) return '';

  const base=cgBaseColors(mare,stallion);
  const core=cgCoreColors(mare,stallion);
  const mods=cgModifierRows(mare,stallion);
  const app=cgAppaloosa(mare,stallion,allHorses);
  const warnings=cgLethalWarnings(mare,stallion);

  let appHtml='';
  if(app.rows) {
    appHtml=`
      <h5>1. LP</h5>${cgRows(app.lpRows)}
      <h5>2. PATN1</h5>${cgRows(app.patternRows)}
      <h5>3. Muster</h5>${cgRows(app.rows)}
      <p class="tiny muted">
        LP und PATN1 werden genetisch vererbt. Das sichtbare Muster wird anschließend aus Pferden
        mit <strong>getestetem LP + getestetem PATN1 + eingetragenem sichtbaren Muster</strong> geschätzt.
        PATN2 ist laut MDR-Farbguide ein internes Pattern, wird hier aber nicht als getesteter Zustand angenommen, weil kein separater PATN2-Gentest vorliegt.
      </p>
      ${app.empiricalBasis?.length ? `
        <details class="appaloosa-empirical-basis">
          <summary>Aktuelle Appaloosa-Datenbasis</summary>
          <div class="small">
            ${app.empiricalBasis.map(row=>`
              <div><strong>${cgEsc(row.key.replace('|',' + '))}</strong> · n=${row.n}:
                ${row.patterns.map(p=>`${cgEsc(p.label)} ${cgPct(p.p)}`).join(' · ')}
              </div>`).join('')}
          </div>
        </details>` : ''}
      <p class="tiny muted">
        Stute LP: ${cgEsc(app.sources?.mareLp||'unbekannt')} · PATN1: ${cgEsc(app.sources?.marePat||'unbekannt')}<br>
        Hengst LP: ${cgEsc(app.sources?.stallionLp||'unbekannt')} · PATN1: ${cgEsc(app.sources?.stallionPat||'unbekannt')}
      </p>`;
  } else {
    appHtml=`<p class="small muted">Appaloosa: nicht vorhersehbar. ${cgEsc(app.reason||'')}</p>`;
  }

  return `
  <details class="color-guide-result">
    <summary><strong>Farbguide für dieses Fohlen</strong></summary>
    <div class="color-guide-body">
      ${warnings.length ? `<div class="notice notice-warning">${warnings.map(cgEsc).join('<br>')}</div>` : ''}

      <section class="color-guide-subsection">
        <h4>Grundfarben</h4>
        ${base
          ? cgRows(base)
          : '<p class="small muted">Grundfarbe: nicht vorhersehbar (Extension/Agouti unbekannt).</p>'}
      </section>

      <section class="color-guide-subsection">
        <h4>Grundfarbe + Cream / Pearl / Dun / Champagne</h4>
        ${core
          ? cgRows(core)
          : '<p class="small muted">Endfarbe: nicht vorhersehbar (mindestens ein Genort unbekannt).</p>'}
      </section>

      <section class="color-guide-subsection">
        <h4>Weitere Farbgene – nur getestet oder aus Fellfarbe ableitbar</h4>
        ${cgModifierHtml(mods)}
        ${(cgKitKnowledge(mare)||cgKitKnowledge(stallion))
          ? '<p class="tiny muted"><strong>cKit:</strong> Es werden nur getestete oder aus der Fellfarbe ableitbare Varianten angezeigt.</p>'
          : ''}
      </section>

      <section class="color-guide-subsection">
        <h4>Bisherige Farbvererbung</h4>
        ${cgEmpiricalColorHtml(mare,stallion,allHorses)}
      </section>

      <section class="color-guide-subsection">
        <h4>Appaloosa-Muster</h4>
        ${[mare,stallion].some(h => cgPatternHint(h))
          ? `<p class="small"><strong>Sichtbare Elternmuster:</strong> ${[mare,stallion].filter(h=>cgPatternHint(h)).map(h=>`${cgEsc(h.name||'Pferd')}: ${cgEsc(cgPatternHint(h))} (abgeleitet)`).join(' · ')}</p>`
          : ''}
        ${appHtml}
      </section>

      ${cgKnowledgeSummaryHtml(mare,stallion)}
      <p class="tiny muted">
        „Aus Fellfarbe abgeleitet“ bedeutet Phänotyp, nicht Gentest.
        Prozentwerte erscheinen nur bei eindeutiger Berechnung; sonst „nicht vorhersehbar“.
      </p>
    </div>
  </details>`;
}
