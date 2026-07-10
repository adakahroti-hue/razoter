'use client';

import { useEffect, useRef } from 'react';

// Subtle blue "digital rain" rendered behind the whole app.
// Glyphs: binary + katakana + code symbols, low opacity, slow fall.
const GLYPHS =
  '01ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ<>{}[]#$%&*+=/\\|ABCDEF0123456789';

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
      ctx.fillStyle = '#05070f';
      ctx.fillRect(0, 0, width, height);
    };

    const colors = [
      'rgba(34,211,238,0.55)',
      'rgba(56,189,248,0.42)',
      'rgba(59,130,246,0.38)',
    ];

    const draw = () => {
      // fade previous frame to leave a soft trailing tail
      ctx.fillStyle = 'rgba(5,7,15,0.09)';
      ctx.fillRect(0, 0, width, height);
      ctx.font = `${fontSize}px 'JetBrains Mono', ui-monospace, monospace`;
      ctx.textBaseline = 'top';
      for (let i = 0; i < columns; i++) {
        const ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        const x = i * fontSize;
        const y = drops[i] * fontSize;
        ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
        ctx.fillText(ch, x, y);
        if (y > height && Math.random() > 0.975) drops[i] = 0;
        drops[i] += 0.45; // slow / subtle
      }
    };

    const tick = (t: number) => {
      if (t - last > 55) {
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
        opacity: 0.32,
      }}
    />
  );
}
