'use client';

import { useEffect, useRef } from 'react';

// Subtle blue vertical code flow + faint data dots / circuit traces.
// Atmosphere only — low opacity, never covers content.
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

    const resize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      columns = Math.floor(width / fontSize) + 1;
      drops = Array.from({ length: columns }, () =>
        Math.random() * -height / fontSize
      );
      ctx.fillStyle = '#050B18';
      ctx.fillRect(0, 0, width, height);
    };

    const rainColors = [
      'rgba(53, 230, 255, 0.40)',
      'rgba(0, 191, 255, 0.32)',
      'rgba(53, 230, 255, 0.26)',
    ];

    const draw = () => {
      // gentle fade → soft trailing tails
      ctx.fillStyle = 'rgba(5, 11, 24, 0.10)';
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
        drops[i] += 0.42;
      }

      // sparse data dots / circuit nodes
      if (Math.random() > 0.6) {
        const dx = Math.random() * width;
        const dy = Math.random() * height;
        ctx.fillStyle = 'rgba(53, 230, 255, 0.14)';
        ctx.beginPath();
        ctx.arc(dx, dy, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const tick = (t: number) => {
      if (t - last > 60) {
        draw();
        last = t;
      }
      raf = requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
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
        opacity: 0.22,
      }}
    />
  );
}
