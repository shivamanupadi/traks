import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';

/** Small event/page badge shared by the goals and funnels drawers. */
export function TypeChip({
  type,
  className,
}: {
  type: 'event' | 'page';
  className?: string;
}): ReactElement {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] items-center rounded-full px-[7px] text-[10.5px] font-medium',
        type === 'event' ? 'bg-[#eceff9] text-[#4c5b8f]' : 'bg-[#f0f0e0] text-[#6c6f3f]',
        className
      )}
    >
      {type}
    </span>
  );
}
