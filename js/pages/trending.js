NV.pages.trending = async function () {
  const trendList = NV.$('#trend-list');
  if (!trendList) return;
  trendList.innerHTML = '<p class="muted">Loading trending posts…</p>';
  try {
    const posts = await NV.services.posts.list({ limit: 50 });
    if (!posts || !posts.length) {
      trendList.innerHTML = '<p class="empty">No trending posts yet. <a href="create-post.html">Be the first to share something!</a></p>';
      return;
    }
    const items = posts.slice().sort((a, b) => (Number(b.views || 0) + Number(b.likes || 0)) - (Number(a.views || 0) + Number(a.likes || 0)));
    trendList.innerHTML = items.map((p, i) => {
      const cat = p.category || p.cat || 'culture';
      return `<article class="card trend-item">
        <span class="rank">${i + 1}</span>
        <div class="trend-photo" data-image-query="${NV.esc(`${p.title} ${p.place || p.state || 'Nigeria'}`)}" data-image-fallback="Nigerian ${NV.esc(cat)}">
          <a class="trend-photo-link" href="${NV.router.postUrl(p.id)}" aria-label="${NV.esc(p.title)}"></a>
          <a class="photo-credit" data-photo-credit hidden target="_blank" rel="noopener noreferrer"></a>
        </div>
        <a href="${NV.router.postUrl(p.id)}" style="flex:1">
          <span class="tag tag-${NV.esc(cat)}">${NV.catLabel(cat)}</span>
          <h3 style="font-size:16px;margin-top:6px">${NV.esc(p.title)}</h3>
          <p class="muted">${NV.icon('eye')} ${p.views || 0} · ${NV.icon('heart')} ${p.likes || 0} · ${NV.icon('pin')} ${NV.esc(p.place || p.state || 'Nigeria')}</p>
        </a>
      </article>`;
    }).join('');
    if (NV.services.images) NV.services.images.setupLazyPostImages(trendList);
  } catch (err) {
    console.error('Could not load trending posts:', err);
    trendList.innerHTML = '<p class="empty">Trending posts are temporarily unavailable. Please refresh.</p>';
  }
};
NV.pages.saved = async function () {
  const ids = NV.services.posts.savedIds().map(String); const all = await NV.services.posts.list();
  const mine = all.filter(p => ids.includes(String(p.id)));
  const postBox = NV.$('#saved-list');
  postBox.innerHTML = mine.length ? mine.map(NV.feedPost).join('') : '<p class="empty">No saved posts yet.</p>';
  NV.bindFeed(postBox);
  const newsBox = NV.$('#saved-news-list');
  const savedNews = NV.services.news.saved();
  newsBox.innerHTML = savedNews.length
    ? savedNews.map(item => NV.newsCard(item)).join('')
    : '<p class="empty">No saved news stories yet. Save a story to keep it here on this device.</p>';
  NV.bindNewsComments(newsBox);
};
NV.pages.videos = async function () {
  const box = NV.$('#video-list');
  const status = NV.$('#video-status');
  const stateFilter = NV.$('#video-state');
  const refreshButton = NV.$('#refresh-videos');
  stateFilter.innerHTML += window.NV_STATES.map(state => `<option value="${NV.esc(state.name)}">${NV.esc(state.name)}</option>`).join('');
  const refresh = async () => {
    refreshButton.disabled = true;
    status.textContent = 'Loading trending Nigerian videos…';
    try {
      const result = await NV.services.posts.videos({ state: stateFilter.value, limit: 100 });
      const videos = result.items;
      const youtube = result.sources.youtube || { status: 'not_configured' };
      box.innerHTML = videos.map(NV.videoCard).join('')
        || `<p class="empty">No videos from ${NV.esc(stateFilter.value || 'Nigeria')} have been shared yet. <a href="${NV.url('create-post.html')}">Share the first video</a>.</p>`;
      NV.bindVideoViews(box);
      const youtubeCount = videos.filter(video => video.source === 'youtube').length;
      const creatorCount = videos.length - youtubeCount;
      if (youtube.status === 'not_configured') {
        status.textContent = `${creatorCount} NaijaVibe creator videos · Add YOUTUBE_API_KEY to the server .env file to show Nigeria-wide YouTube trends.`;
      } else if (youtube.status === 'unavailable') {
        status.textContent = `YouTube trends are temporarily unavailable. ${creatorCount} NaijaVibe creator videos are shown when available.`;
      } else if (youtube.status === 'stale') {
        status.textContent = `Showing cached YouTube trends and ${creatorCount} NaijaVibe creator videos.`;
      } else if (youtube.status === 'national_only') {
        status.textContent = `${creatorCount} NaijaVibe videos from ${stateFilter.value}. YouTube trends are Nigeria-wide and appear under All Nigeria.`;
      } else {
        status.textContent = `${youtubeCount} trending YouTube videos from Nigeria · ${creatorCount} NaijaVibe creator videos`;
      }
    } catch (error) {
      console.error('Could not load trending Nigerian videos:', error);
      box.replaceChildren();
      status.textContent = 'Trending videos are temporarily unavailable. Please try again.';
    } finally {
      refreshButton.disabled = false;
    }
  };
  stateFilter.addEventListener('change', refresh);
  refreshButton.addEventListener('click', refresh);
  await refresh();
};
NV.pages.watch = async function () {
  const id = NV.param('id') || '';
  let v;
  try {
    v = await NV.services.posts.getVideo(id);
  } catch (error) {
    console.error('Could not load video:', error);
    NV.$('#video-title').textContent = 'Video unavailable';
    NV.$('#video-message').textContent = 'This video could not be loaded. Browse trending videos across Nigeria and try another clip.';
    NV.$('#related').innerHTML = `<a class="btn btn-primary" href="${NV.url('videos.html')}">Browse trending videos</a>`;
    return;
  }
  if (!v) {
    NV.$('#video-title').textContent = 'Video not found';
    NV.$('#video-player-wrap').replaceChildren();
    NV.$('#video-message').hidden = false;
    NV.$('#related').replaceChildren();
    return;
  }
  NV.$('#video-title').textContent = v.title; document.title = v.title + ' · NaijaVibe';
  NV.$('#video-state').textContent = `${v.state || v.place || 'Nigeria'} · ${v.user || v.profiles?.username || 'NaijaVibe creator'}`;
  const creator = String(v.user || v.profiles?.username || '').replace(/^@/, '');
  const username = /^[a-z0-9_]{3,20}$/i.test(creator) ? creator : '';
  const player = NV.videoPlayer(v, true);
  if (player) {
    NV.$('#video-message').hidden = true;
    NV.$('#video-player-wrap').innerHTML = `<article class="video-card" data-video-id="${NV.esc(v.id)}">
      ${player}
      <div class="video-card-meta"><span>${NV.esc(v.state || v.place || 'Nigeria')}</span><span><b data-video-views>${(Number(v.views) || 0).toLocaleString('en-NG')}</b> views this week</span></div>
      <div class="video-card-creator">${username ? `<a href="${NV.url('profile.html?user=' + encodeURIComponent(username))}">@${NV.esc(username)}</a><button type="button" data-follow-creator="${NV.esc(username)}" class="btn btn-outline btn-sm">Follow</button>` : '<span>NaijaVibe creator</span>'}</div>
    </article>`;
    NV.bindVideoViews(NV.$('#video-player-wrap'));
  } else {
    NV.$('#video-message').hidden = false;
    NV.$('#video-player-wrap').replaceChildren();
  }
  try {
    const result = await NV.services.posts.videos({ state: v.state || undefined, limit: 5 });
    const videos = result.items
      .filter(video => String(video.id) !== String(v.id));
    NV.$('#related').innerHTML = videos.map(NV.videoCard).join('') || '<p class="empty">No other videos from this area yet.</p>';
    NV.bindVideoViews(NV.$('#related'));
  } catch (error) {
    console.error('Could not load related videos:', error);
    NV.$('#related').innerHTML = '<p class="empty">More videos are temporarily unavailable.</p>';
  }
};
