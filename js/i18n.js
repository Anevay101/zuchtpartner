// MDR V54.0.75 – leichter bilingualer UI-Kern.
// Die große EN-Wortliste wird auf deutschen Seiten nicht mehr geladen.
(() => {
  'use strict';

  const STORAGE_KEY = 'mdr-ui-language-v1';
  const SUPPORTED = new Set(['de', 'en']);
  let lang = (() => {
    try {
      const stored = String(localStorage.getItem(STORAGE_KEY) || '').toLowerCase();
      return SUPPORTED.has(stored) ? stored : 'de';
    } catch { return 'de'; }
  })();

  let EN = {};
  let ATTR_EN = {};
  let DYNAMIC_EN = [];
  let STATIC_REPLACEMENTS = [];
  const TRANSLATION_CACHE_LIMIT = 2048;
  const exactDynamicCache = new Map();
  const staticFallbackCache = new Map();
  const attributeCache = new Map();

  function installEnglishData(data) {
    EN = data?.EN || {};
    ATTR_EN = data?.ATTR_EN || {};
    DYNAMIC_EN = data?.DYNAMIC_EN || [];
    STATIC_REPLACEMENTS = data?.STATIC_REPLACEMENTS || [];
    exactDynamicCache?.clear?.();
    staticFallbackCache?.clear?.();
    attributeCache?.clear?.();
    return data;
  }

  function loadEnglishData() {
    if (lang !== 'en') return Promise.resolve(null);
    if (window.MDR_I18N_EN_DATA) return Promise.resolve(installEnglishData(window.MDR_I18N_EN_DATA));
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-mdr-i18n-en]');
      if (existing) {
        existing.addEventListener('load', () => resolve(installEnglishData(window.MDR_I18N_EN_DATA)), { once:true });
        existing.addEventListener('error', reject, { once:true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'js/i18n-en.js?v=5483';
      script.async = true;
      script.dataset.mdrI18nEn = '1';
      script.addEventListener('load', () => resolve(installEnglishData(window.MDR_I18N_EN_DATA)), { once:true });
      script.addEventListener('error', () => reject(new Error('i18n-en.js konnte nicht geladen werden.')), { once:true });
      (document.head || document.documentElement).appendChild(script);
    });
  }

  const englishDataReady = loadEnglishData();

  // Dynamic components cache translated fragments; cache storage is initialized above before lazy EN loading starts.
  function cachedTranslation(cache, raw, compute) {
    const key = String(raw ?? '');
    if (cache.has(key)) return cache.get(key);
    const value = compute(key);
    if (cache.size >= TRANSLATION_CACHE_LIMIT) cache.clear();
    cache.set(key, value);
    return value;
  }

  function translateExactOrDynamic(raw) {
    return cachedTranslation(exactDynamicCache, raw, (original) => {
      const leading = original.match(/^\s*/)?.[0] || '';
      const trailing = original.match(/\s*$/)?.[0] || '';
      const text = original.trim();
      if (!text) return original;
      if (EN[text] != null) return leading + EN[text] + trailing;
      for (const [re, replacement] of DYNAMIC_EN) {
        if (re.test(text)) return leading + text.replace(re, replacement) + trailing;
      }
      return original;
    });
  }

  function translateStaticFallback(raw) {
    return cachedTranslation(staticFallbackCache, raw, (original) => {
      let out = translateExactOrDynamic(original);
      if (out !== original) return out;
      const leading = original.match(/^\s*/)?.[0] || '';
      const trailing = original.match(/\s*$/)?.[0] || '';
      let text = original.trim();
      if (!text) return original;
      let changed = false;
      for (const [de,en] of STATIC_REPLACEMENTS) {
        if (text.includes(de)) { text = text.split(de).join(en); changed = true; }
      }
      return changed ? leading + text + trailing : original;
    });
  }

  function translateAttributeValue(value) {
    return cachedTranslation(attributeCache, value, (original) => {
      const exact = ATTR_EN[original] || EN[original];
      if (exact != null) return exact;
      return translateExactOrDynamic(original);
    });
  }

  function protectedNode(node) {
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    if (!el) return false;
    return !!el.closest('textarea,input,[contenteditable="true"],[data-i18n-skip],.mdr-account-name');
  }

  function translateNode(node, staticPass=false) {
    if (lang !== 'en' || !node || protectedNode(node)) return;
    if (node.nodeType === Node.TEXT_NODE) {
      let next = staticPass ? translateStaticFallback(node.nodeValue) : translateExactOrDynamic(node.nodeValue);
      // Dynamic UI copy often arrives as small text fragments around <strong>
      // values. Apply the broader phrase fallback only in clear UI elements;
      // never in generic table/data cells or editable/user-content elements.
      if (!staticPass && next === node.nodeValue) {
        const el = node.parentElement;
        const tag = el?.tagName || '';
        const uiTag = /^(BUTTON|LABEL|OPTION|SUMMARY|TH|H1|H2|H3|H4|H5|H6)$/.test(tag);
        const uiClass = !!el?.matches?.('.muted,.error,.notice,.tiny,.small,.flash-banner,.status,.hint,.modal-actions,.filter-group-summary-note,.dashboard-tile-caption,.tp-zs-model-status,.tp-zs-current-formula');
        if (uiTag || uiClass) next = translateStaticFallback(node.nodeValue);
      }
      if (next !== node.nodeValue) node.nodeValue = next;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node;
    for (const attr of ['title','placeholder','aria-label','data-label']) {
      if (!el.hasAttribute(attr)) continue;
      const before = el.getAttribute(attr);
      const after = translateAttributeValue(before);
      if (after !== before) el.setAttribute(attr, after);
    }
    for (const child of [...el.childNodes]) translateNode(child, staticPass);
  }

  function installObserver() {
    if (!document.documentElement || lang !== 'en') return;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          translateNode(mutation.target, false);
          continue;
        }
        for (const node of mutation.addedNodes) translateNode(node, false);
      }
    });
    observer.observe(document.documentElement, {
      subtree:true, childList:true, attributes:true,
      attributeFilter:['title','placeholder','aria-label','data-label']
    });
  }

  function setLanguage(next) {
    next = String(next || '').toLowerCase();
    if (!SUPPORTED.has(next)) return;
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    if (next !== lang) location.reload();
  }

  function createSwitcher() {
    if (document.getElementById('mdr-language-switch')) return;
    const wrap = document.createElement('div');
    wrap.id = 'mdr-language-switch';
    wrap.className = 'mdr-language-switch';
    wrap.setAttribute('data-i18n-skip','');
    wrap.setAttribute('role','group');
    wrap.setAttribute('aria-label', lang === 'en' ? 'Language' : 'Sprache');
    wrap.innerHTML = `
      <span class="mdr-language-label">${lang === 'en' ? 'Language' : 'Sprache'}</span>
      <button type="button" class="mdr-language-btn${lang==='de'?' active':''}" data-lang="de" aria-pressed="${lang==='de'}">DE</button>
      <button type="button" class="mdr-language-btn${lang==='en'?' active':''}" data-lang="en" aria-pressed="${lang==='en'}">EN</button>`;
    wrap.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-lang]');
      if (btn) setLanguage(btn.dataset.lang);
    });
    const topbar = document.querySelector('.topbar');
    const loginCard = document.querySelector('.mdr-login-card');
    if (topbar) {
      let tools = topbar.querySelector('.mdr-topbar-tools');
      if (!tools) {
        tools = document.createElement('div');
        tools.className = 'mdr-topbar-tools';
        topbar.appendChild(tools);
      }
      tools.appendChild(wrap);
    } else if (loginCard) loginCard.prepend(wrap);
    else document.body.prepend(wrap);
  }

  function translateDocument() {
    document.documentElement.lang = lang;
    if (lang === 'en') {
      document.title = translateStaticFallback(document.title);
      translateNode(document.body, true);
    }
    createSwitcher();
  }

  // Native dialogs are outside the DOM, so translate them explicitly.
  const nativeAlert = window.alert.bind(window);
  const nativeConfirm = window.confirm.bind(window);
  const nativePrompt = window.prompt.bind(window);
  window.alert = (message) => nativeAlert(lang === 'en' ? translateStaticFallback(String(message ?? '')) : message);
  window.confirm = (message) => nativeConfirm(lang === 'en' ? translateStaticFallback(String(message ?? '')) : message);
  window.prompt = (message, defaultValue) => nativePrompt(lang === 'en' ? translateStaticFallback(String(message ?? '')) : message, defaultValue);

  window.MDR_I18N = {
    get language(){ return lang; },
    setLanguage,
    t(text){ return lang === 'en' ? translateExactOrDynamic(text) : String(text ?? ''); },
    translateElement(el){ translateNode(el, false); },
    get translations(){ return EN; },
    get ready(){ return englishDataReady; },
  };
  window.mdrT = (text) => window.MDR_I18N.t(text);

  function onDomReady() {
    document.documentElement.lang = lang;
    createSwitcher();
    if (lang === 'en') {
      englishDataReady.then(() => {
        translateDocument();
        installObserver();
      }).catch((error) => console.warn('Englische Übersetzungen konnten nicht geladen werden:', error));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onDomReady, { once:true });
  else onDomReady();
})();
