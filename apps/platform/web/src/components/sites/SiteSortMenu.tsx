import type { ReactElement } from 'react';
import { ArrowDownUp, Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type SiteSort = 'added' | 'name' | 'visitors';

export const SITE_SORT_NAMES: Record<SiteSort, string> = {
  added: 'Date added',
  name: 'Name',
  visitors: 'Visitors today',
};

const SITE_SORTS = Object.keys(SITE_SORT_NAMES) as SiteSort[];

interface SiteSortMenuProps {
  value: SiteSort;
  onChange: (sort: SiteSort) => void;
}

/** Pill button that opens the sort options, styled like the period picker. */
export function SiteSortMenu({ value, onChange }: SiteSortMenuProps): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Sort sites"
        className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-border bg-card pl-3.5 pr-3 text-[13px] font-semibold text-foreground cursor-pointer"
      >
        <ArrowDownUp className="h-[15px] w-[15px] text-subtle" strokeWidth={1.8} />
        <span className="hidden whitespace-nowrap sm:inline">{SITE_SORT_NAMES[value]}</span>
        <ChevronDown className="h-3.5 w-3.5 text-subtle" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48 rounded-2xl border-none bg-card p-1.5 shadow-float"
      >
        {SITE_SORTS.map(option => (
          <DropdownMenuItem
            key={option}
            onClick={() => onChange(option)}
            className={cn(
              'justify-between rounded-[10px] px-3 py-2.5 text-[13.5px] text-foreground',
              value === option && 'bg-muted font-semibold'
            )}
          >
            {SITE_SORT_NAMES[option]}
            {value === option && <Check className="h-4 w-4 text-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
