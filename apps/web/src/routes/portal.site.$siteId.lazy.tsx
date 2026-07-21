import { useState, useEffect, useCallback, useRef, type ReactElement } from 'react';
import { createLazyFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useAuth } from '@clerk/clerk-react';
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
} from 'lucide-react';
import type { Period, MainStats } from '@traks/shared';
import { cn, formatNumber, formatPercentChange } from '@/lib/utils';
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
import { TimeseriesChart } from '@/components/analytics/TimeseriesChart';
import { PanelCard } from '@/components/analytics/PanelCard';
import { PeriodPicker } from '@/components/layout/PeriodPicker';
import { api, type AnalyticsFilters } from '@/lib/api';

const COLLECT_URL = import.meta.env.VITE_COLLECT_URL || 'https://collect.traks.dev';
const API_URL = import.meta.env.VITE_API_URL || 'https://api.traks.dev';

function cnToggle(on: boolean): string {
  return `relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
    on ? 'bg-[#5b9a6f]' : 'bg-[#e8e3ed]'
  }`;
}

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

function InstallModal({
  open,
  onOpenChange,
  site,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: { domain: string; apiKeys?: { key: string }[] } | null;
}): ReactElement {
  const [copied, setCopied] = useState(false);

  const siteKey = site?.apiKeys?.[0]?.key ?? '';
  const snippet = siteKey
    ? `<script defer data-site="${siteKey}" src="${COLLECT_URL}/t.js"></script>`
    : '';

  const handleCopy = async (): Promise<void> => {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <div className="w-10 h-10 rounded-xl bg-[#5b9a6f]/10 flex items-center justify-center mb-3">
            <Code2 className="w-5 h-5 text-[#5b9a6f]" strokeWidth={1.7} />
          </div>
          <DialogTitle>Installation</DialogTitle>
          <DialogDescription>
            Add this snippet to the{' '}
            <code className="text-[12px] bg-[#f3f0f7] px-1.5 py-0.5 rounded font-medium">
              &lt;head&gt;
            </code>{' '}
            of <span className="font-semibold text-[#2D3436]">{site?.domain}</span>
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-4">
            {/* Snippet card */}
            <div className="relative rounded-xl border border-[#e8e3ed] bg-[#fdfbf8] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#e8e3ed]/60">
                <span className="text-[11px] font-medium text-[#B5B0AA] uppercase tracking-wider">
                  HTML Snippet
                </span>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium text-[#9B9590] hover:text-[#9b72cf] transition-colors cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-[#5b9a6f]" />
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
              <pre className="text-[12px] leading-relaxed text-[#2D3436] font-mono whitespace-pre-wrap break-all select-all px-4 py-3.5">
                {snippet}
              </pre>
            </div>

            {/* Info note */}
            <div className="flex gap-3 rounded-xl bg-[#5b9a6f]/5 border border-[#5b9a6f]/10 px-4 py-3.5">
              <Zap className="w-4 h-4 text-[#5b9a6f] shrink-0 mt-0.5" strokeWidth={1.7} />
              <p className="text-[12px] text-[#5b9a6f]/80 leading-relaxed">
                Under 1KB, loads async - zero impact on page speed. Data appears within seconds of
                the first visit.
              </p>
            </div>
          </div>
        </DialogBody>

        <DialogFooter className="border-t border-[#e8e3ed]/50 mx-6 px-0 pb-5 pt-4">
          <Button
            variant="ghost"
            onClick={handleCopy}
            className="rounded-xl text-[13px] cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            {copied ? 'Copied!' : 'Copy snippet'}
          </Button>
          <Button
            onClick={() => onOpenChange(false)}
            className="bg-[#5b9a6f] hover:bg-[#4e8a62] text-white rounded-xl text-[13px] px-5 cursor-pointer"
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
    public?: boolean;
    exportEnabled?: boolean;
    exportToken?: string | null;
  } | null;
  siteId: string;
}): ReactElement {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [error, setError] = useState('');
  const [exportEnabled, setExportEnabled] = useState(false);
  const [exportToken, setExportToken] = useState<string | null>(null);
  const [publicEnabled, setPublicEnabled] = useState(false);

  useEffect(() => {
    if (open && site) {
      setName(site.name);
      setDomain(site.domain);
      setTimezone(site.timezone || 'UTC');
      setExportEnabled(site.exportEnabled ?? false);
      setExportToken(site.exportToken ?? null);
      setPublicEnabled(site.public ?? false);
      setError('');
    }
  }, [open, site]);

  const togglePublic = useMutation({
    mutationFn: async (enabled: boolean) => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return api.togglePublic(siteId, enabled, token);
    },
    onSuccess: (res: { data: { enabled: boolean } }) => {
      setPublicEnabled(res.data.enabled);
      queryClient.invalidateQueries({ queryKey: ['site', siteId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const toggleExport = useMutation({
    mutationFn: async (enabled: boolean) => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return api.toggleExport(siteId, enabled, token);
    },
    onSuccess: (res: { data: { enabled: boolean; token: string } }) => {
      setExportEnabled(res.data.enabled);
      setExportToken(res.data.token);
      queryClient.invalidateQueries({ queryKey: ['site', siteId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const updateSite = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return api.updateSite(siteId, { name, domain, timezone }, token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site', siteId] });
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      // Bucket windows depend on the timezone - refetch everything.
      queryClient.invalidateQueries({ queryKey: ['site-analytics', siteId] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      if (err.message.includes('409')) {
        setError('Domain is already in use');
      } else {
        setError(err.message);
      }
    },
  });

  const canSave = name.trim().length > 0 && domain.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <div className="w-10 h-10 rounded-xl bg-[#9b72cf]/10 flex items-center justify-center mb-3">
            <Settings className="w-5 h-5 text-[#9b72cf]" strokeWidth={1.7} />
          </div>
          <DialogTitle>Edit site</DialogTitle>
          <DialogDescription>Update your site name and domain.</DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-[13px] font-medium text-[#2D3436]">Site Name</label>
              <Input
                placeholder="My SaaS"
                value={name}
                onChange={e => {
                  setName(e.target.value);
                  setError('');
                }}
                className="rounded-xl h-11 border-[#e8e3ed] focus:border-[#9b72cf]/40 px-4 text-[14px]"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-2 block text-[13px] font-medium text-[#2D3436]">Domain</label>
              <Input
                placeholder="example.com"
                value={domain}
                onChange={e => {
                  setDomain(e.target.value);
                  setError('');
                }}
                className="rounded-xl h-11 border-[#e8e3ed] focus:border-[#9b72cf]/40 px-4 text-[14px]"
                onKeyDown={e => {
                  if (e.key === 'Enter' && canSave) updateSite.mutate();
                }}
              />
              <p className="mt-2 text-[12px] text-[#B5B0AA]">Without http:// or https://</p>
            </div>
            <div>
              <label className="mb-2 block text-[13px] font-medium text-[#2D3436]">Timezone</label>
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
            {/* Public dashboard */}
            <div className="border-t border-[#e8e3ed]/60 pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-medium text-[#2D3436]">Public dashboard</p>
                  <p className="mt-0.5 text-[12px] text-[#9B9590]">
                    Anyone with the link can view this site&apos;s stats.
                  </p>
                </div>
                <button
                  onClick={() => togglePublic.mutate(!publicEnabled)}
                  disabled={togglePublic.isPending}
                  className={cnToggle(publicEnabled)}
                  role="switch"
                  aria-checked={publicEnabled}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      publicEnabled ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              {publicEnabled && (
                <pre className="mt-3 rounded-lg border border-[#e8e3ed] bg-[#fdfbf8] px-3 py-2.5 text-[11px] leading-relaxed text-[#2D3436] whitespace-pre-wrap break-all select-all">
                  {`${window.location.origin}/share/${siteId}`}
                </pre>
              )}
            </div>

            {/* Data export */}
            <div className="border-t border-[#e8e3ed]/60 pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-medium text-[#2D3436]">Data export</p>
                  <p className="mt-0.5 text-[12px] text-[#9B9590]">
                    Nightly raw event files (NDJSON) — query with DuckDB or download.
                  </p>
                </div>
                <button
                  onClick={() => toggleExport.mutate(!exportEnabled)}
                  disabled={toggleExport.isPending}
                  className={cnToggle(exportEnabled)}
                  role="switch"
                  aria-checked={exportEnabled}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      exportEnabled ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              {exportEnabled && exportToken && (
                <pre className="mt-3 rounded-lg border border-[#e8e3ed] bg-[#fdfbf8] px-3 py-2.5 text-[11px] leading-relaxed text-[#2D3436] whitespace-pre-wrap break-all select-all">
                  {`-- DuckDB\nSELECT * FROM read_ndjson_auto(\n  '${API_URL}/api/exports/${exportToken}/YYYY-MM-DD.ndjson.gz');`}
                </pre>
              )}
            </div>

            {error && <p className="text-[13px] text-[#e07a5f]">{error}</p>}
          </div>
        </DialogBody>

        <DialogFooter className="border-t border-[#e8e3ed]/50 mx-6 px-0 pb-5 pt-4">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-xl text-[13px]"
          >
            Cancel
          </Button>
          <Button
            onClick={() => updateSite.mutate()}
            disabled={!canSave}
            isLoading={updateSite.isPending}
            className="bg-[#9b72cf] hover:bg-[#8a63bf] text-white rounded-xl text-[13px] px-5"
          >
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
  const { getToken } = useAuth();
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
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return api.deleteSite(siteId, token);
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

  const canDelete = site !== null && confirmText === site.domain;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <div className="w-10 h-10 rounded-xl bg-[#e07a5f]/10 flex items-center justify-center mb-3">
            <Trash2 className="w-5 h-5 text-[#e07a5f]" strokeWidth={1.7} />
          </div>
          <DialogTitle>Delete {site?.name || 'this site'}?</DialogTitle>
          <DialogDescription>
            This permanently removes the site, its tracking keys and all collected analytics data.
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-3">
            <p className="text-[13px] text-[#2D3436]">
              Type <span className="font-semibold select-all">{site?.domain}</span> to confirm:
            </p>
            <Input
              placeholder={site?.domain}
              value={confirmText}
              onChange={e => {
                setConfirmText(e.target.value);
                setError('');
              }}
              className="rounded-xl h-11 border-[#e07a5f]/30 focus:border-[#e07a5f]/60 px-4 text-[14px]"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && canDelete) deleteSite.mutate();
              }}
            />
            {error && <p className="text-[13px] text-[#e07a5f]">{error}</p>}
          </div>
        </DialogBody>

        <DialogFooter className="border-t border-[#e8e3ed]/50 mx-6 px-0 pb-5 pt-4">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-xl text-[13px] cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            onClick={() => deleteSite.mutate()}
            disabled={!canDelete}
            isLoading={deleteSite.isPending}
            className="bg-[#e07a5f] hover:bg-[#d06a4f] text-white rounded-xl text-[13px] px-5 cursor-pointer"
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
  visitors: '#9b72cf',
  pageviews: '#e07a5f',
  sessions: '#5b9a6f',
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
        'group relative flex flex-col items-start gap-1 rounded-xl px-4 py-3 text-left transition-colors',
        onClick && 'cursor-pointer hover:bg-[#f3f0f7]/60',
        active && 'bg-[#f3f0f7]/60'
      )}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9B9590]">
        {label}
      </span>
      <span className="text-[24px] font-bold leading-none tracking-tight text-[#2D3436]">
        {value}
      </span>
      {delta && (
        <span
          className={cn(
            'flex items-center gap-0.5 text-[11px] font-semibold',
            isGood ? 'text-[#5b9a6f]' : 'text-[#e07a5f]'
          )}
        >
          {delta.isPositive ? (
            <ArrowUpRight className="h-3 w-3" strokeWidth={2.5} />
          ) : (
            <ArrowDownRight className="h-3 w-3" strokeWidth={2.5} />
          )}
          {delta.text}
        </span>
      )}
      {/* Active underline */}
      <span
        className={cn(
          'absolute inset-x-4 bottom-0 h-[3px] rounded-full transition-opacity',
          active ? 'opacity-100' : 'opacity-0'
        )}
        style={{ backgroundColor: color }}
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
}: {
  stats: MainStats | undefined;
  statsLoading: boolean;
  statsError: boolean;
  timeseries: any;
  timeseriesLoading: boolean;
  timeseriesError: boolean;
  metric: ChartMetric;
  onMetricChange: (m: ChartMetric) => void;
}): ReactElement {
  const viewsPerVisit =
    stats && stats.sessions > 0 ? (stats.pageviews / stats.sessions).toFixed(2) : '0';

  return (
    <div className="rounded-2xl border border-[#e8e3ed]/80 bg-white p-5">
      {/* Metric tiles row */}
      {statsError ? (
        <p className="px-2 pb-4 text-[13px] text-[#e07a5f]">Failed to load stats</p>
      ) : statsLoading || !stats ? (
        <div className="flex flex-wrap gap-4 border-b border-[#e8e3ed]/60 px-2 pb-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex flex-col gap-2 px-4 py-3">
              <div className="h-3 w-20 animate-pulse rounded bg-[#f3f0f7]" />
              <div className="h-6 w-14 animate-pulse rounded bg-[#f3f0f7]" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-stretch gap-1 border-b border-[#e8e3ed]/60 pb-4">
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
        </div>
      )}

      {/* Chart */}
      <div className="pt-4">
        <TimeseriesChart
          data={timeseries}
          isLoading={timeseriesLoading}
          isError={timeseriesError}
          metric={metric}
          color={METRIC_COLORS[metric]}
          bare
        />
      </div>
    </div>
  );
}

const FILTER_LABELS: Record<keyof AnalyticsFilters, string> = {
  page: 'Page',
  source: 'Source',
  utmSource: 'UTM Source',
  utmMedium: 'UTM Medium',
  utmCampaign: 'UTM Campaign',
  country: 'Country',
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
          className="flex items-center gap-1.5 rounded-full bg-[#9b72cf]/[0.08] py-1 pl-3 pr-1.5 text-[12px] text-[#2D3436]"
        >
          <span className="text-[#9B9590]">{FILTER_LABELS[key]}</span>
          <span className="max-w-[180px] truncate font-medium">{value}</span>
          <button
            onClick={() => onRemove(key)}
            className="flex h-4.5 w-4.5 items-center justify-center rounded-full hover:bg-[#9b72cf]/15 transition-colors cursor-pointer"
            title="Remove filter"
          >
            <X className="h-3 w-3 text-[#9B9590]" />
          </button>
        </span>
      ))}
      {entries.length > 1 && (
        <button
          onClick={onClear}
          className="text-[12px] text-[#9B9590] hover:text-[#2D3436] transition-colors cursor-pointer"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

function LiveVisitorsPill({ count }: { count: number | null }): ReactElement | null {
  if (count === null) return null;
  return (
    <div className="flex items-center gap-2 rounded-full bg-[#5b9a6f]/8 px-3 py-1.5">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#5b9a6f] opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#5b9a6f]" />
      </span>
      <span className="text-[12px] font-medium text-[#5b9a6f]">
        {count} current visitor{count === 1 ? '' : 's'}
      </span>
    </div>
  );
}

function SiteAnalyticsPage(): ReactElement {
  const { siteId } = Route.useParams();
  const search = Route.useSearch();
  const { period: searchPeriod } = search;
  const navigate = useNavigate();
  const { getToken } = useAuth();
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
  const [refreshing, setRefreshing] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [chartMetric, setChartMetric] = useState<ChartMetric>('visitors');

  // Per-panel tab state
  const [sourceTab, setSourceTab] = useState('referrers');
  const [locationTab, setLocationTab] = useState('country');
  const [deviceTab, setDeviceTab] = useState('browser');

  // Lazy-render sentinels for below-fold sections
  const [belowFoldRef, belowFoldVisible] = useLazyVisible();

  const handleRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['site-analytics', siteId] });
    await queryClient.invalidateQueries({ queryKey: ['site', siteId] });
    setTimeout(() => setRefreshing(false), 600);
  }, [queryClient, siteId]);

  const { data: siteData } = useQuery({
    queryKey: ['site', siteId],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return api.getSite(siteId, token);
    },
    staleTime: 300_000,
  });

  // Per-tile parallel queries — each tile renders as its own request resolves.
  // Tabbed panels pass `enabled` so only the active tab's query runs (each
  // R2 SQL query is a paid distributed scan; don't fetch hidden tabs).
  const tileOpts = (
    key: readonly unknown[],
    call: (token: string) => Promise<unknown>,
    enabled = true
  ): Parameters<typeof useQuery>[0] => ({
    queryKey: ['site-analytics', siteId, ...key, period, filterKey],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return call(token);
    },
    refetchInterval: getRefetchInterval(period),
    staleTime: getStaleTime(period),
    enabled,
  });

  const mainQ = useQuery(tileOpts(['main'], t => api.getMainStats(siteId, period, t, filters)));
  const timeseriesQ = useQuery(
    tileOpts(['timeseries'], t => api.getTimeseries(siteId, period, t, filters))
  );
  const pagesQ = useQuery(tileOpts(['pages'], t => api.getTopPages(siteId, period, t, filters)));

  // Sources panel: referrers or one of the UTM dimensions
  const referrersQ = useQuery(
    tileOpts(
      ['referrers'],
      t => api.getTopReferrers(siteId, period, t, filters),
      sourceTab === 'referrers'
    )
  );
  const utmSourceQ = useQuery(
    tileOpts(
      ['utm', 'source'],
      t => api.getUtm(siteId, period, 'source', t, filters),
      sourceTab === 'utm_source'
    )
  );
  const utmMediumQ = useQuery(
    tileOpts(
      ['utm', 'medium'],
      t => api.getUtm(siteId, period, 'medium', t, filters),
      sourceTab === 'utm_medium'
    )
  );
  const utmCampaignQ = useQuery(
    tileOpts(
      ['utm', 'campaign'],
      t => api.getUtm(siteId, period, 'campaign', t, filters),
      sourceTab === 'utm_campaign'
    )
  );

  // Below-fold panels
  const countriesQ = useQuery(
    tileOpts(
      ['locations', 'country'],
      t => api.getLocations(siteId, period, 'country', t, filters),
      belowFoldVisible && locationTab === 'country'
    )
  );
  const citiesQ = useQuery(
    tileOpts(
      ['locations', 'city'],
      t => api.getLocations(siteId, period, 'city', t, filters),
      belowFoldVisible && locationTab === 'city'
    )
  );
  const browsersQ = useQuery(
    tileOpts(
      ['devices', 'browser'],
      t => api.getDevices(siteId, period, 'browser', t, filters),
      belowFoldVisible && deviceTab === 'browser'
    )
  );
  const osQ = useQuery(
    tileOpts(
      ['devices', 'os'],
      t => api.getDevices(siteId, period, 'os', t, filters),
      belowFoldVisible && deviceTab === 'os'
    )
  );
  const deviceTypeQ = useQuery(
    tileOpts(
      ['devices', 'device'],
      t => api.getDevices(siteId, period, 'device', t, filters),
      belowFoldVisible && deviceTab === 'device'
    )
  );
  const eventsQ = useQuery(
    tileOpts(['events'], t => api.getEvents(siteId, period, t, filters), belowFoldVisible)
  );

  // Live visitor count (last 5 min, straight from the site's DO)
  const realtimeQ = useQuery({
    queryKey: ['site-analytics', siteId, 'realtime'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return api.getRealtime(siteId, token);
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const site = (siteData as any)?.data;
  const currentVisitors: number | null = (realtimeQ.data as any)?.data?.currentVisitors ?? null;

  const sourceQueries: Record<string, typeof referrersQ> = {
    referrers: referrersQ,
    utm_source: utmSourceQ,
    utm_medium: utmMediumQ,
    utm_campaign: utmCampaignQ,
  };
  const sourceQ = sourceQueries[sourceTab];

  const locationQ = locationTab === 'country' ? countriesQ : citiesQ;
  const deviceQueries: Record<string, typeof browsersQ> = {
    browser: browsersQ,
    os: osQ,
    device: deviceTypeQ,
  };
  const deviceQ = deviceQueries[deviceTab];

  const events = (eventsQ.data as any)?.data as
    | { name: string; count: number; totalValue: number }[]
    | undefined;

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              to="/portal/sites"
              className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-[#f3f0f7] transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4 text-[#9B9590]" />
            </Link>
            <div>
              <h1 className="text-[20px] font-bold text-[#2D3436] tracking-[-0.01em]">
                {site?.name || 'Analytics'}
              </h1>
              {site?.domain && <p className="text-[13px] text-[#9B9590]">{site.domain}</p>}
            </div>
            <LiveVisitorsPill count={currentVisitors} />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setInstallOpen(true)}
              className="flex items-center justify-center w-9 h-9 rounded-xl bg-[#f3f0f7]/60 hover:bg-[#f3f0f7] transition-colors cursor-pointer"
              title="Installation"
            >
              <Code2 className="w-3.5 h-3.5 text-[#9B9590]" />
            </button>
            <button
              onClick={() => setEditOpen(true)}
              className="flex items-center justify-center w-9 h-9 rounded-xl bg-[#f3f0f7]/60 hover:bg-[#f3f0f7] transition-colors cursor-pointer"
              title="Site settings"
            >
              <Settings className="w-3.5 h-3.5 text-[#9B9590]" />
            </button>
            <button
              onClick={handleRefresh}
              className="flex items-center justify-center w-9 h-9 rounded-xl bg-[#f3f0f7]/60 hover:bg-[#f3f0f7] transition-colors cursor-pointer"
              title="Refresh data"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-[#9B9590] ${refreshing ? 'animate-spin' : ''}`}
              />
            </button>
            <PeriodPicker value={period} onChange={setPeriod} />
            <button
              onClick={() => setDeleteOpen(true)}
              className="flex items-center justify-center w-9 h-9 rounded-xl bg-[#e07a5f]/[0.06] hover:bg-[#e07a5f]/15 transition-colors cursor-pointer"
              title="Delete site"
            >
              <Trash2 className="w-3.5 h-3.5 text-[#e07a5f]" />
            </button>
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
        />

        {/* Pages + Sources */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <PanelCard
            title="Top Pages"
            labelHeader="Page"
            items={(pagesQ.data as any)?.data}
            isLoading={pagesQ.isLoading}
            isError={pagesQ.isError}
            showPageviews
            onItemClick={item => setFilter('page', item.name)}
          />
          <PanelCard
            title="Top Sources"
            labelHeader="Source"
            items={(sourceQ.data as any)?.data}
            isLoading={sourceQ.isLoading}
            isError={sourceQ.isError}
            tabs={[
              { key: 'referrers', label: 'Referrers' },
              { key: 'utm_source', label: 'UTM Source' },
              { key: 'utm_medium', label: 'Medium' },
              { key: 'utm_campaign', label: 'Campaign' },
            ]}
            activeTab={sourceTab}
            onTabChange={setSourceTab}
            onItemClick={item => {
              const keyByTab: Record<string, keyof AnalyticsFilters> = {
                referrers: 'source',
                utm_source: 'utmSource',
                utm_medium: 'utmMedium',
                utm_campaign: 'utmCampaign',
              };
              setFilter(keyByTab[sourceTab], item.name);
            }}
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
                labelHeader={locationTab === 'country' ? 'Country' : 'City'}
                items={(locationQ.data as any)?.data}
                isLoading={locationQ.isLoading}
                isError={locationQ.isError}
                tabs={[
                  { key: 'country', label: 'Countries' },
                  { key: 'city', label: 'Cities' },
                ]}
                activeTab={locationTab}
                onTabChange={setLocationTab}
                onItemClick={item =>
                  setFilter(locationTab === 'country' ? 'country' : 'city', item.name)
                }
              />
              <PanelCard
                title="Devices"
                labelHeader={
                  deviceTab === 'browser' ? 'Browser' : deviceTab === 'os' ? 'OS' : 'Device'
                }
                items={(deviceQ.data as any)?.data}
                isLoading={deviceQ.isLoading}
                isError={deviceQ.isError}
                showPercentage
                tabs={[
                  { key: 'browser', label: 'Browser' },
                  { key: 'os', label: 'OS' },
                  { key: 'device', label: 'Device' },
                ]}
                activeTab={deviceTab}
                onTabChange={setDeviceTab}
                onItemClick={item =>
                  setFilter(
                    deviceTab === 'browser' ? 'browser' : deviceTab === 'os' ? 'os' : 'device',
                    item.name
                  )
                }
              />
            </div>

            {/* Custom events */}
            <PanelCard
              title="Custom Events"
              labelHeader="Event"
              valueHeader="Count"
              items={events?.map(e => ({ name: e.name, visitors: e.count }))}
              isLoading={eventsQ.isLoading}
              isError={eventsQ.isError}
              emptyText="No custom events yet"
              className="min-h-0"
            />
          </>
        )}
      </div>

      <EditSiteModal
        open={editOpen}
        onOpenChange={setEditOpen}
        site={
          site
            ? {
                name: site.name,
                domain: site.domain,
                timezone: site.timezone,
                public: site.public,
                exportEnabled: site.exportEnabled,
                exportToken: site.exportToken,
              }
            : null
        }
        siteId={siteId}
      />

      <InstallModal open={installOpen} onOpenChange={setInstallOpen} site={site} />

      <DeleteSiteModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        site={site ? { name: site.name, domain: site.domain } : null}
        siteId={siteId}
      />
    </main>
  );
}
