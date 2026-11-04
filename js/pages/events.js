NV.pages.events = async function () {
  const box = NV.$('#event-list');
  const status = NV.$('#event-updated');
  const refreshButton = NV.$('#refresh-events');
  let items = [];
  let category = '';
  const classify = item => {
    const text = `${item.title} ${item.summary}`.toLowerCase();
    if (/\b(food|restaurant|culinary|drink|cook|chef)\b/.test(text)) return 'food';
    if (/\b(music|concert|afrobeats|artist|singer|album)\b/.test(text)) return 'music';
    if (/\b(business|summit|conference|technology|tech|startup|exhibition)\b/.test(text)) return 'business';
    if (/\b(festival|heritage|carnival|tradition|cultural|culture|celebration)\b/.test(text)) return 'culture';
    return 'other';
  };
  const draw = () => {
    box.innerHTML = items.filter(item => !category || classify(item) === category)
      .map(item => NV.newsCard(item, item.source || 'Event coverage')).join('')
      || '<p class="empty">No current event coverage is available in this category.</p>';
    NV.bindNewsComments(box);
  };
  const refresh = async force => {
    refreshButton.disabled = true;
    status.textContent = 'Loading current event coverage…';
    try {
      const result = await NV.services.events.list(force);
      items = result.items;
      draw();
      status.textContent = items.length
        ? `Updated ${new Date(result.updatedAt).toLocaleTimeString()} · current Nigerian event reports, published within the last 7 days${result.stale ? ' · using recent cached coverage' : ''}`
        : 'No recent Nigerian event coverage matched. Try refreshing later.';
    } catch (error) {
      console.error('Could not load current event coverage:', error);
      status.textContent = 'Current event coverage is temporarily unavailable. Try refreshing again later.';
      box.replaceChildren();
    } finally {
      refreshButton.disabled = false;
    }
  };
  NV.$$('.pill').forEach(pill => pill.addEventListener('click', () => {
    NV.$$('.pill').forEach(item => item.classList.remove('active'));
    pill.classList.add('active');
    category = pill.dataset.c;
    draw();
  }));
  refreshButton.addEventListener('click', () => refresh(true));
  await refresh(false);
  window.setInterval(() => {
    if (document.visibilityState === 'visible') refresh(false);
  }, 60 * 60 * 1000);
};
