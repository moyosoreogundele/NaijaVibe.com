(function (NV) {
  NV.search = {
    async run(q) {
      q = (q || '').toLowerCase().trim(); if (!q) return [];
      const d = NV.demo(); const out = [];
      (window.NV_STATES || []).forEach(s => { if ((s.name + s.capital + s.region).toLowerCase().includes(q)) out.push({ type: 'State', title: s.name, sub: s.capital + ' · ' + s.region, href: NV.router.stateUrl(s.slug), image: s.image }); });
      (d.trending || []).forEach(p => { if ((p.title + p.place).toLowerCase().includes(q)) out.push({ type: 'Post', title: p.title, sub: p.place, href: NV.router.postUrl(p.id), image: p.image }); });
      (await NV.services.businesses.list()).forEach(b => { if ((b.name + b.cat + b.state).toLowerCase().includes(q)) out.push({ type: 'Business', title: b.name, sub: b.cat, href: NV.router.businessUrl(b.id), image: b.image }); });
      (d.products || []).forEach(p => { if ((p.name + p.seller).toLowerCase().includes(q)) out.push({ type: 'Product', title: p.name, sub: NV.money(p.price), href: NV.router.productUrl(p.id), image: p.image }); });
      return out;
    }
  };
})(window.NV);
