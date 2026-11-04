(function (NV) {
  NV.services.businesses = {
    async list(params = {}) {
      try {
        const query = new URLSearchParams();
        if (params.cat && params.cat !== 'all') query.set('cat', params.cat);
        if (params.state && params.state !== 'all') query.set('state', params.state);
        if (params.search) query.set('search', params.search);
        const url = '/api/businesses' + (query.toString() ? '?' + query.toString() : '');
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.items) && data.items.length) {
            return data.items;
          }
        }
      } catch (err) {
        console.error('Failed to fetch businesses:', err);
      }
      return NV.demo().businesses || [];
    },

    async get(id) {
      try {
        const res = await fetch(`/api/businesses/${encodeURIComponent(id)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.business) return data.business;
        }
      } catch (err) {}
      const fallbackList = await this.list();
      return fallbackList.find(b => String(b.id) === String(id)) || null;
    },

    async register(business) {
      const res = await fetch('/api/businesses', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(business)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error?.message || 'Could not register business.');
      }
      return data.business;
    }
  };
})(window.NV);
