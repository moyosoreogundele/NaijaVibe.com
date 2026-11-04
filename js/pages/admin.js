/* Demo admin screens only; they do not provide production access control. */
const adminGuard = async () => { const u = await NV.services.auth.getUser(); if (!u) NV.router.go('login.html?next=' + encodeURIComponent(location.pathname)); };
NV.pages.admin = async function () {
  await adminGuard(); const d = NV.demo();
  const reports = await NV.services.reports.list();
  const stats = [['Members', '12,480'], ['Posts today', '326'], ['Open reports', reports.filter(r => r.status !== 'resolved').length], ['Businesses pending', NV.local.list('businesses').length]];
  NV.$('#stats').innerHTML = stats.map(s => `<div class="card stat"><b>${s[1]}</b><span>${s[0]}</span></div>`).join('');
  NV.$('#recent').innerHTML = d.trending.map(p => `<tr><td>${NV.esc(p.title)}</td><td>${NV.catLabel(p.cat)}</td><td>${p.views}</td></tr>`).join('');
};
NV.pages.reports = async function () {
  await adminGuard(); const box = NV.$('#rows');
  const draw = async () => { const rs = await NV.services.reports.list(); box.innerHTML = rs.length ? rs.map(r => `<tr><td>${NV.esc(r.target_type)} #${NV.esc(r.target_id)}</td><td>${NV.esc(r.reason || '—')}</td><td><span class="badge-pill ${r.status === 'resolved' ? '' : 'warn'}">${r.status || 'open'}</span></td><td>${r.status === 'resolved' ? '' : `<button class="btn btn-outline btn-sm" data-r="${r.id}">Resolve</button>`}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">No reports. Nothing needs review.</td></tr>'; };
  await draw(); box.addEventListener('click', async e => { const b = e.target.closest('[data-r]'); if (b) { await NV.services.reports.resolve(+b.dataset.r || b.dataset.r); NV.toast('Report resolved', 'success'); draw(); } });
};
NV.pages.users = async function () {
  await adminGuard(); const users = [['travelwithtunde', 'Member', 'Active'], ['foodie_lagos', 'Member', 'Active'], ['naija_vibes', 'Creator', 'Active'], ['culturequeen', 'Creator', 'Active']];
  NV.$('#rows').innerHTML = users.map(u => `<tr><td>@${u[0]}</td><td>${u[1]}</td><td><span class="badge-pill">${u[2]}</span></td><td><button class="btn btn-outline btn-sm" data-ban="${u[0]}">Suspend</button></td></tr>`).join('');
  NV.$('#rows').addEventListener('click', e => { const b = e.target.closest('[data-ban]'); if (b) NV.modal({ title: 'Suspend @' + b.dataset.ban + '?', html: '<p>They will not be able to post or comment.</p>', confirmText: 'Suspend', onConfirm: () => NV.toast('User suspended', 'success') }); });
};
NV.pages.content = async function () {
  await adminGuard(); const posts = await NV.services.posts.list();
  const box = NV.$('#rows'); const draw = async () => { const ps = await NV.services.posts.list(); box.innerHTML = ps.map(p => `<tr><td>${NV.esc(p.title || p.text || '').slice(0, 70)}</td><td>${NV.esc(p.user || '')}</td><td><button class="btn btn-danger btn-sm" data-del="${p.id}">${NV.icon('trash')}Remove</button></td></tr>`).join('') || '<tr><td colspan="3" class="empty">No content to moderate.</td></tr>'; };
  await draw(); box.addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (b) NV.modal({ title: 'Remove this post?', html: '<p>It disappears for everyone.</p>', confirmText: 'Remove post', onConfirm: async () => { await NV.services.posts.remove(+b.dataset.del || b.dataset.del); NV.toast('Post removed', 'success'); draw(); } }); });
};
