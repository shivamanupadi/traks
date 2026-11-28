import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { AlertCircle, ArrowLeft, Check, ChevronDown } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface PathRow {
  name: string;
  sessions: number;
}

/** Visits to the page in the middle, and how many started or ended there. */
export interface PathTotals {
  visits: number;
  entered: number;
  exited: number;
}

interface SideState {
  rows: PathRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
}

interface PageFlowPanelProps {
  /** The page in the middle, or null while there is nothing to pick yet. */
  page: string | null;
  /** Pages offered by the picker (the period's top pages). */
  pages: string[];
  /** Totals for `page`; undefined while loading. */
  totals?: PathTotals;
  onSelect: (page: string) => void;
  prev: SideState;
  next: SideState;
  className?: string;
}

// Connector strokes: ink at low opacity, darker for the hovered row.
const LINE = 'color-mix(in srgb, var(--foreground) 14%, transparent)';
const LINE_HOT = 'color-mix(in srgb, var(--foreground) 42%, transparent)';

function share(n: number, total: number | undefined): string {
  return total ? `${Math.round((n / total) * 100)}%` : '';
}

/** One side of the flow. Rows are buttons: picking one moves it to the middle,
 *  following the path a step further. From md, "came from" rows align toward
 *  the middle card and lines join each row to it; below md the sides stack
 *  and rows show a share bar instead. */
function FlowSide({
  label,
  side,
  towardRight,
  emptyText,
  total,
  hot,
  onHover,
  onSelect,
  rowRefs,
}: {
  label: string;
  side: SideState;
  towardRight: boolean;
  emptyText: string;
  total: number | undefined;
  hot: string | null;
  onHover: (name: string | null) => void;
  onSelect: (page: string) => void;
  rowRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>;
}): ReactElement {
  const max = side.rows && side.rows.length > 0 ? side.rows[0].sessions : 1;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span
        className={cn(
          'px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-faint',
          towardRight && 'md:text-right'
        )}
      >
        {label}
      </span>
      {side.isError ? (
        <p className="flex items-center gap-1.5 px-2.5 py-3 text-[12.5px] text-[#e07a5f]">
          <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
          Couldn&rsquo;t load
        </p>
      ) : side.isLoading || !side.rows ? (
        [90, 68, 50, 36, 24].map(w => (
          <div
            key={w}
            className={cn(
              'h-[30px] animate-pulse rounded-md bg-muted',
              towardRight && 'md:ml-auto'
            )}
            style={{ width: `${w}%` }}
          />
        ))
      ) : side.rows.length === 0 ? (
        <p className={cn('px-2.5 py-3 text-[12.5px] text-subtle', towardRight && 'md:text-right')}>
          {emptyText}
        </p>
      ) : (
        side.rows.map(row => (
          <button
            key={row.name}
            ref={el => {
              if (el) rowRefs.current.set(row.name, el);
              else rowRefs.current.delete(row.name);
            }}
            onClick={() => onSelect(row.name)}
            onMouseEnter={() => onHover(row.name)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(row.name)}
            onBlur={() => onHover(null)}
            title={`Follow to ${row.name}`}
            className={cn(
              'relative flex h-[30px] w-full items-center justify-between gap-3 rounded-md px-2.5 text-left transition-colors hover:bg-border cursor-pointer',
              hot === row.name && 'bg-muted',
              towardRight && 'md:flex-row-reverse md:text-right'
            )}
          >
            {/* Share bar on phones; from md the connector line shows it. */}
            <span
              className="absolute inset-y-0 left-0 rounded-md bg-muted md:hidden"
              style={{ width: `${(row.sessions / max) * 100}%` }}
            />
            <span className="relative z-10 min-w-0 truncate text-[13px] text-foreground">
              {row.name}
            </span>
            <span className="relative z-10 flex shrink-0 items-baseline gap-2 tabular-nums">
              <span className="text-[13px] font-medium text-foreground">
                {formatNumber(row.sessions)}
              </span>
              <span className="w-8 text-right text-[12px] text-subtle">
                {share(row.sessions, total)}
              </span>
            </span>
          </button>
        ))
      )}
    </div>
  );
}

/** The page in the middle: its visits and how they split. Continued and left
 *  partition the visits (the meter); started here overlaps both, so it is a
 *  line of its own. */
function PageCard({ page, totals }: { page: string; totals?: PathTotals }): ReactElement {
  const continued = totals ? Math.max(0, totals.visits - totals.exited) : 0;
  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-[16px] bg-btn p-4 text-white">
      <span className="truncate text-[13.5px] font-semibold" title={page}>
        {page}
      </span>
      {totals ? (
        <>
          <span className="flex items-baseline gap-1.5">
            <span className="text-[24px] font-bold leading-none tabular-nums">
              {formatNumber(totals.visits)}
            </span>
            <span className="text-[11.5px] text-[#D8D5CD]">visits</span>
          </span>
          {totals.visits > 0 && (
            <span className="flex h-1.5 overflow-hidden rounded-full bg-white/15" aria-hidden>
              <span
                className="h-full bg-[#28E99F]"
                style={{ width: `${(continued / totals.visits) * 100}%` }}
              />
              <span
                className="h-full bg-[#e07a5f]"
                style={{ width: `${(totals.exited / totals.visits) * 100}%` }}
              />
            </span>
          )}
          <span className="flex flex-col gap-1 text-[12px] tabular-nums text-[#D8D5CD]">
            <span className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#28E99F]" />
                Continued
              </span>
              <span className="font-semibold text-white">{share(continued, totals.visits)}</span>
            </span>
            <span className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#e07a5f]" />
                Left the site
              </span>
              <span className="font-semibold text-white">
                {share(totals.exited, totals.visits)}
              </span>
            </span>
            <span className="flex items-center justify-between gap-2">
              <span className="pl-3">Started here</span>
              <span className="font-semibold text-white">
                {share(totals.entered, totals.visits)}
              </span>
            </span>
          </span>
        </>
      ) : (
        <span className="h-[72px] animate-pulse rounded-lg bg-white/10" />
      )}
    </div>
  );
}

/**
 * Page flow: where visits came from right before a page, and where they went
 * right after it, counted in visits. Pick the page from the picker, or click a
 * page on either side to make it the middle; the trail and Back retrace the
 * steps taken that way.
 */
export function PageFlowPanel({
  page,
  pages,
  totals,
  onSelect,
  prev,
  next,
  className,
}: PageFlowPanelProps): ReactElement {
  // Pages left behind by following a row, oldest first. Picking a page from
  // the menu starts a new trail.
  const [trail, setTrail] = useState<string[]>([]);
  const [hot, setHot] = useState<{ side: 'prev' | 'next'; name: string } | null>(null);
  // The page this card last asked for. Any other change of `page` (a page
  // filter, a new period's top page) makes the trail stale, so it resets.
  const requested = useRef(page);
  useEffect(() => {
    if (page !== requested.current) setTrail([]);
    requested.current = page;
  }, [page]);
  const go = (to: string): void => {
    requested.current = to;
    setHot(null);
    onSelect(to);
  };
  const follow = (to: string): void => {
    if (page) setTrail(t => [...t, page]);
    go(to);
  };
  const jumpBack = (index: number): void => {
    const to = trail[index];
    setTrail(t => t.slice(0, index));
    go(to);
  };
  const pick = (to: string): void => {
    setTrail([]);
    go(to);
  };

  // The selected page stays in the picker even when it isn't a top page
  // (reached by following a path).
  const options = page && !pages.includes(page) ? [page, ...pages] : pages;

  // Connector lines, from md: measured from each row to the middle card and
  // redrawn when the layout changes. Stroke width is the row's share.
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const prevRefs = useRef(new Map<string, HTMLButtonElement>());
  const nextRefs = useRef(new Map<string, HTMLButtonElement>());
  const [lines, setLines] = useState<
    { key: string; side: 'prev' | 'next'; name: string; d: string; w: number }[]
  >([]);
  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    const card = cardRef.current;
    if (!wrap || !card || !window.matchMedia('(min-width: 768px)').matches) {
      setLines([]);
      return;
    }
    const box = wrap.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const cy = c.top + c.height / 2 - box.top;
    const visits = totals?.visits || 0;
    const out: typeof lines = [];
    const add = (side: 'prev' | 'next', rows: PathRow[] | undefined): void => {
      for (const row of rows ?? []) {
        const el = (side === 'prev' ? prevRefs : nextRefs).current.get(row.name);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const x1 = side === 'prev' ? r.right - box.left : r.left - box.left;
        const x2 = side === 'prev' ? c.left - box.left : c.right - box.left;
        const y1 = r.top + r.height / 2 - box.top;
        const mid = (x1 + x2) / 2;
        out.push({
          key: `${side}:${row.name}`,
          side,
          name: row.name,
          d: `M${x1},${y1} C${mid},${y1} ${mid},${cy} ${x2},${cy}`,
          w: visits ? Math.max(1.5, Math.min(22, (row.sessions / visits) * 26)) : 1.5,
        });
      }
    };
    add('prev', prev.rows);
    add('next', next.rows);
    setLines(out);
  }, [prev.rows, next.rows, totals?.visits]);

  useLayoutEffect(() => {
    measure();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [measure, page]);

  return (
    <div className={cn('rounded-[20px] bg-card p-5 shadow-float sm:p-6', className)}>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <h3 className="text-[15px] font-bold tracking-[-0.01em] text-foreground">Page flow</h3>
        {options.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex max-w-full items-center gap-1.5 rounded-full border border-border py-1 pl-3 pr-2 text-[13px] font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer sm:max-w-[20rem]">
              <span className="truncate">{page ?? 'Pick a page'}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-subtle" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-80 w-72 max-w-[calc(100vw-3rem)] overflow-y-auto border-0 p-1.5 shadow-float-lg"
            >
              <p className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
                Show flow for
              </p>
              {options.map(p => (
                <DropdownMenuItem
                  key={p}
                  onClick={() => pick(p)}
                  className={cn(
                    'gap-2 rounded-[10px] px-2.5 py-2 hover:bg-muted focus:bg-muted',
                    p === page && 'bg-muted'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{p}</span>
                  {p === page && <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {trail.length > 0 && (
          <nav aria-label="Pages followed" className="flex min-w-0 flex-wrap items-center gap-1">
            <button
              onClick={() => jumpBack(trail.length - 1)}
              className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[12px] font-medium text-foreground hover:bg-border transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-3 w-3" strokeWidth={2} />
              Back
            </button>
            {trail.map((p, i) => (
              <span key={`${p}:${i}`} className="flex min-w-0 items-center gap-1">
                <button
                  onClick={() => jumpBack(i)}
                  title={`Back to ${p}`}
                  className="max-w-[10rem] truncate rounded-md px-1.5 py-0.5 text-[12px] text-subtle hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  {p}
                </button>
                <span className="text-[11px] text-faint">›</span>
              </span>
            ))}
            <span className="max-w-[10rem] truncate px-1.5 text-[12px] font-semibold text-foreground">
              {page}
            </span>
          </nav>
        )}
      </div>

      {page === null ? (
        <p className="py-10 text-center text-[13px] text-subtle">No pageviews in this period yet</p>
      ) : (
        // Phones and small tablets stack the three parts; from md the page
        // card sits between its two sides with lines to each row.
        <div ref={wrapRef} className="relative">
          <svg
            className="pointer-events-none absolute inset-0 hidden h-full w-full overflow-visible md:block"
            aria-hidden
          >
            {lines.map(l => (
              <path
                key={l.key}
                d={l.d}
                fill="none"
                strokeLinecap="round"
                strokeWidth={l.w}
                stroke={hot && hot.side === l.side && hot.name === l.name ? LINE_HOT : LINE}
                className="transition-[stroke] duration-150"
              />
            ))}
          </svg>
          <div className="relative grid grid-cols-1 items-center gap-4 md:grid-cols-[minmax(0,1fr)_200px_minmax(0,1fr)] md:gap-x-14">
            <FlowSide
              label="Came from"
              side={prev}
              towardRight
              emptyText="No page before this one"
              total={totals?.visits}
              hot={hot?.side === 'prev' ? hot.name : null}
              onHover={name => setHot(name ? { side: 'prev', name } : null)}
              onSelect={follow}
              rowRefs={prevRefs}
            />
            <div ref={cardRef} className="min-w-0">
              <PageCard page={page} totals={totals} />
            </div>
            <FlowSide
              label="Went to"
              side={next}
              towardRight={false}
              emptyText="No page after this one"
              total={totals?.visits}
              hot={hot?.side === 'next' ? hot.name : null}
              onHover={name => setHot(name ? { side: 'next', name } : null)}
              onSelect={follow}
              rowRefs={nextRefs}
            />
          </div>
        </div>
      )}
    </div>
  );
}
