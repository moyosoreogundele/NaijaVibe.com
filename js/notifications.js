(function (NV) {
  NV.notifications = {
    list() { return NV.store.get('notifs', NV.demo().notifications || []); },
    unread() { return this.list().filter(n => n.unread).length; },
    markAll() { NV.store.set('notifs', this.list().map(n => Object.assign(n, { unread: false }))); this.refresh(); },
    refresh() { NV.$$('[data-notif-count]').forEach(b => { const n = this.unread(); b.textContent = n; b.hidden = !n; }); }
  };
})(window.NV);
