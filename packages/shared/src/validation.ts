import { z } from 'zod';

/**
 * Tracker event payload. Strict mode rejects unknown keys so a misconfigured
 * tracker surfaces as a 400 rather than silently dropping data.
 */
export const trackingEventSchema = z
  .object({
    t: z.enum(['pageview', 'event']),
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
    ev: z.number().optional(),
  })
  .strict();

export type ValidatedTrackingEvent = z.infer<typeof trackingEventSchema>;

export const createSiteSchema = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().min(1).max(256),
  timezone: z.string().max(64).default('UTC'),
});

export const updateSiteSchema = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().min(1).max(256),
});

export const statsQuerySchema = z.object({
  period: z.enum(['today', '7d', '30d', '90d', '6m', '1y', 'all']).default('today'),
  from: z.string().optional(),
  to: z.string().optional(),
  siteIds: z.string().optional(),
});
