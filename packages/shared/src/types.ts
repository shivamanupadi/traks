import type { Period } from './constants';

// Event payload from the tracking script to the collect worker
export interface TrackingEvent {
  t: 'pageview' | 'event' | 'engagement'; // event type
  s: string; // site key
  p: string; // pathname
  h: string; // hostname
  r: string; // referrer (full URL)
  sw: number; // screen width
  vid: string; // visitor ID
  sid: string; // session ID
  u: number; // is_unique (1 or 0)
  ns: number; // new_session (1 or 0)
  us?: string; // utm_source
  um?: string; // utm_medium
  uc?: string; // utm_campaign
  en?: string; // event_name (custom events)
  ep?: string; // event_props JSON (custom events)
  ev?: number; // event_value (custom events)
}

// Dashboard API response types
export interface MainStats {
  visitors: number;
  pageviews: number;
  sessions: number;
  /** Percentage of sessions with exactly one pageview (0-100). */
  bounceRate: number;
  visitorsChange: number;
  pageviewsChange: number;
  sessionsChange: number;
  /** Percentage-point change vs the previous period (positive = bounce rate went up). */
  bounceRateChange: number;
  /** Average engaged seconds per session (from tracker engagement pings). */
  avgDuration: number;
  avgDurationChange: number;
}

export interface GoalStat {
  id: string;
  name: string;
  type: 'event' | 'page';
  target: string;
  /** Optional event-prop condition on 'event' goals. */
  propKey?: string | null;
  propValue?: string | null;
  /** Unique visitors who completed the goal in the period. */
  uniques: number;
  /** Total completions. */
  events: number;
  /** uniques / period visitors, 0-100 with one decimal. */
  conversionRate: number;
}

/**
 * A saved filter set - same camelCase keys the analytics endpoints accept as
 * query params (and the dashboard carries in its URL search params).
 */
export interface SegmentFilters {
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
}

export interface SegmentDef {
  id: string;
  name: string;
  filters: SegmentFilters;
}

/** One ordered funnel step: a pageview of a pathname or a custom event.
 *  Page targets may end in `/*` to match the whole section; event steps may
 *  carry one exact-match prop condition. */
export interface FunnelStep {
  type: 'event' | 'page';
  target: string;
  /** Optional event-prop condition (both present or both absent). */
  propKey?: string;
  propValue?: string;
}

export interface FunnelDef {
  id: string;
  name: string;
  steps: FunnelStep[];
}

export interface FunnelStepStat extends FunnelStep {
  /** Sessions that completed this step and every prior step, in order. */
  sessions: number;
  /** Percent of step-1 sessions that reached this step (0-100, one decimal). */
  rateFromFirst: number;
  /** Percent of previous-step sessions that reached this step (0-100, one decimal). */
  rateFromPrev: number;
}

export interface FunnelStat {
  id: string;
  name: string;
  steps: FunnelStepStat[];
}

export interface TimeseriesPoint {
  date: string;
  visitors: number;
  pageviews: number;
  sessions: number;
}

export interface TopItem {
  name: string;
  visitors: number;
  pageviews: number;
}

export interface LocationItem {
  name: string;
  code: string;
  visitors: number;
}

export interface DeviceItem {
  name: string;
  visitors: number;
  percentage: number;
}

export interface CustomEventItem {
  name: string;
  count: number;
  totalValue: number;
}

export interface RealtimeStats {
  currentVisitors: number;
  topPages: { path: string; visitors: number }[];
}

export interface Site {
  id: string;
  name: string;
  domain: string;
  timezone: string;
  public: boolean;
  createdAt: string;
}

export interface StatsQueryParams {
  period: Period;
  from?: string;
  to?: string;
}
