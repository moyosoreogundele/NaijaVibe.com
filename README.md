# NaijaVibe

Multi-page NaijaVibe site built with HTML, CSS, vanilla JavaScript, and a small Node.js authentication server. Supabase is no longer used by the app.

## Run it locally
1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Set `SESSION_SECRET` to a long random value, and set `RESEND_API_KEY` plus `RESEND_FROM_EMAIL` to a Resend API key and sender address on a verified domain. Keep `.env` private; it is ignored by Git.
4. Install dependencies with `npm install`, then start the app with `npm start`.
5. Open http://localhost:8000.

The Node server serves both the site and its same-origin auth API. Do not use a static-only server such as `python -m http.server` for account registration or login. The SQLite auth database is created in `.private/auth.sqlite` and should be kept on persistent private storage when deployed. Set `APP_URL` to the public HTTPS site URL in production.

### Deploy to GitHub and Railway
1. Keep `.env`, `.private/`, SQLite files, and uploaded media out of Git. `.env.example` is a template only; set secrets in the hosting provider's private variables.
2. Push this project to GitHub and create a Railway project from that repository. The included `railway.json` builds with `npm ci`, starts with `npm start`, and checks `/api/health`.
3. In Railway, attach a persistent volume at `/data`, then set `AUTH_DB_PATH=/data/auth.sqlite`. The database and uploaded media are stored beside this file, under `/data`; without a persistent volume, accounts and uploads can be lost when the service is redeployed.
4. Configure `NODE_ENV=production`, `SESSION_SECRET` (at least 32 random characters), `APP_URL` (the Railway HTTPS URL or your custom HTTPS domain), `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `YOUTUBE_API_KEY` in Railway's private service variables. Keep provider certificates and API keys out of Git and browser code.
5. Connect the GitHub repository to Railway's deploy trigger for the production branch. Each push will automatically build and deploy the latest website. For account recovery emails, verify the Resend sender domain and use the exact public `APP_URL`.

The site is installable on supported phones over HTTPS using its web app manifest and service worker. On Android/Chrome, use the browser's **Install app** or **Add to Home screen** action. On iPhone/iPad, open the site in Safari and select **Share → Add to Home Screen**. Connected installs check for updates periodically and refresh when a new service-worker version activates; offline use falls back to cached pages and assets.

### Authentication and email
Signup uses a six-digit email verification code delivered by Resend. Codes expire after 10 minutes, allow up to five incorrect attempts, and can be resent once per minute. New accounts are created and signed in only after the code is verified. Login uses the verified email and password. Resend credentials stay on the server and must never be added to browser code. Sessions use an HTTP-only cookie.

The auth API limits repeated requests, hashes passwords with Node's `scrypt`, stores only hashed session tokens, and persists accounts and sessions in SQLite. Password reset emails use Resend when configured. Use HTTPS in production so session cookies are secure.

## Data and features
In local-auth mode, community posts, headline discussions, accounts, user profiles, creator follows, marketplace products, business listings, checkout orders, and uploaded media all persist in the server's SQLite database and media storage.

- **User Profiles, Settings & Creator Follows**: Complete user profile management with avatars, bios, Nigerian state tagging, preference toggles, authenticated password updates, and creator follow counts.
- **Marketplace & Business Directory**: SQLite-backed product listings with Nigerian Naira (₦) pricing, state & category filtering, product creation modal, business registrations, and an end-to-end checkout flow supporting Pay on Delivery, Bank Transfer, and Card payments with instant order confirmation receipts.
- **Live Video Broadcasts & Audio Rooms**: Real-time broadcast rooms supporting camera and microphone streaming, talkshow audio rooms with dynamic waveform equalizers and speaker pulsing animations, live viewer heartbeats, live chat messaging, and floating emoji reactions (❤️, 🔥, 🎉, 🇳🇬, 👏).

The homepage loads current headlines from `/api/news/nigeria`, which aggregates public RSS feeds from Nigerian newsrooms. National news, state news, and event coverage only show stories published in the last 7 days. State updates filter for location-relevant reports; when Google News is unavailable, state pages fall back to matching local headlines from the Nigerian newsroom feeds. News cards use publisher-provided RSS media or fetch Open Graph story media from an allowlist of publishers; videos are embedded only when the publisher provides a direct playable video URL. Some articles do not include media. Event coverage is recent reporting, not a verified future-event or ticket calendar; check the publisher's article for official dates and ticket details. Readers can like stories (sign-in required; shared on this server), save stories on their device, share links, and discuss headlines. News, state updates, and event coverage are cached for one hour, but cached results are rechecked against the 7-day freshness window before they are shown. State food and cultural notes cover all 36 states and the FCT.

State, slideshow, and content-card photos are fetched from Wikimedia Commons with visible source and license attribution; an internet connection is needed for sharp photos to load. If a photo cannot be found, the card uses a clean color placeholder instead of an enlarged low-resolution mockup crop.

In local-auth mode, signed-in community posts, uploaded photos, and uploaded videos are stored on the NaijaVibe server and are visible to other users of that same server after refresh. Post records are stored in SQLite; media files are stored under `.private/uploads`. Images are limited to 5 MB and videos to 25 MB. Direct HTTPS MP4, WebM, and Ogg URLs can also be attached to a post. Headline comments are likewise shared between users on the same running server. For production deployments across multiple servers or devices, configure shared database and object storage.

The standalone Videos page combines uploaded NaijaVibe videos and public HTTPS video links shared by users with YouTube's official Nigeria-wide `mostPopular` chart. Add `YOUTUBE_API_KEY` to the server `.env` file to enable the YouTube feed; create the key in Google Cloud Console, enable YouTube Data API v3, and restrict the key to that API. The server keeps the key private, refreshes the feed every 10 minutes, and reports when the key is missing or YouTube is unavailable. YouTube's chart is national, so individual-state filters show NaijaVibe community videos only. YouTube's lifetime view counts are displayed separately from weekly NaijaVibe views.

Public TikTok, Instagram, Facebook, YouTube, and X links use their official embed players when the URL format supports it; other HTTPS sources link to the original post. Social embeds load only after a viewer chooses to open them. Creators can be followed from the video cards using the existing account follow system. Video views are counted once per video, browser, and UTC day when an uploaded video starts or a social embed is opened. Videos are not embedded in the homepage news feed. Instagram does not provide a general public Reels trending feed, and TikTok trend discovery requires eligible approved access; those platforms remain available through public links shared by users until suitable official access is available.

## Structure
- `css/` variables → reset → global → layout → components → forms → pages/* → animations → responsive
- `server.js` Node auth API and static file server · `js/services/` local/demo data and auth client · `js/components/` UI pieces · `js/pages/` one module per page
- `data/` JSON copies of the demo content (the runtime copy lives in `js/config.js` and `states/state-data.js`)
- `assets/images/` photos cropped from the NaijaVibe design mockup

## Notes
- Actual live broadcasts/webinars require a separate streaming backend; the local-only UI reports when they are unavailable.
