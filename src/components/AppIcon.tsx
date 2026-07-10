'use client';

import type { ReactNode } from 'react';

type IconProps = {
  size?: number;
  className?: string;
};

// Theme-consistent outline icons. Active/colored state controlled via className
// (parent sets text-cyan-400 for active, text-slate-400/500 for idle).
const common = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
});

export function IconCopy({ size = 16, className }: IconProps) {
  return (
    <svg {...common(size, className)}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

export function IconArchive({ size = 14, className }: IconProps) {
  return (
    <svg {...common(size, className)}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

export function IconKey({ size = 13, className }: IconProps) {
  return (
    <svg {...common(size, className)}>
      <circle cx="8" cy="8" r="4" />
      <line x1="11" y1="11" x2="20" y2="20" />
      <line x1="16" y1="16" x2="19" y2="13" />
    </svg>
  );
}

export function IconCoin({ size = 13, className }: IconProps) {
  return (
    <svg {...common(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.2c0-1.2 1.1-1.8 2.5-1.8s2.5.7 2.5 1.9c0 2.6-5 1.4-5 3.8 0 1.2 1.1 1.9 2.5 1.9s2.5-.6 2.5-1.8" />
    </svg>
  );
}

export function IconSearch({ size = 13, className }: IconProps) {
  return (
    <svg {...common(size, className)}>
      <circle cx="11" cy="11" r="7" />
      <line x1="16" y1="16" x2="21" y2="21" />
    </svg>
  );
}

export function IconCheck({ size = 14, className }: IconProps) {
  return (
    <svg {...common(size, className)}>
      <polyline points="4 12.5 9.5 18 20 6" />
    </svg>
  );
}

export function IconCross({ size = 14, className }: IconProps) {
  return (
    <svg {...common(size, className)}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

export function IconClock({ size = 14, className }: IconProps) {
  return (
    <svg {...common(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </svg>
  );
}

export function IconFlask({ size = 14, className }: IconProps) {
  return (
    <svg {...common(size, className)}>
      <path d="M9 3h6M10 3v6l-5 9a1.5 1.5 0 0 0 1.3 2.2h11.4A1.5 1.5 0 0 0 19 18l-5-9V3" />
      <line x1="7.5" y1="14" x2="16.5" y2="14" />
    </svg>
  );
}

export function IconPencil({ size = 14, className }: IconProps) {
  return (
    <svg {...common(size, className)}>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <line x1="14.5" y1="6.5" x2="17.5" y2="9.5" />
    </svg>
  );
}

export function IconTrash({ size = 14, className }: IconProps) {
  return (
    <svg {...common(size, className)}>
      <polyline points="4 7 20 7" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}

export function IconSync({ size = 13, className }: IconProps) {
  return (
    <svg {...common(size, className)}>
      <polyline points="4 10 4 5 9 5" />
      <path d="M4 5a8 8 0 0 1 14 3" />
      <polyline points="20 14 20 19 15 19" />
      <path d="M20 19a8 8 0 0 1-14-3" />
    </svg>
  );
}

export function IconRoute({ size = 13, className }: IconProps) {
  return (
    <svg {...common(size, className)}>
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <path d="M8.5 19H14a4 4 0 0 0 0-8H10a4 4 0 0 1 0-8h5.5" />
    </svg>
  );
}

export function IconPlus({ size = 14, className }: IconProps) {
  return (
    <svg {...common(size, className)}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function IconWarning({ size = 13, className }: IconProps) {
  return (
    <svg {...common(size, className)}>
      <path d="M12 3l9 16H3l9-16z" />
      <line x1="12" y1="9" x2="12" y2="14" />
      <line x1="12" y1="17" x2="12" y2="17.5" />
    </svg>
  );
}

export function IconPlug({ size = 14, className }: IconProps) {
  return (
    <svg {...common(size, className)}>
      <path d="M9 3v5M15 3v5" />
      <path d="M7 8h10v3a5 5 0 0 1-10 0V8z" />
      <line x1="12" y1="16" x2="12" y2="21" />
    </svg>
  );
}

export function IconChart({ size = 15, className }: IconProps) {
  return (
    <svg {...common(size, className)}>
      <line x1="4" y1="20" x2="20" y2="20" />
      <rect x="6" y="11" width="3" height="6" rx="0.5" />
      <rect x="11" y="7" width="3" height="10" rx="0.5" />
      <rect x="16" y="13" width="3" height="4" rx="0.5" />
    </svg>
  );
}

export function IconSpinner({ size = 16, className }: IconProps) {
  return (
    <svg {...common(size, className)} className={`${className ?? ''} animate-spin`}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

// Spinner used in centered loading + big states
export function IconSpinnerLg({ size = 36, className }: IconProps) {
  return (
    <svg {...common(size, className)} className={`${className ?? ''} animate-spin`}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}
