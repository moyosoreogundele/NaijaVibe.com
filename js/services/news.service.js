(function (NV) {
  const renderedItems = new Map();

  async function request(url, options = {}) {
    const response = await fetch(url, Object.assign({
      headers: { Accept: 'application/json' },
      credentials: 'same-origin'
    }, options));
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error && result.error.message || 'News updates are temporarily unavailable.');
    return result;
  }

  function storyForStorage(item) {
    return {
      id: item.id,
      title: item.title,
      url: item.url,
      sourceUrl: item.sourceUrl,
      source: item.source,
      publisher: item.publisher,
      publishedAt: item.publishedAt,
      summary: item.summary,
      imageUrl: item.imageUrl,
      videoUrl: item.videoUrl,
      likes: Number(item.likes) || 0,
      liked: item.liked === true
    };
  }

  NV.services.news = {
    remember(item) {
      renderedItems.set(String(item.id), storyForStorage(item));
    },
    isSaved(id) {
      return NV.store.get('saved-news', []).some(item => String(item.id) === String(id));
    },
    isLiked(id) {
      return renderedItems.get(String(id))?.liked === true;
    },
    saved() {
      return NV.store.get('saved-news', []);
    },
    save(id) {
      const saved = this.saved();
      const index = saved.findIndex(item => String(item.id) === String(id));
      if (index >= 0) {
        saved.splice(index, 1);
        NV.store.set('saved-news', saved);
        return false;
      }
      const item = renderedItems.get(String(id));
      if (!item) throw new Error('This story is no longer available to save. Refresh the page and try again.');
      saved.unshift(item);
      NV.store.set('saved-news', saved.slice(0, 100));
      return true;
    },
    async like(id) {
      const result = await request(`/api/news/${encodeURIComponent(id)}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      const item = renderedItems.get(String(id));
      if (item) item.liked = result.liked;
      return result;
    },
    async list() {
      const result = await request('/api/news/nigeria');
      if (!Array.isArray(result.items)) {
        throw new Error('The Nigeria news service returned an invalid response.');
      }
      return result;
    },
    async refresh() {
      const result = await request('/api/news/nigeria?refresh=true');
      if (!Array.isArray(result.items)) throw new Error('The Nigeria news service returned an invalid response.');
      return result;
    },
    async state(slug, refresh = false) {
      const result = await request(`/api/states/${encodeURIComponent(slug)}/updates${refresh ? '?refresh=true' : ''}`);
      if (!Array.isArray(result.news) || !Array.isArray(result.events)) {
        throw new Error('The state news service returned an invalid response.');
      }
      return result;
    },
    async events(refresh = false) {
      const result = await request(`/api/news/events${refresh ? '?refresh=true' : ''}`);
      if (!Array.isArray(result.items)) throw new Error('The events service returned an invalid response.');
      return result;
    }
  };
})(window.NV);
