(function (NV) {
  function mediaUrl(value, video) {
    if (typeof value !== 'string') return '';
    if (/^\/media\/[a-f0-9-]{36}\.(?:mp4|webm|ogv)$/i.test(value) && video) return value;
    if (/^\/media\/[a-f0-9-]{36}\.(?:jpg|png|webp|gif)$/i.test(value) && !video) return value;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return '';
      if (video && !/\.(?:mp4|webm|ogg)$/i.test(url.pathname)) return '';
      if (!video && !/\.(?:jpe?g|png|webp|gif)$/i.test(url.pathname)) return '';
      return url.toString();
    } catch {
      return '';
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
      if (/\/(?:reel|videos?|watch)\//i.test(url.pathname) || host === 'fb.watch') {
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

  NV.socialVideoEmbed = socialVideoEmbed;

  NV.videoPlayer = (video, featured = false) => {
    const directSource = mediaUrl(video.video_url, true);
    const externalSource = typeof video.external_video_url === 'string' && /^https:\/\//i.test(video.external_video_url)
      ? video.external_video_url
      : '';
    const embed = externalSource ? socialVideoEmbed(externalSource) : null;
    const poster = mediaUrl(video.image || video.image_url, false);
    if (directSource) {
      return `<video class="video-card-player${featured ? ' video-player-featured' : ''}" controls preload="metadata" playsinline${poster ? ` poster="${NV.esc(poster)}"` : ''} aria-label="Watch ${NV.esc(video.title)}"><source src="${NV.esc(directSource)}"></video>`;
    }
    if (embed) {
      return `<div class="social-video-player${featured ? ' video-player-featured' : ''}" data-social-player data-embed-url="${NV.esc(embed.url)}" data-platform="${NV.esc(embed.platform)}">
        <button type="button" class="social-video-load" data-social-play aria-label="Load ${NV.esc(embed.platform)} video">
          ${poster ? `<img src="${NV.esc(poster)}" alt="" loading="lazy">` : ''}
          <span>${NV.icon('play')}<b>Watch on ${NV.esc(embed.platform)}</b></span>
        </button>
      </div>`;
    }
    if (externalSource) {
      let platform = 'social media';
      try { platform = new URL(externalSource).hostname.replace(/^www\./, ''); } catch {}
      return `<a class="external-video-link${featured ? ' video-player-featured' : ''}" href="${NV.esc(externalSource)}" target="_blank" rel="noopener noreferrer">
        ${poster ? `<img src="${NV.esc(poster)}" alt="" loading="lazy">` : ''}
        <span>${NV.icon('play')} Open video on ${NV.esc(platform)}</span>
      </a>`;
    }
    return '';
  };

  NV.videoCard = video => {
    const player = NV.videoPlayer(video);
    if (!player) return '';
    const creator = String(video.user || video.profiles?.username || '').replace(/^@/, '');
    const username = /^[a-z0-9_]{3,20}$/i.test(creator) ? creator : '';
    const state = video.state || video.place || 'Nigeria';
    const views = Number(video.views) || 0;
    return `<article class="post-card video-card" data-video-id="${NV.esc(video.id)}" data-video-external="${Boolean(video.external_video_url)}">
      ${player}
      ${video.source === 'youtube'
        ? `<a class="video-card-title" href="${NV.esc(video.external_video_url)}" target="_blank" rel="noopener noreferrer">${NV.esc(video.title || 'Trending Nigerian video')}</a>`
        : `<a class="video-card-title" href="${NV.url('videos/watch.html?id=' + encodeURIComponent(video.id))}">${NV.esc(video.title || 'Nigerian creator video')}</a>`}
      <div class="video-card-meta"><span>${NV.esc(state)}</span><span><b data-video-views>${views.toLocaleString('en-NG')}</b> ${NV.esc(video.view_label || 'views this week')}</span></div>
      ${video.source === 'youtube' ? '' : `<div class="video-card-actions"><button type="button" data-like-video aria-pressed="${video.liked ? 'true' : 'false'}" class="${video.liked ? 'liked' : ''}">${NV.icon('heart')}<span>Like</span><b data-video-likes>${Number(video.likes) || 0}</b></button></div>`}
      <div class="video-card-creator">${video.source === 'youtube'
        ? (video.channel_url ? `<a href="${NV.esc(video.channel_url)}" target="_blank" rel="noopener noreferrer">${NV.esc(video.user || 'YouTube creator')}</a><span class="video-source">Trending on YouTube</span>` : '<span>Trending on YouTube</span>')
        : username ? `<a href="${NV.url('profile.html?user=' + encodeURIComponent(username))}">@${NV.esc(username)}</a><button type="button" data-follow-creator="${NV.esc(username)}" class="btn btn-outline btn-sm">Follow</button>` : '<span>NaijaVibe creator</span>'}</div>
    </article>`;
  };

  NV.bindVideoViews = async root => {
    if (!root || root.dataset.videoViewsBound) return;
    root.dataset.videoViewsBound = 'true';
    root.addEventListener('play', event => {
      const player = event.target.closest('video.video-card-player');
      if (player) recordView(player.closest('[data-video-id]'));
    }, true);
    root.addEventListener('click', async event => {
      const playButton = event.target.closest('[data-social-play]');
      if (playButton) {
        const box = playButton.closest('[data-social-player]');
        const iframe = document.createElement('iframe');
        iframe.src = box.dataset.embedUrl;
        iframe.title = `${box.dataset.platform} video`;
        iframe.loading = 'lazy';
        iframe.referrerPolicy = 'strict-origin-when-cross-origin';
        iframe.allow = 'autoplay; encrypted-media; picture-in-picture; web-share';
        iframe.allowFullscreen = true;
        box.replaceChildren(iframe);
        await recordView(box.closest('[data-video-id]'));
        return;
      }
      const likeButton = event.target.closest('[data-like-video]');
      if (likeButton && !likeButton.disabled) {
        likeButton.disabled = true;
        try {
          const user = await NV.services.auth.getUser();
          if (!user) {
            NV.router.go('login.html?next=' + encodeURIComponent(location.pathname + location.search));
            return;
          }
          const result = await NV.services.posts.likeVideo(likeButton.closest('[data-video-id]').dataset.videoId);
          likeButton.setAttribute('aria-pressed', String(result.liked));
          likeButton.classList.toggle('liked', result.liked);
          NV.$('[data-video-likes]', likeButton).textContent = Number(result.likes).toLocaleString('en-NG');
        } catch (error) {
          NV.toast(error.message || 'Could not like this video.', 'error');
        } finally {
          likeButton.disabled = false;
        }
        return;
      }
      const followButton = event.target.closest('[data-follow-creator]');
      if (!followButton || followButton.disabled) return;
      followButton.disabled = true;
      try {
        const user = await NV.services.auth.getUser();
        if (!user) {
          NV.router.go('login.html?next=' + encodeURIComponent(location.pathname + location.search));
          return;
        }
        if (String(user.username).toLowerCase() === followButton.dataset.followCreator.toLowerCase()) return;
        const result = await NV.services.profile.toggleFollow(followButton.dataset.followCreator);
        followButton.textContent = result.following ? 'Following' : 'Follow';
        followButton.classList.toggle('btn-primary', result.following);
        followButton.classList.toggle('btn-outline', !result.following);
        NV.toast(result.following ? 'Creator followed.' : 'Creator unfollowed.', 'success');
      } catch (error) {
        NV.toast(error.message || 'Could not update creator follow status.', 'error');
      } finally {
        followButton.disabled = false;
      }
    });

    async function recordView(card) {
      if (!card || card.dataset.videoId.startsWith('youtube:') || card.dataset.viewCounted) return;
      card.dataset.viewCounted = 'true';
      try {
        const result = await NV.services.posts.recordVideoView(card.dataset.videoId);
        card.querySelector('[data-video-views]').textContent = Number(result.views).toLocaleString('en-NG');
      } catch (error) {
        delete card.dataset.viewCounted;
        console.error('Could not record video view:', error);
      }
    }

    const cards = NV.$$('[data-follow-creator]', root);
    const usernames = [...new Set(cards.map(button => button.dataset.followCreator))];
    if (usernames.length) {
      const currentUser = await NV.services.auth.getUser();
      await Promise.all(usernames.map(async username => {
        const buttons = cards.filter(button => button.dataset.followCreator === username);
        if (currentUser && currentUser.username.toLowerCase() === username.toLowerCase()) {
          buttons.forEach(button => button.hidden = true);
          return;
        }
        const profile = await NV.services.profile.get(username);
        if (profile.username?.toLowerCase() === username.toLowerCase() && profile.isFollowing) {
          buttons.forEach(button => {
            button.textContent = 'Following';
            button.classList.remove('btn-outline');
            button.classList.add('btn-primary');
          });
        }
      }));
    }
  };
})(window.NV);
