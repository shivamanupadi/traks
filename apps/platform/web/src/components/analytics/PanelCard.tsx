import type { ReactElement } from 'react';
import { BarChart3, AlertCircle } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';

export interface PanelItem {
  name: string;
  visitors: number;
  pageviews?: number;
  percentage?: number;
  /** Display text when it differs from `name` (which stays the filter value). */
  label?: string;
  /** Small leading element (e.g. a country flag). */
  icon?: ReactElement;
  /** Row key when `name` alone may not be unique (e.g. city + country). */
  id?: string;
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
  /** Refetch handler — renders a retry action on the error state. */
  onRetry?: () => void;
  tabs?: PanelTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  /** Optional element rendered in the header row (e.g. a back button). */
  headerAction?: ReactElement;
  showPageviews?: boolean;
  /** Show a % share column (uses item.percentage when present). */
  showPercentage?: boolean;
  emptyText?: string;
  className?: string;
  /** Makes rows clickable (click-to-filter). Rows with empty names stay inert. */
  onItemClick?: (item: PanelItem) => void;
}

/** Pill tab switcher shared by the list panels. */
export function PanelTabs({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: PanelTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
}): ReactElement {
  return (
    <div className="flex items-center gap-0.5 rounded-full bg-muted p-0.5">
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => onTabChange?.(tab.key)}
          className={cn(
            'rounded-full px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer',
            activeTab === tab.key
              ? 'bg-white text-[#3D3B4F]'
              : 'text-[#9B9590] hover:text-[#6b6560]'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Floating list panel: title + pill tabs, rows with proportional fill bars behind them. */
export function PanelCard({
  title,
  labelHeader,
  valueHeader = 'Visitors',
  items,
  isLoading,
  isError,
  onRetry,
  tabs,
  activeTab,
  onTabChange,
  headerAction,
  showPageviews = false,
  showPercentage = false,
  emptyText = 'No data yet',
  className,
  onItemClick,
}: PanelCardProps): ReactElement {
  const maxVisitors = items && items.length > 0 ? Math.max(...items.map(i => i.visitors)) : 1;
  const totalVisitors = items ? items.reduce((s, i) => s + i.visitors, 0) : 0;

  return (
    <div
      className={cn(
        'flex min-h-[22rem] flex-col rounded-[20px] bg-white p-6 shadow-float',
        className
      )}
    >
      {/* Header: title + tabs */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="truncate text-[15px] font-bold tracking-[-0.01em] text-[#3D3B4F]">
          {title}
        </h3>
        {headerAction}
        {tabs && tabs.length > 1 && (
          <PanelTabs tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} />
        )}
      </div>

      {isError ? (
        <div className="flex flex-1 flex-col items-center justify-center">
          <AlertCircle className="mb-2 h-5 w-5 text-[#e07a5f]/60" strokeWidth={1.5} />
          <p className="text-[13px] text-[#e07a5f]">Couldn&rsquo;t load this panel</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-2 rounded-full bg-muted px-3 py-1 text-[12px] font-semibold text-[#3D3B4F] transition-colors hover:bg-[#E6E4DE]"
            >
              Try again
            </button>
          )}
        </div>
      ) : isLoading || !items ? (
        <div className="mt-1 space-y-2.5">
          {[95, 78, 62, 48, 36, 28, 20].map((w, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <div className="h-6 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />
              <div className="h-6 w-10 shrink-0 animate-pulse rounded bg-muted" />
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

          {items.map(item => {
            const pct =
              item.percentage ??
              (totalVisitors > 0 ? Math.round((item.visitors / totalVisitors) * 100) : 0);
            const clickable = Boolean(onItemClick && item.name);
            const Row = clickable ? 'button' : 'div';
            const display = item.label ?? item.name;
            return (
              <Row
                key={item.id ?? (item.name || '(none)')}
                onClick={clickable ? () => onItemClick!(item) : undefined}
                className={cn(
                  'relative flex h-[30px] w-full items-center justify-between rounded-md px-2.5',
                  clickable && 'cursor-pointer transition-colors hover:bg-muted'
                )}
                title={clickable ? `Filter by ${display}` : undefined}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-md bg-[#3D3B4F]/[0.05]"
                  style={{ width: `${(item.visitors / maxVisitors) * 100}%` }}
                />
                <span className="relative z-10 flex min-w-0 items-center gap-2 pr-4">
                  {item.icon && <span className="flex shrink-0 items-center">{item.icon}</span>}
                  <span className="truncate text-[13px] text-[#3D3B4F]">{display || '(none)'}</span>
                </span>
                <div className="relative z-10 flex shrink-0 gap-5 text-[13px] font-medium tabular-nums text-[#3D3B4F]">
                  <span className="w-12 text-right">{formatNumber(item.visitors)}</span>
                  {showPageviews && (
                    <span className="w-12 text-right">{formatNumber(item.pageviews || 0)}</span>
                  )}
                  {showPercentage && <span className="w-10 text-right text-[#9B9590]">{pct}%</span>}
                </div>
              </Row>
            );
          })}
        </div>
      )}
    </div>
  );
}
