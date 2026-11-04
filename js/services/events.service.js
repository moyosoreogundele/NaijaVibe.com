(function (NV) {
  NV.services.events = {
    async list(refresh = false) {
      return NV.services.news.events(refresh);
    }
  };
})(window.NV);
