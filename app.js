// SpesaSmart: weekly meal planner with Pam vs Il Gigante price comparison.
// Prices come from prices.json (checked by hand against the shops' public pages) and can be edited in the Prices tab.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const app = $('#app');
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const STORES = { pam: 'Pam', gig: 'Il Gigante' };
  const MIN_ORDER = { pam: 29.9, gig: 25 }; // from public store pages; online orders only
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

  // ---------- persistence ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ss.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ss.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  let settings = Object.assign({ budget: 60, people: 2, dinners: 7, filters: { veg: false, protein: false, fast: false }, mode: 'mix', pantry: true, theme: 'system', blu: false, brandAll: false, listView: 'store', hideTicked: false, wake: false }, store.get('settings', {}));
  if (settings.diet === 'veg') settings.filters = Object.assign({}, settings.filters, { veg: true });
  delete settings.diet;
  settings.filters = Object.assign({ veg: false, protein: false, fast: false }, settings.filters);
  let overrides = store.get('prices', {}); // {id:{pam,gig,blu}} edits apply to the store-brand tier
  let plan = store.get('plan', null); // {ids:[...], brand:[ids using name brand]}
  if (plan && !plan.brand) plan.brand = [];
  if (plan && !plan.items) plan.items = {}; // per-product tier overrides {itemId: 'brand'|'store'}
  let options = store.get('options', null);
  let checks = store.get('checks', {});
  const save = () => { store.set('settings', settings); store.set('prices', overrides); store.set('plan', plan); store.set('options', options); store.set('checks', checks); };

  function applyTheme() {
    const r = document.documentElement;
    if (settings.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', settings.theme);
    const m = document.querySelector('meta[name=theme-color]');
    const dark = settings.theme === 'dark' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    if (m) m.content = dark ? '#121714' : '#1f8a5b';
  }
  applyTheme();

  // ---------- prices ----------
  const bluOf = (id) => (overrides[id] && overrides[id].blu != null ? overrides[id].blu : ITEMS[id].blu);
  const price = (id, s) => { // store-brand tier price per pack
    const o = overrides[id] || {};
    const reg = o[s] != null ? o[s] : ITEMS[id][s];
    if (s === 'gig' && settings.blu) { const b = bluOf(id); if (b != null && b < reg) return b; }
    return reg;
  };
  const packOf = (id, st) => ITEMS[id].packs[st];
  const hasBrand = (iid) => !!(ITEMS[iid].brand && (ITEMS[iid].brand.pam || ITEMS[iid].brand.gig));
  // One purchasable offer for an item at a store in a tier ('store' or 'brand'). Falls back to the store tier if no brand product is known there.
  function offer(iid, st, tier) {
    const it = ITEMS[iid];
    if (tier === 'brand' && it.brand && it.brand[st]) {
      const b = it.brand[st];
      let p = b.price; let blu = false;
      if (st === 'gig' && settings.blu && b.blu != null && b.blu < p) { p = b.blu; blu = true; }
      return { price: p, pack: b.pack, product: b.product, brand: true, blu };
    }
    const p = price(iid, st);
    const reg = (overrides[iid] && overrides[iid][st] != null) ? overrides[iid][st] : it[st];
    return { price: p, pack: packOf(iid, st), product: it.prod[st] || '', brand: false, blu: p < reg - 1e-9 };
  }
  let priceMeta = { updated: null, ver: { pam: 0, gig: 0 }, where: null, blu: null, brandItems: 0 };
  function loadPrices() {
    return fetch('prices.json', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      const ver = { pam: 0, gig: 0 }; let brandItems = 0;
      Object.keys(j.items || {}).forEach((id) => {
        if (!ITEMS[id]) return;
        ['pam', 'gig'].forEach((st) => {
          const x = j.items[id][st];
          if (!x) return;
          ITEMS[id][st] = x.price; ITEMS[id].packs[st] = x.pack; ITEMS[id].prod[st] = x.product; ITEMS[id].ver[st] = true; ver[st]++;
        });
        if (j.items[id].blu != null) ITEMS[id].blu = j.items[id].blu;
        if (j.items[id].brand) { ITEMS[id].brand = j.items[id].brand; brandItems++; }
        ITEMS[id].date = j.updated;
      });
      priceMeta = { updated: j.updated || null, ver, where: j.where || null, blu: j.blu || null, rule: j.rule || null, brandItems };
    }).catch(() => {});
  }

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
  function basket(ids, mode, tierFn) {
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
      let cand = mode === 'mix' ? ['pam', 'gig'] : [mode];
      if (e.tier === 'brand') { const withBrand = cand.filter((st) => ITEMS[e.iid].brand && ITEMS[e.iid].brand[st]); if (withBrand.length) cand = withBrand; }
      cand.forEach((st) => {
        const o = offer(e.iid, st, e.tier);
        const packs = Math.max(1, Math.ceil(e.qty / o.pack - 1e-9));
        const total = packs * o.price;
        if (!best || total < best.total - 1e-9) best = { st, o, packs, total };
      });
      return { key: best.st + ':' + e.iid + ':' + e.tier, k, iid: e.iid, tier: e.tier, qty: e.qty, meals: e.meals, store: best.st, packs: best.packs, pack: best.o.pack, unit: best.o.price, total: best.total, product: best.o.product, brand: best.o.brand, blu: best.o.blu };
    });
    return { lines, total: lines.reduce((a, l) => a + l.total, 0) };
  }
  const totalFor = (ids, mode, tierFn) => basket(ids, mode, tierFn).total;
  function servingCost(r, tier) { // pro-rated (no pack rounding), cheapest store per unit
    return r.ing.reduce((a, [iid, q]) => {
      if (settings.pantry && ITEMS[iid].staple) return a;
      const t = tier === 'brand' && hasBrand(iid) ? 'brand' : 'store';
      const u = (st) => { const o = offer(iid, st, t); return o.price / o.pack; };
      return a + q * Math.min(u('pam'), u('gig'));
    }, 0);
  }
  const recipeHasBrand = (r) => r.ing.some(([iid]) => hasBrand(iid) && !(settings.pantry && ITEMS[iid].staple));

  // Per-meal name-brand toggle button (shows the extra cost for that meal). Used in the week view and the shopping list.
  function brandBtn(id, cost) {
    const r = RECIPE[id];
    if (!recipeHasBrand(r)) return '';
    if (settings.brandAll) return '<span class="badge g">★ brand</span>';
    const isB = plan.brand.includes(id);
    const alt = totalFor(plan.ids, settings.mode, (rid) => (rid === id ? (isB ? 'store' : 'brand') : defaultTier(rid))) - cost;
    return `<button class="chip${isB ? ' on' : ''}" data-brandmeal="${id}" style="padding:6px 10px;font-size:13px">${isB ? '★' : '☆'} Name brand ${sgn(isB ? -alt : alt)}</button>`;
  }

  // Per-product name-brand toggle for a shopping-list line (applies to every meal that uses the item).
  function itemBtn(iid, tier, cost) {
    if (!hasBrand(iid)) return '';
    const to = tier === 'brand' ? 'store' : 'brand';
    const had = plan.items[iid];
    plan.items[iid] = to;
    const alt = totalFor(plan.ids, settings.mode) - cost;
    if (had === undefined) delete plan.items[iid]; else plan.items[iid] = had;
    return `<button class="chip${tier === 'brand' ? ' on' : ''}" data-branditem="${iid}" data-to="${to}" style="padding:5px 10px;font-size:12px">${tier === 'brand' ? '★ Name brand ' + sgn(-alt) : '☆ Name brand ' + sgn(alt)}</button>`;
  }

  // ---------- planner ----------
  const matches = (r, f) => (!f.veg || r.veg) && (!f.protein || r.prot >= PROTEIN_MIN) && (!f.fast || r.min < FAST_MAX);
  const eligible = () => RECIPES.filter((r) => matches(r, settings.filters)).map((r) => r.id);
  const filterLabel = () => ['veg', 'protein', 'fast'].filter((k) => settings.filters[k]).map((k) => ({ veg: 'vegetarian', protein: 'high protein', fast: 'under 25 min' }[k])).join(' + ');
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
      take('Cheapest', 'Lowest total for the week', (a, b) => a.cost - b.cost),
      take('Most varied', 'Most different protein sources', (a, b) => b.v - a.v || a.cost - b.cost),
      take('Balanced', 'Good variety, kind to the budget', (a, b) => (b.v - b.cost / settings.budget * 3) - (a.v - a.cost / settings.budget * 3)),
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
  const stepper = (name, v, label, step) => `<div class="stepper"><button data-step="${name}" data-d="-${step}">−</button><b>${label}</b><button data-step="${name}" data-d="${step}">+</button></div>`;
  const disclaimer = () => priceMeta.updated
    ? `<div class="notice">Prices checked by hand on <b>${esc(priceMeta.updated)}</b> (regular shelf prices, no promos). They change, ask for an update each week. Unchecked items are estimates.</div>`
    : '<div class="notice">Prices are <b>estimates</b>, not live shelf prices. Edit them in the Prices tab.</div>';
  const protBadge = (r) => `<span class="badge${r.prot >= PROTEIN_MIN ? ' g' : ''}">≈${Math.round(r.prot)} g protein</span>`;
  const timeBadge = (r) => `<span class="badge${r.min < FAST_MAX ? ' g' : ''}">${r.min} min</span>`;

  // ---------- views ----------
  function viewPlan() {
    setHead('SpesaSmart', false);
    const cur = plan ? `<div class="card"><div class="row"><div><h3>Current plan</h3><div class="mute">${plan.ids.length} dinners · ${eur(totalFor(plan.ids, settings.mode))}</div></div><a class="chip on" href="#/week">Open</a></div></div>` : '';
    const n = eligible().length;
    app.innerHTML = cur + `<div class="card">
      <h2>Plan my week</h2>
      <label class="f">Weekly budget</label>${stepper('budget', settings.budget, eur(settings.budget).replace(',00', ''), 5)}
      <label class="f">People</label>${stepper('people', settings.people, settings.people, 1)}
      <label class="f">Dinners to plan</label>${stepper('dinners', settings.dinners, settings.dinners, 1)}
      <label class="f">Diet & goals <span class="mute small">(combine freely)</span></label>${multi('filter', [['veg', '🌱 Vegetarian'], ['protein', '💪 High protein'], ['fast', '⚡ Fast (&lt;25 min)']], settings.filters)}
      <div class="mute small" style="margin-top:6px">${n} of ${RECIPES.length} meals match${n < settings.dinners ? ` <b class="over-t">(fewer than the ${settings.dinners} dinners you asked for)</b>` : ''}. High protein = about ${PROTEIN_MIN} g or more per serving (approximate, from typical nutrition values).</div>
      <label class="f">Products</label>${chips('brandAll', [['false', 'Store brand'], ['true', 'Name brand']], String(settings.brandAll))}
      <div class="mute small" style="margin-top:6px">You can also pick name brand for single meals later, with the price difference shown.</div>
      <label class="f">Where do you shop?</label>${chips('mode', [['mix', 'Cheapest mix'], ['pam', 'Pam only'], ['gig', 'Il Gigante only']], settings.mode)}
      <label class="f">Pantry</label>${chips('pantry', [['true', 'I have oil & salt'], ['false', 'Buy them too']], String(settings.pantry))}
      <button class="btn" id="go">Show meal options</button></div>` + disclaimer();
  }

  function planCard(o, i) {
    const t = {}; ['mix', 'pam', 'gig'].forEach((m) => (t[m] = totalFor(o.ids, m, settings.brandAll ? allBrand : allStore)));
    const cost = t[settings.mode];
    const over = cost > settings.budget;
    const other = totalFor(o.ids, settings.mode, settings.brandAll ? allStore : allBrand);
    const meals = o.ids.map((id) => RECIPE[id].name).join(' · ');
    const avgProt = o.ids.reduce((a, id) => a + RECIPE[id].prot, 0) / o.ids.length;
    return `<div class="card"><div class="row"><h3>${esc(o.label)}</h3><span class="badge ${over ? 'w' : 'g'}">${over ? 'over budget' : 'fits budget'}</span></div>
      <div class="big ${over ? 'over-t' : ''}">${eur(cost)} <span class="mute small">of ${eur(settings.budget)} · ${settings.brandAll ? 'name brand' : 'store brand'}</span></div>
      <div class="mute small">${esc(o.blurb)} · ${eur(cost / settings.people / o.ids.length)} per serving · ≈${Math.round(avgProt)} g protein avg</div>
      <div class="mute small">${settings.brandAll ? 'Store brand instead' : 'Name brand instead'}: <b>${eur(other)}</b> (${sgn(other - cost)})</div>
      <p class="small">${esc(meals)}</p>
      <div class="tot"><div class="${t.mix <= t.pam && t.mix <= t.gig ? 'best' : ''}"><b>${eur(t.mix)}</b><span>Cheapest mix</span></div><div><b>${eur(t.pam)}</b><span>Pam</span></div><div><b>${eur(t.gig)}</b><span>Il Gigante</span></div></div>
      <button class="btn" data-pick="${i}">Use this plan</button></div>`;
  }

  function viewOptions() {
    setHead('Meal options', true, '#/plan');
    if (!options || !options.opts.length) { app.innerHTML = '<div class="card">No plans yet. <a href="#/plan">Set up your week</a>.</div>'; return; }
    const few = options.poolSize < options.wanted ? `<div class="notice">Only ${options.poolSize} meals match ${esc(filterLabel())}, so these plans have ${options.poolSize} dinners.</div>` : '';
    const warn = options.fits ? '' : `<div class="notice">No plan fits ${eur(settings.budget)} with these settings. The cheapest we found is ${eur(options.minCost)}. Raise the budget, plan fewer dinners${settings.brandAll ? ' or switch to store brand' : ''}.</div>`;
    app.innerHTML = few + warn + options.opts.map(planCard).join('') + '<button class="btn sec" id="regen">Try different combinations</button>' + disclaimer();
  }

  function viewWeek() {
    setHead('Your week', true, '#/plan');
    if (!plan) { app.innerHTML = '<div class="card">No plan yet. <a href="#/plan">Set up your week</a>.</div>'; return; }
    const cost = totalFor(plan.ids, settings.mode);
    const pct = Math.min(100, (cost / settings.budget) * 100);
    const over = cost > settings.budget;
    const cs = totalFor(plan.ids, settings.mode, allStore); const cb = totalFor(plan.ids, settings.mode, allBrand);
    const nBrand = settings.brandAll ? plan.ids.length : plan.brand.filter((id) => plan.ids.includes(id)).length;
    app.innerHTML = `<div class="card"><div class="row"><b>Basket (${esc(modeName())})</b><b class="${over ? 'over-t' : 'ok-t'}">${eur(cost)} / ${eur(settings.budget)}</b></div>
      <div class="bar ${over ? 'over' : ''}"><i style="width:${pct}%"></i></div>
      <div class="mute small">${over ? eur(cost - settings.budget) + ' over budget' : eur(settings.budget - cost) + ' left'} · ${settings.people} people · ${nBrand} of ${plan.ids.length} meals name brand</div>
      <a class="btn" style="text-decoration:none;text-align:center" href="#/list">Open shopping list</a></div>
      <div class="card"><h3>Store brand vs name brand</h3>
      <div class="tot" style="grid-template-columns:repeat(2,1fr)"><div class="${!settings.brandAll && !nBrand ? 'best' : ''}"><b>${eur(cs)}</b><span>All store brand</span></div><div class="${settings.brandAll ? 'best' : ''}"><b>${eur(cb)}</b><span>All name brand</span></div></div>
      <div class="mute small" style="margin-top:8px">Name brand for everything costs ${sgn(cb - cs)}. ${priceMeta.brandItems ? priceMeta.brandItems + ' items have a name-brand option (pasta, tomato, tuna, dairy, legumes and more); the rest stay the same.' : ''}</div>
      <div style="margin-top:10px">${chips('brandAll', [['false', 'Store brand'], ['true', 'Name brand for all']], String(settings.brandAll))}</div>
      ${settings.brandAll ? '' : '<div class="mute small" style="margin-top:8px">Or tap ☆ on single meals below.</div>'}</div>
      <div class="card">` + plan.ids.map((id, i) => {
        const r = RECIPE[id];
        const isB = settings.brandAll || plan.brand.includes(id);
        const btn = brandBtn(id, cost);
        return `<div class="meal"><div class="d">${DAYS[i]}</div><div class="t"><a href="#/recipe/${id}" style="color:inherit;text-decoration:none"><b>${esc(r.name)}</b></a><span class="mute small">${r.min} min · ≈${eur(servingCost(r, isB ? 'brand' : 'store'))}/serving · ≈${Math.round(r.prot)} g protein ${r.veg ? '· 🌱' : ''}</span></div><div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">${btn}<button class="sw" data-swap="${i}">Swap</button></div></div>`;
      }).join('') + '</div>' + disclaimer();
  }

  function viewRecipe(id) {
    const r = RECIPE[id];
    setHead('Recipe', true, plan ? '#/week' : '#/plan');
    if (!r) { app.innerHTML = '<div class="card">Recipe not found.</div>'; return; }
    const d = servingCost(r, 'brand') - servingCost(r, 'store');
    app.innerHTML = `<div class="card"><h2>${esc(r.name)}</h2><div class="mute">${esc(r.en)}</div>
      <p>${r.veg ? '<span class="badge g">vegetarian</span>' : ''}${timeBadge(r)}${protBadge(r)}<span class="badge">≈${eur(servingCost(r, 'store'))} / serving</span>${recipeHasBrand(r) ? `<span class="badge">name brand ${sgn(d)}/serving</span>` : ''}</p>
      <h3>Ingredients for ${settings.people}</h3><ul>${r.ing.map(([iid, q]) => {
        const it = ITEMS[iid]; const n = q * settings.people;
        return `<li>${esc(it.name)}: ${Math.round(n * 10) / 10} ${it.unit}${it.staple ? ' <span class="mute">(pantry)</span>' : ''}</li>`;
      }).join('')}</ul>
      <h3>Method</h3><ol>${r.steps.map((s) => '<li>' + esc(s) + '</li>').join('')}</ol></div>`;
  }

  const modeName = () => ({ mix: 'cheapest mix', pam: 'Pam', gig: 'Il Gigante' }[settings.mode]);

  // Interactive shopping list: tick items one by one in the store, by store/aisle or by meal.
  let curCost = 0;
  function lineRow(l, showMeals) {
    const it = ITEMS[l.iid]; const done = !!checks[l.key];
    const badges = (l.brand ? '<span class="badge">★ brand</span>' : '') + (l.blu ? '<span class="badge g">Blu Card</span>' : '');
    const forMeals = showMeals ? `<div class="mute small">for ${l.meals.map((m) => esc(RECIPE[m].name)).join(', ')}</div>` : '';
    return `<div class="liw"><label class="li${done ? ' done' : ''}"><input type="checkbox" data-chk="${l.key}" ${done ? 'checked' : ''}><span class="n">${esc(it.name)} ${badges}<div class="mute small">${l.packs} × ${l.pack} ${it.unit}${l.product ? ' · ' + esc(l.product) : ''}</div><div class="mute small">need ${Math.round(l.qty * 10) / 10} ${it.unit}</div>${forMeals}</span><span class="p">${eur(l.total)}</span></label>${hasBrand(l.iid) && !done ? '<div class="lb">' + itemBtn(l.iid, l.tier, curCost) + '</div>' : ''}</div>`;
  }
  function viewList() {
    setHead('Shopping list', false);
    if (!plan) { app.innerHTML = '<div class="card">Make a plan first. <a href="#/plan">Plan my week</a> or pick meals in the <a href="#/meals">Meals</a> tab.</div>'; return; }
    const b = basket(plan.ids, settings.mode);
    curCost = b.total;
    const t = {}; ['mix', 'pam', 'gig'].forEach((m) => (t[m] = totalFor(plan.ids, m)));
    const best = Math.min(t.mix, t.pam, t.gig);
    const doneN = b.lines.filter((l) => checks[l.key]).length;
    const left = b.lines.filter((l) => !checks[l.key]).reduce((a, l) => a + l.total, 0);
    const pct = b.lines.length ? (doneN / b.lines.length) * 100 : 0;
    let html = `<div class="card"><div class="row"><b>${doneN} of ${b.lines.length} items in your basket</b><b>${doneN === b.lines.length && b.lines.length ? '✅ done' : eur(left) + ' to go'}</b></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="chips" style="margin-top:8px">${[['store', 'By store'], ['meal', 'By meal']].map(([v, l]) => `<button class="chip${settings.listView === v ? ' on' : ''}" data-set="listView" data-v="${v}">${l}</button>`).join('')}
        <button class="chip${settings.hideTicked ? ' on' : ''}" data-set="hideTicked" data-v="${!settings.hideTicked}">${settings.hideTicked ? 'Showing to-do only' : 'Hide ticked'}</button>
        <button class="chip${settings.wake ? ' on' : ''}" data-set="wake" data-v="${!settings.wake}">${settings.wake ? '☀️ Screen on' : 'Keep screen on'}</button></div></div>`;
    const cur = totalFor(plan.ids, settings.mode);
    if (settings.listView === 'store') {
      html += `<div class="card"><h3>Name brand, meal by meal</h3><div class="mute small" style="margin-bottom:6px">${settings.brandAll ? 'Name brand is on for the whole plan. Switch it off in the Week view to choose per meal.' : 'Tap a meal to switch it to name brand. The list and prices update (ticks for changed items reset).'}</div>` +
        plan.ids.map((rid, i) => `<div class="meal" style="padding:8px 0"><div class="d">${DAYS[i]}</div><div class="t"><b>${esc(RECIPE[rid].name)}</b></div>${brandBtn(rid, cur) || '<span class="mute small">no brand option</span>'}</div>`).join('') + '</div>';
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
        html += `<div class="card"><div class="row"><h3>${DAYS[i]} · ${esc(r.name)}</h3><span class="badge${nd === rows.length ? ' g' : ''}">${nd}/${rows.length}</span></div><div style="margin:4px 0 6px">${brandBtn(rid, cur)}</div>` + (vis.length ? vis.map((x) => {
          const it = ITEMS[x.iid]; const done = !!checks[x.l.key];
   return `<div class="liw"><label class="li${done ? ' done' : ''}"><input type="checkbox" data-chk="${x.l.key}" ${done ? 'checked' : ''}><span class="n">${esc(it.name)} <span class="badge">${STORES[x.l.store]}</span>${x.l.brand ? '<span class="badge">★ brand</span>' : ''}<div class="mute small">${x.l.product ? esc(x.l.product) + '<br>' : ''}${Math.round(x.q * 10) / 10} ${it.unit} for this meal · buy ${x.l.packs} × ${x.l.pack} ${it.unit}${x.l.meals.length > 1 ? ' (shared with ' + (x.l.meals.length - 1) + ' other)' : ''}</div></span><span class="p">${eur(x.l.total)}</span></label>${hasBrand(x.iid) && !done ? '<div class="lb">' + itemBtn(x.iid, x.l.tier, cur) + '</div>' : ''}</div>`;
        }).join('') : '<div class="mute small" style="padding:8px 0">All ingredients ticked ✅</div>') + `<a class="small" href="#/recipe/${rid}">Recipe</a></div>`;
      });
    } else {
      const groups = {};
      b.lines.forEach((l) => { (groups[l.store] = groups[l.store] || []).push(l); });
      Object.keys(groups).sort().forEach((st) => {
        const all = groups[st].sort((a, c) => CATS.indexOf(ITEMS[a.iid].cat) - CATS.indexOf(ITEMS[c.iid].cat) || ITEMS[a.iid].name.localeCompare(ITEMS[c.iid].name));
        const sub = all.reduce((a, l) => a + l.total, 0);
        const subLeft = all.filter((l) => !checks[l.key]).reduce((a, l) => a + l.total, 0);
        const nd = all.filter((l) => checks[l.key]).length;
        const short = sub < MIN_ORDER[st] ? ` <span class="badge w">online orders need ${eur(MIN_ORDER[st])}+</span>` : '';
        const todo = all.filter((l) => !checks[l.key]); const done = all.filter((l) => checks[l.key]);
        const cat = (arr) => { let last = ''; return arr.map((l) => { const c = ITEMS[l.iid].cat; const h = c !== last ? `<div class="catb">${esc(c)}</div>` : ''; last = c; return h + lineRow(l, true); }).join(''); };
        html += `<div class="card"><div class="row"><h3>${STORES[st]} <span class="badge${nd === all.length ? ' g' : ''}">${nd}/${all.length}</span></h3><b>${eur(settings.hideTicked ? subLeft : sub)}</b></div>${short}` +
          (todo.length ? cat(todo) : '<div class="mute small" style="padding:8px 0">Everything from here is in your basket ✅</div>') +
          (done.length && !settings.hideTicked ? `<div class="catb">In basket</div>` + done.map((l) => lineRow(l, false)).join('') : '') + '</div>';
      });
    }
    html += `<div class="card"><div class="tot">
      <div class="${t.mix === best ? 'best' : ''}"><b>${eur(t.mix)}</b><span>Cheapest mix</span></div>
      <div class="${t.pam === best ? 'best' : ''}"><b>${eur(t.pam)}</b><span>Pam only</span></div>
      <div class="${t.gig === best ? 'best' : ''}"><b>${eur(t.gig)}</b><span>Gigante only</span></div></div>
      <div style="margin-top:12px">${chips('mode', [['mix', 'Mix'], ['pam', 'Pam'], ['gig', 'Il Gigante']], settings.mode)}</div>
      <div class="mute small" style="margin-top:8px">${settings.blu ? 'Blu Card prices applied where known. ' : ''}Mix saves ${eur(Math.max(0, Math.min(t.pam, t.gig) - t.mix))} vs the cheaper single store. You'd visit two shops. Changing the store mode changes which items go to which store.</div></div>
      <button class="btn sec" id="clearchk">Untick all</button>` + disclaimer();
    app.innerHTML = html;
  }

  function viewPrices() {
    setHead('Prices', false);
    const q = (viewPrices.q || '').toLowerCase();
    const list = Object.values(ITEMS).filter((i) => !q || (i.name + ' ' + i.en).toLowerCase().includes(q));
    const edited = Object.keys(overrides).length;
    const total = Object.keys(ITEMS).length;
    const status = priceMeta.updated
      ? `Checked against the shops on <b>${esc(priceMeta.updated)}</b>: Pam <b>${priceMeta.ver.pam}</b>/${total}, Il Gigante <b>${priceMeta.ver.gig}</b>/${total} items. Unchecked ones are estimates. Regular shelf prices, promos excluded. Pam: ${esc((priceMeta.where || {}).pam || '')}. Il Gigante: ${esc((priceMeta.where || {}).gig || '')}.`
      : 'No prices have been checked against the shops yet: <b>all values are estimates</b>.';
    app.innerHTML = `<div class="notice">${status} ${edited ? '<b>' + edited + ' edited by you.</b>' : ''} Type the real shelf price (per pack) to correct any store-brand item.</div>
      <input type="search" id="q" placeholder="Search items" value="${esc(viewPrices.q || '')}">
      <div class="card" style="margin-top:12px">` +
      list.map((i) => {
        const o = overrides[i.id] || {};
        const link = 'https://www.google.com/search?q=' + encodeURIComponent(i.name + ' prezzo supermercato');
        const tag = `<span class="badge ${i.ver.pam ? 'g' : 'e'}">Pam ${i.ver.pam ? 'checked' : 'estimate'}</span><span class="badge ${i.ver.gig ? 'g' : 'e'}">Gigante ${i.ver.gig ? 'checked' : 'estimate'}</span>`;
        const prods = (i.prod.pam || i.prod.gig) ? `<div class="mute small">Store brand · ${i.prod.pam ? 'Pam: ' + esc(i.prod.pam) : ''}${i.prod.pam && i.prod.gig ? ' · ' : ''}${i.prod.gig ? 'Il Gigante: ' + esc(i.prod.gig) : ''}</div>` : '';
        const bl = i.brand ? `<div class="mute small">Name brand · ${['pam', 'gig'].filter((s) => i.brand[s]).map((s) => STORES[s] + ': ' + esc(i.brand[s].product) + ' ' + eur(i.brand[s].price) + (i.brand[s].blu != null ? ' (Blu Card ' + eur(i.brand[s].blu) + ')' : '')).join(' · ')}</div>` : '';
        const f = (k, lab, v, ed) => `<div><label>${lab}</label><input inputmode="decimal" class="${ed ? 'ed' : ''}" data-p="${i.id}:${k}" value="${v == null ? '' : v.toFixed(2)}" placeholder="–"></div>`;
        return `<div class="pi"><div class="h"><b>${esc(i.name)}</b> <span class="mute small">per pack</span> ${tag} <a class="small" href="${link}" target="_blank" rel="noopener">check online</a>${prods}${bl}</div>
          ${f('pam', 'Pam €', o.pam != null ? o.pam : i.pam, o.pam != null)}${f('gig', 'Gigante €', o.gig != null ? o.gig : i.gig, o.gig != null)}${f('blu', 'Blu Card €', bluOf(i.id), o.blu != null)}</div>`;
      }).join('') + `</div>
      <div class="card"><h3>Backup / restore my edits</h3><textarea id="json" placeholder="Export fills this box. Paste a backup here and tap Import."></textarea>
      <button class="btn sec" id="exp">Export my prices</button><button class="btn sec" id="imp">Import</button><button class="btn sec" id="reset">Remove my edits</button></div>`;
    const qi = $('#q');
    qi.addEventListener('input', () => { viewPrices.q = qi.value; const pos = qi.selectionStart; viewPrices(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); });
  }

  function viewMeals() {
    setHead('Ready meals', false);
    const fl = viewMeals.fl || (viewMeals.fl = { veg: false, protein: false, fast: false });
    const q = (viewMeals.q || '').toLowerCase();
    const inPlan = (id) => plan && plan.ids.includes(id);
    const list = RECIPES.filter((r) => matches(r, fl) && (!q || (r.name + ' ' + r.en).toLowerCase().includes(q)));
    const head = plan ? `<div class="card row"><div><b>${plan.ids.length}/7 meals in your plan</b><div class="mute small">${eur(totalFor(plan.ids, settings.mode))} · ${esc(modeName())}</div></div><a class="chip on" href="#/list">Shopping list</a></div>` : '<div class="notice">Tap <b>Add</b> on the meals you want (up to 7). They become your week plan and shopping list.</div>';
    app.innerHTML = head + `<input type="search" id="mq" placeholder="Search ${RECIPES.length} meals" value="${esc(viewMeals.q || '')}" style="margin-bottom:10px">` +
      multi('mfilter', [['veg', '🌱 Vegetarian'], ['protein', '💪 High protein'], ['fast', '⚡ Under 25 min']], fl) +
      `<div class="mute small" style="margin:8px 0 12px">${list.length} meals</div>` +
      (list.map((r) => `<div class="card"><div class="row"><div><a href="#/recipe/${r.id}" style="color:inherit;text-decoration:none"><b>${esc(r.name)}</b></a>
        <div class="mute small">${esc(r.en)}</div><div class="small" style="margin-top:4px">${r.veg ? '<span class="badge g">veg</span>' : ''}${timeBadge(r)}${protBadge(r)}<span class="badge">≈${eur(servingCost(r, 'store'))}/serving</span></div></div>
        <button class="chip${inPlan(r.id) ? ' on' : ''}" data-toggle="${r.id}">${inPlan(r.id) ? '✓ In plan' : '+ Add'}</button></div></div>`).join('') || '<div class="card mute">No meals match. Try fewer filters.</div>');
    const qi = $('#mq');
    qi.addEventListener('input', () => { viewMeals.q = qi.value; const pos = qi.selectionStart; viewMeals(); const n = $('#mq'); n.focus(); n.setSelectionRange(pos, pos); });
  }

  function viewSettings() {
    setHead('Settings', false);
    app.innerHTML = `<div class="card"><h3>Appearance</h3>${chips('theme', [['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']], settings.theme)}</div>
      <div class="card"><h3>Il Gigante Blu Card</h3><div class="mute small" style="margin-bottom:8px">Use Blu Card prices at Il Gigante wherever a card price is known. Card prices are only shown where they have been checked, otherwise the normal price is used.</div>${chips('blu', [['false', 'I don\'t have it'], ['true', 'I have a Blu Card']], String(settings.blu))}</div>
      <div class="card"><h3>Price data</h3><div class="mute small">${priceMeta.updated ? 'Last checked ' + esc(priceMeta.updated) + ' (Pam ' + priceMeta.ver.pam + ', Il Gigante ' + priceMeta.ver.gig + ' items; ' + priceMeta.brandItems + ' items with a name-brand option).' : 'All prices are estimates until checked.'} ${priceMeta.blu ? esc(priceMeta.blu) : ''} See the Prices tab to correct items.</div></div>
      <div class="card"><h3>Reset</h3><button class="btn sec" id="wipe">Delete my plan, ticks and edits</button></div>`;
  }

  function setHead(title, back, href) {
    $('#title').textContent = title;
    const b = $('#back'); b.hidden = !back; b.onclick = () => { location.hash = href || '#/plan'; };
    document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tabFor()));
  }
  function tabFor() { const h = location.hash; return ['list', 'prices', 'meals', 'settings'].find((t) => h.startsWith('#/' + t)) || 'plan'; }

  function route() {
    closeSheet();
    const h = location.hash || '#/plan';
    if (h.startsWith('#/options')) viewOptions();
    else if (h.startsWith('#/week')) viewWeek();
    else if (h.startsWith('#/recipe/')) viewRecipe(h.slice(9));
    else if (h.startsWith('#/list')) viewList();
    else if (h.startsWith('#/prices')) viewPrices();
    else if (h.startsWith('#/meals')) viewMeals();
    else if (h.startsWith('#/settings')) viewSettings();
    else viewPlan();
    window.scrollTo(0, 0);
  }
  const rerender = () => { const y = window.scrollY; route(); window.scrollTo(0, y); };

  // keep the screen awake while shopping (where the browser allows it)
  let wakeLock = null;
  async function applyWake() {
    try {
      if (settings.wake && 'wakeLock' in navigator && document.visibilityState === 'visible') { if (!wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } }
      else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
      if (settings.wake && !('wakeLock' in navigator)) toast('Your browser cannot keep the screen on');
    } catch (e) { toast('Could not keep the screen on'); }
  }
  document.addEventListener('visibilitychange', () => { if (settings.wake) applyWake(); });

  // ---------- events ----------
  function runGenerate() {
    if (eligible().length === 0) { toast('No meals match these filters'); return; }
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
    sheet(`<h3>Swap ${esc(RECIPE[cur].name)}</h3>` + `<button class="btn sec" data-remove="${i}" style="margin:0 0 8px">Remove from plan</button>` + (cands.length ? cands.map((c) => `<div class="meal"><div class="t"><b>${esc(RECIPE[c.id].name)}</b><span class="mute small">${RECIPE[c.id].min} min · ≈${Math.round(RECIPE[c.id].prot)} g protein</span></div><button class="sw chip" data-doswap="${i}:${c.id}">${sgn(c.delta)}</button></div>`).join('') : '<p class="mute">No other meals match your filters. Change them in the Plan tab.</p>'));
  }
  const dropFromBrand = (id) => { if (plan && plan.brand) plan.brand = plan.brand.filter((x) => x !== id); };

  document.addEventListener('click', (e) => {
    const t = e.target.closest('button,a');
    if (!t) return;
    const d = t.dataset;
    if (d.set) {
      const v = d.v === 'true' ? true : d.v === 'false' ? false : d.v;
      settings[d.set] = v;
      if (d.set === 'brandAll' && plan) plan.items = {};
      save();
      if (d.set === 'theme') applyTheme();
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
    else if (d.doswap) { const [i, id] = d.doswap.split(':'); dropFromBrand(plan.ids[Number(i)]); plan.ids[Number(i)] = id; save(); closeSheet(); rerender(); toast('Meal swapped'); }
    else if (d.toggle) {
      const id = d.toggle;
      if (plan && plan.ids.includes(id)) { plan.ids = plan.ids.filter((x) => x !== id); dropFromBrand(id); if (!plan.ids.length) plan = null; }
      else if (plan && plan.ids.length >= 7) { toast('Your week is full (7 meals)'); return; }
      else { plan = plan || { ids: [], brand: [], items: {} }; plan.ids.push(id); }
      save(); rerender();
    }
    else if (d.remove !== undefined) { dropFromBrand(plan.ids[Number(d.remove)]); plan.ids.splice(Number(d.remove), 1); if (!plan.ids.length) plan = null; save(); closeSheet(); location.hash = plan ? '#/week' : '#/meals'; rerender(); toast('Meal removed'); }
    else if (t.id === 'wipe') { if (confirm('Delete your plan, ticks and price edits?')) { plan = null; options = null; checks = {}; overrides = {}; save(); rerender(); toast('Cleared'); } }
    else if (t.id === 'clearchk') { checks = {}; save(); rerender(); }
    else if (t.id === 'exp') { const j = JSON.stringify(overrides); $('#json').value = j; try { navigator.clipboard.writeText(j); toast('Copied'); } catch (x) { toast('Select and copy the text'); } }
    else if (t.id === 'imp') {
      try { const o = JSON.parse($('#json').value); if (typeof o !== 'object' || Array.isArray(o) || o === null) throw 0; overrides = o; save(); rerender(); toast('Imported'); } catch (x) { toast('That is not a valid backup'); }
    } else if (t.id === 'reset') { overrides = {}; save(); rerender(); toast('Prices reset'); }
  });
  document.addEventListener('change', (e) => {
    const c = e.target;
    if (c.dataset.chk) { checks[c.dataset.chk] = c.checked; save(); rerender(); }
    else if (c.dataset.p) {
      const [id, s] = c.dataset.p.split(':');
      if (s === 'blu' && String(c.value).trim() === '') { if (overrides[id]) { delete overrides[id].blu; if (!Object.keys(overrides[id]).length) delete overrides[id]; } options = null; save(); return; }
      const v = parseFloat(String(c.value).replace(',', '.'));
      if (!isFinite(v) || v <= 0 || v > 999) { c.value = (s === 'blu' ? (bluOf(id) || 0) : price(id, s)).toFixed(2); toast('Enter a price like 1,29'); return; }
      overrides[id] = Object.assign({}, overrides[id], { [s]: Math.round(v * 100) / 100 });
      c.value = v.toFixed(2); c.classList.add('ed');
      options = null; // stale after price changes
      save();
    }
  });
  window.addEventListener('hashchange', route);
  route();
  loadPrices().then(() => { if (/#\/(prices|settings|list|week|options|plan|meals)?$/.test(location.hash) || !location.hash) rerender(); });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.__ss = { generate, basket, totalFor, settings: () => settings, plan: () => plan, RECIPES, ITEMS, offer }; // handy for testing
})();
