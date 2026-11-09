(function (NV) {
  NV.renderDrawer = function () {
    if (NV.$('.drawer')) return;
    const L = (i, t, p) => `<a href="${NV.url(p)}">${NV.icon(i)}${t}</a>`;
    const d = document.createElement('div'); d.className = 'drawer';
    d.innerHTML = `<aside class="drawer-panel" aria-label="Menu"><button data-close class="icon-btn" aria-label="Close menu" style="align-self:flex-end">${NV.icon('x')}</button>
      ${L('user','My profile','profile.html')}${L('camera','Naija Live','live.html')}${L('message','Messages','messages.html')}${L('play','Videos','videos.html')}${L('bookmark','Saved','saved.html')}${L('bell','Notifications','notifications.html')}${L('flame','Trending','trending.html')}
      ${L('briefcase','Businesses','businesses/index.html')}${L('cart','Cart','products/cart.html')}<hr>${L('settings','Settings','settings.html')}
      <a href="#" data-theme-toggle>${NV.icon('moon')}Dark / light mode</a><a href="#" id="logout">${NV.icon('logout')}Log out</a></aside>`;
    document.body.appendChild(d);
    NV.$('#logout').addEventListener('click', async (e) => { e.preventDefault(); await NV.services.auth.signOut(); NV.toast('Logged out', 'success'); setTimeout(() => NV.router.go('index.html'), 600); });
  };
})(window.NV);
