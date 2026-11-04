NV.pages.community = async function () {
  const feed = NV.$('#feed'); const load = async () => { const posts = await NV.services.posts.list(); feed.innerHTML = posts.map(NV.feedPost).join(''); };
  await load(); NV.bindFeed(feed);
};
NV.pages.post = async function () {
  const id = NV.param('id') || '1'; let p = await NV.services.posts.get(id);
  if (!p) { const t = NV.demo().trending.find(x => String(x.id) === id); if (t) p = { id: t.id, user: '@naijavibe', when: 'Featured', text: t.title + ' — ' + t.views + ' views from ' + t.place + '.', image: t.image, likes: t.likes, comments: [] }; }
  if (!p) { NV.$('#post-box').innerHTML = '<p class="empty">This post could not be found. It may have been removed.</p>'; return; }
  NV.$('#post-box').innerHTML = NV.feedPost(p); NV.bindFeed(NV.$('#post-box'));
  const draw = async () => { const cs = (p.comments || []).map(t => ({ body: t, user: 'visitor' })).concat(await NV.services.comments.list(id)); NV.$('#comments').innerHTML = cs.map(c => `<p><b>${NV.esc(c.user || (c.profiles && c.profiles.username) || 'user')}</b> ${NV.esc(c.body)}</p>`).join('') || '<p class="muted">No comments yet. Start the conversation.</p>'; };
  await draw();
  NV.$('#comment-form').addEventListener('submit', async e => { e.preventDefault(); const v = e.target.body.value.trim(); if (!v) return; await NV.services.comments.add(id, v); e.target.reset(); draw(); NV.toast('Comment posted', 'success'); });
};
NV.pages.notifications = function () {
  const draw = () => { NV.$('#notif-list').innerHTML = NV.notifications.list().map(n => `<div class="card event-card" style="${n.unread ? 'border-left:4px solid var(--green)' : ''}"><span class="icon-btn">${NV.icon('bell')}</span><div style="flex:1"><p style="color:var(--ink)">${NV.esc(n.text)}</p><small class="muted">${n.when}</small></div></div>`).join(''); };
  draw(); NV.$('#mark-read').addEventListener('click', () => { NV.notifications.markAll(); draw(); NV.toast('All caught up', 'success'); });
};
