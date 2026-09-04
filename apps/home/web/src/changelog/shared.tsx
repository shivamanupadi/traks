import { useEffect, useState, type ReactElement, type ReactNode } from 'react';

/**
 * Release notes as published by installer/upload-release.mjs from
 * CHANGELOG.md (see installer/changelog.mjs for the shape). Bullets are plain
 * text with `code` spans; nothing else is rendered as markup.
 */
export interface ReleaseEntry {
  version: string;
  date: string;
  sections: Record<'added' | 'changed' | 'fixed' | 'breaking', string[]>;
}

const SECTION_ORDER: { key: keyof ReleaseEntry['sections']; label: string; tone: string }[] = [
  { key: 'breaking', label: 'Breaking', tone: 'bg-[#F7DCD4] text-[#8F3B2C]' },
  { key: 'added', label: 'Added', tone: 'bg-[#DDEFE6] text-[#2F6B4F]' },
  { key: 'changed', label: 'Changed', tone: 'bg-[#EEEEF2] text-[#3D3B4F]' },
  { key: 'fixed', label: 'Fixed', tone: 'bg-[#EDEAF7] text-[#4F4A78]' },
];

/** Fetches the published changelog once; `null` while loading, `[]` when none is published.
 *  Cache-busted: the endpoint is edge-cached for five minutes, and a release
 *  page that lags a release by five minutes reads as broken. */
export function useChangelog(): ReleaseEntry[] | null {
  const [entries, setEntries] = useState<ReleaseEntry[] | null>(null);
  useEffect(() => {
    void fetch(`/api/deploy/changelog?bust=${Date.now()}`)
      .then(r => (r.ok ? (r.json() as Promise<{ data: ReleaseEntry[] }>) : { data: [] }))
      .then(({ data }) => setEntries(Array.isArray(data) ? data : []))
      .catch(() => setEntries([]));
  }, []);
  return entries;
}

/** Numeric semver compare: negative when a < b. Non-numeric parts sort as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => Number(n) || 0);
  const pb = b.split('.').map(n => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Entries newer than `from` (exclusive) up to and including `to`. */
export function entriesBetween(
  entries: ReleaseEntry[],
  from: string | undefined,
  to: string | undefined
): ReleaseEntry[] {
  return entries.filter(
    e =>
      (!from || compareVersions(e.version, from) > 0) &&
      (!to || compareVersions(e.version, to) <= 0)
  );
}

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
}

/** Renders a bullet's `code` spans as <code>; everything else is text. */
export function Bullet({ text }: { text: string }): ReactElement {
  const parts = text.split(/(`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('`') && part.endsWith('`') ? (
          <code
            key={i}
            className="rounded bg-[#F2F1ED] px-1 py-0.5 font-mono text-[11.5px] text-[#3D3B4F]"
          >
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export function ReleaseNotes({
  entry,
  heading,
}: {
  entry: ReleaseEntry;
  heading?: ReactNode;
}): ReactElement {
  return (
    <article id={`v${entry.version}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {heading ?? (
          <h3 className="text-[15px] font-bold tracking-tight text-[#3D3B4F]">v{entry.version}</h3>
        )}
        <time dateTime={entry.date} className="text-[12px] text-[#9B99A6]">
          {formatDate(entry.date)}
        </time>
      </div>
      <div className="mt-3 space-y-3">
        {SECTION_ORDER.filter(s => entry.sections[s.key]?.length).map(s => (
          <div key={s.key} className="flex gap-3">
            <span
              className={`mt-0.5 h-fit shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] ${s.tone}`}
            >
              {s.label}
            </span>
            <ul className="min-w-0 flex-1 space-y-1.5 text-[13px] leading-relaxed text-[#5C5A6B]">
              {entry.sections[s.key].map((b, i) => (
                <li key={i} className="flex gap-2">
                  <span
                    aria-hidden
                    className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[#B3B1BE]"
                  />
                  <span>
                    <Bullet text={b} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </article>
  );
}
