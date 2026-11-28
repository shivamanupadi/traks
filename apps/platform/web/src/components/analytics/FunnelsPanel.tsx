import { useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Filter,
  AlertCircle,
  Plus,
  ChevronDown,
  Check,
  MoreHorizontal,
  Pencil,
  Copy,
  Trash2,
} from 'lucide-react';
import type { FunnelDef, FunnelStat } from '@traks/shared';
import { cn, formatNumber } from '@/lib/utils';
import { api } from '@/lib/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TypeChip } from './TypeChip';

interface FunnelsPanelProps {
  siteId: string;
  funnels: FunnelDef[] | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
  stat: FunnelStat | undefined;
  isLoading: boolean;
  isError?: boolean;
  /** The manage callbacks are absent for view-only members, which hides the
   *  funnel menu and "All funnels". */
  onAdd?: () => void;
  onEdit?: (funnel: FunnelDef) => void;
  onDuplicate?: (funnel: FunnelDef) => void;
  onManage?: () => void;
  className?: string;
}

/** "trial_start · plan=pro": a step's target and optional prop condition. */
function stepLabel(step: { target: string; propKey?: string; propValue?: string }): string {
  return step.propKey && step.propValue
    ? `${step.target} · ${step.propKey}=${step.propValue}`
    : step.target;
}

/**
 * Funnel panel: one column per step. The solid bar is the share of step-1
 * sessions that reached the step (0-100 scale); the hatched band above it is
 * what was lost since the previous step. Under each column: sessions,
 * step-over-step conversion, and the drop. Overall conversion in the header.
 */
type StatStep = FunnelStat['steps'][number];

/** Step number, label and type chip; `children` trail at the end of the row. */
function StepHeading({
  step,
  index,
  className,
  children,
}: {
  step: StatStep;
  index: number;
  className?: string;
  children?: ReactNode;
}): ReactElement {
  const label = stepLabel(step);
  return (
    <div className={cn('flex items-center gap-1.5', className)} title={label}>
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] font-semibold text-muted-foreground">
        {index + 1}
      </span>
      <span className="min-w-0 truncate text-[12.5px] text-foreground">{label}</span>
      <TypeChip type={step.type} className="shrink-0" />
      {children}
    </div>
  );
}

/** "49% of previous · −630" under a step, or "entered" for the first. */
function StepRate({
  step,
  prev,
  className,
}: {
  step: StatStep;
  prev: StatStep | null;
  className?: string;
}): ReactElement {
  return (
    <p className={cn('text-[11.5px] tabular-nums text-subtle', className)}>
      {prev ? (
        <>
          {step.rateFromPrev}% of previous
          {prev.sessions > step.sessions && (
            <>
              {' · '}
              <span className="text-[#e07a5f]">−{formatNumber(prev.sessions - step.sessions)}</span>
            </>
          )}
        </>
      ) : (
        'entered'
      )}
    </p>
  );
}

export function FunnelsPanel({
  siteId,
  funnels,
  selectedId,
  onSelect,
  stat,
  isLoading,
  isError,
  onAdd,
  onEdit,
  onDuplicate,
  onManage,
  className,
}: FunnelsPanelProps): ReactElement {
  const queryClient = useQueryClient();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const deleteFunnel = useMutation({
    mutationFn: async (funnelId: string) => api.deleteFunnel(siteId, funnelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-funnels', siteId] });
      // A funnel change only moves the funnel panel - not the whole dashboard.
      queryClient.invalidateQueries({ queryKey: ['site-analytics', siteId, 'funnel'] });
      setConfirmId(null);
    },
    onError: (err: Error) => setDeleteError(err.message),
  });

  const hasFunnels = funnels !== undefined && funnels.length > 0;
  const selected = funnels?.find(f => f.id === selectedId);
  const overall =
    stat && stat.steps.length > 0 ? stat.steps[stat.steps.length - 1].rateFromFirst : null;
  const confirming = selected !== undefined && confirmId === selected.id;
  // No step-1 sessions means every rate is meaningless; draw empty wells.
  const hasEntries = Boolean(stat && stat.steps.length > 0 && stat.steps[0].sessions > 0);
  const heightOf = (i: number): number =>
    hasEntries && stat ? Math.min(Math.max(stat.steps[i].rateFromFirst, 0), 100) : 0;

  return (
    <div className={cn('rounded-[20px] bg-card p-5 shadow-float sm:p-6', className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="mr-1 text-[15px] font-bold tracking-[-0.01em] text-foreground">Funnels</h3>
          {/* Switcher and the funnel's own menu sit together: the menu acts
            on whichever funnel the switcher shows. */}
          <div className="flex min-w-0 items-center gap-0.5">
            {hasFunnels && funnels.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="flex max-w-[16rem] items-center gap-1.5 rounded-full border border-border py-1 pl-3 pr-2 text-[12.5px] font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer">
                  <span className="truncate">{selected?.name ?? 'Select funnel'}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-subtle" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="max-h-80 w-72 max-w-[calc(100vw-8rem)] overflow-y-auto border-0 p-1.5 shadow-float-lg"
                >
                  <p className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
                    Show funnel
                  </p>
                  {funnels.map(f => {
                    const on = f.id === selectedId;
                    return (
                      <DropdownMenuItem
                        key={f.id}
                        onClick={() => onSelect(f.id)}
                        className={cn(
                          'items-start gap-2.5 rounded-[10px] px-2.5 py-2 hover:bg-muted focus:bg-muted',
                          on && 'bg-muted'
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'block truncate text-[12.5px]',
                              on ? 'font-semibold text-foreground' : 'font-medium text-foreground'
                            )}
                          >
                            {f.name}
                          </span>
                          <span className="block truncate text-[11px] text-subtle">
                            {f.steps.length} steps · {f.steps[0]?.target} →{' '}
                            {f.steps[f.steps.length - 1]?.target}
                          </span>
                        </span>
                        <Check
                          className={cn(
                            'mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground',
                            !on && 'invisible'
                          )}
                        />
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              selected && (
                <span className="max-w-[16rem] truncate px-1 text-[12.5px] font-semibold text-muted-foreground">
                  {selected.name}
                </span>
              )
            )}
            {onEdit && selected && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`${selected.name} options`}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-subtle hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </DropdownMenuTrigger>
                {/* Phones: the button sits near the card's right edge, so the menu
                    opens leftward from it. */}
                <DropdownMenuContent
                  align="start"
                  className="w-52 border-0 p-1.5 shadow-float-lg max-sm:left-auto max-sm:right-0"
                >
                  <DropdownMenuItem
                    onClick={() => onEdit(selected)}
                    className="rounded-[10px] text-[12.5px] text-foreground hover:bg-muted focus:bg-muted"
                  >
                    <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">Edit &ldquo;{selected.name}&rdquo;</span>
                  </DropdownMenuItem>
                  {onDuplicate && (
                    <DropdownMenuItem
                      onClick={() => onDuplicate(selected)}
                      className="rounded-[10px] text-[12.5px] text-foreground hover:bg-muted focus:bg-muted"
                    >
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      Duplicate
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator className="bg-muted" />
                  <DropdownMenuItem
                    onClick={() => {
                      setDeleteError('');
                      setConfirmId(selected.id);
                    }}
                    className="rounded-[10px] text-[12.5px] text-[#e07a5f] hover:bg-coral-soft focus:bg-coral-soft"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {overall !== null && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
              {overall}% end to end
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onManage && hasFunnels && (
            <button
              onClick={onManage}
              className="rounded-full border border-border px-3.5 py-1.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            >
              All funnels
            </button>
          )}
          {onAdd && (
            <button
              onClick={onAdd}
              className="flex items-center gap-1.5 rounded-full bg-btn px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-btn-hover transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              Add funnel
            </button>
          )}
        </div>
      </div>

      {confirming && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-coral-soft px-4 py-3">
          <p className="min-w-0 text-[12.5px] text-[#e07a5f]">
            Delete <b className="font-semibold">{selected.name}</b>? Past reports keep its history.
          </p>
          <div className="flex shrink-0 gap-1">
            <button
              onClick={() => setConfirmId(null)}
              className="rounded-full px-3 py-1 text-[12px] font-semibold text-muted-foreground hover:bg-card transition-colors cursor-pointer"
            >
              Keep
            </button>
            <button
              onClick={() => deleteFunnel.mutate(selected.id)}
              disabled={deleteFunnel.isPending}
              className="rounded-full bg-[#e07a5f] px-3 py-1 text-[12px] font-semibold text-white hover:bg-[#c9694f] transition-colors cursor-pointer disabled:opacity-60"
            >
              Delete
            </button>
          </div>
        </div>
      )}
      {deleteError && <p className="mb-3 text-[13px] text-[#e07a5f]">{deleteError}</p>}

      {isError ? (
        <div className="flex flex-col items-center justify-center py-10">
          <AlertCircle className="mb-2 h-5 w-5 text-[#e07a5f]/60" strokeWidth={1.5} />
          <p className="text-[13px] text-[#e07a5f]">Failed to load funnel</p>
        </div>
      ) : !hasFunnels && funnels !== undefined ? (
        <div className="flex flex-col items-center justify-center py-10">
          <Filter className="mb-2 h-5 w-5 text-faint" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-subtle">No funnels yet</p>
          <p className="mt-1 max-w-[44ch] text-center text-[12px] text-faint">
            Chain pages and events into ordered steps to see where visitors drop off.
          </p>
          {onAdd && (
            <button
              onClick={onAdd}
              className="mt-3 rounded-full bg-muted px-4 py-2 text-[12px] font-semibold text-foreground hover:bg-border transition-colors cursor-pointer"
            >
              Create your first funnel
            </button>
          )}
        </div>
      ) : isLoading || !stat ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={i > 1 ? 'max-sm:hidden' : undefined}>
              <div className="h-[60px] animate-pulse rounded-xl bg-muted sm:h-[140px]" />
              <div className="mt-2.5 h-4 w-3/4 animate-pulse rounded bg-muted" />
              <div className="mt-1.5 h-6 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Phones: the same funnel turned on its side - one row per step, so
            the drop-off still reads in order instead of wrapping into a
            2x2 grid. The hatched track is the previous step's level. */}
          <ol className="space-y-3.5 sm:hidden">
            {stat.steps.map((step, i) => {
              const prev = i > 0 ? stat.steps[i - 1] : null;
              return (
                <li key={`${step.type}-${step.target}-${i}`} className="min-w-0">
                  <StepHeading step={step} index={i} className="min-w-0">
                    <span className="ml-auto shrink-0 pl-2 text-[15px] font-bold tabular-nums text-foreground">
                      {formatNumber(step.sessions)}
                    </span>
                  </StepHeading>
                  <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full bg-background">
                    {prev && (
                      <div
                        aria-hidden
                        className="absolute inset-y-0 left-0 bg-[repeating-linear-gradient(135deg,#f4e3dd_0_5px,#fbeee9_5px_10px)]"
                        style={{ width: `${heightOf(i - 1)}%` }}
                      />
                    )}
                    <div
                      aria-hidden
                      className="absolute inset-y-0 left-0 rounded-full bg-btn"
                      style={{
                        width: `${heightOf(i)}%`,
                        minWidth: step.sessions > 0 && hasEntries ? 4 : 0,
                      }}
                    />
                  </div>
                  <StepRate step={step} prev={prev} className="mt-1" />
                </li>
              );
            })}
          </ol>
          <ol
            className="hidden gap-x-3 gap-y-5 sm:grid sm:[grid-template-columns:var(--funnel-cols)]"
            style={
              {
                '--funnel-cols': `repeat(${stat.steps.length}, minmax(0, 1fr))`,
              } as CSSProperties
            }
          >
            {stat.steps.map((step, i) => {
              const prev = i > 0 ? stat.steps[i - 1] : null;
              const height = heightOf(i);
              return (
                <li key={`${step.type}-${step.target}-${i}`} className="min-w-0">
                  <div className="relative h-[140px] overflow-hidden rounded-xl bg-background">
                    {prev && (
                      <div
                        aria-hidden
                        className="absolute inset-x-0 bottom-0 bg-[repeating-linear-gradient(135deg,#f4e3dd_0_5px,#fbeee9_5px_10px)]"
                        style={{ height: `${heightOf(i - 1)}%` }}
                      />
                    )}
                    <div
                      aria-hidden
                      className="absolute inset-x-0 bottom-0 rounded-t-lg bg-btn"
                      style={{
                        height: `${height}%`,
                        minHeight: step.sessions > 0 && hasEntries ? 2 : 0,
                      }}
                    />
                  </div>
                  <StepHeading step={step} index={i} className="mt-2.5 min-w-0" />
                  <p className="mt-1 text-[20px] font-bold leading-tight tracking-[-0.02em] tabular-nums text-foreground">
                    {formatNumber(step.sessions)}
                  </p>
                  <StepRate step={step} prev={prev} />
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
