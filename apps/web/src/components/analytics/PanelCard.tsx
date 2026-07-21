import type { ReactElement } from 'react';
import { BarChart3, AlertCircle } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';

export interface PanelItem {
  name: string;
  visitors: number;
  pageviews?: number;
  percentage?: number;
}

export interface PanelTab {
  key: string;
  label: string;
}

interface PanelCardProps {
  title: string;
  /** Column header for the item name (e.g. "Page", "Source", "Country"). */
  labelHeader: string;
  /** Column header for the primary count (defaults to "Visitors"). */
  valueHeader?: string;
  items: PanelItem[] | undefined;
  isLoading: boolean;
  isError?: boolean;
  tabs?: PanelTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  showPageviews?: boolean;
  /** Show a % share column (uses item.percentage when present). */
  showPercentage?: boolean;
  emptyText?: string;
  className?: string;
}

/** Plausible-style list panel: title + tab switcher, rows with proportional bars. */
export function PanelCard({
  title,
  labelHeader,
  valueHeader = 'Visitors',
  items,
  isLoading,
  isError,
  tabs,
  activeTab,
  onTabChange,
  showPageviews = false,
  showPercentage = false,
  emptyText = 'No data yet',
  className,
}: PanelCardProps): ReactElement {
  const maxVisitors = items && items.length > 0 ? Math.max(...items.map(i => i.visitors)) : 1;
  const totalVisitors = items ? items.reduce((s, i) => s + i.visitors, 0) : 0;

  return (
    <div
      className={cn(
        'flex min-h-[22rem] flex-col rounded-2xl border border-[#e8e3ed]/80 bg-white p-5',
        className
      )}
    >
      {/* Header: title + tabs */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-[#2D3436]">{title}</h3>
        {tabs && tabs.length > 1 && (
          <div className="flex items-center gap-0.5 rounded-lg bg-[#f3f0f7]/60 p-0.5">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => onTabChange?.(tab.key)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer',
                  activeTab === tab.key
                    ? 'bg-white text-[#2D3436] shadow-sm'
                    : 'text-[#9B9590] hover:text-[#6b6560]'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {isError ? (
        <div className="flex flex-1 flex-col items-center justify-center">
          <AlertCircle className="mb-2 h-5 w-5 text-[#e07a5f]/60" strokeWidth={1.5} />
          <p className="text-[13px] text-[#e07a5f]">Failed to load data</p>
        </div>
      ) : isLoading || !items ? (
        <div className="mt-1 space-y-2.5">
          {[95, 78, 62, 48, 36, 28, 20].map((w, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <div className="h-6 animate-pulse rounded bg-[#f3f0f7]" style={{ width: `${w}%` }} />
              <div className="h-6 w-10 shrink-0 animate-pulse rounded bg-[#f3f0f7]" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center">
          <BarChart3 className="mb-2 h-5 w-5 text-[#B5B0AA]" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-[#9B9590]">{emptyText}</p>
          <p className="mt-1 text-[12px] text-[#B5B0AA]">Data will appear once visitors arrive</p>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Column headers */}
          <div className="flex items-center justify-between px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-[#B5B0AA]">
            <span>{labelHeader}</span>
            <div className="flex gap-5">
              <span className="w-12 text-right">{valueHeader}</span>
              {showPageviews && <span className="w-12 text-right">Views</span>}
              {showPercentage && <span className="w-10 text-right">%</span>}
            </div>
          </div>

          {items.map((item, i) => {
            const pct =
              item.percentage ??
              (totalVisitors > 0 ? Math.round((item.visitors / totalVisitors) * 100) : 0);
            return (
              <div
                key={i}
                className="relative flex h-[30px] items-center justify-between rounded-md px-2.5"
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-md bg-[#9b72cf]/[0.08]"
                  style={{ width: `${(item.visitors / maxVisitors) * 100}%` }}
                />
                <span className="relative z-10 truncate pr-4 text-[13px] text-[#2D3436]">
                  {item.name || '(none)'}
                </span>
                <div className="relative z-10 flex shrink-0 gap-5 text-[13px] font-medium tabular-nums text-[#2D3436]">
                  <span className="w-12 text-right">{formatNumber(item.visitors)}</span>
                  {showPageviews && (
                    <span className="w-12 text-right">{formatNumber(item.pageviews || 0)}</span>
                  )}
                  {showPercentage && <span className="w-10 text-right text-[#9B9590]">{pct}%</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
