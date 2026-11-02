(() => {
  const canvas = document.getElementById('nebula-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  let stars = [];
  let t = 0;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    stars = Array.from({ length: Math.min(160, Math.floor((w * h) / 14000)) }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      z: Math.random() * 0.9 + 0.1,
      p: Math.random() * Math.PI * 2,
    }));
  }

  function frame() {
    t += 0.004;
    ctx.clearRect(0, 0, w, h);

    const g = ctx.createRadialGradient(w * 0.3, h * 0.2, 0, w * 0.3, h * 0.2, w * 0.55);
    g.addColorStop(0, 'rgba(30, 70, 100, 0.18)');
    g.addColorStop(0.5, 'rgba(20, 40, 70, 0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const g2 = ctx.createRadialGradient(w * 0.75, h * 0.7, 0, w * 0.75, h * 0.7, w * 0.4);
    g2.addColorStop(0, 'rgba(90, 50, 20, 0.12)');
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);

    for (const s of stars) {
      const tw = 0.45 + 0.55 * Math.sin(t * (1.5 + s.z) + s.p);
      const r = s.z * 1.4;
      ctx.beginPath();
      ctx.fillStyle = `rgba(210, 230, 255, ${0.25 + tw * 0.55})`;
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      s.x += 0.02 * s.z;
      if (s.x > w) s.x = 0;
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  resize();
  frame();
})();
