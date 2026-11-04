(function (NV) {
  NV.services.uploads = {
    async upload(file, folder = 'posts') {
      if (!file) return null;
      const video = file.type.startsWith('video/');
      const allowedTypes = video
        ? ['video/mp4', 'video/webm', 'video/ogg']
        : ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowedTypes.includes(file.type)) throw new Error('Choose a JPEG, PNG, WebP, GIF, MP4, WebM, or Ogg file.');
      const maxBytes = video ? 25 * 1024 * 1024 : 5 * 1024 * 1024;
      if (file.size > maxBytes) throw new Error(video ? 'Video must be under 25 MB.' : 'Image must be under 5 MB.');
      if (NV.live) {
        const path = `${folder}/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`;
        const { error } = await NV.db.storage.from(NV_CONFIG.STORAGE_BUCKET).upload(path, file);
        if (error) throw error;
        return NV.db.storage.from(NV_CONFIG.STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
      }
      const response = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        credentials: 'same-origin',
        body: file
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error && result.error.message || 'The media upload failed.');
      if (typeof result.url !== 'string' || !result.url.startsWith('/media/')) {
        throw new Error('The media service returned an invalid file URL.');
      }
      return result.url;
    }
  };
})(window.NV);
