import { createFileRoute } from '@tanstack/react-router';
import { PERIODS } from '@traks/shared';
import type { Period } from '@traks/shared';

type SiteSearch = {
  period?: Period;
};

export const Route = createFileRoute('/portal/site/$siteId')({
  component: () => null,
  validateSearch: (search: Record<string, unknown>): SiteSearch => {
    const p = search.period as string;
    return {
      period: PERIODS.includes(p as Period) ? (p as Period) : undefined,
    };
  },
});
