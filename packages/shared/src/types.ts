import type { Period } from './constants';

// Event payload from the tracking script to the collect worker
export interface TrackingEvent {
  t: 'pageview' | 'event'; // event type
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
  bounceRate: number;
  visitorsChange: number;
  pageviewsChange: number;
  sessionsChange: number;
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
