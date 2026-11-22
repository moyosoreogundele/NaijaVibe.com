/* App bootstrap: shared chrome first, then the page module named in <body data-page> */
(function (NV) {
  NV.pages = NV.pages || {};
  document.addEventListener('DOMContentLoaded', async () => {
    await NV.supabaseReady;
    if (NV.supabaseError) NV.toast(NV.supabaseError.message || 'Could not initialize shared Supabase services.', 'error');
    NV.renderHeader(); NV.renderFooter(); NV.renderDrawer();
    NV.navigation.bind(); NV.notifications.refresh();
    window.setInterval(() => {
      if (document.visibilityState === 'visible') NV.notifications.refresh();
    }, 60 * 1000);
    const page = document.body.dataset.page;
    try {
      if (NV.pages[page]) await NV.pages[page]();
      if (!NV.services.images) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = NV.url('js/services/images.service.js');
          script.onload = resolve;
          script.onerror = () => reject(new Error('Could not load the image service.'));
          document.head.appendChild(script);
        });
      }
      NV.services.images.setupLazyImages(document);
    } catch (e) {
      console.error('Could not initialize this page:', e);
      NV.toast(e.message || 'Something went wrong loading this page.', 'error');
    }
    NV.hydrateIcons();

    // In-app update alert
    function promptAppUpdate(worker) {
      if (document.getElementById('nv-update-banner')) return;
      const banner = document.createElement('div');
      banner.id = 'nv-update-banner';
      banner.className = 'update-banner';
      banner.innerHTML = `
        <div class="update-banner-content">
          <span>⚡ <b>New version of NaijaVibe available!</b> Tap update to get the latest features.</span>
          <button class="btn btn-primary btn-sm" id="nv-update-btn">Update Now</button>
        </div>
      `;
      document.body.appendChild(banner);
      document.getElementById('nv-update-btn')?.addEventListener('click', () => {
        if (worker) {
          worker.postMessage({ type: 'SKIP_WAITING' });
        } else {
          location.reload();
        }
      });
    }

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      try {
        let isRefreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!isRefreshing) {
            isRefreshing = true;
            location.reload();
          }
        });
        const registration = await navigator.serviceWorker.register(NV.url('service-worker.js'), { updateViaCache: 'none' });
        if (registration.waiting) {
          promptAppUpdate(registration.waiting);
        }
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                promptAppUpdate(newWorker);
              }
            });
          }
        });
        window.setInterval(() => {
          if (document.visibilityState === 'visible') registration.update().catch(error => {
            console.error('Could not check for a NaijaVibe update:', error);
          });
        }, 45 * 1000);
      } catch (error) {
        console.error('Could not register or update the offline app:', error);
      }
    }

    // Prompt for mobile push alerts if supported and user is signed in
    if ('Notification' in window && Notification.permission === 'default' && 'serviceWorker' in navigator) {
      setTimeout(async () => {
        const u = await NV.services.auth.getUser().catch(() => null);
        if (u && !sessionStorage.getItem('nv_push_prompted') && !document.getElementById('nv-push-prompt')) {
          sessionStorage.setItem('nv_push_prompted', 'true');
          const pushPrompt = document.createElement('div');
          pushPrompt.id = 'nv-push-prompt';
          pushPrompt.className = 'push-prompt-card';
          pushPrompt.innerHTML = `
            <div>
              <b>🔔 Get alerts directly on your phone</b>
              <p>Receive notifications when friends message you, follow you, or like your posts.</p>
            </div>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button class="btn btn-primary btn-sm" id="enable-phone-push">Enable Alerts</button>
              <button class="btn btn-secondary btn-sm" id="dismiss-phone-push">Later</button>
            </div>
          `;
          document.body.appendChild(pushPrompt);
          document.getElementById('enable-phone-push')?.addEventListener('click', async () => {
            pushPrompt.remove();
            try {
              await NV.notifications.enablePush();
              NV.toast('Phone push alerts enabled! 🔔', 'success');
            } catch (err) {
              NV.toast(err.message || 'Could not enable push alerts.', 'error');
            }
          });
          document.getElementById('dismiss-phone-push')?.addEventListener('click', () => pushPrompt.remove());
        }
      }, 3500);
    }
  });
})(window.NV);
