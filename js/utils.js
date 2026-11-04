/* Shared helpers: icons, DOM, formatting, paths */
window.NV = window.NV || {};
NV.pages = NV.pages || {};
NV.services = NV.services || {};
NV.live = false;
NV.db = null;
NV.supabaseError = null;
NV.supabaseReady = Promise.resolve();

const liveConfig = window.NV_CONFIG || {};
if (Boolean(liveConfig.SUPABASE_URL) !== Boolean(liveConfig.SUPABASE_ANON_KEY)) {
  NV.supabaseError = new Error('Configure both SUPABASE_URL and SUPABASE_ANON_KEY to enable shared accounts and content.');
} else if (liveConfig.SUPABASE_URL && liveConfig.SUPABASE_ANON_KEY) {
  NV.supabaseReady = import('https://esm.sh/@supabase/supabase-js@2')
    .then(({ createClient }) => {
      const url = new URL(liveConfig.SUPABASE_URL);
      if (url.protocol !== 'https:') throw new Error('SUPABASE_URL must use HTTPS.');
      NV.db = createClient(url.toString(), liveConfig.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      NV.live = true;
    })
    .catch(error => {
      NV.supabaseError = error;
      console.error('Could not initialize Supabase:', error);
    });
}

(function (NV) {
  const P = {
    home:'<path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    message:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',
    eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    heart:'<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
    pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
    plane:'<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    music:'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    shirt:'<path d="M20.4 5.6 16 3a4 4 0 0 1-8 0L3.6 5.6a1 1 0 0 0-.5 1.2l1 3.2a1 1 0 0 0 1 .7H7v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V10.7h1.9a1 1 0 0 0 1-.7l1-3.2a1 1 0 0 0-.5-1.2z"/>',
    briefcase:'<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20"/>',
    calendar:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    store:'<path d="M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3"/>',
    users:'<circle cx="9" cy="8" r="3.5"/><path d="M2 21c0-3.5 3-6 7-6s7 2.5 7 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c3 0 5 2 5 5"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    utensils:'<path d="M7 2v8a2 2 0 0 1-4 0V2M5 2v20M17 22V2c-3 2-4 5-4 8s1 4 4 4"/>',
    masks:'<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
    flame:'<path d="M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-4-2-6-4-8-1 4-4 6-4 10 0 5 3 9 7 9z"/>',
    share:'<path d="M4 12v8h16v-8M16 6l-4-4-4 4M12 2v13"/>',
    bookmark:'<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    x:'<path d="M18 6 6 18M6 6l12 12"/>',
    check:'<path d="M20 6 9 17l-5-5"/>',
    settings:'<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    trash:'<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
    flag:'<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
    shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    cart:'<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
    play:'<path d="M5 3l14 9-14 9z"/>',
    moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    chevron:'<path d="m6 9 6 6 6-6"/>',
    send:'<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
    mail:'<path d="M4 4h16v16H4zM4 6l8 7 8-7"/>',
    lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    chart:'<path d="M3 3v18h18M7 14l4-4 4 4 5-6"/>',
    camera:'<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/>',
    video:'<path d="m15 10 5-3v10l-5-3z"/><rect x="3" y="6" width="12" height="12" rx="2"/>',
    mic:'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
    micOff:'<path d="m3 3 18 18M9 9v3a3 3 0 0 0 5.12 2.12M15 9V5a3 3 0 0 0-5.8-1M5 10v2a7 7 0 0 0 11.6 5.3M19 10v2a7 7 0 0 1-.7 3M12 19v3M8 22h8"/>',
    videoOff:'<path d="m3 3 18 18M10.6 6H13a2 2 0 0 1 2 2v2l5-3v10l-2.2-1.3M5 6.2A2 2 0 0 0 3 8v8a2 2 0 0 0 2 2h10"/>',
    sparkles:'<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3zM19 14l1.2 2.8L23 18l-2.8 1.2L19 22l-1.2-2.8L15 18l2.8-1.2L19 14z"/>',
    thumbsUp:'<path d="M7 10v11H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3zM7 10l5-8a3 3 0 0 1 2 3l-1 5h6a3 3 0 0 1 3 4l-2 6a3 3 0 0 1-3 2H7"/>',
    radio:'<rect x="3" y="6" width="18" height="15" rx="2"/><path d="m3 6 18-4M7 11h.01M7 16h.01M11 16h.01M15 16h5"/>'
  };
  NV.icon = (n, cls) => `<svg class="i ${cls||''}" viewBox="0 0 24 24" aria-hidden="true">${P[n]||''}</svg>`;
  NV.hydrateIcons = (root) => (root || document).querySelectorAll('i[data-i]').forEach(el => {
    el.outerHTML = NV.icon(el.dataset.i, el.className);
  });
  NV.root = () => document.body.dataset.root || '';
  NV.url = (p) => NV.root() + p;
  NV.$ = (s, r) => (r || document).querySelector(s);
  NV.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  NV.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  NV.money = (n) => '₦' + Number(n).toLocaleString('en-NG');
  NV.param = (k) => new URLSearchParams(location.search).get(k);
  NV.store = {
    get(k, d) { try { const v = localStorage.getItem('nv:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('nv:' + k, JSON.stringify(v)); } catch (e) {} }
  };
  NV.demo = () => window.NV_DEMO || {};
  NV.local = {
    list: (k) => NV.store.get('tbl:' + k, []),
    save: (k, rows) => NV.store.set('tbl:' + k, rows),
    insert(k, row) { const rows = this.list(k); row.id = row.id || Date.now(); row.created_at = new Date().toISOString(); rows.unshift(row); this.save(k, rows); return row; }
  };
  NV.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms || 250); }; };
  NV.catLabel = (slug) => ({food:'Food',travel:'Travel',music:'Music',events:'Events',culture:'Culture',business:'Business',fashion:'Fashion'}[slug] || slug);
  NV.catIcon = (slug) => ({food:'utensils',travel:'plane',music:'music',events:'calendar',culture:'masks',business:'briefcase',fashion:'shirt'}[slug] || 'flame');
})(window.NV);
