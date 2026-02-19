import type { ReactElement } from 'react';
import { Link } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { Globe, ArrowRight } from 'lucide-react';
import { SiteTileStats } from './SiteTileStats';

export function SiteTile({
  site,
  color,
  stats,
  isStatsLoading,
  isNew,
  batchIndex,
}: {
  site: { id: string; name: string; domain: string };
  color: string;
  stats: { visitors: number; pageviews: number; sessions: number } | undefined;
  isStatsLoading: boolean;
  isNew: boolean;
  batchIndex: number;
}): ReactElement {
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
        className="group relative block rounded-2xl border border-[#e8e3ed]/80 bg-white p-5 transition-all duration-300 hover:shadow-xl hover:shadow-black/[0.06] hover:border-[#d5cfe0] overflow-hidden"
      >
        {/* Left accent bar */}
        <div
          className="absolute top-0 left-0 w-[3px] h-full origin-top scale-y-0 group-hover:scale-y-100 transition-transform duration-400 ease-out rounded-l-2xl"
          style={{ backgroundColor: color }}
        />

        {/* Header row: icon + name */}
        <div className="flex items-center gap-3 mb-1">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110"
            style={{ backgroundColor: `${color}12` }}
          >
            <Globe className="w-[18px] h-[18px]" style={{ color }} strokeWidth={1.7} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-semibold text-[#2D3436] leading-tight truncate">
              {site.name}
            </h3>
            <span className="text-[12px] text-[#B5B0AA] mt-0.5 truncate block">{site.domain}</span>
          </div>
        </div>

        {/* Stats - today */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[10px] font-semibold text-[#B5B0AA] uppercase tracking-wider">
              Today
            </span>
          </div>
          <SiteTileStats stats={stats} isLoading={isStatsLoading} />
        </div>

        {/* View analytics button */}
        <div className="mt-4 flex items-center justify-between pt-3 border-t border-[#e8e3ed]/50">
          <span className="text-[12px] font-medium text-[#9B9590] group-hover:text-[#2D3436] transition-colors">
            View Analytics
          </span>
          <ArrowRight
            className="w-4 h-4 text-[#d5cfe0] group-hover:translate-x-0.5 transition-all duration-200"
            style={{ color }}
          />
        </div>
      </Link>
    </motion.div>
  );
}
