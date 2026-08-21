import { useEffect, useMemo, useRef, type PointerEvent, type ReactElement } from 'react';
import type { LiveRealtimeLocation } from '@traks/shared';
import { GlobeController, type GlobePoint, type GlobeTheme } from '@/lib/globe';

interface RealtimeGlobeProps {
  locations: LiveRealtimeLocation[];
  className?: string;
}

/** Porcelain palette in 0-1 RGB: warm-gray land, mint markers, page-ground glow. */
const THEME: GlobeTheme = {
  land: [0.71, 0.7, 0.73],
  marker: [0.157, 0.914, 0.624],
  glow: [0.976, 0.973, 0.965],
};

/**
 * The realtime globe: one mint marker per city with active visitors, sized
 * by how many. Idle-spins, turns toward the busiest city when that changes,
 * and can be dragged (with a little fling). All motion lives in
 * GlobeController; this component only mounts it and forwards pointer input.
 */
export function RealtimeGlobe({ locations, className }: RealtimeGlobeProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<GlobeController | null>(null);

  const points = useMemo<GlobePoint[]>(
    () =>
      locations.map(l => ({
        latitude: l.latitude,
        longitude: l.longitude,
        weight: l.visitors,
      })),
    [locations]
  );

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const controller = new GlobeController(canvas, host, THEME, reducedMotion);
    controllerRef.current = controller;
    controller.setPoints(points);
    void controller.start();
    return (): void => {
      controller.dispose();
      controllerRef.current = null;
    };
    // Mount once; point updates flow through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    controllerRef.current?.setPoints(points);
  }, [points]);

  const lastX = useRef(0);
  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    lastX.current = e.clientX;
    controllerRef.current?.grab();
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    controllerRef.current?.drag(e.clientX - lastX.current);
    lastX.current = e.clientX;
  };
  const onPointerEnd = (e: PointerEvent<HTMLCanvasElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    controllerRef.current?.release();
  };

  const label =
    points.length === 0
      ? 'Globe: no visitors online'
      : `Globe: visitors online in ${points.length} ${points.length === 1 ? 'city' : 'cities'}`;

  return (
    <div ref={hostRef} className={className}>
      <canvas
        ref={canvasRef}
        aria-label={label}
        className="block h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      />
    </div>
  );
}
