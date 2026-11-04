(function (NV) {
  NV.navigation = {
    bind() {
      const more = NV.$('.more-wrap');
      if (more) {
        NV.$('button', more).addEventListener('click', (e) => { e.stopPropagation(); more.classList.toggle('open'); });
        document.addEventListener('click', () => more.classList.remove('open'));
      }
      const drawer = NV.$('.drawer');
      const toggle = (o) => drawer && drawer.classList.toggle('open', o);
      NV.$$('[data-menu]').forEach(b => b.addEventListener('click', () => toggle(true)));
      if (drawer) drawer.addEventListener('click', (e) => { if (e.target === drawer || e.target.closest('[data-close]')) toggle(false); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
      const th = NV.$('[data-theme-toggle]'); if (th) th.addEventListener('click', () => NV.theme.toggle());
    }
  };
})(window.NV);
