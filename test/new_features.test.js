const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'naijavibe-features-test-'));
process.env.AUTH_DB_PATH = path.join(dataDir, 'auth.sqlite');
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-only-session-secret-for-features-test';
process.env.RESEND_API_KEY = 're_test_only';
process.env.RESEND_FROM_EMAIL = 'verify@example.com';
process.env.APP_NAME = 'NaijaVibe';
process.env.APP_URL = 'http://localhost';
process.env.AGORA_APP_ID = '0123456789abcdef0123456789abcdef';
process.env.AGORA_APP_CERTIFICATE = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { app, db } = require('../server');
const originalFetch = global.fetch;
let server;
let baseUrl;
const signupCodes = new Map();

global.fetch = async (url, options) => {
  const parsedUrl = new URL(url);
  if (parsedUrl.host === 'api.resend.com') {
    const email = JSON.parse(options.body);
    const code = email.text.match(/verification code is (\d{6})/i)?.[1];
    if (code) signupCodes.set(email.to[0], code);
    return new Response(JSON.stringify({ id: crypto.randomUUID() }), { status: 200 });
  }
  return originalFetch(url, options);
};

before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  global.fetch = originalFetch;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function api(path, options = {}) {
  const res = await originalFetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function createVerifiedUser(email, username, password = 'strong-password-123') {
  await api('/api/auth/signup', { method: 'POST', body: { email, username, password } });
  const code = signupCodes.get(email);
  const verify = await api('/api/auth/verify-email', { method: 'POST', body: { email, code } });
  const cookie = verify.res.headers.get('set-cookie')?.split(';')[0];
  return { user: verify.json.user, cookie };
}

test('Feature 1: User profiles, settings, password change, and creator follows', async () => {
  const { user: user1, cookie: cookie1 } = await createVerifiedUser('tunde@example.com', 'tunde_lagos');
  const { user: user2, cookie: cookie2 } = await createVerifiedUser('chioma@example.com', 'chioma_enugu');

  // 1. Get profile
  const profileRes = await api('/api/users/profile', { cookie: cookie1 });
  assert.equal(profileRes.res.status, 200);
  assert.equal(profileRes.json.user.username, 'tunde_lagos');

  // 2. Update profile
  const updateRes = await api('/api/users/profile', {
    method: 'PATCH',
    cookie: cookie1,
    body: {
      display_name: 'Tunde Adebayo',
      bio: 'Lagos Island techie and afrobeats enthusiast.',
      state: 'Lagos',
      phone: '+234 801 234 5678'
    }
  });
  assert.equal(updateRes.res.status, 200);
  assert.equal(updateRes.json.profile.display_name, 'Tunde Adebayo');
  assert.equal(updateRes.json.profile.state, 'Lagos');

  // 3. Update settings
  const settingsRes = await api('/api/users/settings', {
    method: 'PATCH',
    cookie: cookie1,
    body: { notif_email: false, notif_push: true, private: true }
  });
  assert.equal(settingsRes.res.status, 200);
  assert.equal(settingsRes.json.settings.private, true);

  // 4. Change password
  const pwRes = await api('/api/users/change-password', {
    method: 'POST',
    cookie: cookie1,
    body: { current_password: 'strong-password-123', new_password: 'new-strong-password-456' }
  });
  assert.equal(pwRes.res.status, 200);
  assert.equal(pwRes.json.changed, true);

  // 5. Follow / unfollow
  const followRes1 = await api(`/api/users/tunde_lagos/follow`, { method: 'POST', cookie: cookie2 });
  assert.equal(followRes1.res.status, 200);
  assert.equal(followRes1.json.following, true);
  assert.equal(followRes1.json.followersCount, 1);
  const followNotifications = await api('/api/notifications', { cookie: cookie1 });
  assert.equal(followNotifications.res.status, 200);
  assert.equal(followNotifications.json.notifications[0].type, 'follow');
  assert.match(followNotifications.json.notifications[0].text, /@chioma_enugu/);

  // Check public profile
  const publicRes = await api(`/api/users/tunde_lagos/profile`, { cookie: cookie2 });
  assert.equal(publicRes.res.status, 200);
  assert.equal(publicRes.json.profile.isFollowing, true);
  assert.equal(publicRes.json.profile.stats.followers, 1);

  // Unfollow
  const followRes2 = await api(`/api/users/tunde_lagos/follow`, { method: 'POST', cookie: cookie2 });
  assert.equal(followRes2.res.status, 200);
  assert.equal(followRes2.json.following, false);
});

test('direct messages are private, searchable, and text-only', async () => {
  const { user: sender, cookie: senderCookie } = await createVerifiedUser('messenger@example.com', 'messenger');
  const { user: recipient, cookie: recipientCookie } = await createVerifiedUser('friend@example.com', 'friend_naija');
  const { cookie: strangerCookie } = await createVerifiedUser('stranger@example.com', 'stranger');

  const anonymousSearch = await api('/api/users/search?q=friend');
  assert.equal(anonymousSearch.res.status, 401);
  const search = await api('/api/users/search?q=friend', { cookie: senderCookie });
  assert.equal(search.res.status, 200);
  assert.equal(search.json.users[0].username, 'friend_naija');

  const presence = await api('/api/users/presence', { method: 'POST', cookie: recipientCookie, body: {} });
  assert.equal(presence.res.status, 200);
  const conversation = await api('/api/messages/conversations', {
    method: 'POST',
    cookie: senderCookie,
    body: { user_id: recipient.id }
  });
  assert.equal(conversation.res.status, 200);
  assert.equal(conversation.json.peer.username, 'friend_naija');
  const conversationId = conversation.json.conversation_id;

  const sent = await api(`/api/messages/conversations/${conversationId}/messages`, {
    method: 'POST',
    cookie: senderCookie,
    body: { body: 'Hello, are you online?' }
  });
  assert.equal(sent.res.status, 201);
  assert.equal(sent.json.message.sender_id, sender.id);
  assert.equal(sent.json.message.body, 'Hello, are you online?');
  const messageNotifications = await api('/api/notifications', { cookie: recipientCookie });
  assert.equal(messageNotifications.res.status, 200);
  assert.equal(messageNotifications.json.notifications[0].type, 'message');
  assert.match(messageNotifications.json.notifications[0].url, /messages\.html\?conversation=/);
  const privateNotifications = await api('/api/notifications', { cookie: strangerCookie });
  assert.equal(privateNotifications.json.notifications.length, 0);
  const markedRead = await api('/api/notifications/read', {
    method: 'PATCH',
    cookie: recipientCookie,
    body: {}
  });
  assert.equal(markedRead.res.status, 200);
  const readNotifications = await api('/api/notifications', { cookie: recipientCookie });
  assert.equal(readNotifications.json.notifications[0].unread, false);

  const received = await api(`/api/messages/conversations/${conversationId}/messages`, { cookie: recipientCookie });
  assert.equal(received.res.status, 200);
  assert.equal(received.json.messages.length, 1);
  assert.equal(received.json.messages[0].body, 'Hello, are you online?');

  const forbidden = await api(`/api/messages/conversations/${conversationId}/messages`, { cookie: strangerCookie });
  assert.equal(forbidden.res.status, 404);
  const tooLong = await api(`/api/messages/conversations/${conversationId}/messages`, {
    method: 'POST',
    cookie: senderCookie,
    body: { body: 'x'.repeat(2001) }
  });
  assert.equal(tooLong.res.status, 400);

  const conversations = await api('/api/messages/conversations', { cookie: recipientCookie });
  assert.equal(conversations.json.conversations.length, 1);
  assert.equal(conversations.json.conversations[0].last_message, 'Hello, are you online?');
});

test('push subscriptions are authenticated and private keys are never returned', async () => {
  const { cookie } = await createVerifiedUser('push-user@example.com', 'push_user');
  const anonymousConfig = await api('/api/push/config');
  assert.equal(anonymousConfig.res.status, 401);

  const config = await api('/api/push/config', { cookie });
  assert.equal(config.res.status, 200);
  assert.equal(typeof config.json.publicKey, 'string');
  assert.equal(config.json.privateKey, undefined);

  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-token',
    keys: { p256dh: 'public-key-value', auth: 'auth-key-value' }
  };
  await api('/api/users/settings', {
    method: 'PATCH',
    cookie,
    body: { notif_push: false }
  });
  const subscribed = await api('/api/push/subscriptions', {
    method: 'POST',
    cookie,
    body: { subscription }
  });
  assert.equal(subscribed.res.status, 200);
  assert.equal(subscribed.json.subscribed, true);
  const settings = await api('/api/users/settings', { cookie });
  assert.equal(settings.json.settings.notif_push, true);
  const invalidSubscription = await api('/api/push/subscriptions', {
    method: 'POST',
    cookie,
    body: {
      subscription: {
        endpoint: 'https://127.0.0.1/private',
        keys: { p256dh: 'public-key-value', auth: 'auth-key-value' }
      }
    }
  });
  assert.equal(invalidSubscription.res.status, 400);

  const unsubscribed = await api('/api/push/subscriptions', {
    method: 'DELETE',
    cookie,
    body: { endpoint: subscription.endpoint }
  });
  assert.equal(unsubscribed.res.status, 200);
  assert.equal(unsubscribed.json.unsubscribed, true);
});

test('video likes persist per user and return an accurate shared count', async () => {
  const { cookie: creatorCookie } = await createVerifiedUser('videocreator@example.com', 'video_creator');
  const { user: viewer, cookie: viewerCookie } = await createVerifiedUser('videofan@example.com', 'video_fan');
  const { cookie: otherCookie } = await createVerifiedUser('otherfan@example.com', 'other_fan');
  const created = await api('/api/posts', {
    method: 'POST',
    cookie: creatorCookie,
    body: {
      title: 'Market day in Ibadan',
      body: 'A short video from the market.',
      category: 'culture',
      state: 'Oyo',
      video_url: 'https://example.com/market-day.mp4'
    }
  });
  assert.equal(created.res.status, 201);
  const id = created.json.post.id;

  const unauthenticated = await api(`/api/videos/${id}/like`, { method: 'POST' });
  assert.equal(unauthenticated.res.status, 401);
  const firstLike = await api(`/api/videos/${id}/like`, { method: 'POST', cookie: viewerCookie });
  assert.deepEqual(firstLike.json, { liked: true, likes: 1 });
  const creatorNotifications = await api('/api/notifications', { cookie: creatorCookie });
  assert.equal(creatorNotifications.json.notifications[0].type, 'like');
  assert.match(creatorNotifications.json.notifications[0].url, new RegExp(`post\\.html\\?id=${id}`));
  const videoAfterLike = await api(`/api/videos/${id}`, { cookie: viewerCookie });
  assert.equal(videoAfterLike.json.video.likes, 1);
  assert.equal(videoAfterLike.json.video.liked, true);

  const otherLike = await api(`/api/videos/${id}/like`, { method: 'POST', cookie: otherCookie });
  assert.deepEqual(otherLike.json, { liked: true, likes: 2 });
  const otherView = await api(`/api/videos/${id}`, { cookie: otherCookie });
  assert.equal(otherView.json.video.likes, 2);
  assert.equal(otherView.json.video.liked, true);

  const unlike = await api(`/api/videos/${id}/like`, { method: 'POST', cookie: viewerCookie });
  assert.deepEqual(unlike.json, { liked: false, likes: 1 });
  const trending = await api('/api/videos/trending?state=Oyo', { cookie: viewerCookie });
  const listedVideo = trending.json.items.find(item => item.id === id);
  assert.equal(listedVideo.likes, 1);
  assert.equal(listedVideo.liked, false);
  assert.equal(viewer.username, 'video_fan');
});

test('Feature 2: Marketplace products, businesses, and checkout flow', async () => {
  const { user, cookie } = await createVerifiedUser('kemi@example.com', 'kemi_designs');

  // 1. List initial seeded products
  const listRes = await api('/api/products');
  assert.equal(listRes.res.status, 200);
  assert.ok(listRes.json.items.length >= 4);

  // 2. Create a new product
  const createProdRes = await api('/api/products', {
    method: 'POST',
    cookie,
    body: {
      name: 'Handmade Benin Coral Bead Necklace',
      price: 32000,
      category: 'fashion',
      state: 'Edo',
      description: 'Authentic royal coral beads for ceremonies.',
      stock: 12
    }
  });
  assert.equal(createProdRes.res.status, 201);
  assert.equal(createProdRes.json.product.name, 'Handmade Benin Coral Bead Necklace');
  assert.equal(createProdRes.json.product.price, 32000);

  // 3. Register a business
  const bizRes = await api('/api/businesses', {
    method: 'POST',
    cookie,
    body: {
      name: 'Kemi African Luxe',
      cat: 'Fashion & Style',
      state: 'Lagos',
      description: 'Exclusive bridal and cultural Nigerian fashion.',
      phone: '+234 812 999 8888',
      address: 'Victoria Island, Lagos'
    }
  });
  assert.equal(bizRes.res.status, 201);
  assert.equal(bizRes.json.business.name, 'Kemi African Luxe');

  // 4. Place an order / checkout
  const orderRes = await api('/api/orders', {
    method: 'POST',
    cookie,
    body: {
      customer_name: 'Emeka Nwosu',
      customer_email: 'emeka@example.com',
      customer_phone: '08023456789',
      delivery_address: 'Plot 45 Admiralty Way, Lekki',
      state: 'Lagos',
      payment_method: 'Pay on Delivery',
      items: [
        { id: createProdRes.json.product.id, name: 'Handmade Benin Coral Bead Necklace', price: 32000, qty: 1 }
      ]
    }
  });
  assert.equal(orderRes.res.status, 201);
  assert.match(orderRes.json.order.order_number, /^NV-\d+-\d+$/);
  assert.equal(orderRes.json.order.total_amount, 32000);

  // 5. Query user orders
  const myOrdersRes = await api('/api/orders', { cookie });
  assert.equal(myOrdersRes.res.status, 200);
  assert.equal(myOrdersRes.json.orders.length, 1);
});

test('Feature 3: Live rooms, audio/video streaming, chat messages, and reactions', async () => {
  const health = await originalFetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    status: 'ok',
    services: {
      emailConfigured: true,
      liveConfigured: true,
      liveTokenMode: 'token',
      persistentStorageConfigured: true
    }
  });

  const { user: host, cookie: hostCookie } = await createVerifiedUser('livehost@example.com', 'live_host_ng');
  const { user: viewer, cookie: viewerCookie } = await createVerifiedUser('viewer@example.com', 'live_viewer_ng');

  // 1. Host creates a live audio room
  const createRoomRes = await api('/api/live/rooms', {
    method: 'POST',
    cookie: hostCookie,
    body: {
      title: 'Lagos Evening Chill & Afrobeat Gossip',
      topic: 'Music',
      state: 'Lagos',
      room_type: 'audio'
    }
  });
  assert.equal(createRoomRes.res.status, 201);
  const roomId = createRoomRes.json.room.id;
  assert.equal(createRoomRes.json.room.room_type, 'audio');

  const hostToken = await api(`/api/live/rooms/${roomId}/token`, {
    method: 'POST',
    cookie: hostCookie,
    body: { role: 'publisher' }
  });
  assert.equal(hostToken.res.status, 200);
  assert.equal(hostToken.json.role, 'publisher');
  assert.equal(hostToken.json.channelName, roomId);
  assert.equal(typeof hostToken.json.token, 'string');
  assert.equal(Object.hasOwn(hostToken.json, 'appCertificate'), false);
  const certificate = process.env.AGORA_APP_CERTIFICATE;
  const configuredAppId = process.env.AGORA_APP_ID;
  try {
    delete process.env.AGORA_APP_CERTIFICATE;
    delete process.env.AGORA_APP_ID;
    const tokenless = await api(`/api/live/rooms/${roomId}/token`, {
      method: 'POST',
      cookie: hostCookie,
      body: { role: 'publisher' }
    });
    assert.equal(tokenless.res.status, 200);
    assert.equal(tokenless.json.tokenless, true);
    assert.equal(tokenless.json.token, null);
    assert.equal(tokenless.json.appId, '569762c4c1444c27b3b6f0669a3a21c9');
  } finally {
    process.env.AGORA_APP_CERTIFICATE = certificate;
    process.env.AGORA_APP_ID = configuredAppId;
  }
  const viewerToken = await api(`/api/live/rooms/${roomId}/token`, {
    method: 'POST',
    cookie: viewerCookie,
    body: { role: 'publisher' }
  });
  assert.equal(viewerToken.res.status, 200);
  assert.equal(viewerToken.json.role, 'subscriber');

  // 2. Fetch active rooms
  const roomsRes = await api('/api/live/rooms');
  assert.equal(roomsRes.res.status, 200);
  const createdInList = roomsRes.json.rooms.find(r => r.id === roomId);
  assert.ok(createdInList);
  assert.equal(createdInList.host_username, 'live_host_ng');
  assert.equal(createdInList.viewer_count, 0);
  assert.equal(roomsRes.json.rooms.some(r => r.id.startsWith('live-lagos-') || r.id.startsWith('live-kano-') || r.id.startsWith('live-calabar-')), false);
  const filteredRoomsRes = await api('/api/live/rooms?state=Oyo');
  assert.equal(filteredRoomsRes.res.status, 200);
  assert.equal(filteredRoomsRes.json.rooms.some(r => r.id === roomId), false);
  const invalidStateRoomsRes = await api('/api/live/rooms?state=Unknown');
  assert.equal(invalidStateRoomsRes.res.status, 400);

  // 3. Send chat message
  const msgRes = await api(`/api/live/rooms/${roomId}/messages`, {
    method: 'POST',
    cookie: viewerCookie,
    body: { body: 'Sound is super clear from Abuja! 🇳🇬🔥' }
  });
  assert.equal(msgRes.res.status, 201);
  assert.equal(msgRes.json.message.body, 'Sound is super clear from Abuja! 🇳🇬🔥');
  assert.equal(msgRes.json.message.username, 'live_viewer_ng');
  const insertChatMessage = db.prepare(`
    INSERT INTO live_chat_messages (room_id, user_id, sender_name, body, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (let index = 0; index < 65; index += 1) {
    insertChatMessage.run(roomId, viewer.id, viewer.username, `Chat message ${index}`, Date.now() + index);
  }
  const chatHistory = await api(`/api/live/rooms/${roomId}/messages`);
  assert.equal(chatHistory.json.messages.length, 60);
  assert.equal(chatHistory.json.messages[0].body, 'Chat message 5');
  const chatUpdates = await api(`/api/live/rooms/${roomId}/messages?after=${msgRes.json.message.id}`);
  assert.equal(chatUpdates.json.messages.length, 65);
  assert.equal(chatUpdates.json.messages.at(-1).body, 'Chat message 64');
  const invalidChatCursor = await api(`/api/live/rooms/${roomId}/messages?after=not-a-number`);
  assert.equal(invalidChatCursor.res.status, 400);

  const firstViewerId = '00000000-0000-4000-8000-000000000001';
  const secondViewerId = '00000000-0000-4000-8000-000000000002';
  let viewerRes = await api(`/api/live/rooms/${roomId}/viewer`, {
    method: 'POST',
    body: { viewerId: firstViewerId }
  });
  assert.equal(viewerRes.json.viewer_count, 1);
  viewerRes = await api(`/api/live/rooms/${roomId}/viewer`, {
    method: 'POST',
    body: { viewerId: firstViewerId }
  });
  assert.equal(viewerRes.json.viewer_count, 1);
  viewerRes = await api(`/api/live/rooms/${roomId}/viewer`, {
    method: 'POST',
    cookie: viewerCookie,
    body: { viewerId: secondViewerId }
  });
  assert.equal(viewerRes.json.viewer_count, 2);
  viewerRes = await api(`/api/live/rooms/${roomId}/viewer`, {
    method: 'POST',
    cookie: hostCookie,
    body: { viewerId: '00000000-0000-4000-8000-000000000003' }
  });
  assert.equal(viewerRes.json.viewer_count, 2);
  const activeRoom = (await api('/api/live/rooms')).json.rooms.find(room => room.id === roomId);
  assert.equal(activeRoom.viewer_count, 2);
  viewerRes = await api(`/api/live/rooms/${roomId}/viewer`, {
    method: 'DELETE',
    body: { viewerId: firstViewerId }
  });
  assert.equal(viewerRes.json.viewer_count, 1);
  const invalidViewerRes = await api(`/api/live/rooms/${roomId}/viewer`, {
    method: 'POST',
    body: { viewerId: 'not-a-uuid' }
  });
  assert.equal(invalidViewerRes.res.status, 400);

  // 4. Send emoji reaction
  const reactRes = await api(`/api/live/rooms/${roomId}/react`, {
    method: 'POST',
    cookie: viewerCookie,
    body: { reaction: '🔥' }
  });
  assert.equal(reactRes.res.status, 201);
  assert.equal(reactRes.json.reaction, '🔥');

  // 5. Host ends stream
  const endRes = await api(`/api/live/rooms/${roomId}/end`, {
    method: 'POST',
    cookie: hostCookie
  });
  assert.equal(endRes.res.status, 200);
  assert.equal(endRes.json.ended, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM live_viewers WHERE room_id = ?').get(roomId).count, 0);
});
