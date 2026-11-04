(function (NV) {
  NV.stateCard = s => `<article class="state-card">
    <div class="pic" data-image-query="${NV.esc(s.capital)}" data-image-fallback="${NV.esc(`${s.name} Nigeria`)}">
      <a class="state-card-image-link" href="${NV.router.stateUrl(s.slug)}" aria-label="Explore ${NV.esc(s.name)}"></a>
      <a class="photo-credit" data-photo-credit hidden target="_blank" rel="noopener noreferrer" aria-label="Photo attribution"></a>
    </div>
    <a class="info" href="${NV.router.stateUrl(s.slug)}"><b>${NV.icon('pin')}${NV.esc(s.name.replace('FCT ', ''))}</b><small>(${s.places >= 1000 ? (s.places / 1000).toFixed(1) + 'k' : s.places} places)</small></a>
  </article>`;
})(window.NV);
