import type { ReactElement } from 'react';
import { Link } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import type { TimeseriesPoint } from '@traks/shared';
import { api } from '@/lib/api';
import { SiteTileStats } from './SiteTileStats';
import { SiteFavicon } from './SiteFavicon';

export interface TileColor {
  /** Deep companion: icon, sparkline stroke, arrow. */
  deep: string;
  /** Pastel: sparkline fill, icon-chip wash. */
  pastel: string;
}

/** Today's hourly visitors sparkline; last point gets an anchored endpoint dot. */
function Sparkline({
  points,
  color,
}: {
  points: TimeseriesPoint[];
  color: TileColor;
}): ReactElement {
  if (points.length < 2) return <div className="mt-3.5 h-11 w-full" aria-hidden="true" />;
  const w = 280;
  const h = 44;
  const values = points.map(p => p.visitors);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pad = (max - min) * 0.2 || 1;
  const sx = (i: number): number => 4 + (i * (w - 8)) / (values.length - 1);
  const sy = (v: number): number => 4 + (h - 10) * (1 - (v - min + pad) / (max - min + 2 * pad));
  const line = values.map((v, i) => `${sx(i)},${sy(v)}`).join(' L ');
  const gid = `spark-${color.deep.slice(1)}`;
  const lastI = values.length - 1;

  return (
    <svg
      className="mt-3.5 block h-11 w-full"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color.pastel} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color.pastel} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M ${line} L ${sx(lastI)},${h} L ${sx(0)},${h} Z`} fill={`url(#${gid})`} />
      <path
        d={`M ${line}`}
        fill="none"
        stroke={color.deep}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={sx(lastI)}
        cy={sy(values[lastI])}
        r="3"
        fill={color.deep}
        stroke="#fff"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function SiteTile({
  site,
  color,
  stats,
  isStatsLoading,
  isNew,
  batchIndex,
}: {
  site: { id: string; name: string; domain: string; favicon?: string | null };
  color: TileColor;
  stats: { visitors: number; pageviews: number; sessions: number } | undefined;
  isStatsLoading: boolean;
  isNew: boolean;
  batchIndex: number;
}): ReactElement {
  // Today's hourly sparkline — matches the "Today" stats below it. 'today'
  // is served live from the site's DO, so this stays cheap per tile.
  const { data: sparkData, isLoading: sparkLoading } = useQuery({
    queryKey: ['site-analytics', site.id, 'spark', 'today'],
    queryFn: () => api.getTimeseries(site.id, 'today'),
    staleTime: 60_000,
  });
  const sparkPoints = ((sparkData as any)?.data ?? []) as TimeseriesPoint[];

  return (
    <motion.div
      initial={isNew ? { opacity: 0, y: 16, scale: 0.97 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={
        isNew
          ? { duration: 0.35, ease: [0.25, 0.1, 0.25, 1], delay: batchIndex * 0.05 }
          : { duration: 0 }
      }
    >
      <Link
        to="/portal/site/$siteId"
        params={{ siteId: site.id }}
        className="group relative block rounded-[20px] bg-white p-[22px] shadow-float transition-all duration-300 hover:-translate-y-[3px] hover:shadow-float-lg"
      >
        {/* Header row: icon + name */}
        <div className="flex items-center gap-3">
          {/* Neutral chip for every site — the tile's hue lives in the chart line only. */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-[#F2F1ED] transition-transform duration-300 group-hover:scale-110">
            <SiteFavicon favicon={site.favicon} size={24} fallbackClassName="text-[#3D3B4F]" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-bold leading-tight text-[#3D3B4F]">
              {site.name}
            </h3>
            <span className="mt-0.5 block truncate text-[12px] text-[#B5B0AA]">{site.domain}</span>
          </div>
        </div>

        {sparkLoading ? (
          <div
            className="mt-3.5 h-11 w-full animate-pulse rounded-xl bg-muted"
            aria-hidden="true"
          />
        ) : (
          <Sparkline points={sparkPoints} color={color} />
        )}

        {/* Stats - today */}
        <div className="mt-3.5">
          <span className="mb-2.5 block text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#9B9590]">
            Today
          </span>
          <SiteTileStats stats={stats} isLoading={isStatsLoading} />
        </div>

        {/* View analytics footer */}
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[12px] font-semibold text-[#9B9590] transition-colors group-hover:text-[#3D3B4F]">
            View Analytics
          </span>
          <ArrowRight
            className="h-4 w-4 transition-all duration-200 group-hover:translate-x-0.5"
            style={{ color: color.deep }}
            strokeWidth={2}
          />
        </div>
      </Link>
    </motion.div>
  );
}
