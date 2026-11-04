(function (NV) {
  NV.services.products = {
    async list(params = {}) {
      try {
        const query = new URLSearchParams();
        if (params.category && params.category !== 'all') query.set('category', params.category);
        if (params.state && params.state !== 'all') query.set('state', params.state);
        if (params.search) query.set('search', params.search);
        if (params.business_id) query.set('business_id', params.business_id);
        const url = '/api/products' + (query.toString() ? '?' + query.toString() : '');
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.items) && data.items.length) {
            return data.items;
          }
        }
      } catch (err) {
        console.error('Failed to fetch products from backend:', err);
      }
      return NV.demo().products || [];
    },

    async get(id) {
      try {
        const res = await fetch(`/api/products/${encodeURIComponent(id)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.product) return data.product;
        }
      } catch (err) {}
      const fallbackList = await this.list();
      return fallbackList.find(p => String(p.id) === String(id)) || null;
    },

    async create(product) {
      const res = await fetch('/api/products', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(product)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error?.message || 'Could not list product on the marketplace.');
      }
      return data.product;
    },

    cart() {
      return NV.store.get('cart', []);
    },

    add(id, qty = 1) {
      const c = this.cart();
      const strId = String(id);
      const r = c.find(i => String(i.id) === strId);
      if (r) {
        r.qty += qty;
      } else {
        c.push({ id: strId, qty });
      }
      NV.store.set('cart', c);
      return c;
    },

    setQty(id, qty) {
      const strId = String(id);
      let c = this.cart().map(i => String(i.id) === strId ? { id: strId, qty } : i).filter(i => i.qty > 0);
      NV.store.set('cart', c);
      return c;
    },

    clearCart() {
      NV.store.set('cart', []);
      return [];
    },

    count() {
      return this.cart().reduce((n, i) => n + i.qty, 0);
    },

    async checkout(orderDetails) {
      const res = await fetch('/api/orders', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderDetails)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error?.message || 'Could not place order. Please review your details.');
      }
      this.clearCart();
      return data.order;
    },

    async getOrders() {
      try {
        const res = await fetch('/api/orders', { credentials: 'same-origin' });
        if (res.ok) {
          const data = await res.json();
          return data.orders || [];
        }
      } catch (err) {}
      return [];
    }
  };
})(window.NV);
