(function (NV) {
  let notifications = [];

  async function request(url, options) {
    const response = await fetch(url, Object.assign({
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    }, options));
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error && result.error.message || 'Could not load notifications.');
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function decodeApplicationKey(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  }

  NV.notifications = {
    list() { return notifications; },
    unread() { return notifications.filter(item => item.unread).length; },
    async load() {
      try {
        const result = await request('/api/notifications');
        if (!Array.isArray(result.notifications)) throw new Error('The notification service returned an invalid response.');
        notifications = result.notifications;
      } catch (error) {
        if (error.status === 401) notifications = [];
        else throw error;
      }
      this.refreshCount();
      return notifications;
    },
    async markAll() {
      await request('/api/notifications/read', { method: 'PATCH', body: '{}' });
      notifications = notifications.map(item => Object.assign({}, item, { unread: false }));
      this.refreshCount();
    },
    async mark(id) {
      await request('/api/notifications/read', {
        method: 'PATCH',
        body: JSON.stringify({ id })
      });
      notifications = notifications.map(item => item.id === id ? Object.assign({}, item, { unread: false }) : item);
      this.refreshCount();
    },
    refreshCount() {
      NV.$$('[data-notif-count]').forEach(button => {
        const count = this.unread();
        button.textContent = count > 99 ? '99+' : String(count);
        button.hidden = count === 0;
      });
    },
    async refresh() {
      try {
        await this.load();
      } catch (error) {
        console.error('Could not refresh NaijaVibe notifications:', error);
      }
    },
    async enablePush() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        throw new Error('Push notifications are not supported by this browser.');
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Allow notifications in your browser settings to enable push alerts.');
      const { publicKey } = await request('/api/push/config');
      if (typeof publicKey !== 'string' || !publicKey) throw new Error('The notification service did not provide a public key.');
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeApplicationKey(publicKey)
        });
      }
      await request('/api/push/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ subscription: subscription.toJSON() })
      });
      return true;
    },
    async disablePush() {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return;
      await request('/api/push/subscriptions', {
        method: 'DELETE',
        body: JSON.stringify({ endpoint: subscription.endpoint })
      });
      await subscription.unsubscribe();
    }
  };
})(window.NV);
