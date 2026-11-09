const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'naijavibe-auth-test-'));
process.env.AUTH_DB_PATH = path.join(dataDir, 'auth.sqlite');
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-only-session-secret';
process.env.RESEND_API_KEY = 're_test_only';
process.env.RESEND_FROM_EMAIL = 'NaijaVibe <verify@example.com>';
process.env.APP_NAME = 'NaijaVibe';
process.env.APP_URL = 'http://localhost';

const { app, db, parseNewsFeed, parseArticleMedia, socialVideoEmbed, isRecentNews, isEventCoverage, isNigeriaEvent } = require('../server');
const originalFetch = global.fetch;
let server;
let baseUrl;
let resetUrl;
let emailCount = 0;
let resendFailure = null;
const signupCodes = new Map();
const deliveredEmails = [];
let blockGoogleNews = false;
let rssFixture = '';
let youtubeFixture = null;
let youtubeRequestUrl = null;
let youtubeRequestCount = 0;

global.fetch = async (url, options) => {
  const parsedUrl = new URL(url);
  if (parsedUrl.hostname === 'www.googleapis.com' && parsedUrl.pathname === '/youtube/v3/videos') {
    youtubeRequestUrl = parsedUrl;
    youtubeRequestCount += 1;
    return youtubeFixture
      ? new Response(JSON.stringify(youtubeFixture), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Response('Unavailable', { status: 503 });
  }
  if (parsedUrl.host === 'news.google.com' && blockGoogleNews) {
    throw new Error('Google News unavailable in fixture');
  }
  if (rssFixture && parsedUrl.host === 'www.channelstv.com') {
    return new Response(rssFixture, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
  }
  if (rssFixture && ['rss.punchng.com', 'www.premiumtimesng.com'].includes(parsedUrl.host)) {
    return new Response('Unavailable', { status: 503 });
  }
  if (parsedUrl.host === 'api.resend.com') {
    const email = JSON.parse(options.body);
    emailCount += 1;
    deliveredEmails.push(email);
    const code = email.text.match(/verification code is (\d{6})/i)?.[1];
    if (code) signupCodes.set(email.to[0], code);
    const link = email.text.match(/http:\/\/localhost\/reset-password\.html\?token=[^\s]+/);
    if (link) resetUrl = link[0];
    if (resendFailure) {
      return new Response(JSON.stringify({ message: resendFailure.message }), { status: resendFailure.status });
    }
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

async function post(route, body, cookie) {
  const response = await originalFetch(`${baseUrl}/api/auth/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body)
  });
  return { response, body: await response.json() };
}

async function signupVerified(email, username, password = 'safe-password-123') {
  const signup = await post('signup', { email, username, password });
  assert.equal(signup.response.status, 202);
  const code = signupCodes.get(email);
  assert.match(code, /^\d{6}$/);
  return post('verify-email', { email, code });
}

test('signup requires a branded email OTP before creating an account; sessions, login and password reset work', async () => {
  const initialEmailCount = emailCount;
  let result = await post('signup', {
    email: 'moyo@example.com',
    username: 'moyo_test',
    password: 'safe-password-123'
  });
  assert.equal(result.response.status, 202);
  assert.equal(result.body.verificationRequired, true);
  assert.equal(result.response.headers.get('set-cookie'), null);
  assert.equal(emailCount, initialEmailCount + 1);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE email = ?').get('moyo@example.com'), undefined);
  assert.equal(deliveredEmails.at(-1).from, 'NaijaVibe <verify@example.com>');
  assert.match(deliveredEmails.at(-1).subject, /NaijaVibe/);
  assert.match(deliveredEmails.at(-1).text, /NaijaVibe verification code is \d{6}/);
  const code = signupCodes.get('moyo@example.com');
  result = await post('resend-code', { email: 'moyo@example.com' });
  assert.equal(result.response.status, 429);
  assert.equal(result.body.error.code, 'OTP_RESEND_WAIT');
  const incorrectCode = code === '999999' ? '000000' : '999999';
  result = await post('verify-email', { email: 'moyo@example.com', code: incorrectCode });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error.code, 'INVALID_OTP');
  result = await post('login', { email: 'moyo@example.com', password: 'safe-password-123' });
  assert.equal(result.response.status, 401);

  result = await post('verify-email', { email: 'moyo@example.com', code });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.user.username, 'moyo_test');
  const sessionCookie = result.response.headers.get('set-cookie').split(';')[0];
  const articleId = '0123456789abcdefabcd';
  let likeResponse = await originalFetch(`${baseUrl}/api/news/${articleId}/like`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  assert.equal(likeResponse.status, 401);
  likeResponse = await originalFetch(`${baseUrl}/api/news/${articleId}/like`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, Origin: baseUrl },
    body: '{}'
  });
  assert.deepEqual(await likeResponse.json(), { liked: true, likes: 1 });
  likeResponse = await originalFetch(`${baseUrl}/api/news/${articleId}/like`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, Origin: baseUrl },
    body: '{}'
  });
  assert.deepEqual(await likeResponse.json(), { liked: false, likes: 0 });

  result = await originalFetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: sessionCookie } }).then(async response => ({
    response,
    body: await response.json()
  }));
  assert.equal(result.response.status, 200);
  assert.equal(result.body.user.email, 'moyo@example.com');

  result = await post('logout', {}, sessionCookie);
  assert.equal(result.response.status, 200);
  result = await originalFetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: sessionCookie } });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).user, null);

  result = await post('login', { email: 'moyo@example.com', password: 'safe-password-123' });
  assert.equal(result.response.status, 200);
  result = await post('forgot-password', { email: 'moyo@example.com' });
  assert.equal(result.response.status, 200);
  assert.match(resetUrl, /token=/);

  const token = new URL(resetUrl).searchParams.get('token');
  result = await post('reset-password', { token, password: 'new-safe-password-456' });
  assert.equal(result.response.status, 200);
  result = await post('login', { email: 'moyo@example.com', password: 'safe-password-123' });
  assert.equal(result.response.status, 401);
  result = await post('login', { email: 'moyo@example.com', password: 'new-safe-password-456' });
  assert.equal(result.response.status, 200);
});

test('signup rejects invalid input and prevents duplicate accounts', async () => {
  const invalid = await post('signup', { email: 'not-an-email', username: 'x', password: 'short' });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, 'INVALID_EMAIL');

  let result = await signupVerified('duplicate@example.com', 'duplicate_user');
  assert.equal(result.response.status, 201);
  result = await post('signup', {
    email: 'duplicate@example.com',
    username: 'another_user',
    password: 'safe-password-123'
  });

  assert.equal(result.response.status, 409);
  assert.equal(result.body.error.code, 'ACCOUNT_EXISTS');
});

test('signup reports invalid Resend sender configuration without storing an unusable OTP', async () => {
  const originalSender = process.env.RESEND_FROM_EMAIL;
  process.env.RESEND_FROM_EMAIL = 'not-a-valid-sender';
  try {
    const result = await post('signup', {
      email: 'bad-sender@example.com',
      username: 'bad_sender',
      password: 'safe-password-123'
    });
    assert.equal(result.response.status, 503);
    assert.equal(result.body.error.code, 'EMAIL_SENDER_INVALID');
    assert.equal(db.prepare('SELECT 1 FROM pending_signups WHERE email = ?').get('bad-sender@example.com'), undefined);
  } finally {
    process.env.RESEND_FROM_EMAIL = originalSender;
  }
});

test('signup explains when Resend rejects an unverified sender domain', async () => {
  resendFailure = {
    status: 403,
    message: 'The naijavibe.com domain is not verified. Please add and verify your domain.'
  };
  try {
    const result = await post('signup', {
      email: 'unverified-domain@example.com',
      username: 'unverified_domain',
      password: 'safe-password-123'
    });
    assert.equal(result.response.status, 503);
    assert.equal(result.body.error.code, 'EMAIL_DOMAIN_NOT_VERIFIED');
    assert.match(result.body.error.message, /Verify the domain used by RESEND_FROM_EMAIL/);
    assert.equal(db.prepare('SELECT 1 FROM pending_signups WHERE email = ?').get('unverified-domain@example.com'), undefined);
  } finally {
    resendFailure = null;
  }
});

test('authentication endpoints accept requests forwarded by Railway', async () => {
  const response = await originalFetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '198.51.100.23'
    },
    body: JSON.stringify({ email: 'unknown@example.com', password: 'some-password' })
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'INVALID_CREDENTIALS');
});

test('malformed JSON receives a client error without logging the submitted body', async () => {
  const response = await originalFetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{email:invalid}'
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_JSON');
});

test('headline discussions are public to read and require a signed-in account to post', async () => {
  const articleId = '0123456789abcdefabcd';
  let response = await originalFetch(`${baseUrl}/api/news/${articleId}/comments`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).comments, []);

  response = await originalFetch(`${baseUrl}/api/news/${articleId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'A local comment' })
  });
  assert.equal(response.status, 401);

  const result = await signupVerified('news-comment@example.com', 'news_comment');
  assert.equal(result.response.status, 201);
  const sessionCookie = result.response.headers.get('set-cookie').split(';')[0];

  response = await originalFetch(`${baseUrl}/api/news/${articleId}/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
      Origin: baseUrl
    },
    body: JSON.stringify({ body: 'A shared headline comment' })
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).comment.user, 'news_comment');

  response = await originalFetch(`${baseUrl}/api/news/${articleId}/comments`);
  assert.equal((await response.json()).comments.length, 1);
});

test('community posts and uploaded media persist on the server and are shared publicly', async () => {
  let response = await originalFetch(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Guest post', body: 'Not signed in', category: 'culture' })
  });

  assert.equal(response.status, 401);

  const signup = await signupVerified('shared-post@example.com', 'shared_poster');
  const sessionCookie = signup.response.headers.get('set-cookie').split(';')[0];
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  response = await originalFetch(`${baseUrl}/api/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', Cookie: sessionCookie, Origin: baseUrl },
    body: png
  });
  assert.equal(response.status, 201);
  const imageUrl = (await response.json()).url;
  assert.match(imageUrl, /^\/media\/[a-f0-9-]{36}\.png$/);
  const mediaResponse = await originalFetch(`${baseUrl}${imageUrl}`);
  assert.equal(mediaResponse.status, 200);
  assert.deepEqual(Buffer.from(await mediaResponse.arrayBuffer()), png);

  const mp4 = Buffer.from('0000ftypisom');
  response = await originalFetch(`${baseUrl}/api/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'video/mp4', Cookie: sessionCookie, Origin: baseUrl },
    body: mp4
  });
  assert.equal(response.status, 201);
  const videoUrl = (await response.json()).url;
  assert.match(videoUrl, /^\/media\/[a-f0-9-]{36}\.mp4$/);

  response = await originalFetch(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, Origin: baseUrl },
    body: JSON.stringify({
      title: 'Shared community post',
      body: 'This should remain after refresh and be visible to other users.',
      category: 'culture',
      state: 'Lagos',
      image_url: imageUrl,
      video_url: videoUrl
    })
  });
  assert.equal(response.status, 201);
  const postBody = (await response.json()).post;
  assert.equal(postBody.user, '@shared_poster');
  assert.equal(postBody.image, imageUrl);
  assert.equal(postBody.video_url, videoUrl);

  response = await originalFetch(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, Origin: baseUrl },
    body: JSON.stringify({
      title: 'Oyo community video',
      body: 'A second clip to test Nigerian state filtering and video ranking.',
      category: 'culture',
      state: 'Oyo',
      external_video_url: 'https://www.tiktok.com/@naijavibe/video/1234567890123456789'
    })
  });
  assert.equal(response.status, 201);
  const secondVideo = (await response.json()).post;
  assert.equal(secondVideo.video_url, null);
  assert.equal(secondVideo.external_video_url, 'https://www.tiktok.com/@naijavibe/video/1234567890123456789');

  response = await originalFetch(`${baseUrl}/api/videos/trending`);
  assert.equal(response.status, 200);
  let trendingVideos = (await response.json()).items;
  assert.equal(trendingVideos.length, 2);
  assert.equal(trendingVideos[0].views, 0);

  response = await originalFetch(`${baseUrl}/api/videos/trending?state=Oyo`);
  assert.deepEqual((await response.json()).items.map(video => video.id), [secondVideo.id]);
  response = await originalFetch(`${baseUrl}/api/videos/trending?state=Invalid`);
  assert.equal(response.status, 400);

  const viewerId = '00000000-0000-4000-8000-000000000001';
  response = await originalFetch(`${baseUrl}/api/videos/${postBody.id}/views`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ viewerId })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { counted: true, views: 1 });
  response = await originalFetch(`${baseUrl}/api/videos/${postBody.id}/views`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ viewerId })
  });
  assert.deepEqual(await response.json(), { counted: false, views: 1 });
  response = await originalFetch(`${baseUrl}/api/videos/${postBody.id}/views`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ viewerId: '00000000-0000-4000-8000-000000000002' })
  });
  assert.deepEqual(await response.json(), { counted: true, views: 2 });
  response = await originalFetch(`${baseUrl}/api/videos/${secondVideo.id}/views`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ viewerId })
  });
  assert.deepEqual(await response.json(), { counted: true, views: 1 });
  response = await originalFetch(`${baseUrl}/api/videos/${postBody.id}/views`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ viewerId: 'not-a-uuid' })
  });
  assert.equal(response.status, 400);
  response = await originalFetch(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, Origin: baseUrl },
    body: JSON.stringify({
      title: 'Unsafe social video',
      body: 'The application must reject non-HTTPS external video links.',
      category: 'culture',
      external_video_url: 'javascript:alert(1)'
    })
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_EXTERNAL_VIDEO_URL');
  response = await originalFetch(`${baseUrl}/api/videos/${postBody.id}`);
  assert.equal((await response.json()).video.views, 2);
  response = await originalFetch(`${baseUrl}/api/videos/trending`);
  trendingVideos = (await response.json()).items;
  assert.deepEqual(trendingVideos.map(video => [video.id, video.views]), [
    [postBody.id, 2],
    [secondVideo.id, 1]
  ]);

  response = await originalFetch(`${baseUrl}/api/posts`);
  assert.equal(response.status, 200);
  const sharedPosts = (await response.json()).items;
  assert.equal(sharedPosts.length, 2);
  const sharedPost = sharedPosts.find(item => item.id === postBody.id);
  assert.equal(sharedPost.text, 'This should remain after refresh and be visible to other users.');

  response = await originalFetch(`${baseUrl}/api/posts/${postBody.id}`, {
    method: 'DELETE',
    headers: { Cookie: sessionCookie, Origin: baseUrl }
  });
  assert.equal(response.status, 200);
  response = await originalFetch(`${baseUrl}/api/posts/${secondVideo.id}`, {
    method: 'DELETE',
    headers: { Cookie: sessionCookie, Origin: baseUrl }
  });
  assert.equal(response.status, 200);
  response = await originalFetch(`${baseUrl}/api/posts`);
  assert.deepEqual((await response.json()).items, []);
});

test('state news falls back to current local reporting and event feeds exclude unrelated stories', async () => {
  blockGoogleNews = true;
  rssFixture = `<rss><channel><item>
    <title>Lagos cultural festival opens in Ikeja</title>
    <link>https://www.channelstv.com/lagos-festival</link>
    <pubDate>${new Date().toUTCString()}</pubDate>
    <description><![CDATA[A current Lagos cultural festival.]]></description>
    <media:content url="https://cdn.channelstv.com/lagos-festival.jpg" medium="image" type="image/jpeg" />
  </item><item>
    <title>Putin wants Trump, Xi in Ukraine summit without Zelensky</title>
    <link>https://www.channelstv.com/ukraine-summit</link>
    <pubDate>${new Date().toUTCString()}</pubDate>
    <description><![CDATA[A summit in Kyiv.]]></description>
  </item></channel></rss>`;
  try {
    let response = await originalFetch(`${baseUrl}/api/states/lagos/updates?refresh=true`);
    assert.equal(response.status, 200);
    let result = await response.json();
    assert.equal(result.news[0].title, 'Lagos cultural festival opens in Ikeja');
    assert.equal(result.news[0].imageUrl, 'https://cdn.channelstv.com/lagos-festival.jpg');
    assert.equal(result.events[0].title, result.news[0].title);

    response = await originalFetch(`${baseUrl}/api/news/events?refresh=true`);
    assert.equal(response.status, 200);
    result = await response.json();
    assert.equal(result.items.length, 1);
    assert.equal(isEventCoverage(result.items[0]), true);
    assert.equal(isRecentNews(result.items[0]), true);
    assert.equal(isNigeriaEvent(result.items[0]), true);
  } finally {
    blockGoogleNews = false;
    rssFixture = '';
  }
});

test('publisher media parsing only accepts secure images and playable video URLs', () => {
  const media = parseArticleMedia(
    '<meta property="og:image" content="/images/story.jpg"><meta property="og:video" content="https://video.example/embed/123"><meta property="og:video:type" content="text/html">',
    'https://www.channelstv.com/story'
  );
  assert.equal(media.imageUrl, 'https://www.channelstv.com/images/story.jpg');
  assert.equal(media.videoUrl, null);
  assert.equal(isRecentNews({ publishedAt: new Date(Date.now() - 8 * 86400000).toISOString() }), false);
  assert.equal(isRecentNews({ publishedAt: new Date(Date.now() - 31 * 86400000).toISOString() }), false);
  assert.equal(isEventCoverage({
    title: 'I Stand By My Claims On NLNG Dividends, Makinde Insists',
    summary: 'A budget stakeholder meeting was held at the International Conference Centre.'
  }), false);
  assert.equal(isNigeriaEvent({
    title: 'Putin wants Trump, Xi in Ukraine summit without Zelensky',
    summary: 'A summit in Kyiv.'
  }), false);
});

test('social video links map to official, allowlisted embed players', () => {
  assert.equal(socialVideoEmbed('https://www.tiktok.com/@naija/video/1234567890123456789').url, 'https://www.tiktok.com/player/v1/1234567890123456789');
  assert.equal(socialVideoEmbed('https://www.instagram.com/reel/ABC123/').url, 'https://www.instagram.com/reel/ABC123/embed/');
  assert.equal(socialVideoEmbed('https://www.facebook.com/reel/12345').platform, 'Facebook');
  assert.equal(socialVideoEmbed('https://www.youtube.com/shorts/abcdefghijk').url, 'https://www.youtube-nocookie.com/embed/abcdefghijk');
  assert.equal(socialVideoEmbed('https://x.com/naija/status/12345').platform, 'X');
  assert.equal(socialVideoEmbed('https://example.com/video/123'), null);
  assert.equal(socialVideoEmbed('javascript:alert(1)'), null);
});

test('RSS headlines receive stable discussion IDs and preserve safe publisher media', async () => {
  const xml = `<rss><channel><item>
    <title>Community update - Example News</title>
    <link>https://news.example.com/story?id=123</link>
    <source url="https://news.example.com">Example News</source>
    <description><![CDATA[<p>Update</p><img src="https://cdn.example.com/story.jpg"></description>
    <enclosure url="https://cdn.example.com/story.mp4" type="video/mp4" />
  </item><item>
    <title>Unsafe media is ignored</title>
    <link>https://news.example.com/unsafe</link>
    <description>&lt;a href=&quot;https://news.example.com/source&quot;&gt;Read original story&lt;/a&gt;&amp;nbsp;- Example News</description>
    <media:content url="http://cdn.example.com/unsafe.jpg" medium="image" />
  </item><item>
    <title>Branding is not a story photo</title>
    <link>https://news.example.com/branding</link>
    <enclosure url="https://cdn.example.com/publisher-logo.png" type="image/png" />
  </item><item>
    <title>Putin wants Trump, Xi in Ukraine summit without Zelensky - Daily Post Nigeria</title>
    <link>https://news.example.com/ukraine-summit</link>
    <source url="https://dailypost.ng">Daily Post Nigeria</source>
    <description><![CDATA[Putin wants Trump, Xi in Ukraine summit without Zelensky - Daily Post Nigeria]]></description>
  </item></channel></rss>`;
  const first = parseNewsFeed(xml, 'Example News');
  const second = parseNewsFeed(xml, 'Example News');
  assert.equal(first.length, 4);
  assert.equal(first[0].title, 'Community update');
  assert.equal(first[0].publisher, 'Example News');
  assert.match(first[0].id, /^[a-f0-9]{20}$/);
  assert.equal(first[0].id, second[0].id);
  assert.equal(first[0].imageUrl, 'https://cdn.example.com/story.jpg');
  assert.equal(first[0].videoUrl, 'https://cdn.example.com/story.mp4');
  assert.equal(first[1].imageUrl, null);
  assert.equal(first[1].summary, 'Read original story - Example News');
  assert.equal(first[2].imageUrl, null);
  assert.equal(first[3].title, 'Putin wants Trump, Xi in Ukraine summit without Zelensky');
  assert.equal(first[3].summary, 'Putin wants Trump, Xi in Ukraine summit without Zelensky');
  assert.equal(isNigeriaEvent(first[3]), false);

  const response = await originalFetch(`${baseUrl}/api/news/${first[0].id}/comments`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).comments, []);
});

test('Nigeria trending video endpoint loads and caches YouTube most-popular videos without exposing its API key', async () => {
  const previousKey = process.env.YOUTUBE_API_KEY;
  const previousFixture = youtubeFixture;
  try {
    delete process.env.YOUTUBE_API_KEY;
    let response = await originalFetch(`${baseUrl}/api/videos/trending?limit=10`);
    let result = await response.json();
    assert.equal(result.sources.youtube.status, 'not_configured');

    process.env.YOUTUBE_API_KEY = 'test-youtube-secret';
    youtubeFixture = {
      items: [{
        id: 'abcdefghijk',
        snippet: {
          title: 'Trending from Nigeria',
          channelId: 'UC0123456789abcdefghijk',
          channelTitle: 'Naija channel',
          thumbnails: { high: { url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' } }
        },
        statistics: { viewCount: '12345' }
      }]
    };
    const priorRequestCount = youtubeRequestCount;
    response = await originalFetch(`${baseUrl}/api/videos/trending?limit=10`);
    result = await response.json();
    const video = result.items.find(item => item.source === 'youtube');
    assert.equal(result.sources.youtube.status, 'available');
    assert.equal(video.title, 'Trending from Nigeria');
    assert.equal(video.state, 'Nigeria');
    assert.equal(video.views, 12345);
    assert.equal(video.view_label, 'YouTube views');
    assert.equal(video.external_video_url, 'https://www.youtube.com/watch?v=abcdefghijk');
    assert.equal(video.channel_url, 'https://www.youtube.com/channel/UC0123456789abcdefghijk');
    assert.equal(youtubeRequestUrl.searchParams.get('chart'), 'mostPopular');
    assert.equal(youtubeRequestUrl.searchParams.get('regionCode'), 'NG');
    assert.equal(youtubeRequestUrl.searchParams.get('maxResults'), '50');
    assert.equal(youtubeRequestUrl.searchParams.get('key'), 'test-youtube-secret');
    assert.equal(JSON.stringify(result).includes('test-youtube-secret'), false);

    youtubeFixture.items[0].snippet.title = 'Changed after cache';
    response = await originalFetch(`${baseUrl}/api/videos/trending?limit=10`);
    result = await response.json();
    assert.equal(result.items.find(item => item.source === 'youtube').title, 'Trending from Nigeria');
    assert.equal(youtubeRequestCount, priorRequestCount + 1);

    response = await originalFetch(`${baseUrl}/api/videos/trending?state=Oyo&limit=10`);
    result = await response.json();
    assert.equal(result.sources.youtube.status, 'national_only');
    assert.equal(result.items.some(item => item.source === 'youtube'), false);
  } finally {
    youtubeFixture = previousFixture;
    if (previousKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = previousKey;
  }
});
