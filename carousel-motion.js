/* Opening Frame screening-room motion. Each poster stays an independent DOM card. */
(() => {
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const wrap = (value, count) => ((value % count) + count) % count;

  function createOpeningFrameCarousel({ container, cards, initialIndex = 0, onSelect = () => {}, onActivate = () => {} }) {
    if (!container) throw new Error('Opening Frame carousel needs a container');
    const items = Array.from(cards || container.querySelectorAll('.hero-card[data-hero-index]'))
      .sort((a, b) => Number(a.dataset.heroIndex) - Number(b.dataset.heroIndex));
    if (items.length < 2) throw new Error('Opening Frame carousel needs at least two cards');

    const count = items.length;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const hero = container.closest('#top') || container;
    let reduced = media.matches;
    let position = wrap(initialIndex, count);
    let target = position;
    let velocity = 0;
    let activeIndex = wrap(initialIndex, count);
    let pendingSelection = null;
    let travelSource = 'manual';
    let hoverIndex = -1;
    let hoverX = 0;
    let hoverY = 0;
    let drag = null;
    let hoverTimer = 0;
    let stopVideoTimer = 0;
    let previewCard = null;
    let lastTime = 0;
    let lastAction = performance.now();
    let raf = 0;
    let destroyed = false;
    let inView = true;
    let pointerInside = false;
    let focusInside = false;
    let wheelAt = 0;
    let wheelBuffer = 0;
    let suppressClickUntil = 0;
    const pauses = new Set();
    const cleanups = [];

    const listen = (element, type, handler, options) => {
      element.addEventListener(type, handler, options);
      cleanups.push(() => element.removeEventListener(type, handler, options));
    };
    const stride = () => clamp(container.clientWidth * (container.clientWidth < 650 ? 0.31 : 0.17), 112, 225);
    const touch = () => { lastAction = performance.now(); };

    function stopHoverVideo() {
      clearTimeout(hoverTimer);
      if (!previewCard) return;
      const former = previewCard;
      const video = former.querySelector('video[data-hover-video]');
      former.classList.remove('is-teasing');
      if (video) {
        video.style.opacity = '0';
        clearTimeout(stopVideoTimer);
        stopVideoTimer = setTimeout(() => {
          video.pause();
          try { video.currentTime = 0; } catch (_) { /* No decoded frame yet. */ }
        }, reduced ? 0 : 380);
      }
      previewCard = null;
    }

    function scheduleHoverVideo(index) {
      stopHoverVideo();
      if (reduced || drag || index < 0) return;
      const card = items[index];
      const video = card.querySelector('video[data-hover-video]');
      if (!video) return;
      hoverTimer = setTimeout(async () => {
        if (destroyed || drag || hoverIndex !== index || document.hidden) return;
        previewCard = card;
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        video.loop = true;
        video.preload = 'metadata';
        video.style.position = 'absolute';
        video.style.inset = '0';
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'cover';
        video.style.pointerEvents = 'none';
        video.style.zIndex = '1';
        video.style.transition = 'opacity 420ms cubic-bezier(.2,.7,.2,1)';
        if (!video.getAttribute('src') && video.dataset.src) video.src = video.dataset.src;
        if (!video.getAttribute('src') && !video.querySelector('source')) return;
        try {
          await video.play();
          if (previewCard !== card || hoverIndex !== index) { video.pause(); return; }
          card.classList.add('is-teasing');
          video.style.opacity = '1';
        } catch (_) { /* Muted preview can fail under browser power policies. */ }
      }, 430);
    }

    function trackFor(index, direction = 0) {
      const base = wrap(index, count);
      let delta = wrap(base - target + count / 2, count) - count / 2;
      if (direction > 0 && delta <= 0) delta += count;
      if (direction < 0 && delta >= 0) delta -= count;
      return target + delta;
    }

    function selectTrack(nextTrack, source = 'manual', notify = true) {
      target = nextTrack;
      travelSource = source;
      const next = wrap(Math.round(target), count);
      pendingSelection = null;
      if (next !== activeIndex) {
        activeIndex = next;
        if (notify) pendingSelection = { index: next, source };
      }
      if (source !== 'idle') touch();
      stopHoverVideo();
      return next;
    }

    function setIndex(index, { direction = 0, source = 'external', notify = true } = {}) {
      if (!Number.isInteger(index)) return activeIndex;
      return selectTrack(trackFor(index, direction), source, notify);
    }
    const next = (source = 'manual') => selectTrack(Math.round(target) + 1, source);
    const previous = (source = 'manual') => selectTrack(Math.round(target) - 1, source);

    function render(now) {
      if (destroyed) return;
      const dt = Math.min(Math.max((now - (lastTime || now)) / 1000, 0), 0.05);
      lastTime = now;

      if (reduced) {
        position = target;
        velocity = 0;
      } else {
        // A damped physical spring stays interruptible through a drag or a new selection.
        if (drag?.moved) {
          // The poster stack follows the finger exactly; only release has spring travel.
          position = target;
          velocity = 0;
        } else {
          const stiffness = travelSource === 'idle' ? 32 : 95;
          const damping = travelSource === 'idle' ? 10 : 18;
          velocity += (target - position) * stiffness * dt;
          velocity *= Math.exp(-damping * dt);
          position += velocity * dt;
        }
        if (Math.abs(target - position) < 0.0005 && Math.abs(velocity) < 0.001) {
          position = target;
          velocity = 0;
        }
      }

      const visualIndex = wrap(Math.round(position), count);
      if (pendingSelection && visualIndex === pendingSelection.index) {
        const selection = pendingSelection;
        pendingSelection = null;
        onSelect(selection.index, selection.source);
      }

      const spacing = stride();
      const mobile = container.clientWidth < 650;
      items.forEach((card, index) => {
        let offset = wrap(index - position + count / 2, count) - count / 2;
        const distance = Math.abs(offset);
        const hidden = distance > Math.min(4.65, count / 2 - 0.15);
        const hovered = index === hoverIndex && !drag;
        const lift = hovered ? 14 : 0;
        const drift = reduced || drag ? 0 : Math.sin(now * 0.00052 + index * 1.67) * 3;
        const scale = (1.18 - Math.min(distance, 4.5) * (mobile ? 0.115 : 0.09)) * (hovered ? 1.025 : 1);
        const x = offset * spacing * (1 - Math.min(distance, 4) * 0.024);
        const y = distance * (mobile ? 8 : 13) + distance * distance * 2 + drift - lift;
        const z = 155 - distance * 47 + (hovered ? 35 : 0);
        const bank = -offset * (mobile ? 1.2 : 1.65);
        const yaw = -offset * (mobile ? 6 : 8) + (hovered ? hoverX * 6 : 0);
        const pitch = hovered ? -hoverY * 5 : 0;
        const opacity = hidden ? 0 : clamp((4.8 - distance) * 1.7, 0, 1);
        card.style.left = '50%';
        card.style.top = mobile ? '43%' : '45%';
        card.style.transform = `translate3d(-50%, -50%, 0) translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px) rotateX(${pitch.toFixed(2)}deg) rotateY(${yaw.toFixed(2)}deg) rotateZ(${bank.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
        card.style.transition = 'none';
        card.style.filter = `brightness(${clamp(1 - distance * 0.105 + (hovered ? 0.13 : 0), 0.52, 1.15).toFixed(3)})`;
        card.style.opacity = opacity.toFixed(3);
        card.style.zIndex = String(100 - Math.round(distance * 10) + (hovered ? 5 : 0));
        card.style.pointerEvents = hidden ? 'none' : 'auto';
        card.style.setProperty('--card-glint-x', `${(50 + hoverX * 33).toFixed(1)}%`);
        card.style.setProperty('--card-glint-y', `${(50 + hoverY * 33).toFixed(1)}%`);
        card.classList.toggle('active', index === visualIndex);
        card.setAttribute('aria-pressed', String(index === visualIndex));
        card.tabIndex = hidden ? -1 : 0;
      });

      if (!reduced && inView && !pointerInside && !focusInside && !drag && !document.hidden && !pauses.size && now - lastAction > 13500) {
        next('idle');
        lastAction = now;
      }
      raf = requestAnimationFrame(render);
    }

    items.forEach((card, index) => {
      const video = card.querySelector('video[data-hover-video]');
      if (video) {
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        video.style.position = 'absolute';
        video.style.inset = '0';
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'cover';
        video.style.zIndex = '1';
        video.style.transition = 'opacity 420ms cubic-bezier(.2,.7,.2,1)';
        video.style.opacity = '0';
        video.style.pointerEvents = 'none';
      }
      listen(card, 'pointerenter', event => {
        if (event.pointerType === 'touch' || drag) return;
        pointerInside = true;
        hoverIndex = index;
        scheduleHoverVideo(index);
        touch();
      });
      listen(card, 'pointermove', event => {
        if (event.pointerType === 'touch' || drag) return;
        const bounds = card.getBoundingClientRect();
        hoverX = clamp((event.clientX - bounds.left) / bounds.width * 2 - 1, -1, 1);
        hoverY = clamp((event.clientY - bounds.top) / bounds.height * 2 - 1, -1, 1);
      });
      listen(card, 'pointerleave', () => {
        if (hoverIndex === index) {
          hoverIndex = -1;
          hoverX = hoverY = 0;
          stopHoverVideo();
        }
      });
    });

    listen(container, 'pointerenter', event => { if (event.pointerType !== 'touch') pointerInside = true; });
    listen(container, 'pointerleave', () => {
      pointerInside = false;
      hoverIndex = -1;
      hoverX = hoverY = 0;
      stopHoverVideo();
      touch();
    });
    listen(container, 'pointerdown', event => {
      if (event.button !== 0 || event.isPrimary === false) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: target,
        moved: false, samples: [{ x: event.clientX, t: performance.now() }] };
      touch();
    });
    listen(container, 'pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) < 8) return;
      if (!drag.moved && Math.abs(dy) > Math.abs(dx) * 1.35) { drag = null; return; }
      if (!drag.moved) {
        drag.moved = true;
        container.classList.add('dragging');
        container.setPointerCapture(event.pointerId);
        stopHoverVideo();
        hoverIndex = -1;
        hoverX = hoverY = 0;
      }
      event.preventDefault();
      target = drag.start - dx / stride();
      position = target;
      velocity = 0;
      const now = performance.now();
      drag.samples.push({ x: event.clientX, t: now });
      while (drag.samples.length > 2 && now - drag.samples[0].t > 100) drag.samples.shift();
    }, { passive: false });
    const endDrag = event => {
      if (!drag || event.pointerId !== drag.id) return;
      if (drag.moved) {
        const samples = drag.samples;
        const first = samples[0];
        const last = samples[samples.length - 1];
        const pxPerMs = (last.x - first.x) / Math.max(16, last.t - first.t);
        const carry = clamp(-pxPerMs * 120 / stride(), -0.42, 0.42);
        const finish = Math.round(clamp(target + carry, drag.start - 2, drag.start + 2));
        selectTrack(finish, 'drag');
        suppressClickUntil = performance.now() + 400;
        if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
      }
      container.classList.remove('dragging');
      drag = null;
      touch();
    };
    listen(container, 'pointerup', endDrag);
    listen(container, 'pointercancel', endDrag);
    listen(container, 'lostpointercapture', event => {
      if (drag && event.pointerId === drag.id) { drag = null; container.classList.remove('dragging'); }
    });
    listen(container, 'click', event => {
      if (performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const card = event.target.closest('.hero-card[data-hero-index]');
      if (!card || !container.contains(card)) return;
      const index = Number(card.dataset.heroIndex);
      touch();
      if (index === activeIndex) onActivate(index);
      else setIndex(index, { source: 'card' });
    }, true);
    listen(container, 'wheel', event => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.2) return;
      event.preventDefault();
      wheelBuffer += event.deltaX;
      const now = performance.now();
      if (Math.abs(wheelBuffer) < 28 || now - wheelAt < 220) return;
      const direction = Math.sign(wheelBuffer);
      wheelBuffer = 0;
      wheelAt = now;
      direction > 0 ? next('wheel') : previous('wheel');
    }, { passive: false });
    listen(container, 'focusin', () => { focusInside = true; touch(); });
    listen(container, 'focusout', event => {
      if (!container.contains(event.relatedTarget)) { focusInside = false; touch(); }
    });
    listen(hero, 'keydown', event => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); next('keyboard'); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); previous('keyboard'); }
      else if (event.key === 'Home') { event.preventDefault(); setIndex(0, { source: 'keyboard' }); }
      else if (event.key === 'End') { event.preventDefault(); setIndex(count - 1, { source: 'keyboard' }); }
      else if (event.key === 'Enter' && event.target === hero) { event.preventDefault(); onActivate(activeIndex); }
    });
    listen(document, 'visibilitychange', () => { if (document.hidden) stopHoverVideo(); touch(); });
    const onMotionChange = event => {
      reduced = event.matches;
      if (reduced) stopHoverVideo();
      touch();
    };
    media.addEventListener('change', onMotionChange);
    cleanups.push(() => media.removeEventListener('change', onMotionChange));
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      inView = entries[0]?.isIntersecting ?? true;
      if (!inView) stopHoverVideo();
    }, { threshold: 0.15 }) : null;
    observer?.observe(hero);
    cleanups.push(() => observer?.disconnect());

    raf = requestAnimationFrame(render);
    return {
      getIndex: () => activeIndex,
      setIndex,
      next,
      previous,
      pause: reason => { pauses.add(reason || 'manual'); stopHoverVideo(); },
      resume: reason => { pauses.delete(reason || 'manual'); touch(); },
      destroy: () => {
        destroyed = true;
        cancelAnimationFrame(raf);
        stopHoverVideo();
        clearTimeout(stopVideoTimer);
        for (const cleanup of cleanups) cleanup();
      },
    };
  }

  window.createOpeningFrameCarousel = createOpeningFrameCarousel;
})();
