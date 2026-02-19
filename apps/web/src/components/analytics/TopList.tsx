import type { ReactElement } from 'react';
import { BarChart3, AlertCircle } from 'lucide-react';
import { formatNumber } from '@/lib/utils';

interface TopListItem {
  name: string;
  visitors: number;
  pageviews?: number;
}

interface TopListProps {
  title: string;
  items: TopListItem[] | undefined;
  isLoading: boolean;
  isError?: boolean;
  showPageviews?: boolean;
}

export function TopList({
  title,
  items,
  isLoading,
  isError,
  showPageviews = false,
}: TopListProps): ReactElement {
  if (isError) {
    return (
      <div className="flex h-[300px] flex-col items-center justify-center rounded-2xl border border-[#e8e3ed]/80 bg-white">
        <AlertCircle className="w-5 h-5 text-[#e07a5f]/60 mb-2" strokeWidth={1.5} />
        <p className="text-[13px] text-[#e07a5f]">Failed to load data</p>
      </div>
    );
  }

  if (isLoading || !items) {
    return (
      <div className="h-[300px] animate-pulse rounded-2xl border border-[#e8e3ed]/80 bg-white" />
    );
  }

  const maxVisitors = items.length > 0 ? Math.max(...items.map(i => i.visitors)) : 1;

  return (
    <div className="rounded-2xl border border-[#e8e3ed]/80 bg-white p-5">
      <h3 className="mb-4 text-[15px] font-semibold text-[#2D3436]">{title}</h3>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10">
          <BarChart3 className="w-5 h-5 text-[#B5B0AA] mb-2" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-[#9B9590]">No data yet</p>
          <p className="text-[12px] text-[#B5B0AA] mt-1">Data will appear once visitors arrive</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Header */}
          <div className="flex items-center justify-between px-2 text-[11px] font-medium uppercase tracking-wider text-[#B5B0AA]">
            <span>{title}</span>
            <div className="flex gap-6">
              <span>Visitors</span>
              {showPageviews && <span>Views</span>}
            </div>
          </div>

          {/* Items */}
          {items.map((item, i) => (
            <div
              key={i}
              className="relative flex items-center justify-between rounded-lg px-2 py-1.5"
            >
              {/* Background bar */}
              <div
                className="absolute inset-y-0 left-0 rounded-lg bg-[#9b72cf]/[0.06]"
                style={{ width: `${(item.visitors / maxVisitors) * 100}%` }}
              />
              <span className="relative z-10 truncate text-[13px] text-[#2D3436]">
                {item.name || '(direct)'}
              </span>
              <div className="relative z-10 flex gap-6 text-[13px] font-medium tabular-nums text-[#2D3436]">
                <span>{formatNumber(item.visitors)}</span>
                {showPageviews && <span>{formatNumber(item.pageviews || 0)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
