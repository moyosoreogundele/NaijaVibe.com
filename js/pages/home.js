NV.pages.home = async function () {
  const d = NV.demo(), cats = window.NV_CATEGORIES;
  NV.$('#cat-strip').innerHTML = cats.map(c => `<a href="${NV.url(c.slug === 'events' ? 'events.html' : c.slug === 'marketplace' ? 'marketplace.html' : c.slug === 'businesses' ? 'businesses/index.html' : 'explore.html?cat=' + c.slug)}"><span class="ic">${NV.icon(c.icon)}</span>${c.name}</a>`).join('');
  NV.$('#trending').innerHTML = d.trending.map(p => NV.postCard(p)).join('');
  const stateCards = NV.$('#states');
  stateCards.innerHTML = window.NV_STATES.filter(s => ['Lagos','FCT Abuja','Kano','Rivers','Oyo','Enugu','Kaduna'].includes(s.name)).sort((a, b) => b.places - a.places).map(NV.stateCard).join('');
  NV.services.images.setupLazyStateImages(stateCards);
  NV.services.images.setupSlideshowImages(NV.$('.hero'));
  NV.renderSidebar(NV.$('#home-side'));
  NV.$('#hero-form').addEventListener('submit', e => { e.preventDefault(); const q = e.target.q.value.trim(); NV.router.go('search.html?q=' + encodeURIComponent(q)); });
  const newsList = NV.$('#news-list');
  const newsStatus = NV.$('#news-updated');
  const sideEvents = NV.$('#side-event-updates');
  const refreshEvents = async force => {
    try {
      const result = await NV.services.events.list(force);
      sideEvents.innerHTML = result.items.slice(0, 3).map(item => {
        let url;
        try {
          url = new URL(item.url);
        } catch {
          return '';
        }
        if (url.protocol !== 'https:') return '';
        return `<a class="side-event-item" href="${NV.esc(url.toString())}" target="_blank" rel="noopener noreferrer">${NV.esc(item.title)}<small>${NV.esc(item.source)} · ${NV.esc(item.publishedAt ? new Date(item.publishedAt).toLocaleDateString() : 'Latest')}</small></a>`;
      }).join('') || '<p class="muted">No current event coverage is available.</p>';
    } catch (error) {
      console.error('Could not load sidebar event coverage:', error);
      sideEvents.innerHTML = '<p class="muted">Event coverage is temporarily unavailable.</p>';
    }
  };
  const refreshNews = async force => {
    const button = NV.$('#refresh-news');
    button.disabled = true;
    newsStatus.textContent = 'Loading current headlines…';
    try {
      const news = force ? await NV.services.news.refresh() : await NV.services.news.list();
      newsList.innerHTML = news.items.map(item => NV.newsCard(item)).join('') || '<p class="empty">No current headlines are available right now.</p>';
      NV.bindNewsComments(newsList);
      newsStatus.textContent = `Updated ${new Date(news.updatedAt).toLocaleTimeString()}${news.stale ? ' · showing the last available headlines' : ''}`;
    } catch (error) {
      console.error('Could not load current Nigeria headlines:', error);
      newsStatus.textContent = 'Nigeria news is temporarily unavailable. Please try refreshing again later.';
      newsList.replaceChildren();
    } finally {
      button.disabled = false;
    }
  };
  NV.$('#refresh-news').addEventListener('click', async () => {
    await Promise.all([refreshNews(true), refreshEvents(true)]);
  });
  await Promise.all([refreshEvents(false), refreshNews(false)]);
  window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      refreshNews(false);
      refreshEvents(false);
    }
  }, 60 * 60 * 1000);
};
