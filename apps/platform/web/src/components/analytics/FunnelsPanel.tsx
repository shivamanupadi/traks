import type { ReactElement } from 'react';
import { Filter, AlertCircle, Settings2 } from 'lucide-react';
import type { FunnelDef, FunnelStat } from '@traks/shared';
import { cn, formatNumber } from '@/lib/utils';

interface FunnelsPanelProps {
  funnels: FunnelDef[] | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
  stat: FunnelStat | undefined;
  isLoading: boolean;
  isError?: boolean;
  /** Absent for view-only members: hides the manage affordances. */
  onManage?: () => void;
  className?: string;
}

/**
 * Funnel panel: one row per step — count bar (width relative to step 1),
 * sessions, and step-over-step conversion. Overall conversion in the header.
 */
export function FunnelsPanel({
  funnels,
  selectedId,
  onSelect,
  stat,
  isLoading,
  isError,
  onManage,
  className,
}: FunnelsPanelProps): ReactElement {
  const hasFunnels = funnels !== undefined && funnels.length > 0;
  const overall =
    stat && stat.steps.length > 0 ? stat.steps[stat.steps.length - 1].rateFromFirst : null;

  return (
    <div className={cn('rounded-[20px] bg-white p-6 shadow-float', className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-[15px] font-bold tracking-[-0.01em] text-[#3D3B4F]">Funnels</h3>
          {overall !== null && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-[#6E6C7C]">
              {overall}% end-to-end
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasFunnels && funnels.length > 1 && (
            <div className="flex items-center gap-1 rounded-full bg-muted p-1">
              {funnels.map(f => (
                <button
                  key={f.id}
                  onClick={() => onSelect(f.id)}
                  className={cn(
                    'rounded-full px-3 py-1 text-[11.5px] font-semibold transition-colors cursor-pointer',
                    f.id === selectedId
                      ? 'bg-white text-[#3D3B4F] shadow-sm'
                      : 'text-[#9B9590] hover:text-[#3D3B4F]'
                  )}
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}
          {onManage && (
            <button
              onClick={onManage}
              className="flex items-center gap-1.5 rounded-full bg-muted px-3.5 py-1.5 text-[12px] font-semibold text-foreground hover:bg-[#E4E4E9] transition-colors cursor-pointer"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Manage funnels
            </button>
          )}
        </div>
      </div>

      {isError ? (
        <div className="flex flex-col items-center justify-center py-10">
          <AlertCircle className="mb-2 h-5 w-5 text-[#e07a5f]/60" strokeWidth={1.5} />
          <p className="text-[13px] text-[#e07a5f]">Failed to load funnel</p>
        </div>
      ) : !hasFunnels && funnels !== undefined ? (
        <div className="flex flex-col items-center justify-center py-10">
          <Filter className="mb-2 h-5 w-5 text-[#B5B0AA]" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-[#9B9590]">No funnels yet</p>
          <p className="mt-1 max-w-[44ch] text-center text-[12px] text-[#B5B0AA]">
            Chain pages and events into ordered steps to see where visitors drop off.
          </p>
          {onManage && (
            <button
              onClick={onManage}
              className="mt-3 rounded-full bg-muted px-4 py-2 text-[12px] font-semibold text-foreground hover:bg-[#E4E4E9] transition-colors cursor-pointer"
            >
              Create your first funnel
            </button>
          )}
        </div>
      ) : isLoading || !stat ? (
        <div className="space-y-2.5">
          {[92, 64, 38].map((w, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <div className="h-8 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />
              <div className="h-8 w-24 shrink-0 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-[#B5B0AA]">
            <span>Step</span>
            <div className="flex gap-5">
              <span className="w-16 text-right">Sessions</span>
              <span className="w-14 text-right">Of prev</span>
            </div>
          </div>

          {stat.steps.map((step, i) => {
            const width = stat.steps[0].sessions > 0 ? step.rateFromFirst : 0;
            return (
              <div
                key={`${step.type}-${step.target}-${i}`}
                className="relative flex h-[34px] items-center justify-between rounded-md px-2.5"
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-md bg-[#3D3B4F]/[0.05]"
                  style={{ width: `${width}%` }}
                />
                <span className="relative z-10 flex min-w-0 items-center gap-2.5 pr-4">
                  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-[#E4E4E9] bg-white font-mono text-[10px] font-semibold text-[#6E6C7C]">
                    {i + 1}
                  </span>
                  <span className="truncate text-[13px] text-[#3D3B4F]">{step.target}</span>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-[#9B9590]">
                    {step.type === 'page' ? 'page' : 'event'}
                  </span>
                </span>
                <div className="relative z-10 flex shrink-0 gap-5 text-[13px] font-medium tabular-nums text-[#3D3B4F]">
                  <span className="w-16 text-right">{formatNumber(step.sessions)}</span>
                  <span className={cn('w-14 text-right', i === 0 && 'text-[#B5B0AA]')}>
                    {i === 0 ? '—' : `${step.rateFromPrev}%`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
