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
  let isCoHosting = false;
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
  let previewTracks = null;
  let availableCameras = [];
  let currentCameraIndex = 0;
  const remoteParticipants = new Map();

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

  // Multi-host video grid helpers (supports 1 to 4 broadcasters together)
  function updateVideoGrid() {
    if (!videoContainer) return;
    const cells = videoContainer.querySelectorAll('.live-cell');
    const total = cells.length;
    videoContainer.className = 'live-video ' + (total <= 1 ? 'grid-1' : total === 2 ? 'grid-2' : total === 3 ? 'grid-3' : 'grid-4');
  }

  function addVideoCell(id, label, track) {
    if (!videoContainer) return;
    let cell = videoContainer.querySelector(`#cell-${id}`);
    if (!cell) {
      cell = document.createElement('div');
      cell.id = `cell-${id}`;
      cell.className = 'live-cell';
      cell.innerHTML = `
        <div class="live-cell-video"></div>
        <span class="live-cell-tag"><span class="live-mic-dot"></span>${NV.esc(label)}</span>
      `;
      videoContainer.appendChild(cell);
    } else {
      const tag = cell.querySelector('.live-cell-tag');
      if (tag) tag.innerHTML = `<span class="live-mic-dot"></span>${NV.esc(label)}`;
    }
    if (track) {
      const wrapper = cell.querySelector('.live-cell-video');
      wrapper.replaceChildren();
      track.play(wrapper);
    }
    updateVideoGrid();
  }

  function removeVideoCell(id) {
    if (!videoContainer) return;
    const cell = videoContainer.querySelector(`#cell-${id}`);
    if (cell) cell.remove();
    updateVideoGrid();
  }

  // Camera flip helper (switches between front and rear cameras on mobile)
  async function flipCamera(activeVideoTrack) {
    if (!activeVideoTrack || !window.AgoraRTC) return;
    try {
      const cameras = availableCameras.length ? availableCameras : await window.AgoraRTC.getCameras();
      if (cameras.length < 2) {
        NV.toast('Only one camera found on this device.', 'info');
        return;
      }
      currentCameraIndex = (currentCameraIndex + 1) % cameras.length;
      const nextCam = cameras[currentCameraIndex];
      await activeVideoTrack.setDevice(nextCam.deviceId);
      NV.toast(`Camera switched 🔄 (${nextCam.label || 'Camera ' + (currentCameraIndex + 1)})`, 'success');
    } catch (err) {
      console.warn('Flip camera error:', err);
      NV.toast('Could not flip camera.', 'error');
    }
  }

  // Pre-broadcast video preview helpers
  async function startPreLivePreview() {
    const previewScreen = NV.$('#live-preview-screen');
    if (!previewScreen || !window.AgoraRTC) return;
    try {
      availableCameras = await window.AgoraRTC.getCameras().catch(() => []);
      const previewAudio = await window.AgoraRTC.createMicrophoneAudioTrack().catch(() => null);
      const previewVideo = await window.AgoraRTC.createCameraVideoTrack().catch(() => null);
      previewTracks = [previewAudio, previewVideo].filter(Boolean);
      if (previewVideo) {
        previewScreen.replaceChildren();
        previewVideo.play(previewScreen);
      }
      const micInd = NV.$('#live-mic-indicator');
      if (micInd) micInd.textContent = previewAudio ? '● Mic active' : 'Mic unavailable';
    } catch (err) {
      console.warn('Pre-broadcast preview note:', err);
    }
  }

  function stopPreLivePreview() {
    if (previewTracks) {
      previewTracks.forEach(t => t.close());
      previewTracks = null;
    }
    const previewScreen = NV.$('#live-preview-screen');
    if (previewScreen) {
      previewScreen.innerHTML = '<div class="live-preview-placeholder"><i data-i="camera"></i><span>Camera Preview</span></div>';
      NV.hydrateIcons();
    }
  }

  // Share Live Invite Link (so creators and friends can invite others to join)
  function shareLiveInvite() {
    if (!currentRoom) return;
    const url = new URL('live.html', location.origin);
    url.searchParams.set('room', currentRoom.id);
    const title = currentRoom.title || 'Live Broadcast';
    if (navigator.share) {
      navigator.share({
        title: `${title} - NaijaVibe Live`,
        text: `Watch or join ${currentRoom.host_username || 'us'} live on NaijaVibe right now!`,
        url: url.toString()
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url.toString()).then(() => {
        NV.toast('Live link copied! Send it to your friends to join.', 'success');
      }).catch(() => {
        prompt('Copy live stream invite link:', url.toString());
      });
    }
  }

  // Render stream list
  function renderStreams(streams) {
    if (!count || !list) return;
    count.textContent = streams.length
      ? `${streams.length} ${streams.length === 1 ? 'creator is' : 'creators are'} live across Nigeria`
      : 'No one is live right now';

    if (!streams.length) {
      list.innerHTML = `<div class="live-empty">${liveStateFilter?.value ? `No one is live in ${NV.esc(liveStateFilter.value)} right now.` : 'No active live streams right now.'} Start a broadcast when you are ready!</div>`;
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
        const rooms = data.rooms || [];
        renderStreams(rooms);
        hideNotice();
        return rooms;
      }
    } catch (e) {
      console.error('Failed to load live streams:', e);
    }
    if (count) count.textContent = 'Could not connect to live rooms';
    if (list) list.innerHTML = '<div class="live-empty">Live rooms could not be loaded. Please refresh the page.</div>';
    return [];
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
      console.error('Could not pull live chat messages:', error);
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
        ${NV.icon('mic')} ${isHostUser ? 'Microphone active' : 'Audio stream from ' + NV.esc(stream.state)}
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
    isCoHosting = false;
    remoteParticipants.clear();
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
    const flipBtn = NV.$('#flip-cam');
    const cohostBtn = NV.$('#join-cohost');

    if (micBtn) {
      micBtn.hidden = !host;
      micBtn.innerHTML = `${NV.icon('mic')}<span>Mic on</span>`;
      micBtn.style.background = '';
    }
    if (camBtn) {
      camBtn.hidden = !(host && stream.room_type !== 'audio');
      camBtn.innerHTML = `${NV.icon('video')}<span>Camera on</span>`;
      camBtn.style.background = '';
    }
    if (flipBtn) flipBtn.hidden = !(host && stream.room_type !== 'audio');
    if (cohostBtn) {
      cohostBtn.style.display = !host ? '' : 'none';
      cohostBtn.innerHTML = stream.room_type === 'audio'
        ? `${NV.icon('mic')}<span>Join Stage</span>`
        : `${NV.icon('video')}<span>Join Live</span>`;
      cohostBtn.classList.remove('active');
    }
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
            body: JSON.stringify({ uid: tokenData.uid, role: (host || isCoHosting) ? 'publisher' : 'subscriber' })
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

      // Handle multi-participant remote video & audio publishing
      agoraClient.on('user-published', async (remoteUser, mediaType) => {
        try {
          await agoraClient.subscribe(remoteUser, mediaType);
          remoteParticipants.set(remoteUser.uid, remoteUser);
          if (mediaType === 'video' && remoteUser.videoTrack) {
            message.hidden = true;
            const isOwnerBroadcaster = stream.owner_id && remoteUser.uid === stream.owner_id;
            const label = isOwnerBroadcaster
              ? (stream.host_username || 'Host')
              : `Creator ${String(remoteUser.uid).slice(-4)}`;
            addVideoCell(remoteUser.uid, label, remoteUser.videoTrack);
          } else if (mediaType === 'audio' && remoteUser.audioTrack) {
            remoteUser.audioTrack.play();
            if (stream.room_type === 'audio') message.hidden = true;
          }
        } catch (error) {
          console.error('Could not play a live participant track:', error);
          showNotice('A live audio or video track could not be played. Check your connection and browser permissions.');
        }
      });

      agoraClient.on('user-unpublished', (remoteUser, mediaType) => {
        if (mediaType === 'video') {
          removeVideoCell(remoteUser.uid);
          const hasVideoCells = videoContainer.querySelectorAll('.live-cell').length > 0;
          if (!hasVideoCells && !host && !isCoHosting && stream.room_type !== 'audio') {
            message.textContent = 'Broadcaster video paused.';
            message.hidden = false;
          }
        }
      });

      agoraClient.on('user-left', remoteUser => {
        remoteParticipants.delete(remoteUser.uid);
        removeVideoCell(remoteUser.uid);
        const hasVideoCells = videoContainer.querySelectorAll('.live-cell').length > 0;
        if (!hasVideoCells && !host && !isCoHosting) {
          if (stream.room_type === 'audio') renderAudioStage(stream, false);
          message.textContent = 'The broadcaster has disconnected.';
          message.hidden = false;
        }
      });

      await agoraClient.join(tokenData.appId, tokenData.channelName, tokenData.token || null, tokenData.uid);

      if (host) {
        let audioTrack;
        try {
          audioTrack = await window.AgoraRTC.createMicrophoneAudioTrack();
        } catch (audioErr) {
          if (audioErr.name === 'NotAllowedError' || audioErr.code === 'PERMISSION_DENIED') {
            throw new Error('Microphone permission denied. Allow mic access in your browser settings to go live.');
          }
          throw new Error('Microphone access failed: ' + (audioErr.message || 'Check audio input device.'));
        }
        localAgoraTracks = [audioTrack];
        if (stream.room_type !== 'audio') {
          try {
            const videoTrack = await window.AgoraRTC.createCameraVideoTrack();
            localAgoraTracks.push(videoTrack);
          } catch (videoErr) {
            console.warn('Camera initialization failed:', videoErr);
            if (videoErr.name === 'NotAllowedError' || videoErr.code === 'PERMISSION_DENIED') {
              throw new Error('Camera permission denied. Allow camera access in your browser settings to broadcast video.');
            }
            throw new Error('Camera access failed: ' + (videoErr.message || 'Check camera device.'));
          }
        }
        await agoraClient.publish(localAgoraTracks);
        if (stream.room_type === 'audio') {
          renderAudioStage(stream, true);
        } else {
          message.hidden = true;
          const localVid = localAgoraTracks.find(track => track.trackMediaType === 'video');
          addVideoCell('local', 'You (Host)', localVid);
        }
        message.hidden = true;
      } else if (stream.room_type === 'audio') {
        renderAudioStage(stream, false);
      }
      hideNotice();
    } catch (error) {
      console.error('Could not join live room:', error);
      if (agoraClient) {
        try { await agoraClient.leave(); } catch (leaveError) { console.error('Could not leave failed live connection:', leaveError); }
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
          console.error('Could not close live room after broadcast startup failed:', endError);
        }
      }
      let errorMsg = error.message || 'Could not join the live stream.';
      if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        errorMsg = 'Live streaming requires HTTPS on mobile phones. Please access this app over HTTPS.';
      } else if (error.message && (error.message.includes('101') || error.message.includes('CAN_NOT_JOIN_CHANNEL') || error.message.includes('DYNAMIC_KEY'))) {
        errorMsg = 'Agora Live connection failed. Please ensure AGORA_APP_ID and AGORA_APP_CERTIFICATE are set in your Railway environment variables.';
      }
      showNotice(errorMsg);
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
      await fetch(`/api/live/rooms/${encodeURIComponent(stream.id)}/viewer`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewerId: liveViewerId })
      });
    } catch (error) {
      console.error('Could not clear the live viewer presence:', error);
    }

    if (agoraClient) {
      try {
        if (localAgoraTracks.length) {
          await agoraClient.unpublish(localAgoraTracks).catch(() => {});
        }
        await agoraClient.leave();
      } catch (error) {
        console.error('Could not leave the live room:', error);
      }
      agoraClient = null;
    }
    localAgoraTracks.forEach(track => track.close());
    localAgoraTracks = [];
    remoteParticipants.clear();
    isCoHosting = false;

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

  // Co-host toggle handler (allows 2 to 4 users to stream together)
  const cohostBtn = NV.$('#join-cohost');
  if (cohostBtn) {
    cohostBtn.addEventListener('click', async () => {
      if (!currentRoom || !agoraClient) return;
      roomUser = roomUser || await NV.services.auth.getUser();
      if (!roomUser) {
        NV.toast('Please sign in to join live broadcast as a co-host.', 'info');
        NV.router.go('login.html?next=live.html');
        return;
      }

      if (isCoHosting) {
        // Leave co-hosting stage
        try {
          if (localAgoraTracks.length) {
            await agoraClient.unpublish(localAgoraTracks).catch(() => {});
            localAgoraTracks.forEach(t => t.close());
            localAgoraTracks = [];
          }
          removeVideoCell('local');
          await agoraClient.setClientRole('audience');
          isCoHosting = false;
          cohostBtn.innerHTML = currentRoom.room_type === 'audio'
            ? `${NV.icon('mic')}<span>Join Stage</span>`
            : `${NV.icon('video')}<span>Join Live</span>`;
          cohostBtn.classList.remove('active');
          const micBtn = NV.$('#toggle-mic');
          const camBtn = NV.$('#toggle-cam');
          const flipBtn = NV.$('#flip-cam');
          if (micBtn) micBtn.hidden = true;
          if (camBtn) camBtn.hidden = true;
          if (flipBtn) flipBtn.hidden = true;
          NV.toast('You left the broadcast stage.', 'info');
        } catch (err) {
          console.error('Error leaving co-host stage:', err);
          NV.toast('Could not leave stage.', 'error');
        }
        return;
      }

      // Check max broadcasters (support up to 4 users together)
      const currentCellCount = videoContainer.querySelectorAll('.live-cell').length;
      if (currentCellCount >= 4) {
        NV.toast('Maximum 4 broadcasters already live in this room.', 'info');
        return;
      }

      // Start co-hosting
      try {
        cohostBtn.disabled = true;
        NV.toast('Connecting your camera and mic…', 'info');

        // Request publisher token from backend
        const tokenRes = await fetch(`/api/live/rooms/${encodeURIComponent(currentRoom.id)}/token`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'publisher' })
        });
        const tokenData = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok) throw new Error(tokenData.error?.message || 'Could not get broadcast permissions.');

        if (tokenData.token) {
          await agoraClient.renewToken(tokenData.token);
        }
        await agoraClient.setClientRole('host');

        const audioTrack = await window.AgoraRTC.createMicrophoneAudioTrack();
        const tracks = [audioTrack];
        if (currentRoom.room_type !== 'audio') {
          const videoTrack = await window.AgoraRTC.createCameraVideoTrack();
          tracks.push(videoTrack);
        }
        localAgoraTracks = tracks;
        await agoraClient.publish(tracks);

        isCoHosting = true;
        const localVid = tracks.find(t => t.trackMediaType === 'video');
        if (localVid) {
          addVideoCell('local', `You (${roomUser.username || 'Co-Host'})`, localVid);
        }

        cohostBtn.innerHTML = `${NV.icon('userMinus')}<span>Leave Stage</span>`;
        cohostBtn.classList.add('active');

        const micBtn = NV.$('#toggle-mic');
        const camBtn = NV.$('#toggle-cam');
        const flipBtn = NV.$('#flip-cam');
        if (micBtn) { micBtn.hidden = false; micBtn.innerHTML = `${NV.icon('mic')}<span>Mic on</span>`; }
        if (camBtn && currentRoom.room_type !== 'audio') { camBtn.hidden = false; camBtn.innerHTML = `${NV.icon('video')}<span>Camera on</span>`; }
        if (flipBtn && currentRoom.room_type !== 'audio') { flipBtn.hidden = false; }

        NV.toast(`You are now LIVE with @${currentRoom.host_username || 'the host'}! 🎉`, 'success');
      } catch (err) {
        console.error('Co-host join failed:', err);
        let msg = err.message || 'Could not join live.';
        if (err.name === 'NotAllowedError' || err.code === 'PERMISSION_DENIED') {
          msg = 'Camera or microphone permission denied. Check your browser permissions.';
        }
        NV.toast(msg, 'error');
        try { await agoraClient.setClientRole('audience'); } catch (e) {}
      } finally {
        cohostBtn.disabled = false;
        NV.hydrateIcons();
      }
    });
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

  // Broadcaster Flip Camera
  const flipBtn = NV.$('#flip-cam');
  if (flipBtn) {
    flipBtn.addEventListener('click', async () => {
      const track = localAgoraTracks.find(item => item.trackMediaType === 'video');
      if (track) {
        await flipCamera(track);
      } else {
        NV.toast('Camera is not active.', 'info');
      }
    });
  }

  // Share Live Invite Buttons
  const shareBtn = NV.$('#share-live');
  if (shareBtn) shareBtn.addEventListener('click', shareLiveInvite);

  const btnShareLive = NV.$('#btn-share-live');
  if (btnShareLive) btnShareLive.addEventListener('click', shareLiveInvite);

  // Pre-broadcast Preview Flip Button
  const previewFlipBtn = NV.$('#preview-flip-cam');
  if (previewFlipBtn) {
    previewFlipBtn.addEventListener('click', async () => {
      const track = previewTracks?.find(item => item.trackMediaType === 'video');
      if (track) {
        await flipCamera(track);
      }
    });
  }

  // Dialog & Form Handlers
  const startDialog = NV.$('#live-start-dialog');
  const startForm = NV.$('#live-start-form');
  const stateSelect = NV.$('#live-state');
  const roomTypeSelect = NV.$('#live-room-type');

  if (roomTypeSelect) {
    roomTypeSelect.addEventListener('change', () => {
      const previewBox = NV.$('#live-preview-box');
      if (previewBox) {
        previewBox.style.display = roomTypeSelect.value === 'audio' ? 'none' : '';
      }
    });
  }

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
    if (roomTypeSelect?.value !== 'audio') {
      startPreLivePreview();
    }
  });

  NV.$('#cancel-live-start').addEventListener('click', () => {
    stopPreLivePreview();
    startDialog.close();
  });

  startForm.addEventListener('submit', async event => {
    event.preventDefault();
    stopPreLivePreview();

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
      const reaction = btn.dataset.reaction || '❤️';
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

  // Page Initialization & Auto-join room from URL param
  roomUser = await NV.services.auth.getUser();
  const streams = await loadStreams();

  const targetRoomId = NV.param('room');
  if (targetRoomId) {
    const foundStream = streams.find(s => String(s.id) === String(targetRoomId));
    if (foundStream) {
      const isOwner = Boolean(roomUser && foundStream.owner_id === roomUser.id);
      await joinRoom(foundStream, isOwner);
    } else {
      try {
        const res = await fetch(`/api/live/rooms/${encodeURIComponent(targetRoomId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.room) {
            const isOwner = Boolean(roomUser && data.room.owner_id === roomUser.id);
            await joinRoom(data.room, isOwner);
          }
        }
      } catch (err) {
        console.warn('Could not auto-join requested live room:', err);
      }
    }
  }

  streamListTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && !currentRoom) loadStreams();
  }, 15000);
  window.addEventListener('beforeunload', () => clearInterval(streamListTimer), { once: true });
};
