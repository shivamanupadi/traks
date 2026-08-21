import type { ReactElement } from 'react';
import { Filter, X } from 'lucide-react';
import type { AnalyticsFilters } from '@/lib/api';
import { countryName } from './CountryFlag';

export const FILTER_LABELS: Record<keyof AnalyticsFilters, string> = {
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

/** Active click-to-filter chips with per-chip remove and a clear-all. */
export function FilterChips({
  filters,
  onRemove,
  onClear,
  clearLabel = 'Clear all',
  alwaysShowClear = false,
}: {
  filters: AnalyticsFilters;
  onRemove: (key: keyof AnalyticsFilters) => void;
  onClear: () => void;
  clearLabel?: string;
  /** Show the clear action even with a single chip. */
  alwaysShowClear?: boolean;
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
      {(alwaysShowClear || entries.length > 1) && (
        <button
          onClick={onClear}
          className="text-[12px] text-[#9B9590] hover:text-[#3D3B4F] transition-colors cursor-pointer"
        >
          {clearLabel}
        </button>
      )}
    </div>
  );
}
