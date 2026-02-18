import type { ReactElement } from 'react';
import { Users, Eye, Activity } from 'lucide-react';
import { formatNumber } from '@/lib/utils';

export function SiteTileStats({
  stats,
  isLoading,
}: {
  stats: { visitors: number; pageviews: number; sessions: number } | undefined;
  isLoading: boolean;
}): ReactElement {
  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-lg bg-[#fdfbf8] px-2.5 py-2">
            <div className="h-3.5 w-12 animate-pulse rounded bg-[#e8e3ed]/50 mb-1.5" />
            <div className="h-4 w-8 animate-pulse rounded bg-[#e8e3ed]/50 ml-0.5" />
          </div>
        ))}
      </div>
    );
  }

  const items = [
    { icon: Users, label: 'Visitors', value: stats.visitors, color: '#9b72cf' },
    { icon: Eye, label: 'Pageviews', value: stats.pageviews, color: '#e07a5f' },
    { icon: Activity, label: 'Sessions', value: stats.sessions, color: '#5b9a6f' },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map(item => (
        <div key={item.label} className="rounded-lg bg-[#fdfbf8] px-2.5 py-2">
          <div className="flex items-center gap-1.5 mb-1.5">
            <item.icon className="w-3.5 h-3.5" style={{ color: item.color }} strokeWidth={1.8} />
            <span className="text-[11px] font-medium text-[#B5B0AA] leading-none">{item.label}</span>
          </div>
          <span className="text-[15px] font-bold text-[#2D3436] leading-none pl-0.5">{formatNumber(item.value)}</span>
        </div>
      ))}
    </div>
  );
}
