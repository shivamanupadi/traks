import { useEffect, useRef, useState, type ReactElement } from 'react';
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
  /** Refetch handler - renders a retry action on the error state. */
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

/** Pill tab switcher shared by the list panels. On narrow cards the strip
 *  scrolls sideways; whichever edge hides a tab fades out to say so. */
export function PanelTabs({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: PanelTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (): void => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges(e => (e.left === left && e.right === right ? e : { left, right }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);

  const fade = 'transparent, black 24px';
  const mask =
    edges.left || edges.right
      ? `linear-gradient(to right, ${edges.left ? fade : 'black, black'}, black calc(100% - 24px), ${
          edges.right ? 'transparent' : 'black'
        })`
      : undefined;

  return (
    <div
      ref={ref}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
      className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-muted p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={e => {
            onTabChange?.(tab.key);
            e.currentTarget.scrollIntoView({
              block: 'nearest',
              inline: 'nearest',
              behavior: 'smooth',
            });
          }}
          className={cn(
            'shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer',
            activeTab === tab.key
              ? 'bg-card text-foreground'
              : 'text-subtle hover:text-muted-foreground'
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
        'flex flex-col rounded-[20px] bg-card p-5 shadow-float sm:p-6 lg:min-h-[22rem]',
        className
      )}
    >
      {/* Header: title + tabs */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
        <h3 className="truncate text-[15px] font-bold tracking-[-0.01em] text-foreground">
          {title}
        </h3>
        {headerAction}
        {tabs && tabs.length > 1 && (
          <PanelTabs tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} />
        )}
      </div>

      {isError ? (
        <div className="flex flex-1 flex-col items-center justify-center py-8 lg:py-0">
          <AlertCircle className="mb-2 h-5 w-5 text-[#e07a5f]/60" strokeWidth={1.5} />
          <p className="text-[13px] text-[#e07a5f]">Couldn&rsquo;t load this panel</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-2 rounded-full bg-muted px-3 py-1 text-[12px] font-semibold text-foreground transition-colors hover:bg-border"
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
        <div className="flex flex-1 flex-col items-center justify-center py-8 lg:py-0">
          <BarChart3 className="mb-2 h-5 w-5 text-faint" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-subtle">{emptyText}</p>
          <p className="mt-1 text-[12px] text-faint">Data will appear once visitors arrive</p>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Column headers */}
          <div className="flex items-center justify-between px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-faint">
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
                  clickable && 'cursor-pointer transition-colors hover:bg-border'
                )}
                title={clickable ? `Filter by ${display}` : undefined}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-md bg-muted"
                  style={{ width: `${(item.visitors / maxVisitors) * 100}%` }}
                />
                <span className="relative z-10 flex min-w-0 items-center gap-2 pr-4">
                  {item.icon && <span className="flex shrink-0 items-center">{item.icon}</span>}
                  <span className="truncate text-[13px] text-foreground">
                    {display || '(none)'}
                  </span>
                </span>
                <div className="relative z-10 flex shrink-0 gap-5 text-[13px] font-medium tabular-nums text-foreground">
                  <span className="w-12 text-right">{formatNumber(item.visitors)}</span>
                  {showPageviews && (
                    <span className="w-12 text-right">{formatNumber(item.pageviews || 0)}</span>
                  )}
                  {showPercentage && <span className="w-10 text-right text-subtle">{pct}%</span>}
                </div>
              </Row>
            );
          })}
        </div>
      )}
    </div>
  );
}
