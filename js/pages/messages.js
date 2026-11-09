NV.pages.messages = async function () {
  const user = await NV.services.auth.getUser();
  if (!user) {
    NV.router.go('login.html?next=messages.html');
    return;
  }

  const search = NV.$('#people-search');
  const resultsBox = NV.$('#people-results');
  const conversationsBox = NV.$('#conversation-list');
  const empty = NV.$('#conversation-empty');
  const view = NV.$('#conversation-view');
  const messagesBox = NV.$('#message-list');
  const form = NV.$('#message-form');
  const input = NV.$('#message-input');
  let activeConversation = null;
  let activePeer = null;
  let latestMessageId = 0;
  let searchSequence = 0;

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: options.body == null ? undefined : JSON.stringify(options.body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error?.message || 'The messaging service could not complete the request.');
    return result;
  }

  const avatarHtml = person => {
    const image = person.avatar_url || '';
    const imageUrl = image.startsWith('https://') ? image : NV.url(image);
    return `<span class="message-avatar${person.online ? ' online' : ''}">${image ? `<img src="${NV.esc(imageUrl)}" alt="">` : NV.esc((person.display_name || person.username || '?')[0].toUpperCase())}</span>`;
  };

  function drawPeople(people) {
    resultsBox.innerHTML = people.length ? people.map(person => `
      <button type="button" class="person-result" data-user-id="${NV.esc(person.id)}">
        ${avatarHtml(person)}
        <span class="person-copy"><b>${NV.esc(person.display_name)}</b><small>@${NV.esc(person.username)} · ${person.online ? 'Online' : person.state ? NV.esc(person.state) : 'Offline'}</small></span>
      </button>`).join('') : '<p class="messages-status">No people found.</p>';
  }

  async function loadConversations() {
    const data = await api('/api/messages/conversations');
    const items = data.conversations || [];
    conversationsBox.innerHTML = items.length ? items.map(item => `
      <button type="button" class="conversation-item${activeConversation === item.id ? ' active' : ''}" data-conversation-id="${NV.esc(item.id)}">
        ${avatarHtml(item.peer)}
        <span class="conversation-copy"><b>${NV.esc(item.peer.display_name)}</b><small class="last-message">${NV.esc(item.last_message || '@' + item.peer.username)}</small></span>
      </button>`).join('') : '<p class="messages-status">Your conversations will appear here.</p>';
    return items;
  }

  function renderMessage(message) {
    if (messagesBox.querySelector(`[data-message-id="${message.id}"]`)) return;
    const bubble = document.createElement('article');
    bubble.className = `message-bubble${message.sender_id === user.id ? ' mine' : ''}`;
    bubble.dataset.messageId = message.id;
    const body = document.createElement('span');
    body.textContent = message.body;
    const time = document.createElement('time');
    time.dateTime = new Date(message.created_at).toISOString();
    time.textContent = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    bubble.append(body, time);
    messagesBox.appendChild(bubble);
    latestMessageId = Math.max(latestMessageId, Number(message.id) || 0);
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }

  async function loadMessages() {
    if (!activeConversation) return;
    const data = await api(`/api/messages/conversations/${encodeURIComponent(activeConversation)}/messages`);
    const messages = data.messages || [];
    const nextLatest = messages.reduce((max, message) => Math.max(max, Number(message.id) || 0), 0);
    if (nextLatest < latestMessageId) {
      messagesBox.replaceChildren();
      latestMessageId = 0;
    }
    messages.forEach(renderMessage);
  }

  async function openConversation(conversationId, peer) {
    activeConversation = conversationId;
    activePeer = peer;
    latestMessageId = 0;
    messagesBox.replaceChildren();
    empty.hidden = true;
    view.hidden = false;
    NV.$('#peer-avatar').innerHTML = avatarHtml(peer);
    NV.$('#peer-name').textContent = peer.display_name || peer.username;
    NV.$('#peer-status').textContent = peer.online ? 'Online' : peer.state || 'Offline';
    await loadConversations();
    await loadMessages();
    input.focus();
  }

  const runSearch = NV.debounce(async () => {
    const query = search.value.trim();
    const sequence = ++searchSequence;
    if (query.length < 2) {
      resultsBox.replaceChildren();
      return;
    }
    try {
      const data = await api('/api/users/search?q=' + encodeURIComponent(query));
      if (sequence === searchSequence) drawPeople(data.users || []);
    } catch (error) {
      if (sequence === searchSequence) {
        resultsBox.innerHTML = `<p class="messages-status">${NV.esc(error.message)}</p>`;
      }
    }
  }, 250);
  search.addEventListener('input', runSearch);

  resultsBox.addEventListener('click', async event => {
    const button = event.target.closest('[data-user-id]');
    if (!button) return;
    button.disabled = true;
    try {
      const result = await api('/api/messages/conversations', {
        method: 'POST',
        body: { user_id: button.dataset.userId }
      });
      search.value = '';
      resultsBox.replaceChildren();
      await openConversation(result.conversation_id, result.peer);
    } catch (error) {
      NV.toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });

  conversationsBox.addEventListener('click', async event => {
    const button = event.target.closest('[data-conversation-id]');
    if (!button) return;
    try {
      const items = await loadConversations();
      const conversation = items.find(item => item.id === button.dataset.conversationId);
      if (conversation) await openConversation(conversation.id, conversation.peer);
    } catch (error) {
      NV.toast(error.message, 'error');
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const body = input.value.trim();
    if (!activeConversation || !body) return;
    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    try {
      const result = await api(`/api/messages/conversations/${encodeURIComponent(activeConversation)}/messages`, {
        method: 'POST',
        body: { body }
      });
      renderMessage(result.message);
      input.value = '';
      await loadConversations();
    } catch (error) {
      NV.toast(error.message, 'error');
    } finally {
      submit.disabled = false;
      input.focus();
    }
  });

  async function refreshPresence() {
    try {
      await api('/api/users/presence', { method: 'POST', body: {} });
      const items = await loadConversations();
      if (activePeer) {
        const current = items.find(item => item.id === activeConversation);
        if (current) {
          activePeer = current.peer;
          NV.$('#peer-status').textContent = current.peer.online ? 'Online' : current.peer.state || 'Offline';
        }
      }
    } catch (error) {
      console.error('Could not refresh messaging presence:', error);
    }
  }

  try {
    await refreshPresence();
    const requestedUsername = NV.param('user');
    if (requestedUsername) {
      const people = await api('/api/users/search?q=' + encodeURIComponent(requestedUsername));
      const peer = (people.users || []).find(person => person.username.toLowerCase() === requestedUsername.replace(/^@/, '').toLowerCase());
      if (peer) {
        const result = await api('/api/messages/conversations', { method: 'POST', body: { user_id: peer.id } });
        await openConversation(result.conversation_id, result.peer);
      }
    }
  } catch (error) {
    NV.toast(error.message, 'error');
  }
  window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    refreshPresence();
    loadMessages().catch(error => console.error('Could not refresh direct messages:', error));
  }, 5000);
};
