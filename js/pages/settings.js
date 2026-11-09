/* Settings, auth forms and contact form */
NV.pages.settings = async function () {
  NV.router.requireAuth();
  const keys = ['notif_email', 'notif_push', 'private'];
  let currentSettings = await NV.services.profile.getSettings().catch(() => ({ notif_email: true, notif_push: true, private: false }));

  keys.forEach(k => {
    const el = NV.$('#' + k);
    if (!el) return;
    el.checked = Boolean(currentSettings[k]);
    el.addEventListener('change', async () => {
      currentSettings[k] = el.checked;
      try {
        await NV.services.profile.updateSettings({ [k]: el.checked });
        NV.toast('Setting saved', 'success');
      } catch (err) {
        NV.toast('Saved locally: ' + err.message, 'info');
      }
    });
  });

  const dark = NV.$('#dark');
  if (dark) {
    dark.checked = document.documentElement.dataset.theme === 'dark';
    dark.addEventListener('change', () => NV.theme.toggle());
  }

  // Password form
  const pwForm = NV.$('#password-form');
  if (pwForm) {
    pwForm.addEventListener('submit', async e => {
      e.preventDefault();
      const cur = pwForm.current_password.value;
      const next = pwForm.new_password.value;
      const conf = pwForm.confirm_password.value;
      if (!cur || !next) {
        NV.toast('Please fill in both current and new password.', 'error');
        return;
      }
      if (next.length < 8) {
        NV.toast('New password must be at least 8 characters.', 'error');
        return;
      }
      if (next !== conf) {
        NV.toast('New passwords do not match.', 'error');
        return;
      }
      const btn = NV.$('#save-pw-btn');
      if (btn) btn.disabled = true;
      try {
        await NV.services.profile.changePassword(cur, next);
        pwForm.reset();
        NV.toast('Password updated successfully!', 'success');
      } catch (err) {
        NV.toast(err.message || 'Could not update password.', 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  // Delete account
  const delBtn = NV.$('#delete');
  if (delBtn) {
    delBtn.addEventListener('click', () => NV.modal({
      title: 'Delete your account?',
      html: '<p style="color:var(--danger)">This will permanently erase your NaijaVibe account, profile, comments, and posts. This action cannot be reversed.</p>',
      confirmText: 'Yes, permanently delete',
      onConfirm: async () => {
        try {
          await NV.services.profile.deleteAccount();
          NV.toast('Your account has been deleted.');
          setTimeout(() => NV.router.go('index.html'), 700);
        } catch (err) {
          NV.toast(err.message || 'Could not delete account.', 'error');
        }
      }
    }));
  }
};
function authForm(id, handler, okMsg, next) {
  const f = NV.$(id); NV.validate.bind(f);
  bindPasswordToggles(f);
  f.addEventListener('submit', async e => { e.preventDefault(); if (!NV.validate.form(f)) return;
    const b = NV.$('button[type=submit]', f); b.disabled = true;
    try { await handler(f); NV.toast(okMsg, 'success'); if (next) setTimeout(() => NV.router.go(next()), 700); }
    catch (err) { NV.toast(err.message || 'Something went wrong. Check your details and try again.', 'error'); }
    b.disabled = false; });
}
function bindPasswordToggles(form) {
  NV.$$('[data-password-toggle]', form).forEach(toggle => {
    toggle.addEventListener('click', () => {
      const input = NV.$('#' + toggle.getAttribute('aria-controls'), form);
      const showing = input.type === 'password';
      input.type = showing ? 'text' : 'password';
      toggle.textContent = showing ? 'Hide' : 'Show';
      toggle.setAttribute('aria-pressed', String(showing));
    });
  });
}
NV.pages.login = async () => {
  if (await NV.services.auth.getUser()) {
    NV.router.go(NV.param('next') || 'index.html');
    return;
  }
  authForm('#login-form', f => NV.services.auth.signIn({ email: f.email.value, password: f.password.value }), 'Welcome back', () => NV.param('next') || 'index.html');
};
NV.pages.signup = () => {
  const signupForm = NV.$('#signup-form');
  NV.validate.bind(signupForm);
  bindPasswordToggles(signupForm);
  signupForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!NV.validate.form(signupForm)) return;
    const submit = NV.$('button[type=submit]', signupForm);
    submit.disabled = true;
    try {
      const result = await NV.services.auth.signUp({
        email: signupForm.email.value.trim(),
        password: signupForm.password.value,
        username: signupForm.username.value.trim()
      });
      if (!result || !result.user) throw new Error('Your account could not be created. Please try again.');
      NV.toast('Your account is ready. Welcome to NaijaVibe!', 'success');
      setTimeout(() => NV.router.go('index.html'), 700);
    } catch (err) {
      NV.toast(err.message || 'Could not create your account. Check your details and try again.', 'error');
    } finally {
      submit.disabled = false;
    }
  });
};
NV.pages.forgot = () => authForm('#forgot-form', f => NV.services.auth.sendReset(f.email.value), 'Check your email for a reset link');
NV.pages.reset = () => authForm('#reset-form', f => NV.services.auth.updatePassword(f.password.value), 'Password updated', () => 'login.html');
NV.pages.contact = () => { const f = NV.$('#contact-form'); NV.validate.bind(f); f.addEventListener('submit', e => { e.preventDefault(); if (!NV.validate.form(f)) return; f.reset(); NV.toast('Message sent. We reply within 2 working days.', 'success'); }); };
