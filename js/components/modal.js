(function (NV) {
  NV.modal = function ({ title, html, confirmText = 'Confirm', cancelText = 'Cancel', onConfirm }) {
    const b = document.createElement('div'); b.className = 'modal-back';
    b.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${NV.esc(title)}"><h3>${NV.esc(title)}</h3><div>${html || ''}</div><div class="actions"><button class="btn btn-outline btn-sm" data-x>${cancelText}</button><button class="btn btn-primary btn-sm" data-ok>${confirmText}</button></div></div>`;
    const close = () => { b.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => e.key === 'Escape' && close();
    b.addEventListener('click', e => { if (e.target === b || e.target.hasAttribute('data-x')) close(); });
    NV.$('[data-ok]', b).addEventListener('click', async () => { if (onConfirm) await onConfirm(b); close(); });
    document.addEventListener('keydown', esc); document.body.appendChild(b); NV.$('[data-ok]', b).focus(); return b;
  };
})(window.NV);
