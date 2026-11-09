NV.pages['create-post'] = function () {
  NV.router.requireAuth();
  const f = NV.$('#post-form'), video = NV.$('#video-url'), socialVideo = NV.$('#social-video-url'), videoFile = NV.$('#video-file');
  let videoUploadUrl = null;
  NV.validate.bind(f);
  NV.$('#state').innerHTML = '<option value="">Choose a state</option>' + window.NV_STATES.map(s => `<option>${NV.esc(s.name)}</option>`).join('');
  videoFile.addEventListener('change', async () => {
    try {
      videoUploadUrl = await NV.services.uploads.upload(videoFile.files[0]);
      video.disabled = Boolean(videoUploadUrl);
      socialVideo.disabled = Boolean(videoUploadUrl);
      if (videoUploadUrl) NV.toast('Video uploaded and ready to share.', 'success');
    } catch (error) {
      videoFile.value = '';
      videoUploadUrl = null;
      video.disabled = false;
      socialVideo.disabled = false;
      NV.toast(error.message || 'The video could not be uploaded.', 'error');
    }
  });
  f.addEventListener('submit', async e => {
    e.preventDefault(); if (!NV.validate.form(f)) return;
    let videoUrl = videoUploadUrl || '';
    if (!videoUrl && video.value.trim()) {
      try {
        const parsed = new URL(video.value.trim());
        if (parsed.protocol !== 'https:' || !/\.(mp4|webm|ogg)$/i.test(parsed.pathname)) throw new Error('Use a direct HTTPS link to an MP4, WebM, or Ogg video.');
        videoUrl = parsed.toString();
      } catch (error) {
        NV.toast(error.message || 'Enter a valid video URL.', 'error');
        return;
      }
    }
    const externalVideoUrl = socialVideo.value.trim();
    if (videoUrl && externalVideoUrl) {
      NV.toast('Choose either a direct/uploaded video or a social video link.', 'error');
      return;
    }
    if (externalVideoUrl) {
      try {
        const parsed = new URL(externalVideoUrl);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Use a public HTTPS social video link.');
      } catch (error) {
        NV.toast(error.message || 'Enter a valid social video link.', 'error');
        return;
      }
    }
    if (!videoUrl && !externalVideoUrl) {
      NV.toast('Choose a video file or add a video link before sharing.', 'error');
      return;
    }
    try { await NV.services.posts.create({ title: f.elements.title.value.trim(), body: f.body.value.trim(), category: 'culture', state: f.state.value, image_url: null, video_url: videoUrl || null, external_video_url: externalVideoUrl || null }); NV.toast('Video shared successfully.', 'success'); setTimeout(() => NV.router.go('videos.html'), 700); }
    catch (err) { NV.toast(err.message || 'Could not publish. Try again.', 'error'); }
  });
};
