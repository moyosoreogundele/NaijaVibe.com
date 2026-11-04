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
    catch (err) {
      const message = err.code === 'email_not_confirmed' || /email not confirmed/i.test(err.message || '')
        ? 'Email confirmation is enabled for this Supabase project. Turn off Confirm email in Supabase Auth settings to allow password-only signup and login.'
        : err.message || 'Something went wrong. Check your details and try again.';
      NV.toast(message, 'error');
    }
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
  const verificationForm = NV.$('#verify-email-form');
  const verificationStatus = NV.$('#verification-status');
  const verificationCode = NV.$('#verification-code');
  const pendingEmailKey = 'nv:pending-signup-email';
  NV.validate.bind(signupForm);
  bindPasswordToggles(signupForm);
  let verificationEmail = sessionStorage.getItem(pendingEmailKey) || '';
  const showVerification = email => {
    verificationEmail = email;
    sessionStorage.setItem(pendingEmailKey, email);
    verificationStatus.textContent = `Enter the six-digit code sent to ${email}. It expires in 10 minutes.`;
    signupForm.hidden = true;
    verificationForm.hidden = false;
    verificationCode.focus();
  };
  const showSignup = () => {
    sessionStorage.removeItem(pendingEmailKey);
    verificationEmail = '';
    verificationForm.hidden = true;
    signupForm.hidden = false;
  };
  if (verificationEmail) showVerification(verificationEmail);

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
      if (!result || !result.verificationRequired) throw new Error('We could not start email verification. Please try again.');
      showVerification(result.email);
      NV.toast('Verification code sent. Check your email.', 'success');
    } catch (err) {
      if (err.code === 'VERIFICATION_PENDING') showVerification(signupForm.email.value.trim().toLowerCase());
      NV.toast(err.message || 'Could not create your account. Check your details and try again.', 'error');
    } finally {
      submit.disabled = false;
    }
  });
  verificationForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!verificationForm.reportValidity()) return;
    const code = verificationCode.value.trim();
    if (!/^\d{6}$/.test(code)) {
      NV.toast('Enter the six-digit verification code from your email.', 'error');
      return;
    }
    const submit = NV.$('button[type=submit]', verificationForm);
    submit.disabled = true;
    try {
      const result = await NV.services.auth.verifyEmail({ email: verificationEmail, code });
      if (!result || !result.user) throw new Error('Email verification completed, but sign-in did not. Please log in.');
      sessionStorage.removeItem(pendingEmailKey);
      NV.toast('Email verified. Welcome to NaijaVibe!', 'success');
      setTimeout(() => NV.router.go('index.html'), 700);
    } catch (err) {
      NV.toast(err.message || 'Could not verify your email. Check the code and try again.', 'error');
    } finally {
      submit.disabled = false;
    }
  });
  NV.$('#resend-verification-code').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await NV.services.auth.resendVerification(verificationEmail);
      verificationStatus.textContent = `A new verification code was sent to ${verificationEmail}. It expires in 10 minutes.`;
      verificationCode.value = '';
      NV.toast('A new verification code was sent.', 'success');
    } catch (err) {
      NV.toast(err.message || 'Could not resend your verification code. Please try again.', 'error');
    } finally {
      button.disabled = false;
    }
  });
  NV.$('#change-signup-details').addEventListener('click', showSignup);
};
NV.pages.forgot = () => authForm('#forgot-form', f => NV.services.auth.sendReset(f.email.value), 'Check your email for a reset link');
NV.pages.reset = () => authForm('#reset-form', f => NV.services.auth.updatePassword(f.password.value), 'Password updated', () => 'login.html');
NV.pages.contact = () => { const f = NV.$('#contact-form'); NV.validate.bind(f); f.addEventListener('submit', e => { e.preventDefault(); if (!NV.validate.form(f)) return; f.reset(); NV.toast('Message sent. We reply within 2 working days.', 'success'); }); };
