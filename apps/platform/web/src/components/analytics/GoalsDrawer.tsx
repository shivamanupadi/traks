import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { GoalStat } from '@traks/shared';
import { cn, formatNumber } from '@/lib/utils';
import { api } from '@/lib/api';
import {
  Drawer,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerBody,
  DrawerFooter,
} from '@/components/ui/drawer';
import type { GoalDef } from './GoalFormModal';
import { TypeChip } from './TypeChip';

/** Search only earns its space once the list is long enough to lose things in. */
const SEARCH_THRESHOLD = 8;

/**
 * Right-side drawer listing every goal on the site. Adding and editing open
 * the GoalFormModal on top of the drawer (the drawer stays mounted); delete
 * is inline with a second-click confirm.
 */
export function GoalsDrawer({
  open,
  onOpenChange,
  siteId,
  siteLabel,
  stats,
  periodLabel,
  onAdd,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  /** Shown under the title, e.g. the site domain. */
  siteLabel?: string;
  /** Per-goal conversions for the dashboard's current period, keyed by id. */
  stats?: GoalStat[];
  /** Human label for the period the counts cover, e.g. "Last 30 days". */
  periodLabel: string;
  onAdd: () => void;
  onEdit: (goal: GoalDef) => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError('');
      setQuery('');
      setConfirmId(null);
    }
  }, [open]);

  const goalsQ = useQuery({
    queryKey: ['site-goals', siteId],
    queryFn: async () => api.getGoals(siteId),
    enabled: open,
    staleTime: 60_000,
  });

  const deleteGoal = useMutation({
    mutationFn: async (goalId: string) => api.deleteGoal(siteId, goalId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-goals', siteId] });
      queryClient.invalidateQueries({ queryKey: ['site-analytics', siteId] });
      setConfirmId(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const goals = ((goalsQ.data as any)?.data ?? []) as GoalDef[];
  const uniquesById = useMemo(() => new Map((stats ?? []).map(s => [s.id, s.uniques])), [stats]);
  const showSearch = goals.length > SEARCH_THRESHOLD;
  const q = query.trim().toLowerCase();
  const visible = q
    ? goals.filter(
        g =>
          g.name.toLowerCase().includes(q) ||
          g.target.toLowerCase().includes(q) ||
          (g.propKey ?? '').toLowerCase().includes(q) ||
          (g.propValue ?? '').toLowerCase().includes(q)
      )
    : goals;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerHeader onClose={() => onOpenChange(false)}>
        <div className="flex items-start justify-between gap-3 pr-2">
          <div className="min-w-0">
            <DrawerTitle>Goals</DrawerTitle>
            <DrawerDescription className="truncate">
              {goalsQ.isLoading
                ? 'Loading…'
                : `${goals.length} ${goals.length === 1 ? 'goal' : 'goals'}${siteLabel ? ` · ${siteLabel}` : ''}`}
            </DrawerDescription>
          </div>
          <button
            onClick={onAdd}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#3D3B4F] px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-[#2C2B3B] transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Add goal
          </button>
        </div>
      </DrawerHeader>

      <DrawerBody>
        {showSearch && (
          <div className="mb-2 flex h-[34px] items-center gap-2 rounded-xl bg-[#F2F1ED] px-3 focus-within:bg-white focus-within:shadow-[inset_0_0_0_1.5px_var(--ring)] transition-shadow">
            <Search className="h-3.5 w-3.5 shrink-0 text-[#B5B0AA]" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search goals"
              className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] text-[#3D3B4F] outline-none placeholder:text-[#B5B0AA]"
            />
          </div>
        )}

        {goalsQ.isError && (
          <p className="py-6 text-center text-[12.5px] text-[#e07a5f]">
            Couldn&rsquo;t load your goals.
          </p>
        )}
        {goalsQ.isLoading && (
          <div className="space-y-2 pt-1">
            {[80, 60, 70].map((w, i) => (
              <div key={i} className="flex items-center justify-between py-2">
                <div className="h-8 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />
                <div className="h-4 w-10 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        )}
        {!goalsQ.isLoading && !goalsQ.isError && goals.length === 0 && (
          <div className="py-10 text-center">
            <p className="text-[13px] font-medium text-[#9B9590]">No goals yet</p>
            <p className="mt-1 text-[12px] text-[#B5B0AA]">
              Mark a custom event or page visit as a conversion to start counting.
            </p>
          </div>
        )}
        {q && goals.length > 0 && visible.length === 0 && (
          <p className="py-8 text-center text-[12.5px] text-[#9B9590]">
            No goals match &ldquo;{query.trim()}&rdquo;.
          </p>
        )}

        <ul className="-mx-1.5">
          {visible.map(goal => {
            const uniques = uniquesById.get(goal.id);
            const confirming = confirmId === goal.id;
            return (
              <li
                key={goal.id}
                className={cn(
                  'group flex items-center justify-between gap-3 rounded-xl px-1.5 py-2.5 transition-colors',
                  'border-b border-[#E6E4DE] last:border-b-0 hover:border-transparent hover:bg-[#F9F8F6]',
                  confirming && 'border-transparent bg-[#fdf1ed]'
                )}
                onMouseLeave={() => {
                  if (confirming && !deleteGoal.isPending) setConfirmId(null);
                }}
              >
                <button
                  onClick={() => onEdit(goal)}
                  className="min-w-0 flex-1 cursor-pointer text-left"
                  title="Edit goal"
                >
                  <p className="truncate text-[13px] font-medium text-[#3D3B4F]">{goal.name}</p>
                  {confirming ? (
                    <p className="mt-0.5 text-[11.5px] text-[#e07a5f]">
                      Delete this goal? Past reports keep its history.
                    </p>
                  ) : (
                    <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-[#9B9590]">
                      <TypeChip type={goal.type} />
                      <span className="truncate">
                        {goal.target}
                        {goal.propKey && goal.propValue && ` · ${goal.propKey} = ${goal.propValue}`}
                      </span>
                    </p>
                  )}
                </button>

                {confirming ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => setConfirmId(null)}
                      className="rounded-full px-2.5 py-1 text-[12px] font-semibold text-[#6E6C7C] hover:bg-white transition-colors cursor-pointer"
                    >
                      Keep
                    </button>
                    <button
                      onClick={() => deleteGoal.mutate(goal.id)}
                      disabled={deleteGoal.isPending}
                      className="rounded-full bg-[#e07a5f] px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-[#c9694f] transition-colors cursor-pointer disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                ) : (
                  <div className="relative flex shrink-0 items-center">
                    <span
                      className={cn(
                        'text-[12.5px] tabular-nums text-[#6E6C7C] transition-opacity group-hover:opacity-0 group-focus-within:opacity-0',
                        uniques === undefined && 'text-[#B5B0AA]'
                      )}
                    >
                      {uniques === undefined ? '-' : formatNumber(uniques)}
                    </span>
                    <div className="absolute right-0 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <button
                        onClick={() => onEdit(goal)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-[#6E6C7C] hover:bg-[#E6E4DE] hover:text-[#3D3B4F] transition-colors cursor-pointer"
                        title="Edit goal"
                        aria-label={`Edit ${goal.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setConfirmId(goal.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-[#e07a5f] hover:bg-[#e07a5f]/10 transition-colors cursor-pointer"
                        title="Delete goal"
                        aria-label={`Delete ${goal.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {error && <p className="pt-2 text-[13px] text-[#e07a5f]">{error}</p>}
      </DrawerBody>

      <DrawerFooter>
        <span className="text-[11.5px] text-[#B5B0AA]">Conversions · {periodLabel}</span>
        <button
          onClick={() => onOpenChange(false)}
          className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold text-[#6E6C7C] hover:bg-muted hover:text-[#3D3B4F] transition-colors cursor-pointer"
        >
          Done
        </button>
      </DrawerFooter>
    </Drawer>
  );
}
