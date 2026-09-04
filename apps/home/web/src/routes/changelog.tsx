import type { ReactElement } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Bullet, formatDate, useChangelog, type ReleaseEntry } from '@/changelog/shared';

export const Route = createFileRoute('/changelog')({
  component: ChangelogPage,
});

const SECTIONS: { key: keyof ReleaseEntry['sections']; label: string; tone: string }[] = [
  { key: 'breaking', label: 'Breaking', tone: 'bg-[#F7DCD4] text-[#8F3B2C]' },
  { key: 'added', label: 'Added', tone: 'bg-[#DDEFE6] text-[#2F6B4F]' },
  { key: 'changed', label: 'Changed', tone: 'bg-[#F2F1ED] text-[#3D3B4F]' },
  { key: 'fixed', label: 'Fixed', tone: 'bg-[#EDEAF7] text-[#4F4A78]' },
];

/**
 * Every published platform release, newest first, as a timeline: a rail down
 * the left with one node per release, the version and date pinned beside it,
 * and the notes in a card to the right. Same data as the "what this update
 * brings" block on /update; this is the shareable, linkable version.
 */
function ChangelogPage(): ReactElement {
  const entries = useChangelog();
  return (
    <div className="min-h-screen bg-[#F9F8F6]">
      <header className="sticky top-0 z-30 border-b border-[#E6E4DE] bg-[#F9F8F6]/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="Traks" className="h-6 w-6" />
            <span className="text-[15px] font-bold tracking-tight text-[#3D3B4F]">Traks</span>
            <span className="ml-1 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#B3B1BE]">
              Changelog
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            <a
              href="/docs"
              className="rounded-md px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#6E6C7C] transition-colors hover:text-[#3D3B4F]"
            >
              Docs
            </a>
            <a
              href="/update"
              className="ml-1 inline-flex h-9 items-center rounded-full border border-[#E6E4DE] px-4 text-[12.5px] font-semibold text-[#3D3B4F] transition-colors hover:bg-[#F2F1ED]"
            >
              Update your instance
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[960px] px-4 pb-28 pt-12 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#9B9590]">
              Platform releases
            </p>
            <h1 className="mt-1.5 text-[30px] font-bold tracking-[-0.02em] text-[#3D3B4F]">
              Changelog
            </h1>
          </div>
          {entries && entries.length > 0 && (
            <p className="text-[12.5px] text-[#9B9590]">
              {entries.length} releases · latest{' '}
              <span className="font-mono font-medium text-[#3D3B4F]">v{entries[0].version}</span>
            </p>
          )}
        </div>

        {entries === null && (
          <p className="mt-12 text-[13px] text-[#9B9590]">Loading release notes…</p>
        )}
        {entries !== null && entries.length === 0 && (
          <p className="mt-12 rounded-xl bg-[#F2F1ED] px-4 py-3 text-[13px] text-[#6E6C7C]">
            No release notes have been published yet.
          </p>
        )}

        {entries && entries.length > 0 && (
          <ol className="mt-12">
            {entries.map((entry, i) => (
              <ReleaseRow
                key={entry.version}
                entry={entry}
                latest={i === 0}
                last={i === entries.length - 1}
              />
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}

function ReleaseRow({
  entry,
  latest,
  last,
}: {
  entry: ReleaseEntry;
  latest: boolean;
  last: boolean;
}): ReactElement {
  const sections = SECTIONS.filter(s => entry.sections[s.key]?.length);
  return (
    <li id={`v${entry.version}`} className="relative grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
      {/* rail: node + connector */}
      <div
        aria-hidden
        className="absolute left-[7px] top-0 hidden h-full w-px bg-[#E6E4DE] sm:block"
        style={last ? { height: '28px' } : undefined}
      />
      <div
        aria-hidden
        className={`absolute left-0 top-[22px] hidden h-[15px] w-[15px] rounded-full border-2 border-[#F9F8F6] sm:block ${
          latest ? 'bg-[#28E99F] ring-1 ring-[#28E99F]/40' : 'bg-[#D8D7DE]'
        }`}
      />

      {/* left: version + date, pinned while the card scrolls */}
      <div className="sm:sticky sm:top-[88px] sm:self-start sm:pl-8 sm:pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`#v${entry.version}`}
            className="font-mono text-[15px] font-semibold tracking-tight text-[#3D3B4F] hover:underline"
          >
            v{entry.version}
          </a>
          {latest && (
            <span className="rounded-full border border-[#28E99F]/50 bg-[#28E99F]/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#1F7A56]">
              Latest
            </span>
          )}
        </div>
        <time dateTime={entry.date} className="mt-1 block text-[12.5px] text-[#9B9590]">
          {formatDate(entry.date)}
        </time>
      </div>

      {/* right: notes card */}
      <div className={last ? 'pb-2' : 'pb-10'}>
        <div className="rounded-2xl border border-[#E9E9EE] bg-white shadow-float">
          <div className="divide-y divide-[#F2F1ED]">
            {sections.map(s => (
              <div key={s.key} className="flex gap-4 px-6 py-4">
                <span
                  className={`mt-0.5 h-fit w-[72px] shrink-0 rounded-full px-2 py-0.5 text-center text-[10.5px] font-semibold uppercase tracking-[0.06em] ${s.tone}`}
                >
                  {s.label}
                </span>
                <ul className="min-w-0 flex-1 space-y-2 text-[13.5px] leading-relaxed text-[#5C5A6B]">
                  {entry.sections[s.key].map((b, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span
                        aria-hidden
                        className="mt-[10px] h-1 w-1 shrink-0 rounded-full bg-[#B5B0AA]"
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
        </div>
      </div>
    </li>
  );
}
