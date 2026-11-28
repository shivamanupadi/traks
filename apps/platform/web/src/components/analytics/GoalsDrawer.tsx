import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { GoalDef } from './GoalFormModal';
import { TypeChip } from './TypeChip';

/** Search only earns its space once the list is long enough to lose things in. */
const SEARCH_THRESHOLD = 8;

const MENU_ITEM = 'rounded-[10px] text-[12.5px] text-foreground hover:bg-muted focus:bg-muted';

/**
 * Right-side drawer listing every goal on the site as cards: rule, and the
 * dashboard period's conversions. Adding, editing and duplicating hand off to
 * the GoalFormModal (the dashboard closes the drawer first); delete is
 * confirmed inside the card.
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
  onDuplicate,
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
  onDuplicate?: (goal: GoalDef) => void;
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
      // A goal change only moves the goals panel - refetching every mounted
      // dashboard panel here re-ran ~11 queries for identical numbers.
      queryClient.invalidateQueries({ queryKey: ['site-analytics', siteId, 'goals'] });
      // Conversions by source counts against the goal definitions too.
      queryClient.invalidateQueries({ queryKey: ['site-analytics', siteId, 'attribution'] });
      setConfirmId(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const goals = ((goalsQ.data as any)?.data ?? []) as GoalDef[];
  const statsById = useMemo(() => new Map((stats ?? []).map(s => [s.id, s])), [stats]);
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
    <Drawer open={open} onOpenChange={onOpenChange} className="max-w-[460px]">
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
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-btn px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-btn-hover transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Add goal
          </button>
        </div>
      </DrawerHeader>

      <DrawerBody>
        {showSearch && (
          <div className="mb-2 flex h-[34px] items-center gap-2 rounded-xl bg-muted px-3 focus-within:bg-card focus-within:shadow-[inset_0_0_0_1.5px_var(--ring)] transition-shadow">
            <Search className="h-3.5 w-3.5 shrink-0 text-faint" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search goals"
              className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-faint"
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
            <p className="text-[13px] font-medium text-subtle">No goals yet</p>
            <p className="mt-1 text-[12px] text-faint">
              Mark a custom event or page visit as a conversion to start counting.
            </p>
          </div>
        )}
        {q && goals.length > 0 && visible.length === 0 && (
          <p className="py-8 text-center text-[12.5px] text-subtle">
            No goals match &ldquo;{query.trim()}&rdquo;.
          </p>
        )}

        <ul className="space-y-2">
          {visible.map(goal => {
            const stat = statsById.get(goal.id);
            const confirming = confirmId === goal.id;
            const rule =
              goal.propKey && goal.propValue
                ? `${goal.target} · ${goal.propKey}=${goal.propValue}`
                : goal.target;
            return (
              <li
                key={goal.id}
                className={cn(
                  'rounded-[14px] p-3.5 transition-colors',
                  confirming ? 'bg-coral-soft' : 'bg-background hover:bg-muted'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    onClick={() => onEdit(goal)}
                    className="min-w-0 flex-1 cursor-pointer text-left"
                    title="Edit goal"
                  >
                    <span className="block truncate text-[13.5px] font-semibold text-foreground">
                      {goal.name}
                    </span>
                    <span className="mt-1 flex min-w-0 items-center gap-1.5">
                      <TypeChip type={goal.type} />
                      <span className="truncate text-[11.5px] text-subtle" title={rule}>
                        {rule}
                      </span>
                    </span>
                  </button>
                  {!confirming && (
                    <div className="flex shrink-0 items-start gap-1">
                      {/* The period's numbers; "-" until the stats arrive or
                        for a goal the stats don't cover yet. */}
                      <div className="text-right">
                        <p
                          className={cn(
                            'text-[15px] font-bold leading-tight tabular-nums',
                            stat ? 'text-foreground' : 'text-faint'
                          )}
                        >
                          {stat ? `${stat.conversionRate}%` : '-'}
                        </p>
                        {stat && (
                          <p className="text-[11px] tabular-nums text-subtle">
                            {formatNumber(stat.uniques)} uniques
                          </p>
                        )}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          aria-label={`${goal.name} options`}
                          className="-mr-1 -mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-subtle hover:bg-border hover:text-foreground transition-colors cursor-pointer"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-44 border-0 p-1.5 shadow-float-lg">
                          <DropdownMenuItem onClick={() => onEdit(goal)} className={MENU_ITEM}>
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                            Edit
                          </DropdownMenuItem>
                          {onDuplicate && (
                            <DropdownMenuItem
                              onClick={() => onDuplicate(goal)}
                              className={MENU_ITEM}
                            >
                              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                              Duplicate
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator className="bg-muted" />
                          <DropdownMenuItem
                            onClick={() => {
                              setError('');
                              setConfirmId(goal.id);
                            }}
                            className="rounded-[10px] text-[12.5px] text-[#e07a5f] hover:bg-coral-soft focus:bg-coral-soft"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete…
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>

                {confirming && (
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[12px] text-[#e07a5f]">
                      Delete this goal? Past reports keep its history.
                    </p>
                    <div className="flex shrink-0 items-center gap-1">
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
                )}
              </li>
            );
          })}
        </ul>
        {error && <p className="pt-2 text-[13px] text-[#e07a5f]">{error}</p>}
      </DrawerBody>

      <DrawerFooter>
        <span className="text-[11.5px] text-faint">Conversions · {periodLabel}</span>
        <button
          onClick={() => onOpenChange(false)}
          className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
        >
          Done
        </button>
      </DrawerFooter>
    </Drawer>
  );
}
