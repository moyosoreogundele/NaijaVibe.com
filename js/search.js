(function (NV) {
  NV.search = {
    async run(q) {
      q = (q || '').toLowerCase().trim(); if (!q) return [];
      const out = [];
      (window.NV_STATES || []).forEach(s => { 
        if ((s.name + s.capital + s.region).toLowerCase().includes(q)) {
          out.push({ type: 'State', title: s.name, sub: s.capital + ' · ' + s.region, href: NV.router.stateUrl(s.slug), image: s.image });
        }
      });
      const [posts, businesses, products] = await Promise.all([
        NV.services.posts.list({ limit: 100 }).catch(() => []),
        NV.services.businesses.list().catch(() => []),
        NV.services.products.list().catch(() => [])
      ]);
      posts.forEach(p => { 
        if (((p.title || '') + (p.place || p.state || '') + (p.text || '')).toLowerCase().includes(q)) {
          out.push({ type: 'Post', title: p.title || p.text || 'Post', sub: p.place || p.state || 'Nigeria', href: NV.router.postUrl(p.id), image: p.image });
        }
      });
      businesses.forEach(b => { 
        if (((b.name || '') + (b.cat || '') + (b.state || '')).toLowerCase().includes(q)) {
          out.push({ type: 'Business', title: b.name, sub: b.cat || b.state, href: NV.router.businessUrl(b.id), image: b.image });
        }
      });
      products.forEach(p => { 
        if (((p.name || '') + (p.seller || '') + (p.category || '')).toLowerCase().includes(q)) {
          out.push({ type: 'Product', title: p.name, sub: NV.money(p.price), href: NV.router.productUrl(p.id), image: p.image });
        }
      });
      return out;
    }
  };
})(window.NV);
