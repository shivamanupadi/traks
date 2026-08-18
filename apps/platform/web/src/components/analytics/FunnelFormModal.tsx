import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, X } from 'lucide-react';
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

function Label({ children, extra }: { children: ReactNode; extra?: ReactNode }): ReactElement {
  return (
    <div className="mb-1.5 flex items-baseline justify-between text-[12px] font-semibold text-[#6E6C7C]">
      <span>{children}</span>
      {extra && <span className="font-normal text-[#B5B0AA]">{extra}</span>}
    </div>
  );
}

/** Compact inline radio pair for a step's type — same radio idiom as goals,
 *  shrunk so eight of them don't dominate the form. */
function StepTypeRadios({
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
      className="flex items-center gap-3.5"
    >
      {(['page', 'event'] as const).map(t => {
        const on = value === t;
        return (
          <label key={t} className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name={`funnel-step-${index}-type`}
              value={t}
              checked={on}
              onChange={() => onChange(t)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className={cn(
                'flex h-[14px] w-[14px] items-center justify-center rounded-full border-[1.5px] transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[#3D3B4F]/30',
                on ? 'border-[#3D3B4F]' : 'border-[#B5B0AA]'
              )}
            >
              {on && <span className="h-[7px] w-[7px] rounded-full bg-[#3D3B4F]" />}
            </span>
            <span
              className={cn(
                'text-[12px] transition-colors',
                on ? 'font-semibold text-[#3D3B4F]' : 'font-medium text-[#9B9590]'
              )}
            >
              {t === 'page' ? 'Page visit' : 'Custom event'}
            </span>
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
          {i > 0 && <span className="text-[#B5B0AA]"> → </span>}
          {s.type === 'page' ? 'visit ' : 'fire '}
          <b className="font-semibold text-[#3D3B4F]">{s.target.trim()}</b>
          {s.type === 'event' && s.propKey?.trim() && s.propValue?.trim() && (
            <>
              {' '}
              with{' '}
              <b className="font-semibold text-[#3D3B4F]">
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

/** Add or edit a single funnel — name + ordered steps. `funnel` null = add. */
export function FunnelFormModal({
  open,
  onOpenChange,
  siteId,
  domain,
  funnel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  /** Site domain, shown as the fixed prefix of page-step paths. */
  domain?: string;
  funnel: FunnelDef | null;
}): ReactElement {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<FunnelStep[]>(EMPTY_STEPS);
  // Which event steps have their optional property filter expanded.
  const [filterOpen, setFilterOpen] = useState<boolean[]>([]);
  const [error, setError] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [touchedSteps, setTouchedSteps] = useState<boolean[]>([]);
  const editing = funnel !== null;

  useEffect(() => {
    if (open) {
      const initial = funnel
        ? funnel.steps.map(s => ({
            type: s.type,
            target: s.target,
            propKey: s.propKey ?? '',
            propValue: s.propValue ?? '',
          }))
        : EMPTY_STEPS;
      setName(funnel?.name ?? '');
      setSteps(initial);
      setFilterOpen(initial.map(s => Boolean(s.propKey || s.propValue)));
      setError('');
      setNameTouched(false);
      setTouchedSteps([]);
    }
  }, [open, funnel]);

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
      queryClient.invalidateQueries({ queryKey: ['site-analytics', siteId] });
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  // Each step carries the same page-vs-event target rule as a goal; a wrong
  // one makes the whole funnel read zero at that step forever.
  const nameError = requiredTextError(name, 100, 'Funnel name');
  const stepErrors = steps.map(
    s => targetError(s.type, s.target) ?? propPairError(s.type, s.propKey ?? '', s.propValue ?? '')
  );
  const canSave = !nameError && steps.length >= 2 && stepErrors.every(e => !e);
  const preview = stepErrors.every(e => !e) ? funnelPreview(steps) : null;

  const submit = (): void => {
    setTouchedSteps(steps.map(() => true));
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
  const touchStep = (i: number): void => {
    setTouchedSteps(prev => {
      const next = [...prev];
      next[i] = true;
      return next;
    });
  };
  const removeStep = (i: number): void => {
    setSteps(prev => prev.filter((_, idx) => idx !== i));
    setFilterOpen(prev => prev.filter((_, idx) => idx !== i));
    setTouchedSteps(prev => prev.filter((_, idx) => idx !== i));
  };
  const addStep = (): void => {
    setSteps(prev => [...prev, { type: 'page', target: '' }]);
    setFilterOpen(prev => [...prev, false]);
  };
  const setFilter = (i: number, on: boolean): void => {
    setFilterOpen(prev => {
      const next = [...prev];
      next[i] = on;
      return next;
    });
    if (!on) setStep(i, { propKey: '', propValue: '' });
  };

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
                onBlur={() => setNameTouched(true)}
                onKeyDown={onEnter}
                className="h-10 px-4 text-[13px]"
                autoFocus
              />
              <FieldError message={nameTouched ? nameError : null} />
            </div>

            <div>
              <Label extra={`${steps.length} of ${MAX_STEPS}`}>Steps, in order</Label>
              <ol className="space-y-2">
                {steps.map((step, i) => {
                  const showErr = !!touchedSteps[i] && !!stepErrors[i];
                  const hasFilter = step.type === 'event' && filterOpen[i];
                  return (
                    <li key={i} className="rounded-[14px] border border-[#E6E4DE] px-3.5 py-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#F2F1ED] font-mono text-[10.5px] font-semibold text-[#6E6C7C]">
                            {i + 1}
                          </span>
                          <StepTypeRadios
                            index={i}
                            value={step.type}
                            onChange={t => {
                              setStep(i, { type: t, propKey: '', propValue: '' });
                              setFilter(i, false);
                            }}
                          />
                        </div>
                        <button
                          onClick={() => removeStep(i)}
                          disabled={steps.length <= 2}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#B5B0AA] hover:bg-[#e07a5f]/10 hover:text-[#e07a5f] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#B5B0AA] disabled:cursor-default transition-colors cursor-pointer"
                          title={
                            steps.length <= 2 ? 'A funnel needs at least two steps' : 'Remove step'
                          }
                          aria-label={`Remove step ${i + 1}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {step.type === 'page' ? (
                        <div
                          className={cn(
                            'flex h-9 items-center overflow-hidden rounded-xl bg-[#F2F1ED] transition-shadow focus-within:bg-white focus-within:shadow-[inset_0_0_0_1.5px_var(--ring)]',
                            showErr && 'shadow-[inset_0_0_0_1.5px_var(--destructive)]'
                          )}
                        >
                          {domain && (
                            <span className="flex h-full max-w-[42%] shrink-0 items-center truncate border-r border-[#E6E4DE] pl-3 pr-2.5 font-mono text-[11.5px] text-[#9B9590]">
                              {domain}
                            </span>
                          )}
                          <input
                            placeholder="/pricing or /docs/*"
                            value={step.target}
                            maxLength={2048}
                            aria-invalid={showErr}
                            onChange={e => setStep(i, { target: e.target.value })}
                            onBlur={() => touchStep(i)}
                            onKeyDown={onEnter}
                            className="h-full min-w-0 flex-1 bg-transparent px-3 text-[13px] text-[#3D3B4F] outline-none placeholder:text-[#B5B0AA]"
                          />
                        </div>
                      ) : (
                        <>
                          <Input
                            placeholder="Event name, e.g. signup"
                            value={step.target}
                            maxLength={2048}
                            aria-invalid={showErr}
                            onChange={e => setStep(i, { target: e.target.value })}
                            onBlur={() => touchStep(i)}
                            onKeyDown={onEnter}
                            className="h-9 rounded-xl px-3 text-[13px]"
                          />
                          {hasFilter ? (
                            <div className="mt-2">
                              <div className="mb-1 flex items-baseline justify-between text-[11.5px] font-semibold text-[#6E6C7C]">
                                <span>Only when a property matches</span>
                                <button
                                  onClick={() => setFilter(i, false)}
                                  className="font-medium text-[#9B9590] hover:text-[#3D3B4F] transition-colors cursor-pointer"
                                >
                                  Remove
                                </button>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input
                                  placeholder="e.g. plan"
                                  value={step.propKey ?? ''}
                                  maxLength={128}
                                  aria-invalid={showErr}
                                  onChange={e => setStep(i, { propKey: e.target.value })}
                                  onBlur={() => touchStep(i)}
                                  onKeyDown={onEnter}
                                  className="h-8 rounded-xl px-3 text-[12px]"
                                />
                                <span className="shrink-0 text-[12px] text-[#B5B0AA]">=</span>
                                <Input
                                  placeholder="e.g. pro"
                                  value={step.propValue ?? ''}
                                  maxLength={512}
                                  aria-invalid={showErr}
                                  onChange={e => setStep(i, { propValue: e.target.value })}
                                  onBlur={() => touchStep(i)}
                                  onKeyDown={onEnter}
                                  className="h-8 rounded-xl px-3 text-[12px]"
                                />
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => setFilter(i, true)}
                              className="mt-1.5 text-[11.5px] font-semibold text-[#6E6C7C] hover:text-[#3D3B4F] transition-colors cursor-pointer"
                            >
                              + Only when a property matches
                            </button>
                          )}
                        </>
                      )}
                      {showErr && <FieldError message={stepErrors[i]} />}
                    </li>
                  );
                })}
              </ol>
              {steps.length < MAX_STEPS && (
                <button
                  onClick={addStep}
                  className="mt-2 flex items-center gap-1.5 rounded-full bg-[#F2F1ED] px-3 py-1.5 text-[12px] font-semibold text-[#3D3B4F] hover:bg-[#E6E4DE] transition-colors cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add step
                </button>
              )}
            </div>

            {preview && (
              <div className="flex items-start gap-2.5 rounded-[14px] bg-[#F9F8F6] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[#6E6C7C]">
                <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-[#28E99F]" />
                <span>{preview}</span>
              </div>
            )}
            {error && <p className="text-[13px] text-[#e07a5f]">{error}</p>}
          </div>
        </DialogBody>

        <DialogFooter className="border-t border-[#e6e5ea]/50 mx-6 px-0 pb-5 pt-4">
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
            className="bg-[#3D3B4F] hover:bg-[#2C2B3B] text-white shadow-none text-[13px] px-5 cursor-pointer"
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
