'use client';

import { useEffect, useRef } from 'react';

// Subtle blue vertical code flow + faint data dots / circuit traces.
// Atmosphere only — very low opacity, brighter in empty areas, never over content.
const GLYPHS = '01<>{}[]#$%&*+=/\\|ABCDEF0123456789ｱｲｳｴｵｶｷｸｹｺ';

export default function CyberBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const fontSize = 14;
    let width = 0;
    let height = 0;
    let columns = 0;
    let drops: number[] = [];
    let raf = 0;
    let last = 0;
    let running = false;

    // Respect "reduce motion" accessibility pref: keep static grid, no rain loop.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const start = () => {
      if (running || reduceMotion) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(tick);
    };

    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const resize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      columns = Math.floor(width / fontSize) + 1;
      drops = Array.from({ length: columns }, () =>
        Math.random() * -height / fontSize
      );
      ctx.fillStyle = '#050B18';
      ctx.fillRect(0, 0, width, height);

      // static faint circuit traces + perspective grid
      ctx.strokeStyle = 'rgba(53, 230, 255, 0.05)';
      ctx.lineWidth = 1;
      const step = 90;
      for (let x = 0; x < width; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (x - width / 2) * 0.12, height);
        ctx.stroke();
      }
      for (let y = height; y > 0; y -= step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y + (y < height / 2 ? -20 : 20));
        ctx.stroke();
      }
      // sparse node dots
      ctx.fillStyle = 'rgba(53, 230, 255, 0.10)';
      for (let i = 0; i < (width * height) / 26000; i++) {
        ctx.beginPath();
        ctx.arc(Math.random() * width, Math.random() * height, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const rainColors = [
      'rgba(53, 230, 255, 0.34)',
      'rgba(0, 191, 255, 0.28)',
      'rgba(53, 230, 255, 0.22)',
    ];

    const draw = () => {
      ctx.fillStyle = 'rgba(5, 11, 24, 0.11)';
      ctx.fillRect(0, 0, width, height);

      ctx.font = `${fontSize}px 'JetBrains Mono', ui-monospace, monospace`;
      ctx.textBaseline = 'top';
      for (let i = 0; i < columns; i++) {
        const ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        const x = i * fontSize;
        const y = drops[i] * fontSize;
        ctx.fillStyle = rainColors[(Math.random() * rainColors.length) | 0];
        ctx.fillText(ch, x, y);
        if (y > height && Math.random() > 0.975) drops[i] = 0;
        drops[i] += 0.4;
      }
    };

    const tick = (t: number) => {
      if (!running) return;
      if (t - last > 62) {
        draw();
        last = t;
      }
      raf = requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener('resize', resize);
    // Pause rain while tab is hidden (saves CPU/battery); resume when visible.
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    start();

    return () => {
      stop();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: -10,
        pointerEvents: 'none',
        opacity: 0.2,
      }}
    />
  );
}
