import type { Period } from '@traks/shared';

/**
 * Result cache TTL per period. Long windows barely change; 'today' tracks
 * ingest. The SQL text embeds `now` quantized to this TTL, so the TTL is also
 * the cache-key bucket - the pre-warm cron aligns to the same boundaries.
 */
export function cacheTtlSeconds(period: Period): number {
  switch (period) {
    case 'today':
      return 60;
    default:
      return 900;
  }
}
