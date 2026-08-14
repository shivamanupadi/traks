import type { ReactElement } from 'react';
import type { IconType } from 'react-icons';
import {
  FaChrome,
  FaFirefoxBrowser,
  FaSafari,
  FaEdge,
  FaOpera,
  FaInternetExplorer,
  FaWindows,
  FaApple,
  FaAndroid,
  FaLinux,
} from 'react-icons/fa';
import { SiBrave, SiVivaldi, SiSamsung } from 'react-icons/si';
import { Globe, Monitor, Smartphone, Tablet, Laptop, type LucideIcon } from 'lucide-react';

// Keys mirror the closed vocabularies emitted by the collect worker's UA
// parser (apps/platform/collect/src/lib/ua.ts) plus the screen-size buckets.
const BROWSER_ICONS: Record<string, IconType> = {
  chrome: FaChrome,
  firefox: FaFirefoxBrowser,
  safari: FaSafari,
  edge: FaEdge,
  opera: FaOpera,
  brave: SiBrave,
  vivaldi: SiVivaldi,
  ie: FaInternetExplorer,
  'samsung internet': SiSamsung,
};

const OS_ICONS: Record<string, IconType> = {
  windows: FaWindows,
  macos: FaApple,
  ios: FaApple,
  android: FaAndroid,
  linux: FaLinux,
  'chrome os': FaChrome,
};

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
  const Icon = (kind === 'browser' ? BROWSER_ICONS : OS_ICONS)[key];
  if (!Icon) return <Globe className="h-3.5 w-3.5 text-[#B5B0AA]" strokeWidth={1.7} />;
  return <Icon className="h-3.5 w-3.5 text-[#6E6C7C]" />;
}
