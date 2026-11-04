/* Tiny helpers for multi-page navigation: query params and guarded routes */
(function (NV) {
  NV.router = {
    go(path) { location.href = NV.url(path); },
    stateUrl(slug) { return NV.url('states/state.html?s=' + encodeURIComponent(slug)); },
    postUrl(id) { return NV.url('posts/post.html?id=' + id); },
    businessUrl(id) { return NV.url('businesses/business.html?id=' + id); },
    productUrl(id) { return NV.url('products/product.html?id=' + id); },
    requireAuth() {
      NV.services.auth.getUser().then(u => { if (!u) NV.router.go('login.html?next=' + encodeURIComponent(location.pathname)); });
    }
  };
})(window.NV);
