import { z } from 'zod';

/**
 * Tracker event payload. Strict mode rejects unknown keys so a misconfigured
 * tracker surfaces as a 400 rather than silently dropping data.
 */
export const trackingEventSchema = z
  .object({
    t: z.enum(['pageview', 'event', 'engagement']),
    s: z.string().min(1).max(64),
    p: z.string().max(2048).default('/'),
    h: z.string().max(256).default(''),
    r: z.string().max(2048).default(''),
    sw: z.number().int().min(0).max(10000).default(0),
    sid: z.string().max(64).default(''),
    us: z.string().max(256).optional(),
    um: z.string().max(256).optional(),
    uc: z.string().max(256).optional(),
    en: z.string().max(256).optional(),
    ep: z.string().max(1024).optional(),
    // Bounded: the site key is public, so an unbounded value would let anyone
    // poison revenue/engagement sums (SUM over 1e308 → Infinity) for a site.
    ev: z.number().finite().min(0).max(1_000_000).optional(),
  })
  .strict();

export type ValidatedTrackingEvent = z.infer<typeof trackingEventSchema>;

/**
 * An invalid IANA zone would make Intl throw inside computeBucketKeys and
 * fail every ingest request for the site - reject it at the API boundary.
 */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const timezoneSchema = z
  .string()
  .max(64)
  .refine(isValidTimezone, { message: 'Invalid IANA timezone' });

export const createSiteSchema = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().min(1).max(256),
  timezone: timezoneSchema.default('UTC'),
});

export const updateSiteSchema = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().min(1).max(256),
  timezone: timezoneSchema.optional(),
});

/** Account-level "apply this timezone to all my sites". */
export const allSitesTimezoneSchema = z.object({
  timezone: timezoneSchema,
});

/** Goal definition: a custom event name or a pathname that counts as a conversion. */
export const createGoalSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['event', 'page']),
  target: z.string().min(1).max(2048),
});

/** Saved filter set: at least one known filter dimension, unknown keys stripped. */
export const segmentFiltersSchema = z
  .object({
    page: z.string().min(1).max(2048),
    source: z.string().min(1).max(512),
    utmSource: z.string().min(1).max(512),
    utmMedium: z.string().min(1).max(512),
    utmCampaign: z.string().min(1).max(512),
    country: z.string().min(1).max(128),
    region: z.string().min(1).max(128),
    city: z.string().min(1).max(128),
    browser: z.string().min(1).max(128),
    os: z.string().min(1).max(128),
    device: z.string().min(1).max(128),
  })
  .partial()
  .refine(f => Object.values(f).some(v => v), {
    message: 'A segment needs at least one filter',
  });

export const createSegmentSchema = z.object({
  name: z.string().min(1).max(100),
  filters: segmentFiltersSchema,
});

/** One ordered funnel step: a pageview of a pathname or a custom event. */
export const funnelStepSchema = z.object({
  type: z.enum(['event', 'page']),
  target: z.string().min(1).max(2048),
});

/** Funnel definition: 2-8 ordered steps a session should complete in sequence. */
export const createFunnelSchema = z.object({
  name: z.string().min(1).max(100),
  steps: z.array(funnelStepSchema).min(2).max(8),
});

export const statsQuerySchema = z.object({
  period: z.enum(['today', '7d', '30d', '90d', '6m', '1y', 'all']).default('today'),
  from: z.string().optional(),
  to: z.string().optional(),
  siteIds: z.string().optional(),
});
