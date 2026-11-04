(function (NV) {
  const categories = new Set(['food', 'travel', 'culture', 'music', 'fashion', 'events']);
  let legacyMigration;

  async function localRequest(url, options) {
    const response = await fetch(url, Object.assign({ credentials: 'same-origin' }, options));
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error && result.error.message || 'The posts service could not complete the request.');
    return result;
  }

  function videoViewerId() {
    let id = NV.store.get('video-viewer-id', '');
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) {
      id = crypto.randomUUID();
      NV.store.set('video-viewer-id', id);
    }
    return id;
  }

  async function migrateLocalPosts() {
    const legacyPosts = NV.local.list('posts');
    if (!legacyPosts.length) return;
    const user = await NV.services.auth.getUser();
    if (!user) return;
    const remaining = [];
    for (const post of legacyPosts) {
      try {
        if (post.user && post.user !== `@${user.username}`) {
          remaining.push(post);
          continue;
        }
        let imageUrl = post.image || null;
        if (typeof imageUrl === 'string' && imageUrl.startsWith('data:')) {
          const blob = await fetch(imageUrl).then(response => response.blob());
          imageUrl = await NV.services.uploads.upload(new File([blob], 'legacy-post-image', { type: blob.type }));
        }
        if (imageUrl && !imageUrl.startsWith('/media/') && !imageUrl.startsWith('https://')) imageUrl = null;
        const body = String(post.text || post.body || post.title || '').trim();
        const title = String(post.title || body || 'Shared community post').trim().slice(0, 140);
        const state = window.NV_STATES.some(item => item.name === post.state) ? post.state : '';
        const category = categories.has(post.category || post.cat) ? post.category || post.cat : 'culture';
        const videoUrl = typeof post.video_url === 'string' && (/^https:\/\//i.test(post.video_url) || /^\/media\/[a-f0-9-]{36}\.(?:mp4|webm|ogv)$/.test(post.video_url))
          ? post.video_url
          : null;
        const externalVideoUrl = typeof post.external_video_url === 'string' && /^https:\/\//i.test(post.external_video_url)
          ? post.external_video_url
          : null;
        await localRequest('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, body, category, state, image_url: imageUrl, video_url: videoUrl, external_video_url: externalVideoUrl })
        });
      } catch (error) {
        console.error(`Could not migrate saved post ${post.id}:`, error);
        remaining.push(post);
      }
    }
    NV.local.save('posts', remaining);
  }

  NV.services.posts = {
    async videos({ state, limit = 30 } = {}) {
      if (NV.live) {
        let query = NV.db.from('posts').select('*, profiles(username, avatar_url)')
          .or('video_url.not.is.null,external_video_url.not.is.null').order('created_at', { ascending: false }).limit(limit);
        if (state) query = query.eq('state', state);
        const { data, error } = await query;
        if (error) throw error;
        const params = new URLSearchParams({ limit: String(limit) });
        if (state) params.set('state', state);
        const trending = await localRequest('/api/videos/trending?' + params);
        if (!Array.isArray(trending.items)) throw new Error('The videos service returned an invalid response.');
        return {
          items: [
            ...trending.items.filter(video => video.source === 'youtube'),
            ...(data || []).map(post => ({ ...post, views: Number(post.views) || 0 }))
          ].slice(0, limit),
          sources: trending.sources || {}
        };
      }
      const params = new URLSearchParams({ limit: String(limit) });
      if (state) params.set('state', state);
      const result = await localRequest('/api/videos/trending?' + params);
      if (!Array.isArray(result.items)) throw new Error('The videos service returned an invalid response.');
      return { items: result.items, sources: result.sources || {} };
    },
    async getVideo(id) {
      if (NV.live) {
        const { data, error } = await NV.db.from('posts').select('*, profiles(username, avatar_url)')
          .eq('id', id).or('video_url.not.is.null,external_video_url.not.is.null').maybeSingle();
        if (error) throw error;
        return data || null;
      }
      const result = await localRequest('/api/videos/' + encodeURIComponent(id));
      if (!result.video) throw new Error('The videos service returned an invalid video.');
      return result.video;
    },
    async recordVideoView(id) {
      const viewerId = videoViewerId();
      if (!NV.live) {
        const result = await localRequest('/api/videos/' + encodeURIComponent(id) + '/views', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ viewerId })
        });
        if (!Number.isInteger(result.views)) throw new Error('The videos service returned an invalid view count.');
        return result;
      }
      const viewed = NV.store.get('video-views', {});
      const today = new Date().toISOString().slice(0, 10);
      const key = `${id}:${today}`;
      if (viewed[key]) return { counted: false, views: viewed[key].count };
      const count = (Number(viewed[key]?.count) || 0) + 1;
      viewed[key] = { count, viewerId };
      NV.store.set('video-views', viewed);
      return { counted: true, views: count };
    },
    async list({ category, limit = 20 } = {}) {
      if (NV.live) { let q = NV.db.from('posts').select('*, profiles(username, avatar_url)').order('created_at', { ascending: false }).limit(limit); if (category) q = q.eq('category', category); const { data } = await q; return data || []; }
      if (!legacyMigration) legacyMigration = migrateLocalPosts();
      await legacyMigration;
      const params = new URLSearchParams({ limit: String(limit) });
      if (category) params.set('category', category);
      const result = await localRequest('/api/posts?' + params);
      if (!Array.isArray(result.items)) throw new Error('The posts service returned an invalid response.');
      return result.items.concat(NV.local.list('posts'), NV.demo().posts || []);
    },
    async get(id) { const all = await this.list({ limit: 100 }); return all.find(p => String(p.id) === String(id)) || null; },
    async create({ title, body, category, state, image_url, video_url, external_video_url }) {
      const user = await NV.services.auth.getUser();
      if (NV.live) {
        const { data, error } = await NV.db.from('posts')
          .insert({ title, body, category, state, image_url, video_url, external_video_url, user_id: user.id })
          .select().single();
        if (error) throw error;
        return data;
      }
      const result = await localRequest('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, category, state, image_url, video_url, external_video_url })
      });
      if (!result.post) throw new Error('The posts service returned an invalid post.');
      return result.post;
    },
    async like(id) {
      const liked = NV.store.get('liked', {}); const on = !liked[id]; liked[id] = on; NV.store.set('liked', liked);
      if (NV.live) { const user = await NV.services.auth.getUser(); if (user) { on ? await NV.db.from('likes').insert({ post_id: id, user_id: user.id }) : await NV.db.from('likes').delete().match({ post_id: id, user_id: user.id }); } }
      return on;
    },
    async save(id) { const s = NV.store.get('saved', []); const i = s.indexOf(id); i > -1 ? s.splice(i, 1) : s.push(id); NV.store.set('saved', s); return i === -1; },
    savedIds: () => NV.store.get('saved', []),
    async remove(id) {
      if (NV.live) { const { error } = await NV.db.from('posts').delete().eq('id', id); if (error) throw error; }
      else await localRequest('/api/posts/' + encodeURIComponent(id), { method: 'DELETE' });
    }
  };
})(window.NV);
