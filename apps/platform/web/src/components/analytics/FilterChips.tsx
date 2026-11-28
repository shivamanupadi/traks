import type { ReactElement } from 'react';
import { Filter, X } from 'lucide-react';
import { parsePropsFilter } from '@traks/shared';
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
  props: 'Property',
};

/** One-line text for a filter, e.g. "Country: Germany" or "spaceid: a · eventid: b". */
export function describeFilter(key: keyof AnalyticsFilters, value: string): string {
  if (key === 'props') {
    return (parsePropsFilter(value) ?? []).map(([k, v]) => `${k}: ${v}`).join(' · ');
  }
  return `${FILTER_LABELS[key] ?? key}: ${key === 'country' ? countryName(value) : value}`;
}

/** One chip: a filter key, or one property of the props filter. */
interface Chip {
  id: string;
  label: string;
  value: string;
  remove: () => void;
}

/** Active click-to-filter chips with per-chip remove and a clear-all. */
export function FilterChips({
  filters,
  onRemove,
  onRemoveProp,
  onClear,
  clearLabel = 'Clear all',
  alwaysShowClear = false,
}: {
  filters: AnalyticsFilters;
  onRemove: (key: keyof AnalyticsFilters) => void;
  /** Drop one property from the props filter; without it, its chips drop them all. */
  onRemoveProp?: (propKey: string) => void;
  onClear: () => void;
  clearLabel?: string;
  /** Show the clear action even with a single chip. */
  alwaysShowClear?: boolean;
}): ReactElement | null {
  const entries = Object.entries(filters).filter(([, v]) => v) as [
    keyof AnalyticsFilters,
    string,
  ][];
  // The props filter shows as one chip per property ("spaceid: organizer-123").
  const chips: Chip[] = entries.flatMap(([key, value]): Chip[] =>
    key === 'props'
      ? (parsePropsFilter(value) ?? []).map(([k, v]) => ({
          id: `props.${k}`,
          label: k,
          value: v,
          remove: () => (onRemoveProp ? onRemoveProp(k) : onRemove('props')),
        }))
      : [
          {
            id: key,
            label: FILTER_LABELS[key],
            value: key === 'country' ? countryName(value) : value,
            remove: () => onRemove(key),
          },
        ]
  );
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Filter className="h-3.5 w-3.5 text-subtle" strokeWidth={1.7} />
      {chips.map(chip => (
        <span
          key={chip.id}
          className="flex items-center gap-1.5 rounded-full bg-muted py-1 pl-3 pr-1.5 text-[12px] text-foreground"
        >
          <span className="text-subtle">{chip.label}</span>
          <span className="max-w-[180px] truncate font-medium">{chip.value}</span>
          <button
            onClick={chip.remove}
            className="flex h-4.5 w-4.5 items-center justify-center rounded-full hover:bg-border transition-colors cursor-pointer"
            title="Remove filter"
          >
            <X className="h-3 w-3 text-subtle" />
          </button>
        </span>
      ))}
      {(alwaysShowClear || chips.length > 1) && (
        <button
          onClick={onClear}
          className="text-[12px] text-subtle hover:text-foreground transition-colors cursor-pointer"
        >
          {clearLabel}
        </button>
      )}
    </div>
  );
}
