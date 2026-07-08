import type { ReactElement } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Globe } from 'lucide-react';
import type { Period } from '@traks/shared';
import { StatsCards } from '@/components/analytics/StatsCards';
import { TimeseriesChart } from '@/components/analytics/TimeseriesChart';
import { TopList } from '@/components/analytics/TopList';
import { PeriodPicker } from '@/components/layout/PeriodPicker';

const API_URL = import.meta.env.VITE_API_URL || 'https://api.traks.dev';

interface ShareSearch {
  period?: Period;
}

export const Route = createFileRoute('/share/$siteId')({
  validateSearch: (search: Record<string, unknown>): ShareSearch => ({
    period: search.period as Period | undefined,
  }),
  component: SharePage,
});

function SharePage(): ReactElement {
  const { siteId } = Route.useParams();
  const { period: searchPeriod } = Route.useSearch();
  const navigate = Route.useNavigate();
  const period: Period = searchPeriod || 'today';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-dashboard', siteId, period],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/public/${siteId}/stats/all?period=${period}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: period === 'today' ? 30_000 : false,
  });

  const site = (data as any)?.data?.site;
  const stats = (data as any)?.data?.stats;

  if (isError) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#fdfbf8] px-4">
        <p className="text-[15px] font-medium text-[#2D3436]">
          This dashboard is not public or does not exist.
        </p>
        <Link to="/" className="mt-3 text-[13px] text-[#9b72cf] hover:underline">
          traks.dev
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fdfbf8]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#9b72cf]/10">
              <Globe className="h-4 w-4 text-[#9b72cf]" strokeWidth={1.8} />
            </div>
            <div>
              <h1 className="text-[20px] font-bold text-[#2D3436] tracking-[-0.01em]">
                {site?.name || 'Analytics'}
              </h1>
              {site?.domain && <p className="text-[13px] text-[#9B9590]">{site.domain}</p>}
            </div>
          </div>
          <PeriodPicker
            value={period}
            onChange={p => navigate({ search: { period: p }, replace: true }) as unknown as void}
          />
        </div>

        <StatsCards stats={stats?.main} isLoading={isLoading} isError={false} />
        <TimeseriesChart data={stats?.timeseries} isLoading={isLoading} isError={false} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <TopList title="Top Pages" items={stats?.pages} isLoading={isLoading} showPageviews />
          <TopList title="Top Referrers" items={stats?.referrers} isLoading={isLoading} />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <TopList title="Countries" items={stats?.locations} isLoading={isLoading} />
          <TopList title="Browsers" items={stats?.browsers} isLoading={isLoading} />
        </div>

        <p className="pb-4 text-center text-[12px] text-[#B5B0AA]">
          Powered by{' '}
          <Link to="/" className="text-[#9b72cf] hover:underline">
            Traks
          </Link>
        </p>
      </div>
    </main>
  );
}
