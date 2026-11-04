NV.pages.explore = function () {
  const cat = NV.param('cat'); const list = NV.$('#explore-list'); const region = NV.$('#region');
  const render = () => { const r = region.value; list.innerHTML = window.NV_STATES.filter(s => !r || s.region === r).map(NV.stateCard).join(''); };
  [...new Set(window.NV_STATES.map(s => s.region))].forEach(r => region.insertAdjacentHTML('beforeend', `<option>${r}</option>`));
  region.addEventListener('change', render); render();
  if (cat) NV.$('#explore-title').textContent = NV.catLabel(cat) + ' across Nigeria';
  const t = NV.$('#explore-posts'); if (t) t.innerHTML = NV.demo().trending.filter(p => !cat || p.cat === cat).map(p => NV.postCard(p, { big: true })).join('') || '<p class="empty">Nothing here yet. Be the first to post.</p>';
};
NV.pages.states = function () {
  const g = NV.$('#states-grid'), q = NV.$('#state-q'); const draw = () => { const v = q.value.toLowerCase(); g.innerHTML = window.NV_STATES.filter(s => s.name.toLowerCase().includes(v) || s.region.toLowerCase().includes(v)).map(NV.stateCard).join('') || '<p class="empty">No state matches your search.</p>'; NV.services.images.setupLazyStateImages(g); };
  q.addEventListener('input', draw); draw();
};
NV.pages.state = async function () {
  const slug = NV.param('s') || 'lagos'; const s = window.NV_STATES.find(x => x.slug === slug) || window.NV_STATES[0];
  document.title = s.name + ' · NaijaVibe';
  NV.$('#state-hero').style.backgroundImage = '';
  NV.services.images.findStateImage(s.capital, s.name).then(photo => {
    if (!photo) return;
    NV.$('#state-hero').style.backgroundImage = `url("${photo.url.replace(/["\\]/g, '')}")`;
    const credit = NV.$('#state-photo-credit');
    credit.href = photo.sourceUrl;
    credit.textContent = photo.artist ? `Photo: ${photo.artist}${photo.license ? ` · ${photo.license}` : ''}` : 'Wikimedia Commons';
    credit.hidden = false;
  });
  NV.$('#state-name').textContent = s.name; NV.$('#state-meta').textContent = `Capital: ${s.capital} · ${s.region} · ${s.places.toLocaleString()} places`;
  NV.$('#state-live-link').href = NV.url('live.html?state=' + encodeURIComponent(s.name));
  NV.$('#state-about').textContent = s.about;
  NV.$('#updates-state-name').textContent = s.name;
  const localCulture = window.NV_STATE_CULTURE[s.slug];
  NV.$('#state-food').innerHTML = localCulture.foods.map(food => `<li>${NV.esc(food)}</li>`).join('');
  NV.$('#state-culture').textContent = localCulture.culture;
  NV.$('#state-posts').innerHTML = NV.demo().trending.map(p => NV.postCard(Object.assign({}, p, { place: s.name }))).join('');
  const newsList = NV.$('#state-news-list');
  const eventsList = NV.$('#state-events-list');
  const status = NV.$('#state-updates-status');
  const refresh = NV.$('#refresh-state-updates');
  const loadUpdates = async force => {
    refresh.disabled = true;
    status.textContent = `Loading current ${s.name} updates…`;
    try {
      const updates = await NV.services.news.state(s.slug, force);
      newsList.innerHTML = updates.news.map(item => NV.newsCard(item)).join('') || '<p class="empty">No current state headlines are available.</p>';
      eventsList.innerHTML = updates.events.map(item => NV.newsCard(item, item.source)).join('') || '<p class="empty">No current event coverage is available for this state.</p>';
      NV.bindNewsComments(newsList);
      NV.bindNewsComments(eventsList);
      const hasCoverage = updates.news.length || updates.events.length;
      status.textContent = hasCoverage
        ? `Updated ${new Date(updates.updatedAt).toLocaleTimeString()} · recent reports mentioning ${s.name}${updates.stale ? ' · showing recent cached updates' : ''}`
        : `No recent news or event reports mentioning ${s.name} were found. Try refreshing later.`;
    } catch (error) {
      console.error(`Could not load ${s.name} updates:`, error);
      status.textContent = `${s.name} news and event coverage is temporarily unavailable. Try refreshing again later.`;
      newsList.replaceChildren();
      eventsList.replaceChildren();
    } finally {
      refresh.disabled = false;
    }
  };
  refresh.addEventListener('click', () => loadUpdates(true));
  await loadUpdates(false);
  window.setInterval(() => {
    if (document.visibilityState === 'visible') loadUpdates(false);
  }, 60 * 60 * 1000);
};
NV.pages.search = async function () {
  const q = NV.param('q') || ''; NV.$('#search-q').value = q;
  const run = async (v) => { const r = await NV.search.run(v); NV.$('#results').innerHTML = !v ? '<p class="empty">Type something to search places, food, events, businesses and people.</p>' : r.length ? r.map(x => `<article class="card search-result"><div class="search-result-image" data-image-query="${NV.esc(`${x.title} ${x.sub}`)}" data-image-fallback="Nigeria ${NV.esc(x.type)}"><a class="search-image-link" href="${NV.esc(x.href)}" aria-label="${NV.esc(x.title)}"></a><a class="photo-credit" data-photo-credit hidden target="_blank" rel="noopener noreferrer"></a></div><a class="search-result-copy" href="${NV.esc(x.href)}"><b>${NV.esc(x.title)}</b><p class="muted">${NV.esc(x.sub)}</p></a><span class="chip chip-food">${NV.esc(x.type)}</span></article>`).join('') : `<p class="empty">No results for “${NV.esc(v)}”. Try a state, a dish or an event name.</p>`; NV.hydrateIcons(); if (NV.services.images) NV.services.images.setupLazyImages(NV.$('#results')); };
  NV.$('#search-q').addEventListener('input', NV.debounce(e => { run(e.target.value); history.replaceState(null, '', '?q=' + encodeURIComponent(e.target.value)); }));
  run(q);
};
