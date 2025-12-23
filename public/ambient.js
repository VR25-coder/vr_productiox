(function () {
  // Respect reduced-motion
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  } catch {
    // ignore
  }

  const canvas = document.getElementById('ambient-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const state = {
    dpr: 1,
    w: 0,
    h: 0,
    raf: 0,
    particles: [],
    pointer: { x: null, y: null },
  };

  function resize() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    state.dpr = dpr;
    state.w = Math.floor(window.innerWidth);
    state.h = Math.floor(window.innerHeight);
    canvas.width = Math.floor(state.w * dpr);
    canvas.height = Math.floor(state.h * dpr);
    canvas.style.width = state.w + 'px';
    canvas.style.height = state.h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function createParticles() {
    const count = Math.max(28, Math.min(70, Math.floor((state.w * state.h) / 34000)));
    state.particles = Array.from({ length: count }, () => ({
      x: rand(0, state.w),
      y: rand(0, state.h),
      vx: rand(-0.25, 0.25),
      vy: rand(-0.25, 0.25),
      r: rand(0.9, 2.2),
    }));
  }

  function step() {
    ctx.clearRect(0, 0, state.w, state.h);

    // Background fade (very subtle)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.fillRect(0, 0, state.w, state.h);

    const maxDist = 120;

    // Move particles
    for (const p of state.particles) {
      p.x += p.vx;
      p.y += p.vy;

      // Gentle attraction to pointer
      if (state.pointer.x != null && state.pointer.y != null) {
        const dx = state.pointer.x - p.x;
        const dy = state.pointer.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < 220) {
          p.x += (dx / dist) * 0.06;
          p.y += (dy / dist) * 0.06;
        }
      }

      // Wrap
      if (p.x < -20) p.x = state.w + 20;
      if (p.x > state.w + 20) p.x = -20;
      if (p.y < -20) p.y = state.h + 20;
      if (p.y > state.h + 20) p.y = -20;
    }

    // Draw connections
    for (let i = 0; i < state.particles.length; i++) {
      const a = state.particles[i];
      for (let j = i + 1; j < state.particles.length; j++) {
        const b = state.particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxDist) continue;
        const alpha = 1 - dist / maxDist;
        ctx.strokeStyle = `rgba(124, 58, 237, ${0.11 * alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Draw particles
    for (const p of state.particles) {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.55)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    state.raf = requestAnimationFrame(step);
  }

  function onPointerMove(e) {
    state.pointer.x = e.clientX;
    state.pointer.y = e.clientY;
  }

  function onPointerLeave() {
    state.pointer.x = null;
    state.pointer.y = null;
  }

  resize();
  createParticles();
  step();

  window.addEventListener('resize', () => {
    resize();
    createParticles();
  }, { passive: true });

  window.addEventListener('mousemove', onPointerMove, { passive: true });
  window.addEventListener('mouseleave', onPointerLeave, { passive: true });
})();
