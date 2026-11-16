NV.pages.people = async function () {
  const currentUser = await NV.services.auth.getUser();
  if (!currentUser) {
    NV.router.go('login.html?next=people.html');
    return;
  }

  const queryInput = NV.$('#people-query');
  const status = NV.$('#people-status');
  const grid = NV.$('#people-grid');
  const loadMore = NV.$('#people-load-more');
  const pageSize = 30;
  let offset = 0;
  let hasMore = false;
  let latestRequest = 0;

  const render = people => people.map(person => {
    const avatar = person.avatar_url || 'assets/images/avatar-1.jpg';
    const avatarUrl = avatar.startsWith('https://') ? avatar : NV.url(avatar);
    const location = person.online ? 'Online now' : person.state || 'NaijaVibe member';
    return `<article class="card member-card" data-member="${NV.esc(person.username)}">
      <img class="member-avatar" src="${NV.esc(avatarUrl)}" alt="" loading="lazy">
      <div class="member-copy">
        <a href="${NV.url('profile.html?user=' + encodeURIComponent(person.username))}">${NV.esc(person.display_name || person.username)}</a>
        <small>@${NV.esc(person.username)}</small>
        <small class="${person.online ? 'member-status' : ''}">${NV.esc(location)} · ${Number(person.followers_count) || 0} followers</small>
      </div>
      <div class="member-actions">
        <a class="btn btn-outline btn-sm" href="${NV.url('messages.html?user=' + encodeURIComponent(person.username))}" aria-label="Message @${NV.esc(person.username)}">Message</a>
        <button class="btn ${person.following ? 'btn-outline' : 'btn-primary'} btn-sm" type="button" data-follow-user="${NV.esc(person.username)}" aria-pressed="${person.following}">${person.following ? 'Following' : 'Follow'}</button>
      </div>
    </article>`;
  }).join('');

  async function loadPeople({ append = false } = {}) {
    const requestId = ++latestRequest;
    const query = queryInput.value.trim();
    if (!append) {
      offset = 0;
      grid.replaceChildren();
      loadMore.hidden = true;
      status.textContent = 'Loading members…';
    }
    loadMore.disabled = true;
    try {
      const result = await NV.services.profile.directory({ query, offset, limit: pageSize });
      if (requestId !== latestRequest) return;
      const people = result.users;
      grid.insertAdjacentHTML('beforeend', render(people));
      offset += people.length;
      hasMore = result.hasMore;
      loadMore.hidden = !hasMore;
      const shown = grid.querySelectorAll('.member-card').length;
      status.textContent = people.length || shown
        ? `Showing ${shown} ${shown === 1 ? 'person' : 'people'} · ${Number(result.totalMembers).toLocaleString('en-NG')} members on NaijaVibe. Private profiles are only shown to their followers.`
        : 'No members match that search yet.';
    } catch (error) {
      if (requestId !== latestRequest) return;
      status.textContent = error.message || 'Could not load members. Please try again.';
      NV.toast(status.textContent, 'error');
    } finally {
      if (requestId === latestRequest) loadMore.disabled = false;
    }
  }

  const searchMembers = NV.debounce(() => loadPeople(), 250);
  queryInput.addEventListener('input', searchMembers);
  loadMore.addEventListener('click', () => {
    if (hasMore) loadPeople({ append: true });
  });
  grid.addEventListener('click', async event => {
    const button = event.target.closest('[data-follow-user]');
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      const result = await NV.services.profile.toggleFollow(button.dataset.followUser);
      button.textContent = result.following ? 'Following' : 'Follow';
      button.classList.toggle('btn-primary', result.following);
      button.classList.toggle('btn-outline', !result.following);
      button.setAttribute('aria-pressed', String(result.following));
      const card = button.closest('[data-member]');
      const followerLabel = card.querySelector('.member-copy small:last-child');
      const name = followerLabel.textContent.split(' · ')[0];
      followerLabel.textContent = `${name} · ${Number(result.followersCount).toLocaleString('en-NG')} followers`;
      NV.toast(result.following ? `Following @${button.dataset.followUser}.` : `Unfollowed @${button.dataset.followUser}.`, 'success');
    } catch (error) {
      NV.toast(error.message || 'Could not update follow status.', 'error');
    } finally {
      button.disabled = false;
    }
  });

  await loadPeople();
};
