import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LiveRealtimeFrame, LiveRealtimeLocation } from '@traks/shared';
import { api } from '@/lib/api';

export interface RealtimeData {
  currentVisitors: number;
  topPages: { path: string; visitors: number }[];
  locations: LiveRealtimeLocation[];
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

export const realtimeQueryKey = (siteId: string): readonly ['site-analytics', string, 'realtime'] =>
  ['site-analytics', siteId, 'realtime'] as const;

function normalize(raw: unknown): RealtimeData | null {
  const d = (raw as { data?: Partial<RealtimeData> } | undefined)?.data;
  if (!d || typeof d.currentVisitors !== 'number') return null;
  return {
    currentVisitors: d.currentVisitors,
    topPages: Array.isArray(d.topPages) ? d.topPages : [],
    locations: Array.isArray(d.locations) ? d.locations : [],
  };
}

/**
 * Realtime visitors for a site: subscribes to the api's WebSocket (the site's
 * live Durable Object pushes a frame whenever the picture changes, plus a 30s
 * tick) and keeps the REST poll as the fallback while the socket is down.
 * Both paths write into one react-query entry, so consumers never care which
 * delivered the latest value.
 */
export function useRealtime(siteId: string): RealtimeState {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);

  const query = useQuery({
    queryKey: realtimeQueryKey(siteId),
    queryFn: () => api.getRealtime(siteId),
    refetchInterval: connected ? false : POLL_INTERVAL_MS,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
    let cancelled = false;
    let ws: WebSocket | null = null;
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
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      const socket = ws;

      socket.onopen = (): void => {
        lastHeard = Date.now();
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
        queryClient.setQueryData(realtimeQueryKey(siteId), {
          data: {
            currentVisitors: frame.currentVisitors,
            topPages: frame.topPages ?? [],
            locations: frame.locations ?? [],
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
        if (ws === socket) ws = null;
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
      if (ws) {
        const socket = ws;
        ws = null;
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
