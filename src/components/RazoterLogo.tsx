'use client';

// Geometric "R" monogram built from circuit lines + node, inside a rounded square.
// Cyan→electric-blue gradient with a magenta accent node on one corner.
export default function RazoterLogo({ size = 42 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="Razoter"
      style={{ filter: 'drop-shadow(0 0 6px rgba(53,230,255,0.45))' }}
    >
      <defs>
        <linearGradient id="rz-grad" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#35E6FF" />
          <stop offset="1" stopColor="#0077A3" />
        </linearGradient>
        <linearGradient id="rz-mag" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#FF7AC4" />
          <stop offset="1" stopColor="#FF2D95" />
        </linearGradient>
      </defs>

      {/* rounded-square frame */}
      <rect x="3" y="3" width="42" height="42" rx="12" stroke="url(#rz-grad)" strokeWidth="1.6" fill="rgba(8,20,38,0.55)" />
      <rect x="3" y="3" width="42" height="42" rx="12" stroke="rgba(53,230,255,0.12)" strokeWidth="1" />

      {/* R monogram: spine + bowl + leg */}
      <g stroke="url(#rz-grad)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* spine */}
        <line x1="16" y1="13" x2="16" y2="35" />
        {/* bowl */}
        <path d="M16 13 H26 a6 6 0 0 1 0 12 H16" />
        {/* leg */}
        <path d="M22 25 L31 35" />
      </g>

      {/* circuit node accents */}
      <circle cx="16" cy="13" r="1.8" fill="url(#rz-grad)" />
      <circle cx="31" cy="35" r="1.6" fill="url(#rz-grad)" />
      {/* magenta accent corner node */}
      <circle cx="38" cy="11" r="2.4" fill="url(#rz-mag)" />
      <line x1="38" y1="13.4" x2="38" y2="20" stroke="url(#rz-mag)" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
