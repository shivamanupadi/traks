import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, LogOut, Trash2 } from 'lucide-react';
import { requiredTextError } from '@traks/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldError } from '@/components/ui/field-error';
import { TimezoneSelect } from '@/components/ui/timezone-select';
import { api, ApiError } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';

export const Route = createFileRoute('/portal/settings')({
  component: SettingsPage,
});

const CARD = 'rounded-[20px] bg-white shadow-float';

type SectionId = 'workspace' | 'timezone' | 'danger';

/**
 * Settings for the CURRENT workspace (header switcher): a sticky side nav and
 * one card of sections - label column left, controls right. Other workspaces
 * are managed by switching to them.
 */
function SettingsPage(): ReactElement {
  const { current, workspaces } = useWorkspace();
  const isOwner = current?.role === 'owner';
  const [active, setActive] = useState<SectionId>('workspace');

  const sections: { id: SectionId; label: string }[] = [
    { id: 'workspace', label: 'Workspace' },
    ...(isOwner ? [{ id: 'timezone' as const, label: 'Reporting timezone' }] : []),
    { id: 'danger', label: 'Danger zone' },
  ];

  // Scroll-spy: the nav follows whichever section is nearest the top.
  useEffect(() => {
    const els = sections
      .map(s => document.getElementById(`settings-${s.id}`))
      .filter((el): el is HTMLElement => Boolean(el));
    if (els.length === 0) return;
    const obs = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id.replace('settings-', '') as SectionId);
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    );
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, current?.id]);

  const jump = (id: SectionId): void => {
    setActive(id);
    document
      .getElementById(`settings-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[26px] font-bold text-[#3D3B4F] tracking-[-0.02em]">Settings</h1>
        <p className="mt-1 text-[14px] text-[#9B9590]">
          {current ? `For the ${current.name} workspace.` : 'Workspace preferences.'}
        </p>
      </div>

      {current && (
        <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[200px_minmax(0,1fr)]">
          <nav className="flex gap-1 overflow-x-auto lg:sticky lg:top-20 lg:flex-col">
            {sections.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => jump(s.id)}
                className={`shrink-0 rounded-[10px] px-3 py-2 text-left text-[13.5px] transition-colors cursor-pointer ${
                  active === s.id
                    ? 'bg-white font-semibold text-[#3D3B4F] shadow-[inset_0_0_0_1px_#E6E4DE]'
                    : 'text-[#6F6D7A] hover:bg-[#F2F2F0] hover:text-[#3D3B4F]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className={`${CARD} px-6 sm:px-7`}>
            <WorkspaceSection />
            {isOwner && <TimezoneSection />}
            <DangerSection isLastWorkspace={workspaces.length <= 1} />
          </div>
        </div>
      )}
    </main>
  );
}

function Section({
  id,
  title,
  sub,
  last,
  children,
}: {
  id: SectionId;
  title: string;
  sub: ReactNode;
  last?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <section
      id={`settings-${id}`}
      className={`grid scroll-mt-20 grid-cols-1 gap-4 py-6 md:grid-cols-[240px_minmax(0,1fr)] md:gap-8 ${
        last ? '' : 'border-b border-[#F2F1ED]'
      }`}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-[14px] font-semibold text-[#3D3B4F]">{title}</h2>
        <p className="text-[12px] leading-relaxed text-[#9B9590]">{sub}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-2.5">{children}</div>
    </section>
  );
}

function RolePill({ role }: { role: 'owner' | 'member' }): ReactElement {
  return role === 'owner' ? (
    <span className="inline-flex rounded-full bg-[#3D3B4F] px-2 py-0.5 text-[11px] font-medium text-white">
      Owner
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[#6E6C7C] shadow-[inset_0_0_0_1px_#E6E4DE]">
      Member
    </span>
  );
}

/** Name and role. Owners rename; members see the name read-only. */
function WorkspaceSection(): ReactElement | null {
  const queryClient = useQueryClient();
  const { current } = useWorkspace();
  const [name, setName] = useState(current?.name ?? '');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Track workspace switches: the field always reflects the active workspace.
  useEffect(() => {
    setName(current?.name ?? '');
    setError('');
  }, [current?.id, current?.name]);

  const rename = useMutation({
    mutationFn: () => api.updateWorkspace(current!.id, { name: name.trim() }),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: err =>
      setError(err instanceof ApiError ? err.message : 'Could not rename the workspace'),
  });

  if (!current) return null;
  const isOwner = current.role === 'owner';
  const wsNameError = requiredTextError(name, 100, 'Workspace name');
  const nameChanged = !wsNameError && name.trim() !== current.name;

  return (
    <Section
      id="workspace"
      title="Workspace"
      sub="Name and role. Shown in the header switcher and on invites."
    >
      <div className="mb-0.5 flex items-center gap-2.5">
        <RolePill role={current.role} />
        <span className="text-[12px] text-[#9B9590]">
          {current.siteCount} {current.siteCount === 1 ? 'site' : 'sites'}
          {!isOwner && ' · you are a member'}
        </span>
      </div>
      {isOwner ? (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-start"
          onSubmit={e => {
            e.preventDefault();
            if (nameChanged && !rename.isPending) rename.mutate();
          }}
        >
          <div className="w-full sm:w-[360px]">
            <Input
              value={name}
              maxLength={100}
              aria-invalid={!!wsNameError}
              onChange={e => setName(e.target.value)}
              className="h-10 px-4 text-[14px]"
            />
            <FieldError message={wsNameError} />
          </div>
          <Button
            type="submit"
            disabled={!nameChanged || rename.isPending}
            isLoading={rename.isPending}
            className="shrink-0 text-[13px] px-5"
          >
            {saved ? (
              <>
                <Check className="h-3.5 w-3.5" />
                Saved
              </>
            ) : (
              'Save'
            )}
          </Button>
        </form>
      ) : (
        <p className="text-[14px] font-semibold text-[#3D3B4F]">{current.name}</p>
      )}
      {error && <p className="text-[12px] text-[#e07a5f]">{error}</p>}
    </Section>
  );
}

/** Owners only; the bulk endpoint skips member workspaces. */
function TimezoneSection(): ReactElement | null {
  const queryClient = useQueryClient();
  const { current } = useWorkspace();
  const [timezone, setTimezone] = useState('');
  const [applied, setApplied] = useState(false);

  const { data: sitesData } = useQuery({
    queryKey: ['sites', current?.id],
    queryFn: () => api.getSites(current!.id),
    enabled: !!current,
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
    mutationFn: () => api.setAllSitesTimezone(timezone, current!.id),
    onSuccess: () => {
      // Every bucket window depends on the zone - refetch everything.
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      queryClient.invalidateQueries({ queryKey: ['site-analytics'] });
      queryClient.invalidateQueries({ queryKey: ['site'] });
      setApplied(true);
      setTimeout(() => setApplied(false), 2500);
    },
  });
  const applyError = applyTimezone.isError
    ? ((applyTimezone.error as Error)?.message ?? 'Could not apply the timezone')
    : '';
  const timezoneChanged = timezone !== '' && (uniformZone === null || timezone !== uniformZone);

  if (!current) return null;

  return (
    <Section
      id="timezone"
      title="Reporting timezone"
      sub="Dashboard days and hours are bucketed in this zone, for every site in the workspace."
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <TimezoneSelect value={timezone} onChange={setTimezone} className="sm:w-[360px]" />
        <Button
          onClick={() => applyTimezone.mutate()}
          disabled={!timezoneChanged || applyTimezone.isPending || sites.length === 0}
          isLoading={applyTimezone.isPending}
          className="shrink-0 text-[13px] px-5"
        >
          {applied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Applied
            </>
          ) : (
            'Apply'
          )}
        </Button>
      </div>
      {sites.length === 0 && (
        <p className="text-[12px] text-[#9B9590]">Add a site first - the zone applies per site.</p>
      )}
      {uniformZone === null && sites.length > 0 && (
        <p className="text-[12px] text-[#e07a5f]">
          Your sites currently use different timezones ({distinctZones.join(', ')}). Applying will
          unify them.
        </p>
      )}
      {applyError && (
        <p className="text-[12px] text-[#e07a5f]">
          {applyError}. Nothing was changed. Check your connection and try again.
        </p>
      )}
      <p className="max-w-[520px] text-[11.5px] leading-relaxed text-[#9B9590]">
        Takes effect on new data within a minute. Already-collected events keep their original
        bucketing, so past days may look shifted until new data accumulates.
      </p>
    </Section>
  );
}

/** Delete (owners) or leave (members), with the existing confirmations. */
function DangerSection({ isLastWorkspace }: { isLastWorkspace: boolean }): ReactElement | null {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { current, setCurrentId, workspaces } = useWorkspace();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [error, setError] = useState('');

  const remove = useMutation({
    mutationFn: () => api.deleteWorkspace(current!.id),
    onSuccess: () => {
      setError('');
      setConfirmOpen(false);
      // Fall back to another workspace before the deleted one vanishes.
      const next = workspaces.find(w => w.id !== current!.id);
      if (next) setCurrentId(next.id);
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
    onError: err => {
      setConfirmOpen(false);
      setError(err instanceof ApiError ? err.message : 'Could not delete the workspace');
    },
  });

  const leave = useMutation({
    mutationFn: () => api.leaveWorkspace(current!.id),
    onSuccess: () => {
      setError('');
      setLeaveOpen(false);
      const next = workspaces.find(w => w.id !== current!.id);
      if (next) setCurrentId(next.id);
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      // If this was their last workspace the account is gone too - the next
      // request 401s and lands on /login by itself.
      navigate({ to: '/portal/sites' });
    },
    onError: err => {
      setLeaveOpen(false);
      setError(err instanceof ApiError ? err.message : 'Could not leave the workspace');
    },
  });

  if (!current) return null;
  const isOwner = current.role === 'owner';
  // Deletion blockers are explained inside the dialog, not by disabling the
  // button - a dead button never tells anyone why.
  const deleteBlocked = current.siteCount > 0 || isLastWorkspace;

  return (
    <Section
      id="danger"
      title="Danger zone"
      sub={
        isOwner
          ? 'Deleting removes the workspace and its memberships. Sites must be deleted first.'
          : 'Leaving gives up your access to its sites and dashboards.'
      }
      last
    >
      <div className="flex flex-col gap-3 rounded-[14px] bg-[#FBEDE8] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-[12.5px] leading-relaxed text-[#8A3A27]">
          {isOwner
            ? current.siteCount > 0
              ? `${current.siteCount} ${
                  current.siteCount === 1 ? 'site still lives' : 'sites still live'
                } here - the workspace must be empty to delete.`
              : isLastWorkspace
                ? 'This is your only workspace; create another from the header switcher first.'
                : 'The workspace is empty. Members lose access and pending invites stop working.'
            : workspaces.length <= 1
              ? 'This is your only workspace here - leaving also removes your account on this instance.'
              : 'Your other workspaces are unaffected.'}
        </span>
        {isOwner ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={remove.isPending}
            className="shrink-0 text-[12px] text-[#e5484d] hover:text-[#e5484d]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete workspace
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLeaveOpen(true)}
            disabled={leave.isPending}
            className="shrink-0 text-[12px] text-[#e5484d] hover:text-[#e5484d]"
          >
            <LogOut className="h-3.5 w-3.5" />
            Leave workspace
          </Button>
        )}
      </div>
      {error && <p className="text-[12px] text-[#e07a5f]">{error}</p>}

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent onClose={() => setLeaveOpen(false)} className="max-w-md">
          <DialogHeader>
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#e07a5f]/10">
              <LogOut className="h-5 w-5 text-[#e07a5f]" strokeWidth={1.7} />
            </div>
            <DialogTitle>Leave {current.name}?</DialogTitle>
            <DialogDescription>
              {workspaces.length <= 1
                ? 'You immediately lose access to its sites and dashboards. Since this is your only workspace on this instance, your account here is removed as well, and you would need a new invitation to come back. Nothing happens to the sites or their data.'
                : 'You immediately lose access to its sites and dashboards. Your other workspaces are unaffected, and you can only return if an owner invites you again.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mx-6 border-t border-[#e6e5ea]/50 px-0 pb-5 pt-4">
            <Button
              variant="ghost"
              onClick={() => setLeaveOpen(false)}
              className="text-[13px] cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={() => leave.mutate()}
              isLoading={leave.isPending}
              className="bg-coral hover:bg-[#d06a4f] text-white shadow-none text-[13px] px-5 cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              Leave workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent onClose={() => setConfirmOpen(false)} className="max-w-md">
          <DialogHeader>
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#e07a5f]/10">
              <Trash2 className="h-5 w-5 text-[#e07a5f]" strokeWidth={1.7} />
            </div>
            <DialogTitle>
              {deleteBlocked ? `${current.name} can’t be deleted yet` : `Delete ${current.name}?`}
            </DialogTitle>
            <DialogDescription>
              {current.siteCount > 0
                ? `This workspace still has ${current.siteCount} ${
                    current.siteCount === 1 ? 'site' : 'sites'
                  }. Deleting a workspace would take its analytics with it, so a workspace must be empty first: delete its sites, then come back here.`
                : isLastWorkspace
                  ? 'This is your only workspace, and your account needs at least one. Create another workspace from the switcher in the header first, then delete this one.'
                  : 'Its members lose access and any pending invites stop working. The workspace is empty, so no sites or analytics data are affected.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mx-6 border-t border-[#e6e5ea]/50 px-0 pb-5 pt-4">
            {deleteBlocked ? (
              <Button onClick={() => setConfirmOpen(false)} className="text-[13px] px-5">
                Got it
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  onClick={() => setConfirmOpen(false)}
                  className="text-[13px] cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => remove.mutate()}
                  isLoading={remove.isPending}
                  className="bg-coral hover:bg-[#d06a4f] text-white shadow-none text-[13px] px-5 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete workspace
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
