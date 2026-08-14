import { useState, useEffect, useCallback, useRef, type ReactElement } from 'react';
import { createLazyFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Settings,
  Code2,
  Copy,
  Check,
  Zap,
  Trash2,
  X,
  Filter,
  Target,
  Plus,
  Bookmark,
  BookmarkPlus,
  Globe,
  Pencil,
  MoreHorizontal,
} from 'lucide-react';
import type {
  Period,
  MainStats,
  FunnelDef,
  FunnelStat,
  FunnelStep,
  SegmentDef,
  SegmentFilters,
} from '@traks/shared';
import { INSTALL_GUIDES, findInstallGuide, guideWithSnippet, trackerSnippet } from '@traks/shared';
import { cn, formatNumber, formatDuration, formatPercentChange } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TimezoneSelect } from '@/components/ui/timezone-select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TimeseriesChart } from '@/components/analytics/TimeseriesChart';
import { PanelCard, type PanelItem } from '@/components/analytics/PanelCard';
import { CountryFlag, countryName } from '@/components/analytics/CountryFlag';
import { DimensionIcon } from '@/components/analytics/DimensionIcon';
import { GoalsPanel } from '@/components/analytics/GoalsPanel';
import { FunnelsPanel } from '@/components/analytics/FunnelsPanel';
import { PeriodPicker } from '@/components/layout/PeriodPicker';
import { api, type AnalyticsFilters } from '@/lib/api';
import { FieldError } from '@/components/ui/field-error';
import {
  domainInputError,
  normalizeDomain,
  propPairError,
  requiredTextError,
  targetError,
} from '@traks/shared';
import { useCollectUrl } from '@/lib/config';

// Auto-poll only 'today' - it's served live from the site's Durable Object
// (millisecond queries, zero ingest delay), so a 15s poll gives a live feel
// at negligible cost. Historical periods barely change and are covered by
// staleTime + the manual refresh button.
function getRefetchInterval(period: Period): number | false {
  return period === 'today' ? 15_000 : false;
}

// staleTime per period - longer periods change less frequently
function getStaleTime(period: Period): number {
  switch (period) {
    case 'today':
      return 15_000;
    case '7d':
      return 60_000;
    case '30d':
      return 120_000;
    case '90d':
      return 300_000;
    default:
      return 300_000;
  }
}

// Lazy-render hook: returns true once the sentinel element scrolls into view
function useLazyVisible(): [ref: React.RefObject<HTMLDivElement | null>, visible: boolean] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, visible];
}

export const Route = createLazyFileRoute('/portal/site/$siteId')({
  component: SiteAnalyticsPage,
});

/** One copyable code card (used per guide step). */
function CodeCard({ label, code }: { label?: string; code: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative rounded-xl border border-[#e6e5ea] bg-[#F9F8F6] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#e6e5ea]/60">
        <span className="font-mono text-[11px] text-[#B5B0AA]">{label ?? 'Snippet'}</span>
        <button
          onClick={() => void copy()}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium text-[#9B9590] hover:text-foreground transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-[#6E6C7C]" />
              Copied
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="text-[12px] leading-relaxed text-[#3D3B4F] font-mono whitespace-pre-wrap break-all select-all px-4 py-3.5">
        {code}
      </pre>
    </div>
  );
}

function InstallModal({
  open,
  onOpenChange,
  site,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: { domain: string; apiKeys?: { key: string }[] } | null;
}): ReactElement {
  const collectUrl = useCollectUrl();
  const [platform, setPlatform] = useState('html');

  const siteKey = site?.apiKeys?.[0]?.key ?? '';
  // Empty until the instance config resolves — never guess the collect origin.
  const snippet = siteKey && collectUrl ? trackerSnippet(siteKey, collectUrl) : '';
  // The shared install guides, with THIS site's real snippet substituted in —
  // the same content traks.dev/guides shows with a placeholder key.
  const rawGuide = findInstallGuide(platform) ?? INSTALL_GUIDES[0];
  const guide = snippet ? guideWithSnippet(rawGuide, siteKey, collectUrl!) : rawGuide;

  const handleCopy = async (): Promise<void> => {
    if (!snippet) return;
    await navigator.clipboard.writeText(snippet);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-lg">
        <DialogHeader>
          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mb-3">
            <Code2 className="w-5 h-5 text-[#6E6C7C]" strokeWidth={1.7} />
          </div>
          <DialogTitle>Installation</DialogTitle>
          <DialogDescription>
            Install the tracker on{' '}
            <span className="font-semibold text-[#3D3B4F]">{site?.domain}</span> — pick your stack
            for exact steps with your site key filled in.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-4">
            <select
              value={platform}
              onChange={e => setPlatform(e.target.value)}
              className="h-10 w-full cursor-pointer rounded-xl border-none bg-white px-3 text-[13px] text-[#3D3B4F] shadow-[inset_0_0_0_1px_#E5E5EB] focus:shadow-[inset_0_0_0_1.5px_#3D3B4F] focus:outline-none"
            >
              {INSTALL_GUIDES.map(g => (
                <option key={g.slug} value={g.slug}>
                  {g.name}
                </option>
              ))}
            </select>

            <div className="space-y-4">
              {guide.steps.map((step, i) => (
                <div key={step.title}>
                  <p className="text-[13px] font-semibold text-[#3D3B4F]">
                    {i + 1}. {step.title}
                  </p>
                  {step.body && (
                    <p className="mt-1 text-[12px] leading-relaxed text-[#6E6C7C]">{step.body}</p>
                  )}
                  {step.code && (
                    <div className="mt-2">
                      <CodeCard label={step.code.filename} code={step.code.code} />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Info note */}
            <div className="flex gap-3 rounded-xl bg-[#F2F1ED] border border-[#E6E4DE] px-4 py-3.5">
              <Zap className="w-4 h-4 text-[#6E6C7C] shrink-0 mt-0.5" strokeWidth={1.7} />
              <p className="text-[12px] text-[#6E6C7C] leading-relaxed">
                Under 1KB, loads async - zero impact on page speed. Data appears within seconds of
                the first visit.
              </p>
            </div>
          </div>
        </DialogBody>

        <DialogFooter className="border-t border-[#e6e5ea]/50 mx-6 px-0 pb-5 pt-4">
          <Button
            variant="ghost"
            onClick={() => void handleCopy()}
            className="text-[13px] cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            Copy snippet
          </Button>
          <Button
            onClick={() => onOpenChange(false)}
            className="bg-[#3D3B4F] hover:bg-[#2C2B3B] text-white shadow-none text-[13px] px-5 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditSiteModal({
  open,
  onOpenChange,
  site,
  siteId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: {
    name: string;
    domain: string;
    timezone?: string;
  } | null;
  siteId: string;
}): ReactElement {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [error, setError] = useState('');
  const [touched, setTouched] = useState<{ name?: boolean; domain?: boolean }>({});

  useEffect(() => {
    if (open && site) {
      setName(site.name);
      setDomain(site.domain);
      setTimezone(site.timezone || 'UTC');
      setError('');
      setTouched({});
    }
  }, [open, site]);

  const updateSite = useMutation({
    mutationFn: async () => {
      // Normalized on the way out so a pasted URL is stored as the bare host
      // the collect worker matches origins against.
      return api.updateSite(siteId, {
        name: name.trim(),
        domain: normalizeDomain(domain),
        timezone,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site', siteId] });
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      // Bucket windows depend on the timezone - refetch everything.
      queryClient.invalidateQueries({ queryKey: ['site-analytics', siteId] });
      onOpenChange(false);
    },
    // The API already sends a readable sentence for every failure it knows
    // about, including the 409 for a duplicate domain.
    onError: (err: Error) => setError(err.message),
  });

  const nameError = requiredTextError(name, 100, 'Site name');
  const domainErr = domainInputError(domain);
  const canSave = !nameError && !domainErr;

  const save = (): void => {
    setTouched({ name: true, domain: true });
    if (canSave) updateSite.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mb-3">
            <Settings className="w-5 h-5 text-foreground" strokeWidth={1.7} />
          </div>
          <DialogTitle>Edit site</DialogTitle>
          <DialogDescription>Update your site name and domain.</DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-[13px] font-medium text-[#3D3B4F]">Site Name</label>
              <Input
                placeholder="My SaaS"
                value={name}
                maxLength={100}
                aria-invalid={touched.name && !!nameError}
                onChange={e => {
                  setName(e.target.value);
                  setError('');
                }}
                onBlur={() => setTouched(t => ({ ...t, name: true }))}
                className="h-11 px-4 text-[14px]"
                autoFocus
              />
              <FieldError message={touched.name ? nameError : null} />
            </div>
            <div>
              <label className="mb-2 block text-[13px] font-medium text-[#3D3B4F]">Domain</label>
              <Input
                placeholder="example.com"
                value={domain}
                maxLength={253}
                aria-invalid={touched.domain && !!domainErr}
                onChange={e => {
                  setDomain(e.target.value);
                  setError('');
                }}
                onBlur={() => setTouched(t => ({ ...t, domain: true }))}
                className="h-11 px-4 text-[14px]"
                onKeyDown={e => {
                  if (e.key === 'Enter') save();
                }}
              />
              {touched.domain && domainErr ? (
                <FieldError message={domainErr} />
              ) : (
                <p className="mt-2 text-[12px] text-[#B5B0AA]">
                  {domain.trim() && normalizeDomain(domain) !== domain.trim()
                    ? `Will be saved as ${normalizeDomain(domain)}`
                    : 'Just the domain — a pasted URL works too'}
                </p>
              )}
            </div>
            <div>
              <label className="mb-2 block text-[13px] font-medium text-[#3D3B4F]">Timezone</label>
              <TimezoneSelect
                value={timezone}
                onChange={tz => {
                  setTimezone(tz);
                  setError('');
                }}
              />
              <p className="mt-2 text-[12px] text-[#B5B0AA]">
                Dashboard days and hours are bucketed in this timezone.
              </p>
            </div>
            {error && <p className="text-[13px] text-[#e07a5f]">{error}</p>}
          </div>
        </DialogBody>

        <DialogFooter className="border-t border-[#e6e5ea]/50 mx-6 px-0 pb-5 pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-[13px]">
            Cancel
          </Button>
          <Button onClick={save} isLoading={updateSite.isPending} className="text-[13px] px-5">
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface GoalDef {
  id: string;
  name: string;
  type: 'event' | 'page';
  target: string;
  propKey?: string | null;
  propValue?: string | null;
}

/** Add or edit a single goal — one form, one purpose. `goal` null = add. */
function GoalFormModal({
  open,
  onOpenChange,
  siteId,
  goal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  goal: GoalDef | null;
}): ReactElement {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<'event' | 'page'>('event');
  const [target, setTarget] = useState('');
  const [propKey, setPropKey] = useState('');
  const [propValue, setPropValue] = useState('');
  const [error, setError] = useState('');
  const [touched, setTouched] = useState<{ name?: boolean; target?: boolean; prop?: boolean }>({});
  const editing = goal !== null;

  useEffect(() => {
    if (open) {
      setName(goal?.name ?? '');
      setType(goal?.type ?? 'event');
      setTarget(goal?.target ?? '');
      setPropKey(goal?.propKey ?? '');
      setPropValue(goal?.propValue ?? '');
      setError('');
      setTouched({});
    }
  }, [open, goal]);

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: ['site-goals', siteId] });
    queryClient.invalidateQueries({ queryKey: ['site-analytics', siteId] });
  };

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
      invalidate();
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  // A page goal whose target lacks a leading slash (or an event goal that has
  // one) silently never converts, so it is caught here rather than discovered
  // weeks later from an empty panel.
  const goalNameError = requiredTextError(name, 100, 'Goal name');
  const goalTargetError = targetError(type, target);
  const goalPropError = propPairError(type, propKey, propValue);
  const canSave = !goalNameError && !goalTargetError && !goalPropError;

  const submit = (): void => {
    setTouched({ name: true, target: true, prop: true });
    if (canSave) saveGoal.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mb-3">
            <Target className="w-5 h-5 text-[#6E6C7C]" strokeWidth={1.7} />
          </div>
          <DialogTitle>{editing ? `Edit ${goal.name}` : 'Add a goal'}</DialogTitle>
          <DialogDescription>
            A goal is a custom event or a page visit that counts as a conversion.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                onClick={() => setType('event')}
                className={cn(
                  'flex-1 rounded-xl border px-3 py-2 text-[12px] font-medium transition-colors cursor-pointer',
                  type === 'event'
                    ? 'border-[#3D3B4F]/40 bg-[#3D3B4F]/[0.04] text-[#3D3B4F]'
                    : 'border-[#e6e5ea] text-[#9B9590] hover:border-[#cbcad4]'
                )}
              >
                Custom event
              </button>
              <button
                onClick={() => setType('page')}
                className={cn(
                  'flex-1 rounded-xl border px-3 py-2 text-[12px] font-medium transition-colors cursor-pointer',
                  type === 'page'
                    ? 'border-[#3D3B4F]/40 bg-[#3D3B4F]/[0.04] text-[#3D3B4F]'
                    : 'border-[#e6e5ea] text-[#9B9590] hover:border-[#cbcad4]'
                )}
              >
                Page visit
              </button>
            </div>
            <div>
              <Input
                placeholder="Goal name (e.g. Signed up)"
                value={name}
                maxLength={100}
                aria-invalid={touched.name && !!goalNameError}
                onChange={e => {
                  setName(e.target.value);
                  setError('');
                }}
                onBlur={() => setTouched(t => ({ ...t, name: true }))}
                className="h-10 px-4 text-[13px]"
                autoFocus
              />
              <FieldError message={touched.name ? goalNameError : null} />
            </div>
            <div>
              <Input
                placeholder={
                  type === 'event' ? 'Event name (e.g. signup)' : 'Pathname (e.g. /thank-you)'
                }
                value={target}
                maxLength={2048}
                aria-invalid={touched.target && !!goalTargetError}
                onChange={e => {
                  setTarget(e.target.value);
                  setError('');
                }}
                onBlur={() => setTouched(t => ({ ...t, target: true }))}
                className="h-10 px-4 text-[13px]"
                onKeyDown={e => {
                  if (e.key === 'Enter') submit();
                }}
              />
              <FieldError message={touched.target ? goalTargetError : null} />
              {type === 'page' && !goalTargetError && (
                <p className="mt-1.5 text-[11px] text-[#B5B0AA]">
                  End with /* to count a whole section, e.g. /blog/*
                </p>
              )}
            </div>
            {type === 'event' && (
              <div>
                <p className="mb-1.5 text-[12px] font-medium text-[#6E6C7C]">
                  Only count events where a property matches (optional)
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Property key (e.g. reason)"
                    value={propKey}
                    maxLength={128}
                    aria-invalid={touched.prop && !!goalPropError}
                    onChange={e => {
                      setPropKey(e.target.value);
                      setError('');
                    }}
                    onBlur={() => setTouched(t => ({ ...t, prop: true }))}
                    className="h-10 px-4 text-[13px]"
                  />
                  <span className="shrink-0 text-[13px] text-[#B5B0AA]">=</span>
                  <Input
                    placeholder="Value (e.g. claimed)"
                    value={propValue}
                    maxLength={512}
                    aria-invalid={touched.prop && !!goalPropError}
                    onChange={e => {
                      setPropValue(e.target.value);
                      setError('');
                    }}
                    onBlur={() => setTouched(t => ({ ...t, prop: true }))}
                    className="h-10 px-4 text-[13px]"
                  />
                </div>
                <FieldError message={touched.prop ? goalPropError : null} />
              </div>
            )}
            {type === 'event' && (
              <p className="text-[11px] text-[#B5B0AA]">
                Fire it from your site with{' '}
                <code className="rounded bg-muted px-1 py-0.5">
                  traks(&apos;signup&apos;, {'{'} reason: &apos;claimed&apos; {'}'})
                </code>
              </p>
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
            isLoading={saveGoal.isPending}
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
                Add goal
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The list of existing goals — edit and delete only; adding lives in its
 *  own modal, opened from the panel header. */
function ManageGoalsModal({
  open,
  onOpenChange,
  siteId,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  onEdit: (goal: GoalDef) => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) setError('');
  }, [open]);

  const goalsQ = useQuery({
    queryKey: ['site-goals', siteId],
    queryFn: async () => {
      return api.getGoals(siteId);
    },
    enabled: open,
    staleTime: 60_000,
  });

  const deleteGoal = useMutation({
    mutationFn: async (goalId: string) => {
      return api.deleteGoal(siteId, goalId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-goals', siteId] });
      queryClient.invalidateQueries({ queryKey: ['site-analytics', siteId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const goals = ((goalsQ.data as any)?.data ?? []) as GoalDef[];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mb-3">
            <Target className="w-5 h-5 text-[#6E6C7C]" strokeWidth={1.7} />
          </div>
          <DialogTitle>Manage goals</DialogTitle>
          <DialogDescription>Edit or remove the goals defined for this site.</DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-1.5">
            {goalsQ.isLoading && (
              <p className="text-[12.5px] text-[#9B9590]">Loading your goals…</p>
            )}
            {goalsQ.isError && (
              <p className="text-[12.5px] text-[#e07a5f]">Couldn&rsquo;t load your goals.</p>
            )}
            {!goalsQ.isLoading && !goalsQ.isError && goals.length === 0 && (
              <p className="text-[12.5px] text-[#9B9590]">
                No goals yet — add one from the panel header.
              </p>
            )}
            {goals.map(goal => (
              <div
                key={goal.id}
                className="flex items-center justify-between rounded-xl border border-[#e6e5ea]/80 px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-[#3D3B4F]">{goal.name}</p>
                  <p className="truncate text-[11px] text-[#9B9590]">
                    {goal.type === 'event' ? `event: ${goal.target}` : `visit: ${goal.target}`}
                    {goal.propKey && goal.propValue && ` · ${goal.propKey}=${goal.propValue}`}
                  </p>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => onEdit(goal)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[#B5B0AA] hover:bg-muted hover:text-[#3D3B4F] transition-colors cursor-pointer"
                    title="Edit goal"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => deleteGoal.mutate(goal.id)}
                    disabled={deleteGoal.isPending}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[#B5B0AA] hover:bg-[#e07a5f]/10 hover:text-[#e07a5f] transition-colors cursor-pointer"
                    title="Delete goal"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {error && <p className="pt-1 text-[13px] text-[#e07a5f]">{error}</p>}
          </div>
        </DialogBody>

        <DialogFooter className="border-t border-[#e6e5ea]/50 mx-6 px-0 pb-5 pt-4">
          <Button
            onClick={() => onOpenChange(false)}
            className="bg-[#3D3B4F] hover:bg-[#2C2B3B] text-white shadow-none text-[13px] px-5 cursor-pointer"
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const EMPTY_FUNNEL_STEPS: FunnelStep[] = [
  { type: 'page', target: '' },
  { type: 'event', target: '' },
];

/** Add or edit a single funnel — name + ordered steps. `funnel` null = add.
 *  Event steps may carry an optional exact-match prop condition. */
function FunnelFormModal({
  open,
  onOpenChange,
  siteId,
  funnel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  funnel: FunnelDef | null;
}): ReactElement {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<FunnelStep[]>(EMPTY_FUNNEL_STEPS);
  const [error, setError] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [touchedSteps, setTouchedSteps] = useState<boolean[]>([]);
  const editing = funnel !== null;

  useEffect(() => {
    if (open) {
      setName(funnel?.name ?? '');
      setSteps(
        funnel
          ? funnel.steps.map(s => ({
              type: s.type,
              target: s.target,
              propKey: s.propKey ?? '',
              propValue: s.propValue ?? '',
            }))
          : EMPTY_FUNNEL_STEPS
      );
      setError('');
      setNameTouched(false);
      setTouchedSteps([]);
    }
  }, [open, funnel]);

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: ['site-funnels', siteId] });
    queryClient.invalidateQueries({ queryKey: ['site-analytics', siteId] });
  };

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
      invalidate();
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  // Each step carries the same page-vs-event target rule as a goal; a wrong
  // one makes the whole funnel read zero at that step forever.
  const funnelNameError = requiredTextError(name, 100, 'Funnel name');
  const stepErrors = steps.map(
    s => targetError(s.type, s.target) ?? propPairError(s.type, s.propKey ?? '', s.propValue ?? '')
  );
  const canSave = !funnelNameError && steps.length >= 2 && stepErrors.every(e => !e);

  const submit = (): void => {
    setTouchedSteps(steps.map(() => true));
    setNameTouched(true);
    if (canSave) saveFunnel.mutate();
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mb-3">
            <Filter className="w-5 h-5 text-[#6E6C7C]" strokeWidth={1.7} />
          </div>
          <DialogTitle>{editing ? `Edit ${funnel.name}` : 'Create a funnel'}</DialogTitle>
          <DialogDescription>
            Ordered steps a visitor should complete in one session — pages or custom events. The
            panel shows where they drop off.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-3">
            <div>
              <Input
                placeholder="Funnel name (e.g. Signup flow)"
                value={name}
                maxLength={100}
                aria-invalid={nameTouched && !!funnelNameError}
                onChange={e => {
                  setName(e.target.value);
                  setError('');
                }}
                onBlur={() => setNameTouched(true)}
                className="h-10 px-4 text-[13px]"
                autoFocus
              />
              <FieldError message={nameTouched ? funnelNameError : null} />
            </div>

            <div className="space-y-2">
              {steps.map((step, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#e6e5ea] bg-white font-mono text-[10.5px] font-semibold text-[#6E6C7C]">
                      {i + 1}
                    </span>
                    <button
                      onClick={() => setStep(i, { type: step.type === 'page' ? 'event' : 'page' })}
                      className="w-[64px] shrink-0 rounded-lg border border-[#e6e5ea] px-2 py-2 text-[11.5px] font-medium text-[#6E6C7C] hover:border-[#cbcad4] transition-colors cursor-pointer"
                      title="Toggle step type"
                    >
                      {step.type === 'page' ? 'Page' : 'Event'}
                    </button>
                    <Input
                      placeholder={step.type === 'page' ? '/pricing or /docs/*' : 'signup'}
                      value={step.target}
                      maxLength={2048}
                      aria-invalid={!!touchedSteps[i] && !!stepErrors[i]}
                      onChange={e => setStep(i, { target: e.target.value })}
                      onBlur={() => touchStep(i)}
                      className="h-9 px-3 text-[13px]"
                    />
                    <button
                      onClick={() => setSteps(prev => prev.filter((_, idx) => idx !== i))}
                      disabled={steps.length <= 2}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#B5B0AA] hover:text-[#e07a5f] disabled:opacity-30 disabled:cursor-default transition-colors cursor-pointer"
                      title="Remove step"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {step.type === 'event' && (
                    <div className="flex items-center gap-2 pl-[104px] pr-9">
                      <Input
                        placeholder="prop key (optional)"
                        value={step.propKey ?? ''}
                        maxLength={128}
                        onChange={e => setStep(i, { propKey: e.target.value })}
                        onBlur={() => touchStep(i)}
                        className="h-8 px-3 text-[12px]"
                      />
                      <span className="shrink-0 text-[12px] text-[#B5B0AA]">=</span>
                      <Input
                        placeholder="value"
                        value={step.propValue ?? ''}
                        maxLength={512}
                        onChange={e => setStep(i, { propValue: e.target.value })}
                        onBlur={() => touchStep(i)}
                        className="h-8 px-3 text-[12px]"
                      />
                    </div>
                  )}
                </div>
              ))}
              {stepErrors.some((e, i) => e && touchedSteps[i]) && (
                <FieldError message={stepErrors.find((e, i) => e && touchedSteps[i]) ?? null} />
              )}
            </div>

            {steps.length < 8 && (
              <button
                onClick={() => setSteps(prev => [...prev, { type: 'page', target: '' }])}
                className="flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-[12px] font-medium text-[#6E6C7C] hover:text-[#3D3B4F] transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Add step
              </button>
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

/** The list of existing funnels — edit and delete only; adding lives in its
 *  own modal, opened from the panel header. */
function ManageFunnelsModal({
  open,
  onOpenChange,
  siteId,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  onEdit: (funnel: FunnelDef) => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) setError('');
  }, [open]);

  const funnelsQ = useQuery({
    queryKey: ['site-funnels', siteId],
    queryFn: async () => {
      return api.getFunnels(siteId);
    },
    enabled: open,
    staleTime: 60_000,
  });

  const deleteFunnel = useMutation({
    mutationFn: async (funnelId: string) => {
      return api.deleteFunnel(siteId, funnelId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-funnels', siteId] });
      queryClient.invalidateQueries({ queryKey: ['site-analytics', siteId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const funnels = ((funnelsQ.data as any)?.data ?? []) as FunnelDef[];
  const stepLabel = (s: FunnelStep): string =>
    s.propKey && s.propValue ? `${s.target}[${s.propKey}=${s.propValue}]` : s.target;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mb-3">
            <Filter className="w-5 h-5 text-[#6E6C7C]" strokeWidth={1.7} />
          </div>
          <DialogTitle>Manage funnels</DialogTitle>
          <DialogDescription>Edit or remove the funnels defined for this site.</DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-1.5">
            {funnelsQ.isLoading && (
              <p className="text-[12.5px] text-[#9B9590]">Loading your funnels…</p>
            )}
            {funnelsQ.isError && (
              <p className="text-[12.5px] text-[#e07a5f]">Couldn&rsquo;t load your funnels.</p>
            )}
            {!funnelsQ.isLoading && !funnelsQ.isError && funnels.length === 0 && (
              <p className="text-[12.5px] text-[#9B9590]">
                No funnels yet — add one from the panel header.
              </p>
            )}
            {funnels.map(funnel => (
              <div
                key={funnel.id}
                className="flex items-center justify-between rounded-xl border border-[#e6e5ea]/80 px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-[#3D3B4F]">{funnel.name}</p>
                  <p className="truncate text-[11px] text-[#9B9590]">
                    {funnel.steps.map(stepLabel).join(' → ')}
                  </p>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => onEdit(funnel)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[#B5B0AA] hover:bg-muted hover:text-[#3D3B4F] transition-colors cursor-pointer"
                    title="Edit funnel"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => deleteFunnel.mutate(funnel.id)}
                    disabled={deleteFunnel.isPending}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[#B5B0AA] hover:bg-[#e07a5f]/10 hover:text-[#e07a5f] transition-colors cursor-pointer"
                    title="Delete funnel"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {error && <p className="pt-1 text-[13px] text-[#e07a5f]">{error}</p>}
          </div>
        </DialogBody>

        <DialogFooter className="border-t border-[#e6e5ea]/50 mx-6 px-0 pb-5 pt-4">
          <Button
            onClick={() => onOpenChange(false)}
            className="bg-[#3D3B4F] hover:bg-[#2C2B3B] text-white shadow-none text-[13px] px-5 cursor-pointer"
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function DeleteSiteModal({
  open,
  onOpenChange,
  site,
  siteId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: { name: string; domain: string } | null;
  siteId: string;
}): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setConfirmText('');
      setError('');
    }
  }, [open]);

  const deleteSite = useMutation({
    mutationFn: async () => {
      return api.deleteSite(siteId);
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['site', siteId] });
      queryClient.removeQueries({ queryKey: ['site-analytics', siteId] });
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      onOpenChange(false);
      navigate({ to: '/portal/sites' });
    },
    onError: (err: Error) => setError(err.message),
  });

  // Trimmed: pasting the domain often brings a trailing space, and an exact
  // comparison then blocks deletion with nothing on screen explaining why.
  const canDelete = site !== null && confirmText.trim() === site.domain;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <div className="w-10 h-10 rounded-xl bg-[#e07a5f]/10 flex items-center justify-center mb-3">
            <Trash2 className="w-5 h-5 text-[#e07a5f]" strokeWidth={1.7} />
          </div>
          <DialogTitle>Delete {site?.name || 'this site'}?</DialogTitle>
          <DialogDescription>
            This permanently removes the site, its tracking keys, goals, segments and funnels, and
            cuts off access to all of its analytics. Raw events already collected stay in your R2
            bucket but can never be viewed from Traks again. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-3">
            <p className="text-[13px] text-[#3D3B4F]">
              Type <span className="font-semibold select-all">{site?.domain}</span> to confirm:
            </p>
            <Input
              placeholder={site?.domain}
              value={confirmText}
              onChange={e => {
                setConfirmText(e.target.value);
                setError('');
              }}
              className="h-11 px-4 text-[14px] shadow-[inset_0_0_0_1px_rgba(224,122,95,0.3)] focus:shadow-[inset_0_0_0_1.5px_rgba(224,122,95,0.6)]"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && canDelete) deleteSite.mutate();
              }}
            />
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
            onClick={() => deleteSite.mutate()}
            disabled={!canDelete}
            isLoading={deleteSite.isPending}
            className="bg-coral hover:bg-[#d06a4f] text-white shadow-none text-[13px] px-5 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete forever
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ChartMetric = 'visitors' | 'pageviews' | 'sessions';

const METRIC_COLORS: Record<ChartMetric, string> = {
  visitors: '#3D3B4F',
  pageviews: '#3D3B4F',
  sessions: '#3D3B4F',
};

const LINK_TABS = [
  { key: 'outbound', label: 'Outbound' },
  { key: 'download', label: 'Downloads' },
];

const PERIOD_LABELS: Record<string, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '6m': 'Last 6 months',
  '1y': 'Last year',
  all: 'All time',
};

function MetricTile({
  label,
  value,
  change,
  active,
  color,
  onClick,
  higherIsWorse,
}: {
  label: string;
  value: string;
  change: number | null;
  active?: boolean;
  color?: string;
  onClick?: () => void;
  higherIsWorse?: boolean;
}): ReactElement {
  const delta = change === null ? null : formatPercentChange(change);
  const isGood = delta ? (higherIsWorse ? !delta.isPositive : delta.isPositive) : true;

  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'relative flex flex-col items-start gap-[7px] border-l border-[#F1EFEA] px-[22px] py-5 text-left transition-colors first:border-l-0',
        onClick && 'cursor-pointer hover:bg-[#FBFAF8]'
      )}
    >
      <span className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-[#9B9590]">
        {label}
      </span>
      <span
        className={cn(
          'text-[25px] leading-none tracking-[-0.02em] tabular-nums',
          active || !onClick ? 'font-bold text-[#3D3B4F]' : 'font-semibold text-[#6E6C7C]'
        )}
      >
        {value}
      </span>
      {delta ? (
        <span
          className={cn(
            'flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10.5px] font-bold',
            isGood ? 'bg-[#28E99F]/15 text-[#2E7D57]' : 'bg-[#E07A5F]/15 text-[#B3402F]'
          )}
        >
          {delta.isPositive ? (
            <ArrowUpRight className="h-[11px] w-[11px]" strokeWidth={2.5} />
          ) : (
            <ArrowDownRight className="h-[11px] w-[11px]" strokeWidth={2.5} />
          )}
          {delta.text}
        </span>
      ) : (
        <span className="text-[10.5px] font-semibold text-[#C9C3BC]">—</span>
      )}
      {/* Active indicator: the same ink underline as the nav tabs */}
      <span
        className={cn(
          'absolute inset-x-[22px] bottom-0 h-[2px] rounded-t-full bg-[#3D3B4F] transition-opacity',
          active ? 'opacity-100' : 'opacity-0'
        )}
      />
    </button>
  );
}

function ChartCard({
  stats,
  statsLoading,
  statsError,
  timeseries,
  timeseriesLoading,
  timeseriesError,
  metric,
  onMetricChange,
  period,
}: {
  stats: MainStats | undefined;
  statsLoading: boolean;
  statsError: boolean;
  timeseries: any;
  timeseriesLoading: boolean;
  timeseriesError: boolean;
  metric: ChartMetric;
  onMetricChange: (m: ChartMetric) => void;
  period: Period;
}): ReactElement {
  const viewsPerVisit =
    stats && stats.sessions > 0 ? (stats.pageviews / stats.sessions).toFixed(2) : '0';

  return (
    <div className="overflow-hidden rounded-[20px] bg-white shadow-float">
      {/* KPI columns */}
      {statsError ? (
        <p className="border-b border-[#F3F0EA] px-6 py-5 text-[13px] text-[#e07a5f]">
          Failed to load stats
        </p>
      ) : statsLoading || !stats ? (
        <div className="grid grid-cols-2 border-b border-[#F3F0EA] sm:grid-cols-3 lg:grid-cols-6">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 border-l border-[#F5F2EC] px-[22px] py-5 first:border-l-0"
            >
              <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              <div className="h-6 w-14 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 border-b border-[#F3F0EA] sm:grid-cols-3 lg:grid-cols-6">
          <MetricTile
            label="Unique Visitors"
            value={formatNumber(stats.visitors)}
            change={stats.visitorsChange}
            active={metric === 'visitors'}
            color={METRIC_COLORS.visitors}
            onClick={() => onMetricChange('visitors')}
          />
          <MetricTile
            label="Total Pageviews"
            value={formatNumber(stats.pageviews)}
            change={stats.pageviewsChange}
            active={metric === 'pageviews'}
            color={METRIC_COLORS.pageviews}
            onClick={() => onMetricChange('pageviews')}
          />
          <MetricTile
            label="Visits"
            value={formatNumber(stats.sessions)}
            change={stats.sessionsChange}
            active={metric === 'sessions'}
            color={METRIC_COLORS.sessions}
            onClick={() => onMetricChange('sessions')}
          />
          <MetricTile label="Views / Visit" value={viewsPerVisit} change={null} />
          <MetricTile
            label="Bounce Rate"
            value={`${stats.bounceRate}%`}
            change={stats.bounceRateChange}
            higherIsWorse
          />
          <MetricTile
            label="Visit Duration"
            value={formatDuration(stats.avgDuration ?? 0)}
            change={stats.avgDuration || stats.avgDurationChange ? stats.avgDurationChange : null}
          />
        </div>
      )}

      {/* Chart */}
      <div className="px-6 pb-4 pt-5">
        <div className="mb-3.5 flex items-baseline justify-between">
          <h3 className="text-[15px] font-bold tracking-[-0.01em] text-[#3D3B4F]">
            {metric === 'visitors'
              ? 'Unique Visitors'
              : metric === 'pageviews'
                ? 'Total Pageviews'
                : 'Visits'}
          </h3>
          <span className="text-[12px] text-[#B5B0AA]">{PERIOD_LABELS[period] ?? period}</span>
        </div>
        <TimeseriesChart
          data={timeseries}
          isLoading={timeseriesLoading}
          isError={timeseriesError}
          metric={metric}
          bare
        />
      </div>
    </div>
  );
}

/** One slot in the site header's segmented action cluster. */
const SEG_BTN =
  'flex h-[38px] w-[38px] items-center justify-center border-l border-[#EEEDE9] first:border-l-0 text-[#9B9590] hover:bg-[#F6F5F2] hover:text-foreground transition-colors cursor-pointer';

const FILTER_LABELS: Record<keyof AnalyticsFilters, string> = {
  page: 'Page',
  source: 'Source',
  utmSource: 'UTM Source',
  utmMedium: 'UTM Medium',
  utmCampaign: 'UTM Campaign',
  country: 'Country',
  region: 'Region',
  city: 'City',
  browser: 'Browser',
  os: 'OS',
  device: 'Device',
};

function FilterChips({
  filters,
  onRemove,
  onClear,
}: {
  filters: AnalyticsFilters;
  onRemove: (key: keyof AnalyticsFilters) => void;
  onClear: () => void;
}): ReactElement | null {
  const entries = Object.entries(filters).filter(([, v]) => v) as [
    keyof AnalyticsFilters,
    string,
  ][];
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Filter className="h-3.5 w-3.5 text-[#9B9590]" strokeWidth={1.7} />
      {entries.map(([key, value]) => (
        <span
          key={key}
          className="flex items-center gap-1.5 rounded-full bg-muted py-1 pl-3 pr-1.5 text-[12px] text-[#3D3B4F]"
        >
          <span className="text-[#9B9590]">{FILTER_LABELS[key]}</span>
          <span className="max-w-[180px] truncate font-medium">
            {key === 'country' ? countryName(value) : value}
          </span>
          <button
            onClick={() => onRemove(key)}
            className="flex h-4.5 w-4.5 items-center justify-center rounded-full hover:bg-[#E6E4DE] transition-colors cursor-pointer"
            title="Remove filter"
          >
            <X className="h-3 w-3 text-[#9B9590]" />
          </button>
        </span>
      ))}
      {entries.length > 1 && (
        <button
          onClick={onClear}
          className="text-[12px] text-[#9B9590] hover:text-[#3D3B4F] transition-colors cursor-pointer"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

/**
 * Saved segments: apply a named filter set, save the current one, or delete.
 * Definitions live in D1; applying just rewrites the URL search params.
 */
function SegmentsMenu({
  siteId,
  filters,
  hasFilters,
  onApply,
}: {
  siteId: string;
  filters: AnalyticsFilters;
  hasFilters: boolean;
  onApply: (filters: SegmentFilters) => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (saveOpen) {
      setName('');
      setError('');
    }
  }, [saveOpen]);

  const segmentsQ = useQuery({
    queryKey: ['site-segments', siteId],
    queryFn: async () => {
      return api.getSegments(siteId);
    },
    staleTime: 60_000,
  });
  const segments = ((segmentsQ.data as any)?.data ?? []) as SegmentDef[];

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: ['site-segments', siteId] });
  };

  const createSegment = useMutation({
    mutationFn: async () => {
      return api.createSegment(siteId, {
        name: name.trim(),
        filters: filters as Record<string, string>,
      });
    },
    onSuccess: () => {
      setSaveOpen(false);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteSegment = useMutation({
    mutationFn: async (segmentId: string) => {
      return api.deleteSegment(siteId, segmentId);
    },
    onSuccess: invalidate,
    // Previously absent: a failed delete left the row in place with nothing
    // said, so it read as the click not registering.
    onError: (err: Error) => setError(err.message),
  });

  const activeEntries = Object.entries(filters).filter(([, v]) => v) as [
    keyof AnalyticsFilters,
    string,
  ][];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={SEG_BTN} title="Segments">
            <Bookmark className="w-[15px] h-[15px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-64 rounded-2xl bg-white border-none shadow-float"
        >
          <DropdownMenuLabel className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-[#B5B0AA]">
            Segments
          </DropdownMenuLabel>
          {segmentsQ.isLoading ? (
            <p className="px-4 pb-3 pt-1 text-[12.5px] text-[#9B9590]">Loading segments…</p>
          ) : segmentsQ.isError ? (
            <p className="px-4 pb-3 pt-1 text-[12.5px] leading-relaxed text-[#e07a5f]">
              Couldn&rsquo;t load your saved segments.
            </p>
          ) : segments.length === 0 ? (
            <p className="px-4 pb-3 pt-1 text-[12.5px] leading-relaxed text-[#9B9590]">
              No saved segments. Filter the dashboard (click any row), then save the view here.
            </p>
          ) : (
            segments.map(segment => (
              <DropdownMenuItem
                key={segment.id}
                onClick={() => onApply(segment.filters)}
                className="group flex items-center justify-between gap-2 px-4 py-2.5 cursor-pointer"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-[#3D3B4F]">
                    {segment.name}
                  </span>
                  <span className="block truncate text-[11px] text-[#9B9590]">
                    {Object.entries(segment.filters)
                      .filter(([, v]) => v)
                      .map(
                        ([k, v]) =>
                          `${FILTER_LABELS[k as keyof AnalyticsFilters] ?? k}: ${k === 'country' ? countryName(v) : v}`
                      )
                      .join(' · ')}
                  </span>
                </span>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    deleteSegment.mutate(segment.id);
                  }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#B5B0AA] opacity-0 transition-all hover:text-[#e07a5f] group-hover:opacity-100 cursor-pointer"
                  title="Delete segment"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuItem>
            ))
          )}
          {hasFilters && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setSaveOpen(true)}
                className="flex items-center gap-2.5 px-4 py-2.5 cursor-pointer text-[13px] font-medium text-[#3D3B4F]"
              >
                <BookmarkPlus className="h-4 w-4 text-[#6E6C7C]" />
                Save current filters…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent onClose={() => setSaveOpen(false)} className="max-w-sm">
          <DialogHeader>
            <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mb-3">
              <BookmarkPlus className="w-5 h-5 text-[#6E6C7C]" strokeWidth={1.7} />
            </div>
            <DialogTitle>Save segment</DialogTitle>
            <DialogDescription>
              Saves the active filters as a named view you can re-apply from the segments menu.
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {activeEntries.map(([key, value]) => (
                  <span
                    key={key}
                    className="flex items-center gap-1.5 rounded-full bg-muted py-1 px-3 text-[12px] text-[#3D3B4F]"
                  >
                    <span className="text-[#9B9590]">{FILTER_LABELS[key]}</span>
                    <span className="max-w-[160px] truncate font-medium">{value}</span>
                  </span>
                ))}
              </div>
              <Input
                placeholder="Segment name (e.g. Google · Mobile)"
                value={name}
                onChange={e => {
                  setName(e.target.value);
                  setError('');
                }}
                className="h-10 px-4 text-[13px]"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter' && name.trim()) createSegment.mutate();
                }}
              />
              {error && <p className="text-[13px] text-[#e07a5f]">{error}</p>}
            </div>
          </DialogBody>

          <DialogFooter className="border-t border-[#e6e5ea]/50 mx-6 px-0 pb-5 pt-4">
            <Button
              variant="ghost"
              onClick={() => setSaveOpen(false)}
              className="text-[13px] cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={() => createSegment.mutate()}
              disabled={name.trim().length === 0}
              isLoading={createSegment.isPending}
              className="bg-[#3D3B4F] hover:bg-[#2C2B3B] text-white shadow-none text-[13px] px-5 cursor-pointer"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              Save segment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LiveStatus({ count }: { count: number | null }): ReactElement | null {
  if (count === null) return null;
  if (count === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#9B9590]">
        <span className="inline-flex h-[7px] w-[7px] rounded-full bg-[#B5B0AA]" />0 online now
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#3F7A50]">
      <span className="relative flex h-[7px] w-[7px]">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex h-[7px] w-[7px] rounded-full bg-mint" />
      </span>
      {count} online now
    </span>
  );
}

function SiteAnalyticsPage(): ReactElement {
  const { siteId } = Route.useParams();
  const search = Route.useSearch();
  const { period: searchPeriod } = search;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const period: Period = searchPeriod || 'today';

  const filters: AnalyticsFilters = {};
  for (const key of Object.keys(FILTER_LABELS) as (keyof AnalyticsFilters)[]) {
    const value = (search as Record<string, unknown>)[key];
    if (typeof value === 'string' && value) filters[key] = value;
  }
  const filterKey = JSON.stringify(filters);
  const hasFilters = Object.keys(filters).length > 0;

  const setPeriod = useCallback(
    (p: Period) => {
      navigate({
        to: '/portal/site/$siteId',
        params: { siteId },
        search: prev => ({ ...prev, period: p }),
        replace: true,
      });
    },
    [navigate, siteId]
  );

  const setFilter = useCallback(
    (key: keyof AnalyticsFilters, value: string) => {
      navigate({
        to: '/portal/site/$siteId',
        params: { siteId },
        search: prev => ({ ...prev, [key]: value }),
        replace: true,
      });
    },
    [navigate, siteId]
  );

  const removeFilter = useCallback(
    (key: keyof AnalyticsFilters) => {
      navigate({
        to: '/portal/site/$siteId',
        params: { siteId },
        search: prev => ({ ...prev, [key]: undefined }),
        replace: true,
      });
    },
    [navigate, siteId]
  );

  const clearFilters = useCallback(() => {
    navigate({
      to: '/portal/site/$siteId',
      params: { siteId },
      search: prev => {
        const next = { ...prev } as Record<string, unknown>;
        for (const key of Object.keys(FILTER_LABELS)) next[key] = undefined;
        return next;
      },
      replace: true,
    });
  }, [navigate, siteId]);

  // Replace the active filters wholesale with a saved segment's set.
  const applySegment = useCallback(
    (segmentFilters: SegmentFilters) => {
      navigate({
        to: '/portal/site/$siteId',
        params: { siteId },
        search: prev => {
          const next = { ...prev } as Record<string, unknown>;
          for (const key of Object.keys(FILTER_LABELS)) {
            next[key] = (segmentFilters as Record<string, string | undefined>)[key] || undefined;
          }
          return next;
        },
        replace: true,
      });
    },
    [navigate, siteId]
  );
  const [refreshing, setRefreshing] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(false);
  // Add/edit goal form: null = closed, { goal: null } = add, { goal } = edit.
  const [goalForm, setGoalForm] = useState<{ goal: GoalDef | null } | null>(null);
  // An edit launched from the manage list returns to the list on close.
  const [returnToManage, setReturnToManage] = useState(false);
  // Same trio for funnels: manage list, add/edit form, return-to-list flag.
  const [funnelForm, setFunnelForm] = useState<{ funnel: FunnelDef | null } | null>(null);
  const [returnToManageFunnels, setReturnToManageFunnels] = useState(false);
  const [funnelsOpen, setFunnelsOpen] = useState(false);
  const [selectedFunnelId, setSelectedFunnelId] = useState<string | null>(null);
  const [chartMetric, setChartMetric] = useState<ChartMetric>('visitors');

  // Per-panel tab state
  const [pagesTab, setPagesTab] = useState('top');
  const [sourceTab, setSourceTab] = useState('referrers');
  const [locationTab, setLocationTab] = useState('country');
  const [deviceTab, setDeviceTab] = useState('browser');
  // Links panel: outbound clicks and file downloads share one card
  const [linkTab, setLinkTab] = useState('outbound');
  // Drill-down: when set, the Custom Events panel shows this event's props
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);

  // Lazy-render sentinels for below-fold sections
  const [belowFoldRef, belowFoldVisible] = useLazyVisible();

  const handleRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['site-analytics', siteId] });
    await queryClient.invalidateQueries({ queryKey: ['site', siteId] });
    setTimeout(() => setRefreshing(false), 600);
  }, [queryClient, siteId]);

  const {
    data: siteData,
    isError: siteError,
    isLoading: siteLoading,
  } = useQuery({
    queryKey: ['site', siteId],
    queryFn: async () => {
      return api.getSite(siteId);
    },
    staleTime: 300_000,
  });

  // One request for the whole default view. /stats/all answers main,
  // timeseries, top pages, referrers, countries, browsers and OS from a single
  // server round-trip (and, on 'today', a single fan-out to the live store) —
  // seven browser requests collapsed into one. It has no filtered variant, so
  // the moment a filter chip is active we fall back to per-panel requests.
  const useBootstrap = !hasFilters;
  const bootstrapQ = useQuery({
    queryKey: ['site-analytics', siteId, 'all', period],
    queryFn: async () => api.getAllStats(siteId, period),
    enabled: useBootstrap,
    refetchInterval: getRefetchInterval(period),
    staleTime: getStaleTime(period),
  });

  // Seed each panel's cache from the bundle so the panel queries below find
  // fresh data and never hit the network. Panels stay independent components
  // with their own loading states; they just get their data early.
  const bootstrapData = (bootstrapQ.data as { data?: Record<string, unknown> } | undefined)?.data;
  useEffect(() => {
    // Seed only while the unfiltered bundle answers the current view. When a
    // filter chip lands, filterKey changes and this effect re-runs while the
    // stale unfiltered bundle is still in cache — seeding then would stamp
    // unfiltered data onto the filtered query keys as fresh, so every panel
    // keeps showing unfiltered numbers until a manual refresh.
    if (!bootstrapData || hasFilters) return;
    const seed = (key: readonly unknown[], value: unknown): void => {
      queryClient.setQueryData(['site-analytics', siteId, ...key, period, filterKey], {
        data: value,
      });
    };
    seed(['main'], bootstrapData.main);
    seed(['timeseries'], bootstrapData.timeseries);
    seed(['pages', 'top'], bootstrapData.pages);
    seed(['referrers'], bootstrapData.referrers);
    seed(['locations', 'country'], bootstrapData.locations);
    seed(['devices', 'browser'], bootstrapData.browsers);
    seed(['devices', 'os'], bootstrapData.os);
  }, [bootstrapData, queryClient, siteId, period, filterKey, hasFilters]);

  // Panels covered by the bundle wait for it rather than racing it; if it
  // fails they fall back to fetching themselves, so a bundle error degrades
  // to the old behaviour instead of an empty dashboard.
  const bootstrapSettled = !useBootstrap || bootstrapQ.isSuccess || bootstrapQ.isError;

  // Per-tile parallel queries — each tile renders as its own request resolves.
  // Tabbed panels pass `enabled` so only the active tab's query runs (each
  // R2 SQL query is a paid distributed scan; don't fetch hidden tabs).
  // `inBundle` marks the panels /stats/all already answers.
  const tileOpts = (
    key: readonly unknown[],
    call: () => Promise<unknown>,
    enabled = true,
    inBundle = false
  ): Parameters<typeof useQuery>[0] => ({
    queryKey: ['site-analytics', siteId, ...key, period, filterKey],
    queryFn: async () => {
      return call();
    },
    refetchInterval: getRefetchInterval(period),
    staleTime: getStaleTime(period),
    enabled: enabled && (!inBundle || bootstrapSettled),
  });

  const mainQ = useQuery(
    tileOpts(['main'], () => api.getMainStats(siteId, period, filters), true, true)
  );
  const timeseriesQ = useQuery(
    tileOpts(['timeseries'], () => api.getTimeseries(siteId, period, filters), true, true)
  );
  // Pages panel: top pages or entry/exit pages (first/last page of each session)
  const topPagesQ = useQuery(
    tileOpts(
      ['pages', 'top'],
      () => api.getTopPages(siteId, period, 'top', filters),
      pagesTab === 'top',
      true
    )
  );
  const entryPagesQ = useQuery(
    tileOpts(
      ['pages', 'entry'],
      () => api.getTopPages(siteId, period, 'entry', filters),
      pagesTab === 'entry'
    )
  );
  const exitPagesQ = useQuery(
    tileOpts(
      ['pages', 'exit'],
      () => api.getTopPages(siteId, period, 'exit', filters),
      pagesTab === 'exit'
    )
  );

  // Sources panel: referrers or one of the UTM dimensions
  const referrersQ = useQuery(
    tileOpts(
      ['referrers'],
      () => api.getTopReferrers(siteId, period, filters),
      sourceTab === 'referrers',
      true
    )
  );
  const utmSourceQ = useQuery(
    tileOpts(
      ['utm', 'source'],
      () => api.getUtm(siteId, period, 'source', filters),
      sourceTab === 'utm_source'
    )
  );
  const utmMediumQ = useQuery(
    tileOpts(
      ['utm', 'medium'],
      () => api.getUtm(siteId, period, 'medium', filters),
      sourceTab === 'utm_medium'
    )
  );
  const utmCampaignQ = useQuery(
    tileOpts(
      ['utm', 'campaign'],
      () => api.getUtm(siteId, period, 'campaign', filters),
      sourceTab === 'utm_campaign'
    )
  );
  const aiSourcesQ = useQuery(
    tileOpts(['ai-sources'], () => api.getAiSources(siteId, period, filters), sourceTab === 'ai')
  );

  // Below-fold panels
  const countriesQ = useQuery(
    tileOpts(
      ['locations', 'country'],
      () => api.getLocations(siteId, period, 'country', filters),
      belowFoldVisible && locationTab === 'country',
      true
    )
  );
  const regionsQ = useQuery(
    tileOpts(
      ['locations', 'region'],
      () => api.getLocations(siteId, period, 'region', filters),
      belowFoldVisible && locationTab === 'region'
    )
  );
  const citiesQ = useQuery(
    tileOpts(
      ['locations', 'city'],
      () => api.getLocations(siteId, period, 'city', filters),
      belowFoldVisible && locationTab === 'city'
    )
  );
  const browsersQ = useQuery(
    tileOpts(
      ['devices', 'browser'],
      () => api.getDevices(siteId, period, 'browser', filters),
      belowFoldVisible && deviceTab === 'browser',
      true
    )
  );
  const osQ = useQuery(
    tileOpts(
      ['devices', 'os'],
      () => api.getDevices(siteId, period, 'os', filters),
      belowFoldVisible && deviceTab === 'os'
    )
  );
  const deviceTypeQ = useQuery(
    tileOpts(
      ['devices', 'device'],
      () => api.getDevices(siteId, period, 'device', filters),
      belowFoldVisible && deviceTab === 'device'
    )
  );
  const screenSizeQ = useQuery(
    tileOpts(
      ['devices', 'size'],
      () => api.getDevices(siteId, period, 'size', filters),
      belowFoldVisible && deviceTab === 'size'
    )
  );
  const eventsQ = useQuery(
    tileOpts(['events'], () => api.getEvents(siteId, period, filters), belowFoldVisible)
  );
  const outboundQ = useQuery(
    tileOpts(
      ['links', 'outbound'],
      () => api.getLinks(siteId, period, 'outbound', filters),
      belowFoldVisible && linkTab === 'outbound'
    )
  );
  const downloadsQ = useQuery(
    tileOpts(
      ['links', 'download'],
      () => api.getLinks(siteId, period, 'download', filters),
      belowFoldVisible && linkTab === 'download'
    )
  );
  const goalStatsQ = useQuery(
    tileOpts(['goals'], () => api.getGoalStats(siteId, period, filters), belowFoldVisible)
  );

  // Funnel definitions live in D1 (cheap); stats are one R2 SQL scan per funnel,
  // so only the selected funnel's stats query runs.
  const funnelsQ = useQuery({
    queryKey: ['site-funnels', siteId],
    queryFn: async () => {
      return api.getFunnels(siteId);
    },
    staleTime: 60_000,
    enabled: belowFoldVisible,
  });
  const funnelList = ((funnelsQ.data as any)?.data ?? []) as FunnelDef[];
  const activeFunnelId =
    selectedFunnelId && funnelList.some(f => f.id === selectedFunnelId)
      ? selectedFunnelId
      : (funnelList[0]?.id ?? null);
  const funnelStatsQ = useQuery(
    tileOpts(
      ['funnel', activeFunnelId],
      () => api.getFunnelStats(siteId, activeFunnelId!, period, filters),
      belowFoldVisible && activeFunnelId !== null
    )
  );
  const eventPropsQ = useQuery(
    tileOpts(
      ['event-props', selectedEvent],
      () => api.getEventProps(siteId, period, selectedEvent!, filters),
      belowFoldVisible && selectedEvent !== null
    )
  );

  // Live visitor count (last 5 min, straight from the site's DO)
  const realtimeQ = useQuery({
    queryKey: ['site-analytics', siteId, 'realtime'],
    queryFn: async () => {
      return api.getRealtime(siteId);
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const site = (siteData as any)?.data;
  // Members are view-only: manage affordances render only once the site has
  // loaded with an owner role (server enforces regardless).
  const canManage = !!site && site.role !== 'member';
  const currentVisitors: number | null = (realtimeQ.data as any)?.data?.currentVisitors ?? null;

  if (siteError || (!siteLoading && !site)) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="rounded-[20px] bg-white px-8 py-16 text-center shadow-float">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
            <Globe className="h-8 w-8 text-[#9B9590]" />
          </div>
          <p className="text-[17px] font-semibold text-[#3D3B4F]">Site not found</p>
          <p className="mx-auto mt-2 max-w-sm text-[14px] text-[#9B9590]">
            It may have been deleted, or this link points somewhere that no longer exists.
          </p>
          <Link
            to="/portal/sites"
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-[#3D3B4F] px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#2C2B3B]"
          >
            Back to sites
          </Link>
        </div>
      </div>
    );
  }

  const pagesQueries: Record<string, typeof topPagesQ> = {
    top: topPagesQ,
    entry: entryPagesQ,
    exit: exitPagesQ,
  };
  const pagesQ = pagesQueries[pagesTab];

  const sourceQueries: Record<string, typeof referrersQ> = {
    referrers: referrersQ,
    utm_source: utmSourceQ,
    utm_medium: utmMediumQ,
    utm_campaign: utmCampaignQ,
    ai: aiSourcesQ,
  };
  const sourceQ = sourceQueries[sourceTab];
  const linkQ = linkTab === 'download' ? downloadsQ : outboundQ;

  const locationQueries: Record<string, typeof countriesQ> = {
    country: countriesQ,
    region: regionsQ,
    city: citiesQ,
  };
  const locationQ = locationQueries[locationTab];
  // Location rows keep `name` as the raw filter value (ISO code for the
  // country tab) and get a flag + readable label for display.
  const locationItems: PanelItem[] | undefined = (
    (locationQ.data as any)?.data as
      | { name: string; country?: string; visitors: number }[]
      | undefined
  )?.map(r => {
    const cc = locationTab === 'country' ? r.name : r.country;
    return {
      ...r,
      label: locationTab === 'country' ? countryName(r.name) : r.name,
      icon: <CountryFlag code={cc} />,
      id: `${cc ?? ''}|${r.name}`,
    };
  });
  const deviceQueries: Record<string, typeof browsersQ> = {
    browser: browsersQ,
    os: osQ,
    device: deviceTypeQ,
    size: screenSizeQ,
  };
  const deviceQ = deviceQueries[deviceTab];
  const deviceItems: PanelItem[] | undefined = (
    (deviceQ.data as any)?.data as PanelItem[] | undefined
  )?.map(r => ({
    ...r,
    icon: <DimensionIcon kind={deviceTab as 'browser' | 'os' | 'device' | 'size'} name={r.name} />,
  }));

  const events = (eventsQ.data as any)?.data as
    | { name: string; count: number; totalValue: number }[]
    | undefined;

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="space-y-6">
        {/* Header: identity block */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              to="/portal/sites"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#B5B0AA] transition-all hover:bg-white hover:text-[#3D3B4F] cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="flex items-center gap-2.5 text-[22px] font-bold leading-tight text-[#3D3B4F] tracking-[-0.02em]">
                {site?.favicon && (
                  <img
                    src={site.favicon}
                    alt=""
                    draggable={false}
                    className="h-[22px] w-[22px] rounded-[5px] object-contain"
                  />
                )}
                {site?.name || 'Analytics'}
              </h1>
              <div className="mt-1 flex items-center gap-2.5 text-[12.5px]">
                {site?.domain && <span className="text-[#9B9590]">{site.domain}</span>}
                {site?.domain && currentVisitors !== null && (
                  <span className="h-[3px] w-[3px] rounded-full bg-[#D8D2CA]" />
                )}
                <LiveStatus count={currentVisitors} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Actions fused into one segmented cluster; Delete lives in the
                overflow so it never sits one slip away from Refresh. */}
            <div className="flex items-center overflow-hidden rounded-full border border-[#E6E4DE] bg-white">
              <button onClick={() => setInstallOpen(true)} className={SEG_BTN} title="Installation">
                <Code2 className="w-[15px] h-[15px]" />
              </button>
              <SegmentsMenu
                siteId={siteId}
                filters={filters}
                hasFilters={hasFilters}
                onApply={applySegment}
              />
              {canManage && (
                <button onClick={() => setEditOpen(true)} className={SEG_BTN} title="Site settings">
                  <Settings className="w-[15px] h-[15px]" />
                </button>
              )}
              <button onClick={handleRefresh} className={SEG_BTN} title="Refresh data">
                <RefreshCw className={`w-[15px] h-[15px] ${refreshing ? 'animate-spin' : ''}`} />
              </button>
              {canManage && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className={SEG_BTN} title="More">
                      <MoreHorizontal className="w-[15px] h-[15px]" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-44 rounded-2xl bg-white border-none shadow-float"
                  >
                    <DropdownMenuItem
                      onClick={() => setDeleteOpen(true)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#e5484d] focus:text-[#e5484d] focus:bg-red-50 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete site
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <PeriodPicker value={period} onChange={setPeriod} />
          </div>
        </div>

        {/* Active filters */}
        {hasFilters && (
          <FilterChips filters={filters} onRemove={removeFilter} onClear={clearFilters} />
        )}

        {/* Main chart card: metric tiles + timeseries */}
        <ChartCard
          stats={(mainQ.data as any)?.data}
          statsLoading={mainQ.isLoading}
          statsError={mainQ.isError}
          timeseries={(timeseriesQ.data as any)?.data}
          timeseriesLoading={timeseriesQ.isLoading}
          timeseriesError={timeseriesQ.isError}
          metric={chartMetric}
          onMetricChange={setChartMetric}
          period={period}
        />

        {/* Pages + Sources */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <PanelCard
            title="Top Pages"
            labelHeader={
              pagesTab === 'top' ? 'Page' : pagesTab === 'entry' ? 'Entry page' : 'Exit page'
            }
            items={(pagesQ.data as any)?.data}
            isLoading={pagesQ.isLoading}
            isError={pagesQ.isError}
            showPageviews={pagesTab === 'top'}
            tabs={[
              { key: 'top', label: 'Pages' },
              { key: 'entry', label: 'Entry' },
              { key: 'exit', label: 'Exit' },
            ]}
            activeTab={pagesTab}
            onTabChange={setPagesTab}
            onItemClick={item => setFilter('page', item.name)}
          />
          <PanelCard
            title="Top Sources"
            labelHeader={sourceTab === 'ai' ? 'AI Assistant' : 'Source'}
            items={(sourceQ.data as any)?.data}
            isLoading={sourceQ.isLoading}
            isError={sourceQ.isError}
            emptyText={sourceTab === 'ai' ? 'No AI traffic yet' : undefined}
            tabs={[
              { key: 'referrers', label: 'Referrers' },
              { key: 'utm_source', label: 'UTM Source' },
              { key: 'utm_medium', label: 'Medium' },
              { key: 'utm_campaign', label: 'Campaign' },
              { key: 'ai', label: 'AI' },
            ]}
            activeTab={sourceTab}
            onTabChange={setSourceTab}
            onItemClick={
              // AI rows are assistant names spanning several referrer
              // hostnames — no single exact-match filter value exists.
              sourceTab === 'ai'
                ? undefined
                : item => {
                    const keyByTab: Record<string, keyof AnalyticsFilters> = {
                      referrers: 'source',
                      utm_source: 'utmSource',
                      utm_medium: 'utmMedium',
                      utm_campaign: 'utmCampaign',
                    };
                    setFilter(keyByTab[sourceTab], item.name);
                  }
            }
          />
        </div>

        {/* Below-fold sentinel + lazy-rendered sections */}
        <div ref={belowFoldRef} />
        {belowFoldVisible && (
          <>
            {/* Locations + Devices */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <PanelCard
                title="Locations"
                labelHeader={
                  locationTab === 'country'
                    ? 'Country'
                    : locationTab === 'region'
                      ? 'Region'
                      : 'City'
                }
                items={locationItems}
                isLoading={locationQ.isLoading}
                isError={locationQ.isError}
                tabs={[
                  { key: 'country', label: 'Countries' },
                  { key: 'region', label: 'Regions' },
                  { key: 'city', label: 'Cities' },
                ]}
                activeTab={locationTab}
                onTabChange={setLocationTab}
                onItemClick={item =>
                  setFilter(
                    locationTab === 'country'
                      ? 'country'
                      : locationTab === 'region'
                        ? 'region'
                        : 'city',
                    item.name
                  )
                }
              />
              <PanelCard
                title="Devices"
                labelHeader={
                  deviceTab === 'browser'
                    ? 'Browser'
                    : deviceTab === 'os'
                      ? 'OS'
                      : deviceTab === 'device'
                        ? 'Device'
                        : 'Size'
                }
                items={deviceItems}
                showPercentage
                isLoading={deviceQ.isLoading}
                isError={deviceQ.isError}
                tabs={[
                  { key: 'browser', label: 'Browser' },
                  { key: 'os', label: 'OS' },
                  { key: 'device', label: 'Device' },
                  { key: 'size', label: 'Size' },
                ]}
                activeTab={deviceTab}
                onTabChange={setDeviceTab}
                onItemClick={
                  // Screen-size buckets are computed, not a stored column - no filter.
                  deviceTab === 'size'
                    ? undefined
                    : item =>
                        setFilter(
                          deviceTab === 'browser'
                            ? 'browser'
                            : deviceTab === 'os'
                              ? 'os'
                              : 'device',
                          item.name
                        )
                }
              />
            </div>

            {/* Goal conversions, custom events, and auto-tracked links —
                each a full-width tile: events are business actions with a
                props drill-down; outbound/downloads share one card as tabs
                since they're the same shape (URL + clicks). */}
            <GoalsPanel
              goals={(goalStatsQ.data as any)?.data}
              isLoading={goalStatsQ.isLoading}
              isError={goalStatsQ.isError}
              onAdd={canManage ? () => setGoalForm({ goal: null }) : undefined}
              onManage={canManage ? () => setGoalsOpen(true) : undefined}
            />
            {selectedEvent === null ? (
              <PanelCard
                title="Custom Events"
                labelHeader="Event"
                valueHeader="Count"
                items={events?.map(e => ({ name: e.name, visitors: e.count }))}
                isLoading={eventsQ.isLoading}
                isError={eventsQ.isError}
                emptyText="No custom events yet"
                onItemClick={item => setSelectedEvent(item.name)}
              />
            ) : (
              <PanelCard
                title={selectedEvent}
                labelHeader="Property"
                valueHeader="Events"
                items={(
                  (eventPropsQ.data as any)?.data as
                    | { key: string; value: string; events: number }[]
                    | undefined
                )?.map(p => ({
                  name: `${p.key}: ${p.value}`,
                  visitors: p.events,
                }))}
                isLoading={eventPropsQ.isLoading}
                isError={eventPropsQ.isError}
                emptyText="No properties on this event"
                headerAction={
                  <button
                    onClick={() => setSelectedEvent(null)}
                    className="ml-auto shrink-0 rounded-full bg-muted px-3 py-1 text-[11px] font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
                  >
                    ← All events
                  </button>
                }
              />
            )}
            <PanelCard
              title="Links"
              labelHeader="URL"
              items={(linkQ.data as any)?.data}
              isLoading={linkQ.isLoading}
              isError={linkQ.isError}
              tabs={LINK_TABS}
              activeTab={linkTab}
              onTabChange={setLinkTab}
              emptyText={
                linkTab === 'outbound' ? 'No outbound clicks yet' : 'No file downloads yet'
              }
            />

            {/* Funnels */}
            <FunnelsPanel
              funnels={funnelsQ.isLoading ? undefined : funnelList}
              selectedId={activeFunnelId}
              onSelect={setSelectedFunnelId}
              stat={(funnelStatsQ.data as any)?.data as FunnelStat | undefined}
              isLoading={funnelStatsQ.isLoading}
              isError={funnelStatsQ.isError || funnelsQ.isError}
              onAdd={canManage ? () => setFunnelForm({ funnel: null }) : undefined}
              onManage={canManage ? () => setFunnelsOpen(true) : undefined}
            />
          </>
        )}
      </div>

      <EditSiteModal
        open={editOpen}
        onOpenChange={setEditOpen}
        site={site ? { name: site.name, domain: site.domain, timezone: site.timezone } : null}
        siteId={siteId}
      />

      <InstallModal open={installOpen} onOpenChange={setInstallOpen} site={site} />

      <ManageGoalsModal
        open={goalsOpen}
        onOpenChange={setGoalsOpen}
        siteId={siteId}
        onEdit={goal => {
          setGoalsOpen(false);
          setReturnToManage(true);
          setGoalForm({ goal });
        }}
      />

      <GoalFormModal
        open={goalForm !== null}
        onOpenChange={openState => {
          if (!openState) {
            setGoalForm(null);
            if (returnToManage) {
              setReturnToManage(false);
              setGoalsOpen(true);
            }
          }
        }}
        siteId={siteId}
        goal={goalForm?.goal ?? null}
      />

      <ManageFunnelsModal
        open={funnelsOpen}
        onOpenChange={setFunnelsOpen}
        siteId={siteId}
        onEdit={funnel => {
          setFunnelsOpen(false);
          setReturnToManageFunnels(true);
          setFunnelForm({ funnel });
        }}
      />

      <FunnelFormModal
        open={funnelForm !== null}
        onOpenChange={openState => {
          if (!openState) {
            setFunnelForm(null);
            if (returnToManageFunnels) {
              setReturnToManageFunnels(false);
              setFunnelsOpen(true);
            }
          }
        }}
        siteId={siteId}
        funnel={funnelForm?.funnel ?? null}
      />

      <DeleteSiteModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        site={site ? { name: site.name, domain: site.domain } : null}
        siteId={siteId}
      />
    </main>
  );
}
