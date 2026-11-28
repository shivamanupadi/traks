import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';

/**
 * Sticker icons: hand-drawn style on a 48 grid, an ink outline (currentColor)
 * over soft two-tone fills in the Porcelain palette. Drawn for ~20px, where
 * the 2.4 stroke lands near 1px. Used by the site header; Lucide stays for
 * small utility marks (chevrons, check, x).
 */
export type StickerName =
  | 'back'
  | 'code'
  | 'bookmark'
  | 'share'
  | 'settings'
  | 'refresh'
  | 'more'
  | 'calendar';

const S = {
  stroke: 'currentColor',
  strokeWidth: 2.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const MINT = '#28E99F';
const MINT_TINT = 'var(--mint-soft)';
const CORAL_TINT = 'var(--coral-soft)';
const WARM = 'var(--muted)';

const ART: Record<StickerName, ReactElement> = {
  back: <path d="M30 12 18 24l12 12" fill="none" {...S} />,
  code: (
    <>
      <rect x="6" y="9" width="36" height="30" rx="9" fill={WARM} {...S} />
      <path d="m18 19-6 5 6 5M30 19l6 5-6 5" fill="none" {...S} />
      <path d="m26.5 16-5 16" fill="none" {...S} stroke="#12A06B" />
    </>
  ),
  bookmark: (
    <>
      <path d="M14 7h20a3 3 0 0 1 3 3v31l-13-8-13 8V10a3 3 0 0 1 3-3Z" fill={MINT_TINT} {...S} />
      <path d="M18 15h12" fill="none" {...S} strokeWidth={2} />
    </>
  ),
  share: (
    <>
      <path d="m18.5 21.5 11-6.5M18.5 26.5l11 6.5" fill="none" {...S} />
      <circle cx="34" cy="12" r="6" fill={MINT} {...S} />
      <circle cx="13" cy="24" r="6" fill="var(--card)" {...S} />
      <circle cx="34" cy="36" r="6" fill={MINT_TINT} {...S} />
    </>
  ),
  settings: (
    <>
      <path d="M8 16h32M8 32h32" fill="none" {...S} />
      <circle cx="18" cy="16" r="5.5" fill="var(--card)" {...S} />
      <circle cx="30" cy="32" r="5.5" fill={CORAL_TINT} {...S} />
    </>
  ),
  refresh: (
    <>
      <circle cx="24" cy="24" r="17" fill={WARM} />
      <path
        d="M36 19a13 13 0 0 0-23.5-3.5M12 9v7h7M12 29a13 13 0 0 0 23.5 3.5M36 39v-7h-7"
        fill="none"
        {...S}
      />
    </>
  ),
  more: (
    <>
      <rect x="7" y="14" width="34" height="20" rx="10" fill={WARM} {...S} />
      <circle cx="16" cy="24" r="2.6" fill="currentColor" />
      <circle cx="24" cy="24" r="2.6" fill="currentColor" />
      <circle cx="32" cy="24" r="2.6" fill="currentColor" />
    </>
  ),
  calendar: (
    <>
      <rect x="7" y="10" width="34" height="31" rx="7" fill="var(--card)" {...S} />
      <path d="M7 17a7 7 0 0 1 7-7h20a7 7 0 0 1 7 7v4H7Z" fill={CORAL_TINT} {...S} />
      <path d="M17 6v8M31 6v8" fill="none" {...S} />
      <rect x="26" y="28" width="7" height="7" rx="2" fill={MINT} {...S} strokeWidth={2} />
    </>
  ),
};

export function Sticker({
  name,
  className,
}: {
  name: StickerName;
  className?: string;
}): ReactElement {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      className={cn('shrink-0 overflow-visible text-foreground', className)}
    >
      {ART[name]}
    </svg>
  );
}
