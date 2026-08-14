import type { ReactElement } from 'react';
import { Users, Eye, Activity } from 'lucide-react';
import { formatNumber } from '@/lib/utils';

export function SiteTileStats({
  stats,
  isLoading,
}: {
  stats: { visitors: number; pageviews: number; sessions: number } | undefined;
  isLoading: boolean;
  /** Stats fetch failed — render a dash rather than shimmering forever. */
  isError?: boolean;
}): ReactElement {
  if (!isLoading && !stats) {
    // Loaded but absent (request failed): show placeholders, not a skeleton.
    return (
      <div className="grid grid-cols-3 gap-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-xl bg-[#F2F1ED] px-2.5 py-2">
            <div className="text-[15px] font-semibold text-[#B5B0AA]">&mdash;</div>
          </div>
        ))}
      </div>
    );
  }
  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-xl bg-[#F2F1ED] px-2.5 py-2">
            <div className="mb-1.5 h-3.5 w-12 animate-pulse rounded bg-muted" />
            <div className="ml-0.5 h-4 w-8 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  // Deliberately monochrome — the tile's hue shows only in the chart line.
  const items = [
    { icon: Users, label: 'Visitors', value: stats.visitors },
    { icon: Eye, label: 'Pageviews', value: stats.pageviews },
    { icon: Activity, label: 'Sessions', value: stats.sessions },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map(item => (
        <div key={item.label} className="rounded-xl bg-[#F2F1ED] px-2.5 py-2">
          <div className="mb-1.5 flex items-center gap-1.5">
            <item.icon className="h-3.5 w-3.5 text-[#3D3B4F]" strokeWidth={1.8} />
            <span className="text-[10.5px] font-semibold leading-none text-[#9B9590]">
              {item.label}
            </span>
          </div>
          <span className="pl-0.5 text-[15px] font-bold leading-none tabular-nums text-[#3D3B4F]">
            {formatNumber(item.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
