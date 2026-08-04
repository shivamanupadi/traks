import type { ReactElement } from 'react';
import { Users, Eye, Activity } from 'lucide-react';
import { formatNumber } from '@/lib/utils';

export function SiteTileStats({
  stats,
  isLoading,
  accent = '#3D3B4F',
}: {
  stats: { visitors: number; pageviews: number; sessions: number } | undefined;
  isLoading: boolean;
  /** Deep companion color for the visitors icon (follows the tile hue). */
  accent?: string;
}): ReactElement {
  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-xl bg-[#F4F4F6] px-2.5 py-2">
            <div className="mb-1.5 h-3.5 w-12 animate-pulse rounded bg-muted" />
            <div className="ml-0.5 h-4 w-8 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  const items = [
    { icon: Users, label: 'Visitors', value: stats.visitors, color: accent },
    { icon: Eye, label: 'Pageviews', value: stats.pageviews, color: '#e07a5f' },
    { icon: Activity, label: 'Sessions', value: stats.sessions, color: '#6b8ead' },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map(item => (
        <div key={item.label} className="rounded-xl bg-[#F4F4F6] px-2.5 py-2">
          <div className="mb-1.5 flex items-center gap-1.5">
            <item.icon className="h-3.5 w-3.5" style={{ color: item.color }} strokeWidth={1.8} />
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
