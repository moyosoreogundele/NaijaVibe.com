(function (NV) {
  NV.theme = {
    apply(t) { document.documentElement.dataset.theme = t; NV.store.set('theme', t); },
    toggle() { this.apply(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); },
    init() { this.apply(NV.store.get('theme', 'light')); }
  };
  NV.theme.init();
})(window.NV);
