/**
 * Plan catalog — the single source of truth for quotas, limits, and pricing.
 * Enforcement points: collect worker (monthly event quota), sites routes
 * (site limit, export gating), billing routes (Dodo product mapping).
 */

export type PlanId = 'free' | 'pro' | 'business';

export interface PlanConfig {
  id: PlanId;
  name: string;
  priceUsd: number; // per month
  monthlyEvents: number; // per-site ingest quota
  siteLimit: number;
  exports: boolean; // nightly raw-data export + DuckDB access
  weeklyReports: boolean;
}

export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    id: 'free',
    name: 'Free',
    priceUsd: 0,
    monthlyEvents: 10_000,
    siteLimit: 1,
    exports: false,
    weeklyReports: false,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceUsd: 19,
    monthlyEvents: 1_000_000,
    siteLimit: 10,
    exports: true,
    weeklyReports: true,
  },
  business: {
    id: 'business',
    name: 'Business',
    priceUsd: 99,
    monthlyEvents: 10_000_000,
    siteLimit: 50,
    exports: true,
    weeklyReports: true,
  },
};

export function planOf(id: string | null | undefined): PlanConfig {
  return PLANS[(id as PlanId) ?? 'free'] ?? PLANS.free;
}
