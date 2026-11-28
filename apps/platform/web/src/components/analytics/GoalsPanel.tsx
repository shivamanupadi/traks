import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Target, AlertCircle, Plus, MoreHorizontal, Pencil, Copy, Trash2 } from 'lucide-react';
import type { GoalStat } from '@traks/shared';
import { cn, formatNumber } from '@/lib/utils';
import { api } from '@/lib/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { GoalDef } from './GoalFormModal';
import { TypeChip } from './TypeChip';

interface GoalsPanelProps {
  siteId: string;
  goals: GoalStat[] | undefined;
  isLoading: boolean;
  isError?: boolean;
  /** The manage callbacks are absent for view-only members, which hides the
   *  tile menus, the "New goal" tile, and "All goals". */
  onAdd?: () => void;
  onEdit?: (goal: GoalDef) => void;
  onDuplicate?: (goal: GoalDef) => void;
  onManage?: () => void;
  className?: string;
}

/** "signup · plan=pro" or "/docs/*": the rule a goal matches, in one line. */
function ruleLabel(goal: GoalStat): string {
  return goal.propKey && goal.propValue
    ? `${goal.target} · ${goal.propKey}=${goal.propValue}`
    : goal.target;
}

/**
 * Goal scorecards: one tile per goal with its conversion rate up front and a
 * meter filled to that rate. Each tile's menu edits, duplicates, or deletes
 * it in place; "All goals" opens the goals drawer.
 */
export function GoalsPanel({
  siteId,
  goals,
  isLoading,
  isError,
  onAdd,
  onEdit,
  onDuplicate,
  onManage,
  className,
}: GoalsPanelProps): ReactElement {
  const queryClient = useQueryClient();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const deleteGoal = useMutation({
    mutationFn: async (goalId: string) => api.deleteGoal(siteId, goalId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-goals', siteId] });
      queryClient.invalidateQueries({ queryKey: ['site-analytics', siteId, 'goals'] });
      // Conversions by source counts against the goal definitions too.
      queryClient.invalidateQueries({ queryKey: ['site-analytics', siteId, 'attribution'] });
      setConfirmId(null);
    },
    onError: (err: Error) => setDeleteError(err.message),
  });

  const canManage = Boolean(onEdit);
  const hasGoals = Boolean(goals && goals.length > 0);
  // Every goal gets a tile: view-only members have no drawer to reach a
  // capped-off remainder.
  const sorted = [...(goals ?? [])].sort((a, b) => b.uniques - a.uniques);

  return (
    <div className={cn('rounded-[20px] bg-card p-5 shadow-float sm:p-6', className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-bold tracking-[-0.01em] text-foreground">Goals</h3>
        <div className="flex items-center gap-2">
          {onManage && hasGoals && (
            <button
              onClick={onManage}
              className="rounded-full border border-border px-3.5 py-1.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            >
              All goals
            </button>
          )}
          {onAdd && (
            <button
              onClick={onAdd}
              className="flex items-center gap-1.5 rounded-full bg-btn px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-btn-hover transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              Add goal
            </button>
          )}
        </div>
      </div>

      {isError ? (
        <div className="flex flex-col items-center justify-center py-10">
          <AlertCircle className="mb-2 h-5 w-5 text-[#e07a5f]/60" strokeWidth={1.5} />
          <p className="text-[13px] text-[#e07a5f]">Failed to load goals</p>
        </div>
      ) : isLoading || !goals ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-[124px] animate-pulse rounded-[14px] bg-muted" />
          ))}
        </div>
      ) : goals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10">
          <Target className="mb-2 h-5 w-5 text-faint" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-subtle">No goals defined</p>
          <p className="mt-1 text-[12px] text-faint">
            Track conversions by marking a custom event or page visit as a goal.
          </p>
          {onAdd && (
            <button
              onClick={onAdd}
              className="mt-3 rounded-full bg-muted px-4 py-2 text-[12px] font-semibold text-foreground hover:bg-border transition-colors cursor-pointer"
            >
              Add your first goal
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {sorted.map(goal =>
              confirmId === goal.id ? (
                <div
                  key={goal.id}
                  className="flex min-h-[124px] flex-col justify-between rounded-[14px] bg-coral-soft p-3.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-foreground">
                      {goal.name}
                    </p>
                    <p className="mt-1 text-[12px] leading-snug text-[#e07a5f]">
                      Delete this goal? Past reports keep its history.
                    </p>
                  </div>
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => setConfirmId(null)}
                      className="rounded-full px-3 py-1 text-[12px] font-semibold text-muted-foreground hover:bg-card transition-colors cursor-pointer"
                    >
                      Keep
                    </button>
                    <button
                      onClick={() => deleteGoal.mutate(goal.id)}
                      disabled={deleteGoal.isPending}
                      className="rounded-full bg-[#e07a5f] px-3 py-1 text-[12px] font-semibold text-white hover:bg-[#c9694f] transition-colors cursor-pointer disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  key={goal.id}
                  className="min-w-0 rounded-[14px] bg-background p-3.5 transition-colors hover:bg-muted focus-within:bg-muted"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-foreground">
                        {goal.name}
                      </p>
                      <p
                        className="mt-0.5 truncate text-[11.5px] text-subtle"
                        title={ruleLabel(goal)}
                      >
                        {ruleLabel(goal)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <TypeChip type={goal.type} />
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label={`${goal.name} options`}
                            className="-mr-1 flex h-6 w-6 items-center justify-center rounded-lg text-faint transition-colors hover:bg-border hover:text-foreground cursor-pointer"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="w-36 border-0 shadow-float-lg">
                            <DropdownMenuItem
                              onClick={() => onEdit?.(goal)}
                              className="text-[12.5px] text-foreground"
                            >
                              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                              Edit
                            </DropdownMenuItem>
                            {onDuplicate && (
                              <DropdownMenuItem
                                onClick={() => onDuplicate(goal)}
                                className="text-[12.5px] text-foreground"
                              >
                                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                                Duplicate
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => {
                                setDeleteError('');
                                setConfirmId(goal.id);
                              }}
                              className="text-[12.5px] text-[#e07a5f]"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete…
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                  {/* Phones: rate beside its bar, so a stack of goals stays short. */}
                  <div className="mt-2.5 flex items-center gap-3 sm:block">
                    <p className="shrink-0 text-[20px] font-bold leading-none tracking-[-0.02em] tabular-nums text-foreground sm:text-[24px]">
                      {goal.conversionRate}%
                    </p>
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-border sm:mt-2.5">
                      <div
                        className="h-full rounded-full bg-btn"
                        style={{ width: `${Math.min(goal.conversionRate, 100)}%` }}
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-[11.5px] tabular-nums text-subtle">
                    {formatNumber(goal.uniques)} uniques · {formatNumber(goal.events)} total
                  </p>
                </div>
              )
            )}
            {onAdd && (
              <button
                onClick={onAdd}
                className="hidden min-h-[124px] items-center justify-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed sm:flex border-border text-[12.5px] font-semibold text-subtle hover:border-[#cbcad4] hover:text-foreground transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                New goal
              </button>
            )}
          </div>
          {deleteError && <p className="pt-3 text-[13px] text-[#e07a5f]">{deleteError}</p>}
        </>
      )}
    </div>
  );
}
