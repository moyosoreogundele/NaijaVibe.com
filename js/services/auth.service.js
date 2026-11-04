(function (NV) {
  function normalizeSupabaseUser(user) {
    if (!user) return null;
    return Object.assign({}, user, {
      username: user.user_metadata && user.user_metadata.username || user.email && user.email.split('@')[0] || 'member'
    });
  }

  async function request(path, body) {
    const response = await fetch('/api/auth' + path, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error && result.error.message || 'The authentication service could not complete the request.');
      error.code = result.error && result.error.code || 'AUTH_REQUEST_FAILED';
      error.status = response.status;
      error.retryAfterSeconds = result.error && result.error.retryAfterSeconds;
      throw error;
    }
    return result;
  }

  NV.services.auth = {
    async signUp({ email, password, username }) {
      if (NV.live) {
        const { data, error } = await NV.db.auth.signUp({
          email,
          password,
          options: { data: { username } }
        });
        if (error) throw error;
        if (!data.session || !data.user) {
          const confirmationError = new Error('Email confirmation is enabled for this Supabase project. Turn off Confirm email in Supabase Auth settings to allow password-only signup.');
          confirmationError.code = 'EMAIL_CONFIRMATION_ENABLED';
          throw confirmationError;
        }
        return { user: normalizeSupabaseUser(data.user) };
      }
      return request('/signup', { email, password, username });
    },
    async verifyEmail({ email, code }) {
      return request('/verify-email', { email, code });
    },
    async resendVerification(email) {
      return request('/resend-code', { email });
    },
    async signIn({ email, password }) {
      if (NV.live) {
        const { data, error } = await NV.db.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return normalizeSupabaseUser(data.user);
      }
      return (await request('/login', { email, password })).user;
    },
    async signOut() {
      if (NV.live) {
        const { error } = await NV.db.auth.signOut();
        if (error) throw error;
      } else {
        await request('/logout', {});
      }
      localStorage.removeItem('nv:user');
    },
    async getUser() {
      if (NV.live) {
        const { data: sessionData, error: sessionError } = await NV.db.auth.getSession();
        if (sessionError) throw sessionError;
        if (!sessionData.session) return null;
        const { data, error } = await NV.db.auth.getUser();
        if (error) throw error;
        return normalizeSupabaseUser(data.user);
      }
      try {
        return (await request('/me')).user;
      } catch (error) {
        if (error.status === 401) return null;
        throw error;
      }
    },
    async sendReset(email) {
      if (NV.live) {
        const { error } = await NV.db.auth.resetPasswordForEmail(email, {
          redirectTo: `${location.origin}/reset-password.html`
        });
        if (error) throw error;
        return true;
      }
      return request('/forgot-password', { email });
    },
    async updatePassword(password) {
      if (NV.live) {
        const { error } = await NV.db.auth.updateUser({ password });
        if (error) throw error;
        return true;
      }
      return request('/reset-password', { token: NV.param('token') || '', password });
    }
  };
})(window.NV);
