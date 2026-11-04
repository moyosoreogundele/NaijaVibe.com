(function (NV) {
  NV.postCard = (p, opts = {}) => {
    const category = p.cat || p.category || 'culture';
    const tag = p.video_url
      ? `<span class="tag tag-culture">${NV.icon('play')}Video</span>`
      : `<span class="tag tag-${NV.esc(category)}">${NV.icon(NV.catIcon(category))}${NV.catLabel(category)}</span>`;
    return `
  <article class="post-card ${opts.big ? 'big' : ''}">
    <div class="thumb" data-image-query="${NV.esc(`${p.title} ${p.place || p.state || 'Nigeria'}`)}" data-image-fallback="Nigerian ${NV.esc(category)}">
      <a class="thumb-link" href="${NV.router.postUrl(p.id)}" aria-label="${NV.esc(p.title)}"></a>
      <a class="photo-credit" data-photo-credit hidden target="_blank" rel="noopener noreferrer"></a>
      ${tag}
    </div>
    <a class="body" href="${NV.router.postUrl(p.id)}"><h3>${NV.esc(p.title)}</h3>
      <div class="meta"><span>${NV.icon('eye')}${p.views}</span><span>${NV.icon('message')}${p.likes}</span><span class="where">${NV.icon('pin')}${NV.esc(p.place)}</span></div>
    </a>
  </article>`;
  };
  NV.feedPost = (p) => {
    const liked = NV.store.get('liked', {})[p.id];
    const localImage = typeof p.image === 'string' && p.image.startsWith('assets/images/');
    const videoUrl = (() => {
      if (typeof p.video_url === 'string' && /^\/media\/[a-f0-9-]{36}\.(?:mp4|webm|ogv)$/.test(p.video_url)) return p.video_url;
      try {
        const url = new URL(p.video_url);
        return url.protocol === 'https:' ? url.toString() : '';
      } catch {
        return '';
      }
    })();
    const imageUrl = typeof p.image === 'string' && (p.image.startsWith('/media/') || p.image.startsWith('https://'))
      ? p.image
      : localImage
        ? 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
        : p.image && p.image.startsWith('data:')
          ? p.image
          : p.image ? NV.url(p.image) : '';
    return `<article class="card feed-post" data-id="${p.id}">
      <header><img class="avatar" src="${NV.url(p.avatar || 'assets/images/avatar-1.jpg')}" alt=""><div><b>${NV.esc(p.user)}</b><small>${NV.esc(p.when || '')}${p.state ? ` · ${NV.esc(p.state)}` : ''}</small></div></header>
      <p>${NV.esc(p.text)}</p>${videoUrl ? `<video class="pic" controls preload="metadata"><source src="${NV.esc(videoUrl)}"></video><span class="tag tag-culture feed-video-tag">${NV.icon('play')}Video</span>` : imageUrl ? `<div class="feed-media"><img class="pic" src="${NV.esc(imageUrl)}" alt=""${localImage ? ` data-image-query="${NV.esc(`${p.title || p.text} ${p.state || ''}`)}" data-image-fallback="Nigerian ${NV.esc(p.category || 'culture')}"` : ''}><a class="photo-credit" data-photo-credit hidden target="_blank" rel="noopener noreferrer"></a></div>` : ''}
      <div class="feed-actions"><button data-like class="${liked ? 'on' : ''}">${NV.icon('heart')}<span>${(p.likes || 0) + (liked ? 1 : 0)}</span></button>
      <a href="${NV.router.postUrl(p.id)}" style="display:inline-flex;gap:6px;align-items:center">${NV.icon('message')}${(p.comments || []).length}</a>
      <button data-save>${NV.icon('bookmark')}Save</button><button data-report>${NV.icon('flag')}Report</button></div></article>`;
  };
  NV.bindFeed = (root) => {
    root.addEventListener('click', async (e) => {
      const art = e.target.closest('.feed-post'); if (!art) return; const id = art.dataset.id;
      if (e.target.closest('[data-like]')) { const on = await NV.services.posts.like(id); const b = NV.$('[data-like]', art); b.classList.toggle('on', on); const s = NV.$('span', b); s.textContent = +s.textContent + (on ? 1 : -1); }
      if (e.target.closest('[data-save]')) { const on = await NV.services.posts.save(id); NV.toast(on ? 'Saved' : 'Removed from saved', 'success'); }
      if (e.target.closest('[data-report]')) NV.modal({ title: 'Report this post', html: '<div class="field"><label for="rr">What is wrong with it?</label><textarea id="rr" class="textarea" style="min-height:80px"></textarea></div>', confirmText: 'Send report', onConfirm: async (m) => { await NV.services.reports.create({ target_type: 'post', target_id: id, reason: NV.$('#rr', m).value }); NV.toast('Report sent. Thank you.', 'success'); } });
    });
  };
})(window.NV);
