import { useMemo, useState, type ReactElement } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { dayCount, dayDate, formatDay, localToday, shiftDay, toDay, weekStart } from '@/lib/days';
import {
  CUSTOM_PERIOD_MIN_DATE,
  customPeriod,
  parseCustomPeriod,
  type PeriodParam,
} from '@traks/shared';

/** A month on screen; `m` is 0-based. */
interface Cursor {
  y: number;
  m: number;
}

/** The end a calendar click sets: the selected tile. */
type End = 'from' | 'to';

type Zoom = 'days' | 'months' | 'years';

const MIN_YEAR = Number(CUSTOM_PERIOD_MIN_DATE.slice(0, 4));

function monthStart(y: number, m: number): string {
  return toDay(new Date(y, m, 1));
}

function monthEnd(y: number, m: number): string {
  return toDay(new Date(y, m + 1, 0));
}

function cursorOf(day: string): Cursor {
  const d = dayDate(day);
  return { y: d.getFullYear(), m: d.getMonth() };
}

/** Quick ranges, all ending today or earlier. */
function quickRanges(today: string): { label: string; from: string; to: string }[] {
  const { y, m } = cursorOf(today);
  const q = Math.floor(m / 3) * 3;
  return [
    { label: 'This month', from: monthStart(y, m), to: today },
    { label: 'Last month', from: monthStart(y, m - 1), to: monthEnd(y, m - 1) },
    { label: 'This quarter', from: monthStart(y, q), to: today },
    { label: 'Last quarter', from: monthStart(y, q - 3), to: monthEnd(y, q - 1) },
    { label: 'Year to date', from: monthStart(y, 0), to: today },
    { label: 'Last year', from: monthStart(y - 1, 0), to: monthEnd(y - 1, 11) },
  ];
}

const NAV_BUTTON =
  'flex h-8 w-8 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:text-border-strong cursor-pointer';

const FOCUS_RING = 'outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--foreground)]';

/**
 * Range picker: quick ranges and a month calendar whose title zooms out to
 * months and years, so any day since 2000 is a few clicks away. The From and
 * To tiles show the two days (never text inputs); a day click sets the
 * selected tile only, and the selection moves only when the other tile is
 * clicked. Days that would put the range backwards are disabled, so the ends
 * never swap. Holds a draft until Apply. `stacked` (phones)
 * puts the quick ranges above the calendar instead of in a side rail.
 */
export function DateRangePanel({
  value,
  onApply,
  onCancel,
  stacked = false,
}: {
  value: PeriodParam;
  onApply: (period: PeriodParam) => void;
  onCancel: () => void;
  stacked?: boolean;
}): ReactElement {
  const today = localToday();
  const current = parseCustomPeriod(value);
  const [from, setFrom] = useState(current?.from ?? shiftDay(today, -6));
  const [to, setTo] = useState(current?.to ?? today);
  const [end, setEnd] = useState<End>('from');
  const [cursor, setCursor] = useState<Cursor>(() => cursorOf(current?.to ?? today));
  const [zoom, setZoom] = useState<Zoom>('days');
  const [hover, setHover] = useState<string | null>(null);

  const ws = useMemo(weekStart, []);
  const quick = useMemo(() => quickRanges(today), [today]);

  const inBounds = (day: string): boolean => day >= CUSTOM_PERIOD_MIN_DATE && day <= today;
  /** Days the selected end can take: on its side of the other end. */
  const allowed = (day: string): boolean =>
    inBounds(day) && (end === 'from' ? day <= to : day >= from);

  const apply = (): void => onApply(customPeriod(from, to));

  const pick = (day: string): void => {
    if (end === 'from') setFrom(day);
    else setTo(day);
  };

  /** A tile click selects that end and shows its month. */
  const select = (which: End): void => {
    setEnd(which);
    setCursor(cursorOf(which === 'from' ? from : to));
    setZoom('days');
  };

  const choose = (range: { from: string; to: string }): void => {
    setFrom(range.from);
    setTo(range.to);
    setCursor(cursorOf(range.to));
    setZoom('days');
  };

  // Hovering a day the selected end can take previews the range with it.
  const preview = hover && allowed(hover) ? hover : null;
  const lo = end === 'from' && preview ? preview : from;
  const hi = end === 'to' && preview ? preview : to;

  const atFirstMonth = cursor.y === MIN_YEAR && cursor.m === 0;
  const todayCursor = cursorOf(today);
  const atLastMonth = cursor.y === todayCursor.y && cursor.m === todayCursor.m;

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    // 2024-01-07 was a Sunday.
    new Date(2024, 0, 7 + ((ws + i) % 7)).toLocaleDateString(undefined, { weekday: 'narrow' })
  );
  const lead = (new Date(cursor.y, cursor.m, 1).getDay() - ws + 7) % 7;
  const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => toDay(new Date(cursor.y, cursor.m, i + 1))),
  ];
  const monthTitle = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  // Twelve years a page, the first page ending this year.
  const pageStart = todayCursor.y - 11 - 12 * Math.floor((todayCursor.y - cursor.y) / 12);

  const tile = (which: End): ReactElement => {
    const day = which === 'from' ? from : to;
    const next = end === which;
    return (
      <button
        type="button"
        onClick={() => select(which)}
        aria-label={`${which === 'from' ? 'From' : 'To'}: ${formatDay(day, true)}`}
        aria-pressed={next}
        className={cn(
          'min-w-0 flex-1 rounded-xl bg-muted px-3 py-2 text-left transition-shadow cursor-pointer',
          FOCUS_RING,
          next && 'shadow-[inset_0_0_0_1.5px_var(--foreground)]'
        )}
      >
        <span className="block text-[11px] font-semibold text-muted-foreground">
          {which === 'from' ? 'From' : 'To'}
        </span>
        <span className="block truncate text-[13.5px] font-semibold text-foreground">
          {formatDay(day, true)}
        </span>
      </button>
    );
  };

  const calendar = (
    <div className={cn('min-w-0', stacked ? 'px-1' : 'w-[316px] px-4 pt-4 pb-3')}>
      <div className="mb-3 flex items-center gap-2">
        {tile('from')}
        <span aria-hidden className="text-faint">
          →
        </span>
        {tile('to')}
      </div>

      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          aria-label={
            zoom === 'days'
              ? 'Previous month'
              : zoom === 'months'
                ? 'Previous year'
                : 'Earlier years'
          }
          className={cn(NAV_BUTTON, FOCUS_RING)}
          disabled={
            zoom === 'days'
              ? atFirstMonth
              : zoom === 'months'
                ? cursor.y <= MIN_YEAR
                : pageStart <= MIN_YEAR
          }
          onClick={() =>
            setCursor(c =>
              zoom === 'days'
                ? cursorOf(monthStart(c.y, c.m - 1))
                : { y: Math.max(MIN_YEAR, c.y - (zoom === 'months' ? 1 : 12)), m: c.m }
            )
          }
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={zoom === 'years'}
          onClick={() => setZoom(zoom === 'days' ? 'months' : 'years')}
          aria-label={
            zoom === 'days' ? `${monthTitle}, choose a month` : `${cursor.y}, choose a year`
          }
          className={cn(
            'rounded-[10px] px-2.5 py-1 text-[14px] font-semibold text-foreground transition-colors hover:bg-muted disabled:hover:bg-transparent cursor-pointer disabled:cursor-default',
            FOCUS_RING
          )}
        >
          {zoom === 'days'
            ? monthTitle
            : zoom === 'months'
              ? cursor.y
              : `${pageStart} – ${pageStart + 11}`}
        </button>
        <button
          type="button"
          aria-label={
            zoom === 'days' ? 'Next month' : zoom === 'months' ? 'Next year' : 'Later years'
          }
          className={cn(NAV_BUTTON, FOCUS_RING)}
          disabled={
            zoom === 'days'
              ? atLastMonth
              : zoom === 'months'
                ? cursor.y >= todayCursor.y
                : pageStart + 11 >= todayCursor.y
          }
          onClick={() =>
            setCursor(c =>
              zoom === 'days'
                ? cursorOf(monthStart(c.y, c.m + 1))
                : {
                    y: Math.min(todayCursor.y, c.y + (zoom === 'months' ? 1 : 12)),
                    m: c.m,
                  }
            )
          }
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {zoom === 'days' && (
        <div
          className="grid grid-cols-7 gap-y-0.5"
          onMouseLeave={() => setHover(null)}
          role="grid"
          aria-label={monthTitle}
        >
          {weekdays.map((w, i) => (
            <span
              key={i}
              className="flex h-6 items-center justify-center text-[11px] font-semibold text-muted-foreground"
            >
              {w}
            </span>
          ))}
          {cells.map((day, i) => {
            if (!day) return <span key={`b${i}`} />;
            const col = i % 7;
            const isEnd = day === lo || day === hi;
            const inBand = day >= lo && day <= hi && lo !== hi;
            const disabled = !allowed(day);
            return (
              <div
                key={day}
                className={cn(
                  'flex h-9 items-center justify-center',
                  inBand && 'bg-muted',
                  inBand && (day === lo || col === 0 || day.endsWith('-01')) && 'rounded-l-full',
                  inBand &&
                    (day === hi || col === 6 || day === monthEnd(cursor.y, cursor.m)) &&
                    'rounded-r-full'
                )}
              >
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(day)}
                  onMouseEnter={() => setHover(day)}
                  aria-label={dayDate(day).toLocaleDateString(undefined, { dateStyle: 'full' })}
                  aria-pressed={isEnd}
                  className={cn(
                    'flex h-[34px] w-[34px] items-center justify-center rounded-full text-[13px] tabular-nums transition-colors cursor-pointer',
                    FOCUS_RING,
                    isEnd
                      ? 'bg-btn font-semibold text-white'
                      : disabled
                        ? 'cursor-default text-faint'
                        : 'text-foreground hover:bg-border',
                    day === today && !isEnd && 'font-semibold shadow-[inset_0_0_0_1.5px_#28E99F]'
                  )}
                >
                  {Number(day.slice(8))}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {zoom === 'months' && (
        <div className="grid grid-cols-3 gap-1.5 py-1">
          {Array.from({ length: 12 }, (_, m) => {
            const disabled = monthStart(cursor.y, m) > today;
            const holds =
              !!from && !!to && monthEnd(cursor.y, m) >= from && monthStart(cursor.y, m) <= to;
            return (
              <button
                key={m}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setCursor({ y: cursor.y, m });
                  setZoom('days');
                }}
                className={cn(
                  'h-11 rounded-full text-[13px] transition-colors cursor-pointer',
                  FOCUS_RING,
                  disabled
                    ? 'cursor-default text-faint'
                    : holds
                      ? 'bg-muted font-semibold text-foreground hover:bg-border'
                      : 'text-foreground hover:bg-muted'
                )}
              >
                {new Date(cursor.y, m, 1).toLocaleDateString(undefined, { month: 'short' })}
              </button>
            );
          })}
        </div>
      )}

      {zoom === 'years' && (
        <div className="grid grid-cols-3 gap-1.5 py-1">
          {Array.from({ length: 12 }, (_, i) => {
            const y = pageStart + i;
            const disabled = y > todayCursor.y || y < MIN_YEAR;
            const holds = !!from && !!to && `${y}` >= from.slice(0, 4) && `${y}` <= to.slice(0, 4);
            return (
              <button
                key={y}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setCursor({
                    y,
                    m: y === todayCursor.y ? Math.min(cursor.m, todayCursor.m) : cursor.m,
                  });
                  setZoom('months');
                }}
                className={cn(
                  'h-11 rounded-full text-[13px] tabular-nums transition-colors cursor-pointer',
                  FOCUS_RING,
                  disabled
                    ? 'cursor-default text-faint'
                    : holds
                      ? 'bg-muted font-semibold text-foreground hover:bg-border'
                      : 'text-foreground hover:bg-muted'
                )}
              >
                {y}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const quickList = quick.map(range => {
    const on = range.from === from && range.to === to;
    return (
      <button
        key={range.label}
        type="button"
        onClick={() => choose(range)}
        className={cn(
          'text-[13px] text-foreground transition-colors cursor-pointer',
          FOCUS_RING,
          stacked
            ? cn(
                'rounded-full border px-3 py-1.5',
                on ? 'border-foreground font-semibold' : 'border-border hover:bg-muted'
              )
            : cn(
                'rounded-[10px] px-2.5 py-2 text-left',
                on ? 'bg-muted font-semibold' : 'hover:bg-muted'
              )
        )}
      >
        {range.label}
      </button>
    );
  });

  return (
    <div className="flex flex-col">
      {stacked ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5">{quickList}</div>
          {calendar}
        </div>
      ) : (
        <div className="flex">
          <div className="flex w-[148px] flex-col gap-0.5 border-r border-muted px-2 py-3">
            {quickList}
          </div>
          {calendar}
        </div>
      )}
      <div
        className={cn(
          'flex items-center justify-between gap-3 border-t border-muted',
          stacked ? 'mt-3 pt-4' : 'px-4 py-3'
        )}
      >
        <div className="min-w-0 text-[12.5px] text-muted-foreground">
          <p>
            {dayCount(from, to)} {dayCount(from, to) === 1 ? 'day' : 'days'} · pick a day for{' '}
            {end === 'from' ? 'From' : 'To'}
          </p>
          <p className="text-[11.5px] text-subtle">
            Both days included, in the site&apos;s timezone.
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button variant="ghost" onClick={onCancel} className="rounded-xl text-[13px]">
            Cancel
          </Button>
          <Button onClick={apply} className="rounded-xl text-[13px]">
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
