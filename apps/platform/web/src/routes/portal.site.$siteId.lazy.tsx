import { useState, useEffect, useCallback, useRef, type ReactElement, type ReactNode } from 'react';
import { createLazyFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  ArrowUpRight,
  ArrowDownRight,
  Settings,
  Code2,
  Copy,
  Check,
  Zap,
  Trash2,
  BookmarkPlus,
  Globe,
} from 'lucide-react';
import type {
  PeriodParam,
  MainStats,
  FunnelDef,
  FunnelStat,
  SegmentDef,
  SegmentFilters,
  PublicSiteInfo,
  GoalStat,
  BotGroup,
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
import { LivePill } from '@/components/analytics/LivePill';
import { LiveModal } from '@/components/analytics/LiveModal';
import { FilterChips, FILTER_LABELS, describeFilter } from '@/components/analytics/FilterChips';
import { useRealtime } from '@/lib/useRealtime';
import { CountryFlag, countryName } from '@/components/analytics/CountryFlag';
import { DimensionIcon } from '@/components/analytics/DimensionIcon';
import { PlatformSelect } from '@/components/install/PlatformSelect';
import { GoalsPanel } from '@/components/analytics/GoalsPanel';
import { GoalFormModal, type GoalDef } from '@/components/analytics/GoalFormModal';
import { GoalsDrawer } from '@/components/analytics/GoalsDrawer';
import { FunnelFormModal } from '@/components/analytics/FunnelFormModal';
import { FunnelsDrawer } from '@/components/analytics/FunnelsDrawer';
import { FunnelsPanel } from '@/components/analytics/FunnelsPanel';
import { PageFlowPanel, type PathRow, type PathTotals } from '@/components/analytics/PageFlowPanel';
import {
  ConversionsPanel,
  type AttributionDim,
  type AttributionRow,
} from '@/components/analytics/ConversionsPanel';
import { PeriodPicker, periodLabel } from '@/components/layout/PeriodPicker';
import { Sticker } from '@/components/ui/sticker';
import { api, type AnalyticsFilters } from '@/lib/api';
import { publicStatsApi, type StatsApi } from '@/lib/publicApi';
import { propsSearch, type SiteSearch } from './portal.site.$siteId';
import { FieldError } from '@/components/ui/field-error';
import {
  domainInputError,
  normalizeDomain,
  requiredTextError,
  isPreset,
  propsFilterValue,
  MAX_PROP_FILTERS,
} from '@traks/shared';
import { useCollectUrl } from '@/lib/config';
import { ShareDialog } from '@/components/sites/ShareDialog';

// Auto-poll only 'today' - it's served live from the site's Durable Object
// (millisecond queries, zero ingest delay), so a 15s poll gives a live feel
// at negligible cost. Historical periods barely change and are covered by
// staleTime + the manual refresh button.
function getRefetchInterval(period: PeriodParam): number | false {
  return period === 'today' ? 15_000 : false;
}

// staleTime per period - longer periods change less frequently
function getStaleTime(period: PeriodParam): number {
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
    <div className="relative rounded-xl border border-border bg-background overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/60">
        <span className="font-mono text-[11px] text-faint">{label ?? 'Snippet'}</span>
        <button
          onClick={() => void copy()}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium text-subtle hover:text-foreground transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-muted-foreground" />
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
      <pre className="text-[12px] leading-relaxed text-foreground font-mono whitespace-pre-wrap break-all select-all px-4 py-3.5">
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
  // Empty until the instance config resolves - never guess the collect origin.
  const snippet = siteKey && collectUrl ? trackerSnippet(siteKey, collectUrl) : '';
  // The shared install guides, with THIS site's real snippet substituted in -
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
            <Code2 className="w-5 h-5 text-muted-foreground" strokeWidth={1.7} />
          </div>
          <DialogTitle>Installation</DialogTitle>
          <DialogDescription>
            Install the tracker on{' '}
            <span className="font-semibold text-foreground">{site?.domain}</span>. Pick your stack
            for exact steps with your site key filled in.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-4">
            <PlatformSelect guides={INSTALL_GUIDES} value={platform} onChange={setPlatform} />

            <div className="space-y-4">
              {guide.steps.map((step, i) => (
                <div key={step.title}>
                  <p className="text-[13px] font-semibold text-foreground">
                    {i + 1}. {step.title}
                  </p>
                  {step.body && (
                    <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                      {step.body}
                    </p>
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
            <div className="flex gap-3 rounded-xl bg-muted border border-border px-4 py-3.5">
              <Zap className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" strokeWidth={1.7} />
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                1.5 KB gzipped, loads deferred - zero impact on page speed. Data appears within
                seconds of the first visit.
              </p>
            </div>
          </div>
        </DialogBody>

        <DialogFooter className="border-t border-border/50 mx-6 px-0 pb-5 pt-4">
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
            className="bg-btn hover:bg-btn-hover text-white shadow-none text-[13px] px-5 cursor-pointer"
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
      // The API refreshes the favicon behind the response; pick it up once
      // that has had a moment to land so the new icon shows without a reload.
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['site', siteId] });
        queryClient.invalidateQueries({ queryKey: ['sites'] });
      }, 2500);
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
              <label className="mb-2 block text-[13px] font-medium text-foreground">
                Site Name
              </label>
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
              <label className="mb-2 block text-[13px] font-medium text-foreground">Domain</label>
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
                <p className="mt-2 text-[12px] text-faint">
                  {domain.trim() && normalizeDomain(domain) !== domain.trim()
                    ? `Will be saved as ${normalizeDomain(domain)}`
                    : 'Just the domain (a pasted URL works too)'}
                </p>
              )}
            </div>
            <div>
              <label className="mb-2 block text-[13px] font-medium text-foreground">Timezone</label>
              <TimezoneSelect
                value={timezone}
                onChange={tz => {
                  setTimezone(tz);
                  setError('');
                }}
              />
              <p className="mt-2 text-[12px] text-faint">
                Dashboard days and hours are bucketed in this timezone.
              </p>
            </div>
            {error && <p className="text-[13px] text-[#e07a5f]">{error}</p>}
          </div>
        </DialogBody>

        <DialogFooter className="border-t border-border/50 mx-6 px-0 pb-5 pt-4">
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
            <p className="text-[13px] text-foreground">
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

        <DialogFooter className="border-t border-border/50 mx-6 px-0 pb-5 pt-4">
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

const LINK_TABS = [
  { key: 'outbound', label: 'Outbound' },
  { key: 'download', label: 'Downloads' },
];

/** Bots panel tabs. 'Other' takes SEO tools, monitors and unnamed bots. */
const BOT_TABS: { key: 'all' | BotGroup; label: string; empty: string }[] = [
  { key: 'all', label: 'All', empty: 'No bot visits yet' },
  { key: 'search', label: 'Search', empty: 'No search crawler visits yet' },
  { key: 'ai', label: 'AI', empty: 'No AI crawler visits yet' },
  { key: 'social', label: 'Social', empty: 'No link preview visits yet' },
  { key: 'other', label: 'Other', empty: 'No other bot visits yet' },
];

/** Six tiles: one row from lg, two rows of three below it. Each tile draws
 *  its own left divider, so the first of each row drops it and the second
 *  row gets a top hairline. */
const METRIC_GRID =
  'grid grid-cols-3 border-b border-border lg:grid-cols-6 max-lg:[&>*:nth-child(3n+1)]:border-l-0 max-lg:[&>*:nth-child(n+4)]:border-t max-lg:[&>*:nth-child(n+4)]:border-t-[#F1EFEA]';

function MetricTile({
  label,
  shortLabel,
  value,
  change,
  active,
  onClick,
  higherIsWorse,
}: {
  label: string;
  /** Phone-width label, where the full one would truncate. */
  shortLabel?: string;
  value: string;
  change: number | null;
  active?: boolean;
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
        'relative flex min-w-0 flex-col items-start gap-[7px] border-l border-muted px-3.5 py-4 text-left transition-colors first:border-l-0 sm:px-[22px] sm:py-5',
        onClick && 'cursor-pointer hover:bg-muted/60'
      )}
    >
      <span className="max-w-full truncate text-[10px] font-bold uppercase tracking-[0.07em] text-subtle sm:text-[10.5px] sm:tracking-[0.09em]">
        {shortLabel ? (
          <>
            <span className="sm:hidden">{shortLabel}</span>
            <span className="max-sm:hidden">{label}</span>
          </>
        ) : (
          label
        )}
      </span>
      <span
        className={cn(
          'text-[21px] sm:text-[25px] leading-none tracking-[-0.02em] tabular-nums',
          active || !onClick ? 'font-bold text-foreground' : 'font-semibold text-muted-foreground'
        )}
      >
        {value}
      </span>
      {delta ? (
        <span
          className={cn(
            'flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10.5px] font-bold',
            isGood ? 'bg-[#28E99F]/15 text-success-ink' : 'bg-coral/15 text-coral-ink'
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
        <span className="text-[10.5px] font-semibold text-faint">-</span>
      )}
      {/* Active indicator: the same ink underline as the nav tabs */}
      <span
        className={cn(
          'absolute inset-x-3.5 bottom-0 h-[2px] rounded-t-full bg-btn transition-opacity sm:inset-x-[22px]',
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
  period: PeriodParam;
}): ReactElement {
  const viewsPerVisit =
    stats && stats.sessions > 0 ? (stats.pageviews / stats.sessions).toFixed(2) : '0';

  return (
    <div className="overflow-hidden rounded-[20px] bg-card shadow-float">
      {/* KPI columns */}
      {statsError ? (
        <p className="border-b border-border px-6 py-5 text-[13px] text-[#e07a5f]">
          Failed to load stats
        </p>
      ) : statsLoading || !stats ? (
        <div className={METRIC_GRID}>
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 border-l border-muted px-3.5 py-4 first:border-l-0 sm:px-[22px] sm:py-5"
            >
              <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              <div className="h-6 w-14 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : (
        <div className={METRIC_GRID}>
          <MetricTile
            label="Unique Visitors"
            shortLabel="Visitors"
            value={formatNumber(stats.visitors)}
            change={stats.visitorsChange}
            active={metric === 'visitors'}
            onClick={() => onMetricChange('visitors')}
          />
          <MetricTile
            label="Total Pageviews"
            shortLabel="Pageviews"
            value={formatNumber(stats.pageviews)}
            change={stats.pageviewsChange}
            active={metric === 'pageviews'}
            onClick={() => onMetricChange('pageviews')}
          />
          <MetricTile
            label="Visits"
            value={formatNumber(stats.sessions)}
            change={stats.sessionsChange}
            active={metric === 'sessions'}
            onClick={() => onMetricChange('sessions')}
          />
          <MetricTile
            label="Views / Visit"
            shortLabel="Views/Visit"
            value={viewsPerVisit}
            change={null}
          />
          <MetricTile
            label="Bounce Rate"
            shortLabel="Bounce"
            value={`${stats.bounceRate}%`}
            change={stats.bounceRateChange}
            higherIsWorse
          />
          <MetricTile
            label="Visit Duration"
            shortLabel="Duration"
            value={formatDuration(stats.avgDuration ?? 0)}
            change={stats.avgDuration || stats.avgDurationChange ? stats.avgDurationChange : null}
          />
        </div>
      )}

      {/* Chart */}
      <div className="px-4 pb-4 pt-5 sm:px-6">
        <div className="mb-3.5 flex items-baseline justify-between">
          <h3 className="text-[15px] font-bold tracking-[-0.01em] text-foreground">
            {metric === 'visitors'
              ? 'Unique Visitors'
              : metric === 'pageviews'
                ? 'Total Pageviews'
                : 'Visits'}
          </h3>
          <span className="text-[12px] text-faint">{periodLabel(period)}</span>
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

/** One slot in the site header's action cluster. Circular hover, no
 *  dividers - the cluster must NOT clip (the dropdowns inside render
 *  absolutely within it), so slots round themselves. */
const SEG_BTN =
  'flex h-8 w-8 sm:h-[34px] sm:w-[34px] items-center justify-center rounded-[10px] hover:bg-muted transition-colors cursor-pointer';
/** Sticker size inside a header action slot. */
const SEG_ICON = 'h-[22px] w-[22px]';

/** CSS-only tooltip for the cluster icons (works around any wrapper). Off on
 *  touch screens, where a tap leaves it stuck open. */
function IconTip({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <span className="group relative flex">
      {children}
      <span className="pointer-events-none absolute -bottom-8 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-lg bg-btn px-2.5 py-1 text-[11px] font-medium text-background opacity-0 transition-opacity delay-150 duration-100 group-hover:opacity-100 [@media(hover:none)]:hidden">
        {label}
      </span>
    </span>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (saveOpen) {
      setName('');
      setError('');
    }
  }, [saveOpen]);

  // Fetched only once the menu opens (same gate as the goals/funnels
  // drawers) - the list isn't needed to render the closed trigger button.
  const segmentsQ = useQuery({
    queryKey: ['site-segments', siteId],
    queryFn: async () => {
      return api.getSegments(siteId);
    },
    staleTime: 60_000,
    enabled: menuOpen,
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
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button className={SEG_BTN} title="Segments">
            <Sticker name="bookmark" className={SEG_ICON} />
          </button>
        </DropdownMenuTrigger>
        {/* On phones the toolbar sits at the left edge, so the menu opens
            rightward from the button instead of hanging off-screen. */}
        <DropdownMenuContent
          align="end"
          className="w-64 rounded-2xl bg-card border-none shadow-float max-sm:left-0 max-sm:right-auto"
        >
          <DropdownMenuLabel className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-faint">
            Segments
          </DropdownMenuLabel>
          {/* isPending, not isLoading: the query is disabled until the menu
              opens, and isLoading is false for that first frame - it would
              flash the "No saved segments" empty state before the fetch. */}
          {segmentsQ.isPending ? (
            <p className="px-4 pb-3 pt-1 text-[12.5px] text-subtle">Loading segments…</p>
          ) : segmentsQ.isError ? (
            <p className="px-4 pb-3 pt-1 text-[12.5px] leading-relaxed text-[#e07a5f]">
              Couldn&rsquo;t load your saved segments.
            </p>
          ) : segments.length === 0 ? (
            <p className="px-4 pb-3 pt-1 text-[12.5px] leading-relaxed text-subtle">
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
                  <span className="block truncate text-[13px] font-medium text-foreground">
                    {segment.name}
                  </span>
                  <span className="block truncate text-[11px] text-subtle">
                    {Object.entries(segment.filters)
                      .filter(([, v]) => v)
                      .map(([k, v]) => describeFilter(k as keyof AnalyticsFilters, v))
                      .join(' · ')}
                  </span>
                </span>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    deleteSegment.mutate(segment.id);
                  }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint opacity-0 transition-all hover:text-[#e07a5f] group-hover:opacity-100 [@media(hover:none)]:opacity-100 cursor-pointer"
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
                className="flex items-center gap-2.5 px-4 py-2.5 cursor-pointer text-[13px] font-medium text-foreground"
              >
                <BookmarkPlus className="h-4 w-4 text-muted-foreground" />
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
              <BookmarkPlus className="w-5 h-5 text-muted-foreground" strokeWidth={1.7} />
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
                    className="flex items-center gap-1.5 rounded-full bg-muted py-1 px-3 text-[12px] text-foreground"
                  >
                    {key === 'props' ? (
                      <span className="max-w-[220px] truncate font-medium">
                        {describeFilter(key, value)}
                      </span>
                    ) : (
                      <>
                        <span className="text-subtle">{FILTER_LABELS[key]}</span>
                        <span className="max-w-[160px] truncate font-medium">{value}</span>
                      </>
                    )}
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

          <DialogFooter className="border-t border-border/50 mx-6 px-0 pb-5 pt-4">
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
              className="bg-btn hover:bg-btn-hover text-white shadow-none text-[13px] px-5 cursor-pointer"
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

function SiteAnalyticsPage(): ReactElement {
  const { siteId } = Route.useParams();
  const search = Route.useSearch();
  return <SiteDashboard siteId={siteId} search={search} />;
}

/**
 * The site dashboard. Signed in, it is the full dashboard with management
 * for owners. Given `shared` (a public site's info) it is the read-only share
 * page: stats come from the public API, and management, the live view,
 * segments and any section the owner didn't share are left out.
 */
export function SiteDashboard({
  siteId,
  search,
  shared,
}: {
  siteId: string;
  search: SiteSearch;
  shared?: PublicSiteInfo;
}): ReactElement {
  const statsApi: StatsApi = shared ? publicStatsApi : api;
  // URL state lives on whichever route is showing the dashboard.
  const basePath = shared ? '/share/$siteId' : '/portal/site/$siteId';
  const sharesGoals = !shared || shared.sections.goals;
  const sharesFunnels = !shared || shared.sections.funnels;
  const sharesEvents = !shared || shared.sections.events;
  const { period: searchPeriod } = search;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Share pages offer presets only (the public API refuses custom ranges), so
  // a hand-edited share link with one falls back to today.
  const period: PeriodParam =
    shared && searchPeriod && !isPreset(searchPeriod) ? 'today' : searchPeriod || 'today';

  const filters: AnalyticsFilters = {};
  for (const key of Object.keys(FILTER_LABELS) as (keyof AnalyticsFilters)[]) {
    const value = (search as Record<string, unknown>)[key];
    if (typeof value === 'string' && value) filters[key] = value;
  }
  // The props filter is an object in the URL; the API takes its JSON text.
  const propsFilter = propsSearch(search.props);
  if (propsFilter) filters.props = JSON.stringify(propsFilter);
  const filterKey = JSON.stringify(filters);
  const hasFilters = Object.keys(filters).length > 0;

  const setPeriod = useCallback(
    (p: PeriodParam) => {
      navigate({
        to: basePath,
        params: { siteId },
        search: prev => ({ ...prev, period: p }),
        replace: true,
      });
    },
    [navigate, siteId, basePath]
  );

  const setFilter = useCallback(
    (key: keyof AnalyticsFilters, value: string) => {
      navigate({
        to: basePath,
        params: { siteId },
        search: prev => ({ ...prev, [key]: value }),
        replace: true,
      });
    },
    [navigate, siteId, basePath]
  );

  // Live view -> dashboard: replace the whole filter set (keys the live view
  // cleared are cleared here too).
  const applyLiveFilters = useCallback(
    (next: AnalyticsFilters) => {
      const keys = Object.keys(FILTER_LABELS) as (keyof AnalyticsFilters)[];
      navigate({
        to: basePath,
        params: { siteId },
        search: prev => ({
          ...prev,
          ...Object.fromEntries(
            keys.map(k => [k, k === 'props' ? propsSearch(next[k]) : next[k] || undefined])
          ),
        }),
        replace: true,
      });
    },
    [navigate, siteId, basePath]
  );

  // Property filters live in one `props` param; these add or drop one pair.
  const setPropFilter = useCallback(
    (key: string, value: string | null) => {
      navigate({
        to: basePath,
        params: { siteId },
        search: prev => {
          let pairs = Object.entries(propsSearch(prev.props) ?? {}).filter(([k]) => k !== key);
          if (value !== null) pairs = [...pairs.slice(-(MAX_PROP_FILTERS - 1)), [key, value]];
          return {
            ...prev,
            props: pairs.length > 0 ? propsSearch(propsFilterValue(pairs)) : undefined,
          };
        },
        replace: true,
      });
    },
    [navigate, siteId, basePath]
  );

  const removeFilter = useCallback(
    (key: keyof AnalyticsFilters) => {
      navigate({
        to: basePath,
        params: { siteId },
        search: prev => ({ ...prev, [key]: undefined }),
        replace: true,
      });
    },
    [navigate, siteId, basePath]
  );

  const clearFilters = useCallback(() => {
    navigate({
      to: basePath,
      params: { siteId },
      search: prev => {
        const next = { ...prev } as Record<string, unknown>;
        for (const key of Object.keys(FILTER_LABELS)) next[key] = undefined;
        return next;
      },
      replace: true,
    });
  }, [navigate, siteId, basePath]);

  // Replace the active filters wholesale with a saved segment's set.
  const applySegment = useCallback(
    (segmentFilters: SegmentFilters) => {
      navigate({
        to: basePath,
        params: { siteId },
        search: prev => {
          const next = { ...prev } as Record<string, unknown>;
          for (const key of Object.keys(FILTER_LABELS)) {
            const value = (segmentFilters as Record<string, string | undefined>)[key];
            next[key] = key === 'props' ? propsSearch(value) : value || undefined;
          }
          return next;
        },
        replace: true,
      });
    },
    [navigate, siteId, basePath]
  );
  const [refreshing, setRefreshing] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(false);
  // Add/edit goal form: null = closed, { goal: null } = add (optionally
  // prefilled from `draft`, e.g. a duplicate), { goal } = edit.
  const [goalForm, setGoalForm] = useState<{
    goal: GoalDef | null;
    draft?: Omit<GoalDef, 'id'>;
  } | null>(null);
  // Same pair for funnels: drawer list, add/edit form (optionally prefilled
  // from `draft`, e.g. a duplicate). The drawer closes before the form opens.
  const [funnelForm, setFunnelForm] = useState<{
    funnel: FunnelDef | null;
    draft?: Omit<FunnelDef, 'id'>;
  } | null>(null);
  const [funnelsOpen, setFunnelsOpen] = useState(false);
  // Duplicate = the add form prefilled with a copy. Names cap at 100 chars;
  // keep the suffix inside it.
  const copyName = (name: string): string => `${name.slice(0, 95)} copy`;
  const duplicateGoal = ({ id: _id, ...rest }: GoalDef): void => {
    setGoalsOpen(false);
    setGoalForm({ goal: null, draft: { ...rest, name: copyName(rest.name) } });
  };
  const duplicateFunnel = ({ id: _id, ...rest }: FunnelDef): void => {
    setFunnelsOpen(false);
    setFunnelForm({ funnel: null, draft: { ...rest, name: copyName(rest.name) } });
  };
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
  const [botTab, setBotTab] = useState<'all' | BotGroup>('all');
  // Page flow: the page picked (or followed to); null = the default page.
  const [flowPage, setFlowPage] = useState<string | null>(null);
  // Conversions by source: goal (null = any goal) and UTM dimension.
  const [convGoalId, setConvGoalId] = useState<string | null>(null);
  const [convDim, setConvDim] = useState<AttributionDim>('source');

  // Lazy-render sentinels for below-fold sections
  const [belowFoldRef, belowFoldVisible] = useLazyVisible();

  // Live visitors (last 5 min): pushed from the site's DO over a WebSocket,
  // polled every 30s while the socket is down. Declared before handleRefresh,
  // which needs the connection status.
  const realtime = useRealtime(siteId, undefined, !shared);

  const handleRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    await queryClient.invalidateQueries({
      queryKey: ['site-analytics', siteId],
      // While the socket is live the realtime numbers are already pushed;
      // forcing the REST realtime fetch on top of that was a wasted request.
      predicate: q => realtime.status !== 'live' || q.queryKey[2] !== 'realtime',
    });
    await queryClient.invalidateQueries({ queryKey: ['site', siteId] });
    setTimeout(() => setRefreshing(false), 600);
  }, [queryClient, siteId, realtime.status]);

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
    // A share page already has the site's public identity.
    enabled: !shared,
  });

  // One request for the whole default view. /stats/all answers main,
  // timeseries, top pages, referrers, countries, browsers and OS from a single
  // server round-trip (and, on 'today', a single fan-out to the live store) -
  // seven browser requests collapsed into one. It has no filtered variant, so
  // the moment a filter chip is active we fall back to per-panel requests.
  const useBootstrap = !hasFilters;
  const bootstrapQ = useQuery({
    queryKey: ['site-analytics', siteId, 'all', period],
    queryFn: async () => statsApi.getAllStats(siteId, period),
    enabled: useBootstrap,
    refetchInterval: getRefetchInterval(period),
    staleTime: getStaleTime(period),
    // Period switches show the previous period's numbers while the new ones
    // load, instead of dropping the whole dashboard to skeletons.
    placeholderData: keepPreviousData,
  });

  // Seed each panel's cache from the bundle so the panel queries below find
  // fresh data and never hit the network. Panels stay independent components
  // with their own loading states; they just get their data early.
  //
  // ORDER MATTERS: this effect must stay declared ABOVE the tile useQuery
  // calls. Effects run in declaration order, so when the bundle resolves the
  // seed lands before each tile's observer mounts-and-fetches; declared after
  // them, every bundled panel would fire a duplicate request on first load.
  const bootstrapData = (bootstrapQ.data as { data?: Record<string, unknown> } | undefined)?.data;
  useEffect(() => {
    // Seed only while the unfiltered bundle answers the current view. When a
    // filter chip lands, filterKey changes and this effect re-runs while the
    // stale unfiltered bundle is still in cache - seeding then would stamp
    // unfiltered data onto the filtered query keys as fresh, so every panel
    // keeps showing unfiltered numbers until a manual refresh.
    // Same hazard on a period switch: keepPreviousData keeps the OLD period's
    // bundle in `data` while the new one loads, so seeding placeholder data
    // would stamp last period's numbers onto this period's keys as fresh.
    if (!bootstrapData || hasFilters || bootstrapQ.isPlaceholderData) return;
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
  }, [
    bootstrapData,
    queryClient,
    siteId,
    period,
    filterKey,
    hasFilters,
    bootstrapQ.isPlaceholderData,
  ]);

  // Panels covered by the bundle wait for it rather than racing it; if it
  // fails they fall back to fetching themselves, so a bundle error degrades
  // to the old behaviour instead of an empty dashboard. isPlaceholderData
  // matters: with keepPreviousData the bundle stays isSuccess while a NEW
  // period's fetch is in flight, and treating that as settled unlocked the
  // tiles to fetch in parallel with the bundle on every period switch - the
  // exact duplicate burst the bundle exists to prevent. While placeholder,
  // tiles stay gated (their own keepPreviousData keeps old rows on screen)
  // until the fresh bundle lands and re-seeds them.
  const bootstrapSettled =
    !useBootstrap || bootstrapQ.isError || (bootstrapQ.isSuccess && !bootstrapQ.isPlaceholderData);

  // Prefetch 'yesterday' once today's bundle is on screen. Yesterday is the
  // most-clicked period after today, and its first view each day is a cold
  // R2 SQL fan-out (its SQL is day-bounded, so midnight mints a new cache
  // key) - several seconds the viewer would otherwise wait for. Fetching it
  // behind the live dashboard moves that scan off the click; the server
  // cache makes every later prefetch a KV hit, so the cost is one scan set
  // per site per day. Runs after the bundle settles so it never competes
  // with the hot path, and only unfiltered (the bundle has no filtered form).
  useEffect(() => {
    if (period !== 'today' || hasFilters || !bootstrapSettled) return;
    void queryClient.prefetchQuery({
      queryKey: ['site-analytics', siteId, 'all', 'yesterday'],
      queryFn: async () => statsApi.getAllStats(siteId, 'yesterday'),
      staleTime: getStaleTime('yesterday'),
    });
  }, [queryClient, siteId, period, hasFilters, bootstrapSettled, statsApi]);

  // Per-tile parallel queries - each tile renders as its own request resolves.
  // Tabbed panels pass `enabled` so only the active tab's query runs (each
  // R2 SQL query is a paid distributed scan; don't fetch hidden tabs).
  // `inBundle` marks the panels /stats/all already answers.
  //
  // While the bundle is active and healthy it is the ONLY poller for the
  // panels it covers: its refetch re-seeds them via setQueryData above, so
  // giving those tiles their own refetchInterval would double every poll
  // (on 'today' that was ~11 requests per 15s, seven of them byte-identical
  // to the bundle). Tiles poll themselves only when the bundle is disabled
  // (filters active) or erroring.
  const bundlePolls = useBootstrap && !bootstrapQ.isError;
  const tileOpts = (
    key: readonly unknown[],
    call: () => Promise<unknown>,
    enabled = true,
    inBundle = false,
    // Off for tiles whose key embeds an entity id (funnel, event props):
    // there a key change means "different entity", and holding the previous
    // one's numbers would show them under the new entity's name.
    keepPrevious = true
  ): Parameters<typeof useQuery>[0] => ({
    queryKey: ['site-analytics', siteId, ...key, period, filterKey],
    queryFn: async () => {
      return call();
    },
    refetchInterval: inBundle && bundlePolls ? false : getRefetchInterval(period),
    staleTime: getStaleTime(period),
    enabled: enabled && (!inBundle || bootstrapSettled),
    // Key changes (period/filter switches) show the previous view's rows
    // while the new ones load, instead of dropping every panel to skeletons.
    placeholderData: keepPrevious ? keepPreviousData : undefined,
  });

  const mainQ = useQuery(
    tileOpts(['main'], () => statsApi.getMainStats(siteId, period, filters), true, true)
  );
  const timeseriesQ = useQuery(
    tileOpts(['timeseries'], () => statsApi.getTimeseries(siteId, period, filters), true, true)
  );

  // keepPreviousData means a period or filter switch leaves the previous
  // view's numbers on screen while the new ones load. A cold R2 SQL fan-out
  // takes several seconds, and a pill that highlights while nothing else
  // moves reads as a dead click - so surface the in-flight switch: the
  // refresh icon spins and the panels dim until the new rows land.
  const switching =
    bootstrapQ.isPlaceholderData || mainQ.isPlaceholderData || timeseriesQ.isPlaceholderData;
  // Pages panel: top pages or entry/exit pages (first/last page of each session)
  const topPagesQ = useQuery(
    tileOpts(
      ['pages', 'top'],
      () => statsApi.getTopPages(siteId, period, 'top', filters),
      pagesTab === 'top',
      true
    )
  );
  const entryPagesQ = useQuery(
    tileOpts(
      ['pages', 'entry'],
      () => statsApi.getTopPages(siteId, period, 'entry', filters),
      pagesTab === 'entry'
    )
  );
  const exitPagesQ = useQuery(
    tileOpts(
      ['pages', 'exit'],
      () => statsApi.getTopPages(siteId, period, 'exit', filters),
      pagesTab === 'exit'
    )
  );

  // Sources panel: referrers or one of the UTM dimensions
  const referrersQ = useQuery(
    tileOpts(
      ['referrers'],
      () => statsApi.getTopReferrers(siteId, period, filters),
      sourceTab === 'referrers',
      true
    )
  );
  const utmSourceQ = useQuery(
    tileOpts(
      ['utm', 'source'],
      () => statsApi.getUtm(siteId, period, 'source', filters),
      sourceTab === 'utm_source'
    )
  );
  const utmMediumQ = useQuery(
    tileOpts(
      ['utm', 'medium'],
      () => statsApi.getUtm(siteId, period, 'medium', filters),
      sourceTab === 'utm_medium'
    )
  );
  const utmCampaignQ = useQuery(
    tileOpts(
      ['utm', 'campaign'],
      () => statsApi.getUtm(siteId, period, 'campaign', filters),
      sourceTab === 'utm_campaign'
    )
  );
  const aiSourcesQ = useQuery(
    tileOpts(
      ['ai-sources'],
      () => statsApi.getAiSources(siteId, period, filters),
      sourceTab === 'ai'
    )
  );

  // Below-fold panels
  const countriesQ = useQuery(
    tileOpts(
      ['locations', 'country'],
      () => statsApi.getLocations(siteId, period, 'country', filters),
      belowFoldVisible && locationTab === 'country',
      true
    )
  );
  const regionsQ = useQuery(
    tileOpts(
      ['locations', 'region'],
      () => statsApi.getLocations(siteId, period, 'region', filters),
      belowFoldVisible && locationTab === 'region'
    )
  );
  const citiesQ = useQuery(
    tileOpts(
      ['locations', 'city'],
      () => statsApi.getLocations(siteId, period, 'city', filters),
      belowFoldVisible && locationTab === 'city'
    )
  );
  const browsersQ = useQuery(
    tileOpts(
      ['devices', 'browser'],
      () => statsApi.getDevices(siteId, period, 'browser', filters),
      belowFoldVisible && deviceTab === 'browser',
      true
    )
  );
  const osQ = useQuery(
    tileOpts(
      ['devices', 'os'],
      () => statsApi.getDevices(siteId, period, 'os', filters),
      belowFoldVisible && deviceTab === 'os'
    )
  );
  const deviceTypeQ = useQuery(
    tileOpts(
      ['devices', 'device'],
      () => statsApi.getDevices(siteId, period, 'device', filters),
      belowFoldVisible && deviceTab === 'device'
    )
  );
  const screenSizeQ = useQuery(
    tileOpts(
      ['devices', 'size'],
      () => statsApi.getDevices(siteId, period, 'size', filters),
      belowFoldVisible && deviceTab === 'size'
    )
  );
  const eventsQ = useQuery(
    tileOpts(
      ['events'],
      () => statsApi.getEvents(siteId, period, filters),
      belowFoldVisible && sharesEvents
    )
  );
  // One query per Bots tab, like the other tabbed panels, so a tab switch
  // never shows another tab's rows as placeholder. 'All' keeps the old key.
  const botsTileOpts = (group: BotGroup | null): Parameters<typeof useQuery>[0] =>
    tileOpts(
      group ? ['bots', group] : ['bots'],
      () => statsApi.getBots(siteId, period, filters, group ?? undefined),
      belowFoldVisible && !shared && botTab === (group ?? 'all')
    );
  const botsAllQ = useQuery(botsTileOpts(null));
  const botsSearchQ = useQuery(botsTileOpts('search'));
  const botsAiQ = useQuery(botsTileOpts('ai'));
  const botsSocialQ = useQuery(botsTileOpts('social'));
  const botsOtherQ = useQuery(botsTileOpts('other'));
  const webmcpQ = useQuery(
    tileOpts(
      ['webmcp'],
      () => statsApi.getWebmcp(siteId, period, filters),
      belowFoldVisible && !shared
    )
  );
  const outboundQ = useQuery(
    tileOpts(
      ['links', 'outbound'],
      () => statsApi.getLinks(siteId, period, 'outbound', filters),
      belowFoldVisible && !shared && linkTab === 'outbound'
    )
  );
  const downloadsQ = useQuery(
    tileOpts(
      ['links', 'download'],
      () => statsApi.getLinks(siteId, period, 'download', filters),
      belowFoldVisible && !shared && linkTab === 'download'
    )
  );
  const goalStatsQ = useQuery(
    tileOpts(
      ['goals'],
      () => statsApi.getGoalStats(siteId, period, filters),
      belowFoldVisible && sharesGoals
    )
  );

  // Page flow (signed-in only). It defaults to the dashboard's page filter,
  // else the period's top page, so it reads the top-pages list itself: same
  // key as the Top Pages tab, so the two share one request.
  const flowPagesQ = useQuery(
    tileOpts(
      ['pages', 'top'],
      () => statsApi.getTopPages(siteId, period, 'top', filters),
      belowFoldVisible && !shared,
      true
    )
  );
  const flowPageRows = ((flowPagesQ.data as any)?.data ?? []) as {
    name: string;
    visitors: number;
  }[];
  const flowPageNames = flowPageRows.map(r => r.name).filter(Boolean);
  const flowTarget = flowPage ?? filters.page ?? flowPageNames[0] ?? null;
  // Each side is its own scan; keyed by the page, so no placeholder rows
  // from the previous page.
  const flowPrevQ = useQuery(
    tileOpts(
      ['paths', 'prev', flowTarget],
      () => api.getPaths(siteId, period, 'prev', flowTarget!, filters),
      belowFoldVisible && !shared && flowTarget !== null,
      false,
      false
    )
  );
  const flowNextQ = useQuery(
    tileOpts(
      ['paths', 'next', flowTarget],
      () => api.getPaths(siteId, period, 'next', flowTarget!, filters),
      belowFoldVisible && !shared && flowTarget !== null,
      false,
      false
    )
  );

  // Conversions by source (signed-in only), shown once the site has goals.
  const goalList = ((goalStatsQ.data as any)?.data ?? []) as GoalStat[];
  const hasGoals = goalList.length > 0;
  // A deleted goal falls back to "any goal".
  const activeConvGoalId =
    convGoalId && goalList.some(g => g.id === convGoalId) ? convGoalId : null;
  const attributionQ = useQuery(
    tileOpts(
      ['attribution', convDim, activeConvGoalId ?? '*'],
      () => api.getAttribution(siteId, period, convDim, activeConvGoalId ?? undefined, filters),
      belowFoldVisible && !shared && hasGoals,
      false,
      false
    )
  );

  // Funnel definitions live in D1 (cheap); stats are one R2 SQL scan per funnel,
  // so only the selected funnel's stats query runs.
  const funnelsQ = useQuery({
    queryKey: ['site-funnels', siteId],
    queryFn: async () => {
      return api.getFunnels(siteId);
    },
    staleTime: 60_000,
    // A share page gets its (shared) funnel list with the site info.
    enabled: belowFoldVisible && !shared,
  });
  const funnelList = shared
    ? (shared.funnels ?? [])
    : (((funnelsQ.data as any)?.data ?? []) as FunnelDef[]);
  const activeFunnelId =
    selectedFunnelId && funnelList.some(f => f.id === selectedFunnelId)
      ? selectedFunnelId
      : (funnelList[0]?.id ?? null);
  const funnelStatsQ = useQuery(
    tileOpts(
      ['funnel', activeFunnelId],
      () => statsApi.getFunnelStats(siteId, activeFunnelId!, period, filters),
      belowFoldVisible && sharesFunnels && activeFunnelId !== null,
      false,
      false
    )
  );
  const eventPropsQ = useQuery(
    tileOpts(
      ['event-props', selectedEvent],
      () => statsApi.getEventProps(siteId, period, selectedEvent!, filters),
      belowFoldVisible && selectedEvent !== null,
      false,
      false
    )
  );

  const [liveOpen, setLiveOpen] = useState(false);

  const site = shared
    ? {
        name: shared.name,
        domain: shared.domain,
        favicon: shared.favicon,
        timezone: shared.timezone,
        role: 'member' as const,
      }
    : (siteData as any)?.data;
  // Members are view-only: manage affordances render only once the site has
  // loaded with an owner role (server enforces regardless).
  const canManage = !!site && site.role !== 'member';
  const currentVisitors: number | null = realtime.data?.currentVisitors ?? null;

  if (siteError || (!siteLoading && !site)) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="rounded-[20px] bg-card px-8 py-16 text-center shadow-float">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
            <Globe className="h-8 w-8 text-subtle" />
          </div>
          <p className="text-[17px] font-semibold text-foreground">Site not found</p>
          <p className="mx-auto mt-2 max-w-sm text-[14px] text-subtle">
            It may have been deleted, or this link points somewhere that no longer exists.
          </p>
          <Link
            to="/portal/sites"
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-btn px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-btn-hover"
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
  const botQueries: Record<'all' | BotGroup, typeof botsAllQ> = {
    all: botsAllQ,
    search: botsSearchQ,
    ai: botsAiQ,
    social: botsSocialQ,
    other: botsOtherQ,
  };
  const botsQ = botQueries[botTab];

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
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
      <div className="space-y-6">
        {/* Header: identity + toolbar, sticky under the 56px app header so
            period, refresh, and segments stay reachable mid-page. Negative
            margins stretch the ground-colored backdrop across the content
            column so panels slide cleanly beneath it. */}
        {/* Pinned only with room to spare: on phones it stacks to two rows,
            and on a landscape phone it would cover half the screen, so in
            both cases it scrolls away. */}
        <div className="z-30 -mx-4 flex flex-wrap items-center justify-between gap-3 bg-background px-4 pb-4 pt-3 sm:top-14 sm:-mx-6 sm:px-6 sm:[@media(min-height:600px)]:sticky">
          <div className="flex min-w-0 items-center gap-3">
            {!shared && (
              <Link
                to="/portal/sites"
                title="All sites"
                className="-mr-1 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted cursor-pointer"
              >
                <Sticker name="back" className="h-5 w-5" />
              </Link>
            )}
            <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px] bg-card ring-1 ring-border">
              {site?.favicon ? (
                <img
                  src={site.favicon}
                  alt=""
                  draggable={false}
                  className="h-[22px] w-[22px] rounded-[5px] object-contain"
                />
              ) : (
                <Globe className="h-[18px] w-[18px] text-muted-foreground" strokeWidth={1.7} />
              )}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-[21px] font-bold leading-tight text-foreground tracking-[-0.025em]">
                {site?.name || 'Analytics'}
              </h1>
              {/* Domain · Public · live, separated by small dots. */}
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                {site?.domain && <span className="truncate text-subtle">{site.domain}</span>}
                {!shared && site?.public && (
                  <>
                    {site?.domain && <span className="h-[3px] w-[3px] rounded-full bg-faint" />}
                    <span className="font-medium text-[#12A06B]">Public</span>
                  </>
                )}
                {!shared && site?.domain && currentVisitors !== null && (
                  <span className="h-[3px] w-[3px] rounded-full bg-faint" />
                )}
                {!shared && (
                  <LivePill
                    count={currentVisitors}
                    status={realtime.status}
                    onClick={() => setLiveOpen(true)}
                  />
                )}
              </div>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto">
            {/* Borderless sticker actions; Delete lives in the overflow so it
                never sits one slip away from Refresh. */}
            <div className="flex items-center gap-0.5">
              {!shared && (
                <>
                  <button
                    onClick={() => setInstallOpen(true)}
                    className={SEG_BTN}
                    title="Installation"
                  >
                    <Sticker name="code" className={SEG_ICON} />
                  </button>
                  <SegmentsMenu
                    siteId={siteId}
                    filters={filters}
                    hasFilters={hasFilters}
                    onApply={applySegment}
                  />
                </>
              )}
              {canManage && (
                <IconTip label={site?.public ? 'Shared publicly' : 'Share'}>
                  <button onClick={() => setShareOpen(true)} className={SEG_BTN}>
                    {/* A public site's share icon is outlined in mint. */}
                    <Sticker
                      name="share"
                      className={cn(SEG_ICON, site?.public && 'text-[#12A06B]')}
                    />
                  </button>
                </IconTip>
              )}
              {canManage && (
                <IconTip label="Site settings">
                  <button onClick={() => setEditOpen(true)} className={SEG_BTN}>
                    <Sticker name="settings" className={SEG_ICON} />
                  </button>
                </IconTip>
              )}
              <IconTip label="Refresh data">
                <button onClick={handleRefresh} className={SEG_BTN}>
                  <Sticker
                    name="refresh"
                    className={cn(SEG_ICON, (refreshing || switching) && 'animate-spin')}
                  />
                </button>
              </IconTip>
              {canManage && (
                <IconTip label="More">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className={SEG_BTN}>
                        <Sticker name="more" className={SEG_ICON} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="w-44 rounded-2xl bg-card border-none shadow-float"
                    >
                      <DropdownMenuItem
                        onClick={() => setDeleteOpen(true)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#e5484d] focus:text-[#e5484d] focus:bg-coral-soft cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete site
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </IconTip>
              )}
            </div>
            <span className="mx-1 hidden h-5 w-px bg-border md:block" />
            <PeriodPicker value={period} onChange={setPeriod} allowCustom={!shared} />
          </div>
        </div>

        {!shared && (
          <LiveModal
            open={liveOpen}
            onOpenChange={setLiveOpen}
            siteId={siteId}
            domain={site?.domain}
            dashboardFilters={filters}
            onApply={applyLiveFilters}
          />
        )}

        {/* Active filters */}
        {hasFilters && (
          <FilterChips
            filters={filters}
            onRemove={removeFilter}
            onRemoveProp={key => setPropFilter(key, null)}
            onClear={clearFilters}
          />
        )}

        {/* Dimmed while a period/filter switch still shows the previous
            view's rows (see `switching`). */}
        <div
          className={`space-y-6 transition-opacity duration-300 ${switching ? 'opacity-50' : ''}`}
          aria-busy={switching}
        >
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
                // hostnames - no single exact-match filter value exists.
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

              {/* Custom events beside auto-tracked links: events are
                business actions with a props drill-down; outbound/downloads
                share one card as tabs since they're the same shape (URL +
                clicks). A share page shows events only if the owner shared
                them, and never links. */}
              {sharesEvents && (
                <div className={shared ? undefined : 'grid grid-cols-1 gap-6 lg:grid-cols-2'}>
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
                      // Filters the whole dashboard to rows carrying this property.
                      onItemClick={item => {
                        const row = (
                          (eventPropsQ.data as any)?.data as
                            | { key: string; value: string }[]
                            | undefined
                        )?.find(p => `${p.key}: ${p.value}` === item.name);
                        if (row) setPropFilter(row.key, row.value);
                      }}
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
                  {!shared && (
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
                  )}
                </div>
              )}

              {/* Agent tools and bots are never part of a share page. */}
              {!shared && (
                <>
                  {/* WebMCP tool calls: agent invocations of tools the page exposes
                via document.modelContext, auto-tracked by the tracker's
                registerTool wrapper as reserved custom events. Rows that had
                failures show the error count next to the tool name. */}
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <PanelCard
                      title="Agent Tools (WebMCP)"
                      labelHeader="Tool"
                      valueHeader="Calls"
                      items={(
                        (webmcpQ.data as any)?.data as
                          | { name: string; calls: number; errors: number; avgMs: number }[]
                          | undefined
                      )?.map(t => ({
                        name: t.errors > 0 ? `${t.name} · ${t.errors} failed` : t.name,
                        visitors: t.calls,
                      }))}
                      isLoading={webmcpQ.isLoading}
                      isError={webmcpQ.isError}
                      emptyText="No agent tool calls yet"
                    />

                    {/* Bot traffic: counted at ingest under its own event type, so
                it never touches the human metrics above. Value shown is
                distinct visitors per bot (crawlers, AI agents, monitors). */}
                    <PanelCard
                      title="Bots"
                      labelHeader="Bot"
                      valueHeader="Visitors"
                      items={(
                        (botsQ.data as any)?.data as
                          | { name: string; visitors: number; pageviews: number }[]
                          | undefined
                      )?.map(b => ({ name: b.name, visitors: b.visitors }))}
                      isLoading={botsQ.isLoading}
                      isError={botsQ.isError}
                      tabs={BOT_TABS}
                      activeTab={botTab}
                      onTabChange={key => setBotTab(key as 'all' | BotGroup)}
                      emptyText={BOT_TABS.find(t => t.key === botTab)!.empty}
                    />
                  </div>
                </>
              )}

              {/* Page flow: the pages right before and after one page. Not
                part of a share page. */}
              {!shared && (
                <PageFlowPanel
                  page={flowTarget}
                  pages={flowPageNames}
                  totals={
                    ((flowPrevQ.data as any)?.totals ?? (flowNextQ.data as any)?.totals) as
                      | PathTotals
                      | undefined
                  }
                  onSelect={setFlowPage}
                  prev={{
                    rows: (flowPrevQ.data as any)?.data as PathRow[] | undefined,
                    isLoading: flowPrevQ.isLoading,
                    isError: flowPrevQ.isError,
                  }}
                  next={{
                    rows: (flowNextQ.data as any)?.data as PathRow[] | undefined,
                    isLoading: flowNextQ.isLoading,
                    isError: flowNextQ.isError,
                  }}
                />
              )}

              {/* Goals, then funnels, close out the page (on a share page, only
                if the owner shared them). */}
              {sharesGoals && (
                <GoalsPanel
                  siteId={siteId}
                  goals={(goalStatsQ.data as any)?.data}
                  isLoading={goalStatsQ.isLoading}
                  isError={goalStatsQ.isError}
                  onAdd={canManage ? () => setGoalForm({ goal: null }) : undefined}
                  onEdit={canManage ? goal => setGoalForm({ goal }) : undefined}
                  onDuplicate={canManage ? duplicateGoal : undefined}
                  onManage={canManage ? () => setGoalsOpen(true) : undefined}
                />
              )}

              {/* Conversions by UTM source, under the goals it counts. Hidden
                until the site has a goal (the Goals panel prompts for one),
                and never on a share page. */}
              {!shared && hasGoals && (
                <ConversionsPanel
                  goals={goalList}
                  goalId={activeConvGoalId}
                  onGoalChange={setConvGoalId}
                  dim={convDim}
                  onDimChange={setConvDim}
                  rows={(attributionQ.data as any)?.data as AttributionRow[] | undefined}
                  isLoading={attributionQ.isLoading}
                  isError={attributionQ.isError}
                />
              )}

              {/* Funnels */}
              {sharesFunnels && (
                <FunnelsPanel
                  siteId={siteId}
                  funnels={funnelsQ.isLoading ? undefined : funnelList}
                  selectedId={activeFunnelId}
                  onSelect={setSelectedFunnelId}
                  stat={(funnelStatsQ.data as any)?.data as FunnelStat | undefined}
                  isLoading={funnelStatsQ.isLoading}
                  isError={funnelStatsQ.isError || funnelsQ.isError}
                  onAdd={canManage ? () => setFunnelForm({ funnel: null }) : undefined}
                  onEdit={canManage ? funnel => setFunnelForm({ funnel }) : undefined}
                  onDuplicate={canManage ? duplicateFunnel : undefined}
                  onManage={canManage ? () => setFunnelsOpen(true) : undefined}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Management dialogs: never on a share page. */}
      {!shared && (
        <>
          {site && canManage && (
            <ShareDialog
              open={shareOpen}
              onOpenChange={setShareOpen}
              siteId={siteId}
              siteName={site.name}
              sharing={{
                public: Boolean(site.public),
                publicGoals: Boolean(site.publicGoals),
                publicFunnels: Boolean(site.publicFunnels),
                publicEvents: Boolean(site.publicEvents),
              }}
            />
          )}
          <EditSiteModal
            open={editOpen}
            onOpenChange={setEditOpen}
            site={site ? { name: site.name, domain: site.domain, timezone: site.timezone } : null}
            siteId={siteId}
          />

          <InstallModal open={installOpen} onOpenChange={setInstallOpen} site={site} />

          <GoalsDrawer
            open={goalsOpen}
            onOpenChange={setGoalsOpen}
            siteId={siteId}
            siteLabel={site?.domain}
            stats={(goalStatsQ.data as any)?.data}
            periodLabel={periodLabel(period)}
            onAdd={() => {
              setGoalsOpen(false);
              setGoalForm({ goal: null });
            }}
            onEdit={goal => {
              setGoalsOpen(false);
              setGoalForm({ goal });
            }}
            onDuplicate={duplicateGoal}
          />

          <GoalFormModal
            open={goalForm !== null}
            onOpenChange={openState => {
              if (!openState) setGoalForm(null);
            }}
            siteId={siteId}
            domain={site?.domain}
            goal={goalForm?.goal ?? null}
            draft={goalForm?.draft}
          />

          <FunnelsDrawer
            open={funnelsOpen}
            onOpenChange={setFunnelsOpen}
            siteId={siteId}
            siteLabel={site?.domain}
            selectedId={activeFunnelId}
            onAdd={() => {
              setFunnelsOpen(false);
              setFunnelForm({ funnel: null });
            }}
            onEdit={funnel => {
              setFunnelsOpen(false);
              setFunnelForm({ funnel });
            }}
            onSelect={id => {
              setSelectedFunnelId(id);
              setFunnelsOpen(false);
            }}
            onDuplicate={duplicateFunnel}
          />

          <FunnelFormModal
            open={funnelForm !== null}
            onOpenChange={openState => {
              if (!openState) setFunnelForm(null);
            }}
            siteId={siteId}
            domain={site?.domain}
            funnel={funnelForm?.funnel ?? null}
            draft={funnelForm?.draft}
          />

          <DeleteSiteModal
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            site={site ? { name: site.name, domain: site.domain } : null}
            siteId={siteId}
          />
        </>
      )}
    </main>
  );
}
