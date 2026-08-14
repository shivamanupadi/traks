import { useState, useEffect, type ReactElement } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Globe, Layers, LogOut, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { AgentAccessCard } from '@/components/settings/AgentAccessCard';
import { TimezoneSelect } from '@/components/ui/timezone-select';
import { api, ApiError } from '@/lib/api';
import { FieldError } from '@/components/ui/field-error';
import { requiredTextError } from '@traks/shared';
import { useWorkspace } from '@/lib/workspace';

export const Route = createFileRoute('/portal/settings')({
  component: SettingsPage,
});

// Settings are scoped to the CURRENT workspace (the one in the header
// switcher). Other workspaces are managed by switching to them; the switcher
// dropdown handles switching and creating.
function SettingsPage(): ReactElement {
  const queryClient = useQueryClient();
  const { current, workspaces } = useWorkspace();
  const isOwner = current?.role === 'owner';
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
  // Without this the spinner just stops: the user believes the zone applied
  // while every bucket window is unchanged.
  const applyError = applyTimezone.isError
    ? ((applyTimezone.error as Error)?.message ?? 'Could not apply the timezone')
    : '';

  const timezoneChanged = timezone !== '' && (uniformZone === null || timezone !== uniformZone);

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-[26px] font-bold text-[#3D3B4F] tracking-[-0.02em]">Settings</h1>
        <p className="mt-1 text-[14px] text-[#9B9590]">
          {current ? `For the ${current.name} workspace` : 'Workspace preferences'}
        </p>
      </div>

      <div className="flex max-w-[620px] flex-col gap-7">
        <WorkspaceCard isLastWorkspace={workspaces.length <= 1} />

        {/* Timezone (owners only — the bulk endpoint skips member workspaces) */}
        {isOwner && (
          <section>
            <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#9B9590]">
              Timezone
            </p>
            <div className="rounded-[20px] bg-white p-6 shadow-float">
              <div className="flex items-center gap-3.5">
                <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] bg-muted">
                  <Globe className="h-[17px] w-[17px] text-foreground" strokeWidth={1.8} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-[#3D3B4F]">Reporting timezone</p>
                  <p className="mt-0.5 text-[12px] text-[#9B9590]">
                    Dashboard days and hours are bucketed in this timezone. Applies to every site in
                    this workspace.
                  </p>
                </div>
              </div>

              <div className="mt-[18px] flex flex-col gap-3 sm:flex-row sm:items-center">
                <TimezoneSelect value={timezone} onChange={setTimezone} className="sm:w-96" />
                <Button
                  onClick={() => applyTimezone.mutate()}
                  disabled={!timezoneChanged || applyTimezone.isPending || sites.length === 0}
                  isLoading={applyTimezone.isPending}
                  className="shrink-0 text-[13px] px-5"
                >
                  {applied ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Applied
                    </>
                  ) : (
                    'Apply to workspace'
                  )}
                </Button>
              </div>

              {applyError && (
                <p className="mt-3 text-[12px] text-[#e07a5f]">
                  {applyError} — nothing was changed. Check your connection and try again.
                </p>
              )}

              {uniformZone === null && sites.length > 0 && (
                <p className="mt-3 text-[12px] text-[#e07a5f]">
                  Your sites currently use different timezones ({distinctZones.join(', ')}).
                  Applying will unify them.
                </p>
              )}
              <p className="mt-3.5 border-t border-[#F5F2EC] pt-3.5 text-[12px] text-[#B5B0AA]">
                Takes effect on new data within a minute. Events already collected keep their
                original bucketing, so past days may look shifted until new data accumulates.
              </p>
            </div>
          </section>
        )}

        <AgentAccessCard />
      </div>
    </main>
  );
}

/** The current workspace's own details: rename and delete, owner-only. */
function WorkspaceCard({ isLastWorkspace }: { isLastWorkspace: boolean }): ReactElement | null {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { current, setCurrentId, workspaces } = useWorkspace();
  const [name, setName] = useState(current?.name ?? '');
  const [saved, setSaved] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
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
      // If this was their last workspace the account is gone too — the next
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
  const wsNameError = requiredTextError(name, 100, 'Workspace name');
  const nameChanged = !wsNameError && name.trim() !== current.name;
  // Deletion blockers are explained inside the dialog, not by disabling the
  // button — a dead button never tells anyone why.
  const deleteBlocked = current.siteCount > 0 || isLastWorkspace;

  return (
    <section>
      <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#9B9590]">
        Workspace
      </p>
      <div className="rounded-[20px] bg-white p-6 shadow-float">
        <div className="flex items-center gap-3.5">
          <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] bg-muted">
            <Layers className="h-[17px] w-[17px] text-foreground" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold text-[#3D3B4F]">{current.name}</p>
            <p className="mt-0.5 text-[12px] text-[#9B9590]">
              {current.siteCount} {current.siteCount === 1 ? 'site' : 'sites'} · you are{' '}
              {current.role === 'owner' ? 'an owner' : 'a member'}
            </p>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.07em] text-foreground">
            {current.role}
          </span>
        </div>

        {isOwner && (
          <>
            <div className="mt-5">
              <label className="mb-2 block text-[13px] font-medium text-[#3D3B4F]">Name</label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Input
                  value={name}
                  maxLength={100}
                  aria-invalid={!!wsNameError}
                  onChange={e => setName(e.target.value)}
                  className="h-10 px-4 text-[14px] sm:w-96"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && nameChanged && !rename.isPending) rename.mutate();
                  }}
                />
                <Button
                  onClick={() => rename.mutate()}
                  disabled={!nameChanged || rename.isPending}
                  isLoading={rename.isPending}
                  className="shrink-0 text-[13px] px-5"
                >
                  {saved ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Saved
                    </>
                  ) : (
                    'Save'
                  )}
                </Button>
              </div>
              <FieldError message={wsNameError} />
            </div>

            <div className="mt-5 flex items-center justify-between gap-4 border-t border-[#F5F2EC] pt-4">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[#3D3B4F]">Delete this workspace</p>
                <p className="mt-0.5 text-[12px] text-[#9B9590]">
                  Removes the workspace and its memberships.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => setConfirmOpen(true)}
                disabled={remove.isPending}
                className="h-9 shrink-0 px-4 text-[12.5px] text-[#e5484d] hover:text-[#e5484d]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          </>
        )}

        {!isOwner && (
          <div className="mt-5 flex items-center justify-between gap-4 border-t border-[#F5F2EC] pt-4">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[#3D3B4F]">Leave this workspace</p>
              <p className="mt-0.5 text-[12px] text-[#9B9590]">
                Gives up your access to its sites and dashboards.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => setLeaveOpen(true)}
              disabled={leave.isPending}
              className="h-9 shrink-0 px-4 text-[12.5px] text-[#e5484d] hover:text-[#e5484d]"
            >
              <LogOut className="h-3.5 w-3.5" />
              Leave
            </Button>
          </div>
        )}

        {error && <p className="mt-3 text-[12px] text-[#e07a5f]">{error}</p>}
      </div>

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent onClose={() => setLeaveOpen(false)} className="max-w-md">
          <DialogHeader>
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#e07a5f]/10">
              <LogOut className="h-5 w-5 text-[#e07a5f]" strokeWidth={1.7} />
            </div>
            <DialogTitle>Leave {current.name}?</DialogTitle>
            <DialogDescription>
              {workspaces.length <= 1
                ? 'You immediately lose access to its sites and dashboards. Since this is your only workspace on this instance, your account here is removed as well — you would need a new invitation to come back. Nothing happens to the sites or their data.'
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
              <LogOut className="w-3.5 h-3.5" />
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
                  }. Deleting a workspace would take its analytics with it, so a workspace must be empty first — delete its sites, then come back here.`
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
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete workspace
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
