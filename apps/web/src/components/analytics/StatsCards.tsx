import type { ReactElement } from 'react';
import {
  Users,
  Eye,
  MousePointerClick,
  ArrowUpRight,
  ArrowDownRight,
  AlertCircle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatNumber, formatPercentChange } from '@/lib/utils';
import type { MainStats } from '@traks/shared';

interface StatsCardsProps {
  stats: MainStats | undefined;
  isLoading: boolean;
  isError?: boolean;
}

interface StatCardProps {
  title: string;
  value: number;
  change: number;
  icon: LucideIcon;
  color: string;
  /** Render the value as a percentage (e.g. bounce rate) instead of a count. */
  isPercent?: boolean;
  /** Set when an increase is bad (e.g. bounce rate) so colors flip. */
  higherIsWorse?: boolean;
}

function StatCard({
  title,
  value,
  change,
  icon: Icon,
  color,
  isPercent,
  higherIsWorse,
}: StatCardProps): ReactElement {
  const { text, isPositive } = formatPercentChange(change);
  const isGood = higherIsWorse ? !isPositive : isPositive;

  return (
    <div className="rounded-2xl border border-[#e8e3ed]/80 bg-white p-5 overflow-hidden relative group">
      {/* Top accent */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{ backgroundColor: `${color}30` }}
      />

      <div className="flex items-center gap-2.5 mb-4">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${color}12` }}
        >
          <Icon className="w-4 h-4" style={{ color }} strokeWidth={1.8} />
        </div>
        <p className="text-[13px] font-medium text-[#9B9590]">{title}</p>
      </div>

      <p className="text-[26px] font-bold text-[#2D3436] tracking-tight leading-none">
        {isPercent ? `${value}%` : formatNumber(value)}
      </p>

      <div className="mt-2.5 flex items-center gap-1.5">
        <div
          className={cn(
            'flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold',
            isGood ? 'bg-[#5b9a6f]/8 text-[#5b9a6f]' : 'bg-[#e07a5f]/8 text-[#e07a5f]'
          )}
        >
          {isPositive ? (
            <ArrowUpRight className="w-3 h-3" strokeWidth={2.5} />
          ) : (
            <ArrowDownRight className="w-3 h-3" strokeWidth={2.5} />
          )}
          {text}
        </div>
        <span className="text-[11px] text-[#B5B0AA]">vs prev</span>
      </div>
    </div>
  );
}

export function StatsCards({ stats, isLoading, isError }: StatsCardsProps): ReactElement {
  if (isError) {
    return (
      <div className="flex h-[140px] flex-col items-center justify-center rounded-2xl border border-[#e8e3ed]/80 bg-white">
        <AlertCircle className="w-5 h-5 text-[#e07a5f]/60 mb-2" strokeWidth={1.5} />
        <p className="text-[13px] text-[#e07a5f]">Failed to load stats</p>
      </div>
    );
  }

  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="h-[140px] rounded-2xl border border-[#e8e3ed]/80 bg-white p-5 overflow-hidden"
          >
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg bg-[#f3f0f7] animate-pulse" />
              <div className="h-3 w-24 rounded bg-[#f3f0f7] animate-pulse" />
            </div>
            <div className="h-7 w-20 rounded bg-[#f3f0f7] animate-pulse" />
            <div className="mt-3 h-4 w-28 rounded-full bg-[#f3f0f7] animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title="Unique Visitors"
        value={stats.visitors}
        change={stats.visitorsChange}
        icon={Users}
        color="#9b72cf"
      />
      <StatCard
        title="Pageviews"
        value={stats.pageviews}
        change={stats.pageviewsChange}
        icon={Eye}
        color="#e07a5f"
      />
      <StatCard
        title="Sessions"
        value={stats.sessions}
        change={stats.sessionsChange}
        icon={MousePointerClick}
        color="#5b9a6f"
      />
      <StatCard
        title="Bounce Rate"
        value={stats.bounceRate}
        change={stats.bounceRateChange}
        icon={MousePointerClick}
        color="#9b72cf"
        isPercent
        higherIsWorse
      />
    </div>
  );
}
