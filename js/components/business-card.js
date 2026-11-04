(function (NV) {
  NV.businessCard = (b) => `<article class="post-card big">
    <div class="thumb" data-image-query="${NV.esc(`${b.name} ${b.state} Nigeria`)}" data-image-fallback="Nigerian ${NV.esc(b.cat || 'business')}">
      <a class="thumb-link" href="${NV.router.businessUrl(b.id)}" aria-label="${NV.esc(b.name)}"></a>
      <a class="photo-credit" data-photo-credit hidden target="_blank" rel="noopener noreferrer"></a>
    </div>
    <a class="body" href="${NV.router.businessUrl(b.id)}"><h3>${NV.esc(b.name)}</h3><div class="meta"><span>${NV.esc(b.cat)}</span><span class="where">${NV.icon('pin')}${NV.esc(b.state)}</span><span>★ ${b.rating}</span></div></a>
  </article>`;
})(window.NV);
