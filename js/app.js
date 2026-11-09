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
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      try {
        const hadController = Boolean(navigator.serviceWorker.controller);
        let registration;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (hadController) location.reload();
        }, { once: true });
        registration = await navigator.serviceWorker.register(NV.url('service-worker.js'), { updateViaCache: 'none' });
        await registration.update();
        window.setInterval(() => {
          if (document.visibilityState === 'visible') registration.update().catch(error => {
            console.error('Could not check for a NaijaVibe update:', error);
          });
        }, 60 * 1000);
      } catch (error) {
        console.error('Could not register or update the offline app:', error);
      }
    }
  });
})(window.NV);
