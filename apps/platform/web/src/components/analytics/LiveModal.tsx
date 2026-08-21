import { useState, type ReactElement } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';
import type { AnalyticsFilters } from '@/lib/api';
import { useRealtime } from '@/lib/useRealtime';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { PanelCard, type PanelItem } from './PanelCard';
import { CountryFlag, countryName } from './CountryFlag';
import { FilterChips } from './FilterChips';
import { WorldMap } from './WorldMap';

interface LiveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  domain?: string | null;
  /** The dashboard's current filters - the live view starts from them. */
  dashboardFilters: AnalyticsFilters;
  /** Push the live view's filters back onto the dashboard. */
  onApply: (filters: AnalyticsFilters) => void;
}

/**
 * "Right now" for one site: a dotted world map of active visitors over the
 * pages they're on, where they came from and where they are - all of it
 * filterable by clicking, served by the live socket (polling fallback).
 */
export function LiveModal(props: LiveModalProps): ReactElement {
  const { open, onOpenChange } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1080px]" onClose={() => onOpenChange(false)}>
        {open && <LiveModalBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

const PANEL_CLASS = 'min-h-0 rounded-none bg-transparent p-0 shadow-none';

function LiveModalBody({
  siteId,
  domain,
  dashboardFilters,
  onApply,
  onOpenChange,
}: LiveModalProps): ReactElement {
  const [filters, setFilters] = useState<AnalyticsFilters>(dashboardFilters);
  const [locationTab, setLocationTab] = useState<'city' | 'country'>('city');
  const { data, status } = useRealtime(siteId, filters);

  const count = data?.currentVisitors ?? null;
  const hasFilters = Object.values(filters).some(Boolean);
  const live = status === 'live';

  const setFilter = (key: keyof AnalyticsFilters, value: string): void =>
    setFilters(prev => ({ ...prev, [key]: value }));
  const removeFilter = (key: keyof AnalyticsFilters): void =>
    setFilters(prev => ({ ...prev, [key]: undefined }));

  const pages: PanelItem[] | undefined = data?.topPages.map(p => ({
    name: p.path,
    visitors: p.visitors,
  }));
  const sources: PanelItem[] | undefined = data?.referrers.map(r => ({
    name: r.name,
    visitors: r.visitors,
  }));
  const locations: PanelItem[] | undefined =
    locationTab === 'city'
      ? data?.locations.map(l => ({
          // Filter value: the city when known, else the country code.
          name: l.city || l.country,
          id: `${l.latitude}:${l.longitude}:${l.city}`,
          label: l.city || countryName(l.country),
          icon: <CountryFlag code={l.country} />,
          visitors: l.visitors,
        }))
      : data?.countries.map(c => ({
          name: c.name,
          label: countryName(c.name),
          icon: <CountryFlag code={c.name} />,
          visitors: c.visitors,
        }));

  return (
    <div className="p-6">
      {/* Title row */}
      <div className="flex items-center justify-between gap-4 pr-9">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative flex h-[8px] w-[8px]">
            {live && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60 motion-reduce:animate-none" />
            )}
            <span
              className={cn(
                'relative inline-flex h-[8px] w-[8px] rounded-full',
                live ? 'bg-mint' : 'bg-[#B5B0AA]'
              )}
            />
          </span>
          <h2 className="text-[15px] font-bold tracking-[-0.01em] text-[#3D3B4F]">Live</h2>
          {domain && <span className="truncate text-[12.5px] text-[#9B9590]">{domain}</span>}
          <span className="h-4 w-px bg-[#E6E4DE]" />
          {count === null ? (
            <span className="h-5 w-10 animate-pulse rounded bg-muted" />
          ) : (
            <span className="text-[18px] font-bold leading-none tracking-[-0.02em] tabular-nums text-[#3D3B4F]">
              {formatNumber(count)}
            </span>
          )}
          <span className="text-[12.5px] text-[#9B9590]">online now · last 5 min</span>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full border border-[#E6E4DE] px-2.5 py-1 text-[11px] font-semibold',
            live ? 'text-[#3F7A50]' : 'text-[#9B9590]'
          )}
          title={live ? 'Updates are pushed as they happen' : 'Refreshing every 30 seconds'}
        >
          {live ? 'Live' : 'Every 30s'}
        </span>
      </div>

      {/* Filters */}
      <div className="mt-4 flex min-h-[28px] flex-wrap items-center gap-3">
        {hasFilters ? (
          <FilterChips
            filters={filters}
            onRemove={removeFilter}
            onClear={() => setFilters({})}
            clearLabel="Clear"
            alwaysShowClear
          />
        ) : (
          <span className="text-[12.5px] text-[#B5B0AA]">
            Click a page, source or place to filter the live view
          </span>
        )}
        <button
          type="button"
          disabled={!hasFilters}
          onClick={() => {
            onApply(filters);
            onOpenChange(false);
          }}
          className={cn(
            'ml-auto inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors',
            hasFilters
              ? 'bg-[#3D3B4F] text-white hover:bg-[#2C2B3B]'
              : 'cursor-default border border-[#E6E4DE] text-[#B5B0AA]'
          )}
        >
          Apply to dashboard
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      <WorldMap
        className="mt-4"
        locations={data?.locations ?? []}
        onSelect={l => (l.city ? setFilter('city', l.city) : setFilter('country', l.country))}
      />

      <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-3">
        <PanelCard
          className={PANEL_CLASS}
          title="Active pages"
          labelHeader="Page"
          items={pages}
          isLoading={!data}
          emptyText="No one here right now"
          onItemClick={item => setFilter('page', item.name)}
        />
        <PanelCard
          className={PANEL_CLASS}
          title="Sources"
          labelHeader="Referrer"
          items={sources}
          isLoading={!data}
          emptyText="No referred visitors right now"
          onItemClick={item => setFilter('source', item.name)}
        />
        <PanelCard
          className={PANEL_CLASS}
          title="Locations"
          labelHeader={locationTab === 'city' ? 'City' : 'Country'}
          items={locations}
          isLoading={!data}
          emptyText="No one here right now"
          tabs={[
            { key: 'city', label: 'Cities' },
            { key: 'country', label: 'Countries' },
          ]}
          activeTab={locationTab}
          onTabChange={key => setLocationTab(key as 'city' | 'country')}
          onItemClick={item =>
            locationTab === 'city' && item.label !== countryName(item.name)
              ? setFilter('city', item.name)
              : setFilter('country', item.name)
          }
        />
      </div>
    </div>
  );
}
