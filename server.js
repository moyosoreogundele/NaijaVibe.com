require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const { rateLimit } = require('express-rate-limit');
const { RtcRole, RtcTokenBuilder } = require('agora-access-token');
const webPushModule = require('web-push');
const states = require('./data/states.json');

let webPush = webPushModule;
let pushPublicKey = null;
let pushPrivateKey = null;
const ROOT = __dirname;
const PRIVATE_DIR = path.join(ROOT, '.private');
const RAILWAY_VOLUME_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH;
const DB_PATH = process.env.AUTH_DB_PATH || path.join(RAILWAY_VOLUME_DIR || PRIVATE_DIR, 'auth.sqlite');
const UPLOAD_DIR = path.join(path.dirname(DB_PATH), 'uploads');
const SESSION_COOKIE = 'nv_session';
const DEFAULT_AGORA_APP_ID = '569762c4c1444c27b3b6f0669a3a21c9';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_INTERVAL_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const NEWS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LIVE_VIEWER_TTL_MS = 30 * 1000;
const ARTICLE_MEDIA_LIMIT = 6;
const YOUTUBE_TRENDING_CACHE_MS = 10 * 60 * 1000;
const NEWS_PUBLISHER_HOSTS = [
  'anambrastate.gov.ng', 'bbc.com', 'bbc.co.uk', 'businessday.ng', 'channelstv.com',
  'dailytrust.com', 'dailypost.ng', 'guardian.ng', 'leadership.ng', 'punchng.com',
  'premiumtimesng.com', 'sunnewsonline.com', 'thecable.ng', 'thenationonlineng.net',
  'thisdaylive.com', 'vanguardngr.com'
];
const POST_CATEGORIES = new Set(['food', 'travel', 'culture', 'music', 'fashion', 'events']);
let youtubeTrendingCache = null;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS news_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS news_likes (
    article_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (article_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS news_comments_article_created ON news_comments(article_id, created_at);
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 140),
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
    category TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT '',
    image_url TEXT,
    video_url TEXT,
    external_video_url TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS posts_created_at ON posts(created_at DESC, id DESC);
  CREATE TABLE IF NOT EXISTS video_views (
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    viewer_hash TEXT NOT NULL,
    viewed_on TEXT NOT NULL,
    viewed_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, viewer_hash, viewed_on)
  );
  CREATE INDEX IF NOT EXISTS video_views_post_viewed ON video_views(post_id, viewed_at DESC);
  CREATE TABLE IF NOT EXISTS post_likes (
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS post_likes_post_idx ON post_likes(post_id);
  CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pending_signups (
    email TEXT PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_username_nocase ON users(username COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT 'assets/images/avatar-1.jpg',
    state TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    settings_json TEXT NOT NULL DEFAULT '{"notif_email":true,"notif_push":true,"private":false}',
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_follows (
    follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (follower_id, following_id)
  );
  CREATE TABLE IF NOT EXISTS direct_conversations (
    id TEXT PRIMARY KEY NOT NULL,
    user_one_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_two_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (user_one_id, user_two_id),
    CHECK (user_one_id < user_two_id)
  );
  CREATE TABLE IF NOT EXISTS direct_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES direct_conversations(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_presence (
    user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_seen_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    text TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    read_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    subscription_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS direct_messages_conversation_idx ON direct_messages(conversation_id, id DESC);
  CREATE INDEX IF NOT EXISTS direct_conversations_updated_idx ON direct_conversations(updated_at DESC);
  CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx ON notifications(recipient_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    cat TEXT NOT NULL,
    state TEXT NOT NULL,
    rating REAL NOT NULL DEFAULT 5.0,
    image TEXT,
    description TEXT,
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'approved',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    business_id TEXT REFERENCES businesses(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    image TEXT,
    seller TEXT NOT NULL,
    description TEXT,
    state TEXT DEFAULT '',
    category TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 50,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    order_number TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    delivery_address TEXT NOT NULL,
    state TEXT NOT NULL,
    items_json TEXT NOT NULL,
    total_amount INTEGER NOT NULL,
    payment_method TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS live_rooms (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 120),
    topic TEXT NOT NULL,
    state TEXT NOT NULL,
    room_type TEXT NOT NULL DEFAULT 'video',
    status TEXT NOT NULL DEFAULT 'live',
    viewer_count INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    ended_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS live_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL REFERENCES live_rooms(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    sender_name TEXT NOT NULL DEFAULT 'Viewer',
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 300),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS live_chat_room_idx ON live_chat_messages(room_id, created_at);

  CREATE TABLE IF NOT EXISTS live_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL REFERENCES live_rooms(id) ON DELETE CASCADE,
    reaction TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS live_reactions_room_idx ON live_reactions(room_id, created_at);
  CREATE TABLE IF NOT EXISTS live_viewers (
    room_id TEXT NOT NULL REFERENCES live_rooms(id) ON DELETE CASCADE,
    viewer_hash TEXT NOT NULL,
    last_seen_at INTEGER NOT NULL,
    PRIMARY KEY (room_id, viewer_hash)
  );
  CREATE INDEX IF NOT EXISTS live_viewers_room_seen_idx ON live_viewers(room_id, last_seen_at);
`);
const configuredVapidPublicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
const configuredVapidPrivateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
if (Boolean(configuredVapidPublicKey) !== Boolean(configuredVapidPrivateKey)) {
  throw new Error('WEB_PUSH_VAPID_PUBLIC_KEY and WEB_PUSH_VAPID_PRIVATE_KEY must be configured together.');
}
if (configuredVapidPublicKey && configuredVapidPrivateKey) {
  pushPublicKey = configuredVapidPublicKey;
  pushPrivateKey = configuredVapidPrivateKey;
} else {
  const savedVapidKeys = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('web_push_vapid_keys');
  if (savedVapidKeys) {
    const keys = JSON.parse(savedVapidKeys.value);
    pushPublicKey = keys.publicKey;
    pushPrivateKey = keys.privateKey;
  } else {
    const keys = webPush.generateVAPIDKeys();
    pushPublicKey = keys.publicKey;
    pushPrivateKey = keys.privateKey;
    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run('web_push_vapid_keys', JSON.stringify(keys));
  }
}
webPush.setVapidDetails(
  process.env.WEB_PUSH_CONTACT || 'mailto:webpush@naijavibe.app',
  pushPublicKey,
  pushPrivateKey
);
if (!db.pragma('table_info(posts)').some(column => column.name === 'external_video_url')) {
  db.exec('ALTER TABLE posts ADD COLUMN external_video_url TEXT');
}

function seedInitialMarketAndLive() {
  const businessCount = db.prepare('SELECT COUNT(*) AS count FROM businesses').get().count;
  if (businessCount === 0) {
    const insertBiz = db.prepare(`
      INSERT INTO businesses (id, user_id, name, cat, state, rating, image, description, phone, address, status, created_at)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)
    `);
    const initialBusinesses = [
      ['biz-1', 'Mama Put Kitchen', 'Food & Drinks', 'Lagos', 4.8, 'assets/images/trend-food.jpg', 'Authentic Nigerian party jollof, amala, pounded yam and fresh soups.', '+234 802 345 6789', '14 Adeola Odeku, Victoria Island, Lagos', Date.now()],
      ['biz-2', 'Adire House', 'Fashion & Style', 'Oyo', 4.6, 'assets/images/trend-culture.jpg', 'Hand-dyed authentic Abeokuta & Ibadan adire fabric and tailored wear.', '+234 803 112 3344', 'Ring Road, Ibadan, Oyo State', Date.now()],
      ['biz-3', 'Obudu Escapes', 'Travel & Places', 'Cross River', 4.9, 'assets/images/trend-travel.jpg', 'Bespoke tours, canopy trail hikes and chalet getaways in Cross River highlands.', '+234 805 778 9900', 'Obudu Plateau, Cross River State', Date.now()],
      ['biz-4', 'Afrobeat Live Studio', 'Music & Entertainment', 'Lagos', 4.5, 'assets/images/trend-music.jpg', 'Recording studio, live sound lounge and music rehearsals in the heart of Ikeja.', '+234 816 234 5678', 'Allen Avenue, Ikeja, Lagos', Date.now()],
      ['biz-5', 'Calabar Heritage Crafts', 'Culture & Heritage', 'Cross River', 4.7, 'assets/images/trend-events.jpg', 'Traditional cane furniture, brass bells, carved calabashes and beaded crowns.', '+234 808 901 2345', 'Marian Road, Calabar', Date.now()],
      ['biz-6', 'Kano Royal Leatherworks', 'Fashion & Style', 'Kano', 4.9, 'assets/images/trend-culture.jpg', 'Centuries-old tannery artisans creating genuine leather slippers, bags and wallets.', '+234 803 555 4321', 'Kofar Wambai Market, Kano', Date.now()]
    ];
    for (const b of initialBusinesses) {
      insertBiz.run(...b);
    }
  }

  const productCount = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
  if (productCount === 0) {
    const insertProd = db.prepare(`
      INSERT INTO products (id, user_id, business_id, name, price, image, seller, description, state, category, stock, created_at)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const initialProducts = [
      ['prod-1', 'biz-2', 'Hand-woven Aso Oke Set', 45000, 'assets/images/trend-culture.jpg', 'Adire House', 'Luxurious 3-piece traditional Aso Oke ensemble woven with metallic highlights. Suitable for weddings and festivals.', 'Oyo', 'fashion', 25, Date.now()],
      ['prod-2', 'biz-1', 'Smoky Jollof Spice Blend (500g)', 3500, 'assets/images/trend-food.jpg', 'Mama Put Kitchen', 'Award-winning secret blend of scotch bonnet, Cameroon pepper, bay leaf and dried crayfish for authentic firewood taste.', 'Lagos', 'food', 120, Date.now()],
      ['prod-3', 'biz-2', 'Ankara Silhouette Event Gown', 28000, 'assets/images/post-4.jpg', 'Adire House', 'Tailored African wax print evening gown with puff sleeves and subtle gold accents.', 'Lagos', 'fashion', 15, Date.now()],
      ['prod-4', 'biz-5', 'Calabar Carnival Day Pass & Merch', 12000, 'assets/images/trend-events.jpg', 'Calabar Heritage Crafts', 'Official festival pass including celebration entry, collectible bandana and celebration pin.', 'Cross River', 'events', 80, Date.now()],
      ['prod-5', 'biz-6', 'Artisanal Kano Leather Slippers', 18500, 'assets/images/trend-travel.jpg', 'Kano Royal Leatherworks', 'Handcrafted genuine goat leather slippers with double-stitched sole for lasting comfort and style.', 'Kano', 'fashion', 40, Date.now()],
      ['prod-6', 'biz-1', 'Pure Organic Niger Delta Honey (1 Litre)', 6500, 'assets/images/post-2.jpg', 'Mama Put Kitchen', '100% raw unpasteurized wildflower honey harvested sustainably from natural Nigerian mangrove forests.', 'Delta', 'food', 60, Date.now()],
      ['prod-7', 'biz-5', 'Benin Bronze Style Royal Bust', 35000, 'assets/images/trend-culture.jpg', 'Calabar Heritage Crafts', 'Finely sculpted desktop bronze commemorative bust depicting ancestral Edo royalty.', 'Edo', 'culture', 10, Date.now()],
      ['prod-8', 'biz-1', 'Dried Zobo Hibiscus Flowers & Spices (1kg)', 2800, 'assets/images/trend-food.jpg', 'Mama Put Kitchen', 'Premium sun-dried deep crimson hibiscus calyces with dried ginger slices and cloves.', 'Kano', 'food', 95, Date.now()]
    ];
    for (const p of initialProducts) {
      insertProd.run(...p);
    }
  }

  db.prepare(`
    UPDATE live_rooms SET status = 'ended', ended_at = ?
    WHERE id IN ('live-lagos-afrobeat', 'live-kano-culture', 'live-calabar-carnival')
      AND owner_id IS NULL AND status = 'live'
  `).run(Date.now());
}
seedInitialMarketAndLive();

function getOrCreateProfile(userId, username = '') {
  let profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  if (!profile) {
    const displayName = username || 'Naija Explorer';
    db.prepare(`
      INSERT OR IGNORE INTO profiles (user_id, display_name, bio, avatar_url, state, phone, website, settings_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, displayName, 'Proudly sharing the vibes of Nigeria.', 'assets/images/avatar-1.jpg', 'Lagos', '', '', JSON.stringify({ notif_email: true, notif_push: true, private: false }), Date.now());
    profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  }
  return profile;
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

function fail(res, status, code, message, details = {}) {
  return res.status(status).json({ error: { code, message, ...details } });
}

app.get('/api/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    const appId = process.env.AGORA_APP_ID || (process.env.AGORA_APP_CERTIFICATE ? '' : DEFAULT_AGORA_APP_ID);
    const liveConfigured = /^[a-f0-9]{32}$/i.test(appId);
    res.json({
      status: 'ok',
      services: {
        emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
        liveConfigured,
        liveTokenMode: liveConfigured ? (process.env.AGORA_APP_CERTIFICATE ? 'token' : 'tokenless') : 'unconfigured',
        persistentStorageConfigured: Boolean(process.env.AUTH_DB_PATH || RAILWAY_VOLUME_DIR)
      }
    });
  } catch (error) {
    console.error('Application health check failed:', error);
    fail(res, 503, 'SERVICE_UNAVAILABLE', 'The application database is unavailable.');
  }
});

const cookieParser = (req, _res, next) => {
  const cookie = req.get('cookie') || '';
  req.cookies = Object.fromEntries(cookie.split(';').map(part => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
  next();
};
app.use(cookieParser);

const uploadTypes = {
  'image/jpeg': { extension: 'jpg', maxBytes: 5 * 1024 * 1024 },
  'image/png': { extension: 'png', maxBytes: 5 * 1024 * 1024 },
  'image/webp': { extension: 'webp', maxBytes: 5 * 1024 * 1024 },
  'image/gif': { extension: 'gif', maxBytes: 5 * 1024 * 1024 },
  'video/mp4': { extension: 'mp4', maxBytes: 25 * 1024 * 1024 },
  'video/webm': { extension: 'webm', maxBytes: 25 * 1024 * 1024 },
  'video/ogg': { extension: 'ogv', maxBytes: 25 * 1024 * 1024 }
};
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many uploads. Please wait and try again.' } }
});
const postCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many posts. Please wait and try again.' } }
});
const videoViewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many video plays were recorded. Please wait and try again.' } }
});

app.post('/api/uploads', uploadLimiter, express.raw({ type: Object.keys(uploadTypes), limit: '25mb' }), async (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to upload media.');
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return fail(res, 403, 'INVALID_ORIGIN', 'Request origin is not allowed.');
    } catch {
      return fail(res, 403, 'INVALID_ORIGIN', 'Request origin is not allowed.');
    }
  }
  const type = uploadTypes[req.get('content-type')?.split(';')[0].toLowerCase()];
  const buffer = req.body;
  if (!type || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return fail(res, 400, 'INVALID_UPLOAD', 'Choose a supported image or video file.');
  }
  if (buffer.length > type.maxBytes) return fail(res, 413, 'UPLOAD_TOO_LARGE', 'This file is larger than the allowed upload size.');
  const validSignature = {
    jpg: buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
    png: buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    webp: buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP',
    gif: buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6)),
    mp4: buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp',
    webm: buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
    ogv: buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS'
  }[type.extension];
  if (!validSignature) return fail(res, 400, 'INVALID_UPLOAD', 'The uploaded file does not match its declared media type.');
  const filename = `${crypto.randomUUID()}.${type.extension}`;
  try {
    await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), buffer, { flag: 'wx' });
  } catch (error) {
    return fail(res, 500, 'UPLOAD_FAILED', 'The media file could not be saved. Please try again.');
  }
  res.status(201).json({ url: `/media/${filename}` });
});

app.get('/media/:filename', (req, res, next) => {
  if (!/^[a-f0-9-]{36}\.(?:jpg|png|webp|gif|mp4|webm|ogv)$/.test(req.params.filename)) {
    return fail(res, 404, 'MEDIA_NOT_FOUND', 'This media file was not found.');
  }
  res.set('X-Content-Type-Options', 'nosniff');
  res.sendFile(req.params.filename, { root: UPLOAD_DIR }, error => {
    if (error && !res.headersSent) {
      if (error.code === 'ENOENT') return fail(res, 404, 'MEDIA_NOT_FOUND', 'This media file was not found.');
      next(error);
    }
  });
});

app.use((req, _res, next) => {
  req.body = req.body || {};
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 100 : 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: req => req.path === '/me' || req.path === '/logout',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' } }
});
const newsCommentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many comments. Please wait and try again.' } }
});
const liveTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many live token requests. Please wait and try again.' } }
});

app.use('/api/auth', (req, res, next) => {
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) {
        return res.status(403).json({ error: { code: 'INVALID_ORIGIN', message: 'Request origin is not allowed.' } });
      }
    } catch {
      return res.status(403).json({ error: { code: 'INVALID_ORIGIN', message: 'Request origin is not allowed.' } });
    }
  }
  next();
}, authLimiter);

const newsFeeds = [
  { name: 'Premium Times', url: 'https://www.premiumtimesng.com/category/news/feed' },
  { name: 'Channels Television', url: 'https://www.channelstv.com/feed/' },
  { name: 'Punch Newspapers', url: 'https://rss.punchng.com/v1/category/latest_news' }
];
const NEWS_CACHE_TTL_MS = 60 * 60 * 1000;
let newsCache = { updatedAt: 0, items: [] };
const stateNewsCache = new Map();
let eventNewsCache = { updatedAt: 0, items: [] };

function decodeXmlText(value) {
  const decodeEntity = (entity, code) => {
      if (code[0] === '#') {
        const point = code[1].toLowerCase() === 'x'
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
        return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
      }
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[code.toLowerCase()];
  };
  const entityPattern = /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi;
  let decoded = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  decoded = decoded.replace(entityPattern, decodeEntity);
  decoded = decoded.replace(entityPattern, decodeEntity);
  return decoded.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function rssTag(item, tag) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = item.match(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}\\s*>`, 'i'));
  return match ? decodeXmlText(match[1]) : '';
}

function rssAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`\\b${escapedName}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match ? match[2].replace(/&amp;/gi, '&').trim() : '';
}

function isRecentNews(item, now = Date.now()) {
  const publishedAt = Date.parse(item.publishedAt || '');
  return Number.isFinite(publishedAt) && publishedAt <= now + 24 * 60 * 60 * 1000 && now - publishedAt <= NEWS_MAX_AGE_MS;
}

function publisherAllowed(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return NEWS_PUBLISHER_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`));
}

function parseArticleMedia(html, pageUrl) {
  const metadata = new Map();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (rssAttribute(tag, 'property') || rssAttribute(tag, 'name')).toLowerCase();
    const value = rssAttribute(tag, 'content');
    if (key && value && !metadata.has(key)) metadata.set(key, value);
  }
  const toSafeUrl = value => {
    if (!value) return null;
    try {
      const url = new URL(value, pageUrl);
      return url.protocol === 'https:' ? url.toString() : null;
    } catch {
      return null;
    }
  };
  const imageUrl = toSafeUrl(metadata.get('og:image') || metadata.get('og:image:url') || metadata.get('twitter:image'));
  const rawVideo = metadata.get('og:video:secure_url') || metadata.get('og:video') || metadata.get('twitter:player:stream');
  const videoType = metadata.get('og:video:type') || '';
  const videoUrl = /^video\/(?:mp4|webm|ogg)$/i.test(videoType) || /\.(?:mp4|webm|ogv)(?:[?#]|$)/i.test(rawVideo || '')
    ? toSafeUrl(rawVideo)
    : null;
  return { imageUrl, videoUrl };
}

async function readHtmlLimited(response, maxBytes = 1024 * 1024) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return '';
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function loadArticleMedia(articleUrl) {
  const noMedia = { sourceUrl: null, imageUrl: null, videoUrl: null };
  let url;
  try {
    url = new URL(articleUrl);
  } catch {
    return noMedia;
  }
  if (url.protocol !== 'https:' || (url.hostname !== 'news.google.com' && !publisherAllowed(url.hostname))) {
    return noMedia;
  }

  for (let redirects = 0; redirects <= 5; redirects += 1) {
    let response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        headers: { Accept: 'text/html', 'User-Agent': 'NaijaVibe/1.0' },
        signal: AbortSignal.timeout(5000)
      });
    } catch {
      return noMedia;
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirects === 5) return noMedia;
      try {
        const nextUrl = new URL(location, url);
        if (nextUrl.protocol !== 'https:' || (nextUrl.hostname !== 'news.google.com' && !publisherAllowed(nextUrl.hostname))) {
          return noMedia;
        }
        url = nextUrl;
        continue;
      } catch {
        return noMedia;
      }
    }
    if (!response.ok || !publisherAllowed(url.hostname) || !/text\/html/i.test(response.headers.get('content-type') || '')) {
      return noMedia;
    }
    try {
      return { sourceUrl: url.toString(), ...parseArticleMedia(await readHtmlLimited(response), url) };
    } catch (error) {
      console.warn('Could not read publisher story media:', error.message);
      return noMedia;
    }
  }
  return noMedia;
}

function safeMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function isBrandingImage(url) {
  return /\/[^/]*(?:logo|placeholder|no-image|default-image)[^/]*\.(?:jpe?g|png|webp|gif)(?:[?#]|$)/i.test(url);
}

function extractNewsMedia(item) {
  let imageUrl = null;
  let videoUrl = null;
  const markup = item.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'");
  const mediaTags = markup.matchAll(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*\/?>/gi);
  for (const [tag] of mediaTags) {
    const url = safeMediaUrl(rssAttribute(tag, 'url'));
    if (!url) continue;
    const type = rssAttribute(tag, 'type').toLowerCase();
    const medium = rssAttribute(tag, 'medium').toLowerCase();
    if (!videoUrl && (medium === 'video' || type.startsWith('video/'))) videoUrl = url;
    else if (!imageUrl && !isBrandingImage(url) && (medium === 'image' || type.startsWith('image/') || /\.(?:jpe?g|png|webp|gif)(?:[?#]|$)/i.test(url))) imageUrl = url;
  }

  if (!imageUrl) {
    for (const [tag] of markup.matchAll(/<img\b[^>]*>/gi)) {
      imageUrl = safeMediaUrl(rssAttribute(tag, 'src') || rssAttribute(tag, 'data-src'));
      if (imageUrl && !isBrandingImage(imageUrl)) break;
      imageUrl = null;
    }
  }
  if (!videoUrl) {
    const sourceTag = markup.match(/<(?:video|source)\b[^>]*>/i)?.[0];
    if (sourceTag) videoUrl = safeMediaUrl(rssAttribute(sourceTag, 'src'));
  }
  return { imageUrl, videoUrl };
}

function parseNewsFeed(xml, source) {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(([, item]) => {
    const rawTitle = rssTag(item, 'title');
    const url = rssTag(item, 'link');
    const dateValue = rssTag(item, 'pubDate');
    const description = rssTag(item, 'description') || rssTag(item, 'content:encoded');
    const publisherName = rssTag(item, 'source').slice(0, 100);
    const publisher = publisherName || source;
    const publisherSuffix = ` - ${publisher}`;
    const title = rawTitle.toLowerCase().endsWith(publisherSuffix.toLowerCase())
      ? rawTitle.slice(0, -publisherSuffix.length)
      : rawTitle;
    const summary = publisherName && description.toLowerCase().endsWith(publisherName.toLowerCase())
      ? description.slice(0, -publisherName.length).replace(/[\s-]+$/, '')
      : description;
    if (!title || !url) return null;
    let articleUrl;
    try {
      articleUrl = new URL(url);
    } catch {
      return null;
    }
    if (articleUrl.protocol !== 'https:') return null;
    const date = dateValue && Number.isFinite(Date.parse(dateValue)) ? new Date(dateValue).toISOString() : null;
    return {
      id: crypto.createHash('sha256').update(articleUrl.toString()).digest('hex').slice(0, 20),
      title: title.slice(0, 220),
      url: articleUrl.toString(),
      source,
      publisher,
      publishedAt: date,
      summary: summary.slice(0, 320),
      ...extractNewsMedia(item)
    };
  }).filter(Boolean);
}

async function loadNigeriaNews() {
  const results = await Promise.allSettled(newsFeeds.map(async feed => {
    const response = await fetch(feed.url, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'NaijaVibe/1.0' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { feed, items: parseNewsFeed(await response.text(), feed.name) };
  }));
  const fetched = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  for (const result of results.filter(entry => entry.status === 'rejected')) {
    console.error('Nigeria news RSS source failed:', result.reason.message);
  }
  if (!fetched.length) throw new Error('All Nigeria news RSS sources are unavailable.');

  const uniqueItems = new Map();
  for (const { items } of fetched) {
    for (const item of items) {
      if (!uniqueItems.has(item.url)) uniqueItems.set(item.url, item);
    }
  }
  let items = [...uniqueItems.values()]
    .filter(item => isRecentNews(item))
    .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0))
    .slice(0, 30);
  if (!items.length) throw new Error('The Nigeria news RSS sources returned no usable articles.');
  const missingMedia = items.map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.imageUrl && !item.videoUrl)
    .slice(0, ARTICLE_MEDIA_LIMIT);
  const enrichedMedia = await Promise.all(missingMedia.map(({ item }) => loadArticleMedia(item.url)));
  for (let index = 0; index < missingMedia.length; index += 1) {
    items[missingMedia[index].index] = { ...missingMedia[index].item, ...enrichedMedia[index] };
  }
  newsCache = { updatedAt: Date.now(), items };
  return { items, updatedAt: new Date(newsCache.updatedAt).toISOString(), stale: false };
}

async function loadGoogleNews(query, source) {
  const url = new URL('https://news.google.com/rss/search');
  url.search = new URLSearchParams({ q: query, hl: 'en-NG', gl: 'NG', ceid: 'NG:en' }).toString();
  const response = await fetch(url, {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'NaijaVibe/1.0' },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Google News returned HTTP ${response.status}`);
  const items = parseNewsFeed(await response.text(), source).map(item => ({
    ...item,
    summary: item.summary.toLowerCase().replace(/[^a-z0-9]/g, '') === item.title.toLowerCase().replace(/[^a-z0-9]/g, '')
      ? ''
      : item.summary,
    id: crypto.createHash('sha256').update(item.url).digest('hex').slice(0, 20)
  })).filter(item => isRecentNews(item))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 12);
  const mediaItems = items.slice(0, ARTICLE_MEDIA_LIMIT);
  const enriched = await Promise.all(mediaItems.map(async item => ({
    ...item,
    ...await loadArticleMedia(item.url)
  })));
  return [...enriched, ...items.slice(ARTICLE_MEDIA_LIMIT)];
}

function stateSearchTerms(state) {
  const terms = [state.name, state.capital];
  if (state.name === 'FCT Abuja') terms.push('Abuja');
  return [...new Set(terms.map(term => term.toLowerCase()).filter(Boolean))];
}

function mentionsState(item, state) {
  const text = `${item.title} ${item.summary} ${item.publisher || ''}`.toLowerCase();
  return stateSearchTerms(state).some(term => text.includes(term));
}

function stateSearchName(state) {
  return state.name === 'FCT Abuja' ? 'Abuja' : state.name;
}

function isEventCoverage(item) {
  return /\b(festival|concert|carnival|exhibition|expo|fair|event|summit|conference|convention|celebration|award(?:s)? ceremony|fashion week|tournament|championship|parade|show)\b/i.test(item.title);
}

function isNigeriaEvent(item) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  if (/\b(nigeria|nigerian|lagos|abuja|ikeja|ibadan|kano|enugu|port harcourt|benin city|calabar|uyo|jos|makurdi|ilorin|osogbo|abeokuta|akure|ado ekiti|owerri|awka|asaba|yenagoa|maiduguri|damaturu|bauchi|gombe|jalingo|lafia|minna|lokoja|sokoto|birnin kebbi|gusau|katsina|yola|birnin kebbi|umuahia|abakaliki|ado ekiti|otukpo|onitsha|zaria|sapele|warri|ogbomoso)\b/.test(text)) {
    return true;
  }
  return states.some(state => [state.name, state.capital].some(place => {
    const term = place.toLowerCase();
    return term.length > 3 && text.includes(term);
  }));
}

async function loadStateUpdates(state) {
  const searchName = stateSearchName(state);
  const [newsResult, eventResult, nationalResult] = await Promise.allSettled([
    loadGoogleNews(`"${searchName}" Nigeria news when:7d`, `Google News · ${state.name}`),
    loadGoogleNews(`"${searchName}" Nigeria (festival OR concert OR carnival OR exhibition OR fair OR summit) when:7d`, `Google News · ${state.name} events`),
    newsCache.items.length && Date.now() - newsCache.updatedAt < NEWS_CACHE_TTL_MS
      ? Promise.resolve({ items: newsCache.items })
      : loadNigeriaNews()
  ]);
  let news = newsResult.status === 'fulfilled' ? newsResult.value.filter(item => mentionsState(item, state)) : [];
  const events = eventResult.status === 'fulfilled'
    ? eventResult.value.filter(item => mentionsState(item, state) && isEventCoverage(item))
    : [];
  if (!news.length && nationalResult.status === 'fulfilled') {
    news = nationalResult.value.items.filter(item => isRecentNews(item) && mentionsState(item, state)).slice(0, 12);
  }
  const stateEvents = events.length || nationalResult.status !== 'fulfilled'
    ? events
    : nationalResult.value.items.filter(item => isRecentNews(item) && mentionsState(item, state) && isEventCoverage(item)).slice(0, 12);
  if (newsResult.status === 'rejected') console.error(`Could not load ${state.name} news:`, newsResult.reason.message);
  if (eventResult.status === 'rejected') console.error(`Could not load ${state.name} event news:`, eventResult.reason.message);
  if (nationalResult.status === 'rejected') console.error(`Could not load national news fallback for ${state.name}:`, nationalResult.reason.message);
  if (newsResult.status === 'rejected' && eventResult.status === 'rejected' && nationalResult.status === 'rejected') {
    throw new Error(`No current news sources are available for ${state.name}.`);
  }
  const updatedAt = Date.now();
  const data = { news, events: stateEvents, updatedAt: new Date(updatedAt).toISOString(), stale: false };
  stateNewsCache.set(state.slug, { updatedAt, data });
  return data;
}

app.get('/api/states/:slug/updates', async (req, res) => {
  const state = states.find(item => item.slug === req.params.slug);
  if (!state) return fail(res, 404, 'STATE_NOT_FOUND', 'The requested Nigerian state was not found.');
  const cached = stateNewsCache.get(state.slug);
  if (req.query.refresh !== 'true' && cached && Date.now() - cached.updatedAt < NEWS_CACHE_TTL_MS) {
    return res.json({
      ...cached.data,
      news: withNewsReactions(req, cached.data.news.filter(item => isRecentNews(item))),
      events: withNewsReactions(req, cached.data.events.filter(item => isRecentNews(item) && isEventCoverage(item) && isNigeriaEvent(item)))
    });
  }
  try {
    const data = await loadStateUpdates(state);
    return res.json({
      ...data,
      news: withNewsReactions(req, data.news),
      events: withNewsReactions(req, data.events)
    });
  } catch (error) {
    console.error(`Could not load ${state.name} updates:`, error.message);
    if (cached) {
      return res.json({
        ...cached.data,
        news: withNewsReactions(req, cached.data.news.filter(item => isRecentNews(item))),
        events: withNewsReactions(req, cached.data.events.filter(item => isRecentNews(item) && isEventCoverage(item) && isNigeriaEvent(item))),
        stale: true
      });
    }
    return fail(res, 502, 'STATE_UPDATES_UNAVAILABLE', 'State news and event updates are temporarily unavailable.');
  }
});

app.get('/api/news/events', async (req, res) => {
  const currentCachedItems = eventNewsCache.items.filter(item => isRecentNews(item) && isEventCoverage(item) && isNigeriaEvent(item));
  if (req.query.refresh !== 'true' && currentCachedItems.length && Date.now() - eventNewsCache.updatedAt < NEWS_CACHE_TTL_MS) {
    return res.json({ items: withNewsReactions(req, currentCachedItems), updatedAt: new Date(eventNewsCache.updatedAt).toISOString(), stale: false });
  }
  try {
    const items = await loadGoogleNews(`Nigeria (festival OR concert OR carnival OR exhibition OR fair OR summit) when:7d`, 'Google News')
      .then(results => results.filter(item => isEventCoverage(item) && isNigeriaEvent(item)));
    if (!items.length) throw new Error('Google News returned no current event coverage.');
    eventNewsCache = { updatedAt: Date.now(), items };
    return res.json({ items: withNewsReactions(req, items), updatedAt: new Date(eventNewsCache.updatedAt).toISOString(), stale: false });
  } catch (error) {
    console.error('Could not load Nigeria event coverage:', error.message);
    const freshCachedItems = eventNewsCache.items.filter(item => isRecentNews(item) && isEventCoverage(item) && isNigeriaEvent(item));
    if (freshCachedItems.length) {
      return res.json({ items: withNewsReactions(req, freshCachedItems), updatedAt: new Date(eventNewsCache.updatedAt).toISOString(), stale: true });
    }
    try {
      const national = newsCache.items.length && Date.now() - newsCache.updatedAt < NEWS_CACHE_TTL_MS
        ? { items: newsCache.items }
        : await loadNigeriaNews();
      const items = national.items.filter(item => isRecentNews(item) && isEventCoverage(item) && isNigeriaEvent(item)).slice(0, 12);
      if (items.length) {
        eventNewsCache = { updatedAt: Date.now(), items };
        return res.json({ items: withNewsReactions(req, items), updatedAt: new Date(eventNewsCache.updatedAt).toISOString(), stale: true });
      }
    } catch (fallbackError) {
      console.error('Could not load event coverage from national news:', fallbackError.message);
    }
    return fail(res, 502, 'EVENTS_UNAVAILABLE', 'Current Nigerian event coverage is temporarily unavailable.');
  }
});

app.get('/api/news/nigeria', async (req, res) => {
  if (req.query.refresh !== 'true' && newsCache.items.length && Date.now() - newsCache.updatedAt < NEWS_CACHE_TTL_MS) {
    return res.json({ items: withNewsReactions(req, newsCache.items), updatedAt: new Date(newsCache.updatedAt).toISOString(), stale: false });
  }
  try {
    const data = await loadNigeriaNews();
    return res.json({ ...data, items: withNewsReactions(req, data.items) });
  } catch (error) {
    console.error('Could not load Nigeria news:', error.message);
    if (newsCache.items.length) {
      return res.json({ items: withNewsReactions(req, newsCache.items), updatedAt: new Date(newsCache.updatedAt).toISOString(), stale: true });
    }
    return fail(res, 502, 'NEWS_UNAVAILABLE', 'Nigeria news is temporarily unavailable. Please try again shortly.');
  }
});

function emailAddress(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hashSecret(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeCompare(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => {
      if (error) return reject(error);
      resolve(`${salt.toString('hex')}:${key.toString('hex')}`);
    });
  });
}

function verifyPassword(password, stored) {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return Promise.resolve(false);
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(keyHex, 'hex');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, expected.length, (error, key) => {
      if (error) return reject(error);
      resolve(safeCompare(key, expected));
    });
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM_EMAIL;
  const appName = process.env.APP_NAME || 'NaijaVibe';
  if (!apiKey || !fromAddress) {
    const error = new Error('Email is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL to the server .env file.');
    error.code = 'EMAIL_NOT_CONFIGURED';
    throw error;
  }
  const senderMatch = fromAddress.trim().match(/^(?:[^<>]+)\s*<([^<>]+)>$/);
  const senderEmail = (senderMatch ? senderMatch[1] : fromAddress).trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(senderEmail) || /[\r\n]/.test(fromAddress)) {
    const error = new Error('RESEND_FROM_EMAIL must be a sender email address or a display name followed by an email address.');
    error.code = 'EMAIL_SENDER_INVALID';
    throw error;
  }
  const from = senderMatch ? fromAddress.trim() : `${appName} <${senderEmail}>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, text })
  });
  if (!response.ok) {
    let providerMessage = '';
    try {
      const details = await response.json();
      if (typeof details.message === 'string') providerMessage = details.message;
      else if (typeof details.error === 'string') providerMessage = details.error;
    } catch (error) {
      console.error('Could not read Resend error response:', error);
    }
    console.error('Resend email delivery failed with status:', response.status, providerMessage);
    const error = new Error('Email could not be sent. Check the Resend API key and verified sender address.');
    error.code = 'EMAIL_SEND_FAILED';
    throw error;
  }
}

function hashOtp(code) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(code).digest('hex');
}

async function sendSignupCode(email, code) {
  const appName = process.env.APP_NAME || 'NaijaVibe';
  const safeName = escapeHtml(appName);
  await sendEmail({
    to: email,
    subject: `Verify your ${appName} account`,
    text: `Your ${appName} verification code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your ${safeName} verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>`
  });
}

function publicUser(user) {
  return { id: user.id, email: user.email, username: user.username };
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS
  };
}

function issueSession(res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashSecret(token), user.id, now + SESSION_TTL_MS);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

function currentUser(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const row = db.prepare(`
    SELECT users.id, users.email, users.username
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashSecret(token), Date.now());
  return row || null;
}

function createNotification(recipientId, actorId, type, text, url) {
  if (!recipientId || recipientId === actorId) return;
  const createdAt = Date.now();
  db.prepare(`
    INSERT INTO notifications (recipient_id, actor_id, type, text, url, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(recipientId, actorId || null, type, text.slice(0, 300), url, createdAt);

  if (!webPush || !pushPublicKey || !pushPrivateKey) return;
  const profile = db.prepare('SELECT settings_json FROM profiles WHERE user_id = ?').get(recipientId);
  let settings = { notif_push: true };
  if (profile?.settings_json) {
    try { settings = Object.assign(settings, JSON.parse(profile.settings_json)); } catch (error) {
      console.error('Could not read notification settings:', error);
    }
  }
  if (!settings.notif_push) return;

  const subscriptions = db.prepare('SELECT id, subscription_json FROM push_subscriptions WHERE user_id = ?').all(recipientId);
  for (const row of subscriptions) {
    let subscription;
    try {
      subscription = JSON.parse(row.subscription_json);
    } catch (error) {
      console.error('Could not read a saved push subscription:', error);
      continue;
    }
    webPush.sendNotification(subscription, JSON.stringify({
      title: 'NaijaVibe',
      body: text.slice(0, 180),
      url
    })).catch(error => {
      if (error.statusCode === 404 || error.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(row.id);
        return;
      }
      console.error('Could not send a push notification:', error);
    });
  }
}

function withNewsReactions(req, items) {
  if (!items.length) return items;
  const ids = [...new Set(items.map(item => item.id))];
  const placeholders = ids.map(() => '?').join(', ');
  const user = currentUser(req);
  const reactions = db.prepare(`
    SELECT article_id, COUNT(*) AS likes,
      MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS liked
    FROM news_likes
    WHERE article_id IN (${placeholders})
    GROUP BY article_id
  `).all(user?.id || null, ...ids);
  const byArticle = new Map(reactions.map(row => [row.article_id, row]));
  return items.map(item => {
    const reaction = byArticle.get(item.id);
    return { ...item, likes: reaction?.likes || 0, liked: Boolean(reaction?.liked) };
  });
}

app.get('/api/news/:articleId/comments', (req, res) => {
  if (!/^[a-f0-9]{20}$/.test(req.params.articleId)) {
    return fail(res, 400, 'INVALID_ARTICLE_ID', 'The article identifier is invalid.');
  }
  const rows = db.prepare(`
    SELECT news_comments.id, news_comments.body, news_comments.created_at, users.username
    FROM news_comments
    JOIN users ON users.id = news_comments.user_id
    WHERE news_comments.article_id = ?
    ORDER BY news_comments.created_at ASC, news_comments.id ASC
    LIMIT 100
  `).all(req.params.articleId).map(row => ({
    id: row.id,
    body: row.body,
    user: row.username,
    created_at: new Date(row.created_at).toISOString()
  }));
  res.json({ comments: rows });
});

app.post('/api/news/:articleId/like', newsCommentLimiter, (req, res) => {
  if (!/^[a-f0-9]{20}$/.test(req.params.articleId)) {
    return fail(res, 400, 'INVALID_ARTICLE_ID', 'The article identifier is invalid.');
  }
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return fail(res, 403, 'INVALID_ORIGIN', 'Request origin is not allowed.');
    } catch {
      return fail(res, 403, 'INVALID_ORIGIN', 'Request origin is not allowed.');
    }
  }
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to like this story.');
  const articleId = req.params.articleId;
  const remove = db.prepare('DELETE FROM news_likes WHERE article_id = ? AND user_id = ?');
  const insert = db.prepare('INSERT OR IGNORE INTO news_likes (article_id, user_id, created_at) VALUES (?, ?, ?)');
  const changed = db.transaction(() => {
    const existing = db.prepare('SELECT 1 FROM news_likes WHERE article_id = ? AND user_id = ?').get(articleId, user.id);
    if (existing) remove.run(articleId, user.id);
    else insert.run(articleId, user.id, Date.now());
    const liked = !existing;
    const likes = db.prepare('SELECT COUNT(*) AS count FROM news_likes WHERE article_id = ?').get(articleId).count;
    return { liked, likes };
  })();
  res.json(changed);
});

app.post('/api/news/:articleId/comments', newsCommentLimiter, (req, res) => {
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) {
        return fail(res, 403, 'INVALID_ORIGIN', 'Request origin is not allowed.');
      }
    } catch {
      return fail(res, 403, 'INVALID_ORIGIN', 'Request origin is not allowed.');
    }
  }
  if (!/^[a-f0-9]{20}$/.test(req.params.articleId)) {
    return fail(res, 400, 'INVALID_ARTICLE_ID', 'The article identifier is invalid.');
  }
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to join the discussion.');
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!body || body.length > 500) {
    return fail(res, 400, 'INVALID_COMMENT', 'Comments must be between 1 and 500 characters.');
  }
  const createdAt = Date.now();
  const result = db.prepare(`
    INSERT INTO news_comments (article_id, user_id, body, created_at)
    VALUES (?, ?, ?, ?)
  `).run(req.params.articleId, user.id, body, createdAt);
  res.status(201).json({
    comment: {
      id: result.lastInsertRowid,
      body,
      user: user.username,
      created_at: new Date(createdAt).toISOString()
    }
  });
});

function publicPost(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    user: `@${row.username}`,
    avatar: 'assets/images/avatar-1.jpg',
    title: row.title,
    text: row.body,
    category: row.category,
    state: row.state,
    place: row.state || 'Nigeria',
    image: row.image_url,
    video_url: row.video_url,
    external_video_url: row.external_video_url || null,
    views: Number(row.views) || 0,
    likes: Number(row.likes_count || row.likes) || 0,
    liked: Boolean(row.liked_by_me),
    comments: [],
    created_at: new Date(row.created_at).toISOString(),
    when: new Date(row.created_at).toLocaleString()
  };
}

function safePostMediaUrl(value, video = false) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  if (/^\/media\/[a-f0-9-]{36}\.(?:jpg|png|webp|gif|mp4|webm|ogv)$/.test(value)) {
    if (!video || /\.(?:mp4|webm|ogv)$/.test(value)) return value;
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (video && !/\.(?:mp4|webm|ogg)$/i.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeExternalVideoUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function socialVideoEmbed(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'tiktok.com') {
    const match = url.pathname.match(/^\/@[^/]+\/video\/(\d+)/);
    if (match) return { platform: 'TikTok', url: `https://www.tiktok.com/player/v1/${match[1]}` };
  }
  if (host === 'instagram.com') {
    const match = url.pathname.match(/^\/(reel|p|tv)\/([A-Za-z0-9_-]+)/);
    if (match) return { platform: 'Instagram', url: `https://www.instagram.com/${match[1]}/${match[2]}/embed/` };
  }
  if (host === 'facebook.com' || host === 'fb.watch') {
    const isVideo = /\/(?:reel|videos?|watch)\//i.test(url.pathname) || host === 'fb.watch';
    if (isVideo) {
      const embedUrl = new URL('https://www.facebook.com/plugins/video.php');
      embedUrl.searchParams.set('href', url.toString());
      embedUrl.searchParams.set('show_text', 'false');
      return { platform: 'Facebook', url: embedUrl.toString() };
    }
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
    const videoId = host === 'youtu.be'
      ? url.pathname.slice(1).split('/')[0]
      : url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]+)/)?.[1] || url.searchParams.get('v');
    if (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      return { platform: 'YouTube', url: `https://www.youtube-nocookie.com/embed/${videoId}` };
    }
  }
  if (host === 'x.com' || host === 'twitter.com') {
    const match = url.pathname.match(/^\/[^/]+\/status\/(\d+)/);
    if (match) {
      const embedUrl = new URL('https://platform.twitter.com/embed/Tweet.html');
      embedUrl.searchParams.set('id', match[1]);
      return { platform: 'X', url: embedUrl.toString() };
    }
  }
  return null;
}

app.get('/api/posts', (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : '';
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 100)) : 20;
  if (category && !POST_CATEGORIES.has(category)) return fail(res, 400, 'INVALID_CATEGORY', 'Choose a valid post category.');
  const rows = category
    ? db.prepare(`SELECT posts.*, users.username, (SELECT COUNT(*) FROM post_likes WHERE post_id = posts.id) AS likes_count FROM posts JOIN users ON users.id = posts.user_id WHERE posts.category = ? ORDER BY posts.created_at DESC, posts.id DESC LIMIT ?`).all(category, limit)
    : db.prepare(`SELECT posts.*, users.username, (SELECT COUNT(*) FROM post_likes WHERE post_id = posts.id) AS likes_count FROM posts JOIN users ON users.id = posts.user_id ORDER BY posts.created_at DESC, posts.id DESC LIMIT ?`).all(limit);
  res.json({ items: rows.map(publicPost) });
});

async function getYouTubeTrending(limit = 50) {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    return {
      items: [],
      source: {
        status: 'not_configured',
        message: 'Add YOUTUBE_API_KEY to the server .env file to load YouTube trends.'
      }
    };
  }

  if (youtubeTrendingCache && Date.now() - youtubeTrendingCache.fetchedAt < YOUTUBE_TRENDING_CACHE_MS) {
    return {
      items: youtubeTrendingCache.items.slice(0, limit),
      source: { status: 'available', updatedAt: new Date(youtubeTrendingCache.fetchedAt).toISOString() }
    };
  }

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.search = new URLSearchParams({
      key: apiKey,
      chart: 'mostPopular',
      regionCode: 'NG',
      part: 'snippet,statistics',
      maxResults: '50'
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`YouTube API returned HTTP ${response.status}`);
    const result = await response.json();
    if (!Array.isArray(result.items)) throw new Error('YouTube API returned an invalid video list.');

    const items = result.items.flatMap(video => {
      const videoId = typeof video.id === 'string' ? video.id : '';
      const snippet = video.snippet || {};
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !snippet.title) return [];
      const channelId = typeof snippet.channelId === 'string' && /^UC[A-Za-z0-9_-]+$/.test(snippet.channelId)
        ? snippet.channelId
        : '';
      const thumbnails = snippet.thumbnails || {};
      const thumbnail = thumbnails.maxres || thumbnails.high || thumbnails.medium || thumbnails.default;
      const image = typeof thumbnail?.url === 'string' && /^https:\/\/i\.ytimg\.com\//i.test(thumbnail.url)
        ? thumbnail.url
        : null;
      return [{
        id: `youtube:${videoId}`,
        title: String(snippet.title).slice(0, 140),
        user: String(snippet.channelTitle || 'YouTube creator').slice(0, 100),
        state: 'Nigeria',
        image,
        video_url: null,
        external_video_url: `https://www.youtube.com/watch?v=${videoId}`,
        views: Number.parseInt(video.statistics?.viewCount, 10) || 0,
        view_label: 'YouTube views',
        source: 'youtube',
        channel_url: channelId ? `https://www.youtube.com/channel/${channelId}` : ''
      }];
    });
    youtubeTrendingCache = { items, fetchedAt: Date.now() };
    return {
      items: items.slice(0, limit),
      source: { status: 'available', updatedAt: new Date(youtubeTrendingCache.fetchedAt).toISOString() }
    };
  } catch (error) {
    console.error('Could not load Nigeria YouTube trends:', error.message);
    return {
      items: youtubeTrendingCache?.items.slice(0, limit) || [],
      source: {
        status: youtubeTrendingCache ? 'stale' : 'unavailable',
        message: youtubeTrendingCache
          ? 'YouTube could not refresh its Nigeria trends; showing the last available results.'
          : 'YouTube trends are temporarily unavailable. Check the server API key and try again.'
      }
    };
  }
}

app.get('/api/videos/trending', async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 100)) : 30;
  if (state && !states.some(item => item.name === state)) return fail(res, 400, 'INVALID_STATE', 'Choose a valid Nigerian state.');
  const youtube = state
    ? {
      items: [],
      source: { status: 'national_only', message: 'YouTube trends are Nigeria-wide; state filters show local NaijaVibe videos.' }
    }
    : await getYouTubeTrending(Math.min(50, limit));
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const viewerId = currentUser(req)?.id || '';
  const rows = state
    ? db.prepare(`
      SELECT posts.*, users.username, COUNT(video_views.post_id) AS views,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = posts.id) AS likes_count,
        EXISTS (SELECT 1 FROM post_likes WHERE post_id = posts.id AND user_id = ?) AS liked_by_me
      FROM posts
      JOIN users ON users.id = posts.user_id
      LEFT JOIN video_views ON video_views.post_id = posts.id AND video_views.viewed_at >= ?
      WHERE (posts.video_url IS NOT NULL AND posts.video_url != '' OR posts.external_video_url IS NOT NULL AND posts.external_video_url != '')
        AND posts.state = ?
      GROUP BY posts.id
      ORDER BY views DESC, posts.created_at DESC, posts.id DESC
      LIMIT ?
    `).all(viewerId, cutoff, state, limit)
    : db.prepare(`
      SELECT posts.*, users.username, COUNT(video_views.post_id) AS views,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = posts.id) AS likes_count,
        EXISTS (SELECT 1 FROM post_likes WHERE post_id = posts.id AND user_id = ?) AS liked_by_me
      FROM posts
      JOIN users ON users.id = posts.user_id
      LEFT JOIN video_views ON video_views.post_id = posts.id AND video_views.viewed_at >= ?
      WHERE posts.video_url IS NOT NULL AND posts.video_url != ''
        OR posts.external_video_url IS NOT NULL AND posts.external_video_url != ''
      GROUP BY posts.id
      ORDER BY views DESC, posts.created_at DESC, posts.id DESC
      LIMIT ?
    `).all(viewerId, cutoff, Math.max(0, limit - youtube.items.length));
  res.json({
    items: [...youtube.items, ...rows.map(publicPost)].slice(0, limit),
    sources: { youtube: youtube.source }
  });
});

app.get('/api/videos/:id', (req, res) => {
  const id = req.params.id;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return fail(res, 400, 'INVALID_VIDEO_ID', 'The video identifier is invalid.');
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const video = db.prepare(`
    SELECT posts.*, users.username, COUNT(video_views.post_id) AS views,
      (SELECT COUNT(*) FROM post_likes WHERE post_id = posts.id) AS likes_count,
      EXISTS (SELECT 1 FROM post_likes WHERE post_id = posts.id AND user_id = ?) AS liked_by_me
    FROM posts
    JOIN users ON users.id = posts.user_id
    LEFT JOIN video_views ON video_views.post_id = posts.id AND video_views.viewed_at >= ?
    WHERE posts.id = ? AND (
      posts.video_url IS NOT NULL AND posts.video_url != ''
      OR posts.external_video_url IS NOT NULL AND posts.external_video_url != ''
    )
    GROUP BY posts.id
  `).get(currentUser(req)?.id || '', cutoff, id);
  if (!video) return fail(res, 404, 'VIDEO_NOT_FOUND', 'This video could not be found.');
  res.json({ video: publicPost(video) });
});

app.post('/api/videos/:id/views', videoViewLimiter, (req, res) => {
  const id = req.params.id;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return fail(res, 400, 'INVALID_VIDEO_ID', 'The video identifier is invalid.');
  const viewerId = typeof req.body?.viewerId === 'string' ? req.body.viewerId : '';
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(viewerId)) {
    return fail(res, 400, 'INVALID_VIEWER_ID', 'The video viewer identifier is invalid.');
  }
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return fail(res, 403, 'INVALID_ORIGIN', 'Request origin is not allowed.');
    } catch {
      return fail(res, 403, 'INVALID_ORIGIN', 'Request origin is not allowed.');
    }
  }
  if (!db.prepare(`
    SELECT 1 FROM posts
    WHERE id = ? AND (
      video_url IS NOT NULL AND video_url != ''
      OR external_video_url IS NOT NULL AND external_video_url != ''
    )
  `).get(id)) {
    return fail(res, 404, 'VIDEO_NOT_FOUND', 'This video could not be found.');
  }
  const now = Date.now();
  const viewerHash = crypto.createHash('sha256').update(viewerId).digest('hex');
  const viewedOn = new Date(now).toISOString().slice(0, 10);
  const inserted = db.prepare(`
    INSERT OR IGNORE INTO video_views (post_id, viewer_hash, viewed_on, viewed_at)
    VALUES (?, ?, ?, ?)
  `).run(id, viewerHash, viewedOn, now);
  if (inserted.changes) db.prepare('DELETE FROM video_views WHERE viewed_at < ?').run(now - 30 * 24 * 60 * 60 * 1000);
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  const result = db.prepare('SELECT COUNT(*) AS views FROM video_views WHERE post_id = ? AND viewed_at >= ?').get(id, cutoff);
  res.json({ counted: inserted.changes === 1, views: result.views });
});

app.post('/api/videos/:id/like', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to like videos.');
  const id = req.params.id;
  const video = db.prepare(`
    SELECT id, user_id FROM posts
    WHERE id = ? AND (
      video_url IS NOT NULL AND video_url != ''
      OR external_video_url IS NOT NULL AND external_video_url != ''
    )
  `).get(id);
  if (!video) return fail(res, 404, 'VIDEO_NOT_FOUND', 'This video could not be found.');
  const existing = db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(id, user.id);
  if (existing) {
    db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(id, user.id);
  } else {
    db.prepare('INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)').run(id, user.id, Date.now());
    createNotification(video.user_id, user.id, 'like', `@${user.username} liked your video.`, `post.html?id=${encodeURIComponent(id)}`);
  }
  const likes = db.prepare('SELECT COUNT(*) AS count FROM post_likes WHERE post_id = ?').get(id).count;
  return res.json({ liked: !existing, likes });
});

app.post('/api/posts', postCreateLimiter, (req, res) => {
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return fail(res, 403, 'INVALID_ORIGIN', 'Request origin is not allowed.');
    } catch {
      return fail(res, 403, 'INVALID_ORIGIN', 'Request origin is not allowed.');
    }
  }
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to publish a post.');
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  const category = typeof req.body.category === 'string' ? req.body.category : '';
  const state = typeof req.body.state === 'string' ? req.body.state.trim() : '';
  if (!title || title.length > 140) return fail(res, 400, 'INVALID_TITLE', 'Post titles must be between 1 and 140 characters.');
  if (!body || body.length > 5000) return fail(res, 400, 'INVALID_POST', 'Post stories must be between 1 and 5,000 characters.');
  if (!POST_CATEGORIES.has(category)) return fail(res, 400, 'INVALID_CATEGORY', 'Choose a valid post category.');
  if (state && !states.some(item => item.name === state)) return fail(res, 400, 'INVALID_STATE', 'Choose a valid Nigerian state.');
  const imageUrl = req.body.image_url == null || req.body.image_url === '' ? null : safePostMediaUrl(req.body.image_url);
  const videoUrl = req.body.video_url == null || req.body.video_url === '' ? null : safePostMediaUrl(req.body.video_url, true);
  const externalVideoUrl = req.body.external_video_url == null || req.body.external_video_url === ''
    ? null
    : safeExternalVideoUrl(req.body.external_video_url);
  if (req.body.image_url && !imageUrl) return fail(res, 400, 'INVALID_IMAGE_URL', 'Choose a secure HTTPS image or an uploaded image.');
  if (req.body.video_url && !videoUrl) return fail(res, 400, 'INVALID_VIDEO_URL', 'Use a secure HTTPS MP4, WebM, or Ogg video.');
  if (req.body.external_video_url && !externalVideoUrl) return fail(res, 400, 'INVALID_EXTERNAL_VIDEO_URL', 'Use a public HTTPS link to a social video.');
  if (videoUrl && externalVideoUrl) return fail(res, 400, 'DUPLICATE_VIDEO_SOURCE', 'Choose either an uploaded/direct video or a social video link.');
  const createdAt = Date.now();
  const postId = crypto.randomUUID();
  const result = db.prepare(`
    INSERT INTO posts (id, user_id, title, body, category, state, image_url, video_url, external_video_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(postId, user.id, title, body, category, state, imageUrl, videoUrl, externalVideoUrl, createdAt);
  const row = db.prepare('SELECT posts.*, users.username FROM posts JOIN users ON users.id = posts.user_id WHERE posts.id = ?').get(postId);
  res.status(201).json({ post: publicPost(row) });
});

app.delete('/api/posts/:id', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to remove a post.');
  const id = req.params.id;
  if (!/^[a-f0-9-]{36}$/.test(id)) return fail(res, 400, 'INVALID_POST_ID', 'The post identifier is invalid.');
  const result = db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').run(id, user.id);
  if (!result.changes) return fail(res, 404, 'POST_NOT_FOUND', 'This post was not found or you do not have permission to remove it.');
  res.json({ removed: true });
});

app.post('/api/auth/signup', async (req, res, next) => {
  const email = emailAddress(req.body.email);
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const password = req.body.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'INVALID_EMAIL', 'Enter a valid email address.');
  if (!/^[a-z0-9_]{3,20}$/i.test(username)) return fail(res, 400, 'INVALID_USERNAME', 'Use 3–20 letters, numbers, or underscores for your username.');
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 128) {
    return fail(res, 400, 'INVALID_PASSWORD', 'Password must be at least 8 characters and no more than 128 bytes.');
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return fail(res, 409, 'ACCOUNT_EXISTS', 'An account with this email already exists. Log in instead.');
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username)) {
    return fail(res, 409, 'USERNAME_EXISTS', 'That username is already in use.');
  }
  const pending = db.prepare('SELECT 1 FROM pending_signups WHERE email = ?').get(email);
  if (pending) {
    return fail(res, 409, 'VERIFICATION_PENDING', 'A verification code was already sent. Enter it or request another code.');
  }
  if (db.prepare('SELECT 1 FROM pending_signups WHERE username = ? COLLATE NOCASE').get(username)) {
    return fail(res, 409, 'USERNAME_EXISTS', 'That username is already reserved by a pending signup.');
  }
  try {
    const passwordHash = await hashPassword(password);
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const sentAt = Date.now();
    db.prepare(`
      INSERT INTO pending_signups (email, username, password_hash, otp_hash, expires_at, attempts, sent_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).run(email, username, passwordHash, hashOtp(code), sentAt + OTP_TTL_MS, sentAt);
    try {
      await sendSignupCode(email, code);
    } catch (error) {
      db.prepare('DELETE FROM pending_signups WHERE email = ?').run(email);
      const code = ['EMAIL_NOT_CONFIGURED', 'EMAIL_SENDER_INVALID'].includes(error.code) ? error.code : 'EMAIL_SEND_FAILED';
      const message = error.code === 'EMAIL_NOT_CONFIGURED'
        ? 'Email verification is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL on the server.'
        : error.code === 'EMAIL_SENDER_INVALID'
          ? error.message
          : 'We could not send your verification email. Check the Resend API key and verified sender address.';
      return fail(res, 503, code, message);
    }
    return res.status(202).json({ verificationRequired: true, email });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
        return fail(res, 409, 'ACCOUNT_EXISTS', 'An account with this email already exists. Log in instead.');
      }
      return fail(res, 409, 'USERNAME_EXISTS', 'That username is already in use.');
    }
    next(error);
  }
});

app.post('/api/auth/verify-email', (req, res, next) => {
  const email = emailAddress(req.body.email);
  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'INVALID_EMAIL', 'Enter a valid email address.');
  if (!/^\d{6}$/.test(code)) return fail(res, 400, 'INVALID_OTP', 'Enter the six-digit verification code from your email.');
  const pending = db.prepare('SELECT * FROM pending_signups WHERE email = ?').get(email);
  if (!pending) return fail(res, 404, 'SIGNUP_NOT_FOUND', 'No pending signup was found. Start signup again.');
  if (Date.now() > pending.expires_at) {
    db.prepare('DELETE FROM pending_signups WHERE email = ?').run(email);
    return fail(res, 410, 'OTP_EXPIRED', 'That verification code has expired. Start signup again to get a new code.');
  }
  if (pending.attempts >= OTP_MAX_ATTEMPTS) {
    db.prepare('DELETE FROM pending_signups WHERE email = ?').run(email);
    return fail(res, 429, 'OTP_ATTEMPTS_EXCEEDED', 'Too many incorrect codes. Start signup again to request a new code.');
  }
  if (!safeCompare(hashOtp(code), pending.otp_hash)) {
    const attempts = pending.attempts + 1;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      db.prepare('DELETE FROM pending_signups WHERE email = ?').run(email);
      return fail(res, 429, 'OTP_ATTEMPTS_EXCEEDED', 'Too many incorrect codes. Start signup again to request a new code.');
    }
    db.prepare('UPDATE pending_signups SET attempts = ? WHERE email = ?').run(attempts, email);
    return fail(res, 400, 'INVALID_OTP', 'That code is incorrect. Check the email and try again.');
  }
  try {
    const user = db.transaction(() => {
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO users (id, email, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, pending.email, pending.username, pending.password_hash, Date.now());
      db.prepare('DELETE FROM pending_signups WHERE email = ?').run(email);
      return db.prepare('SELECT id, email, username FROM users WHERE id = ?').get(id);
    })();
    issueSession(res, user);
    return res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      db.prepare('DELETE FROM pending_signups WHERE email = ?').run(email);
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
        return fail(res, 409, 'ACCOUNT_EXISTS', 'An account with this email already exists. Log in instead.');
      }
      return fail(res, 409, 'USERNAME_EXISTS', 'That username is already in use. Start signup with a different username.');
    }
    next(error);
  }
});

app.post('/api/auth/resend-code', async (req, res) => {
  const email = emailAddress(req.body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'INVALID_EMAIL', 'Enter a valid email address.');
  const pending = db.prepare('SELECT * FROM pending_signups WHERE email = ?').get(email);
  if (!pending) return fail(res, 404, 'SIGNUP_NOT_FOUND', 'No pending signup was found. Start signup again.');
  if (Date.now() > pending.expires_at) {
    db.prepare('DELETE FROM pending_signups WHERE email = ?').run(email);
    return fail(res, 410, 'OTP_EXPIRED', 'That verification request has expired. Start signup again to get a new code.');
  }
  const retryAfterSeconds = Math.ceil((pending.sent_at + OTP_RESEND_INTERVAL_MS - Date.now()) / 1000);
  if (retryAfterSeconds > 0) {
    return fail(res, 429, 'OTP_RESEND_WAIT', `Please wait ${retryAfterSeconds} seconds before requesting another code.`, { retryAfterSeconds });
  }
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  try {
    await sendSignupCode(email, code);
  } catch (error) {
    if (error.code === 'EMAIL_NOT_CONFIGURED' || error.code === 'EMAIL_SENDER_INVALID') {
      return fail(res, 503, error.code, error.message);
    }
    return fail(res, 503, 'EMAIL_SEND_FAILED', 'We could not send your verification email. Please try again later.');
  }
  const sentAt = Date.now();
  db.prepare(`
    UPDATE pending_signups
    SET otp_hash = ?, expires_at = ?, attempts = 0, sent_at = ?
    WHERE email = ?
  `).run(hashOtp(code), sentAt + OTP_TTL_MS, sentAt, email);
  return res.json({ verificationRequired: true, email });
});

app.post('/api/auth/login', async (req, res, next) => {
  const email = emailAddress(req.body.email);
  const password = req.body.password;
  if (typeof password !== 'string') return fail(res, 400, 'INVALID_CREDENTIALS', 'Enter your email and password.');
  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !await verifyPassword(password, user.password_hash)) {
      return fail(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    issueSession(res, user);
    return res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', (req, res) => {
  const user = currentUser(req);
  res.json({ user: user ? publicUser(user) : null });
});

app.get('/api/notifications', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to view notifications.');
  const notifications = db.prepare(`
    SELECT id, type, text, url, created_at, read_at
    FROM notifications
    WHERE recipient_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 50
  `).all(user.id);
  return res.json({
    notifications: notifications.map(item => ({
      ...item,
      unread: item.read_at === null,
      when: new Date(item.created_at).toISOString()
    }))
  });
});

app.patch('/api/notifications/read', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to update notifications.');
  const now = Date.now();
  if (Number.isSafeInteger(req.body.id) && req.body.id > 0) {
    db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND recipient_id = ?')
      .run(now, req.body.id, user.id);
  } else {
    db.prepare('UPDATE notifications SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL')
      .run(now, user.id);
  }
  return res.json({ updated: true });
});

app.get('/api/push/config', (req, res) => {
  if (!currentUser(req)) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to enable notifications.');
  if (!webPush || !pushPublicKey) {
    return fail(res, 503, 'PUSH_NOT_CONFIGURED', 'Push notifications are not configured on this server yet.');
  }
  return res.json({ publicKey: pushPublicKey });
});

app.post('/api/push/subscriptions', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to enable notifications.');
  const subscription = req.body.subscription;
  if (!subscription || typeof subscription !== 'object' ||
      typeof subscription.endpoint !== 'string' ||
      !subscription.keys || typeof subscription.keys.p256dh !== 'string' ||
      typeof subscription.keys.auth !== 'string') {
    return fail(res, 400, 'INVALID_SUBSCRIPTION', 'The browser notification subscription is invalid.');
  }
  let endpoint;
  try {
    endpoint = new URL(subscription.endpoint);
    const host = endpoint.hostname.toLowerCase();
    const supportedPushHost = [
      'fcm.googleapis.com',
      'push.services.mozilla.com',
      'web.push.apple.com',
      'notify.windows.com'
    ].some(domain => host === domain || host.endsWith(`.${domain}`));
    if (endpoint.protocol !== 'https:' || !supportedPushHost ||
        (endpoint.port && endpoint.port !== '443') || endpoint.username || endpoint.password) {
      throw new Error('Unsupported push endpoint.');
    }
  } catch {
    return fail(res, 400, 'INVALID_SUBSCRIPTION', 'The browser notification service is not supported.');
  }
  if (subscription.endpoint.length > 2048 || subscription.keys.p256dh.length > 256 || subscription.keys.auth.length > 256) {
    return fail(res, 400, 'INVALID_SUBSCRIPTION', 'The browser notification subscription is too large.');
  }
  const value = JSON.stringify({
    endpoint: endpoint.href,
    keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }
  });
  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, subscription_json, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      subscription_json = excluded.subscription_json,
      created_at = excluded.created_at
  `).run(user.id, endpoint.href, value, Date.now());
  const profile = getOrCreateProfile(user.id, user.username);
  let settings = { notif_email: true, notif_push: true, private: false };
  if (profile.settings_json) {
    try { settings = Object.assign(settings, JSON.parse(profile.settings_json)); } catch (error) {
      console.error('Could not read notification settings while enabling push:', error);
    }
  }
  settings.notif_push = true;
  db.prepare('UPDATE profiles SET settings_json = ?, updated_at = ? WHERE user_id = ?')
    .run(JSON.stringify(settings), Date.now(), user.id);
  return res.json({ subscribed: true });
});

app.delete('/api/push/subscriptions', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to update notifications.');
  if (typeof req.body.endpoint !== 'string') {
    return fail(res, 400, 'INVALID_SUBSCRIPTION', 'The browser notification endpoint is invalid.');
  }
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
    .run(user.id, req.body.endpoint);
  return res.json({ unsubscribed: true });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashSecret(token));
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
  res.json({ signedOut: true });
});

app.post('/api/auth/forgot-password', async (req, res, next) => {
  const email = emailAddress(req.body.email);
  const user = db.prepare('SELECT id, email, username FROM users WHERE email = ?').get(email);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashSecret(token);
    const expiresAt = Date.now() + RESET_TTL_MS;
    const resetUrl = new URL('/reset-password.html', process.env.APP_URL || `http://localhost:${process.env.PORT || 8000}`);
    resetUrl.searchParams.set('token', token);
    db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(tokenHash, user.id, expiresAt);
    try {
      await sendEmail({
        to: user.email,
        subject: `Reset your ${process.env.APP_NAME || 'NaijaVibe'} password`,
        text: `Use this link within 30 minutes to reset your ${process.env.APP_NAME || 'NaijaVibe'} password: ${resetUrl.toString()}`,
        html: `<p>Use the link below within 30 minutes to reset your ${escapeHtml(process.env.APP_NAME || 'NaijaVibe')} password:</p><p><a href="${escapeHtml(resetUrl.toString())}">Reset password</a></p>`
      });
    } catch (error) {
      db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(tokenHash);
      return fail(res, 503, error.code || 'EMAIL_SEND_FAILED', error.message);
    }
  }
  res.json({ sent: true, message: 'If an account exists for that email, a password reset link has been sent.' });
});

app.post('/api/auth/reset-password', async (req, res, next) => {
  const token = typeof req.body.token === 'string' ? req.body.token : '';
  const password = req.body.password;
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 128) {
    return fail(res, 400, 'INVALID_PASSWORD', 'Password must be at least 8 characters and no more than 128 bytes.');
  }
  const tokenHash = hashSecret(token);
  const reset = db.prepare('SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?').get(tokenHash);
  if (!reset || reset.expires_at <= Date.now()) {
    db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(tokenHash);
    return fail(res, 400, 'RESET_EXPIRED', 'This password reset link is invalid or expired. Request another one.');
  }
  try {
    const passwordHash = await hashPassword(password);
    const update = db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, reset.user_id);
      db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(tokenHash);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(reset.user_id);
    });
    update();
    res.json({ updated: true });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 1. User Profiles & Settings API
// ==========================================
app.get('/api/users/profile', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to access your profile.');
  const profile = getOrCreateProfile(user.id, user.username);
  const postsCount = db.prepare('SELECT COUNT(*) AS count FROM posts WHERE user_id = ?').get(user.id).count;
  const followersCount = db.prepare('SELECT COUNT(*) AS count FROM user_follows WHERE following_id = ?').get(user.id).count;
  const followingCount = db.prepare('SELECT COUNT(*) AS count FROM user_follows WHERE follower_id = ?').get(user.id).count;
  let settings = { notif_email: true, notif_push: true, private: false };
  try { settings = Object.assign(settings, JSON.parse(profile.settings_json || '{}')); } catch {}
  res.json({
    user: publicUser(user),
    profile: {
      display_name: profile.display_name || user.username,
      username: user.username,
      email: user.email,
      bio: profile.bio || '',
      avatar_url: profile.avatar_url || 'assets/images/avatar-1.jpg',
      state: profile.state || '',
      phone: profile.phone || '',
      website: profile.website || '',
      stats: { posts: postsCount, followers: followersCount, following: followingCount }
    },
    settings
  });
});

app.get('/api/users/:username/profile', (req, res) => {
  const username = req.params.username.replace(/^@/, '').trim();
  const targetUser = db.prepare('SELECT id, username, email FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!targetUser) return fail(res, 404, 'USER_NOT_FOUND', 'User profile not found.');
  const profile = getOrCreateProfile(targetUser.id, targetUser.username);
  const userPosts = db.prepare('SELECT posts.*, users.username FROM posts JOIN users ON users.id = posts.user_id WHERE posts.user_id = ? ORDER BY posts.created_at DESC LIMIT 50').all(targetUser.id);
  const postsCount = db.prepare('SELECT COUNT(*) AS count FROM posts WHERE user_id = ?').get(targetUser.id).count;
  const followersCount = db.prepare('SELECT COUNT(*) AS count FROM user_follows WHERE following_id = ?').get(targetUser.id).count;
  const followingCount = db.prepare('SELECT COUNT(*) AS count FROM user_follows WHERE follower_id = ?').get(targetUser.id).count;

  const activeUser = currentUser(req);
  let isFollowing = false;
  if (activeUser && activeUser.id !== targetUser.id) {
    const followCheck = db.prepare('SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = ?').get(activeUser.id, targetUser.id);
    isFollowing = Boolean(followCheck);
  }
  res.json({
    user: { id: targetUser.id, username: targetUser.username },
    profile: {
      display_name: profile.display_name || targetUser.username,
      username: targetUser.username,
      bio: profile.bio || '',
      avatar_url: profile.avatar_url || 'assets/images/avatar-1.jpg',
      state: profile.state || '',
      website: profile.website || '',
      isFollowing,
      stats: { posts: postsCount, followers: followersCount, following: followingCount }
    },
    posts: userPosts.map(publicPost)
  });
});

app.get('/api/users/search', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to search for people.');
  const search = typeof req.query.q === 'string' ? req.query.q.trim().replace(/^@/, '') : '';
  if (search.length < 2 || search.length > 40) {
    return fail(res, 400, 'INVALID_SEARCH', 'Enter at least 2 and no more than 40 characters.');
  }
  const escaped = search.replace(/[\\%_]/g, '\\$&').toLowerCase();
  const users = db.prepare(`
    SELECT users.id, users.username, profiles.display_name, profiles.avatar_url, profiles.state,
      COALESCE(user_presence.last_seen_at, 0) AS last_seen_at
    FROM users
    LEFT JOIN profiles ON profiles.user_id = users.id
    LEFT JOIN user_presence ON user_presence.user_id = users.id
    WHERE users.id <> ? AND (
      LOWER(users.username) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(profiles.display_name, '')) LIKE ? ESCAPE '\\'
    )
    ORDER BY CASE WHEN LOWER(users.username) = ? THEN 0 ELSE 1 END, users.username COLLATE NOCASE
    LIMIT 20
  `).all(user.id, `%${escaped}%`, `%${escaped}%`, search.toLowerCase());
  const onlineAfter = Date.now() - 2 * 60 * 1000;
  return res.json({
    users: users.map(result => ({
      id: result.id,
      username: result.username,
      display_name: result.display_name || result.username,
      avatar_url: result.avatar_url || 'assets/images/avatar-1.jpg',
      state: result.state || '',
      online: result.last_seen_at >= onlineAfter
    }))
  });
});

app.post('/api/users/presence', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to update online status.');
  db.prepare(`
    INSERT INTO user_presence (user_id, last_seen_at) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `).run(user.id, Date.now());
  return res.json({ online: true });
});

app.patch('/api/users/profile', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to update your profile.');
  const profile = getOrCreateProfile(user.id, user.username);
  const displayName = typeof req.body.display_name === 'string' ? req.body.display_name.trim().slice(0, 50) : profile.display_name;
  const bio = typeof req.body.bio === 'string' ? req.body.bio.trim().slice(0, 300) : profile.bio;
  const state = typeof req.body.state === 'string' ? req.body.state.trim().slice(0, 50) : profile.state;
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim().slice(0, 30) : profile.phone;
  const website = typeof req.body.website === 'string' ? req.body.website.trim().slice(0, 100) : profile.website;
  let avatarUrl = profile.avatar_url;
  if (typeof req.body.avatar_url === 'string' && req.body.avatar_url) {
    if (req.body.avatar_url.startsWith('/media/') || req.body.avatar_url.startsWith('assets/') || req.body.avatar_url.startsWith('https://')) {
      avatarUrl = req.body.avatar_url;
    }
  }
  db.prepare(`
    UPDATE profiles
    SET display_name = ?, bio = ?, avatar_url = ?, state = ?, phone = ?, website = ?, updated_at = ?
    WHERE user_id = ?
  `).run(displayName, bio, avatarUrl, state, phone, website, Date.now(), user.id);
  const updated = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id);
  res.json({
    profile: {
      display_name: updated.display_name,
      username: user.username,
      bio: updated.bio,
      avatar_url: updated.avatar_url,
      state: updated.state,
      phone: updated.phone,
      website: updated.website
    }
  });
});

app.get('/api/users/settings', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to access your settings.');
  const profile = getOrCreateProfile(user.id, user.username);
  let settings = { notif_email: true, notif_push: true, private: false };
  try { settings = Object.assign(settings, JSON.parse(profile.settings_json || '{}')); } catch {}
  res.json({ settings });
});

app.patch('/api/users/settings', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to update your settings.');
  const profile = getOrCreateProfile(user.id, user.username);
  let currentSettings = { notif_email: true, notif_push: true, private: false };
  try { currentSettings = Object.assign(currentSettings, JSON.parse(profile.settings_json || '{}')); } catch {}
  const nextSettings = {
    notif_email: typeof req.body.notif_email === 'boolean' ? req.body.notif_email : currentSettings.notif_email,
    notif_push: typeof req.body.notif_push === 'boolean' ? req.body.notif_push : currentSettings.notif_push,
    private: typeof req.body.private === 'boolean' ? req.body.private : currentSettings.private
  };
  db.prepare('UPDATE profiles SET settings_json = ?, updated_at = ? WHERE user_id = ?')
    .run(JSON.stringify(nextSettings), Date.now(), user.id);
  res.json({ settings: nextSettings });
});

app.post('/api/users/change-password', async (req, res, next) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to change password.');
  const currentPassword = req.body.current_password;
  const newPassword = req.body.new_password;
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return fail(res, 400, 'INVALID_INPUT', 'Enter your current and new password.');
  }
  if (newPassword.length < 8 || Buffer.byteLength(newPassword, 'utf8') > 128) {
    return fail(res, 400, 'INVALID_PASSWORD', 'New password must be at least 8 characters.');
  }
  try {
    const userRow = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    if (!userRow || !await verifyPassword(currentPassword, userRow.password_hash)) {
      return fail(res, 400, 'WRONG_PASSWORD', 'Current password is incorrect.');
    }
    const newHash = await hashPassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);
    res.json({ changed: true, message: 'Password changed successfully.' });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/users/account', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to delete account.');
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
  res.json({ deleted: true });
});

app.post('/api/users/:username/follow', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to follow creators.');
  const username = req.params.username.replace(/^@/, '').trim();
  const targetUser = db.prepare('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!targetUser) return fail(res, 404, 'USER_NOT_FOUND', 'User not found.');
  if (targetUser.id === user.id) return fail(res, 400, 'CANNOT_FOLLOW_SELF', 'You cannot follow yourself.');

  const existing = db.prepare('SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = ?').get(user.id, targetUser.id);
  if (existing) {
    db.prepare('DELETE FROM user_follows WHERE follower_id = ? AND following_id = ?').run(user.id, targetUser.id);
  } else {
    db.prepare('INSERT INTO user_follows (follower_id, following_id, created_at) VALUES (?, ?, ?)').run(user.id, targetUser.id, Date.now());
    createNotification(targetUser.id, user.id, 'follow', `@${user.username} started following you.`, `profile.html?user=${encodeURIComponent(targetUser.username)}`);
  }
  const followersCount = db.prepare('SELECT COUNT(*) AS count FROM user_follows WHERE following_id = ?').get(targetUser.id).count;
  res.json({ following: !existing, followersCount });
});

app.get('/api/messages/conversations', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to view your messages.');
  const rows = db.prepare(`
    SELECT c.id, c.updated_at,
      peer.id AS peer_id, peer.username AS peer_username,
      COALESCE(profile.display_name, peer.username) AS peer_name,
      COALESCE(profile.avatar_url, 'assets/images/avatar-1.jpg') AS peer_avatar,
      COALESCE(presence.last_seen_at, 0) AS peer_last_seen_at,
      message.body AS last_message, message.created_at AS last_message_at
    FROM direct_conversations c
    JOIN users peer ON peer.id = CASE WHEN c.user_one_id = ? THEN c.user_two_id ELSE c.user_one_id END
    LEFT JOIN profiles profile ON profile.user_id = peer.id
    LEFT JOIN user_presence presence ON presence.user_id = peer.id
    LEFT JOIN direct_messages message ON message.id = (
      SELECT id FROM direct_messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1
    )
    WHERE c.user_one_id = ? OR c.user_two_id = ?
    ORDER BY COALESCE(message.created_at, c.updated_at) DESC
    LIMIT 100
  `).all(user.id, user.id, user.id);
  const onlineAfter = Date.now() - 2 * 60 * 1000;
  return res.json({
    conversations: rows.map(row => ({
      id: row.id,
      updated_at: row.updated_at,
      last_message: row.last_message || '',
      last_message_at: row.last_message_at || row.updated_at,
      peer: {
        id: row.peer_id,
        username: row.peer_username,
        display_name: row.peer_name,
        avatar_url: row.peer_avatar,
        online: row.peer_last_seen_at >= onlineAfter
      }
    }))
  });
});

app.post('/api/messages/conversations', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to start a conversation.');
  const recipientId = typeof req.body.user_id === 'string' ? req.body.user_id : '';
  if (!recipientId) return fail(res, 400, 'INVALID_RECIPIENT', 'Choose someone to message.');
  if (recipientId === user.id) return fail(res, 400, 'INVALID_RECIPIENT', 'You cannot message yourself.');
  const recipient = db.prepare(`
    SELECT users.id, users.username, profiles.display_name, profiles.avatar_url, profiles.state,
      COALESCE(user_presence.last_seen_at, 0) AS last_seen_at
    FROM users
    LEFT JOIN profiles ON profiles.user_id = users.id
    LEFT JOIN user_presence ON user_presence.user_id = users.id
    WHERE users.id = ?
  `).get(recipientId);
  if (!recipient) return fail(res, 404, 'USER_NOT_FOUND', 'That user could not be found.');
  const [userOneId, userTwoId] = [user.id, recipientId].sort();
  const createdAt = Date.now();
  db.prepare(`
    INSERT INTO direct_conversations (id, user_one_id, user_two_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_one_id, user_two_id) DO NOTHING
  `).run(crypto.randomUUID(), userOneId, userTwoId, createdAt, createdAt);
  const conversation = db.prepare(
    'SELECT id FROM direct_conversations WHERE user_one_id = ? AND user_two_id = ?'
  ).get(userOneId, userTwoId);
  return res.status(200).json({
    conversation_id: conversation.id,
    peer: {
      id: recipient.id,
      username: recipient.username,
      display_name: recipient.display_name || recipient.username,
      avatar_url: recipient.avatar_url || 'assets/images/avatar-1.jpg',
      state: recipient.state || '',
      online: recipient.last_seen_at >= Date.now() - 2 * 60 * 1000
    }
  });
});

app.get('/api/messages/conversations/:id/messages', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to view messages.');
  const conversation = db.prepare(`
    SELECT id FROM direct_conversations
    WHERE id = ? AND (user_one_id = ? OR user_two_id = ?)
  `).get(req.params.id, user.id, user.id);
  if (!conversation) return fail(res, 404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
  const rows = db.prepare(`
    SELECT direct_messages.id, direct_messages.sender_id, direct_messages.body, direct_messages.created_at,
      users.username
    FROM direct_messages JOIN users ON users.id = direct_messages.sender_id
    WHERE direct_messages.conversation_id = ? ORDER BY direct_messages.id DESC LIMIT 100
  `).all(conversation.id).reverse();
  return res.json({ messages: rows });
});

app.post('/api/messages/conversations/:id/messages', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to send messages.');
  const conversation = db.prepare(`
    SELECT id, user_one_id, user_two_id FROM direct_conversations
    WHERE id = ? AND (user_one_id = ? OR user_two_id = ?)
  `).get(req.params.id, user.id, user.id);
  if (!conversation) return fail(res, 404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!body || body.length > 2000) return fail(res, 400, 'INVALID_MESSAGE', 'Messages must be between 1 and 2,000 characters.');
  const createdAt = Date.now();
  const result = db.prepare(`
    INSERT INTO direct_messages (conversation_id, sender_id, body, created_at)
    VALUES (?, ?, ?, ?)
  `).run(conversation.id, user.id, body, createdAt);
  db.prepare('UPDATE direct_conversations SET updated_at = ? WHERE id = ?').run(createdAt, conversation.id);
  const recipientId = conversation.user_one_id === user.id ? conversation.user_two_id : conversation.user_one_id;
  createNotification(recipientId, user.id, 'message', `@${user.username} sent you a message.`, `messages.html?conversation=${encodeURIComponent(conversation.id)}`);
  return res.status(201).json({
    message: { id: Number(result.lastInsertRowid), sender_id: user.id, username: user.username, body, created_at: createdAt }
  });
});

// ==========================================
// 2. Marketplace, Products & Orders API
// ==========================================
app.get('/api/products', (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category.toLowerCase() : (typeof req.query.cat === 'string' ? req.query.cat.toLowerCase() : '');
  const state = typeof req.query.state === 'string' ? req.query.state.trim() : '';
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  const businessId = typeof req.query.business_id === 'string' ? req.query.business_id : '';

  let query = 'SELECT products.*, businesses.name AS business_name FROM products LEFT JOIN businesses ON businesses.id = products.business_id WHERE 1=1';
  const params = [];
  if (category && category !== 'all') {
    query += ' AND LOWER(products.category) = ?';
    params.push(category);
  }
  if (state && state !== 'all') {
    query += ' AND LOWER(products.state) = ?';
    params.push(state.toLowerCase());
  }
  if (businessId) {
    query += ' AND products.business_id = ?';
    params.push(businessId);
  }
  if (search) {
    query += ' AND (LOWER(products.name) LIKE ? OR LOWER(products.description) LIKE ? OR LOWER(products.seller) LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY products.created_at DESC';
  const items = db.prepare(query).all(...params);
  res.json({ items });
});

app.get('/api/products/:id', (req, res) => {
  const product = db.prepare('SELECT products.*, businesses.name AS business_name, businesses.phone AS business_phone, businesses.address AS business_address FROM products LEFT JOIN businesses ON businesses.id = products.business_id WHERE products.id = ?').get(req.params.id);
  if (!product) return fail(res, 404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  res.json({ product });
});

app.post('/api/products', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to list a product.');
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const price = Number.parseInt(req.body.price, 10);
  const category = typeof req.body.category === 'string' ? req.body.category.trim() : 'other';
  const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
  const state = typeof req.body.state === 'string' ? req.body.state.trim() : 'Lagos';
  const image = typeof req.body.image === 'string' && req.body.image ? req.body.image : 'assets/images/trend-food.jpg';
  const seller = typeof req.body.seller === 'string' && req.body.seller ? req.body.seller.trim() : user.username;
  const businessId = typeof req.body.business_id === 'string' && req.body.business_id ? req.body.business_id : null;
  const stock = Number.parseInt(req.body.stock, 10) || 20;

  if (!name || name.length < 2 || name.length > 120) {
    return fail(res, 400, 'INVALID_NAME', 'Product name must be between 2 and 120 characters.');
  }
  if (!Number.isFinite(price) || price < 100) {
    return fail(res, 400, 'INVALID_PRICE', 'Price must be at least ₦100.');
  }

  const id = `prod-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO products (id, user_id, business_id, name, price, image, seller, description, state, category, stock, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, user.id, businessId, name, price, image, seller, description, state, category, stock, Date.now());

  const created = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  res.status(201).json({ product: created });
});

app.get('/api/businesses', (req, res) => {
  const cat = typeof req.query.cat === 'string' ? req.query.cat.toLowerCase() : '';
  const state = typeof req.query.state === 'string' ? req.query.state.trim() : '';
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

  let query = "SELECT * FROM businesses WHERE status = 'approved'";
  const params = [];
  if (cat && cat !== 'all') {
    query += ' AND LOWER(cat) = ?';
    params.push(cat);
  }
  if (state && state !== 'all') {
    query += ' AND LOWER(state) = ?';
    params.push(state.toLowerCase());
  }
  if (search) {
    query += ' AND (LOWER(name) LIKE ? OR LOWER(description) LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY rating DESC, created_at DESC';
  const items = db.prepare(query).all(...params);
  res.json({ items });
});

app.get('/api/businesses/:id', (req, res) => {
  const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(req.params.id);
  if (!business) return fail(res, 404, 'BUSINESS_NOT_FOUND', 'Business not found.');
  const products = db.prepare('SELECT * FROM products WHERE business_id = ?').all(business.id);
  res.json({ business: { ...business, products } });
});

app.post('/api/businesses', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to register a business.');
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const cat = typeof req.body.cat === 'string' ? req.body.cat.trim() : 'General';
  const state = typeof req.body.state === 'string' ? req.body.state.trim() : 'Lagos';
  const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
  const address = typeof req.body.address === 'string' ? req.body.address.trim() : '';
  const image = typeof req.body.image === 'string' && req.body.image ? req.body.image : 'assets/images/trend-culture.jpg';

  if (!name || name.length < 2 || name.length > 120) {
    return fail(res, 400, 'INVALID_NAME', 'Business name must be between 2 and 120 characters.');
  }

  const id = `biz-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO businesses (id, user_id, name, cat, state, rating, image, description, phone, address, status, created_at)
    VALUES (?, ?, ?, ?, ?, 5.0, ?, ?, ?, ?, 'approved', ?)
  `).run(id, user.id, name, cat, state, image, description, phone, address, Date.now());

  const created = db.prepare('SELECT * FROM businesses WHERE id = ?').get(id);
  res.status(201).json({ business: created });
});

app.post('/api/orders', (req, res) => {
  const user = currentUser(req);
  const customerName = typeof req.body.customer_name === 'string' ? req.body.customer_name.trim() : '';
  const customerEmail = typeof req.body.customer_email === 'string' ? req.body.customer_email.trim() : '';
  const customerPhone = typeof req.body.customer_phone === 'string' ? req.body.customer_phone.trim() : '';
  const deliveryAddress = typeof req.body.delivery_address === 'string' ? req.body.delivery_address.trim() : '';
  const state = typeof req.body.state === 'string' ? req.body.state.trim() : 'Lagos';
  const paymentMethod = typeof req.body.payment_method === 'string' ? req.body.payment_method.trim() : 'Pay on Delivery';
  const items = Array.isArray(req.body.items) ? req.body.items : [];

  if (!customerName || !customerPhone || !deliveryAddress || items.length === 0) {
    return fail(res, 400, 'INVALID_ORDER', 'Please provide contact name, phone, delivery address, and at least one item.');
  }

  let totalAmount = 0;
  for (const item of items) {
    const qty = Number.parseInt(item.qty, 10) || 1;
    const price = Number.parseInt(item.price, 10) || 0;
    totalAmount += qty * price;
  }
  if (totalAmount <= 0) return fail(res, 400, 'INVALID_TOTAL', 'Order total is invalid.');

  const orderId = `ord-${crypto.randomUUID()}`;
  const orderNumber = `NV-${Date.now().toString().slice(-6)}-${crypto.randomInt(100, 999)}`;

  db.prepare(`
    INSERT INTO orders (id, user_id, order_number, customer_name, customer_email, customer_phone, delivery_address, state, items_json, total_amount, payment_method, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)
  `).run(orderId, user?.id || null, orderNumber, customerName, customerEmail, customerPhone, deliveryAddress, state, JSON.stringify(items), totalAmount, paymentMethod, Date.now());

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  res.status(201).json({
    order: {
      ...order,
      items: JSON.parse(order.items_json)
    }
  });
});

app.get('/api/orders', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.json({ orders: [] });
  const rows = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  res.json({
    orders: rows.map(r => ({ ...r, items: JSON.parse(r.items_json || '[]') }))
  });
});

// ==========================================
// 3. Live Streaming & Audio Rooms API
// ==========================================
app.get('/api/live/rooms', (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (state && !states.some(item => item.name === state)) return fail(res, 400, 'INVALID_STATE', 'Choose a valid Nigerian state.');
  const rows = state ? db.prepare(`
    SELECT live_rooms.*, users.username, profiles.display_name, profiles.avatar_url,
      (SELECT COUNT(*) FROM live_viewers WHERE live_viewers.room_id = live_rooms.id AND live_viewers.last_seen_at >= ?) AS active_viewers
    FROM live_rooms
    LEFT JOIN users ON users.id = live_rooms.owner_id
    LEFT JOIN profiles ON profiles.user_id = live_rooms.owner_id
    WHERE live_rooms.status = 'live' AND live_rooms.state = ?
    ORDER BY live_rooms.created_at DESC
  `).all(Date.now() - LIVE_VIEWER_TTL_MS, state) : db.prepare(`
    SELECT live_rooms.*, users.username, profiles.display_name, profiles.avatar_url,
      (SELECT COUNT(*) FROM live_viewers WHERE live_viewers.room_id = live_rooms.id AND live_viewers.last_seen_at >= ?) AS active_viewers
    FROM live_rooms
    LEFT JOIN users ON users.id = live_rooms.owner_id
    LEFT JOIN profiles ON profiles.user_id = live_rooms.owner_id
    WHERE live_rooms.status = 'live'
    ORDER BY live_rooms.created_at DESC
  `).all(Date.now() - LIVE_VIEWER_TTL_MS);
  res.json({
    rooms: rows.map(r => ({
      id: r.id,
      title: r.title,
      topic: r.topic,
      state: r.state,
      room_type: r.room_type || 'video',
      status: r.status,
      viewer_count: r.active_viewers || 0,
      owner_id: r.owner_id,
      host_username: r.username || 'NaijaVibe Creator',
      host_name: r.display_name || r.username || 'NaijaVibe Creator',
      host_avatar: r.avatar_url || 'assets/images/avatar-1.jpg',
      created_at: new Date(r.created_at).toISOString()
    }))
  });
});

app.get('/api/live/rooms/:id', (req, res) => {
  const r = db.prepare(`
    SELECT live_rooms.*, users.username, profiles.display_name, profiles.avatar_url,
      (SELECT COUNT(*) FROM live_viewers WHERE live_viewers.room_id = live_rooms.id AND live_viewers.last_seen_at >= ?) AS active_viewers
    FROM live_rooms
    LEFT JOIN users ON users.id = live_rooms.owner_id
    LEFT JOIN profiles ON profiles.user_id = live_rooms.owner_id
    WHERE live_rooms.id = ?
  `).get(Date.now() - LIVE_VIEWER_TTL_MS, req.params.id);
  if (!r) return fail(res, 404, 'ROOM_NOT_FOUND', 'Live stream room was not found.');
  res.json({
    room: {
      id: r.id,
      title: r.title,
      topic: r.topic,
      state: r.state,
      room_type: r.room_type || 'video',
      status: r.status,
      viewer_count: r.active_viewers || 0,
      owner_id: r.owner_id,
      host_username: r.username || 'NaijaVibe Creator',
      host_name: r.display_name || r.username || 'NaijaVibe Creator',
      host_avatar: r.avatar_url || 'assets/images/avatar-1.jpg',
      created_at: new Date(r.created_at).toISOString()
    }
  });
});

app.post('/api/live/rooms/:id/token', liveTokenLimiter, (req, res) => {
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;
  const appId = process.env.AGORA_APP_ID || (appCertificate ? '' : DEFAULT_AGORA_APP_ID);
  if (!/^[a-f0-9]{32}$/i.test(appId) ||
      (appCertificate && !/^(?:[a-f0-9]{32}|[a-f0-9]{64})$/i.test(appCertificate))) {
    return fail(res, 503, 'LIVE_NOT_CONFIGURED', 'Live streaming credentials are invalid. Please contact support.');
  }
  const room = db.prepare('SELECT id, owner_id, status FROM live_rooms WHERE id = ?').get(req.params.id);
  if (!room || room.status !== 'live') return fail(res, 404, 'ROOM_NOT_FOUND', 'This live room has ended.');
  const user = currentUser(req);
  const publisher = Boolean(user && room.owner_id === user.id);
  const role = publisher ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
  const requestedUid = req.body.uid;
  if (requestedUid !== undefined && (!Number.isSafeInteger(requestedUid) || requestedUid < 1 || requestedUid > 2_147_483_647)) {
    return fail(res, 400, 'INVALID_LIVE_UID', 'The live session identifier is invalid.');
  }
  const uid = requestedUid || crypto.randomInt(1, 2_147_483_647);
  const expiresInSeconds = 60 * 60;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  if (!appCertificate) {
    return res.json({
      appId,
      channelName: room.id,
      token: null,
      uid,
      role: publisher ? 'publisher' : 'subscriber',
      expiresInSeconds,
      tokenless: true
    });
  }
  try {
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      room.id,
      uid,
      role,
      expiresAt
    );
    return res.json({
      appId,
      channelName: room.id,
      token,
      uid,
      role: publisher ? 'publisher' : 'subscriber',
      expiresInSeconds,
      tokenless: false
    });
  } catch (error) {
    console.error('Could not generate an Agora live token:', error);
    return fail(res, 500, 'LIVE_TOKEN_FAILED', 'Could not connect to the live stream. Please try again.');
  }
});

app.post('/api/live/rooms', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to start a live broadcast.');
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const topic = typeof req.body.topic === 'string' ? req.body.topic.trim() : 'Community';
  const state = typeof req.body.state === 'string' ? req.body.state.trim() : 'Lagos';
  const roomType = req.body.room_type === 'audio' ? 'audio' : 'video';

  if (!title || title.length < 2 || title.length > 120) {
    return fail(res, 400, 'INVALID_TITLE', 'Please enter a stream title between 2 and 120 characters.');
  }

  const roomId = `live-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO live_rooms (id, owner_id, title, topic, state, room_type, status, viewer_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'live', 0, ?)
  `).run(roomId, user.id, title, topic, state, roomType, Date.now());

  const profile = getOrCreateProfile(user.id, user.username);
  res.status(201).json({
    room: {
      id: roomId,
      title,
      topic,
      state,
      room_type: roomType,
      status: 'live',
      viewer_count: 0,
      owner_id: user.id,
      host_username: user.username,
      host_name: profile.display_name || user.username,
      host_avatar: profile.avatar_url || 'assets/images/avatar-1.jpg',
      created_at: new Date().toISOString()
    }
  });
});

app.post('/api/live/rooms/:id/end', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to end your stream.');
  const room = db.prepare('SELECT * FROM live_rooms WHERE id = ?').get(req.params.id);
  if (!room) return fail(res, 404, 'ROOM_NOT_FOUND', 'Live stream was not found.');
  if (room.owner_id && room.owner_id !== user.id) {
    return fail(res, 403, 'FORBIDDEN', 'Only the stream host can end this live room.');
  }
  db.prepare("UPDATE live_rooms SET status = 'ended', ended_at = ? WHERE id = ?").run(Date.now(), room.id);
  db.prepare('DELETE FROM live_viewers WHERE room_id = ?').run(room.id);
  res.json({ ended: true });
});

app.get('/api/live/rooms/:id/messages', (req, res) => {
  const after = req.query.after;
  let rows;
  if (after === undefined || after === '') {
    rows = db.prepare(`
      SELECT live_chat_messages.*, users.username, profiles.display_name, profiles.avatar_url
      FROM live_chat_messages
      LEFT JOIN users ON users.id = live_chat_messages.user_id
      LEFT JOIN profiles ON profiles.user_id = live_chat_messages.user_id
      WHERE live_chat_messages.room_id = ?
      ORDER BY live_chat_messages.id DESC
      LIMIT 60
    `).all(req.params.id).reverse();
  } else {
    if (!/^\d{1,15}$/.test(String(after))) return fail(res, 400, 'INVALID_MESSAGE_CURSOR', 'The live chat cursor is invalid.');
    rows = db.prepare(`
      SELECT live_chat_messages.*, users.username, profiles.display_name, profiles.avatar_url
      FROM live_chat_messages
      LEFT JOIN users ON users.id = live_chat_messages.user_id
      LEFT JOIN profiles ON profiles.user_id = live_chat_messages.user_id
      WHERE live_chat_messages.room_id = ? AND live_chat_messages.id > ?
      ORDER BY live_chat_messages.id ASC
      LIMIT 100
    `).all(req.params.id, Number(after));
  }
  res.json({
    messages: rows.map(r => ({
      id: r.id,
      user_id: r.user_id,
      username: r.username || r.sender_name || 'Viewer',
      display_name: r.display_name || r.username || r.sender_name || 'Viewer',
      avatar_url: r.avatar_url || 'assets/images/avatar-1.jpg',
      body: r.body,
      created_at: new Date(r.created_at).toISOString()
    }))
  });
});

app.post('/api/live/rooms/:id/messages', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to join the live chat.');
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!body || body.length > 300) {
    return fail(res, 400, 'INVALID_MESSAGE', 'Chat messages must be between 1 and 300 characters.');
  }
  const room = db.prepare('SELECT id FROM live_rooms WHERE id = ?').get(req.params.id);
  if (!room) return fail(res, 404, 'ROOM_NOT_FOUND', 'Live room was not found.');

  const createdAt = Date.now();
  const result = db.prepare(`
    INSERT INTO live_chat_messages (room_id, user_id, sender_name, body, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(room.id, user.id, user.username, body, createdAt);

  const profile = getOrCreateProfile(user.id, user.username);
  res.status(201).json({
    message: {
      id: result.lastInsertRowid,
      user_id: user.id,
      username: user.username,
      display_name: profile.display_name || user.username,
      avatar_url: profile.avatar_url || 'assets/images/avatar-1.jpg',
      body,
      created_at: new Date(createdAt).toISOString()
    }
  });
});

app.post('/api/live/rooms/:id/viewer', (req, res) => {
  const room = db.prepare("SELECT id, owner_id FROM live_rooms WHERE id = ? AND status = 'live'").get(req.params.id);
  if (!room) return fail(res, 404, 'ROOM_NOT_FOUND', 'This live room is no longer active.');
  const viewerId = typeof req.body?.viewerId === 'string' ? req.body.viewerId : '';
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(viewerId)) {
    return fail(res, 400, 'INVALID_VIEWER_ID', 'The live viewer identifier is invalid.');
  }
  const now = Date.now();
  db.prepare('DELETE FROM live_viewers WHERE last_seen_at < ?').run(now - LIVE_VIEWER_TTL_MS);
  const user = currentUser(req);
  const viewerHash = crypto.createHash('sha256').update(viewerId).digest('hex');
  if (user?.id === room.owner_id) {
    db.prepare('DELETE FROM live_viewers WHERE room_id = ? AND viewer_hash = ?').run(room.id, viewerHash);
  } else {
    db.prepare(`
      INSERT INTO live_viewers (room_id, viewer_hash, last_seen_at) VALUES (?, ?, ?)
      ON CONFLICT(room_id, viewer_hash) DO UPDATE SET last_seen_at = excluded.last_seen_at
    `).run(room.id, viewerHash, now);
  }
  const viewerCount = db.prepare('SELECT COUNT(*) AS count FROM live_viewers WHERE room_id = ? AND last_seen_at >= ?')
    .get(room.id, now - LIVE_VIEWER_TTL_MS).count;
  res.json({ viewer_count: viewerCount });
});

app.delete('/api/live/rooms/:id/viewer', (req, res) => {
  const viewerId = typeof req.body?.viewerId === 'string' ? req.body.viewerId : '';
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(viewerId)) {
    return fail(res, 400, 'INVALID_VIEWER_ID', 'The live viewer identifier is invalid.');
  }
  const viewerHash = crypto.createHash('sha256').update(viewerId).digest('hex');
  db.prepare('DELETE FROM live_viewers WHERE room_id = ? AND viewer_hash = ?').run(req.params.id, viewerHash);
  const viewerCount = db.prepare('SELECT COUNT(*) AS count FROM live_viewers WHERE room_id = ? AND last_seen_at >= ?')
    .get(req.params.id, Date.now() - LIVE_VIEWER_TTL_MS).count;
  res.json({ viewer_count: viewerCount });
});

app.post('/api/live/rooms/:id/react', (req, res) => {
  const reaction = typeof req.body.reaction === 'string' ? req.body.reaction.trim() : '❤️';
  const allowed = ['❤️', '🔥', '🎉', '🇳🇬', '👏'];
  const safeReaction = allowed.includes(reaction) ? reaction : '❤️';
  db.prepare('INSERT INTO live_reactions (room_id, reaction, created_at) VALUES (?, ?, ?)')
    .run(req.params.id, safeReaction, Date.now());
  res.status(201).json({ reaction: safeReaction });
});

app.get('/api/live/rooms/:id/reactions', (req, res) => {
  const recent = Date.now() - 15000;
  const rows = db.prepare('SELECT id, reaction, created_at FROM live_reactions WHERE room_id = ? AND created_at > ? ORDER BY id DESC LIMIT 25')
    .all(req.params.id, recent);
  res.json({ reactions: rows });
});

app.use(express.static(ROOT, { dotfiles: 'ignore', index: 'index.html' }));

app.use((error, _req, res, _next) => {
  console.error('Request failed:', error);
  if (res.headersSent) return;
  if (error.type === 'entity.too.large') {
    return fail(res, 413, 'UPLOAD_TOO_LARGE', 'This file is larger than the allowed upload size.');
  }
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'The server could not complete that request. Please try again.' } });
});

if (require.main === module) {
  if (!process.env.SESSION_SECRET) {
    console.error('Missing server configuration: SESSION_SECRET. Copy .env.example to .env and set a long random value.');
    process.exitCode = 1;
  } else if (process.env.SESSION_SECRET.length < 32) {
    console.error('SESSION_SECRET must be at least 32 characters. Generate a random value and set it in .env.');
    process.exitCode = 1;
  } else {
    const port = Number(process.env.PORT || 8000);
    app.listen(port, () => console.log(`NaijaVibe running at http://localhost:${port}`));
  }
}

module.exports = { app, db, hashPassword, parseNewsFeed, parseArticleMedia, socialVideoEmbed, isRecentNews, isEventCoverage, isNigeriaEvent, publicUser };
