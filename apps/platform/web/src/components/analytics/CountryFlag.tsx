import { useState, type ReactElement } from 'react';
import { Globe } from 'lucide-react';

/** Normalize to a lowercase ISO alpha-2 code, or null when it isn't a real
 *  country (Cloudflare emits 'XX'/'T1' for unknown/Tor — no flag exists). */
function flagCode(code?: string | null): string | null {
  if (!code || !/^[A-Za-z]{2}$/.test(code) || code.toUpperCase() === 'XX') return null;
  return code.toLowerCase();
}

const regionNames =
  typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

/** ISO alpha-2 code -> English country name, falling back to the code itself. */
export function countryName(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return code;
  try {
    return regionNames?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/**
 * SVG flag for a country code (flag-icons assets copied to /flags at build
 * time), with a globe fallback for unknown codes or a missing asset.
 */
export function CountryFlag({ code }: { code?: string | null }): ReactElement {
  const cc = flagCode(code);
  const [failedCode, setFailedCode] = useState<string | null>(null);
  if (!cc || failedCode === cc) {
    return <Globe className="h-3.5 w-3.5 text-[#B5B0AA]" strokeWidth={1.7} />;
  }
  return (
    <img
      src={`/flags/${cc}.svg`}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setFailedCode(cc)}
      className="h-3.5 w-[18px] rounded-[2px] object-cover shadow-[0_0_0_1px_rgba(61,59,79,0.08)]"
    />
  );
}
