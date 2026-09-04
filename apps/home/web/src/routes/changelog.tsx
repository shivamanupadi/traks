import type { ReactElement } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ReleaseNotes, useChangelog } from '@/changelog/shared';

export const Route = createFileRoute('/changelog')({
  component: ChangelogPage,
});

/**
 * Every published platform release, newest first, straight from the release
 * bucket. The same data drives the "what this update brings" block on
 * /update; this page is the shareable, linkable version of it.
 */
function ChangelogPage(): ReactElement {
  const entries = useChangelog();
  return (
    <div className="min-h-screen bg-[#F6F5F2]">
      <header className="sticky top-0 z-30 border-b border-[#E6E4DE] bg-[#F6F5F2]/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="Traks" className="h-6 w-6" />
            <span className="text-[15px] font-bold tracking-tight text-[#3D3B4F]">Traks</span>
            <span className="ml-1 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#B3B1BE]">
              Changelog
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <a
              href="/docs"
              className="hidden h-9 items-center rounded-full px-4 text-[12.5px] font-semibold text-[#3D3B4F] transition-colors hover:bg-[#EEEEF2] sm:inline-flex"
            >
              Docs
            </a>
            <a
              href="/update"
              className="inline-flex h-9 items-center rounded-full bg-[#3D3B4F] px-4 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#2C2B3B]"
            >
              Update your instance
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[720px] px-4 pb-24 pt-10 sm:px-6">
        <h1 className="text-[28px] font-bold tracking-tight text-[#3D3B4F]">Changelog</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-[#6E6C7C]">
          What each platform release brings to a self-hosted instance. Your dashboard shows a{' '}
          <span className="font-medium text-[#3D3B4F]">vX.Y.Z available</span> pill when a newer
          release is published; updating takes one click at{' '}
          <a
            href="/update"
            className="font-semibold text-[#3D3B4F] underline-offset-2 hover:underline"
          >
            traks.dev/update
          </a>
          .
        </p>

        {entries === null && (
          <p className="mt-10 text-[13px] text-[#9B99A6]">Loading release notes…</p>
        )}
        {entries !== null && entries.length === 0 && (
          <p className="mt-10 rounded-xl bg-[#F2F1ED] px-4 py-3 text-[13px] text-[#6E6C7C]">
            No release notes have been published yet.
          </p>
        )}
        {entries && entries.length > 0 && (
          <ol className="mt-10 space-y-10">
            {entries.map((entry, i) => (
              <li key={entry.version} className={i === 0 ? '' : 'border-t border-[#E6E4DE] pt-10'}>
                <ReleaseNotes
                  entry={entry}
                  heading={
                    <h2 className="flex items-center gap-2 text-[17px] font-bold tracking-tight text-[#3D3B4F]">
                      <a href={`#v${entry.version}`} className="hover:underline">
                        v{entry.version}
                      </a>
                      {i === 0 && (
                        <span className="rounded-full bg-[#3D3B4F] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-white">
                          Latest
                        </span>
                      )}
                    </h2>
                  }
                />
              </li>
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}
