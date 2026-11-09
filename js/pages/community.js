NV.pages.post = async function () {
  const id = NV.param('id') || '1'; let p = await NV.services.posts.get(id);
  if (!p) { const t = NV.demo().trending.find(x => String(x.id) === id); if (t) p = { id: t.id, user: '@naijavibe', when: 'Featured', text: t.title + ' — ' + t.views + ' views from ' + t.place + '.', image: t.image, likes: t.likes, comments: [] }; }
  if (!p) { NV.$('#post-box').innerHTML = '<p class="empty">This post could not be found. It may have been removed.</p>'; return; }
  NV.$('#post-box').innerHTML = NV.feedPost(p); NV.bindFeed(NV.$('#post-box'));
};
NV.pages.notifications = function () {
  const draw = () => { NV.$('#notif-list').innerHTML = NV.notifications.list().map(n => `<div class="card event-card" style="${n.unread ? 'border-left:4px solid var(--green)' : ''}"><span class="icon-btn">${NV.icon('bell')}</span><div style="flex:1"><p style="color:var(--ink)">${NV.esc(n.text)}</p><small class="muted">${n.when}</small></div></div>`).join(''); };
  draw(); NV.$('#mark-read').addEventListener('click', () => { NV.notifications.markAll(); draw(); NV.toast('All caught up', 'success'); });
};
