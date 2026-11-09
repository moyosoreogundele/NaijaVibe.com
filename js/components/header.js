(function (NV) {
  const NAV = [
    ['home','home','index.html','Home'],['explore','map','explore.html','Explore'],['live','camera','live.html','Live'],['videos','play','videos.html','Videos'],['food','utensils','explore.html?cat=food','Food'],
    ['culture','masks','explore.html?cat=culture','Culture'],['events','calendar','events.html','Events'],['marketplace','store','marketplace.html','Shop']
  ];
  const ICON = { map: 'pin' };
  const MORE = [['Messages','messages.html'],['Trending','trending.html'],['Businesses','businesses/index.html'],['States','states/index.html'],['Saved','saved.html'],['About','about.html'],['Contact','contact.html']];

  NV.renderHeader = function () {
    const host = NV.$('#site-header'); if (!host) return;
    const active = document.body.dataset.nav || '';
    const nav = NAV.map(n => `<a href="${NV.url(n[2])}" class="${n[0] === active ? 'active' : ''}" aria-label="${n[3]}">${NV.icon(ICON[n[1]] || n[1])}<span>${n[3]}</span></a>`).join('');
    host.innerHTML = `
    <header class="site-header">
      <div class="top-bar">
        <a class="logo" href="${NV.url('index.html')}" aria-label="NaijaVibe home"><img src="${NV.url('assets/logos/logo.svg')}" alt=""><span><b>NAIJAVIBE</b><small>Our People &nbsp;•&nbsp; Our Culture &nbsp;•&nbsp; Our Nigeria</small></span></a>
        <form class="header-search" action="${NV.url('search.html')}" role="search">
          ${NV.icon('search')}<input name="q" type="search" placeholder="Search places, food, events, businesses, people..." aria-label="Search">
          <button type="submit" aria-label="Search">${NV.icon('search')}</button>
        </form>
        <div class="header-actions">
          <a class="icon-btn" href="${NV.url('notifications.html')}" aria-label="Notifications">${NV.icon('bell')}<span class="badge" data-notif-count hidden>0</span></a>
          <a class="icon-btn" href="${NV.url('messages.html')}" aria-label="Messages">${NV.icon('message')}</a>
          <a class="btn btn-primary" href="${NV.url('login.html')}" data-auth="out">Login</a>
          <a class="btn btn-outline" href="${NV.url('signup.html')}" data-auth="out">Sign Up</a>
          <a class="btn btn-outline" href="${NV.url('profile.html')}" data-auth="in" hidden>Profile</a>
          <button class="icon-btn" data-menu aria-label="Open menu">${NV.icon('menu')}</button>
        </div>
      </div>
      <nav class="main-nav" aria-label="Main">
        ${nav}
        <div class="more-wrap"><a href="#" onclick="return false" role="button" style="display:flex">More ${NV.icon('chevron')}</a>
          <div class="more-menu">${MORE.map(m => `<a href="${NV.url(m[1])}">${m[0]}</a>`).join('')}</div></div>
      </nav>
    </header>`;
    // overwrite "More" trigger as a real button for the menu handler
    const a = NV.$('.more-wrap > a', host); const b = document.createElement('button'); b.innerHTML = a.innerHTML; b.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 12px;font-size:12.5px;font-weight:500'; a.replaceWith(b);
    NV.services.auth.getUser().then(u => { if (u) { NV.$$('[data-auth=out]', host).forEach(e => e.hidden = true); NV.$$('[data-auth=in]', host).forEach(e => e.hidden = false); } });
  };

  NV.renderFooter = function () {
    const host = NV.$('#site-footer'); if (!host) return;
    const L = (t, p) => `<a href="${NV.url(p)}">${t}</a>`;
    host.innerHTML = `
    <footer class="site-footer">
      <div><a class="logo" href="${NV.url('index.html')}"><img src="${NV.url('assets/logos/logo.svg')}" alt=""><b>NAIJAVIBE</b></a><small style="display:block;margin-top:4px;color:#cfe3d6">Our People &nbsp;•&nbsp; Our Culture &nbsp;•&nbsp; Our Nigeria.</small></div>
      <div><h4>Quick Links</h4><div class="quick-cols"><div>${L('Home','index.html')}${L('Explore Nigeria','explore.html')}${L('Food','explore.html?cat=food')}</div><div>${L('Events','events.html')}${L('Marketplace','marketplace.html')}${L('Videos','videos.html')}</div></div></div>
      <div><h4>Resources</h4>${L('About Us','about.html')}${L('Contact','contact.html')}${L('Help & Support','contact.html')}${L('Privacy Policy','privacy.html')}${L('Terms of Service','terms.html')}</div>
      <div><h4>Get the latest updates</h4><form class="subscribe" id="subscribe"><input type="email" placeholder="Enter your email address" aria-label="Email" required><button>Subscribe</button></form></div>
      <div class="copyright">© 2025 NaijaVibe. All rights reserved.</div>
      <div class="tagline">Feel Nigeria. Discover Nigeria.</div>
    </footer>`;
    NV.$('#subscribe').addEventListener('submit', e => { e.preventDefault(); e.target.reset(); NV.toast('Thanks for subscribing!', 'success'); });
  };
})(window.NV);
