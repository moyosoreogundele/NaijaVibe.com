NV.pages.people = async function () {
  const currentUser = await NV.services.auth.getUser();
  if (!currentUser) {
    NV.router.go('login.html?next=people.html');
    return;
  }

  const queryInput = NV.$('#people-query');
  const stateSelect = NV.$('#people-state');
  const status = NV.$('#people-status');
  const grid = NV.$('#people-grid');
  const loadMore = NV.$('#people-load-more');
  const filterTabs = NV.$$('[data-filter]');
  const pageSize = 30;
  let offset = 0;
  let hasMore = false;
  let latestRequest = 0;
  let currentFilter = 'all';
  let currentState = '';

  const initialTab = NV.param('tab');
  if (initialTab === 'following' || initialTab === 'followers') {
    currentFilter = initialTab;
    filterTabs.forEach(t => {
      const isMatch = t.dataset.filter === initialTab;
      t.classList.toggle('active', isMatch);
      t.setAttribute('aria-selected', String(isMatch));
    });
  }

  if (stateSelect && window.NV_STATES) {
    window.NV_STATES.forEach(st => {
      const opt = document.createElement('option');
      opt.value = st.name;
      opt.textContent = st.name;
      stateSelect.appendChild(opt);
    });
  }

  const render = people => people.map(person => {
    const avatar = person.avatar_url || 'assets/images/avatar-1.jpg';
    const avatarUrl = avatar.startsWith('https://') ? avatar : NV.url(avatar);
    const location = person.online ? 'Online now' : person.state || 'NaijaVibe member';
    const profileUrl = NV.url('profile.html?user=' + encodeURIComponent(person.username));
    return `<article class="card member-card" data-member="${NV.esc(person.username)}">
      <a href="${profileUrl}" class="member-avatar-wrap" aria-label="View @${NV.esc(person.username)}'s profile">
        <img class="member-avatar" src="${NV.esc(avatarUrl)}" alt="" loading="lazy">
      </a>
      <div class="member-copy">
        <a class="member-name-link" href="${profileUrl}">${NV.esc(person.display_name || person.username)}</a>
        <small class="member-handle">@${NV.esc(person.username)}</small>
        <small class="${person.online ? 'member-status' : ''}">${NV.esc(location)} · ${Number(person.followers_count) || 0} followers</small>
      </div>
      <div class="member-actions">
        <a class="btn btn-outline btn-sm" href="${profileUrl}" title="View profile">Profile</a>
        <a class="btn btn-secondary btn-sm" href="${NV.url('messages.html?user=' + encodeURIComponent(person.username))}" aria-label="Message @${NV.esc(person.username)}">Message</a>
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
      const result = await NV.services.profile.directory({
        query,
        filter: currentFilter,
        state: currentState,
        offset,
        limit: pageSize
      });
      if (requestId !== latestRequest) return;
      const people = result.users;
      grid.insertAdjacentHTML('beforeend', render(people));
      offset += people.length;
      hasMore = result.hasMore;
      loadMore.hidden = !hasMore;
      const shown = grid.querySelectorAll('.member-card').length;
      const filterLabel = currentFilter === 'following' ? 'creators you follow' : currentFilter === 'followers' ? 'people following you' : 'members';
      status.textContent = people.length || shown
        ? `Showing ${shown} ${shown === 1 ? 'person' : 'people'} (${filterLabel}) · ${Number(result.totalMembers).toLocaleString('en-NG')} total members.`
        : currentFilter === 'following' ? 'You are not following anyone yet.' : currentFilter === 'followers' ? 'No followers yet.' : 'No members match that search.';
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
  if (stateSelect) {
    stateSelect.addEventListener('change', () => {
      currentState = stateSelect.value;
      loadPeople();
    });
  }

  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      currentFilter = tab.dataset.filter || 'all';
      loadPeople();
    });
  });

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
      button.classList.toggle('btn-primary', !result.following);
      button.classList.toggle('btn-outline', result.following);
      button.setAttribute('aria-pressed', String(result.following));
      const card = button.closest('[data-member]');
      const followerLabel = card.querySelector('.member-copy small:last-child');
      const name = followerLabel.textContent.split(' · ')[0];
      followerLabel.textContent = `${name} · ${Number(result.followersCount).toLocaleString('en-NG')} followers`;
      NV.toast(result.following ? `Following @${button.dataset.followUser}.` : `Unfollowed @${button.dataset.followUser}.`, 'success');
      if (currentFilter === 'following' && !result.following) {
        card.style.opacity = '0.5';
      }
    } catch (error) {
      NV.toast(error.message || 'Could not update follow status.', 'error');
    } finally {
      button.disabled = false;
    }
  });

  await loadPeople();
};
