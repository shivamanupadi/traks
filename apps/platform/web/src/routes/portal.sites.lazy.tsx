import { useState, useMemo, useRef, type ReactElement } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Plus, Globe, Search, X, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { SiteTile } from '@/components/sites/SiteTile';
import { AddSiteWizard } from '@/components/sites/AddSiteWizard';
import { SiteSortMenu, SITE_SORT_NAMES, type SiteSort } from '@/components/sites/SiteSortMenu';

export const Route = createLazyFileRoute('/portal/sites')({
  component: SitesPage,
});

const TILE_COLORS = [
  { deep: 'var(--chart-1)', pastel: 'var(--border-strong)' },
  { deep: '#6b8ead', pastel: '#b8cbd9' },
  { deep: '#e07a5f', pastel: '#f2b5a4' },
];
const PAGE_SIZE = 6;
// The batch stats endpoint caps a request at 100 sites.
const MAX_BATCH_SITES = 100;
const SORT_STORAGE_KEY = 'traks.sites.sort';

function storedSort(): SiteSort {
  try {
    const value = localStorage.getItem(SORT_STORAGE_KEY);
    if (value && Object.hasOwn(SITE_SORT_NAMES, value)) return value as SiteSort;
  } catch {
    /* storage blocked */
  }
  return 'added';
}

const byName = (a: any, b: any): number =>
  (a.name || a.domain).localeCompare(b.name || b.domain, undefined, { sensitivity: 'base' });

function SitesPage(): ReactElement {
  const queryClient = useQueryClient();
  const { current: workspace, isLoading: workspaceLoading } = useWorkspace();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [sort, setSort] = useState<SiteSort>(storedSort);

  const {
    data: sitesData,
    isLoading: sitesLoading,
    isFetching,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['sites', workspace?.id],
    queryFn: () => api.getSites(workspace!.id),
    enabled: !!workspace,
  });

  const isLoading = sitesLoading || workspaceLoading || !workspace;
  const isWorkspaceOwner = workspace?.role === 'owner';
  const allSites = useMemo(() => (sitesData as any)?.data || [], [sitesData]);

  // Client-side search: case-insensitive match on name or domain
  const filteredSites = useMemo(() => {
    if (!search.trim()) return allSites;
    const q = search.toLowerCase();
    return allSites.filter(
      (site: any) => site.name.toLowerCase().includes(q) || site.domain.toLowerCase().includes(q)
    );
  }, [allSites, search]);

  // Date added keeps the API's order. Sorting by name needs no stats, so it
  // happens before the fetch: the tiles shown are the ones fetched.
  const orderedSites = useMemo(
    () => (sort === 'name' ? [...filteredSites].sort(byName) : filteredSites),
    [filteredSites, sort]
  );

  // Sorting by visitors needs today's stats for every matching site, not
  // just the visible page, so that sort fetches them all (up to the batch
  // cap); the other sorts keep fetching stats for the visible tiles only.
  const sortsByStats = sort === 'visitors';
  const statsPool = orderedSites.slice(0, sortsByStats ? MAX_BATCH_SITES : visibleCount);

  // Stable string key for the fetched site IDs - prevents unnecessary refetches
  const idsJoined = statsPool.map((s: any) => s.id).join(',');
  const statsSiteIdsKey = useMemo(() => idsJoined, [idsJoined]);
  const statsSiteIds = useMemo(
    () => (statsSiteIdsKey ? statsSiteIdsKey.split(',') : []),
    [statsSiteIdsKey]
  );

  const {
    data: batchStatsData,
    isLoading: batchStatsLoading,
    isPlaceholderData,
  } = useQuery({
    queryKey: ['stats', 'batch', 'today', statsSiteIdsKey],
    queryFn: () => api.getBatchStats('today', statsSiteIds),
    enabled: statsSiteIds.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const batchStats = useMemo(() => (batchStatsData as any)?.data || {}, [batchStatsData]);

  // Busiest first; ties fall back to the name. Sites past the batch cap have
  // no stats and sort last. While switching to this sort, the placeholder only
  // holds the previous page's stats; sorting on those would reorder the grid
  // twice, so the order holds until every fetched site has its numbers.
  const statsReady =
    !isPlaceholderData || statsPool.every((s: any) => batchStats[s.id] !== undefined);
  const sortedSites = useMemo(() => {
    if (!sortsByStats || !statsReady) return orderedSites;
    return [...orderedSites].sort(
      (a: any, b: any) =>
        (batchStats[b.id]?.visitors ?? -1) - (batchStats[a.id]?.visitors ?? -1) || byName(a, b)
    );
  }, [orderedSites, sortsByStats, statsReady, batchStats]);

  // Paginate: show only `visibleCount` sites
  const visibleSites = sortedSites.slice(0, visibleCount);
  const hasMore = sortedSites.length > visibleCount;

  // Track tiles already rendered so only new ones animate in
  const renderedIdsRef = useRef(new Set<string>());

  // Reset pagination when search changes
  const handleSearchChange = (value: string): void => {
    renderedIdsRef.current.clear();
    setSearch(value);
    setVisibleCount(PAGE_SIZE);
  };

  const handleSortChange = (value: SiteSort): void => {
    renderedIdsRef.current.clear();
    setSort(value);
    setVisibleCount(PAGE_SIZE);
    try {
      localStorage.setItem(SORT_STORAGE_KEY, value);
    } catch {
      /* storage blocked: the choice lasts for this visit only */
    }
  };

  const handleRefresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    void queryClient.invalidateQueries({ queryKey: ['sites'] });
    void queryClient.invalidateQueries({ queryKey: ['stats', 'batch'] });
  };

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Page header: on phones the controls drop to their own row, with
          search taking the slack and Refresh shrinking to its icon. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-3 gap-y-4 sm:mb-8">
        <div>
          <h1 className="text-[26px] font-bold text-foreground tracking-[-0.02em]">Your Sites</h1>
          <p className="mt-1 text-[14px] text-subtle">
            {workspace ? `Sites in ${workspace.name}` : 'Select a site to view its analytics'}
          </p>
        </div>
        <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:gap-3">
          {!isLoading && allSites.length > 0 && (
            <div className="relative min-w-0 flex-1 sm:flex-none">
              <Search
                className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-faint"
                strokeWidth={1.8}
              />
              <Input
                placeholder="Search sites..."
                value={search}
                onChange={e => handleSearchChange(e.target.value)}
                className="pl-10 pr-9 rounded-full h-10 w-full text-[14px] sm:w-56"
              />
              {search && (
                <button
                  onClick={() => handleSearchChange('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" strokeWidth={1.8} />
                </button>
              )}
            </div>
          )}
          {!isLoading && allSites.length > 1 && (
            <SiteSortMenu value={sort} onChange={handleSortChange} />
          )}
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={isFetching}
            aria-label="Refresh sites"
            className="h-10 px-3 sm:px-4"
          >
            <RefreshCw
              className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
              strokeWidth={1.8}
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          {isWorkspaceOwner && (
            <Button
              variant="dark"
              onClick={() => setWizardOpen(true)}
              className="h-10 shrink-0 px-4 sm:px-5"
            >
              <Plus className="h-4 w-4" />
              Add Site
            </Button>
          )}
        </div>
      </div>

      {/* Add site wizard modal */}
      <AddSiteWizard open={wizardOpen} onOpenChange={setWizardOpen} workspaceId={workspace?.id} />

      {/* Site tiles grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-[248px] animate-pulse rounded-[20px] bg-card shadow-float" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-[20px] bg-card px-8 py-16 text-center shadow-float">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
            <Globe className="h-8 w-8 text-subtle" />
          </div>
          <p className="text-[17px] font-semibold text-foreground">
            Couldn&rsquo;t load your sites
          </p>
          <p className="mx-auto mt-2 max-w-sm text-[14px] text-subtle">
            Your sites are safe; this instance just couldn&rsquo;t be reached. Check your connection
            and try again.
          </p>
          <button
            onClick={() => void refetch()}
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-btn px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-btn-hover"
          >
            Try again
          </button>
        </div>
      ) : allSites.length === 0 ? (
        <div className="rounded-[20px] bg-card px-8 py-16 text-center shadow-float">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <Globe className="h-8 w-8 text-foreground" />
          </div>
          <p className="text-[17px] font-semibold text-foreground">No sites yet</p>
          <p className="mt-2 text-[14px] text-subtle max-w-sm mx-auto">
            {isWorkspaceOwner
              ? 'Add your first website to start tracking visitors, pageviews, and more'
              : 'A workspace owner needs to add a site before there is anything to see here'}
          </p>
          {isWorkspaceOwner && (
            <Button variant="dark" onClick={() => setWizardOpen(true)} className="mt-5 px-6">
              <Plus className="h-4 w-4" />
              Add Your First Site
            </Button>
          )}
        </div>
      ) : filteredSites.length === 0 ? (
        <div className="rounded-[20px] bg-card px-8 py-12 text-center shadow-float">
          <Search className="mx-auto h-8 w-8 text-faint mb-3" strokeWidth={1.5} />
          <p className="text-[15px] font-medium text-foreground">
            No sites match &quot;{search}&quot;
          </p>
          <p className="mt-1 text-[13px] text-subtle">Try a different search term</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {visibleSites.map((site: any, i: number) => {
              const color = TILE_COLORS[i % TILE_COLORS.length];
              const isNew = !renderedIdsRef.current.has(site.id);
              renderedIdsRef.current.add(site.id);
              const batchIndex = isNew ? i % PAGE_SIZE : 0;
              return (
                <SiteTile
                  key={site.id}
                  site={site}
                  color={color}
                  stats={batchStats[site.id]}
                  isStatsLoading={batchStatsLoading}
                  isNew={isNew}
                  batchIndex={batchIndex}
                />
              );
            })}
          </div>

          {/* Load more button */}
          {hasMore && (
            <div className="mt-8 text-center">
              <Button
                variant="outline"
                onClick={() => {
                  setVisibleCount(prev => prev + PAGE_SIZE);
                  requestAnimationFrame(() => {
                    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                  });
                }}
                className="text-[13px] px-8"
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
