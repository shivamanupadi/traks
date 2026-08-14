import type { CSSProperties, ReactElement } from 'react';
import { Globe } from 'lucide-react';

/**
 * Site favicon (a data URL stored on the site row, fetched server-side at
 * save time) with the pre-favicon Globe glyph as fallback.
 */
export function SiteFavicon({
  favicon,
  size = 18,
  fallbackStyle,
  fallbackClassName,
}: {
  favicon?: string | null;
  size?: number;
  /** Passed to the Globe fallback (the tiles tint it per-tile). */
  fallbackStyle?: CSSProperties;
  fallbackClassName?: string;
}): ReactElement {
  if (!favicon) {
    return (
      <Globe
        style={{ width: size, height: size, ...fallbackStyle }}
        className={fallbackClassName}
        strokeWidth={1.7}
      />
    );
  }
  return (
    <img
      src={favicon}
      alt=""
      draggable={false}
      style={{ width: size, height: size }}
      className="rounded-[4px] object-contain"
    />
  );
}
