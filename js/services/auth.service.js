(function (NV) {
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
      return request('/signup', { email, password, username });
    },
    async signIn({ email, password }) {
      return (await request('/login', { email, password })).user;
    },
    async signOut() {
      await request('/logout', {});
      localStorage.removeItem('nv:user');
    },
    async getUser() {
      try {
        return (await request('/me')).user;
      } catch (error) {
        if (error.status === 401) return null;
        throw error;
      }
    },
    async sendReset(email) {
      return request('/forgot-password', { email });
    },
    async updatePassword(password) {
      return request('/reset-password', { token: NV.param('token') || '', password });
    }
  };
})(window.NV);
