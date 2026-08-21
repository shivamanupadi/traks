import { useEffect, useRef, type ReactElement } from 'react';
import type { Globe, Marker } from 'cobe';
import type { LiveRealtimeLocation } from '@traks/shared';

interface RealtimeGlobeProps {
  locations: LiveRealtimeLocation[];
  className?: string;
}

// Porcelain palette as 0-1 RGB: land dots in warm gray, markers in mint,
// the glow fading into the page ground (#F9F8F6).
const LAND: [number, number, number] = [0.71, 0.7, 0.73];
const MINT: [number, number, number] = [0.157, 0.914, 0.624];
const GLOW: [number, number, number] = [0.976, 0.973, 0.965];

const IDLE_ROTATION_PER_FRAME = 0.0025;

/** Marker radius grows with the log of visitors so one city can't swallow the globe. */
function markerSize(visitors: number): number {
  return 0.035 + Math.min(Math.log2(visitors + 1) * 0.014, 0.07);
}

function toMarkers(locations: LiveRealtimeLocation[]): Marker[] {
  return locations.map(l => ({
    id: `${l.latitude}:${l.longitude}`,
    location: [l.latitude, l.longitude],
    size: markerSize(l.visitors),
  }));
}

/**
 * Slowly rotating dotted globe (cobe, WebGL) with a mint marker per active
 * city. Drag to spin; auto-rotation pauses while dragging and is disabled
 * under prefers-reduced-motion. cobe is imported lazily so it stays off the
 * dashboard's main chunk.
 */
export function RealtimeGlobe({ locations, className }: RealtimeGlobeProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const globeRef = useRef<Globe | null>(null);
  const phiRef = useRef(0.3);
  const pointerXRef = useRef<number | null>(null);
  const markersRef = useRef<Marker[]>(toMarkers(locations));

  useEffect(() => {
    markersRef.current = toMarkers(locations);
    globeRef.current?.update({ markers: markersRef.current });
  }, [locations]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let cancelled = false;
    let frame = 0;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const size = (): number => Math.max(1, Math.round(container.getBoundingClientRect().width));

    void import('cobe').then(({ default: createGlobe }) => {
      if (cancelled) return;
      const px = size();
      globeRef.current = createGlobe(canvas, {
        devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        width: px,
        height: px,
        phi: phiRef.current,
        theta: 0.18,
        dark: 0,
        diffuse: 1.1,
        scale: 1,
        mapSamples: 14000,
        mapBrightness: 4.5,
        mapBaseBrightness: 0,
        baseColor: LAND,
        markerColor: MINT,
        glowColor: GLOW,
        markerElevation: 0.02,
        markers: markersRef.current,
      });

      const render = (): void => {
        const globe = globeRef.current;
        if (!globe) return;
        if (!reduceMotion && pointerXRef.current === null) {
          phiRef.current += IDLE_ROTATION_PER_FRAME;
        }
        globe.update({ phi: phiRef.current });
        frame = requestAnimationFrame(render);
      };
      frame = requestAnimationFrame(render);
    });

    const observer = new ResizeObserver(() => {
      const px = size();
      globeRef.current?.update({ width: px, height: px });
    });
    observer.observe(container);

    return (): void => {
      cancelled = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      globeRef.current?.destroy();
      globeRef.current = null;
    };
  }, []);

  return (
    <div ref={containerRef} className={className}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={
          locations.length === 0
            ? 'Globe with no active visitors'
            : `Globe showing ${locations.length} active ${locations.length === 1 ? 'location' : 'locations'}`
        }
        className="block h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={e => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointerXRef.current = e.clientX;
        }}
        onPointerMove={e => {
          if (pointerXRef.current === null) return;
          phiRef.current += (e.clientX - pointerXRef.current) / 160;
          pointerXRef.current = e.clientX;
        }}
        onPointerUp={e => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          pointerXRef.current = null;
        }}
        onPointerCancel={() => {
          pointerXRef.current = null;
        }}
      />
    </div>
  );
}
