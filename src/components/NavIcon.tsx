'use client';

import type { ReactNode } from 'react';

type IconProps = {
  active?: boolean;
  size?: number;
};

const common = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

function ProvidersIcon({ active, size = 18 }: IconProps) {
  // server stack / nodes
  return (
    <svg {...common(size)} className={active ? 'text-cyan-400 drop-shadow-[0_0_4px_rgba(53,230,255,0.7)]' : 'text-slate-400'}>
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <line x1="7" y1="7" x2="7" y2="7" />
      <line x1="7" y1="17" x2="7" y2="17" />
      <line x1="12" y1="10" x2="12" y2="14" />
    </svg>
  );
}

function CombosIcon({ active, size = 18 }: IconProps) {
  // layers / workflow connection
  return (
    <svg {...common(size)} className={active ? 'text-cyan-400 drop-shadow-[0_0_4px_rgba(53,230,255,0.7)]' : 'text-slate-400'}>
      <polygon points="12 3 21 8 12 13 3 8 12 3" />
      <polyline points="3 13 12 18 21 13" />
      <line x1="12" y1="13" x2="12" y2="18" />
    </svg>
  );
}

function LogsIcon({ active, size = 18 }: IconProps) {
  // terminal window
  return (
    <svg {...common(size)} className={active ? 'text-cyan-400 drop-shadow-[0_0_4px_rgba(53,230,255,0.7)]' : 'text-slate-400'}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3" />
      <line x1="13" y1="15" x2="17" y2="15" />
    </svg>
  );
}

function SettingsIcon({ active, size = 18 }: IconProps) {
  // sliders horizontal
  return (
    <svg {...common(size)} className={active ? 'text-cyan-400 drop-shadow-[0_0_4px_rgba(53,230,255,0.7)]' : 'text-slate-400'}>
      <line x1="4" y1="8" x2="20" y2="8" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="9" cy="8" r="2.2" />
      <circle cx="15" cy="16" r="2.2" />
    </svg>
  );
}

export function NavIcon({ name, active, size }: { name: string; active?: boolean; size?: number }): ReactNode {
  switch (name) {
    case 'providers': return <ProvidersIcon active={active} size={size} />;
    case 'combos': return <CombosIcon active={active} size={size} />;
    case 'logs': return <LogsIcon active={active} size={size} />;
    case 'settings': return <SettingsIcon active={active} size={size} />;
    default: return null;
  }
}
