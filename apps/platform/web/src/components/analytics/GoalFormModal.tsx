import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Plus } from 'lucide-react';
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

export interface GoalDef {
  id: string;
  name: string;
  type: 'event' | 'page';
  target: string;
  propKey?: string | null;
  propValue?: string | null;
}

type GoalType = GoalDef['type'];

const TYPE_OPTIONS: { value: GoalType; label: string }[] = [
  { value: 'event', label: 'Custom event' },
  { value: 'page', label: 'Page visit' },
];

function Label({ children, extra }: { children: ReactNode; extra?: ReactNode }): ReactElement {
  return (
    <div className="mb-1.5 flex items-baseline justify-between text-[12px] font-semibold text-muted-foreground">
      <span>{children}</span>
      {extra && <span className="font-normal text-faint">{extra}</span>}
    </div>
  );
}

/** One-line readback of the rule as it will be saved. */
function rulePreview(
  type: GoalType,
  target: string,
  propKey: string,
  propValue: string
): ReactNode | null {
  const t = target.trim();
  if (!t) return null;
  const B = ({ children }: { children: ReactNode }): ReactElement => (
    <b className="font-semibold text-foreground">{children}</b>
  );
  if (type === 'page') {
    if (t.endsWith('/*')) {
      return (
        <>
          Counts when someone visits any page under <B>{t.slice(0, -1)}</B>.
        </>
      );
    }
    return (
      <>
        Counts when someone visits <B>{t}</B>.
      </>
    );
  }
  if (propKey.trim() && propValue.trim()) {
    return (
      <>
        Counts when <B>{t}</B> fires with{' '}
        <B>
          {propKey.trim()} = {propValue.trim()}
        </B>
        .
      </>
    );
  }
  return (
    <>
      Counts every time <B>{t}</B> fires.
    </>
  );
}

/** Add or edit a single goal. `goal` null = add, optionally prefilled from `draft`. */
export function GoalFormModal({
  open,
  onOpenChange,
  siteId,
  domain,
  goal,
  draft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  /** Site domain, shown as the fixed prefix of the path field. */
  domain?: string;
  goal: GoalDef | null;
  /** Starting values for a new goal, e.g. a duplicate of an existing one. */
  draft?: Omit<GoalDef, 'id'> | null;
}): ReactElement {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<GoalType>('event');
  const [target, setTarget] = useState('');
  const [propKey, setPropKey] = useState('');
  const [propValue, setPropValue] = useState('');
  const [error, setError] = useState('');
  const [touched, setTouched] = useState<{ name?: boolean; target?: boolean; prop?: boolean }>({});
  const editing = goal !== null;

  useEffect(() => {
    if (open) {
      const init = goal ?? draft;
      setName(init?.name ?? '');
      setType(init?.type ?? 'event');
      setTarget(init?.target ?? '');
      setPropKey(init?.propKey ?? '');
      setPropValue(init?.propValue ?? '');
      setError('');
      setTouched({});
    }
  }, [open, goal, draft]);

  const saveGoal = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        type,
        target: target.trim(),
        ...(type === 'event' && propKey.trim() && propValue.trim()
          ? { propKey: propKey.trim(), propValue: propValue.trim() }
          : {}),
      };
      return goal ? api.updateGoal(siteId, goal.id, body) : api.createGoal(siteId, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-goals', siteId] });
      // A goal change only moves the goals panel - refetching every mounted
      // dashboard panel here re-ran ~11 queries for identical numbers.
      queryClient.invalidateQueries({ queryKey: ['site-analytics', siteId, 'goals'] });
      // Conversions by source counts against the goal definitions too.
      queryClient.invalidateQueries({ queryKey: ['site-analytics', siteId, 'attribution'] });
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  // A page goal whose target lacks a leading slash (or an event goal that has
  // one) silently never converts, so it is caught here rather than discovered
  // weeks later from an empty panel.
  const nameError = requiredTextError(name, 100, 'Goal name');
  const targetErr = targetError(type, target);
  // Page goals never send a prop filter (see the save body), so a pair typed
  // before switching to "Page visit" must not block saving from out of view.
  const propError = type === 'event' ? propPairError(type, propKey, propValue) : null;
  const canSave = !nameError && !targetErr && !propError;
  // A half-typed prop pair reads back as the rule without it rather than
  // hiding the line: the dialog is centered, so every height change here
  // shifts the fields under the cursor.
  const preview = !targetErr
    ? rulePreview(type, target, propError ? '' : propKey, propError ? '' : propValue)
    : null;

  const submit = (): void => {
    setTouched({ name: true, target: true, prop: true });
    if (canSave) saveGoal.mutate();
  };
  const onEnter = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') submit();
  };
  const clearError = (): void => setError('');
  // Tabbing past an untouched field (or clicking the type toggle while the
  // autofocused name is still blank) shouldn't flash "required": empty
  // fields are flagged on submit instead.
  const markTouched = (e: React.FocusEvent<HTMLInputElement>, field: 'name' | 'target'): void => {
    if (e.currentTarget.value.trim()) setTouched(t => ({ ...t, [field]: true }));
  };

  // Switching type: the target and prop filter mean something different, so
  // reset their touched state rather than flashing errors for the old type.
  const pickType = (next: GoalType): void => {
    if (next === type) return;
    setType(next);
    setTouched(t => ({ name: t.name }));
    clearError();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${goal.name}` : 'New goal'}</DialogTitle>
          <DialogDescription>Count something visitors do as a conversion.</DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-4">
            <div
              role="radiogroup"
              aria-label="What counts"
              className="grid grid-cols-2 gap-[3px] rounded-[13px] bg-muted p-[3px]"
            >
              {TYPE_OPTIONS.map(opt => {
                const on = type === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={cn(
                      'cursor-pointer rounded-[10px] py-1.5 text-center text-[12.5px] font-semibold transition-colors',
                      'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-foreground/30',
                      on
                        ? 'bg-card text-foreground shadow-[0_0_0_1px_var(--border)]'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <input
                      type="radio"
                      name="goal-type"
                      value={opt.value}
                      checked={on}
                      onChange={() => pickType(opt.value)}
                      className="sr-only"
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>

            <div>
              <Label>Goal name</Label>
              <Input
                placeholder={type === 'event' ? 'e.g. Signed up' : 'e.g. Reached checkout'}
                value={name}
                maxLength={100}
                aria-invalid={touched.name && !!nameError}
                onChange={e => {
                  setName(e.target.value);
                  clearError();
                }}
                onBlur={e => markTouched(e, 'name')}
                onKeyDown={onEnter}
                className="h-10 px-4 text-[13px]"
                autoFocus
              />
              <FieldError message={touched.name ? nameError : null} />
            </div>

            {type === 'event' ? (
              <>
                <div>
                  <Label>Event name</Label>
                  <Input
                    placeholder="e.g. signup"
                    value={target}
                    maxLength={2048}
                    aria-invalid={touched.target && !!targetErr}
                    onChange={e => {
                      setTarget(e.target.value);
                      clearError();
                    }}
                    onBlur={e => markTouched(e, 'target')}
                    onKeyDown={onEnter}
                    className="h-10 px-4 text-[13px]"
                  />
                  <FieldError message={touched.target ? targetErr : null} />
                  {!(touched.target && targetErr) && (
                    <p className="mt-1.5 text-[11px] text-faint">
                      Send it with{' '}
                      <code className="rounded bg-muted px-1 py-0.5 text-muted-foreground">
                        traks(&apos;{target.trim() || 'signup'}&apos;
                        {propKey.trim() && propValue.trim()
                          ? `, { ${propKey.trim()}: '${propValue.trim()}' }`
                          : ''}
                        )
                      </code>
                    </p>
                  )}
                </div>
                <div>
                  <Label extra="optional">Only when a property matches</Label>
                  {/* Validated once focus leaves the pair: tabbing from key to
                    value must not flag the value that's about to be typed. */}
                  <div
                    className="flex items-center gap-2"
                    onBlur={e => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                        setTouched(t => ({ ...t, prop: true }));
                      }
                    }}
                  >
                    <Input
                      placeholder="e.g. reason"
                      value={propKey}
                      maxLength={128}
                      aria-invalid={touched.prop && !!propError}
                      onChange={e => {
                        setPropKey(e.target.value);
                        clearError();
                      }}
                      onKeyDown={onEnter}
                      className="h-10 px-4 text-[13px]"
                    />
                    <span className="shrink-0 text-[13px] text-faint">=</span>
                    <Input
                      placeholder="e.g. claimed"
                      value={propValue}
                      maxLength={512}
                      aria-invalid={touched.prop && !!propError}
                      onChange={e => {
                        setPropValue(e.target.value);
                        clearError();
                      }}
                      onKeyDown={onEnter}
                      className="h-10 px-4 text-[13px]"
                    />
                  </div>
                  <FieldError message={touched.prop ? propError : null} />
                </div>
              </>
            ) : (
              <div>
                <Label>Path</Label>
                <div
                  className={cn(
                    'flex h-10 items-center overflow-hidden rounded-2xl bg-muted transition-shadow focus-within:bg-card focus-within:shadow-[inset_0_0_0_1.5px_var(--ring)]',
                    touched.target && targetErr && 'shadow-[inset_0_0_0_1.5px_var(--destructive)]'
                  )}
                >
                  {domain && (
                    <span className="flex h-full max-w-[45%] shrink-0 items-center truncate border-r border-border pl-4 pr-3 font-mono text-[12px] text-subtle">
                      {domain}
                    </span>
                  )}
                  <input
                    placeholder="/thank-you"
                    value={target}
                    maxLength={2048}
                    aria-invalid={touched.target && !!targetErr}
                    onChange={e => {
                      setTarget(e.target.value);
                      clearError();
                    }}
                    onBlur={e => markTouched(e, 'target')}
                    onKeyDown={onEnter}
                    className="h-full min-w-0 flex-1 bg-transparent px-3 text-[13px] text-foreground outline-none placeholder:text-faint"
                  />
                </div>
                <FieldError message={touched.target ? targetErr : null} />
                {!(touched.target && targetErr) && (
                  <p className="mt-1.5 text-[11px] text-faint">
                    End with{' '}
                    <code className="rounded bg-muted px-1 py-0.5 text-muted-foreground">
                      {'/*'}
                    </code>{' '}
                    to count a whole section, e.g.{' '}
                    <code className="rounded bg-muted px-1 py-0.5 text-muted-foreground">
                      {'/blog/*'}
                    </code>
                  </p>
                )}
              </div>
            )}

            <div className="flex items-start gap-2.5 rounded-[14px] bg-background px-3.5 py-2.5 text-[12.5px] text-muted-foreground">
              <span
                className={cn(
                  'mt-[6px] h-2 w-2 shrink-0 rounded-full',
                  preview ? 'bg-[#28E99F]' : 'bg-border'
                )}
              />
              <span className={cn(!preview && 'text-faint')}>
                {preview ??
                  (target.trim()
                    ? `Fix the ${type === 'event' ? 'event name' : 'path'} to see what counts.`
                    : `Enter ${type === 'event' ? 'an event name' : 'a path'} to see what counts.`)}
              </span>
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
            isLoading={saveGoal.isPending}
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
                Add goal
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
