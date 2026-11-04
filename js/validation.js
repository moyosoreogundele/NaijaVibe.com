(function (NV) {
  const rules = {
    required: (v) => v.trim() ? '' : 'This field is required.',
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? '' : 'Enter a valid email address.',
    password: (v) => v.length >= 8 ? '' : 'Use at least 8 characters.',
    username: (v) => /^[a-z0-9_]{3,20}$/i.test(v) ? '' : 'Use 3–20 letters, numbers or underscores.'
  };
  NV.validate = {
    field(input) {
      const checks = (input.dataset.rules || '').split(',').filter(Boolean);
      let msg = '';
      for (const c of checks) { msg = rules[c] ? rules[c](input.value) : ''; if (msg) break; }
      if (!msg && input.dataset.match) { const o = NV.$('#' + input.dataset.match); if (o && o.value !== input.value) msg = 'Passwords do not match.'; }
      const f = input.closest('.field');
      if (f) { f.classList.toggle('invalid', !!msg); const e = NV.$('.error', f); if (e) e.textContent = msg; }
      return !msg;
    },
    form(form) { return NV.$$('[data-rules]', form).map(i => NV.validate.field(i)).every(Boolean); },
    bind(form) { NV.$$('[data-rules]', form).forEach(i => i.addEventListener('blur', () => NV.validate.field(i))); }
  };
})(window.NV);
