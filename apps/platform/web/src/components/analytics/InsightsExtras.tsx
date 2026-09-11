import { useMemo, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Period, VisitorCategory } from '@traks/shared';
import { VISITOR_CATEGORY_LABEL } from '@traks/shared';
import { formatNumber } from '@/lib/utils';
import { api, type AnalyticsFilters } from '@/lib/api';

const CARD = 'rounded-[20px] bg-white p-6 shadow-float';
const SEG =
  'rounded-full px-3 py-1 text-[12px] font-semibold transition-colors cursor-pointer';

export function AttributionPanel({
  siteId,
  period,
  filters,
}: {
  siteId: string;
  period: Period;
  filters?: AnalyticsFilters;
}): ReactElement {
  const [touch, setTouch] = useState<'first' | 'last'>('first');
  const [type, setType] = useState<'source' | 'medium' | 'campaign'>('source');
  const q = useQuery({
    queryKey: ['site-analytics', siteId, 'attribution', period, touch, type, filters],
    queryFn: () => api.getAttribution(siteId, period, touch, type, filters),
  });
  const rows = (q.data as any)?.data as
    | { name: string; sessions: number; conversions: number; conversionRate: number }[]
    | undefined;

  return (
    <div className={CARD}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[15px] font-bold tracking-[-0.01em] text-[#3D3B4F]">Attribution</h3>
        <div className="flex flex-wrap gap-1.5">
          {(['first', 'last'] as const).map(t => (
            <button
              key={t}
              className={`${SEG} ${touch === t ? 'bg-[#3D3B4F] text-white' : 'bg-muted text-foreground'}`}
              onClick={() => setTouch(t)}
            >
              {t === 'first' ? 'First touch' : 'Last touch'}
            </button>
          ))}
          {(['source', 'medium', 'campaign'] as const).map(t => (
            <button
              key={t}
              className={`${SEG} ${type === t ? 'bg-[#3D3B4F] text-white' : 'bg-muted text-foreground'}`}
              onClick={() => setType(t)}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {q.isError ? (
        <p className="text-[13px] text-[#e07a5f]">Failed to load attribution</p>
      ) : q.isLoading || !rows ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-[#9B9590]">No UTM-tagged sessions in this period.</p>
      ) : (
        <table className="w-full text-left text-[13px]">
          <thead className="text-[11px] font-semibold uppercase tracking-wide text-[#B5B0AA]">
            <tr>
              <th className="pb-2 font-semibold">Campaign</th>
              <th className="pb-2 text-right font-semibold">Sessions</th>
              <th className="pb-2 text-right font-semibold">Conversions</th>
              <th className="pb-2 text-right font-semibold">Rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.name} className="border-t border-[#F2F1ED]">
                <td className="py-2 font-medium text-[#3D3B4F]">{r.name}</td>
                <td className="py-2 text-right text-[#6E6C7C]">{formatNumber(r.sessions)}</td>
                <td className="py-2 text-right text-[#6E6C7C]">{formatNumber(r.conversions)}</td>
                <td className="py-2 text-right text-[#6E6C7C]">{r.conversionRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function PathPanel({
  siteId,
  period,
  filters,
  defaultPage,
}: {
  siteId: string;
  period: Period;
  filters?: AnalyticsFilters;
  defaultPage: string;
}): ReactElement {
  const page = filters?.page || defaultPage;
  const [kind, setKind] = useState<'next' | 'prev'>('next');
  const q = useQuery({
    queryKey: ['site-analytics', siteId, 'paths', period, kind, page, filters],
    queryFn: () => api.getPaths(siteId, period, kind, page, filters),
    enabled: !!page,
  });
  const rows = (q.data as any)?.data as { name: string; sessions: number }[] | undefined;

  return (
    <div className={CARD}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold tracking-[-0.01em] text-[#3D3B4F]">Path analysis</h3>
          <p className="mt-1 text-[12px] text-[#9B9590]">
            {page
              ? `From ${page}. Filter the Pages panel to pick another page.`
              : 'Filter a page above to see where people go next.'}
          </p>
        </div>
        <div className="flex gap-1.5">
          {(['next', 'prev'] as const).map(k => (
            <button
              key={k}
              className={`${SEG} ${kind === k ? 'bg-[#3D3B4F] text-white' : 'bg-muted text-foreground'}`}
              onClick={() => setKind(k)}
            >
              {k === 'next' ? 'Next page' : 'Previous page'}
            </button>
          ))}
        </div>
      </div>
      {!page ? (
        <p className="text-[13px] text-[#9B9590]">Click a page in Top Pages to analyse its paths.</p>
      ) : q.isError ? (
        <p className="text-[13px] text-[#e07a5f]">Failed to load paths</p>
      ) : q.isLoading || !rows ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-[#9B9590]">No neighbouring pages yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map(r => (
            <li key={r.name} className="flex items-center justify-between text-[13px]">
              <span className="truncate font-medium text-[#3D3B4F]">{r.name}</span>
              <span className="ml-3 shrink-0 text-[#6E6C7C]">{formatNumber(r.sessions)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RetentionPanel({
  siteId,
}: {
  siteId: string;
}): ReactElement {
  const q = useQuery({
    queryKey: ['site-analytics', siteId, 'retention'],
    queryFn: () => api.getRetention(siteId, 'all'),
  });
  const rows = (q.data as any)?.data as { cohort: string; week: string; visitors: number }[] | undefined;
  const note = (q.data as any)?.note as string | undefined;

  const { cohorts, offsets } = useMemo(() => {
    const list = rows ?? [];
    const cohorts = [...new Set(list.map(r => r.cohort))].sort();
    const offsets = new Set<number>();
    const weekIndex = (w: string): number => {
      const m = /^(\d{4})-W(\d{2})$/.exec(w);
      if (!m) return 0;
      return Number(m[1]) * 53 + Number(m[2]);
    };
    const first = new Map<string, number>();
    for (const c of cohorts) first.set(c, weekIndex(c));
    for (const r of list) {
      const base = first.get(r.cohort) ?? 0;
      offsets.add(Math.max(0, weekIndex(r.week) - base));
    }
    return { cohorts, offsets: [...offsets].sort((a, b) => a - b).slice(0, 12) };
  }, [rows]);

  const byKey = new Map<string, number>();
  for (const r of rows ?? []) byKey.set(`${r.cohort}|${r.week}`, r.visitors);

  const weekIndex = (w: string): number => {
    const m = /^(\d{4})-W(\d{2})$/.exec(w);
    if (!m) return 0;
    return Number(m[1]) * 53 + Number(m[2]);
  };

  return (
    <div className={CARD}>
      <h3 className="mb-1 text-[15px] font-bold tracking-[-0.01em] text-[#3D3B4F]">Retention</h3>
      <p className="mb-4 text-[12px] text-[#9B9590]">
        {note || 'Share of visitors who return in later weeks.'}
      </p>
      {q.isError ? (
        <p className="text-[13px] text-[#e07a5f]">Failed to load retention</p>
      ) : q.isLoading || !rows ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      ) : cohorts.length === 0 ? (
        <p className="text-[13px] text-[#9B9590]">No returning-visitor data yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[#B5B0AA]">
                <th className="pb-2 pr-3 text-left font-semibold">Cohort</th>
                {offsets.map(o => (
                  <th key={o} className="pb-2 px-1 text-right font-semibold">
                    W{o}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map(c => {
                const size = byKey.get(`${c}|${c}`) ?? 0;
                return (
                  <tr key={c} className="border-t border-[#F2F1ED]">
                    <td className="py-1.5 pr-3 font-medium text-[#3D3B4F]">{c}</td>
                    {offsets.map(o => {
                      const targetWeek = weekOffset(c, o);
                      const n = byKey.get(`${c}|${targetWeek}`);
                      const pct = size && n ? Math.round((n / size) * 100) : n ? 100 : 0;
                      return (
                        <td key={o} className="py-1.5 px-1 text-right text-[#6E6C7C]">
                          {n == null ? '—' : `${pct}%`}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function weekOffset(cohort: string, offset: number): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(cohort);
  if (!m) return cohort;
  let year = Number(m[1]);
  let week = Number(m[2]) + offset;
  while (week > 53) {
    week -= 53;
    year += 1;
  }
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function CrawlersPanel({
  siteId,
  period,
  filters,
}: {
  siteId: string;
  period: Period;
  filters?: AnalyticsFilters;
}): ReactElement {
  const [cat, setCat] = useState<'all' | VisitorCategory>('all');
  const q = useQuery({
    queryKey: ['site-analytics', siteId, 'crawlers', period, filters],
    queryFn: () => api.getCrawlers(siteId, period, filters),
  });
  const rows = ((q.data as any)?.data ?? []) as {
    name: string;
    category: VisitorCategory;
    visitors: number;
    pageviews: number;
  }[];
  const shown = cat === 'all' ? rows : rows.filter(r => r.category === cat);

  return (
    <div className={CARD}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[15px] font-bold tracking-[-0.01em] text-[#3D3B4F]">
          Crawlers & AI traffic
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {(['all', 'search_bot', 'ai_bot', 'ai_referral', 'other_bot'] as const).map(k => (
            <button
              key={k}
              className={`${SEG} ${cat === k ? 'bg-[#3D3B4F] text-white' : 'bg-muted text-foreground'}`}
              onClick={() => setCat(k)}
            >
              {k === 'all' ? 'All' : VISITOR_CATEGORY_LABEL[k]}
            </button>
          ))}
        </div>
      </div>
      {q.isError ? (
        <p className="text-[13px] text-[#e07a5f]">Failed to load crawlers</p>
      ) : q.isLoading ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      ) : shown.length === 0 ? (
        <p className="text-[13px] text-[#9B9590]">No crawler or AI-referral traffic yet.</p>
      ) : (
        <ul className="space-y-2">
          {shown.map(r => (
            <li key={`${r.category}:${r.name}`} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate">
                <span className="font-medium text-[#3D3B4F]">{r.name}</span>
                <span className="ml-2 text-[11px] text-[#B5B0AA]">
                  {VISITOR_CATEGORY_LABEL[r.category]}
                </span>
              </span>
              <span className="shrink-0 text-[#6E6C7C]">{formatNumber(r.visitors)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
