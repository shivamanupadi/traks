import { useState, useEffect, type ReactElement } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useAuth } from '@clerk/clerk-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Mail, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TimezoneSelect } from '@/components/ui/timezone-select';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

export const Route = createFileRoute('/portal/settings')({
  component: SettingsPage,
});

function SettingsPage(): ReactElement {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [timezone, setTimezone] = useState('');
  const [applied, setApplied] = useState(false);

  const { data: accountData } = useQuery({
    queryKey: ['account'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return api.getAccount(token);
    },
    staleTime: 60_000,
  });

  const { data: sitesData } = useQuery({
    queryKey: ['sites'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return api.getSites(token);
    },
    staleTime: 60_000,
  });

  const sites = ((sitesData as any)?.data ?? []) as { timezone?: string }[];
  const distinctZones = [...new Set(sites.map(s => s.timezone || 'UTC'))];
  const uniformZone = distinctZones.length === 1 ? distinctZones[0] : null;

  // Seed the picker once sites load: the shared zone if uniform, else the
  // browser's zone as the suggested value to unify on.
  useEffect(() => {
    if (sites.length > 0 && timezone === '') {
      setTimezone(uniformZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitesData]);

  const applyTimezone = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return api.setAllSitesTimezone(timezone, token);
    },
    onSuccess: () => {
      // Every bucket window depends on the zone - refetch everything.
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      queryClient.invalidateQueries({ queryKey: ['site-analytics'] });
      queryClient.invalidateQueries({ queryKey: ['site'] });
      setApplied(true);
      setTimeout(() => setApplied(false), 2500);
    },
  });

  const weeklyReport = (accountData as any)?.data?.weeklyReport ?? true;

  const setPrefs = useMutation({
    mutationFn: async (enabled: boolean) => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return api.setPreferences(enabled, token);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account'] }),
  });

  const timezoneChanged = timezone !== '' && (uniformZone === null || timezone !== uniformZone);

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div>
        <h1 className="text-[24px] font-bold text-[#2D3436] tracking-[-0.02em]">Settings</h1>
        <p className="mt-1 text-[14px] text-[#9B9590]">Preferences for your account and sites</p>
      </div>

      {/* Timezone */}
      <section>
        <h2 className="mb-3 text-[15px] font-semibold text-[#2D3436]">Timezone</h2>
        <div className="rounded-2xl border border-[#e8e3ed]/80 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#9b72cf]/10">
              <Globe className="h-4 w-4 text-[#9b72cf]" strokeWidth={1.8} />
            </div>
            <div>
              <p className="text-[13px] font-medium text-[#2D3436]">Reporting timezone</p>
              <p className="text-[12px] text-[#9B9590]">
                Dashboard days and hours are bucketed in this timezone. Applies to all your sites.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <TimezoneSelect value={timezone} onChange={setTimezone} className="sm:w-96" />
            <Button
              onClick={() => applyTimezone.mutate()}
              disabled={!timezoneChanged || applyTimezone.isPending || sites.length === 0}
              isLoading={applyTimezone.isPending}
              className="bg-[#9b72cf] hover:bg-[#8a63bf] text-white rounded-xl text-[13px] px-5 shrink-0"
            >
              {applied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Applied
                </>
              ) : (
                'Apply to all sites'
              )}
            </Button>
          </div>

          {uniformZone === null && sites.length > 0 && (
            <p className="mt-3 text-[12px] text-[#e07a5f]">
              Your sites currently use different timezones ({distinctZones.join(', ')}). Applying
              will unify them.
            </p>
          )}
          <p className="mt-3 text-[12px] text-[#B5B0AA]">
            Takes effect on new data within a minute. Events already collected keep their original
            bucketing, so past days may look shifted until new data accumulates.
          </p>
        </div>
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
                A Monday digest of visitors and pageviews across your sites.
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
      </section>
    </main>
  );
}
