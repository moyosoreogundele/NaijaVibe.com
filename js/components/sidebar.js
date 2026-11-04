(function (NV) {
  /* Right-hand column used on the home page */
  NV.renderSidebar = function (host) {
    const d = NV.demo();
    host.innerHTML = `
    <div class="explore-card">
      <h3>Explore Nigeria's 36 States + FCT</h3>
      <p>Discover unique cultures, food, attractions and opportunities in every state.</p>
      <a class="btn btn-white" href="${NV.url('states/index.html')}">Explore Now ${NV.icon('arrow')}</a>
      <svg class="map" viewBox="0 0 100 100" aria-hidden="true"><path d="M12 28l10-6 12 2 8-6 14 4 10-3 12 8-2 14 8 10-6 12-8 6-4 14-10 6-8-8-10 2-6-12-10-6 2-14-6-8z" fill="#bff0cf" stroke="#fff" stroke-width="2"/></svg>
    </div>
    <section class="side-box"><div class="section-title"><span class="flame">${NV.icon('flame')}</span><h2>Popular Posts</h2><span class="grow"></span><a class="text-link" href="${NV.url('trending.html')}">View all ${NV.icon('arrow')}</a></div>
      ${(d.popular || []).map((p, i) => `<article class="pop"><span class="n">${i + 1}</span><div class="pop-image" data-image-query="${NV.esc(`${p.title} Nigeria`)}" data-image-fallback="Nigerian ${i === 1 ? 'food' : 'culture'}"><a href="${NV.router.postUrl(i + 1)}" class="pop-image-link" aria-label="${NV.esc(p.title)}"></a><a class="photo-credit" data-photo-credit hidden target="_blank" rel="noopener noreferrer"></a></div><a class="pop-copy" href="${NV.router.postUrl(i + 1)}"><h4>${NV.esc(p.title)}</h4><small>${NV.esc(p.user)}</small><div class="m"><span>${NV.icon('eye')}${p.views}</span><span>${NV.icon('heart')}${p.likes}</span></div></a></article>`).join('')}
    </section>
    <section class="side-box"><div class="section-title"><span class="cal">${NV.icon('calendar')}</span><h2>Upcoming Events</h2><span class="grow"></span><a class="text-link" href="${NV.url('events.html')}">View all ${NV.icon('arrow')}</a></div>
      <div id="side-event-updates"><p class="muted">Loading event coverage…</p></div></section>
    <div class="shop-card"><h3>Shop Local, Support Nigerian Businesses</h3><a class="btn" href="${NV.url('marketplace.html')}">Visit Marketplace ${NV.icon('arrow')}</a></div>`;
  };
})(window.NV);
