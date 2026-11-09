NV.pages.live = async function () {
  const notice = NV.$('#live-setup-notice');
  const list = NV.$('#live-list');
  const count = NV.$('#live-count');
  const room = NV.$('#live-room');
  const videoContainer = NV.$('#live-video');
  const message = NV.$('#live-player-message');
  const chatMessages = NV.$('#live-chat-messages');
  const viewerCountEl = NV.$('#live-viewer-count');
  const liveLayout = NV.$('.live-layout');
  const liveStateFilter = NV.$('#live-state-filter');

  let currentRoom = null;
  let localAgoraTracks = [];
  let agoraClient = null;
  let roomUser = null;
  let isHost = false;
  let chatPollTimer = null;
  let reactionsPollTimer = null;
  let heartbeatTimer = null;
  let streamListTimer = null;
  let lastMessageId = 0;
  const renderedMessageIds = new Set();
  let lastReactionId = 0;
  let isMicMuted = false;
  let isCamOff = false;
  let liveViewerId;

  try {
    liveViewerId = sessionStorage.getItem('nv:live-viewer-id');
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(liveViewerId || '')) {
      liveViewerId = crypto.randomUUID();
      sessionStorage.setItem('nv:live-viewer-id', liveViewerId);
    }
  } catch (error) {
    console.error('Could not persist the live viewer session ID:', error);
    liveViewerId = crypto.randomUUID();
  }

  const showNotice = text => {
    if (!notice) return;
    notice.textContent = text;
    notice.hidden = false;
  };
  const hideNotice = () => { if (notice) notice.hidden = true; };
  const avatar = name => NV.esc((name || 'N').slice(0, 1).toUpperCase());

  // Render stream list
  function renderStreams(streams) {
    if (!count || !list) return;
    count.textContent = streams.length
      ? `${streams.length} ${streams.length === 1 ? 'creator is' : 'creators are'} live across Nigeria`
      : 'No one is live right now';

    if (!streams.length) {
      list.innerHTML = `<div class="live-empty">${liveStateFilter?.value ? `No one is live in ${NV.esc(liveStateFilter.value)} right now.` : 'No active live streams right now.'} Start a broadcast when Agora streaming is configured.</div>`;
      return;
    }

    list.innerHTML = streams.map(stream => {
      const username = stream.host_username || 'creator';
      const owner = roomUser && stream.owner_id === roomUser.id;
      const formatIcon = stream.room_type === 'audio'
        ? `${NV.icon('mic')}<span>Audio room</span>`
        : `${NV.icon('video')}<span>Video live</span>`;

      return `<article class="live-card">
        <div class="live-card-avatar" aria-hidden="true">${avatar(username)}</div>
        <div class="live-card-copy">
          <h3>${NV.esc(stream.title)}</h3>
          <p>@${NV.esc(username)} · ${NV.icon('pin')} ${NV.esc(stream.state)}</p>
          <div class="live-card-meta">
            <span class="live-badge"><i></i> LIVE</span>
            <span>${NV.esc(stream.topic || 'Community')}</span>
            <span class="live-card-format">${formatIcon}</span>
            <span class="live-card-watchers">${NV.icon('eye')} ${Number(stream.viewer_count) || 0} watching</span>
          </div>
        </div>
        <button class="live-card-watch" type="button" data-stream-id="${NV.esc(stream.id)}">${owner ? 'Your Room' : 'Join Live'}</button>
      </article>`;
    }).join('');

    list.querySelectorAll('[data-stream-id]').forEach(button => {
      button.addEventListener('click', () => {
        const stream = streams.find(item => String(item.id) === button.dataset.streamId);
        if (stream) joinRoom(stream, Boolean(roomUser && stream.owner_id === roomUser.id));
      });
    });
  }

  // Load streams from backend
  async function loadStreams() {
    try {
      const params = new URLSearchParams();
      if (liveStateFilter?.value) params.set('state', liveStateFilter.value);
      const query = params.toString();
      const res = await fetch('/api/live/rooms' + (query ? `?${query}` : ''));
      if (res.ok) {
        const data = await res.json();
        renderStreams(data.rooms || []);
        hideNotice();
        return;
      }
    } catch (err) {
      console.error('Could not fetch live rooms:', err);
    }
    if (count) count.textContent = 'Could not connect to live rooms';
    if (list) list.innerHTML = '<div class="live-empty">Live rooms could not be loaded. Please refresh the page.</div>';
  }

  // Floating reactions
  const reactionEmojis = new Set(['❤️', '🔥', '🎉', '🇳🇬', '👏']);

  function spawnFloatingReaction(reaction) {
    if (!videoContainer) return;
    if (!reactionEmojis.has(reaction)) return;
    const el = document.createElement('div');
    el.className = 'floating-reaction';
    el.textContent = reaction;
    const randomX = (Math.random() * 80 - 40) + 'px';
    el.style.setProperty('--rx', randomX);
    el.style.right = (20 + Math.random() * 30) + 'px';
    videoContainer.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  // Chat message rendering
  function addChatMessage(item) {
    if (!chatMessages) return;
    const messageId = Number(item.id) || 0;
    if (messageId && renderedMessageIds.has(messageId)) return;
    const username = item.username || 'Viewer';
    const time = new Date(item.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const el = document.createElement('div');
    el.className = 'live-chat-message';
    el.innerHTML = `<b>@${NV.esc(username)}:</b> <span>${NV.esc(item.body)}</span> <time>${time}</time>`;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    if (messageId) {
      renderedMessageIds.add(messageId);
      lastMessageId = Math.max(lastMessageId, messageId);
    }
  }

  async function pollMessages(roomId) {
    try {
      const cursor = lastMessageId ? `?after=${lastMessageId}` : '';
      const res = await fetch(`/api/live/rooms/${encodeURIComponent(roomId)}/messages${cursor}`);
      if (res.ok) {
        const data = await res.json();
        const newMessages = (data.messages || []).filter(m => m.id > lastMessageId);
        newMessages.forEach(addChatMessage);
      } else {
        console.error('Could not load live chat messages:', res.status, await res.text());
      }
    } catch (error) {
      console.error('Could not poll live chat messages:', error);
    }
  }

  async function pollReactions(roomId) {
    try {
      const res = await fetch(`/api/live/rooms/${encodeURIComponent(roomId)}/reactions`);
      if (res.ok) {
        const data = await res.json();
        const reactions = (data.reactions || []).filter(reaction => reaction.id > lastReactionId).sort((a, b) => a.id - b.id);
        reactions.forEach(reaction => {
          spawnFloatingReaction(reaction.reaction);
          lastReactionId = Math.max(lastReactionId, reaction.id);
        });
      }
    } catch (e) {}
  }

  // Audio Room Stage Component
  function renderAudioStage(stream, isHostUser) {
    videoContainer.replaceChildren();
    const stage = document.createElement('div');
    stage.className = 'audio-stage';
    stage.innerHTML = `
      <div class="audio-avatar-wrapper">
        <div class="audio-pulse"></div>
        <div class="audio-pulse-2"></div>
        <div class="audio-avatar">${avatar(stream.host_username || 'Host')}</div>
      </div>
      <h3 style="font-size:18px;margin:4px 0">${NV.esc(stream.host_name || stream.host_username || 'Naija Host')}</h3>
      <span class="badge" style="background:rgba(255,210,63,0.2);color:#ffd23f;border-radius:12px;padding:3px 12px;font-size:11px;font-weight:700">
        ${NV.icon('mic')} ${isHostUser ? 'Microphone preview' : 'Audio stream from ' + NV.esc(stream.state)}
      </span>
      <div class="audio-equalizer">
        <span class="audio-bar"></span>
        <span class="audio-bar"></span>
        <span class="audio-bar"></span>
        <span class="audio-bar"></span>
        <span class="audio-bar"></span>
        <span class="audio-bar"></span>
        <span class="audio-bar"></span>
      </div>
      <p class="muted" style="color:rgba(255,255,255,0.7);font-size:12px;max-width:320px;margin:4px 0">
        ${NV.esc(stream.title)}
      </p>
    `;
    videoContainer.appendChild(stage);
  }

  // Join Room
  async function joinRoom(stream, host) {
    if (currentRoom) await leaveRoom(isHost);

    currentRoom = stream;
    isHost = host;
    room.hidden = false;
    liveLayout?.classList.add('has-room');
    room.scrollIntoView({ behavior: 'smooth', block: 'start' });

    NV.$('#live-room-title').textContent = stream.title;
    NV.$('#live-room-state').innerHTML = `${NV.icon('pin')} ${NV.esc(stream.state)} · ${NV.esc(stream.topic || 'Community')}`;
    NV.$('#live-room-host').textContent = `Hosted by @${stream.host_username || 'creator'}`;

    const endBtn = NV.$('#end-live');
    if (endBtn) endBtn.hidden = !host;

    const micBtn = NV.$('#toggle-mic');
    const camBtn = NV.$('#toggle-cam');
    if (micBtn) micBtn.hidden = !host;
    if (camBtn) camBtn.hidden = !(host && stream.room_type !== 'audio');
    isMicMuted = false;
    isCamOff = false;

    message.hidden = true;
    if (viewerCountEl) viewerCountEl.textContent = `${Number(stream.viewer_count) || 0} watching`;

    videoContainer.replaceChildren();

    try {
      if (!window.AgoraRTC) throw new Error('The live streaming service could not be loaded. Refresh and try again.');
      message.textContent = host ? 'Starting your broadcast…' : 'Connecting to the live broadcast…';
      message.hidden = false;
      const tokenResponse = await fetch(`/api/live/rooms/${encodeURIComponent(stream.id)}/token`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: host ? 'publisher' : 'subscriber' })
      });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok) throw new Error(tokenData.error?.message || 'Could not get access to this live room.');

      agoraClient = window.AgoraRTC.createClient({ mode: 'live', codec: 'vp8' });
      await agoraClient.setClientRole(host ? 'host' : 'audience');
      let tokenRenewalInProgress = false;
      const renewAgoraToken = async () => {
        if (tokenRenewalInProgress || !agoraClient || !tokenData.token) return;
        tokenRenewalInProgress = true;
        try {
          const response = await fetch(`/api/live/rooms/${encodeURIComponent(stream.id)}/token`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: tokenData.uid })
          });
          const renewed = await response.json().catch(() => ({}));
          if (!response.ok || !renewed.token) throw new Error(renewed.error?.message || 'Could not renew the live connection.');
          await agoraClient.renewToken(renewed.token);
        } catch (error) {
          console.error('Could not renew the Agora live token:', error);
          showNotice('Your live connection is expiring. Please leave and rejoin the room.');
        } finally {
          tokenRenewalInProgress = false;
        }
      };
      agoraClient.on('token-privilege-will-expire', renewAgoraToken);
      agoraClient.on('token-privilege-did-expire', renewAgoraToken);
      agoraClient.on('user-published', async (remoteUser, mediaType) => {
        try {
          await agoraClient.subscribe(remoteUser, mediaType);
          if (mediaType === 'video' && remoteUser.videoTrack) {
            videoContainer.replaceChildren();
            message.hidden = true;
            remoteUser.videoTrack.play(videoContainer);
          } else if (mediaType === 'audio' && remoteUser.audioTrack) {
            remoteUser.audioTrack.play();
            if (stream.room_type === 'audio') message.hidden = true;
          }
        } catch (error) {
          console.error('Could not play a live participant track:', error);
          showNotice('A live audio or video track could not be played. Check your connection and browser permissions.');
        }
      });
      agoraClient.on('user-unpublished', remoteUser => {
        if (remoteUser.videoTrack) remoteUser.videoTrack.stop();
        if (currentRoom && !host && stream.room_type !== 'audio') {
          videoContainer.replaceChildren();
          message.textContent = 'The broadcaster paused their video.';
          message.hidden = false;
        }
      });
      agoraClient.on('user-left', () => {
        if (!host) {
          videoContainer.replaceChildren();
          if (stream.room_type === 'audio') renderAudioStage(stream, false);
          message.textContent = 'The broadcaster has disconnected.';
          message.hidden = false;
        }
      });
      await agoraClient.join(tokenData.appId, tokenData.channelName, tokenData.token || null, tokenData.uid);

      if (host) {
        const audioTrack = await window.AgoraRTC.createMicrophoneAudioTrack();
        localAgoraTracks = [audioTrack];
        if (stream.room_type !== 'audio') {
          const videoTrack = await window.AgoraRTC.createCameraVideoTrack();
          localAgoraTracks.push(videoTrack);
        }
        await agoraClient.publish(localAgoraTracks);
        if (stream.room_type === 'audio') {
          renderAudioStage(stream, true);
        } else {
          videoContainer.replaceChildren();
          localAgoraTracks.find(track => track.trackMediaType === 'video').play(videoContainer);
        }
        message.hidden = true;
      } else if (stream.room_type === 'audio') {
        renderAudioStage(stream, false);
      }
      hideNotice();
    } catch (error) {
      console.error('Could not join Agora live room:', error);
      if (agoraClient) {
        try { await agoraClient.leave(); } catch (leaveError) { console.error('Could not leave the failed live connection:', leaveError); }
        agoraClient = null;
      }
      localAgoraTracks.forEach(track => track.close());
      localAgoraTracks = [];
      currentRoom = null;
      room.hidden = true;
      liveLayout?.classList.remove('has-room');
      if (host) {
        try {
          await fetch(`/api/live/rooms/${encodeURIComponent(stream.id)}/end`, { method: 'POST', credentials: 'same-origin' });
        } catch (endError) {
          console.error('Could not close the live room after broadcast startup failed:', endError);
        }
      }
      showNotice(error.message || 'Could not join the live stream.');
      await loadStreams();
      return;
    }

    // Load initial chat
    if (chatMessages) chatMessages.replaceChildren();
    lastMessageId = 0;
    renderedMessageIds.clear();
    lastReactionId = 0;
    await pollMessages(stream.id);

    // Start intervals
    if (chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = setInterval(() => pollMessages(stream.id), 2500);

    if (reactionsPollTimer) clearInterval(reactionsPollTimer);
    reactionsPollTimer = setInterval(() => pollReactions(stream.id), 2000);

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    const updateViewerCount = async () => {
      try {
        const res = await fetch(`/api/live/rooms/${encodeURIComponent(stream.id)}/viewer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ viewerId: liveViewerId })
        });
        if (res.ok) {
          const data = await res.json();
          if (viewerCountEl && Number.isInteger(data.viewer_count)) {
            viewerCountEl.textContent = `${data.viewer_count} watching`;
          }
        } else {
          console.error('Could not update the live viewer count:', await res.text());
        }
      } catch (error) {
        console.error('Could not update the live viewer count:', error);
      }
    };
    await updateViewerCount();
    heartbeatTimer = setInterval(updateViewerCount, 10000);
  }

  // Leave Room
  async function leaveRoom(endStream = false) {
    if (!currentRoom) return;
    const stream = currentRoom;
    currentRoom = null;

    if (chatPollTimer) clearInterval(chatPollTimer);
    if (reactionsPollTimer) clearInterval(reactionsPollTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    try {
      const presenceResponse = await fetch(`/api/live/rooms/${encodeURIComponent(stream.id)}/viewer`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewerId: liveViewerId })
      });
      if (!presenceResponse.ok) throw new Error(`Presence cleanup failed with HTTP ${presenceResponse.status}.`);
    } catch (error) {
      console.error('Could not clear the live viewer presence:', error);
    }

    if (agoraClient) {
      try {
        await agoraClient.leave();
      } catch (error) {
        console.error('Could not leave the Agora live room:', error);
      }
      agoraClient = null;
    }
    localAgoraTracks.forEach(track => track.close());
    localAgoraTracks = [];

    videoContainer.replaceChildren();
    room.hidden = true;
    liveLayout?.classList.remove('has-room');

    if (endStream && stream && isHost) {
      try {
        await fetch(`/api/live/rooms/${encodeURIComponent(stream.id)}/end`, {
          method: 'POST',
          credentials: 'same-origin'
        });
        NV.toast('Your live stream has ended.', 'info');
      } catch (err) {
        console.error('Could not end stream:', err);
      }
    }
    isHost = false;
    await loadStreams();
  }

  // Broadcaster Toggle Mic & Cam
  const micBtn = NV.$('#toggle-mic');
  if (micBtn) {
    micBtn.addEventListener('click', async () => {
      const track = localAgoraTracks.find(item => item.trackMediaType === 'audio');
      if (!track) return;
      isMicMuted = !isMicMuted;
      try {
        await track.setEnabled(!isMicMuted);
      } catch (error) {
        isMicMuted = !isMicMuted;
        NV.toast('Could not change the microphone state.', 'error');
        console.error('Could not toggle the live microphone:', error);
        return;
      }
      micBtn.innerHTML = `${NV.icon(isMicMuted ? 'micOff' : 'mic')}<span>${isMicMuted ? 'Mic muted' : 'Mic on'}</span>`;
      micBtn.setAttribute('aria-pressed', String(isMicMuted));
      micBtn.title = isMicMuted ? 'Unmute microphone' : 'Mute microphone';
      micBtn.style.background = isMicMuted ? '#d92d20' : '';
    });
  }

  const camBtn = NV.$('#toggle-cam');
  if (camBtn) {
    camBtn.addEventListener('click', async () => {
      const track = localAgoraTracks.find(item => item.trackMediaType === 'video');
      if (!track) return;
      isCamOff = !isCamOff;
      try {
        await track.setEnabled(!isCamOff);
      } catch (error) {
        isCamOff = !isCamOff;
        NV.toast('Could not change the camera state.', 'error');
        console.error('Could not toggle the live camera:', error);
        return;
      }
      camBtn.innerHTML = `${NV.icon(isCamOff ? 'videoOff' : 'video')}<span>${isCamOff ? 'Camera off' : 'Camera on'}</span>`;
      camBtn.setAttribute('aria-pressed', String(isCamOff));
      camBtn.title = isCamOff ? 'Turn camera on' : 'Turn camera off';
      camBtn.style.background = isCamOff ? '#d92d20' : '';
    });
  }

  // Dialog & Form Handlers
  const startDialog = NV.$('#live-start-dialog');
  const startForm = NV.$('#live-start-form');
  const stateSelect = NV.$('#live-state');

  if (stateSelect && window.NV_STATES) {
    stateSelect.innerHTML = '<option value="">Choose a state</option>' +
      window.NV_STATES.map(s => `<option value="${NV.esc(s.name)}">${NV.esc(s.name)}</option>`).join('');
  }

  if (liveStateFilter && window.NV_STATES) {
    liveStateFilter.insertAdjacentHTML('beforeend', window.NV_STATES
      .map(state => `<option value="${NV.esc(state.name)}">${NV.esc(state.name)}</option>`).join(''));
    const requestedState = NV.param('state');
    const selectedState = window.NV_STATES.find(state => state.name === requestedState || state.slug === requestedState);
    if (selectedState) liveStateFilter.value = selectedState.name;
    liveStateFilter.addEventListener('change', loadStreams);
  }

  NV.$('#open-live-setup').addEventListener('click', async () => {
    roomUser = await NV.services.auth.getUser();
    if (!roomUser) {
      NV.router.go('login.html?next=live.html');
      return;
    }
    startDialog.showModal();
  });

  NV.$('#cancel-live-start').addEventListener('click', () => startDialog.close());

  startForm.addEventListener('submit', async event => {
    event.preventDefault();
    const title = NV.$('#live-title').value.trim();
    const topic = NV.$('#live-topic').value;
    const roomType = NV.$('#live-room-type').value;
    const state = stateSelect.value;
    const submitBtn = NV.$('#start-live-submit-btn');

    if (!title || !state) {
      NV.toast('Please provide a stream title and state.', 'error');
      return;
    }

    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetch('/api/live/rooms', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, topic, state, room_type: roomType })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Could not start live stream.');
      }
      startDialog.close();
      startForm.reset();
      NV.toast('Live room created. Connecting to your broadcast…', 'info');
      await joinRoom(data.room, true);
      await loadStreams();
    } catch (err) {
      NV.toast(err.message || 'Could not start live stream.', 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // Chat Submission
  NV.$('#live-chat-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!currentRoom) return;
    roomUser = roomUser || await NV.services.auth.getUser();
    if (!roomUser) {
      NV.toast('Please sign in to join the live chat.', 'info');
      NV.router.go('login.html?next=live.html');
      return;
    }
    const input = NV.$('#live-chat-input');
    const body = input.value.trim();
    if (!body) return;

    try {
      const res = await fetch(`/api/live/rooms/${encodeURIComponent(currentRoom.id)}/messages`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body })
      });
      if (res.ok) {
        const data = await res.json();
        addChatMessage(data.message);
        input.value = '';
      } else {
        const err = await res.json().catch(() => ({}));
        NV.toast(err.error?.message || 'Failed to send message.', 'error');
      }
    } catch (err) {
      NV.toast('Could not send message.', 'error');
    }
  });

  // Reactions click handler
  document.querySelectorAll('.live-react-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!currentRoom) return;
      const reaction = btn.dataset.reaction || 'heart';
      spawnFloatingReaction(reaction);
      try {
        await fetch(`/api/live/rooms/${encodeURIComponent(currentRoom.id)}/react`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reaction })
        });
      } catch (e) {}
    });
  });

  NV.$('#leave-live').addEventListener('click', () => leaveRoom(isHost));
  NV.$('#end-live').addEventListener('click', () => leaveRoom(true));
  NV.$('#close-live-room').addEventListener('click', () => leaveRoom(isHost));
  NV.$('#refresh-live').addEventListener('click', loadStreams);

  window.addEventListener('beforeunload', () => {
    localAgoraTracks.forEach(track => track.close());
    if (currentRoom) {
      fetch(`/api/live/rooms/${encodeURIComponent(currentRoom.id)}/viewer`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewerId: liveViewerId }),
        keepalive: true
      }).catch(error => console.error('Could not clear the live viewer presence:', error));
    }
  });

  roomUser = await NV.services.auth.getUser();
  await loadStreams();
  streamListTimer = setInterval(() => {
    if (document.visibilityState === 'visible') loadStreams();
  }, 15000);
  window.addEventListener('beforeunload', () => clearInterval(streamListTimer), { once: true });
};
