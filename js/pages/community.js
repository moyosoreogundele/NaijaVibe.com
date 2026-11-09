NV.pages.post = async function () {
  const id = NV.param('id') || '1'; let p = await NV.services.posts.get(id);
  if (!p) { const t = NV.demo().trending.find(x => String(x.id) === id); if (t) p = { id: t.id, user: '@naijavibe', when: 'Featured', text: t.title + ' — ' + t.views + ' views from ' + t.place + '.', image: t.image, likes: t.likes, comments: [] }; }
  if (!p) { NV.$('#post-box').innerHTML = '<p class="empty">This post could not be found. It may have been removed.</p>'; return; }
  NV.$('#post-box').innerHTML = NV.feedPost(p); NV.bindFeed(NV.$('#post-box'));
};
NV.pages.notifications = async function () {
  const list = NV.$('#notif-list');
  const draw = () => {
    const items = NV.notifications.list();
    list.innerHTML = items.length ? items.map(item => {
      const when = new Date(item.created_at).toLocaleString();
      return `<a class="card event-card" data-notification-id="${item.id}" href="${NV.url(item.url)}" style="text-decoration:none;${item.unread ? 'border-left:4px solid var(--green)' : ''}"><span class="icon-btn">${NV.icon('bell')}</span><div style="flex:1"><p style="color:var(--ink)">${NV.esc(item.text)}</p><small class="muted">${NV.esc(when)}</small></div></a>`;
    }).join('') : '<p class="empty">You have no notifications yet.</p>';
  };
  await NV.notifications.load();
  draw();
  list.addEventListener('click', async event => {
    const link = event.target.closest('[data-notification-id]');
    if (!link) return;
    event.preventDefault();
    try {
      await NV.notifications.mark(Number(link.dataset.notificationId));
      window.location.assign(link.href);
    } catch (error) {
      NV.toast(error.message, 'error');
    }
  });
  NV.$('#mark-read').addEventListener('click', async () => {
    try {
      await NV.notifications.markAll();
      draw();
      NV.toast('All caught up', 'success');
    } catch (error) {
      NV.toast(error.message, 'error');
    }
  });
  NV.$('#enable-push').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await NV.notifications.enablePush();
      button.textContent = 'Notifications enabled';
      NV.toast('Push notifications are enabled on this device.', 'success');
    } catch (error) {
      NV.toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
};
