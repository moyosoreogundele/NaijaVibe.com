(function (NV) {
  NV.services.follows = {
    isFollowing: (id) => NV.store.get('follows', []).includes(id),
    async toggle(id) {
      const f = NV.store.get('follows', []); const i = f.indexOf(id); i > -1 ? f.splice(i, 1) : f.push(id); NV.store.set('follows', f);
      if (NV.live) { const u = await NV.services.auth.getUser(); if (u) { i > -1 ? await NV.db.from('follows').delete().match({ follower_id: u.id, following_id: id }) : await NV.db.from('follows').insert({ follower_id: u.id, following_id: id }); } }
      return i === -1;
    }
  };
})(window.NV);
