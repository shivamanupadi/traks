import { useState, useEffect, useCallback, useRef, type ReactElement } from 'react';
import { createLazyFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useAuth } from '@clerk/clerk-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw, Settings, Code2, Copy, Check, Zap } from 'lucide-react';
import type { Period } from '@traks/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog';
import { StatsCards } from '@/components/analytics/StatsCards';
import { TimeseriesChart } from '@/components/analytics/TimeseriesChart';
import { TopList } from '@/components/analytics/TopList';
import { PeriodPicker } from '@/components/layout/PeriodPicker';
import { api } from '@/lib/api';

const COLLECT_URL = import.meta.env.VITE_COLLECT_URL || 'https://collect.traks.dev';

const REFETCH_INTERVAL = 30_000;

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
  site: { name: string; domain: string } | null;
  siteId: string;
}): ReactElement {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && site) {
      setName(site.name);
      setDomain(site.domain);
      setError('');
    }
  }, [open, site]);

  const updateSite = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return api.updateSite(siteId, { name, domain }, token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site', siteId] });
      queryClient.invalidateQueries({ queryKey: ['sites'] });
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

function SiteAnalyticsPage(): ReactElement {
  const { siteId } = Route.useParams();
  const { period: searchPeriod } = Route.useSearch();
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const period: Period = searchPeriod || 'today';
  const setPeriod = useCallback(
    (p: Period) => {
      navigate({
        to: '/portal/site/$siteId',
        params: { siteId },
        search: { period: p },
        replace: true,
      });
    },
    [navigate, siteId]
  );
  const [refreshing, setRefreshing] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);

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
  // Trades one HTTP call for 7 parallel calls; progressive render beats
  // waiting for the slowest to finish before showing anything.
  //
  // `tileOpts` is a plain helper returning a query-options object — useQuery
  // is still called at the component top level, which keeps React's rules-of-hooks happy.
  const tileOpts = (
    key: readonly unknown[],
    call: (token: string) => Promise<unknown>
  ): Parameters<typeof useQuery>[0] => ({
    queryKey: ['site-analytics', siteId, ...key, period],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return call(token);
    },
    refetchInterval: REFETCH_INTERVAL,
    staleTime: getStaleTime(period),
  });

  const mainQ = useQuery(tileOpts(['main'], t => api.getMainStats(siteId, period, t)));
  const timeseriesQ = useQuery(tileOpts(['timeseries'], t => api.getTimeseries(siteId, period, t)));
  const pagesQ = useQuery(tileOpts(['pages'], t => api.getTopPages(siteId, period, t)));
  const referrersQ = useQuery(tileOpts(['referrers'], t => api.getTopReferrers(siteId, period, t)));
  const locationsQ = useQuery(
    tileOpts(['locations', 'country'], t => api.getLocations(siteId, period, 'country', t))
  );
  const browsersQ = useQuery(
    tileOpts(['devices', 'browser'], t => api.getDevices(siteId, period, 'browser', t))
  );
  const osQ = useQuery(tileOpts(['devices', 'os'], t => api.getDevices(siteId, period, 'os', t)));

  const site = (siteData as any)?.data;

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
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
          </div>
        </div>

        {/* Stats cards */}
        <StatsCards
          stats={(mainQ.data as any)?.data}
          isLoading={mainQ.isLoading}
          isError={mainQ.isError}
        />

        {/* Timeseries chart */}
        <TimeseriesChart
          data={(timeseriesQ.data as any)?.data}
          isLoading={timeseriesQ.isLoading}
          isError={timeseriesQ.isError}
        />

        {/* Two-column: Pages + Referrers */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <TopList
            title="Top Pages"
            items={(pagesQ.data as any)?.data}
            isLoading={pagesQ.isLoading}
            isError={pagesQ.isError}
            showPageviews
          />
          <TopList
            title="Top Referrers"
            items={(referrersQ.data as any)?.data}
            isLoading={referrersQ.isLoading}
            isError={referrersQ.isError}
          />
        </div>

        {/* Below-fold sentinel + lazy-rendered sections */}
        <div ref={belowFoldRef} />
        {belowFoldVisible && (
          <>
            {/* Locations + Browsers */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <TopList
                title="Countries"
                items={(locationsQ.data as any)?.data}
                isLoading={locationsQ.isLoading}
                isError={locationsQ.isError}
              />
              <TopList
                title="Browsers"
                items={(browsersQ.data as any)?.data}
                isLoading={browsersQ.isLoading}
                isError={browsersQ.isError}
              />
            </div>

            {/* OS */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <TopList
                title="Operating Systems"
                items={(osQ.data as any)?.data}
                isLoading={osQ.isLoading}
                isError={osQ.isError}
              />
            </div>
          </>
        )}
      </div>

      <EditSiteModal
        open={editOpen}
        onOpenChange={setEditOpen}
        site={site ? { name: site.name, domain: site.domain } : null}
        siteId={siteId}
      />

      <InstallModal open={installOpen} onOpenChange={setInstallOpen} site={site} />
    </main>
  );
}
