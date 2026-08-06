import { createFileRoute } from '@tanstack/react-router';
import { PERIODS } from '@traks/shared';
import type { Period } from '@traks/shared';

type SiteSearch = {
  period?: Period;
  // Click-to-filter params (exact match), mirrored to the API's query fields.
  page?: string;
  source?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  country?: string;
  region?: string;
  city?: string;
  browser?: string;
  os?: string;
  device?: string;
};

const FILTER_KEYS = [
  'page',
  'source',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'country',
  'region',
  'city',
  'browser',
  'os',
  'device',
] as const;

export const Route = createFileRoute('/portal/site/$siteId')({
  validateSearch: (search: Record<string, unknown>): SiteSearch => {
    const p = search.period as string;
    const out: SiteSearch = {
      period: PERIODS.includes(p as Period) ? (p as Period) : undefined,
    };
    for (const key of FILTER_KEYS) {
      const value = search[key];
      if (typeof value === 'string' && value.length > 0) out[key] = value;
    }
    return out;
  },
});
