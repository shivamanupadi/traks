import type { ReactElement } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useAuth } from '@clerk/clerk-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, CreditCard, Mail } from 'lucide-react';
import { PLANS, type PlanId, type PlanConfig } from '@traks/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

export const Route = createFileRoute('/portal/settings')({
  component: SettingsPage,
});

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-US', { notation: 'compact' }).format(n);

function PlanCard({
  plan,
  current,
  onUpgrade,
  isPending,
}: {
  plan: PlanConfig;
  current: boolean;
  onUpgrade: () => void;
  isPending: boolean;
}): ReactElement {
  return (
    <div
      className={cn(
        'rounded-2xl border bg-white p-5 flex flex-col',
        current ? 'border-[#9b72cf]' : 'border-[#e8e3ed]/80'
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-semibold text-[#2D3436]">{plan.name}</p>
        {current && (
          <span className="rounded-full bg-[#9b72cf]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#9b72cf]">
            Current plan
          </span>
        )}
      </div>
      <p className="mt-2 text-[26px] font-bold text-[#2D3436]">
        ${plan.priceUsd}
        <span className="text-[13px] font-normal text-[#9B9590]">/mo</span>
      </p>
      <ul className="mt-4 space-y-2 text-[13px] text-[#2D3436] flex-1">
        <li>{fmt(plan.monthlyEvents)} events/mo per site</li>
        <li>
          {plan.siteLimit} site{plan.siteLimit > 1 ? 's' : ''}
        </li>
        {plan.exports && <li>Raw data export (DuckDB)</li>}
        {plan.weeklyReports && <li>Weekly email reports</li>}
      </ul>
      {!current && plan.id !== 'free' && (
        <Button
          onClick={onUpgrade}
          isLoading={isPending}
          className="mt-4 bg-[#9b72cf] hover:bg-[#8a63bf] text-white rounded-xl text-[13px]"
        >
          Upgrade
        </Button>
      )}
    </div>
  );
}

function SettingsPage(): ReactElement {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['billing'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return api.getBilling(token);
    },
    staleTime: 60_000,
  });

  const billing = (data as any)?.data;
  const currentPlan: PlanId = billing?.plan ?? 'free';

  const checkout = useMutation({
    mutationFn: async (plan: 'pro' | 'business') => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return api.createCheckout(plan, token);
    },
    onSuccess: (res: { data: { url: string } }) => {
      window.location.href = res.data.url;
    },
  });

  const portal = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return api.openBillingPortal(token);
    },
    onSuccess: (res: { data: { url: string } }) => {
      window.location.href = res.data.url;
    },
  });

  const setPrefs = useMutation({
    mutationFn: async (weeklyReport: boolean) => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return api.setBillingPrefs(weeklyReport, token);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['billing'] }),
  });

  const weeklyReport = billing?.weeklyReport ?? true;

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div>
        <h1 className="text-[24px] font-bold text-[#2D3436] tracking-[-0.02em]">Settings</h1>
        <p className="mt-1 text-[14px] text-[#9B9590]">Plan, billing, and notifications</p>
      </div>

      {/* Plans */}
      <section>
        <h2 className="mb-3 text-[15px] font-semibold text-[#2D3436]">Plan</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {(Object.values(PLANS) as PlanConfig[]).map(plan => (
            <PlanCard
              key={plan.id}
              plan={plan}
              current={plan.id === currentPlan}
              onUpgrade={() => checkout.mutate(plan.id as 'pro' | 'business')}
              isPending={checkout.isPending}
            />
          ))}
        </div>
        {billing?.hasBillingAccount && (
          <button
            onClick={() => portal.mutate()}
            className="mt-4 flex items-center gap-2 text-[13px] text-[#9b72cf] hover:underline cursor-pointer"
          >
            <CreditCard className="h-3.5 w-3.5" />
            Manage billing &amp; invoices
          </button>
        )}
      </section>

      {/* Notifications */}
      <section>
        <h2 className="mb-3 text-[15px] font-semibold text-[#2D3436]">Notifications</h2>
        <div className="flex items-center justify-between rounded-2xl border border-[#e8e3ed]/80 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#5b9a6f]/10">
              <Mail className="h-4 w-4 text-[#5b9a6f]" strokeWidth={1.8} />
            </div>
            <div>
              <p className="text-[13px] font-medium text-[#2D3436]">Weekly email report</p>
              <p className="text-[12px] text-[#9B9590]">
                A Monday digest of visitors and pageviews across your sites (paid plans).
              </p>
            </div>
          </div>
          <button
            onClick={() => setPrefs.mutate(!weeklyReport)}
            disabled={setPrefs.isPending}
            className={cn(
              'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors cursor-pointer',
              weeklyReport ? 'bg-[#5b9a6f]' : 'bg-[#e8e3ed]'
            )}
            role="switch"
            aria-checked={weeklyReport}
          >
            <span
              className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                weeklyReport ? 'translate-x-5' : 'translate-x-1'
              )}
            />
          </button>
        </div>
        {currentPlan === 'free' && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[#B5B0AA]">
            <Check className="h-3 w-3" />
            Reports start sending once you&apos;re on a paid plan.
          </p>
        )}
      </section>
    </main>
  );
}
