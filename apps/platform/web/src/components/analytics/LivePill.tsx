import type { ReactElement } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LivePillProps {
  count: number | null;
  status: 'live' | 'polling';
  onClick: () => void;
}

/**
 * Header pill: how many people are on the site right now. Socket-fed, so it
 * moves without a reload; clicking opens the live view. Flat control per the
 * design rules: hairline + inset fill on hover, never a shadow.
 */
export function LivePill({ count, status, onClick }: LivePillProps): ReactElement | null {
  if (count === null) return null;
  const live = status === 'live';
  const quiet = count === 0;

  return (
    <button
      type="button"
      onClick={onClick}
      title="Open live view"
      className={cn(
        'group -my-1 inline-flex h-[26px] items-center gap-1.5 rounded-full border border-transparent py-0 pl-2 pr-1.5 text-[12.5px] font-semibold transition-colors',
        'hover:border-[#E6E4DE] hover:bg-[#F2F1ED] focus-visible:border-[#E6E4DE] focus-visible:bg-[#F2F1ED] focus-visible:outline-none',
        quiet ? 'text-[#9B9590]' : live ? 'text-[#3F7A50]' : 'text-[#6E6C7C]'
      )}
    >
      <span className="relative flex h-[7px] w-[7px]">
        {live && !quiet && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60 motion-reduce:animate-none" />
        )}
        <span
          className={cn(
            'relative inline-flex h-[7px] w-[7px] rounded-full',
            live && !quiet ? 'bg-mint' : 'bg-[#B5B0AA]'
          )}
        />
      </span>
      <span className="tabular-nums">
        {count} online{live || quiet ? (quiet ? '' : ' now') : ''}
      </span>
      {!live && !quiet && <span className="font-medium text-[#B5B0AA]">· every 30s</span>}
      <ChevronRight
        className="h-3.5 w-3.5 text-[#B5B0AA] transition-transform group-hover:translate-x-px"
        strokeWidth={2}
      />
    </button>
  );
}
