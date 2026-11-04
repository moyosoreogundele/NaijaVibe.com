(function (NV) {
  const cache = new Map();
  const ATTRIBUTION_TEXT = 'Wikimedia Commons';

  function readCache(key) {
    try {
      const value = sessionStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.warn('Could not read cached photo metadata:', error);
      return null;
    }
  }

  function writeCache(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn('Could not cache photo metadata:', error);
    }
  }

  function plainText(value) {
    const element = document.createElement('div');
    element.innerHTML = value || '';
    return element.textContent.trim();
  }

  async function findCommonsImage(query) {
    const cacheKey = `nv:commons:${query.toLowerCase()}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const stored = readCache(cacheKey);
    if (stored) {
      cache.set(cacheKey, Promise.resolve(stored));
      return stored;
    }

    const pending = (async () => {
      const params = new URLSearchParams({
        action: 'query',
        generator: 'search',
        gsrsearch: query,
        gsrnamespace: '6',
        gsrlimit: '1',
        prop: 'imageinfo',
        iiprop: 'url|extmetadata',
        iiurlwidth: '1200',
        format: 'json',
        origin: '*'
      });
      const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error(`Wikimedia Commons returned HTTP ${response.status}.`);
      const result = await response.json();
      const page = Object.values(result.query?.pages || {})[0];
      const image = page?.imageinfo?.[0];
      if (!image?.thumburl || !image?.descriptionurl) return null;
      const imageUrl = new URL(image.thumburl);
      const sourceUrl = new URL(image.descriptionurl);
      if (imageUrl.protocol !== 'https:' || sourceUrl.protocol !== 'https:') return null;
      const metadata = image.extmetadata || {};
      const photo = {
        url: imageUrl.toString(),
        sourceUrl: sourceUrl.toString(),
        artist: plainText(metadata.Artist?.value),
        license: plainText(metadata.LicenseShortName?.value)
      };
      writeCache(cacheKey, photo);
      return photo;
    })();
    cache.set(cacheKey, pending);
    try {
      return await pending;
    } catch (error) {
      cache.delete(cacheKey);
      console.warn(`Could not load a Commons photo for "${query}":`, error);
      return null;
    }
  }

  async function findStateImage(capital, stateName) {
    return await findCommonsImage(capital) || await findCommonsImage(`${stateName} Nigeria`);
  }

  function applyPhotoCredit(link, photo) {
    if (!link || !photo) return;
    link.href = photo.sourceUrl;
    link.textContent = photo.artist
      ? `Photo: ${photo.artist}${photo.license ? ` · ${photo.license}` : ''}`
      : ATTRIBUTION_TEXT;
    link.hidden = false;
  }

  function setupLazyImages(root) {
    const cards = [...root.querySelectorAll('[data-image-query]')].filter(card => card.dataset.imageLoading !== 'true');
    const load = async card => {
      card.dataset.imageLoading = 'true';
      const photo = await findCommonsImage(card.dataset.imageQuery)
        || (card.dataset.imageFallback ? await findCommonsImage(card.dataset.imageFallback) : null);
      if (!photo) return;
      if (card instanceof HTMLImageElement) card.src = photo.url;
      else card.style.backgroundImage = `url("${photo.url.replace(/["\\]/g, '')}")`;
      const credit = card.querySelector('[data-photo-credit]') || card.parentElement?.querySelector(':scope > [data-photo-credit]');
      applyPhotoCredit(credit, photo);
    };
    if (!('IntersectionObserver' in window)) {
      cards.forEach(card => { load(card); });
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        load(entry.target);
      });
    }, { rootMargin: '250px' });
    cards.forEach(card => observer.observe(card));
  }

  function setupLazyStateImages(root) {
    setupLazyImages(root);
  }

  function setupSlideshowImages(root) {
    root.querySelectorAll('[data-wiki-image]').forEach(async slide => {
      const photo = await findCommonsImage(slide.dataset.wikiImage);
      if (!photo) return;
      slide.style.backgroundImage = `url("${photo.url.replace(/["\\]/g, '')}")`;
      applyPhotoCredit(slide.querySelector('[data-photo-credit]'), photo);
    });
  }

  NV.services.images = { findCommonsImage, findStateImage, setupLazyImages, setupLazyStateImages, setupSlideshowImages };
})(window.NV);
