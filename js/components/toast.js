(function (NV) {
  NV.toast = function (msg, type) {
    let w = NV.$('.toast-wrap'); if (!w) { w = document.createElement('div'); w.className = 'toast-wrap'; w.setAttribute('role', 'status'); document.body.appendChild(w); }
    const t = document.createElement('div'); t.className = 'toast ' + (type || ''); t.textContent = msg; w.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  };
})(window.NV);
