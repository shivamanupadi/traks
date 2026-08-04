import { useState, useRef, useEffect, useMemo, type ReactElement } from 'react';
import { ChevronDown, Search, Check, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

// Full IANA zone list where the browser provides it; small static fallback
// otherwise. The current value is merged in so it's always selectable.
function allTimezones(current: string): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf?.('timeZone') ?? [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Berlin',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
  ];
  return current && !supported.includes(current) ? [current, ...supported] : supported;
}

function offsetLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    return parts.find(p => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/** Searchable IANA timezone combobox. */
export function TimezoneSelect({
  value,
  onChange,
  placeholder = 'Select timezone',
  className,
}: {
  value: string;
  onChange: (tz: string) => void;
  placeholder?: string;
  className?: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Offsets are computed once per mount (~400 Intl instantiations); lazy so
  // closed pickers cost nothing.
  const zones = useMemo(
    () => (open ? allTimezones(value).map(tz => ({ tz, offset: offsetLabel(tz) })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replaceAll(' ', '_');
    if (!q) return zones;
    return zones.filter(
      z =>
        z.tz.toLowerCase().includes(q) ||
        z.offset.toLowerCase().includes(query.trim().toLowerCase())
    );
  }, [zones, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    searchRef.current?.focus();
    const onClickOutside = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  const select = (tz: string): void => {
    onChange(tz);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex h-11 w-full items-center justify-between gap-2 rounded-2xl border-none bg-white px-4 text-[14px] text-[#3D3B4F] shadow-[inset_0_0_0_1px_var(--input)] transition-shadow hover:shadow-[inset_0_0_0_1px_#C7C6D2] focus:shadow-[inset_0_0_0_1.5px_var(--ring)] focus:outline-none cursor-pointer"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 truncate">
          <Globe className="h-4 w-4 shrink-0 text-[#9B9590]" strokeWidth={1.7} />
          {value ? (
            <span className="truncate">
              {value.replaceAll('_', ' ')}
              <span className="ml-2 text-[12px] text-[#B5B0AA]">
                {open ? '' : offsetLabel(value)}
              </span>
            </span>
          ) : (
            <span className="text-[#B5B0AA]">{placeholder}</span>
          )}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-[#9B9590] transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border-none bg-white shadow-float-lg">
          <div className="flex items-center gap-2 border-b border-[#e6e5ea]/60 px-3.5 py-2.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-[#B5B0AA]" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && filtered.length > 0) select(filtered[0].tz);
              }}
              placeholder="Search timezones…"
              className="w-full bg-transparent text-[13px] text-[#3D3B4F] placeholder:text-[#B5B0AA] focus:outline-none"
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3.5 py-3 text-[13px] text-[#B5B0AA]">No timezones match</li>
            ) : (
              filtered.map(z => (
                <li key={z.tz} role="option" aria-selected={z.tz === value}>
                  <button
                    type="button"
                    onClick={() => select(z.tz)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[13px] transition-colors cursor-pointer',
                      z.tz === value
                        ? 'bg-muted text-[#3D3B4F] font-medium'
                        : 'text-[#3D3B4F] hover:bg-muted/70'
                    )}
                  >
                    <span className="flex items-center gap-2 truncate">
                      {z.tz === value && <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />}
                      <span className={cn('truncate', z.tz !== value && 'pl-[22px]')}>
                        {z.tz.replaceAll('_', ' ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] tabular-nums text-[#B5B0AA]">
                      {z.offset}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
