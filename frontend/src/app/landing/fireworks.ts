/**
 * Lightweight canvas fireworks for the launch reveal: shells rise, burst into
 * particles with gravity and fade. No dependency. Returns a stop function.
 */
const PALETTE = ["#ffd600", "#ffef9e", "#ffffff", "#e5397d", "#ff6a13", "#d92128"];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  color: string;
}

export function startFireworks(canvas: HTMLCanvasElement, durationMs: number): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0;
  let height = 0;
  const resize = (): void => {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);

  const particles: Particle[] = [];
  const burst = (x: number, y: number): void => {
    const colors = [PALETTE[Math.floor(Math.random() * PALETTE.length)], PALETTE[Math.floor(Math.random() * PALETTE.length)]];
    const count = width < 600 ? 55 : 90;
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.1;
      const speed = (width < 600 ? 1.6 : 2.4) * (0.5 + Math.random());
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        ttl: 60 + Math.random() * 40,
        color: colors[i % 2],
      });
    }
  };

  const start = performance.now();
  let lastLaunch = -Infinity;
  let raf = 0;
  let stopped = false;

  const frame = (now: number): void => {
    if (stopped) return;
    const elapsed = now - start;
    // Stop launching 1.2s before the end so the last bursts can fade out.
    if (elapsed < durationMs - 1200 && now - lastLaunch > 380 + Math.random() * 300) {
      lastLaunch = now;
      burst(width * (0.12 + Math.random() * 0.76), height * (0.14 + Math.random() * 0.4));
    }
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "lighter";
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.life += 1;
      p.vy += 0.035;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      if (p.life >= p.ttl) {
        particles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = 1 - p.life / p.ttl;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (elapsed < durationMs || particles.length) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    ctx.clearRect(0, 0, width, height);
  };
}
