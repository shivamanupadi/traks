import type { ReactElement } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useAuth } from '@clerk/clerk-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { CreditCard } from 'lucide-react';
import { PLANS, type PlanId, type PlanConfig } from '@traks/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

export const Route = createFileRoute('/portal/billing')({
  component: BillingPage,
});

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-US', { notation: 'compact' }).format(n);

function PlanCard({
  plan,
  current,
  onUpgrade,
  isPending,
  billingEnabled,
}: {
  plan: PlanConfig;
  current: boolean;
  onUpgrade: () => void;
  isPending: boolean;
  billingEnabled: boolean;
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
      {!current &&
        plan.id !== 'free' &&
        (billingEnabled ? (
          <Button
            onClick={onUpgrade}
            isLoading={isPending}
            className="mt-4 bg-[#9b72cf] hover:bg-[#8a63bf] text-white rounded-xl text-[13px]"
          >
            Upgrade
          </Button>
        ) : (
          <span className="mt-4 inline-flex w-fit rounded-full bg-[#e8e3ed]/60 px-2.5 py-0.5 text-[11px] font-medium text-[#9B9590]">
            Coming soon
          </span>
        ))}
    </div>
  );
}

function BillingPage(): ReactElement {
  const { getToken } = useAuth();

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
  const billingEnabled: boolean = billing?.billingEnabled ?? false;

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

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div>
        <h1 className="text-[24px] font-bold text-[#2D3436] tracking-[-0.02em]">Billing</h1>
        <p className="mt-1 text-[14px] text-[#9B9590]">Your plan, payments, and invoices</p>
      </div>

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
              billingEnabled={billingEnabled}
            />
          ))}
        </div>
        {billingEnabled && billing?.hasBillingAccount && (
          <button
            onClick={() => portal.mutate()}
            className="mt-4 flex items-center gap-2 text-[13px] text-[#9b72cf] hover:underline cursor-pointer"
          >
            <CreditCard className="h-3.5 w-3.5" />
            Manage billing &amp; invoices
          </button>
        )}
      </section>
    </main>
  );
}
