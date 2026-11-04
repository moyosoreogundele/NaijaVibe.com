(function (NV) {
  NV.newsCard = (item, label = '') => {
    let url;
    try {
      url = new URL(item.sourceUrl || item.url);
    } catch {
      return '';
    }
    if (url.protocol !== 'https:') return '';
    if (!/^[a-f0-9]{20}$/.test(item.id || '')) return '';
    NV.services.news.remember(item);
    const id = NV.esc(item.id);
    const published = item.publishedAt ? new Date(item.publishedAt).toLocaleString() : 'Latest';
    const liked = item.liked === true;
    const saved = NV.services.news.isSaved(item.id);
    return `<article class="news-item card" data-news-id="${id}">
      ${item.imageUrl ? `<a class="news-media-link" href="${NV.esc(url.toString())}" target="_blank" rel="noopener noreferrer" aria-label="Open story: ${NV.esc(item.title)}"><img class="news-media" src="${NV.esc(item.imageUrl)}" alt="Photo supplied by ${NV.esc(item.publisher || label || item.source)}" loading="lazy" referrerpolicy="no-referrer"></a>` : ''}
      <div class="news-item-content">
        <a class="news-title" href="${NV.esc(url.toString())}" target="_blank" rel="noopener noreferrer">${NV.esc(item.title)}</a>
        ${item.summary ? `<p>${NV.esc(item.summary)}</p>` : ''}
        ${!item.imageUrl && item.videoUrl ? '<small class="news-no-media">A video is available on the publisher’s story page.</small>' : ''}
        ${!item.imageUrl && !item.videoUrl ? `<small class="news-no-media">The publisher did not provide a story photo or video.</small>` : ''}
        <small class="news-source">${NV.esc(item.publisher || label || item.source)} · Published ${NV.esc(published)}</small>
        <div class="news-actions">
          <button type="button" data-news-like aria-pressed="${liked}" aria-label="${liked ? 'Unlike' : 'Like'} this story" title="Likes are shared with NaijaVibe users on this server">${NV.icon('heart')}<span>${liked ? 'Liked' : 'Like'}</span><span data-news-like-count>${Number(item.likes) || 0}</span></button>
          <button type="button" data-news-save aria-pressed="${saved}" title="Saved stories are kept on this device">${NV.icon('bookmark')}<span>${saved ? 'Saved' : 'Save'}</span></button>
          <button type="button" data-news-share>${NV.icon('share')}<span>Share</span></button>
        </div>
        <button class="news-discuss" type="button" data-news-discuss aria-expanded="false">Discuss <span data-news-comment-count>0</span></button>
        <div class="news-discussion" data-news-discussion hidden>
          <div class="news-comments" data-news-comments></div>
          <form data-news-comment-form><label class="sr-only" for="news-comment-${id}">Add a comment about this story</label><input class="input" id="news-comment-${id}" name="body" maxlength="500" placeholder="Add a comment" required><button class="btn btn-primary btn-sm" type="submit">Post</button></form>
          <small>Comments are shared with other users of this NaijaVibe server.</small>
        </div>
      </div>
    </article>`;
  };

  NV.bindNewsComments = root => {
    if (!root || root.dataset.newsCommentsBound) return;
    root.dataset.newsCommentsBound = 'true';
    root.addEventListener('click', async event => {
      const action = event.target.closest('[data-news-like], [data-news-save], [data-news-share]');
      if (action) {
        const card = action.closest('[data-news-id]');
        const id = card.dataset.newsId;
        if (action.matches('[data-news-like]')) {
          action.disabled = true;
          try {
            const result = await NV.services.news.like(id);
            action.setAttribute('aria-pressed', String(result.liked));
            action.setAttribute('aria-label', `${result.liked ? 'Unlike' : 'Like'} this story`);
            action.querySelector('span').textContent = result.liked ? 'Liked' : 'Like';
            action.querySelector('[data-news-like-count]').textContent = result.likes;
          } catch (error) {
            NV.toast(error.message || 'Could not like this story.', 'error');
          } finally {
            action.disabled = false;
          }
          return;
        }
        if (action.matches('[data-news-save]')) {
          try {
            const saved = NV.services.news.save(id);
            action.setAttribute('aria-pressed', String(saved));
            action.querySelector('span').textContent = saved ? 'Saved' : 'Save';
            NV.toast(saved ? 'Story saved on this device.' : 'Story removed from your saved list.', 'success');
            if (!saved && root.id === 'saved-news-list') card.remove();
          } catch (error) {
            NV.toast(error.message || 'Could not save this story.', 'error');
          }
          return;
        }
        try {
          const link = card.querySelector('.news-title').href;
          const title = card.querySelector('.news-title').textContent;
          if (navigator.share) await navigator.share({ title, url: link });
          else if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(link);
            NV.toast('Story link copied. Share it with anyone.', 'success');
          } else {
            window.prompt('Copy this story link to share it:', link);
          }
        } catch (error) {
          if (error.name !== 'AbortError') NV.toast('Could not share this story. Please try copying its link.', 'error');
        }
        return;
      }
      const button = event.target.closest('[data-news-discuss]');
      if (!button) return;
      const card = button.closest('[data-news-id]');
      const section = card.querySelector('[data-news-discussion]');
      section.hidden = !section.hidden;
      button.setAttribute('aria-expanded', String(!section.hidden));
      if (section.hidden) return;
      let comments;
      try {
        comments = await NV.services.comments.listNews(card.dataset.newsId);
      } catch (error) {
        console.error('Could not load headline comments:', error);
        NV.toast(error.message || 'Could not load this discussion.', 'error');
        return;
      }
      card.querySelector('[data-news-comment-count]').textContent = comments.length;
      card.querySelector('[data-news-comments]').innerHTML = comments.map(comment =>
        `<p><b>${NV.esc(comment.user || 'visitor')}</b> ${NV.esc(comment.body)}</p>`
      ).join('') || '<p class="muted">No comments yet. Start the conversation.</p>';
    });
    root.addEventListener('submit', async event => {
      const form = event.target.closest('[data-news-comment-form]');
      if (!form) return;
      event.preventDefault();
      const body = form.elements.body.value.trim();
      if (!body) return;
      const card = form.closest('[data-news-id]');
      try {
        await NV.services.comments.addNews(card.dataset.newsId, body);
        form.reset();
        const comments = await NV.services.comments.listNews(card.dataset.newsId);
        card.querySelector('[data-news-comment-count]').textContent = comments.length;
        card.querySelector('[data-news-comments]').innerHTML = comments.map(comment =>
          `<p><b>${NV.esc(comment.user || 'visitor')}</b> ${NV.esc(comment.body)}</p>`
        ).join('');
      } catch (error) {
        console.error('Could not post a headline comment:', error);
        if (/sign in/i.test(error.message || '')) {
          const notice = card.querySelector('[data-news-comments]');
          notice.innerHTML = `<p class="muted">Sign in to join the discussion. <a href="${NV.url('login.html?next=' + encodeURIComponent(location.pathname + location.search))}">Log in</a> or <a href="${NV.url('signup.html')}">create an account</a>.</p>`;
        }
        NV.toast(error.message || 'Could not post your comment.', 'error');
      }
    });
  };
})(window.NV);
