(function (NV) {
  NV.services.comments = {
    async list(postId) {
      if (NV.live) { const { data } = await NV.db.from('comments').select('*, profiles(username)').eq('post_id', postId).order('created_at'); return data || []; }
      return NV.store.get('comments:' + postId, []);
    },
    async add(postId, body) {
      const user = await NV.services.auth.getUser();
      if (NV.live) { const { data, error } = await NV.db.from('comments').insert({ post_id: postId, body, user_id: user.id }).select().single(); if (error) throw error; return data; }
      const rows = NV.store.get('comments:' + postId, []); const c = { id: Date.now(), body, user: (user && user.username) || 'you' }; rows.push(c); NV.store.set('comments:' + postId, rows); return c;
    },
    async listNews(newsId) {
      const response = await fetch(`/api/news/${encodeURIComponent(newsId)}/comments`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error?.message || 'Could not load this discussion.');
      if (!Array.isArray(result.comments)) throw new Error('The comments service returned an invalid response.');
      return result.comments;
    },
    async addNews(newsId, body) {
      const response = await fetch(`/api/news/${encodeURIComponent(newsId)}/comments`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ body })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error?.message || 'Could not post your comment.');
      if (!result.comment) throw new Error('The comments service returned an invalid response.');
      return result.comment;
    }
  };
})(window.NV);
