import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, GripVertical, Plus, X } from 'lucide-react';
import type { FunnelDef, FunnelStep } from '@traks/shared';
import { requiredTextError, targetError, propPairError } from '@traks/shared';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldError } from '@/components/ui/field-error';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog';

const MAX_STEPS = 8;
const EMPTY_STEPS: FunnelStep[] = [
  { type: 'page', target: '' },
  { type: 'event', target: '' },
];

type StepType = FunnelStep['type'];

/** Per-step "has the user left this yet": target and prop pair separately,
 *  so a half-typed pair doesn't flag while the target is fine and vice versa. */
interface StepTouched {
  target?: boolean;
  prop?: boolean;
}

function Label({ children, extra }: { children: ReactNode; extra?: ReactNode }): ReactElement {
  return (
    <div className="mb-1.5 flex items-baseline justify-between text-[12px] font-semibold text-muted-foreground">
      <span>{children}</span>
      {extra && <span className="font-normal text-faint">{extra}</span>}
    </div>
  );
}

/** Compact Page / Event segmented control for a step's type. */
function StepTypeToggle({
  index,
  value,
  onChange,
}: {
  index: number;
  value: StepType;
  onChange: (t: StepType) => void;
}): ReactElement {
  return (
    <div
      role="radiogroup"
      aria-label={`Step ${index + 1} type`}
      className="grid shrink-0 grid-cols-2 gap-[2px] rounded-[10px] bg-muted p-[2px]"
    >
      {(['page', 'event'] as const).map(t => {
        const on = value === t;
        return (
          <label
            key={t}
            className={cn(
              'cursor-pointer rounded-[8px] px-2 py-1 text-center text-[11.5px] font-semibold transition-colors',
              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-foreground/30',
              on
                ? 'bg-card text-foreground shadow-[0_0_0_1px_var(--border)]'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <input
              type="radio"
              name={`funnel-step-${index}-type`}
              value={t}
              checked={on}
              onChange={() => onChange(t)}
              className="sr-only"
            />
            {t === 'page' ? 'Page' : 'Event'}
          </label>
        );
      })}
    </div>
  );
}

/** One-line readback of the funnel as it will be saved. */
function funnelPreview(steps: FunnelStep[]): ReactNode | null {
  const filled = steps.filter(s => s.target.trim());
  if (filled.length < 2) return null;
  return (
    <>
      Counts sessions that{' '}
      {filled.map((s, i) => (
        <span key={i}>
          {i > 0 && <span className="text-faint"> → </span>}
          {s.type === 'page' ? 'visit ' : 'fire '}
          <b className="font-semibold text-foreground">{s.target.trim()}</b>
          {s.type === 'event' && s.propKey?.trim() && s.propValue?.trim() && (
            <>
              {' '}
              with{' '}
              <b className="font-semibold text-foreground">
                {s.propKey.trim()} = {s.propValue.trim()}
              </b>
            </>
          )}
        </span>
      ))}
      , in that order.
    </>
  );
}

/** Move one entry of an array from index `from` to index `to`. */
function moved<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Add or edit a single funnel - name + ordered steps. `funnel` null = add,
 * optionally prefilled from `draft` (e.g. a duplicate).
 */
export function FunnelFormModal({
  open,
  onOpenChange,
  siteId,
  domain,
  funnel,
  draft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  /** Site domain, shown as the fixed prefix of page-step paths. */
  domain?: string;
  funnel: FunnelDef | null;
  /** Starting values for a new funnel, e.g. a duplicate of an existing one. */
  draft?: Omit<FunnelDef, 'id'> | null;
}): ReactElement {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<FunnelStep[]>(EMPTY_STEPS);
  // Stable per-step React keys, so reordering moves rows (and focus) with
  // their step instead of re-labelling rows in place.
  const [keys, setKeys] = useState<number[]>([]);
  const nextKey = useRef(0);
  // Which event steps have their optional property filter expanded.
  const [filterOpen, setFilterOpen] = useState<boolean[]>([]);
  const [error, setError] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [touched, setTouched] = useState<StepTouched[]>([]);
  // Row being dragged (armed from its grip), for pointer reordering.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const editing = funnel !== null;

  const newKeys = (n: number): number[] =>
    Array.from({ length: n }, () => {
      nextKey.current += 1;
      return nextKey.current;
    });

  useEffect(() => {
    if (open) {
      const source = funnel ?? draft;
      const initial = source
        ? source.steps.map(s => ({
            type: s.type,
            target: s.target,
            propKey: s.propKey ?? '',
            propValue: s.propValue ?? '',
          }))
        : EMPTY_STEPS;
      setName(source?.name ?? '');
      setSteps(initial);
      setKeys(newKeys(initial.length));
      setFilterOpen(initial.map(s => Boolean(s.propKey || s.propValue)));
      setError('');
      setNameTouched(false);
      setTouched([]);
      setDragFrom(null);
      setArmed(null);
    }
    // newKeys only bumps a ref; it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, funnel, draft]);

  const saveFunnel = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        steps: steps.map(s => ({
          type: s.type,
          target: s.target.trim(),
          ...(s.type === 'event' && s.propKey?.trim() && s.propValue?.trim()
            ? { propKey: s.propKey.trim(), propValue: s.propValue.trim() }
            : {}),
        })),
      };
      return funnel ? api.updateFunnel(siteId, funnel.id, body) : api.createFunnel(siteId, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-funnels', siteId] });
      // A funnel change only moves the funnel panel - not the whole dashboard.
      queryClient.invalidateQueries({ queryKey: ['site-analytics', siteId, 'funnel'] });
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  // Each step carries the same page-vs-event target rule as a goal; a wrong
  // one makes the whole funnel read zero at that step forever.
  const nameError = requiredTextError(name, 100, 'Funnel name');
  const targetErrors = steps.map(s => targetError(s.type, s.target));
  const propErrors = steps.map(s => propPairError(s.type, s.propKey ?? '', s.propValue ?? ''));
  const stepErrors = steps.map((_, i) => targetErrors[i] ?? propErrors[i]);
  const canSave = !nameError && steps.length >= 2 && stepErrors.every(e => !e);
  const preview = stepErrors.every(e => !e) ? funnelPreview(steps) : null;
  const shownError = (i: number): string | null =>
    (touched[i]?.target ? targetErrors[i] : null) ?? (touched[i]?.prop ? propErrors[i] : null);

  const submit = (): void => {
    setTouched(steps.map(() => ({ target: true, prop: true })));
    setNameTouched(true);
    if (canSave) saveFunnel.mutate();
  };
  const onEnter = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') submit();
  };

  const setStep = (i: number, patch: Partial<FunnelStep>): void => {
    setSteps(prev => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    setError('');
  };
  const touchStep = (i: number, field: keyof StepTouched): void => {
    setTouched(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: true };
      return next;
    });
  };
  // Leaving an empty target isn't an error yet (submit flags it) - tabbing
  // through a fresh step shouldn't paint it red.
  const touchTarget = (i: number, value: string): void => {
    if (value.trim()) touchStep(i, 'target');
  };
  const removeStep = (i: number): void => {
    setSteps(prev => prev.filter((_, idx) => idx !== i));
    setKeys(prev => prev.filter((_, idx) => idx !== i));
    setFilterOpen(prev => prev.filter((_, idx) => idx !== i));
    setTouched(prev => prev.filter((_, idx) => idx !== i));
  };
  const addStep = (): void => {
    setSteps(prev => [...prev, { type: 'page', target: '' }]);
    setKeys(prev => [...prev, ...newKeys(1)]);
    setFilterOpen(prev => [...prev, false]);
  };
  const moveStep = (from: number, to: number): void => {
    if (to < 0 || to >= steps.length || from === to) return;
    setSteps(prev => moved(prev, from, to));
    setKeys(prev => moved(prev, from, to));
    // Pad before moving: these arrays only grow as steps are touched/opened.
    setFilterOpen(prev =>
      moved(
        steps.map((_, i) => prev[i] ?? false),
        from,
        to
      )
    );
    setTouched(prev =>
      moved(
        steps.map((_, i) => prev[i] ?? {}),
        from,
        to
      )
    );
  };
  const setFilter = (i: number, on: boolean): void => {
    setFilterOpen(prev => {
      const next = [...prev];
      next[i] = on;
      return next;
    });
    if (!on) setStep(i, { propKey: '', propValue: '' });
  };

  const readbackHint = steps.some(s => !s.target.trim())
    ? 'Fill in every step to see what counts.'
    : 'Fix the steps above to see what counts.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${funnel.name}` : 'New funnel'}</DialogTitle>
          <DialogDescription>
            Ordered steps a visitor completes in one session; the panel shows where they drop off.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="max-h-[70vh] overflow-y-auto">
          <div className="space-y-4">
            <div>
              <Label>Funnel name</Label>
              <Input
                placeholder="e.g. Signup flow"
                value={name}
                maxLength={100}
                aria-invalid={nameTouched && !!nameError}
                onChange={e => {
                  setName(e.target.value);
                  setError('');
                }}
                onBlur={e => {
                  if (e.currentTarget.value.trim()) setNameTouched(true);
                }}
                onKeyDown={onEnter}
                className="h-10 px-4 text-[13px]"
                autoFocus
              />
              <FieldError message={nameTouched ? nameError : null} />
            </div>

            <div>
              <Label extra={`${steps.length} of ${MAX_STEPS}`}>Steps, in order</Label>
              <ol className="space-y-1.5">
                {steps.map((step, i) => {
                  const err = shownError(i);
                  const hasFilter = step.type === 'event' && filterOpen[i];
                  return (
                    <li
                      key={keys[i] ?? `i${i}`}
                      draggable={armed === i}
                      onDragStart={e => {
                        setDragFrom(i);
                        e.dataTransfer.effectAllowed = 'move';
                        // Firefox only starts a drag that carries data.
                        e.dataTransfer.setData('text/plain', String(i + 1));
                      }}
                      onDragOver={e => {
                        if (dragFrom === null) return;
                        e.preventDefault();
                        if (dragFrom === i) return;
                        // Swap once the pointer crosses the row's midpoint,
                        // so rows of different heights don't flip back.
                        const r = e.currentTarget.getBoundingClientRect();
                        const past =
                          dragFrom < i
                            ? e.clientY > r.top + r.height / 2
                            : e.clientY < r.top + r.height / 2;
                        if (past) {
                          moveStep(dragFrom, i);
                          setDragFrom(i);
                        }
                      }}
                      onDrop={e => e.preventDefault()}
                      onDragEnd={() => {
                        setDragFrom(null);
                        setArmed(null);
                      }}
                      className={cn(
                        'rounded-xl transition-opacity',
                        dragFrom === i && 'opacity-50'
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onPointerDown={() => setArmed(i)}
                          onPointerUp={() => setArmed(null)}
                          onKeyDown={e => {
                            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                              e.preventDefault();
                              moveStep(i, e.key === 'ArrowUp' ? i - 1 : i + 1);
                            }
                          }}
                          className="flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded-md text-faint hover:bg-muted hover:text-muted-foreground active:cursor-grabbing transition-colors"
                          title="Drag, or use the arrow keys, to reorder"
                          aria-label={`Reorder step ${i + 1} (arrow keys move it)`}
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </button>
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] font-semibold text-muted-foreground">
                          {i + 1}
                        </span>
                        <StepTypeToggle
                          index={i}
                          value={step.type}
                          onChange={t => {
                            setStep(i, { type: t, propKey: '', propValue: '' });
                            setFilter(i, false);
                            // The target means something else now; don't
                            // flash the old type's error at it.
                            setTouched(prev => {
                              const next = [...prev];
                              next[i] = {};
                              return next;
                            });
                          }}
                        />
                        {step.type === 'page' ? (
                          <div
                            className={cn(
                              'flex h-9 min-w-0 flex-1 items-center overflow-hidden rounded-xl bg-muted transition-shadow focus-within:bg-card focus-within:shadow-[inset_0_0_0_1.5px_var(--ring)]',
                              touched[i]?.target &&
                                targetErrors[i] &&
                                'shadow-[inset_0_0_0_1.5px_var(--destructive)]'
                            )}
                          >
                            {/* The domain prefix is context; phones keep the room for the path. */}
                            {domain && (
                              <span className="flex h-full max-w-[40%] shrink-0 items-center truncate max-sm:hidden border-r border-border pl-3 pr-2 font-mono text-[11px] text-subtle">
                                {domain}
                              </span>
                            )}
                            <input
                              placeholder="/pricing or /docs/*"
                              value={step.target}
                              maxLength={2048}
                              aria-label={`Step ${i + 1} path`}
                              aria-invalid={!!touched[i]?.target && !!targetErrors[i]}
                              onChange={e => setStep(i, { target: e.target.value })}
                              onBlur={e => touchTarget(i, e.currentTarget.value)}
                              onKeyDown={onEnter}
                              className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-[13px] text-foreground outline-none placeholder:text-faint"
                            />
                          </div>
                        ) : (
                          <Input
                            placeholder="e.g. signup"
                            value={step.target}
                            maxLength={2048}
                            aria-label={`Step ${i + 1} event name`}
                            aria-invalid={!!touched[i]?.target && !!targetErrors[i]}
                            onChange={e => setStep(i, { target: e.target.value })}
                            onBlur={e => touchTarget(i, e.currentTarget.value)}
                            onKeyDown={onEnter}
                            className="h-9 min-w-0 flex-1 rounded-xl px-3 text-[13px]"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => removeStep(i)}
                          disabled={steps.length <= 2}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint hover:bg-[#e07a5f]/10 hover:text-[#e07a5f] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-faint disabled:cursor-default transition-colors cursor-pointer"
                          title={
                            steps.length <= 2 ? 'A funnel needs at least two steps' : 'Remove step'
                          }
                          aria-label={`Remove step ${i + 1}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {step.type === 'event' && (
                        <div className="pl-[52px] pr-9">
                          {hasFilter ? (
                            <div className="mt-1.5">
                              <div className="mb-1 flex items-baseline justify-between text-[11.5px] font-semibold text-muted-foreground">
                                <span>Only when a property matches</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFilter(i, false);
                                    setTouched(prev => {
                                      const next = [...prev];
                                      next[i] = { ...next[i], prop: false };
                                      return next;
                                    });
                                  }}
                                  className="font-medium text-subtle hover:text-foreground transition-colors cursor-pointer"
                                >
                                  Remove
                                </button>
                              </div>
                              {/* Validated once focus leaves the pair: tabbing
                                from key to value must not flag the value. */}
                              <div
                                className="flex items-center gap-2"
                                onBlur={e => {
                                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                                    touchStep(i, 'prop');
                                  }
                                }}
                              >
                                <Input
                                  placeholder="e.g. plan"
                                  value={step.propKey ?? ''}
                                  maxLength={128}
                                  aria-label={`Step ${i + 1} property`}
                                  aria-invalid={!!touched[i]?.prop && !!propErrors[i]}
                                  onChange={e => setStep(i, { propKey: e.target.value })}
                                  onKeyDown={onEnter}
                                  className="h-8 rounded-xl px-3 text-[12px]"
                                />
                                <span className="shrink-0 text-[12px] text-faint">=</span>
                                <Input
                                  placeholder="e.g. pro"
                                  value={step.propValue ?? ''}
                                  maxLength={512}
                                  aria-label={`Step ${i + 1} property value`}
                                  aria-invalid={!!touched[i]?.prop && !!propErrors[i]}
                                  onChange={e => setStep(i, { propValue: e.target.value })}
                                  onKeyDown={onEnter}
                                  className="h-8 rounded-xl px-3 text-[12px]"
                                />
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setFilter(i, true)}
                              className="mt-1 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            >
                              + Only when a property matches
                            </button>
                          )}
                        </div>
                      )}
                      {err && (
                        <div className="pl-[52px]">
                          <FieldError message={err} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
              {steps.length < MAX_STEPS && (
                <button
                  type="button"
                  onClick={addStep}
                  className="mt-2.5 flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-border transition-colors cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add step
                </button>
              )}
            </div>

            {/* Always holds its row: the dialog is centered, so the line
              appearing or vanishing would shift the steps under the cursor. */}
            <div className="flex items-start gap-2.5 rounded-[14px] bg-background px-3.5 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
              <span
                className={cn(
                  'mt-[7px] h-2 w-2 shrink-0 rounded-full',
                  preview ? 'bg-[#28E99F]' : 'bg-border'
                )}
              />
              <span className={cn(!preview && 'text-faint')}>{preview ?? readbackHint}</span>
            </div>
            {error && <p className="text-[13px] text-[#e07a5f]">{error}</p>}
          </div>
        </DialogBody>

        <DialogFooter className="border-t border-border/50 mx-6 px-0 pb-5 pt-4">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-[13px] cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            isLoading={saveFunnel.isPending}
            className="bg-btn hover:bg-btn-hover text-white shadow-none text-[13px] px-5 cursor-pointer"
          >
            {editing ? (
              <>
                <Check className="w-3.5 h-3.5" />
                Save changes
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                Create funnel
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
