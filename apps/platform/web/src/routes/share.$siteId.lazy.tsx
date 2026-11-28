import { useEffect, type ReactElement } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, EyeOff } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { getPublicSite } from '@/lib/publicApi';
import { SiteDashboard } from './portal.site.$siteId.lazy';

export const Route = createLazyFileRoute('/share/$siteId')({
  component: SharePage,
});

/**
 * A site's public dashboard. Anyone with the link can read it; nothing here
 * needs or uses a session. The owner decides in Share settings whether the
 * site is public and which optional sections come along.
 */
function SharePage(): ReactElement {
  const { siteId } = Route.useParams();
  const search = Route.useSearch();

  const siteQ = useQuery({
    queryKey: ['public-site', siteId],
    queryFn: () => getPublicSite(siteId),
    staleTime: 60_000,
    // A 404 is an answer (not public / no such site), not a blip.
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });
  const site = siteQ.data?.data;

  // Share links are for the people they're sent to, not search results.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);

  useEffect(() => {
    if (!site) return;
    const previous = document.title;
    document.title = `${site.name} analytics · Traks`;
    return () => {
      document.title = previous;
    };
  }, [site]);

  return (
    <div className="min-h-screen bg-background">
      {/* 56px, like the signed-in header, so the dashboard's sticky toolbar
          (top-14) sits flush beneath it. */}
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="Traks" className="h-6 w-6" />
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
              Traks
            </span>
            <span className="rounded-[6px] bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              Public dashboard
            </span>
          </div>
          <a
            href="https://traks.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            Analytics by Traks
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      {site ? (
        <SiteDashboard siteId={siteId} search={search} shared={site} />
      ) : siteQ.isPending ? (
        <div className="py-24 text-center text-[14px] text-subtle">Loading…</div>
      ) : (
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="rounded-[20px] bg-card px-8 py-16 text-center shadow-float">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
              <EyeOff className="h-6 w-6 text-subtle" strokeWidth={1.7} />
            </div>
            <p className="text-[17px] font-semibold text-foreground">
              {siteQ.error instanceof ApiError && siteQ.error.status === 404
                ? 'This dashboard isn’t public'
                : 'Couldn’t load this dashboard'}
            </p>
            <p className="mx-auto mt-2 max-w-sm text-[14px] text-subtle">
              {siteQ.error instanceof ApiError && siteQ.error.status === 404
                ? 'The link may be wrong, or the owner has stopped sharing it.'
                : 'Check your connection and refresh the page.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
