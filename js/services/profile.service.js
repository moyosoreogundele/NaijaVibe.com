(function (NV) {
  NV.services.profile = {
    async get(usernameOrId) {
      if (usernameOrId && typeof usernameOrId === 'string' && !usernameOrId.includes('-')) {
        try {
          const res = await fetch(`/api/users/${encodeURIComponent(usernameOrId.replace(/^@/, ''))}/profile`, { credentials: 'same-origin' });
          if (res.ok) {
            const data = await res.json();
            return { ...data.profile, posts: data.posts };
          }
        } catch (err) {
          console.error('Failed to fetch public profile:', err);
        }
      }
      try {
        const res = await fetch('/api/users/profile', { credentials: 'same-origin' });
        if (res.ok) {
          const data = await res.json();
          NV.store.set('profile', data.profile);
          return data.profile;
        }
      } catch (err) {
        console.error('Failed to fetch user profile:', err);
      }
      return NV.store.get('profile', {
        username: 'naijavibe_fan',
        display_name: 'Naija Fan',
        bio: 'Exploring Nigeria one state at a time.',
        state: 'Lagos',
        avatar_url: 'assets/images/avatar-1.jpg',
        stats: { posts: 0, followers: 0, following: 0 }
      });
    },

    async update(idOrPatch, patchObj) {
      const patch = patchObj || idOrPatch || {};
      try {
        const res = await fetch('/api/users/profile', {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch)
        });
        if (res.ok) {
          const data = await res.json();
          NV.store.set('profile', data.profile);
          return data.profile;
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || 'Could not update profile');
      } catch (e) {
        if (e.message && !e.message.includes('fetch')) throw e;
      }
      const p = Object.assign(await this.get(), patch);
      NV.store.set('profile', p);
      return p;
    },

    async getSettings() {
      try {
        const res = await fetch('/api/users/settings', { credentials: 'same-origin' });
        if (res.ok) {
          const data = await res.json();
          return data.settings;
        }
      } catch (e) {}
      return { notif_email: true, notif_push: true, private: false };
    },

    async updateSettings(settings) {
      const res = await fetch('/api/users/settings', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || 'Failed to update settings');
      }
      const data = await res.json();
      return data.settings;
    },

    async changePassword(current_password, new_password) {
      const res = await fetch('/api/users/change-password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password, new_password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error?.message || 'Could not change password.');
      }
      return data;
    },

    async deleteAccount() {
      const res = await fetch('/api/users/account', {
        method: 'DELETE',
        credentials: 'same-origin'
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || 'Could not delete account.');
      }
      localStorage.removeItem('nv:user');
      return true;
    },

    async toggleFollow(username) {
      const clean = (username || '').replace(/^@/, '');
      const res = await fetch(`/api/users/${encodeURIComponent(clean)}/follow`, {
        method: 'POST',
        credentials: 'same-origin'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error?.message || 'Could not update follow status.');
      }
      return data;
    }
  };
})(window.NV);
