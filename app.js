// SpesaSmart: weekly meal planner with price comparison.
// Italy mode: Pam vs Il Gigante (prices.json). Germany mode: Edeka vs Rewe (prices-de.json), UI in German.
// Prices are checked by hand against the shops' public pages and can be edited in the Prices tab.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const app = $('#app');

  // ---------- country ----------
  // Internal store "slots" are always 'pam' (first store) and 'gig' (second store); each country maps them to real shops.
  const CC = (function () { try { return JSON.parse(localStorage.getItem('ss.settings') || '{}').country === 'de' ? 'de' : 'it'; } catch (e) { return 'it'; } })();
  const DE_ON = CC === 'de';
  const D = (en, de) => (DE_ON ? de : en);
  const COUNTRY = DE_ON
    ? { file: 'prices-de.json', keys: { pam: 'ede', gig: 'rew' }, stores: { pam: 'Edeka', gig: 'Rewe' }, minOrder: {}, blu: false, ns: 'de.' }
    : { file: 'prices.json', keys: { pam: 'pam', gig: 'gig' }, stores: { pam: 'Pam', gig: 'Il Gigante' }, minOrder: { pam: 29.9, gig: 25 }, blu: true, ns: '' };
  const STORES = COUNTRY.stores;
  const MIN_ORDER = COUNTRY.minOrder; // from public store pages; online orders only
  const DAYS = DE_ON ? ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const PROTEIN_MIN = 25; // grams per serving for "high protein" (approximate)
  const FAST_MAX = 25; // "fast" = strictly under 25 minutes
  const CATS = ['Fruit & veg', 'Meat & fish', 'Dairy & eggs', 'Pasta & rice', 'Bakery', 'Pantry'];
  const ITEMS = {};
  RAW_ITEMS.forEach((r) => {
    ITEMS[r[0]] = { id: r[0], name: r[1], en: r[2], cat: r[3], pack: r[4], unit: r[5], pam: r[6], gig: r[7], staple: !!r[8], packs: { pam: r[4], gig: r[4] }, prod: {}, ver: { pam: false, gig: false }, brand: null };
  });
  const RECIPE = {};
  RECIPES.forEach((r) => (RECIPE[r.id] = r));
  const proteinOf = (r) => r.ing.reduce((a, [iid, q]) => a + (ITEMS[iid].unit === 'pc' ? q * (PROT[iid] || 0) : (q * (PROT[iid] || 0)) / 100), 0);
  RECIPES.forEach((r) => { r.prot = proteinOf(r); });
  // display names (German mode shows German ingredient/recipe names; the Italian original becomes the subtitle)
  const iname = (it) => (DE_ON ? ITEM_DE[it.id] || it.name : it.name);
  const rname = (r) => (DE_ON ? (RECIPE_DE[r.id] || {}).n || r.name : r.name);
  const rsub = (r) => (DE_ON ? r.name : r.en);
  const rsteps = (r) => (DE_ON ? (RECIPE_DE[r.id] || {}).s || r.steps : r.steps);
  const catName = (c) => (DE_ON ? CAT_DE[c] || c : c);
  const ul = (u) => (DE_ON && u === 'pc' ? 'Stk.' : u);

  // ---------- persistence ----------
  const NSKEYS = ['prices', 'plan', 'options', 'checks', 'seen']; // kept separately per country (Italy keeps the original keys)
  const nk = (k) => 'ss.' + (NSKEYS.includes(k) ? COUNTRY.ns : '') + k;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(nk(k)); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(nk(k), JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  let settings = Object.assign({ country: 'it', budget: 60, people: 2, dinners: 7, filters: { veg: false, protein: false, fast: false }, mode: 'mix', pantry: true, theme: 'system', blu: false, brandAll: false, listView: 'store', hideTicked: false, wake: false, planInput: 'buttons', accent: 'green', notify: false }, store.get('settings', {}));
  if (settings.diet === 'veg') settings.filters = Object.assign({}, settings.filters, { veg: true });
  delete settings.diet;
  settings.filters = Object.assign({ veg: false, protein: false, fast: false }, settings.filters);
  // Keeps only known items and sane prices, so a bad backup (or old stored data) can't turn totals into NaN or break the Prices tab.
  function cleanOverrides(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const out = {};
    Object.keys(o).forEach((id) => {
      const x = o[id];
      if (!ITEMS[id] || !x || typeof x !== 'object') return;
      const e = {};
      ['pam', 'gig', 'blu'].forEach((k) => { const v = x[k]; if (typeof v === 'number' && isFinite(v) && v > 0 && v <= 999) e[k] = Math.round(v * 100) / 100; });
      if (!Object.keys(e).length) return;
      if (typeof x.since === 'string') e.since = x.since;
      out[id] = e;
    });
    return out;
  }
  let overrides = cleanOverrides(store.get('prices', {})) || {}; // {id:{pam,gig,blu}} edits apply to the store-brand tier
  let plan = store.get('plan', null); // {ids:[...], brand:[ids using name brand], items:{itemId:'brand'|'store'}}
  if (plan) { plan.ids = (plan.ids || []).filter((id) => RECIPE[id]); if (!plan.ids.length) plan = null; }
  if (plan && !plan.brand) plan.brand = [];
  if (plan && !plan.items) plan.items = {};
  let options = store.get('options', null);
  let checks = store.get('checks', {});
  const save = () => { store.set('settings', settings); store.set('prices', overrides); store.set('plan', plan); store.set('options', options); store.set('checks', checks); };

  const ACCENTS = { green: [D('Green (original)', 'Grün (Original)'), '#1f8a5b'], blue: [D('Dark blue', 'Dunkelblau'), '#1e3a8a'], orange: [D('Orange', 'Orange'), '#d9480f'], purple: [D('Purple', 'Lila'), '#6d28d9'], rose: [D('Rose', 'Rosé'), '#be185d'] };
  function applyTheme() {
    const r = document.documentElement;
    if (settings.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', settings.theme);
    if (!ACCENTS[settings.accent] || settings.accent === 'green') r.removeAttribute('data-accent'); else r.setAttribute('data-accent', settings.accent);
    const m = document.querySelector('meta[name=theme-color]');
    const dark = settings.theme === 'dark' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    const cs = getComputedStyle(r);
    if (m) m.content = (cs.getPropertyValue(dark ? '--bg' : '--acc') || (dark ? '#121714' : '#1f8a5b')).trim();
  }
  applyTheme();
  // "Automatic" follows the phone's light/dark switch while the app is open (the CSS does; the browser bar colour needs this)
  (function () { const mq = matchMedia('(prefers-color-scheme: dark)'); const f = () => { if (settings.theme === 'system') applyTheme(); }; if (mq.addEventListener) mq.addEventListener('change', f); else if (mq.addListener) mq.addListener(f); })();
  if (DE_ON) {
    document.documentElement.lang = 'de';
    const tabs = { plan: 'Plan', meals: 'Gerichte', list: 'Liste', prices: 'Preise', settings: 'Einstellungen' };
    document.querySelectorAll('#tabs a').forEach((a) => { const n = a.childNodes[a.childNodes.length - 1]; if (n && n.nodeType === 3) n.textContent = tabs[a.dataset.tab] || n.textContent; });
    const back = $('#back'); if (back) back.textContent = '‹ Zurück';
  }

  // ---------- prices ----------
  const BLU_ON = () => COUNTRY.blu && settings.blu;
  const bluOf = (id) => (overrides[id] && overrides[id].blu != null ? overrides[id].blu : ITEMS[id].blu);
  const price = (id, s) => { // store-brand tier price per pack
    const o = overrides[id] || {};
    const reg = o[s] != null ? o[s] : ITEMS[id][s];
    if (s === 'gig' && BLU_ON()) { const b = bluOf(id); if (b != null && b < reg) return b; }
    return reg;
  };
  // The value a Prices-tab field shows: your edit, else the shop price. The Blu Card field falls back to the regular Il Gigante price.
  function fieldPrice(id, k) {
    const o = overrides[id] || {};
    if (k !== 'blu') return o[k] != null ? o[k] : ITEMS[id][k];
    const g = fieldPrice(id, 'gig'); const b = ITEMS[id].blu;
    return o.blu != null ? o.blu : b != null && b < g ? b : g;
  }
  const packOf = (id, st) => ITEMS[id].packs[st];
  const isVer = (iid, st) => ITEMS[iid].ver[st] || !!(overrides[iid] && overrides[iid][st] != null);
  // Which stores may supply this item: a real brand product if one exists, and a checked price beats an unchecked estimate.
  function storesFor(iid, tier, mode) {
    const cand = mode === 'mix' ? ['pam', 'gig'] : [mode];
    if (tier === 'brand') { const wb = cand.filter((st) => ITEMS[iid].brand && ITEMS[iid].brand[st]); if (wb.length) return wb; }
    const v = cand.filter((st) => isVer(iid, st));
    return v.length && v.length < cand.length ? v : cand;
  }
  const hasBrand = (iid) => !!(ITEMS[iid].brand && (ITEMS[iid].brand.pam || ITEMS[iid].brand.gig));
  // One purchasable offer for an item at a store in a tier ('store' or 'brand'). Falls back to the store tier if no brand product is known there.
  function offer(iid, st, tier) {
    const it = ITEMS[iid];
    if (tier === 'brand' && it.brand && it.brand[st]) {
      const b = it.brand[st];
      let p = b.price; let blu = false;
      if (st === 'gig' && BLU_ON() && b.blu != null && b.blu < p) { p = b.blu; blu = true; }
      return { price: p, pack: b.pack, product: b.product, brand: true, blu };
    }
    const p = price(iid, st);
    const reg = (overrides[iid] && overrides[iid][st] != null) ? overrides[iid][st] : it[st];
    return { price: p, pack: packOf(iid, st), product: it.prod[st] || '', brand: false, blu: p < reg - 1e-9 };
  }
  let priceMeta = { updated: null, ver: { pam: 0, gig: 0 }, where: {}, blu: null, brandItems: 0 };
  function loadPrices() {
    const K = COUNTRY.keys;
    return fetch(COUNTRY.file, { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      const ver = { pam: 0, gig: 0 }; let brandItems = 0;
      Object.keys(j.items || {}).forEach((id) => {
        if (!ITEMS[id]) return;
        ['pam', 'gig'].forEach((slot) => {
          const x = j.items[id][K[slot]];
          if (!x) return;
          ITEMS[id][slot] = x.price; ITEMS[id].packs[slot] = x.pack; ITEMS[id].prod[slot] = x.product; ITEMS[id].ver[slot] = true; ver[slot]++;
        });
        if (COUNTRY.blu && j.items[id].blu != null) ITEMS[id].blu = j.items[id].blu;
        const b = j.items[id].brand;
        if (b) {
          const nb = {};
          ['pam', 'gig'].forEach((slot) => { if (b[K[slot]]) nb[slot] = b[K[slot]]; });
          if (nb.pam || nb.gig) { ITEMS[id].brand = nb; brandItems++; }
        }
        ITEMS[id].date = j.updated;
      });
      // An unchecked store gets the checked store's price as its estimate, so an estimate can never undercut a real price.
      Object.keys(ITEMS).forEach((id) => {
        const it = ITEMS[id];
        [['pam', 'gig'], ['gig', 'pam']].forEach(([ok, other]) => { if (it.ver[ok] && !it.ver[other]) { it[other] = it[ok]; it.packs[other] = it.packs[ok]; } });
      });
      const w = j.where || {};
      priceMeta = { updated: j.updated || null, ver, where: { pam: w[K.pam] || '', gig: w[K.gig] || '' }, blu: COUNTRY.blu ? j.blu || null : null, rule: j.rule || null, brandItems };
      priceMeta.last = j.last_update || null;
      checkUpdateNotice();
      let pruned = 0;
      Object.keys(overrides).forEach((id) => { const o = overrides[id]; if (o && o.since && priceMeta.updated && o.since < priceMeta.updated) { delete overrides[id]; pruned++; } });
      if (pruned) { save(); setTimeout(() => toast(D(pruned + ' of your price edits were replaced by newer shop prices', pruned + ' deiner Preis-Änderungen wurden durch neuere Ladenpreise ersetzt')), 600); }
    }).catch(() => {});
  }

  // ---------- price-update notices ----------
  // The price file carries last_update {at, changed}. When a newer one appears we show a banner, and (if allowed) a system notification.
  let pendingNotice = null;
  function noticeText(l) {
    return D(l.changed + ' price' + (l.changed === 1 ? '' : 's') + ' changed' + (l.note ? ': ' + l.note : '.'), l.changed + (l.changed === 1 ? ' Preis' : ' Preise') + ' geändert' + (l.note ? ': ' + l.note : '.'));
  }
  function checkUpdateNotice() {
    const l = priceMeta.last;
    if (!l || !l.at || !(l.changed > 0)) return;
    const seen = store.get('seen', null);
    if (seen === null) { store.set('seen', l.at); return; } // first visit: nothing to announce
    if (l.at > seen) {
      pendingNotice = l;
      if (settings.notify && 'Notification' in window && Notification.permission === 'granted') showSystemNotice(l);
    }
  }
  function showSystemNotice(l, force) {
    const title = D('SpesaSmart: prices updated', 'SpesaSmart: Preise aktualisiert');
    const opts = { body: noticeText(l), icon: 'icon-192.png', tag: 'prices-' + (force ? 'test' : l.at) };
    const direct = () => { try { new Notification(title, opts); } catch (e) { /* unsupported */ } };
    // getRegistration (not .ready, which never settles when no service worker is registered, e.g. over plain http)
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then((reg) => (reg ? reg.showNotification(title, opts) : direct())).catch(direct);
    else direct();
  }
  const noticeBanner = () => (pendingNotice ? `<div class="card" style="border-color:var(--acc)"><div class="row"><div><b>🔔 ${D('Prices updated', 'Preise aktualisiert')}</b><div class="mute small">${esc(noticeText(pendingNotice))}</div></div><button class="chip on" data-dismissnotice="1">OK</button></div></div>` : '');
  const eur = (n) => '€' + n.toFixed(2).replace('.', ',');
  const sgn = (n) => (n >= 0 ? '+' : '−') + eur(Math.abs(n));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- costing ----------
  const defaultTier = (rid) => (settings.brandAll || (plan && plan.brand && plan.brand.includes(rid)) ? 'brand' : 'store');
  const allStore = () => 'store';
  const allBrand = () => 'brand';
  // Tier for one ingredient of one meal: a per-product choice wins, then the meal/plan choice. Pure comparisons (allStore/allBrand) ignore per-product choices.
  function effTier(rid, iid, tierFn) {
    if (!hasBrand(iid)) return 'store';
    if (tierFn !== allStore && tierFn !== allBrand && plan && plan.items && plan.items[iid]) return plan.items[iid];
    return tierFn(rid) === 'brand' ? 'brand' : 'store';
  }
  // Builds the shopping basket: one line per (item, tier), store chosen per mode, whole packs.
  // 'mix' is always the cheapest of: mixing stores, only the first store, only the second store (so "cheapest mix" is never beaten by a single store).
  function basket(ids, mode, tierFn) {
    const mix = basketCore(ids, mode, tierFn);
    if (mode !== 'mix') return mix;
    return ['pam', 'gig'].reduce((best, st) => { const b = basketCore(ids, st, tierFn); return b.total < best.total - 1e-9 ? b : best; }, mix);
  }
  function basketCore(ids, mode, tierFn) {
    tierFn = tierFn || defaultTier;
    const m = {};
    ids.forEach((rid) => RECIPE[rid].ing.forEach(([iid, q]) => {
      if (settings.pantry && ITEMS[iid].staple) return;
      const tier = effTier(rid, iid, tierFn);
      const e = m[iid + '|' + tier] || (m[iid + '|' + tier] = { iid, tier, qty: 0, meals: [] });
      e.qty += q * settings.people;
      if (!e.meals.includes(rid)) e.meals.push(rid);
    }));
    const lines = Object.keys(m).map((k) => {
      const e = m[k]; let best = null;
      storesFor(e.iid, e.tier, mode).forEach((st) => {
        const o = offer(e.iid, st, e.tier);
        const packs = Math.max(1, Math.ceil(e.qty / o.pack - 1e-9));
        const total = packs * o.price;
        if (!best || total < best.total - 1e-9) best = { st, o, packs, total };
      });
      return { key: e.iid + ':' + e.tier, k, iid: e.iid, tier: e.tier, qty: e.qty, meals: e.meals, store: best.st, packs: best.packs, pack: best.o.pack, unit: best.o.price, total: best.total, product: best.o.product, brand: best.o.brand, blu: best.o.blu };
    });
    return { lines, total: lines.reduce((a, l) => a + l.total, 0) };
  }
  const totalFor = (ids, mode, tierFn) => basket(ids, mode, tierFn).total;
  function servingCost(r, tier) { // pro-rated (no pack rounding), cheapest store per unit
    return r.ing.reduce((a, [iid, q]) => {
      if (settings.pantry && ITEMS[iid].staple) return a;
      const t = tier === 'brand' && hasBrand(iid) ? 'brand' : 'store';
      const u = (st) => { const o = offer(iid, st, t); return o.price / o.pack; };
      return a + q * Math.min.apply(null, storesFor(iid, t, 'mix').map(u));
    }, 0);
  }
  const hasBrandIn = (iid) => (settings.mode === 'mix' ? hasBrand(iid) : !!(ITEMS[iid].brand && ITEMS[iid].brand[settings.mode]));
  const recipeHasBrand = (r) => r.ing.some(([iid]) => hasBrandIn(iid) && !(settings.pantry && ITEMS[iid].staple));
  const BR = () => D('Name brand', 'Marke');

  // Per-meal name-brand toggle button (shows the extra cost for that meal). Used in the week view and the shopping list.
  function brandBtn(id, cost) {
    const r = RECIPE[id];
    if (!recipeHasBrand(r)) return '';
    if (settings.brandAll) return `<span class="badge g">★ ${D('brand', 'Marke')}</span>`;
    const isB = plan.brand.includes(id);
    const alt = totalFor(plan.ids, settings.mode, (rid) => (rid === id ? (isB ? 'store' : 'brand') : defaultTier(rid))) - cost;
    return `<button class="chip${isB ? ' on' : ''}" data-brandmeal="${id}" style="padding:6px 10px;font-size:13px">${isB ? '★' : '☆'} ${BR()} ${sgn(isB ? -alt : alt)}</button>`;
  }

  // Per-product name-brand toggle for a shopping-list line (applies to every meal that uses the item).
  function itemBtn(iid, tier, cost) {
    if (!hasBrandIn(iid)) return '';
    const to = tier === 'brand' ? 'store' : 'brand';
    const had = plan.items[iid];
    plan.items[iid] = to;
    const alt = totalFor(plan.ids, settings.mode) - cost;
    if (had === undefined) delete plan.items[iid]; else plan.items[iid] = had;
    return `<button class="chip${tier === 'brand' ? ' on' : ''}" data-branditem="${iid}" data-to="${to}" style="padding:5px 10px;font-size:12px">${tier === 'brand' ? '★ ' + BR() + ' ' + sgn(-alt) : '☆ ' + BR() + ' ' + sgn(alt)}</button>`;
  }

  // ---------- planner ----------
  const matches = (r, f) => (!f.veg || r.veg) && (!f.protein || r.prot >= PROTEIN_MIN) && (!f.fast || r.min < FAST_MAX);
  const eligible = () => RECIPES.filter((r) => matches(r, settings.filters)).map((r) => r.id);
  const filterLabel = () => ['veg', 'protein', 'fast'].filter((k) => settings.filters[k]).map((k) => ({ veg: D('vegetarian', 'vegetarisch'), protein: D('high protein', 'proteinreich'), fast: D('under 25 min', 'unter 25 Min.') }[k])).join(' + ');
  function variety(ids) { return new Set(ids.map((i) => RECIPE[i].grp)).size; }
  function generate() {
    const pool = eligible();
    const n = Math.min(settings.dinners, pool.length);
    const filtered = settings.filters.veg || settings.filters.protein || settings.filters.fast;
    const cap = !filtered ? Math.max(2, Math.ceil(n / 2.5)) : Math.max(3, Math.ceil(n / 2));
    const tierFn = settings.brandAll ? allBrand : allStore;
    const cands = [];
    const tryCombos = (useCap) => {
      const seen = new Set();
      for (let t = 0; t < 4000; t++) {
        const a = pool.slice();
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
        const ids = a.slice(0, n);
        if (useCap) {
          const counts = {};
          ids.forEach((i) => { const g = RECIPE[i].grp; counts[g] = (counts[g] || 0) + 1; });
          if (Math.max.apply(null, Object.values(counts)) > cap) continue;
        }
        const key = ids.slice().sort().join();
        if (seen.has(key)) continue;
        seen.add(key);
        cands.push({ ids, cost: totalFor(ids, settings.mode, tierFn), v: variety(ids) });
        if (pool.length <= n) break; // only one possible set
      }
    };
    tryCombos(pool.length > n);
    if (!cands.length) tryCombos(false); // relax the variety cap if it rules everything out
    if (!cands.length) return null;
    const under = cands.filter((c) => c.cost <= settings.budget);
    const base = under.length ? under : cands;
    const used = new Set();
    const take = (label, blurb, sorter) => {
      const c = base.slice().sort(sorter).find((x) => !used.has(x.ids.join()));
      if (!c) return null;
      used.add(c.ids.join());
      return { label, blurb, ids: c.ids };
    };
    const opts = [
      take(D('Cheapest', 'Günstigster'), D('Lowest total for the week', 'Niedrigste Summe für die Woche'), (a, b) => a.cost - b.cost),
      take(D('Most varied', 'Abwechslungsreichster'), D('Most different protein sources', 'Meiste verschiedene Eiweißquellen'), (a, b) => b.v - a.v || a.cost - b.cost),
      take(D('Balanced', 'Ausgewogen'), D('Good variety, kind to the budget', 'Gute Abwechslung, schonend fürs Budget'), (a, b) => (b.v - b.cost / settings.budget * 3) - (a.v - a.cost / settings.budget * 3)),
    ].filter(Boolean);
    return { opts, fits: under.length > 0, minCost: Math.min.apply(null, cands.map((c) => c.cost)), poolSize: pool.length, wanted: settings.dinners, at: Date.now() };
  }

  // ---------- UI helpers ----------
  const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 1800); };
  const sheet = (html) => { const s = $('#sheet'); s.innerHTML = '<div class="in">' + html + '</div>'; s.hidden = false; };
  const closeSheet = () => { $('#sheet').hidden = true; };
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
  const chips = (name, opts, cur) => '<div class="chips">' + opts.map(([v, l]) => `<button class="chip${String(cur) === String(v) ? ' on' : ''}" data-set="${name}" data-v="${v}">${l}</button>`).join('') + '</div>';
  const multi = (attr, opts, cur) => '<div class="chips">' + opts.map(([v, l]) => `<button class="chip${cur[v] ? ' on' : ''}" data-${attr}="${v}">${l}</button>`).join('') + '</div>';
  const CTRL = { budget: D('budget', 'Budget'), people: D('people', 'Personen'), dinners: D('dinners', 'Abendessen') }; // screen-reader names
  const stepper = (name, v, label, step) => `<div class="stepper"><button data-step="${name}" data-d="-${step}" aria-label="${D('Decrease', 'Verringern:')} ${CTRL[name]}">−</button><b>${label}</b><button data-step="${name}" data-d="${step}" aria-label="${D('Increase', 'Erhöhen:')} ${CTRL[name]}">+</button></div>`;
  const SLIDER = { budget: [10, 250, 5], people: [1, 8, 1], dinners: [1, 7, 1] };
  const slider = (name, v, label) => {
    const [mn, mx, st] = SLIDER[name];
    return `<div class="sl"><div class="slv" id="slv-${name}">${label}</div><input type="range" aria-label="${CTRL[name]}" data-slider="${name}" min="${mn}" max="${Math.max(mx, v)}" step="${st}" value="${v}"></div>`;
  };
  // Plan-tab number control: buttons (+/−) or a slider, chosen in Settings.
  const control = (name, v, label, step) => (settings.planInput === 'sliders' ? slider(name, v, label) : stepper(name, v, label, step));
  const disclaimer = () => (priceMeta.updated
    ? `<div class="notice">${D('Prices checked by hand on', 'Preise von Hand geprüft am')} <b>${esc(priceMeta.updated)}</b> ${D('(regular shelf prices, no promos). They are refreshed automatically every Wednesday and Sunday. Unchecked items are estimates.', '(normale Regalpreise, ohne Aktionen). Sie werden automatisch jeden Mittwoch und Sonntag aktualisiert. Nicht geprüfte Artikel sind Schätzungen.')}</div>`
    : `<div class="notice">${D('Prices are <b>estimates</b>, not live shelf prices. Edit them in the Prices tab.', 'Preise sind <b>Schätzungen</b>, keine aktuellen Regalpreise. Du kannst sie im Tab Preise ändern.')}</div>`);
  const protBadge = (r) => `<span class="badge${r.prot >= PROTEIN_MIN ? ' g' : ''}">≈${Math.round(r.prot)} g ${D('protein', 'Eiweiß')}</span>`;
  const timeBadge = (r) => `<span class="badge${r.min < FAST_MAX ? ' g' : ''}">${r.min} ${D('min', 'Min.')}</span>`;
  const modeName = () => ({ mix: D('cheapest mix', 'günstigster Mix'), pam: STORES.pam, gig: STORES.gig }[settings.mode]);
  const modeChips = (long) => [['mix', long ? D('Cheapest mix', 'Günstigster Mix') : 'Mix'], ['pam', long ? D(STORES.pam + ' only', 'Nur ' + STORES.pam) : STORES.pam], ['gig', long ? D(STORES.gig + ' only', 'Nur ' + STORES.gig) : STORES.gig]];

  // ---------- views ----------
  function viewPlan() {
    setHead('SpesaSmart', false);
    const cur = plan ? `<div class="card"><div class="row"><div><h3>${D('Current plan', 'Aktueller Plan')}</h3><div class="mute">${plan.ids.length} ${D('dinners', 'Abendessen')} · ${eur(totalFor(plan.ids, settings.mode))}</div></div><a class="chip on" href="#/week">${D('Open', 'Öffnen')}</a></div></div>` : '';
    const n = eligible().length;
    app.innerHTML = cur + `<div class="card">
      <h2>${D('Plan my week', 'Woche planen')}</h2>
      <label class="f">${D('Weekly budget', 'Wochenbudget')}</label>${control('budget', settings.budget, eur(settings.budget).replace(',00', ''), 5)}
      <label class="f">${D('People', 'Personen')}</label>${control('people', settings.people, settings.people, 1)}
      <label class="f">${D('Dinners to plan', 'Abendessen planen')}</label>${control('dinners', settings.dinners, settings.dinners, 1)}
      <label class="f">${D('Diet & goals', 'Ernährung & Ziele')} <span class="mute small">${D('(combine freely)', '(frei kombinierbar)')}</span></label>${multi('filter', [['veg', '🌱 ' + D('Vegetarian', 'Vegetarisch')], ['protein', '💪 ' + D('High protein', 'Proteinreich')], ['fast', '⚡ ' + D('Fast (&lt;25 min)', 'Schnell (&lt;25 Min.)')]], settings.filters)}
      <div class="mute small" style="margin-top:6px">${D(`${n} of ${RECIPES.length} meals match`, `${n} von ${RECIPES.length} Gerichten passen`)}${n < settings.dinners ? ` <b class="over-t">${D(`(fewer than the ${settings.dinners} dinners you asked for)`, `(weniger als die ${settings.dinners} gewünschten Abendessen)`)}</b>` : ''}. ${D(`High protein = about ${PROTEIN_MIN} g or more per serving (approximate, from typical nutrition values).`, `Proteinreich = etwa ${PROTEIN_MIN} g oder mehr pro Portion (Näherung aus üblichen Nährwerten).`)}</div>
      <label class="f">${D('Products', 'Produkte')}</label>${chips('brandAll', [['false', D('Store brand', 'Eigenmarke')], ['true', BR()]], String(settings.brandAll))}
      <div class="mute small" style="margin-top:6px">${D('You can also pick name brand for single meals later, with the price difference shown.', 'Marke kannst du später auch für einzelne Gerichte wählen, mit Preisunterschied.')}</div>
      <label class="f">${D('Where do you shop?', 'Wo kaufst du ein?')}</label>${chips('mode', modeChips(true), settings.mode)}
      <label class="f">${D('Pantry', 'Vorrat')}</label>${chips('pantry', [['true', D('I have oil & salt', 'Öl & Salz habe ich')], ['false', D('Buy them too', 'Auch kaufen')]], String(settings.pantry))}
      <button class="btn" id="go">${D('Show meal options', 'Vorschläge zeigen')}</button></div>` + disclaimer();
  }

  function planCard(o, i) {
    const t = {}; ['mix', 'pam', 'gig'].forEach((m) => (t[m] = totalFor(o.ids, m, settings.brandAll ? allBrand : allStore)));
    const cost = t[settings.mode];
    const over = cost > settings.budget;
    const other = totalFor(o.ids, settings.mode, settings.brandAll ? allStore : allBrand);
    const meals = o.ids.map((id) => rname(RECIPE[id])).join(' · ');
    const avgProt = o.ids.reduce((a, id) => a + RECIPE[id].prot, 0) / o.ids.length;
    return `<div class="card"><div class="row"><h3>${esc(o.label)}</h3><span class="badge ${over ? 'w' : 'g'}">${over ? D('over budget', 'über Budget') : D('fits budget', 'im Budget')}</span></div>
      <div class="big ${over ? 'over-t' : ''}">${eur(cost)} <span class="mute small">${D('of', 'von')} ${eur(settings.budget)} · ${settings.brandAll ? BR() : D('store brand', 'Eigenmarke')}</span></div>
      <div class="mute small">${esc(o.blurb)} · ${eur(cost / settings.people / o.ids.length)} ${D('per serving', 'pro Portion')} · ≈${Math.round(avgProt)} g ${D('protein avg', 'Eiweiß Ø')}</div>
      <div class="mute small">${settings.brandAll ? D('Store brand instead', 'Stattdessen Eigenmarke') : D('Name brand instead', 'Stattdessen Marke')}: <b>${eur(other)}</b> (${sgn(other - cost)})</div>
      <p class="small">${esc(meals)}</p>
      <div class="tot"><div class="${t.mix <= t.pam && t.mix <= t.gig ? 'best' : ''}"><b>${eur(t.mix)}</b><span>${D('Cheapest mix', 'Günstigster Mix')}</span></div><div><b>${eur(t.pam)}</b><span>${STORES.pam}</span></div><div><b>${eur(t.gig)}</b><span>${STORES.gig}</span></div></div>
      <button class="btn" data-pick="${i}">${D('Use this plan', 'Diesen Plan nutzen')}</button></div>`;
  }

  function viewOptions() {
    setHead(D('Meal options', 'Vorschläge'), true, '#/plan');
    if (!options || !options.opts.length) { app.innerHTML = `<div class="card">${D('No plans yet.', 'Noch keine Pläne.')} <a href="#/plan">${D('Set up your week', 'Woche einrichten')}</a>.</div>`; return; }
    const few = options.poolSize < options.wanted ? `<div class="notice">${D(`Only ${options.poolSize} meals match ${esc(filterLabel())}, so these plans have ${options.poolSize} dinners.`, `Nur ${options.poolSize} Gerichte passen zu ${esc(filterLabel())}, daher haben diese Pläne ${options.poolSize} Abendessen.`)}</div>` : '';
    const warn = options.fits ? '' : `<div class="notice">${D(`No plan fits ${eur(settings.budget)} with these settings. The cheapest we found is ${eur(options.minCost)}. Raise the budget, plan fewer dinners${settings.brandAll ? ' or switch to store brand' : ''}.`, `Kein Plan passt mit diesen Einstellungen zu ${eur(settings.budget)}. Der günstigste liegt bei ${eur(options.minCost)}. Erhöhe das Budget, plane weniger Abendessen${settings.brandAll ? ' oder wechsle zu Eigenmarke' : ''}.`)}</div>`;
    app.innerHTML = few + warn + options.opts.map(planCard).join('') + `<button class="btn sec" id="regen">${D('Try different combinations', 'Andere Kombinationen probieren')}</button>` + disclaimer();
  }

  function viewWeek() {
    setHead(D('Your week', 'Deine Woche'), true, '#/plan');
    if (!plan) { app.innerHTML = `<div class="card">${D('No plan yet.', 'Noch kein Plan.')} <a href="#/plan">${D('Set up your week', 'Woche einrichten')}</a>.</div>`; return; }
    const cost = totalFor(plan.ids, settings.mode);
    const pct = Math.min(100, (cost / settings.budget) * 100);
    const over = cost > settings.budget;
    const cs = totalFor(plan.ids, settings.mode, allStore); const cb = totalFor(plan.ids, settings.mode, allBrand);
    const nBrand = settings.brandAll ? plan.ids.length : plan.brand.filter((id) => plan.ids.includes(id)).length;
    app.innerHTML = `<div class="card"><div class="row"><b>${D('Basket', 'Warenkorb')} (${esc(modeName())})</b><b class="${over ? 'over-t' : 'ok-t'}">${eur(cost)} / ${eur(settings.budget)}</b></div>
      <div class="bar ${over ? 'over' : ''}"><i style="width:${pct}%"></i></div>
      <div class="mute small">${over ? eur(cost - settings.budget) + ' ' + D('over budget', 'über Budget') : eur(settings.budget - cost) + ' ' + D('left', 'übrig')} · ${settings.people} ${D('people', 'Personen')} · ${D(`${nBrand} of ${plan.ids.length} meals name brand`, `${nBrand} von ${plan.ids.length} Gerichten als Marke`)}</div>
      <a class="btn" style="text-decoration:none;text-align:center" href="#/list">${D('Open shopping list', 'Einkaufsliste öffnen')}</a></div>
      <div class="card"><h3>${D('Store brand vs name brand', 'Eigenmarke vs. Marke')}</h3>
      <div class="tot" style="grid-template-columns:repeat(2,1fr)"><div class="${!settings.brandAll && !nBrand ? 'best' : ''}"><b>${eur(cs)}</b><span>${D('All store brand', 'Alles Eigenmarke')}</span></div><div class="${settings.brandAll ? 'best' : ''}"><b>${eur(cb)}</b><span>${D('All name brand', 'Alles Marke')}</span></div></div>
      <div class="mute small" style="margin-top:8px">${D('Name brand for everything costs', 'Marke für alles kostet')} ${sgn(cb - cs)}. ${priceMeta.brandItems ? D(priceMeta.brandItems + ' items have a name-brand option (pasta, tomato, tuna, dairy, legumes and more); the rest stay the same.', priceMeta.brandItems + ' Artikel haben eine Markenoption (Nudeln, Tomaten, Thunfisch, Milchprodukte, Hülsenfrüchte u. a.); der Rest bleibt gleich.') : ''}</div>
      <div style="margin-top:10px">${chips('brandAll', [['false', D('Store brand', 'Eigenmarke')], ['true', D('Name brand for all', 'Marke für alle')]], String(settings.brandAll))}</div>
      ${settings.brandAll ? '' : `<div class="mute small" style="margin-top:8px">${D('Or tap ☆ on single meals below.', 'Oder tippe unten auf ☆ bei einzelnen Gerichten.')}</div>`}</div>
      <div class="card">` + plan.ids.map((id, i) => {
        const r = RECIPE[id];
        const isB = settings.brandAll || plan.brand.includes(id);
        const btn = brandBtn(id, cost);
        return `<div class="meal"><div class="d">${DAYS[i]}</div><div class="t"><a href="#/recipe/${id}" style="color:inherit;text-decoration:none"><b>${esc(rname(r))}</b></a><span class="mute small">${r.min} ${D('min', 'Min.')} · ≈${eur(servingCost(r, isB ? 'brand' : 'store'))}/${D('serving', 'Portion')} · ≈${Math.round(r.prot)} g ${D('protein', 'Eiweiß')} ${r.veg ? '· 🌱' : ''}</span></div><div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">${btn}<button class="sw" data-swap="${i}">${D('Swap', 'Tauschen')}</button></div></div>`;
      }).join('') + '</div>' + disclaimer();
  }

  function viewRecipe(id) {
    const r = RECIPE[id];
    setHead(D('Recipe', 'Rezept'), true, lastPage || (plan ? '#/week' : '#/plan'));
    if (!r) { app.innerHTML = `<div class="card">${D('Recipe not found.', 'Rezept nicht gefunden.')}</div>`; return; }
    const d = servingCost(r, 'brand') - servingCost(r, 'store');
    app.innerHTML = `<div class="card"><h2>${esc(rname(r))}</h2><div class="mute">${esc(rsub(r))}</div>
      <p>${r.veg ? `<span class="badge g">${D('vegetarian', 'vegetarisch')}</span>` : ''}${timeBadge(r)}${protBadge(r)}<span class="badge">≈${eur(servingCost(r, 'store'))} / ${D('serving', 'Portion')}</span>${recipeHasBrand(r) ? `<span class="badge">${BR().toLowerCase()} ${sgn(d)}/${D('serving', 'Portion')}</span>` : ''}</p>
      <h3>${D(`Ingredients for ${settings.people}`, `Zutaten für ${settings.people}`)}</h3><ul>${r.ing.map(([iid, q]) => {
        const it = ITEMS[iid]; const n = q * settings.people;
        return `<li>${esc(iname(it))}: ${Math.round(n * 10) / 10} ${ul(it.unit)}${it.staple ? ` <span class="mute">(${D('pantry', 'Vorrat')})</span>` : ''}</li>`;
      }).join('')}</ul>
      <h3>${D('Method', 'Zubereitung')}</h3><ol>${rsteps(r).map((s) => '<li>' + esc(s) + '</li>').join('')}</ol></div>`;
  }

  // Interactive shopping list: tick items one by one in the store, by store/aisle or by meal.
  let curCost = 0;
  function lineRow(l, showMeals) {
    const it = ITEMS[l.iid]; const done = !!checks[l.key];
    const badges = (l.brand ? `<span class="badge">★ ${D('brand', 'Marke')}</span>` : '') + (l.blu ? '<span class="badge g">Blu Card</span>' : '');
    const forMeals = showMeals ? `<div class="mute small">${D('for', 'für')} ${l.meals.map((m) => esc(rname(RECIPE[m]))).join(', ')}</div>` : '';
    return `<div class="liw"><label class="li${done ? ' done' : ''}"><input type="checkbox" data-chk="${l.key}" ${done ? 'checked' : ''}><span class="n">${esc(iname(it))} ${badges}<div class="mute small">${l.packs} × ${l.pack} ${ul(it.unit)}${l.product ? ' · ' + esc(l.product) : ''}</div><div class="mute small">${D('need', 'Bedarf')} ${Math.round(l.qty * 10) / 10} ${ul(it.unit)}</div>${forMeals}</span><span class="p">${eur(l.total)}</span></label>${hasBrandIn(l.iid) && !done ? '<div class="lb">' + itemBtn(l.iid, l.tier, curCost) + '</div>' : ''}</div>`;
  }
  function viewList() {
    setHead(D('Shopping list', 'Einkaufsliste'), false);
    if (!plan) { app.innerHTML = `<div class="card">${D('Make a plan first.', 'Erstelle zuerst einen Plan.')} <a href="#/plan">${D('Plan my week', 'Woche planen')}</a> ${D('or pick meals in the', 'oder wähle Gerichte im Tab')} <a href="#/meals">${D('Meals', 'Gerichte')}</a> ${D('tab.', '.')}</div>`; return; }
    const b = basket(plan.ids, settings.mode);
    curCost = b.total;
    const t = {}; ['mix', 'pam', 'gig'].forEach((m) => (t[m] = totalFor(plan.ids, m)));
    const best = Math.min(t.mix, t.pam, t.gig);
    const doneN = b.lines.filter((l) => checks[l.key]).length;
    const left = b.lines.filter((l) => !checks[l.key]).reduce((a, l) => a + l.total, 0);
    const pct = b.lines.length ? (doneN / b.lines.length) * 100 : 0;
    let html = `<div class="card"><div class="row"><b>${D(`${doneN} of ${b.lines.length} items in your basket`, `${doneN} von ${b.lines.length} Artikeln im Korb`)}</b><b>${doneN === b.lines.length && b.lines.length ? D('✅ done', '✅ fertig') : eur(left) + ' ' + D('to go', 'offen')}</b></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="chips" style="margin-top:8px">${[['store', D('By store', 'Nach Laden')], ['meal', D('By meal', 'Nach Gericht')]].map(([v, l]) => `<button class="chip${settings.listView === v ? ' on' : ''}" data-set="listView" data-v="${v}">${l}</button>`).join('')}
        <button class="chip${settings.hideTicked ? ' on' : ''}" data-set="hideTicked" data-v="${!settings.hideTicked}">${settings.hideTicked ? D('Showing to-do only', 'Nur Offenes') : D('Hide ticked', 'Abgehakte ausblenden')}</button>
        <button class="chip${settings.wake ? ' on' : ''}" data-set="wake" data-v="${!settings.wake}">${settings.wake ? D('☀️ Screen on', '☀️ Bildschirm an') : D('Keep screen on', 'Bildschirm anlassen')}</button></div></div>`;
    const cur = totalFor(plan.ids, settings.mode);
    if (settings.listView === 'store') {
      html += `<div class="card"><h3>${D('Name brand, meal by meal', 'Marke, Gericht für Gericht')}</h3><div class="mute small" style="margin-bottom:6px">${settings.brandAll ? D('Name brand is on for the whole plan. Switch it off in the Week view to choose per meal.', 'Marke ist für den ganzen Plan aktiv. Schalte sie in der Wochenansicht aus, um pro Gericht zu wählen.') : D('Tap a meal to switch it to name brand. The list and prices update (ticks for changed items reset).', 'Tippe ein Gericht an, um es auf Marke umzustellen. Liste und Preise aktualisieren sich (Haken bei geänderten Artikeln werden zurückgesetzt).')}</div>` +
        plan.ids.map((rid, i) => `<div class="meal" style="padding:8px 0"><div class="d">${DAYS[i]}</div><div class="t"><b>${esc(rname(RECIPE[rid]))}</b></div>${brandBtn(rid, cur) || `<span class="mute small">${D('no brand option', 'keine Markenoption')}</span>`}</div>`).join('') + '</div>';
    }
    if (settings.listView === 'meal') {
      const byIT = {}; b.lines.forEach((l) => { byIT[l.k] = l; });
      plan.ids.forEach((rid, i) => {
        const r = RECIPE[rid];
        const rows = r.ing.filter(([iid]) => !(settings.pantry && ITEMS[iid].staple)).map(([iid, q]) => {
          const l = byIT[iid + '|' + effTier(rid, iid, defaultTier)];
          return l ? { l, q: q * settings.people, iid } : null;
        }).filter(Boolean);
        const vis = rows.filter((x) => !(settings.hideTicked && checks[x.l.key]));
        const nd = rows.filter((x) => checks[x.l.key]).length;
        html += `<div class="card"><div class="row"><h3>${DAYS[i]} · ${esc(rname(r))}</h3><span class="badge${nd === rows.length ? ' g' : ''}">${nd}/${rows.length}</span></div><div style="margin:4px 0 6px">${brandBtn(rid, cur)}</div>` + (vis.length ? vis.map((x) => {
          const it = ITEMS[x.iid]; const done = !!checks[x.l.key];
          return `<div class="liw"><label class="li${done ? ' done' : ''}"><input type="checkbox" data-chk="${x.l.key}" ${done ? 'checked' : ''}><span class="n">${esc(iname(it))} <span class="badge">${STORES[x.l.store]}</span>${x.l.brand ? `<span class="badge">★ ${D('brand', 'Marke')}</span>` : ''}<div class="mute small">${x.l.product ? esc(x.l.product) + '<br>' : ''}${Math.round(x.q * 10) / 10} ${ul(it.unit)} ${D('for this meal · buy', 'für dieses Gericht · kaufen')} ${x.l.packs} × ${x.l.pack} ${ul(it.unit)}${x.l.meals.length > 1 ? ' ' + D('(shared with ' + (x.l.meals.length - 1) + ' other meal' + (x.l.meals.length > 2 ? 's' : '') + ')', '(geteilt mit ' + (x.l.meals.length - 1) + ' weiteren)') : ''}</div></span><span class="p">${eur(x.l.total)}</span></label>${hasBrandIn(x.iid) && !done ? '<div class="lb">' + itemBtn(x.iid, x.l.tier, cur) + '</div>' : ''}</div>`;
        }).join('') : `<div class="mute small" style="padding:8px 0">${D('All ingredients ticked ✅', 'Alle Zutaten abgehakt ✅')}</div>`) + `<a class="small" href="#/recipe/${rid}">${D('Recipe', 'Rezept')}</a></div>`;
      });
    } else {
      const groups = {};
      b.lines.forEach((l) => { (groups[l.store] = groups[l.store] || []).push(l); });
      Object.keys(groups).sort().forEach((st) => {
        const all = groups[st].sort((a, c) => CATS.indexOf(ITEMS[a.iid].cat) - CATS.indexOf(ITEMS[c.iid].cat) || iname(ITEMS[a.iid]).localeCompare(iname(ITEMS[c.iid])));
        const sub = all.reduce((a, l) => a + l.total, 0);
        const subLeft = all.filter((l) => !checks[l.key]).reduce((a, l) => a + l.total, 0);
        const nd = all.filter((l) => checks[l.key]).length;
        const short = MIN_ORDER[st] && sub < MIN_ORDER[st] ? ` <span class="badge w">${D('online orders need', 'Online-Bestellung ab')} ${eur(MIN_ORDER[st])}${D('+', '')}</span>` : '';
        const todo = all.filter((l) => !checks[l.key]); const done = all.filter((l) => checks[l.key]);
        const cat = (arr) => { let last = ''; return arr.map((l) => { const c = ITEMS[l.iid].cat; const h = c !== last ? `<div class="catb">${esc(catName(c))}</div>` : ''; last = c; return h + lineRow(l, true); }).join(''); };
        html += `<div class="card"><div class="row"><h3>${STORES[st]} <span class="badge${nd === all.length ? ' g' : ''}">${nd}/${all.length}</span></h3><b>${eur(settings.hideTicked ? subLeft : sub)}</b></div>${short}` +
          (todo.length ? cat(todo) : `<div class="mute small" style="padding:8px 0">${D('Everything from here is in your basket ✅', 'Alles von hier liegt im Korb ✅')}</div>`) +
          (done.length && !settings.hideTicked ? `<div class="catb">${D('In basket', 'Im Korb')}</div>` + done.map((l) => lineRow(l, false)).join('') : '') + '</div>';
      });
    }
    html += `<div class="card"><div class="tot">
      <div class="${t.mix === best ? 'best' : ''}"><b>${eur(t.mix)}</b><span>${D('Cheapest mix', 'Günstigster Mix')}</span></div>
      <div class="${t.pam === best ? 'best' : ''}"><b>${eur(t.pam)}</b><span>${D(STORES.pam + ' only', 'Nur ' + STORES.pam)}</span></div>
      <div class="${t.gig === best ? 'best' : ''}"><b>${eur(t.gig)}</b><span>${D(STORES.gig + ' only', 'Nur ' + STORES.gig)}</span></div></div>
      <div style="margin-top:12px">${chips('mode', modeChips(false), settings.mode)}</div>
      <div class="mute small" style="margin-top:8px">${BLU_ON() ? 'Blu Card prices applied where known. ' : ''}${D(`Mix saves ${eur(Math.max(0, Math.min(t.pam, t.gig) - t.mix))} vs the cheaper single store. You'd visit two shops. Changing the store mode changes which items go to which store.`, `Der Mix spart ${eur(Math.max(0, Math.min(t.pam, t.gig) - t.mix))} gegenüber dem günstigeren einzelnen Laden. Du gehst in zwei Läden. Beim Wechsel des Lade-Modus ändert sich, welche Artikel wohin gehören.`)}</div></div>
      <button class="btn sec" id="clearchk">${D('Untick all', 'Alle Haken entfernen')}</button>` + disclaimer();
    app.innerHTML = html;
  }

  function viewPrices() {
    setHead(D('Prices', 'Preise'), false);
    const q = (viewPrices.q || '').toLowerCase();
    const list = Object.values(ITEMS).filter((i) => !q || (iname(i) + ' ' + i.en).toLowerCase().includes(q));
    const edited = Object.keys(overrides).length;
    const total = Object.keys(ITEMS).length;
    const status = priceMeta.updated
      ? D(`Checked against the shops on <b>${esc(priceMeta.updated)}</b>: ${STORES.pam} <b>${priceMeta.ver.pam}</b>/${total}, ${STORES.gig} <b>${priceMeta.ver.gig}</b>/${total} items. Unchecked ones are estimates. Regular shelf prices, promos excluded. ${STORES.pam}: ${esc(priceMeta.where.pam || '')}. ${STORES.gig}: ${esc(priceMeta.where.gig || '')}.`,
        `Mit den Läden abgeglichen am <b>${esc(priceMeta.updated)}</b>: ${STORES.pam} <b>${priceMeta.ver.pam}</b>/${total}, ${STORES.gig} <b>${priceMeta.ver.gig}</b>/${total} Artikel. Nicht geprüfte sind Schätzungen (folgen dem Preis des anderen Ladens). Normale Regalpreise, ohne Aktionen. ${STORES.pam}: ${esc(priceMeta.where.pam || '')} ${STORES.gig}: ${esc(priceMeta.where.gig || '')}`)
      : D('No prices have been checked against the shops yet: <b>all values are estimates</b>.', 'Noch keine Preise mit den Läden abgeglichen: <b>alle Werte sind Schätzungen</b>.');
    const bluNote = COUNTRY.blu ? ' The <b>Blu Card €</b> column equals the Il Gigante price unless a card discount was found; card deals on name-brand products are highlighted under the item.' : '';
    app.innerHTML = `<div class="notice">${status} ${edited ? '<b>' + D(edited + ' edited by you.', edited + ' von dir geändert.') + '</b>' : ''} ${D('Type the real shelf price (per pack) to correct any store-brand item.' + bluNote, 'Gib den echten Regalpreis (pro Packung) ein, um einen Eigenmarken-Artikel zu korrigieren.')}</div>
      <input type="search" id="q" placeholder="${D('Search items', 'Artikel suchen')}" value="${esc(viewPrices.q || '')}">
      <div class="card" style="margin-top:12px">` +
      list.map((i) => {
        const o = overrides[i.id] || {};
        const link = 'https://www.google.com/search?q=' + encodeURIComponent(iname(i) + (DE_ON ? ' Preis Supermarkt' : ' prezzo supermercato'));
        const tag = `<span class="badge ${i.ver.pam ? 'g' : 'e'}">${STORES.pam} ${i.ver.pam ? D('checked', 'geprüft') : D('estimate', 'Schätzung')}</span><span class="badge ${i.ver.gig ? 'g' : 'e'}">${STORES.gig} ${i.ver.gig ? D('checked', 'geprüft') : D('estimate', 'Schätzung')}</span>`;
        const prods = (i.prod.pam || i.prod.gig) ? `<div class="mute small">${D('Store brand', 'Eigenmarke')} · ${i.prod.pam ? STORES.pam + ': ' + esc(i.prod.pam) : ''}${i.prod.pam && i.prod.gig ? ' · ' : ''}${i.prod.gig ? STORES.gig + ': ' + esc(i.prod.gig) : ''}</div>` : '';
        const bl = i.brand ? `<div class="mute small">${BR()} · ${['pam', 'gig'].filter((s) => i.brand[s]).map((s) => STORES[s] + ': ' + esc(i.brand[s].product) + ' ' + eur(i.brand[s].price) + (COUNTRY.blu && i.brand[s].blu != null ? ' (Blu Card ' + eur(i.brand[s].blu) + ')' : '')).join(' · ')}</div>` : '';
        const f = (k, lab, v, ed, cls) => `<div><label>${lab}</label><input inputmode="decimal" class="${ed ? 'ed' : ''} ${cls || ''}" data-p="${i.id}:${k}" value="${v == null ? '' : v.toFixed(2)}" placeholder="–"></div>`;
        const gigPrice = fieldPrice(i.id, 'gig');
        const bluVal = fieldPrice(i.id, 'blu'); // Blu Card price: the regular price unless a card discount is known
        const bluDeal = COUNTRY.blu && i.brand && i.brand.gig && i.brand.gig.blu != null ? `<div class="small bludeal">💳 Blu Card deal: ${eur(i.brand.gig.blu)} on ${esc(i.brand.gig.product)} (regular ${eur(i.brand.gig.price)}, −${Math.round((1 - i.brand.gig.blu / i.brand.gig.price) * 100)}%)</div>` : '';
        return `<div class="pi"${COUNTRY.blu ? '' : ' style="grid-template-columns:repeat(2,1fr)"'}><div class="h"><b>${esc(iname(i))}</b> <span class="mute small">${D('per pack', 'pro Packung')}</span> ${tag} <a class="small" href="${link}" target="_blank" rel="noopener">${D('check online', 'online prüfen')}</a>${prods}${bl}</div>
          ${f('pam', STORES.pam + ' €', fieldPrice(i.id, 'pam'), o.pam != null)}${f('gig', STORES.gig + ' €', gigPrice, o.gig != null)}${COUNTRY.blu ? f('blu', 'Blu Card €', bluVal, o.blu != null, o.blu == null && bluVal === gigPrice ? 'same' : '') : ''}${bluDeal ? '<div class="h">' + bluDeal + '</div>' : ''}</div>`;
      }).join('') + `</div>
      <div class="card"><h3>${D('Backup / restore my edits', 'Meine Änderungen sichern / wiederherstellen')}</h3><textarea id="json" placeholder="${D('Export fills this box. Paste a backup here and tap Import.', 'Export füllt dieses Feld. Füge hier eine Sicherung ein und tippe auf Importieren.')}"></textarea>
      <button class="btn sec" id="exp">${D('Export my prices', 'Meine Preise exportieren')}</button><button class="btn sec" id="imp">${D('Import', 'Importieren')}</button><button class="btn sec" id="reset">${D('Remove my edits', 'Meine Änderungen entfernen')}</button></div>`;
    const qi = $('#q');
    qi.addEventListener('input', () => { viewPrices.q = qi.value; const pos = qi.selectionStart; rerender(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); });
  }

  function viewMeals() {
    setHead(D('Ready meals', 'Fertige Gerichte'), false);
    const fl = viewMeals.fl || (viewMeals.fl = { veg: false, protein: false, fast: false });
    const q = (viewMeals.q || '').toLowerCase();
    const inPlan = (id) => plan && plan.ids.includes(id);
    const list = RECIPES.filter((r) => matches(r, fl) && (!q || (rname(r) + ' ' + rsub(r)).toLowerCase().includes(q)));
    const head = plan ? `<div class="card row"><div><b>${D(`${plan.ids.length}/7 meals in your plan`, `${plan.ids.length}/7 Gerichte in deinem Plan`)}</b><div class="mute small">${eur(totalFor(plan.ids, settings.mode))} · ${esc(modeName())}</div></div><a class="chip on" href="#/list">${D('Shopping list', 'Einkaufsliste')}</a></div>` : `<div class="notice">${D('Tap <b>Add</b> on the meals you want (up to 7). They become your week plan and shopping list.', 'Tippe auf <b>Hinzufügen</b> bei den gewünschten Gerichten (bis zu 7). Daraus werden dein Wochenplan und deine Einkaufsliste.')}</div>`;
    app.innerHTML = head + `<input type="search" id="mq" placeholder="${D('Search ' + RECIPES.length + ' meals', RECIPES.length + ' Gerichte durchsuchen')}" value="${esc(viewMeals.q || '')}" style="margin-bottom:10px">` +
      multi('mfilter', [['veg', '🌱 ' + D('Vegetarian', 'Vegetarisch')], ['protein', '💪 ' + D('High protein', 'Proteinreich')], ['fast', '⚡ ' + D('Under 25 min', 'Unter 25 Min.')]], fl) +
      `<div class="mute small" style="margin:8px 0 12px">${list.length} ${D('meals', 'Gerichte')}</div>` +
      (list.map((r) => `<div class="card"><div class="row"><div><a href="#/recipe/${r.id}" style="color:inherit;text-decoration:none"><b>${esc(rname(r))}</b></a>
        <div class="mute small">${esc(rsub(r))}</div><div class="small" style="margin-top:4px">${r.veg ? `<span class="badge g">${D('veg', 'veg')}</span>` : ''}${timeBadge(r)}${protBadge(r)}<span class="badge">≈${eur(servingCost(r, 'store'))}/${D('serving', 'Portion')}</span></div></div>
        <button class="chip${inPlan(r.id) ? ' on' : ''}" data-toggle="${r.id}">${inPlan(r.id) ? D('✓ In plan', '✓ Im Plan') : D('+ Add', '+ Hinzufügen')}</button></div></div>`).join('') || `<div class="card mute">${D('No meals match. Try fewer filters.', 'Keine Gerichte passen. Probiere weniger Filter.')}</div>`);
    const qi = $('#mq');
    qi.addEventListener('input', () => { viewMeals.q = qi.value; const pos = qi.selectionStart; rerender(); const n = $('#mq'); n.focus(); n.setSelectionRange(pos, pos); });
  }

  function viewSettings() {
    setHead(D('Settings', 'Einstellungen'), false);
    app.innerHTML = `<div class="card"><h3>${D('Country', 'Land')}</h3><div class="mute small" style="margin-bottom:8px">${D('Switches the shops, prices, ingredient names and language. Your plan, ticks and price edits are kept separately for each country.', 'Wechselt Läden, Preise, Zutatennamen und Sprache. Plan, Haken und Preis-Änderungen werden für jedes Land getrennt gespeichert.')}</div>${chips('country', [['it', '🇮🇹 ' + D('Italy (Pam, Il Gigante)', 'Italien (Pam, Il Gigante)')], ['de', '🇩🇪 ' + D('Germany (Edeka, Rewe)', 'Deutschland (Edeka, Rewe)')]], settings.country)}</div>
      <div class="card"><h3>${D('Appearance', 'Darstellung')}</h3>${chips('theme', [['system', D('Automatic', 'Automatisch')], ['light', D('Light', 'Hell')], ['dark', D('Dark', 'Dunkel')]], settings.theme)}
      <div class="mute small" style="margin:12px 0 6px">${D('Colour', 'Farbe')}</div>${chips('accent', Object.keys(ACCENTS).map((k) => [k, `<span class="dot" style="background:${ACCENTS[k][1]}"></span>${ACCENTS[k][0]}`]), settings.accent)}</div>
      <div class="card"><h3>${D('Plan my week controls', 'Bedienung bei „Woche planen“')}</h3><div class="mute small" style="margin-bottom:8px">${D('How you set budget, people and dinners on the Plan tab.', 'Wie du Budget, Personen und Abendessen im Tab Plan einstellst.')}</div>${chips('planInput', [['buttons', D('+ / − buttons', '+ / − Tasten')], ['sliders', D('Sliders', 'Schieberegler')]], settings.planInput)}</div>
      ${COUNTRY.blu ? `<div class="card"><h3>Il Gigante Blu Card</h3><div class="mute small" style="margin-bottom:8px">Use Blu Card prices at Il Gigante wherever a card price is known. Card prices are only shown where they have been checked, otherwise the normal price is used.</div>${chips('blu', [['false', 'I don\'t have it'], ['true', 'I have a Blu Card']], String(settings.blu))}</div>` : ''}
      <div class="card"><h3>${D('Price update alerts', 'Hinweis bei Preisupdates')}</h3><div class="mute small" style="margin-bottom:8px">${D('Get a notification when the Wednesday/Sunday price update has changed prices. Alerts appear when you open the app after an update (a web app cannot ring in the background). On iPhone this needs the app added to the Home Screen.', 'Du bekommst eine Benachrichtigung, wenn das Preisupdate am Mittwoch/Sonntag Preise geändert hat. Sie erscheint, wenn du die App nach einem Update öffnest (eine Web-App kann nicht im Hintergrund klingeln). Auf dem iPhone muss die App dafür zum Home-Bildschirm hinzugefügt sein.')}</div>${chips('notify', [['false', D('Off', 'Aus')], ['true', D('Notify me', 'Benachrichtige mich')]], String(settings.notify))}${settings.notify ? `<button class="btn sec" id="testnotif" style="margin-top:10px">${D('Send a test notification', 'Testbenachrichtigung senden')}</button>` : ''}</div>
      <div class="card"><h3>${D('Price data', 'Preisdaten')}</h3><div class="mute small">${priceMeta.updated ? D('Last checked ' + esc(priceMeta.updated) + ' (' + STORES.pam + ' ' + priceMeta.ver.pam + ', ' + STORES.gig + ' ' + priceMeta.ver.gig + ' items; ' + priceMeta.brandItems + ' items with a name-brand option).', 'Zuletzt geprüft am ' + esc(priceMeta.updated) + ' (' + STORES.pam + ' ' + priceMeta.ver.pam + ', ' + STORES.gig + ' ' + priceMeta.ver.gig + ' Artikel; ' + priceMeta.brandItems + ' Artikel mit Markenoption).') : D('All prices are estimates until checked.', 'Alle Preise sind Schätzungen, bis sie geprüft wurden.')} ${priceMeta.blu ? esc(priceMeta.blu) : ''} ${D('See the Prices tab to correct items.', 'Im Tab Preise kannst du Artikel korrigieren.')}</div></div>
      <div class="card"><h3>${D('Reset', 'Zurücksetzen')}</h3><button class="btn sec" id="wipe">${D('Delete my plan, ticks and edits', 'Meinen Plan, Haken und Änderungen löschen')}</button></div>
      <p class="mute small" style="text-align:center;margin:20px 0 0;font-size:12px">${D('Made by Rafael de Greiff with Claude', 'Gemacht von Rafael de Greiff mit Claude')}</p>`;
  }

  function setHead(title, back, href) {
    $('#title').textContent = title;
    const b = $('#back'); b.hidden = !back; b.onclick = () => { location.hash = href || '#/plan'; };
    document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tabFor()));
  }
  function tabFor() { const h = location.hash.startsWith('#/recipe/') && lastPage ? lastPage : location.hash; return ['list', 'prices', 'meals', 'settings'].find((t) => h.startsWith('#/' + t)) || 'plan'; }

  let lastPage = null; // the screen a recipe was opened from, so Back (and the tab bar) return there
  function route() {
    closeSheet();
    const h = location.hash || '#/plan';
    if (!h.startsWith('#/recipe/')) lastPage = h;
    if (h.startsWith('#/options')) viewOptions();
    else if (h.startsWith('#/week')) viewWeek();
    else if (h.startsWith('#/recipe/')) viewRecipe(h.slice(9));
    else if (h.startsWith('#/list')) viewList();
    else if (h.startsWith('#/prices')) viewPrices();
    else if (h.startsWith('#/meals')) viewMeals();
    else if (h.startsWith('#/settings')) viewSettings();
    else viewPlan();
    if (pendingNotice) app.insertAdjacentHTML('afterbegin', noticeBanner());
    window.scrollTo(0, 0);
  }
  const rerender = () => { const y = window.scrollY; route(); window.scrollTo(0, y); };

  // keep the screen awake while shopping (where the browser allows it)
  let wakeLock = null;
  // quiet: re-acquiring on launch or when the app comes back to the front, so only an explicit tap shows errors
  async function applyWake(quiet) {
    try {
      if (settings.wake && 'wakeLock' in navigator && document.visibilityState === 'visible') { if (!wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } }
      else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
      if (settings.wake && !('wakeLock' in navigator) && !quiet) toast(D('Your browser cannot keep the screen on', 'Dein Browser kann den Bildschirm nicht anlassen'));
    } catch (e) { if (!quiet) toast(D('Could not keep the screen on', 'Bildschirm konnte nicht angelassen werden')); }
  }
  document.addEventListener('visibilitychange', () => { if (settings.wake) applyWake(true); });
  if (settings.wake) applyWake(true);

  // ---------- events ----------
  function runGenerate() {
    if (eligible().length === 0) { toast(D('No meals match these filters', 'Keine Gerichte passen zu diesen Filtern')); return; }
    options = generate();
    save();
    location.hash = '#/options';
    if (location.hash === '#/options') route();
  }
  function openSwap(i) {
    const cur = plan.ids[i];
    const base = totalFor(plan.ids, settings.mode);
    const cands = eligible().filter((id) => !plan.ids.includes(id)).map((id) => {
      const ids = plan.ids.slice(); ids[i] = id;
      return { id, delta: totalFor(ids, settings.mode) - base };
    }).sort((a, b) => a.delta - b.delta);
    sheet(`<h3>${D('Swap', 'Tauschen:')} ${esc(rname(RECIPE[cur]))}</h3>` + `<button class="btn sec" data-remove="${i}" style="margin:0 0 8px">${D('Remove from plan', 'Aus dem Plan entfernen')}</button>` + (cands.length ? cands.map((c) => `<div class="meal"><div class="t"><b>${esc(rname(RECIPE[c.id]))}</b><span class="mute small">${RECIPE[c.id].min} ${D('min', 'Min.')} · ≈${Math.round(RECIPE[c.id].prot)} g ${D('protein', 'Eiweiß')}</span></div><button class="sw chip" data-doswap="${i}:${c.id}">${sgn(c.delta)}</button></div>`).join('') : `<p class="mute">${D('No other meals match your filters. Change them in the Plan tab.', 'Keine anderen Gerichte passen zu deinen Filtern. Ändere sie im Tab Plan.')}</p>`));
  }
  const dropFromBrand = (id) => { if (plan && plan.brand) plan.brand = plan.brand.filter((x) => x !== id); };

  document.addEventListener('click', (e) => {
    const t = e.target.closest('button,a');
    if (!t) return;
    const d = t.dataset;
    if (d.set === 'country') {
      settings.country = d.v === 'de' ? 'de' : 'it';
      save();
      location.hash = '#/settings';
      location.reload(); // prices, names and language are loaded per country
      return;
    }
    if (d.set === 'notify' && d.v === 'true') {
      if (!('Notification' in window)) { toast(D('Notifications are not supported here. On iPhone, add the app to the Home Screen first.', 'Benachrichtigungen werden hier nicht unterstützt. Füge die App auf dem iPhone zuerst zum Home-Bildschirm hinzu.')); return; }
      Notification.requestPermission().then((p) => { settings.notify = p === 'granted'; save(); if (p !== 'granted') toast(D('Notifications are blocked in your phone settings', 'Benachrichtigungen sind in den Einstellungen deines Telefons blockiert')); rerender(); });
      return;
    }
    if (d.dismissnotice) { if (pendingNotice) store.set('seen', pendingNotice.at); pendingNotice = null; rerender(); return; }
    if (t.id === 'testnotif') { showSystemNotice({ at: 'test', changed: 3, note: D('this is a test', 'das ist ein Test') }, true); toast(D('Test sent', 'Test gesendet')); return; }
    if (d.set) {
      const v = d.v === 'true' ? true : d.v === 'false' ? false : d.v;
      settings[d.set] = v;
      if (d.set === 'brandAll' && plan) plan.items = {};
      save();
      if (d.set === 'theme' || d.set === 'accent') applyTheme();
      if (d.set === 'wake') applyWake();
      if (d.set === 'brandAll' && location.hash.startsWith('#/options')) { options = generate(); save(); }
      rerender();
    } else if (d.filter) {
      settings.filters[d.filter] = !settings.filters[d.filter]; save(); rerender();
    } else if (d.mfilter) {
      viewMeals.fl = viewMeals.fl || {}; viewMeals.fl[d.mfilter] = !viewMeals.fl[d.mfilter]; rerender();
    } else if (d.branditem) {
      plan.items = plan.items || {}; plan.items[d.branditem] = d.to; save(); rerender();
    } else if (d.brandmeal) {
      const id = d.brandmeal; plan.brand = plan.brand || [];
      if (plan.brand.includes(id)) dropFromBrand(id); else plan.brand.push(id);
      save(); rerender();
    } else if (d.step) {
      const lim = { budget: [10, 500], people: [1, 8], dinners: [1, 7] }[d.step];
      settings[d.step] = Math.min(lim[1], Math.max(lim[0], settings[d.step] + Number(d.d))); save(); rerender();
    } else if (t.id === 'go' || t.id === 'regen') runGenerate();
    else if (d.pick !== undefined) { plan = { ids: options.opts[Number(d.pick)].ids.slice(), brand: [], items: {} }; checks = {}; save(); location.hash = '#/week'; }
    else if (d.swap !== undefined) openSwap(Number(d.swap));
    else if (d.doswap) { const [i, id] = d.doswap.split(':'); dropFromBrand(plan.ids[Number(i)]); plan.ids[Number(i)] = id; save(); closeSheet(); rerender(); toast(D('Meal swapped', 'Gericht getauscht')); }
    else if (d.toggle) {
      const id = d.toggle;
      if (plan && plan.ids.includes(id)) { plan.ids = plan.ids.filter((x) => x !== id); dropFromBrand(id); if (!plan.ids.length) { plan = null; checks = {}; } }
      else if (plan && plan.ids.length >= 7) { toast(D('Your week is full (7 meals)', 'Deine Woche ist voll (7 Gerichte)')); return; }
      else { plan = plan || { ids: [], brand: [], items: {} }; plan.ids.push(id); }
      save(); rerender();
    }
    else if (d.remove !== undefined) { dropFromBrand(plan.ids[Number(d.remove)]); plan.ids.splice(Number(d.remove), 1); if (!plan.ids.length) { plan = null; checks = {}; } save(); closeSheet(); location.hash = plan ? '#/week' : '#/meals'; rerender(); toast(D('Meal removed', 'Gericht entfernt')); }
    else if (t.id === 'wipe') { if (confirm(D('Delete your plan, ticks and price edits?', 'Plan, Haken und Preis-Änderungen löschen?'))) { plan = null; options = null; checks = {}; overrides = {}; save(); rerender(); toast(D('Cleared', 'Gelöscht')); } }
    else if (t.id === 'clearchk') { checks = {}; save(); rerender(); }
    else if (t.id === 'exp') { const j = JSON.stringify(overrides); $('#json').value = j; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(j).then(() => toast(D('Copied', 'Kopiert')), () => toast(D('Select and copy the text', 'Text markieren und kopieren'))); else toast(D('Select and copy the text', 'Text markieren und kopieren')); }
    else if (t.id === 'imp') {
      let raw = null; try { raw = JSON.parse($('#json').value); } catch (x) { /* not JSON */ }
      const o = cleanOverrides(raw);
      if (!o || (!Object.keys(o).length && Object.keys(raw).length)) { toast(D('That is not a valid backup', 'Das ist keine gültige Sicherung')); return; }
      overrides = o; save(); rerender(); toast(D('Imported', 'Importiert'));
    } else if (t.id === 'reset') { overrides = {}; save(); rerender(); toast(D('Prices reset', 'Preise zurückgesetzt')); }
  });
  document.addEventListener('change', (e) => {
    const c = e.target;
    if (c.dataset.chk) { checks[c.dataset.chk] = c.checked; save(); rerender(); }
    else if (c.dataset.p) {
      const [id, s] = c.dataset.p.split(':');
      if (s === 'blu' && String(c.value).trim() === '') { if (overrides[id]) { delete overrides[id].blu; if (!['pam', 'gig', 'blu'].some((k) => overrides[id][k] != null)) delete overrides[id]; } options = null; save(); return; }
      const v = parseFloat(String(c.value).replace(',', '.'));
      if (!isFinite(v) || v <= 0 || v > 999) { c.value = fieldPrice(id, s).toFixed(2); toast(D('Enter a price like 1,29', 'Gib einen Preis wie 1,29 ein')); return; }
      overrides[id] = Object.assign({}, overrides[id], { [s]: Math.round(v * 100) / 100, since: priceMeta.updated || '' });
      c.value = v.toFixed(2); c.classList.add('ed');
      options = null; // stale after price changes
      save();
    }
  });
  document.addEventListener('input', (e) => {
    const c = e.target;
    if (!c.dataset || !c.dataset.slider) return;
    const n = c.dataset.slider; const v = Number(c.value);
    settings[n] = v;
    const lab = $('#slv-' + n);
    if (lab) lab.textContent = n === 'budget' ? eur(v).replace(',00', '') : v;
  });
  document.addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.slider) { save(); rerender(); } });
  window.addEventListener('hashchange', route);
  route();
  loadPrices().then(rerender); // every screen shows prices (recipes too), so redraw once the checked ones are in

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.__ss = { generate, basket, totalFor, settings: () => settings, plan: () => plan, RECIPES, ITEMS, offer, COUNTRY }; // handy for testing
})();
