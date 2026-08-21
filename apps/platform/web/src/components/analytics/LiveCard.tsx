import type { ReactElement, ReactNode } from 'react';
import { cn, formatNumber } from '@/lib/utils';
import type { RealtimeState } from '@/lib/useRealtime';
import { RealtimeGlobe } from './RealtimeGlobe';
import { CountryFlag, countryName } from './CountryFlag';

interface LiveCardProps {
  realtime: RealtimeState;
  /** Click-to-filter on an active page. */
  onPageClick?: (path: string) => void;
}

const ROWS = 5;

function LiveList({
  header,
  rows,
}: {
  header: string;
  rows: { key: string; label: ReactNode; visitors: number; onClick?: () => void }[];
}): ReactElement {
  const max = rows.length > 0 ? Math.max(...rows.map(r => r.visitors)) : 1;
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-[#B5B0AA]">
        <span>{header}</span>
        <span>Visitors</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-2.5 py-2 text-[12.5px] text-[#B5B0AA]">—</p>
      ) : (
        <div className="space-y-1">
          {rows.map(row => {
            const Row = row.onClick ? 'button' : 'div';
            return (
              <Row
                key={row.key}
                onClick={row.onClick}
                className={cn(
                  'relative flex h-[30px] w-full items-center justify-between rounded-md px-2.5',
                  row.onClick && 'cursor-pointer transition-colors hover:bg-muted'
                )}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-md bg-mint/15"
                  style={{ width: `${(row.visitors / max) * 100}%` }}
                />
                <span className="relative z-10 flex min-w-0 items-center gap-2 truncate pr-4 text-[13px] text-[#3D3B4F]">
                  {row.label}
                </span>
                <span className="relative z-10 w-10 shrink-0 text-right text-[13px] font-medium tabular-nums text-[#3D3B4F]">
                  {formatNumber(row.visitors)}
                </span>
              </Row>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * "Right now" card: the realtime globe beside the live visitor count, the
 * pages they're on and where they are. Fed by useRealtime (WebSocket push,
 * polling fallback) - the status chip says which.
 */
export function LiveCard({ realtime, onPageClick }: LiveCardProps): ReactElement {
  const { data, status } = realtime;
  const count = data?.currentVisitors ?? null;
  const pages = (data?.topPages ?? []).slice(0, ROWS);
  const locations = (data?.locations ?? []).slice(0, ROWS);

  return (
    <div className="rounded-[20px] bg-white p-6 shadow-float">
      <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
        <RealtimeGlobe
          locations={data?.locations ?? []}
          className="mx-auto aspect-square w-full max-w-[240px]"
        />

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[15px] font-bold tracking-[-0.01em] text-[#3D3B4F]">Right now</h3>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border border-[#E6E4DE] px-2.5 py-1 text-[11px] font-semibold',
                status === 'live' ? 'text-[#3F7A50]' : 'text-[#9B9590]'
              )}
              title={
                status === 'live'
                  ? 'Updates are pushed the moment a visitor arrives'
                  : 'Refreshing every 30 seconds'
              }
            >
              <span className="relative flex h-[7px] w-[7px]">
                {status === 'live' && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60 motion-reduce:animate-none" />
                )}
                <span
                  className={cn(
                    'relative inline-flex h-[7px] w-[7px] rounded-full',
                    status === 'live' ? 'bg-mint' : 'bg-[#B5B0AA]'
                  )}
                />
              </span>
              {status === 'live' ? 'Live' : 'Every 30s'}
            </span>
          </div>

          <div className="mt-2 flex items-baseline gap-2">
            {count === null ? (
              <div className="h-10 w-20 animate-pulse rounded bg-muted" />
            ) : (
              <span className="text-[40px] font-bold leading-none tracking-[-0.03em] tabular-nums text-[#3D3B4F]">
                {formatNumber(count)}
              </span>
            )}
            <span className="text-[13px] text-[#9B9590]">
              {count === 1 ? 'visitor' : 'visitors'} in the last 5 minutes
            </span>
          </div>

          {count === 0 ? (
            <p className="mt-4 text-[13px] text-[#9B9590]">
              Nobody&rsquo;s here right now. The globe lights up the moment someone arrives.
            </p>
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
              <LiveList
                header="Active pages"
                rows={pages.map(p => ({
                  key: p.path,
                  label: <span className="truncate">{p.path || '/'}</span>,
                  visitors: p.visitors,
                  onClick: onPageClick && p.path ? () => onPageClick(p.path) : undefined,
                }))}
              />
              <LiveList
                header="Locations"
                rows={locations.map(l => ({
                  key: `${l.latitude}:${l.longitude}:${l.city}`,
                  label: (
                    <>
                      <CountryFlag code={l.country} />
                      <span className="truncate">
                        {l.city || countryName(l.country) || 'Unknown'}
                        {l.city && l.country && (
                          <span className="text-[#9B9590]">, {countryName(l.country)}</span>
                        )}
                      </span>
                    </>
                  ),
                  visitors: l.visitors,
                }))}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
