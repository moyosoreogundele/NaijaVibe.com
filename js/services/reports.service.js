(function (NV) {
  NV.services.reports = {
    async create({ target_type, target_id, reason }) {
      if (NV.live) { const u = await NV.services.auth.getUser(); const { error } = await NV.db.from('reports').insert({ target_type, target_id, reason, reporter_id: u && u.id }); if (error) throw error; return true; }
      NV.local.insert('reports', { target_type, target_id, reason, status: 'open' }); return true;
    },
    async list() {
      if (NV.live) { const { data } = await NV.db.from('reports').select('*').order('created_at', { ascending: false }); return data || []; }
      return NV.local.list('reports');
    },
    async resolve(id) {
      if (NV.live) { await NV.db.from('reports').update({ status: 'resolved' }).eq('id', id); return; }
      NV.local.save('reports', NV.local.list('reports').map(r => r.id === id ? Object.assign(r, { status: 'resolved' }) : r));
    }
  };
})(window.NV);
