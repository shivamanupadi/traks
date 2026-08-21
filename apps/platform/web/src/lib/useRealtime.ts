import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  toLiveFilters,
  type LiveFilters,
  type LiveRealtimeFrame,
  type LiveRealtimeLocation,
  type LiveRealtimeNamed,
  type LiveSocketCommand,
} from '@traks/shared';
import { api, type AnalyticsFilters } from '@/lib/api';

export interface RealtimeData {
  currentVisitors: number;
  topPages: { path: string; visitors: number }[];
  locations: LiveRealtimeLocation[];
  referrers: LiveRealtimeNamed[];
  countries: LiveRealtimeNamed[];
}

export interface RealtimeState {
  data: RealtimeData | null;
  /** 'live' while the WebSocket is delivering frames; 'polling' otherwise. */
  status: 'live' | 'polling';
}

const POLL_INTERVAL_MS = 30_000;
/** Client keepalive; the DO answers 'pong' without leaving hibernation. */
const PING_INTERVAL_MS = 25_000;
/** No frame or pong for this long -> the socket is dead, reconnect. */
const STALE_AFTER_MS = 75_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

/** Order-independent identity of a filter set (what frames are keyed by). */
function filterKey(filters: LiveFilters | undefined): string {
  if (!filters) return '';
  return Object.entries(filters)
    .filter(([, v]) => typeof v === 'string' && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');
}

export const realtimeQueryKey = (
  siteId: string,
  key = ''
): readonly ['site-analytics', string, 'realtime', string] => [
  'site-analytics',
  siteId,
  'realtime',
  key,
];

function normalize(raw: unknown): RealtimeData | null {
  const d = (raw as { data?: Partial<RealtimeData> } | undefined)?.data;
  if (!d || typeof d.currentVisitors !== 'number') return null;
  return {
    currentVisitors: d.currentVisitors,
    topPages: Array.isArray(d.topPages) ? d.topPages : [],
    locations: Array.isArray(d.locations) ? d.locations : [],
    referrers: Array.isArray(d.referrers) ? d.referrers : [],
    countries: Array.isArray(d.countries) ? d.countries : [],
  };
}

/**
 * Realtime visitors for a site, optionally filtered: subscribes to the api's
 * WebSocket (the site's live Durable Object pushes a frame whenever the
 * picture changes, plus a 30s tick) and keeps the REST poll as the fallback
 * while the socket is down. Filters travel up the socket as a command and
 * are stored per socket in the DO; frames echo them, so a frame for a
 * previous filter set is dropped instead of flashing stale data.
 *
 * Both paths write into one react-query entry per filter set, so consumers
 * never care which delivered the latest value.
 */
export function useRealtime(siteId: string, filters?: AnalyticsFilters): RealtimeState {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);

  const liveFilters = toLiveFilters(filters ?? {});
  const key = filterKey(liveFilters);
  const filtersRef = useRef<LiveFilters | undefined>(liveFilters);
  filtersRef.current = liveFilters;
  const keyRef = useRef(key);
  keyRef.current = key;
  const socketRef = useRef<WebSocket | null>(null);

  const query = useQuery({
    queryKey: realtimeQueryKey(siteId, key),
    queryFn: () => api.getRealtime(siteId, filters),
    refetchInterval: connected ? false : POLL_INTERVAL_MS,
    staleTime: 15_000,
  });

  // Filter change while connected: tell the socket; the DO answers with a
  // fresh frame for the new set right away.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const command: LiveSocketCommand = { type: 'filters', filters: liveFilters ?? {} };
    try {
      socket.send(JSON.stringify(command));
    } catch {
      // closing; onclose reconnects with the current filters
    }
    // `key` is the identity of liveFilters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let lastHeard = 0;
    let backoff = BACKOFF_MIN_MS;

    const setLive = (live: boolean): void => {
      if (connectedRef.current === live) return;
      connectedRef.current = live;
      setConnected(live);
    };

    const clearTimers = (): void => {
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = undefined;
    };

    const scheduleReconnect = (): void => {
      if (cancelled) return;
      retryTimer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    };

    function connect(): void {
      if (cancelled) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/api/analytics/${encodeURIComponent(siteId)}/stats/realtime/ws`;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.onopen = (): void => {
        lastHeard = Date.now();
        // The DO's first frame is unfiltered; send the current set straight
        // away so a filtered consumer never renders it.
        if (filtersRef.current) {
          const command: LiveSocketCommand = { type: 'filters', filters: filtersRef.current };
          try {
            socket.send(JSON.stringify(command));
          } catch {
            // closing
          }
        }
        pingTimer = setInterval((): void => {
          if (Date.now() - lastHeard > STALE_AFTER_MS) {
            socket.close();
            return;
          }
          try {
            socket.send('ping');
          } catch {
            // closing; onclose reconnects
          }
        }, PING_INTERVAL_MS);
      };

      socket.onmessage = (event: MessageEvent): void => {
        lastHeard = Date.now();
        if (typeof event.data !== 'string' || event.data === 'pong') return;
        let frame: LiveRealtimeFrame;
        try {
          frame = JSON.parse(event.data) as LiveRealtimeFrame;
        } catch {
          return;
        }
        if (frame?.type !== 'realtime') return;
        // A frame is proof of a healthy subscription - only now stop polling.
        backoff = BACKOFF_MIN_MS;
        setLive(true);
        const frameKey = filterKey(frame.filters);
        // Stale frame for a filter set this hook no longer wants.
        if (frameKey !== keyRef.current) return;
        queryClient.setQueryData(realtimeQueryKey(siteId, frameKey), {
          data: {
            currentVisitors: frame.currentVisitors,
            topPages: frame.topPages ?? [],
            locations: frame.locations ?? [],
            referrers: frame.referrers ?? [],
            countries: frame.countries ?? [],
          },
        });
      };

      socket.onerror = (): void => {
        try {
          socket.close();
        } catch {
          // already closed
        }
      };

      socket.onclose = (): void => {
        clearTimers();
        if (socketRef.current === socket) socketRef.current = null;
        setLive(false);
        scheduleReconnect();
      };
    }

    connect();

    return (): void => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      clearTimers();
      setLive(false);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onclose = null;
        try {
          socket.close(1000, 'unmount');
        } catch {
          // already closed
        }
      }
    };
  }, [siteId, queryClient]);

  return {
    data: normalize(query.data),
    status: connected ? 'live' : 'polling',
  };
}
