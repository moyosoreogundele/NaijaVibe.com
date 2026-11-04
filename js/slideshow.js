(() => {
  const initializeSlideshow = hero => {
    const slides = [...hero.querySelectorAll('.slide')];
    const dots = [...hero.querySelectorAll('.dot')];
    if (slides.length < 2 || slides.length !== dots.length) return;

    let activeIndex = slides.findIndex(slide => slide.classList.contains('active'));
    if (activeIndex < 0) activeIndex = 0;

    const showSlide = index => {
      activeIndex = (index + slides.length) % slides.length;
      slides.forEach((slide, i) => {
        const active = i === activeIndex;
        slide.classList.toggle('active', active);
        slide.setAttribute('aria-hidden', String(!active));
        dots[i].classList.toggle('active', active);
        if (active) {
          dots[i].setAttribute('aria-current', 'true');
        } else {
          dots[i].removeAttribute('aria-current');
        }
      });
    };

    let timer;
    const stop = () => window.clearInterval(timer);
    const start = () => {
      stop();
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        timer = window.setInterval(() => showSlide(activeIndex + 1), 5000);
      }
    };

    dots.forEach((dot, index) => {
      dot.addEventListener('click', () => {
        showSlide(index);
        start();
      });
    });
    hero.addEventListener('mouseenter', stop);
    hero.addEventListener('mouseleave', start);
    hero.addEventListener('focusin', stop);
    hero.addEventListener('focusout', start);

    showSlide(activeIndex);
    start();
  };

  const initializeSlideshows = () => {
    document.querySelectorAll('[data-slideshow]').forEach(initializeSlideshow);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSlideshows, { once: true });
  } else {
    initializeSlideshows();
  }
})();
