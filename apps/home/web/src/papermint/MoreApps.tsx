import { useState, type ReactElement } from 'react';
import { ArrowUpRight } from 'lucide-react';

const PAPERMINT_URL = 'https://papermint.studio';

/** Papermint Studio's released apps (papermint.studio/<slug>), with the one
 *  line each uses on the studio's home page. A new app needs an entry here;
 *  apps that are still "coming soon" stay out. */
const APPS: { slug: string; name: string; line: string }[] = [
  { slug: 'whittle', name: 'Whittle', line: 'Voice notes that write themselves as you talk' },
  { slug: 'keepers', name: 'Keepers', line: 'Tidy your photo library, one swipe at a time' },
  { slug: 'sketchy', name: 'Sketchy', line: 'Any idea, or any photo, becomes a coloring page' },
  { slug: 'lumen', name: 'Lumen', line: 'A fast photo viewer and editor for your folders' },
  { slug: 'pennybook', name: 'PennyBook', line: 'Track spending and net worth, privately' },
  { slug: 'porter', name: 'Porter', line: 'Real .local names for your dev servers' },
  { slug: 'almanac', name: 'Almanac', line: 'See which app is behind it' },
  { slug: 'roost', name: 'Roost', line: 'Your windows, back where they belong' },
  { slug: 'winnow', name: 'Winnow', line: 'Clear your Mac, keep a way back' },
  { slug: 'wren', name: 'Wren', line: 'Hold a key, talk, and it types' },
  { slug: 'sheaf', name: 'Sheaf', line: 'Every PDF tool you reach for, in one calm app' },
  { slug: 'tacet', name: 'Tacet', line: 'A clipboard manager that keeps your keys quiet' },
  { slug: 'lantern', name: 'Lantern', line: 'Every device on your network, in detail' },
  { slug: 'oriel', name: 'Oriel', line: 'Screenshots and recordings that stay on your Mac' },
];

/**
 * The strip above the landing header: one Papermint app, picked at random on
 * each page load, linking to its page. The tracker records the click as an
 * outbound link by itself.
 */
export function MoreApps(): ReactElement {
  const [app] = useState(() => APPS[Math.floor(Math.random() * APPS.length)]);
  return (
    <div className="relative z-10 border-b border-[#E6E4DE] bg-[#F2F1ED]">
      <div className="mx-auto flex h-9 w-full max-w-[1060px] items-center justify-center px-6">
        <a
          href={`${PAPERMINT_URL}/${app.slug}?ref=traks`}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex min-w-0 items-center gap-2.5 text-[12.5px] text-[#6E6C7C] transition-colors hover:text-[#3D3B4F]"
        >
          <span className="shrink-0 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#8C8A99]">
            <span className="sm:hidden">More from us</span>
            <span className="hidden sm:inline">More from the developers of Traks</span>
          </span>
          <img
            src={`${PAPERMINT_URL}/icons/${app.slug}.png`}
            alt=""
            width={18}
            height={18}
            className="h-[18px] w-[18px] shrink-0 rounded-[4px]"
          />
          <span className="shrink-0 font-semibold text-[#3D3B4F]">{app.name}</span>
          <span className="hidden truncate md:inline">{app.line}</span>
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[#9B9590] transition-colors group-hover:text-[#3D3B4F]" />
        </a>
      </div>
    </div>
  );
}
