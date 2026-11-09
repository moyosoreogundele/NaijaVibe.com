NV.pages.profile = async function () {
  const currentUser = await NV.services.auth.getUser();
  const requestedUsername = NV.param('user');

  let profile;
  let isOwnProfile = false;
  let posts = [];

  if (requestedUsername) {
    profile = await NV.services.profile.get(requestedUsername);
    if (!profile) {
      NV.$('#p-name').textContent = 'Profile Not Found';
      NV.$('#p-bio').textContent = 'This user does not exist or has been removed.';
      return;
    }
    isOwnProfile = currentUser && (currentUser.username.toLowerCase() === profile.username.toLowerCase());
    posts = profile.posts || [];
  } else {
    if (!currentUser) {
      NV.router.go('login.html?next=profile.html');
      return;
    }
    isOwnProfile = true;
    profile = await NV.services.profile.get();
    const allPosts = await NV.services.posts.list();
    posts = allPosts.filter(x => x.user === '@' + profile.username || (currentUser && x.user_id === currentUser.id));
  }

  // Populate avatar and info
  NV.$('#p-avatar').src = NV.url(profile.avatar_url || 'assets/images/avatar-1.jpg');
  NV.$('#p-name').textContent = profile.display_name || profile.username;
  NV.$('#p-user').textContent = '@' + profile.username;
  NV.$('#p-bio').textContent = profile.bio || 'Proudly sharing the vibes of Nigeria.';

  const stateBadge = NV.$('#p-state');
  if (stateBadge) {
    if (profile.state) {
      stateBadge.textContent = '📍 ' + profile.state;
      stateBadge.style.display = 'inline-block';
    } else {
      stateBadge.style.display = 'none';
    }
  }

  // Stats
  const stats = profile.stats || {};
  NV.$('#p-count').textContent = stats.posts != null ? stats.posts : posts.length;
  if (NV.$('#p-followers')) NV.$('#p-followers').textContent = stats.followers != null ? stats.followers : 0;
  if (NV.$('#p-following')) NV.$('#p-following').textContent = stats.following != null ? stats.following : 0;

  // Actions (Edit vs Follow)
  const editBtn = NV.$('#p-edit-btn');
  const followBtn = NV.$('#p-follow-btn');
  if (isOwnProfile) {
    if (editBtn) editBtn.style.display = 'inline-block';
    if (followBtn) followBtn.style.display = 'none';
  } else {
    if (editBtn) editBtn.style.display = 'none';
    if (followBtn) {
      followBtn.style.display = 'inline-block';
      followBtn.textContent = profile.isFollowing ? 'Following' : 'Follow';
      followBtn.className = profile.isFollowing ? 'btn btn-outline btn-sm' : 'btn btn-primary btn-sm';
      followBtn.onclick = async () => {
        if (!currentUser) {
          NV.router.go('login.html?next=' + encodeURIComponent(location.pathname + location.search));
          return;
        }
        try {
          const res = await NV.services.profile.toggleFollow(profile.username);
          followBtn.textContent = res.following ? 'Following' : 'Follow';
          followBtn.className = res.following ? 'btn btn-outline btn-sm' : 'btn btn-primary btn-sm';
          if (NV.$('#p-followers') && res.followersCount != null) {
            NV.$('#p-followers').textContent = res.followersCount;
          }
          NV.toast(res.following ? `Following @${profile.username}` : `Unfollowed @${profile.username}`, 'success');
        } catch (err) {
          NV.toast(err.message, 'error');
        }
      };
    }
  }

  // Feed rendering
  const box = NV.$('#p-posts');
  if (posts.length) {
    box.innerHTML = posts.map(NV.feedPost).join('');
    NV.bindFeed(box);
  } else {
    box.innerHTML = isOwnProfile
      ? `<p class="empty">You haven't shared a video yet. <a class="text-link" href="create-post.html">Share your first video</a>.</p>`
      : `<p class="empty">@${NV.esc(profile.username)} hasn't posted any stories yet.</p>`;
  }
};

NV.pages['edit-profile'] = async function () {
  NV.router.requireAuth();
  const currentUser = await NV.services.auth.getUser();
  const profile = await NV.services.profile.get();
  const form = NV.$('#profile-form');

  // Populate state dropdown
  const stateSelect = form.querySelector('#state');
  if (stateSelect && window.NV_STATES) {
    stateSelect.innerHTML = '<option value="">Select your state</option>' + window.NV_STATES.map(s => `<option value="${NV.esc(s.name)}" ${profile.state === s.name ? 'selected' : ''}>${NV.esc(s.name)}</option>`).join('');
  }

  form.display_name.value = profile.display_name || '';
  form.username.value = profile.username || currentUser?.username || '';
  form.bio.value = profile.bio || '';
  if (form.website) form.website.value = profile.website || '';
  if (form.phone) form.phone.value = profile.phone || '';

  NV.validate.bind(form);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!NV.validate.form(form)) return;
    const submitBtn = NV.$('#save-profile-btn') || form.querySelector('button[type=submit]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const patch = {
        display_name: form.display_name.value.trim(),
        bio: form.bio.value.trim(),
        state: form.state ? form.state.value : '',
        website: form.website ? form.website.value.trim() : '',
        phone: form.phone ? form.phone.value.trim() : ''
      };

      const file = form.avatar.files[0];
      if (file) {
        NV.toast('Uploading avatar...', 'info');
        patch.avatar_url = await NV.services.uploads.upload(file, 'avatars');
      }

      await NV.services.profile.update(patch);
      NV.toast('Profile saved successfully!', 'success');
      setTimeout(() => NV.router.go('profile.html'), 700);
    } catch (err) {
      NV.toast(err.message || 'Could not save profile changes.', 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
};
