import type { ReactElement } from 'react';
import { Target, AlertCircle, Settings2 } from 'lucide-react';
import type { GoalStat } from '@traks/shared';
import { cn, formatNumber } from '@/lib/utils';

interface GoalsPanelProps {
  goals: GoalStat[] | undefined;
  isLoading: boolean;
  isError?: boolean;
  /** Absent for view-only members: hides the manage affordances. */
  onManage?: () => void;
  className?: string;
}

/** Goal conversions panel: uniques, total, conversion rate over sage fill bars. */
export function GoalsPanel({
  goals,
  isLoading,
  isError,
  onManage,
  className,
}: GoalsPanelProps): ReactElement {
  const maxUniques = goals && goals.length > 0 ? Math.max(...goals.map(g => g.uniques), 1) : 1;

  return (
    <div className={cn('rounded-[20px] bg-white p-6 shadow-float', className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-bold tracking-[-0.01em] text-[#3D3B4F]">
          Goal Conversions
        </h3>
        {onManage && (
          <button
            onClick={onManage}
            className="flex items-center gap-1.5 rounded-full bg-muted px-3.5 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Manage goals
          </button>
        )}
      </div>

      {isError ? (
        <div className="flex flex-col items-center justify-center py-10">
          <AlertCircle className="mb-2 h-5 w-5 text-[#e07a5f]/60" strokeWidth={1.5} />
          <p className="text-[13px] text-[#e07a5f]">Failed to load goals</p>
        </div>
      ) : isLoading || !goals ? (
        <div className="space-y-2.5">
          {[85, 55, 30].map((w, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <div className="h-6 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />
              <div className="h-6 w-24 shrink-0 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : goals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10">
          <Target className="mb-2 h-5 w-5 text-[#B5B0AA]" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-[#9B9590]">No goals defined</p>
          <p className="mt-1 text-[12px] text-[#B5B0AA]">
            Track conversions by marking a custom event or page visit as a goal.
          </p>
          {onManage && (
            <button
              onClick={onManage}
              className="mt-3 rounded-full bg-muted px-4 py-2 text-[12px] font-semibold text-foreground hover:bg-[#E4E4E9] transition-colors cursor-pointer"
            >
              Add your first goal
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-[#B5B0AA]">
            <span>Goal</span>
            <div className="flex gap-5">
              <span className="w-14 text-right">Uniques</span>
              <span className="w-12 text-right">Total</span>
              <span className="w-12 text-right">CR</span>
            </div>
          </div>

          {goals.map(goal => (
            <div
              key={goal.id}
              className="relative flex h-[30px] items-center justify-between rounded-md px-2.5"
            >
              <div
                className="absolute inset-y-0 left-0 rounded-md bg-[#3D3B4F]/[0.05]"
                style={{ width: `${(goal.uniques / maxUniques) * 100}%` }}
              />
              <span className="relative z-10 flex items-center gap-2 truncate pr-4 text-[13px] text-[#3D3B4F]">
                {goal.name}
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-[#9B9590]">
                  {goal.type === 'event' ? goal.target : `visit ${goal.target}`}
                </span>
              </span>
              <div className="relative z-10 flex shrink-0 gap-5 text-[13px] font-medium tabular-nums text-[#3D3B4F]">
                <span className="w-14 text-right">{formatNumber(goal.uniques)}</span>
                <span className="w-12 text-right">{formatNumber(goal.events)}</span>
                <span className="w-12 text-right text-[#6E6C7C]">{goal.conversionRate}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
