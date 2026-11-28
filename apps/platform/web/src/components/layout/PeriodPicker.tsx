import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Sticker } from '@/components/ui/sticker';
import { dayDate, formatDay, rangeLabel } from '@/lib/days';
import { DateRangePanel } from './DateRangePanel';
import { isPreset, parseCustomPeriod, type Period, type PeriodParam } from '@traks/shared';

interface PeriodPickerProps {
  value: PeriodParam;
  onChange: (period: PeriodParam) => void;
  /** Offer the custom-range option (off on public share pages). */
  allowCustom?: boolean;
}

const PERIOD_OPTIONS: { label: string; value: Period }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: '7D', value: '7d' },
  { label: '30D', value: '30d' },
  { label: '90D', value: '90d' },
  { label: '6M', value: '6m' },
  { label: '1Y', value: '1y' },
  { label: 'All', value: 'all' },
];

/** Pill label below md: fits beside the toolbar at phone width. */
const PERIOD_SHORT: Record<Period, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  '6m': '6 months',
  '1y': '1 year',
  all: 'All time',
};

/** Full period names: the phone menu's options, and the dashboard's labels. */
export const PERIOD_NAMES: Record<Period, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '6m': 'Last 6 months',
  '1y': 'Last year',
  all: 'All time',
};

/** Display name for any period: the preset's name, or the custom range's days. */
export function periodLabel(period: PeriodParam): string {
  if (isPreset(period)) return PERIOD_NAMES[period];
  const custom = parseCustomPeriod(period);
  return custom ? rangeLabel(custom.from, custom.to) : PERIOD_NAMES.today;
}

/** Pill-sized custom label without the year: "3–15 Mar" within a month,
 *  "28 Feb – 3 Mar" across months, so it fits beside the site toolbar. */
function compactLabel(period: PeriodParam): string {
  const custom = parseCustomPeriod(period);
  if (!custom) return PERIOD_SHORT.today;
  if (custom.from === custom.to) return formatDay(custom.from, false);
  if (custom.from.slice(0, 7) === custom.to.slice(0, 7)) {
    const month = dayDate(custom.to).toLocaleDateString(undefined, { month: 'short' });
    return `${dayDate(custom.from).getDate()}–${dayDate(custom.to).getDate()} ${month}`;
  }
  return `${formatDay(custom.from, false)} – ${formatDay(custom.to, false)}`;
}

/** The range panel as a popover under the switch; closes on Escape or a
 *  press outside `anchor` (the switch and the popover). */
function RangePopover({
  anchor,
  onClose,
  children,
}: {
  anchor: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  children: ReactNode;
}): ReactElement {
  useEffect(() => {
    const press = (e: MouseEvent): void => {
      if (anchor.current && !anchor.current.contains(e.target as Node)) onClose();
    };
    const escape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', press);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', press);
      document.removeEventListener('keydown', escape);
    };
  }, [anchor, onClose]);

  return (
    <motion.div
      role="dialog"
      aria-label="Custom range"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12 }}
      className="absolute right-0 top-full z-50 mt-2 overflow-hidden rounded-[20px] bg-card shadow-float"
    >
      {children}
    </motion.div>
  );
}

/**
 * Floating pill segmented control; the active segment fills with ink. Below
 * md the eight segments don't fit beside the site toolbar, so the same pill
 * becomes a single button that opens a menu below it. The last segment opens
 * the range calendar (a popover here, a dialog from the phone menu); it
 * stays the same size while a range is active, so the switch never shifts
 * (the dashboard shows the range's days beside the chart).
 */
export function PeriodPicker({
  value,
  onChange,
  allowCustom = true,
}: PeriodPickerProps): ReactElement {
  const [customOpen, setCustomOpen] = useState<false | 'popover' | 'dialog'>(false);
  const closeCustom = useCallback(() => setCustomOpen(false), []);
  const applyCustom = (period: PeriodParam): void => {
    onChange(period);
    setCustomOpen(false);
  };
  const switchRef = useRef<HTMLDivElement>(null);
  const isCustom = !isPreset(value);
  const shortLabel = isPreset(value) ? PERIOD_SHORT[value] : compactLabel(value);

  // Desktop switch: the ink thumb slides under the selected segment. It is
  // measured from the segment itself, so labels of any width line up, and
  // re-measured when the track resizes (fonts loading).
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const place = (): void => {
      const on = track.querySelector<HTMLElement>('[data-on="true"]');
      setThumb(on ? { left: on.offsetLeft, width: on.offsetWidth } : null);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(track);
    return () => ro.disconnect();
  }, [value, allowCustom]);

  return (
    <>
      {/* Panels mount only while open, so each opening starts from the
          current value. */}
      <Dialog open={customOpen === 'dialog'} onOpenChange={open => !open && closeCustom()}>
        <DialogContent onClose={closeCustom} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Custom range</DialogTitle>
          </DialogHeader>
          <div className="px-5 pb-5 pt-2">
            <DateRangePanel value={value} onApply={applyCustom} onCancel={closeCustom} stacked />
          </div>
        </DialogContent>
      </Dialog>
      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Period"
            className="flex h-[36px] items-center gap-2 rounded-[10px] bg-muted pl-2.5 pr-3 text-[12.5px] font-semibold text-foreground cursor-pointer"
          >
            <Sticker name="calendar" className="h-[18px] w-[18px] max-[359px]:hidden" />
            <span className="whitespace-nowrap">{shortLabel}</span>
            <ChevronDown className="h-3.5 w-3.5 text-subtle" />
          </DropdownMenuTrigger>
          {/* Right-aligned under the pill; below 360px the pill wraps to the
              start of its row, so the menu opens rightward instead. */}
          <DropdownMenuContent
            align="end"
            className="w-48 rounded-2xl border-none bg-card p-1.5 shadow-float max-[359px]:left-0 max-[359px]:right-auto"
          >
            {PERIOD_OPTIONS.map(option => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => onChange(option.value)}
                className={cn(
                  'justify-between rounded-[10px] px-3 py-2.5 text-[13.5px] text-foreground',
                  value === option.value && 'bg-muted font-semibold'
                )}
              >
                {PERIOD_NAMES[option.value]}
                {value === option.value && <Check className="h-4 w-4 text-foreground" />}
              </DropdownMenuItem>
            ))}
            {allowCustom && (
              <DropdownMenuItem
                onClick={() => setCustomOpen('dialog')}
                className={cn(
                  'justify-between rounded-[10px] px-3 py-2.5 text-[13.5px] text-foreground',
                  isCustom && 'bg-muted font-semibold'
                )}
              >
                Custom range…
                {isCustom && <Check className="h-4 w-4 text-foreground" />}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div ref={switchRef} className="relative hidden md:block">
        <div ref={trackRef} className="relative inline-flex rounded-full bg-muted p-[3px]">
          {thumb && (
            <span
              aria-hidden
              className="absolute bottom-[3px] top-[3px] rounded-full bg-btn transition-[left,width] duration-300 ease-[cubic-bezier(.3,.7,.2,1)] motion-reduce:transition-none"
              style={{ left: thumb.left, width: thumb.width }}
            />
          )}
          {PERIOD_OPTIONS.map(option => (
            <button
              key={option.value}
              data-on={value === option.value}
              onClick={() => {
                onChange(option.value);
                closeCustom();
              }}
              className={cn(
                'relative z-[1] rounded-full px-[11px] py-1.5 text-[12.5px] transition-colors cursor-pointer',
                value === option.value
                  ? 'font-semibold text-white'
                  : 'font-medium text-muted-foreground hover:text-foreground'
              )}
            >
              {option.label}
            </button>
          ))}
          {allowCustom && (
            <button
              data-on={isCustom}
              onClick={() => setCustomOpen(open => (open === 'popover' ? false : 'popover'))}
              aria-expanded={customOpen === 'popover'}
              aria-label={isCustom ? `Custom range: ${periodLabel(value)}` : 'Custom range'}
              title={isCustom ? periodLabel(value) : 'Custom range'}
              className="relative z-[1] flex items-center rounded-full px-2 py-1 transition-colors cursor-pointer"
            >
              <Sticker name="calendar" className={cn('h-5 w-5', isCustom && 'text-white')} />
            </button>
          )}
        </div>
        {customOpen === 'popover' && (
          <RangePopover anchor={switchRef} onClose={closeCustom}>
            <DateRangePanel value={value} onApply={applyCustom} onCancel={closeCustom} />
          </RangePopover>
        )}
      </div>
    </>
  );
}
