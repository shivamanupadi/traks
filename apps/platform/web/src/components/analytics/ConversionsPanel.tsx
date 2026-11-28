import type { ReactElement } from 'react';
import { AlertCircle, BarChart3, Check, ChevronDown } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PanelTabs } from './PanelCard';

export interface AttributionRow {
  name: string;
  sessions: number;
  conversions: number;
  /** conversions / sessions, 0-100 with one decimal. */
  conversionRate: number;
}

export type AttributionDim = 'source' | 'medium' | 'campaign';

const DIM_TABS: { key: AttributionDim; label: string }[] = [
  { key: 'source', label: 'Source' },
  { key: 'medium', label: 'Medium' },
  { key: 'campaign', label: 'Campaign' },
];

interface ConversionsPanelProps {
  goals: { id: string; name: string }[];
  /** null = a visit converts by completing any goal. */
  goalId: string | null;
  onGoalChange: (goalId: string | null) => void;
  dim: AttributionDim;
  onDimChange: (dim: AttributionDim) => void;
  rows: AttributionRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  className?: string;
}

// Phones drop the Converted column and the meter; the rate stays.
const COLS =
  'grid grid-cols-[minmax(0,1fr)_56px_52px] gap-3 sm:grid-cols-[minmax(0,1fr)_64px_80px_168px]';

/**
 * Conversions by source: tagged visits per UTM source, medium or campaign,
 * and how many of them completed the picked goal (or any goal). A visit
 * counts toward the tag on its first page. The meter is the rate on a 0-100
 * track, like the goal tiles.
 */
export function ConversionsPanel({
  goals,
  goalId,
  onGoalChange,
  dim,
  onDimChange,
  rows,
  isLoading,
  isError,
  className,
}: ConversionsPanelProps): ReactElement {
  const goal = goalId ? goals.find(g => g.id === goalId) : undefined;
  const dimLabel = DIM_TABS.find(t => t.key === dim)!.label;

  return (
    <div className={cn('rounded-[20px] bg-card p-5 shadow-float sm:p-6', className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
        <h3 className="text-[15px] font-bold tracking-[-0.01em] text-foreground">
          Conversions by source
        </h3>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex max-w-[16rem] items-center gap-1.5 rounded-full border border-border py-1 pl-3 pr-2 text-[12.5px] font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer">
              <span className="truncate">{goal ? goal.name : 'Any goal'}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-subtle" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="max-h-80 w-64 max-w-[calc(100vw-3rem)] overflow-y-auto border-0 p-1.5 shadow-float-lg max-sm:left-0 max-sm:right-auto"
            >
              <p className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
                Converted when a visit completes
              </p>
              {[{ id: null, name: 'Any goal' }, ...goals].map(g => {
                const on = g.id === (goal?.id ?? null);
                return (
                  <DropdownMenuItem
                    key={g.id ?? '*'}
                    onClick={() => onGoalChange(g.id)}
                    className={cn(
                      'gap-2 rounded-[10px] px-2.5 py-2 hover:bg-muted focus:bg-muted',
                      on && 'bg-muted'
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                      {g.name}
                    </span>
                    {on && <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <PanelTabs
            tabs={DIM_TABS}
            activeTab={dim}
            onTabChange={key => onDimChange(key as AttributionDim)}
          />
        </div>
      </div>

      {isError ? (
        <div className="flex flex-col items-center justify-center py-10">
          <AlertCircle className="mb-2 h-5 w-5 text-[#e07a5f]/60" strokeWidth={1.5} />
          <p className="text-[13px] text-[#e07a5f]">Couldn&rsquo;t load this panel</p>
        </div>
      ) : isLoading || !rows ? (
        <div className="space-y-2.5">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="h-7 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <BarChart3 className="mb-2 h-5 w-5 text-faint" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-subtle">No tagged visits in this period</p>
          <p className="mt-1 max-w-sm text-[12px] text-faint">
            Visits arriving through links with utm_ tags show up here.
          </p>
        </div>
      ) : (
        <div>
          <div
            className={cn(
              COLS,
              'px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-faint'
            )}
          >
            <span className="truncate">{dimLabel}</span>
            <span className="text-right">Visits</span>
            <span className="text-right max-sm:hidden">Converted</span>
            <span className="text-right sm:text-left">Rate</span>
          </div>
          {rows.map(row => (
            <div
              key={row.name}
              className={cn(
                COLS,
                'h-9 items-center border-t border-muted px-2.5 text-[13px] text-foreground'
              )}
            >
              <span className="truncate" title={row.name}>
                {row.name}
              </span>
              <span className="text-right tabular-nums text-muted-foreground">
                {formatNumber(row.sessions)}
              </span>
              <span className="text-right tabular-nums text-muted-foreground max-sm:hidden">
                {formatNumber(row.conversions)}
              </span>
              <span className="flex items-center justify-end gap-2.5 sm:justify-start">
                <span className="font-semibold tabular-nums sm:w-12">{row.conversionRate}%</span>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-border max-sm:hidden">
                  <span
                    className="block h-full rounded-full bg-btn"
                    style={{ width: `${Math.min(row.conversionRate, 100)}%` }}
                  />
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
