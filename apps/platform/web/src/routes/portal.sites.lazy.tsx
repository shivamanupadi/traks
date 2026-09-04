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

export const Route = createLazyFileRoute('/portal/sites')({
  component: SitesPage,
});

const TILE_COLORS = [
  { deep: '#3D3B4F', pastel: '#C9C8D4' },
  { deep: '#6b8ead', pastel: '#b8cbd9' },
  { deep: '#e07a5f', pastel: '#f2b5a4' },
];
const PAGE_SIZE = 6;

function SitesPage(): ReactElement {
  const queryClient = useQueryClient();
  const { current: workspace, isLoading: workspaceLoading } = useWorkspace();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

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

  // Paginate: show only `visibleCount` sites
  const visibleSites = filteredSites.slice(0, visibleCount);
  const hasMore = filteredSites.length > visibleCount;

  // Stable string key for visible site IDs - prevents unnecessary refetches
  const idsJoined = visibleSites.map((s: any) => s.id).join(',');
  const visibleSiteIdsKey = useMemo(() => idsJoined, [idsJoined]);
  const visibleSiteIds = useMemo(
    () => (visibleSiteIdsKey ? visibleSiteIdsKey.split(',') : []),
    [visibleSiteIdsKey]
  );

  // Batch stats scoped to visible sites only
  const { data: batchStatsData, isLoading: batchStatsLoading } = useQuery({
    queryKey: ['stats', 'batch', 'today', visibleSiteIdsKey],
    queryFn: () => api.getBatchStats('today', visibleSiteIds),
    enabled: visibleSiteIds.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const batchStats = (batchStatsData as any)?.data || {};

  // Track tiles already rendered so only new ones animate in
  const renderedIdsRef = useRef(new Set<string>());

  // Reset pagination when search changes
  const handleSearchChange = (value: string): void => {
    renderedIdsRef.current.clear();
    setSearch(value);
    setVisibleCount(PAGE_SIZE);
  };

  const handleRefresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    void queryClient.invalidateQueries({ queryKey: ['sites'] });
    void queryClient.invalidateQueries({ queryKey: ['stats', 'batch'] });
  };

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[26px] font-bold text-[#3D3B4F] tracking-[-0.02em]">Your Sites</h1>
          <p className="mt-1 text-[14px] text-[#9B9590]">
            {workspace ? `Sites in ${workspace.name}` : 'Select a site to view its analytics'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isLoading && allSites.length > 0 && (
            <div className="relative">
              <Search
                className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B5B0AA]"
                strokeWidth={1.8}
              />
              <Input
                placeholder="Search sites..."
                value={search}
                onChange={e => handleSearchChange(e.target.value)}
                className="pl-10 pr-9 rounded-full h-10 w-56 text-[14px]"
              />
              {search && (
                <button
                  onClick={() => handleSearchChange('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#B5B0AA] hover:text-[#3D3B4F] transition-colors"
                >
                  <X className="w-4 h-4" strokeWidth={1.8} />
                </button>
              )}
            </div>
          )}
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={isFetching}
            aria-label="Refresh sites"
            className="h-10 px-4"
          >
            <RefreshCw
              className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
              strokeWidth={1.8}
            />
            Refresh
          </Button>
          {isWorkspaceOwner && (
            <Button variant="dark" onClick={() => setWizardOpen(true)} className="px-5 h-10">
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
            <div key={i} className="h-[248px] animate-pulse rounded-[20px] bg-white shadow-float" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-[20px] bg-white px-8 py-16 text-center shadow-float">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
            <Globe className="h-8 w-8 text-[#9B9590]" />
          </div>
          <p className="text-[17px] font-semibold text-[#3D3B4F]">Couldn&rsquo;t load your sites</p>
          <p className="mx-auto mt-2 max-w-sm text-[14px] text-[#9B9590]">
            Your sites are safe; this instance just couldn&rsquo;t be reached. Check your connection
            and try again.
          </p>
          <button
            onClick={() => void refetch()}
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-[#3D3B4F] px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#2C2B3B]"
          >
            Try again
          </button>
        </div>
      ) : allSites.length === 0 ? (
        <div className="rounded-[20px] bg-white px-8 py-16 text-center shadow-float">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <Globe className="h-8 w-8 text-foreground" />
          </div>
          <p className="text-[17px] font-semibold text-[#3D3B4F]">No sites yet</p>
          <p className="mt-2 text-[14px] text-[#9B9590] max-w-sm mx-auto">
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
        <div className="rounded-[20px] bg-white px-8 py-12 text-center shadow-float">
          <Search className="mx-auto h-8 w-8 text-[#B5B0AA] mb-3" strokeWidth={1.5} />
          <p className="text-[15px] font-medium text-[#3D3B4F]">
            No sites match &quot;{search}&quot;
          </p>
          <p className="mt-1 text-[13px] text-[#9B9590]">Try a different search term</p>
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
