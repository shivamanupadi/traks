import type { ReactElement } from 'react';
import { Globe, Monitor, Smartphone, Tablet, Laptop, type LucideIcon } from 'lucide-react';

// Original full-color brand logos, vendored into public/icons (browsers from
// alrra/browser-logos, OS from operating-system-logos - both MIT). Keys
// mirror the closed vocabularies emitted by the collect worker's UA parser
// (apps/platform/collect/src/lib/ua.ts).
const BROWSER_ICONS: Record<string, string> = {
  chrome: 'chrome.svg',
  firefox: 'firefox.svg',
  safari: 'safari.svg',
  edge: 'edge.svg',
  opera: 'opera.svg',
  brave: 'brave.svg',
  vivaldi: 'vivaldi.svg',
  ie: 'ie.png',
  'samsung internet': 'samsung-internet.svg',
};

const OS_ICONS: Record<string, string> = {
  windows: 'windows.png',
  macos: 'macos.png',
  ios: 'ios.png',
  android: 'android.png',
  linux: 'linux.png',
  'chrome os': 'chrome-os.png',
};

// Device types and screen-size buckets have no brand mark - the neutral
// outline glyphs stay.
const DEVICE_ICONS: Record<string, LucideIcon> = {
  desktop: Monitor,
  laptop: Laptop,
  tablet: Tablet,
  mobile: Smartphone,
};

/** Icon for a Devices-panel row (browser / os / device type / screen size),
 *  with a globe fallback for 'Other'/unknown values. */
export function DimensionIcon({
  kind,
  name,
}: {
  kind: 'browser' | 'os' | 'device' | 'size';
  name: string;
}): ReactElement {
  const key = name.toLowerCase();
  if (kind === 'device' || kind === 'size') {
    const Icon = DEVICE_ICONS[key] ?? Monitor;
    return <Icon className="h-3.5 w-3.5 text-[#6E6C7C]" strokeWidth={1.7} />;
  }
  const file = (kind === 'browser' ? BROWSER_ICONS : OS_ICONS)[key];
  if (!file) return <Globe className="h-3.5 w-3.5 text-[#B5B0AA]" strokeWidth={1.7} />;
  return (
    <img
      src={`/icons/${file}`}
      alt=""
      loading="lazy"
      draggable={false}
      className="h-3.5 w-3.5 object-contain"
    />
  );
}
