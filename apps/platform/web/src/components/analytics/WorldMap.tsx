import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { LiveRealtimeLocation } from '@traks/shared';
import { cn } from '@/lib/utils';
import { countryName } from './CountryFlag';

interface WorldMapProps {
  locations: LiveRealtimeLocation[];
  /** Click-to-filter on a city marker. */
  onSelect?: (location: LiveRealtimeLocation) => void;
  className?: string;
}

interface Geometry {
  w: number;
  h: number;
  latMax: number;
  latMin: number;
  path: string;
}

/** Marker radius in viewBox units: log-scaled so one busy city stays legible. */
function radius(visitors: number): number {
  return 4 + Math.min(9, Math.log2(visitors + 1) * 2.2);
}

/**
 * Flat dotted world map with one mint marker per active city. The land dots
 * are a generated, self-hosted path (src/lib/worldmap-dots.ts) loaded lazily
 * so the dashboard bundle doesn't carry it; nothing is ever fetched from a
 * map provider. Equirectangular: x from longitude, y from latitude.
 */
export function WorldMap({ locations, onSelect, className }: WorldMapProps): ReactElement {
  const [geo, setGeo] = useState<Geometry | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import('@/lib/worldmap-dots').then(m => {
      if (cancelled) return;
      setGeo({
        w: m.WORLD_W,
        h: m.WORLD_H,
        latMax: m.WORLD_LAT_MAX,
        latMin: m.WORLD_LAT_MIN,
        path: m.WORLD_DOTS_PATH,
      });
    });
    return (): void => {
      cancelled = true;
    };
  }, []);

  const markers = useMemo(() => {
    if (!geo) return [];
    return (
      locations
        .filter(l => l.latitude <= geo.latMax && l.latitude >= geo.latMin)
        .map(l => ({
          loc: l,
          x: ((l.longitude + 180) / 360) * geo.w,
          y: ((geo.latMax - l.latitude) / (geo.latMax - geo.latMin)) * geo.h,
          r: radius(l.visitors),
        }))
        // Busiest first so smaller neighbours draw on top and stay clickable.
        .sort((a, b) => b.loc.visitors - a.loc.visitors)
    );
  }, [geo, locations]);

  const w = geo?.w ?? 1000;
  const h = geo?.h ?? 389;
  const hovered = hover !== null ? markers[hover] : undefined;

  return (
    <div
      className={cn('relative overflow-hidden rounded-[14px] bg-[#F9F8F6]', className)}
      style={{ aspectRatio: `${w} / ${h}` }}
    >
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="block h-full w-full"
        role="img"
        aria-label={
          markers.length === 0
            ? 'World map: no visitors online'
            : `World map: visitors online in ${markers.length} ${markers.length === 1 ? 'city' : 'cities'}`
        }
      >
        {geo ? (
          <path d={geo.path} fill="none" stroke="#CBC8D1" strokeWidth={2.3} strokeLinecap="round" />
        ) : null}
        {markers.map((m, i) => (
          <g
            key={`${m.loc.latitude}:${m.loc.longitude}:${m.loc.city}`}
            className={cn(onSelect && 'cursor-pointer')}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={onSelect ? () => onSelect(m.loc) : undefined}
          >
            <circle cx={m.x} cy={m.y} r={m.r + 7} fill="#28E99F" opacity={hover === i ? 0.34 : 0.2}>
              <title>
                {m.loc.city || countryName(m.loc.country)} · {m.loc.visitors}
              </title>
            </circle>
            <circle cx={m.x} cy={m.y} r={m.r} fill="#28E99F" stroke="#fff" strokeWidth={2} />
          </g>
        ))}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-[7px] bg-[#3D3B4F] px-2.5 py-1 text-[12px] font-semibold text-white shadow-float"
          style={{
            left: `${(hovered.x / w) * 100}%`,
            top: `${(hovered.y / h) * 100}%`,
          }}
        >
          {hovered.loc.city ? `${hovered.loc.city}, ` : ''}
          {countryName(hovered.loc.country)} · {hovered.loc.visitors}
        </div>
      )}
      {geo && markers.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[12px] text-[#B5B0AA]">
          Nobody&rsquo;s here right now
        </div>
      )}
    </div>
  );
}
