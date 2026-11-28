import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Globe, LogOut, Pencil, Trash2 } from 'lucide-react';
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
import { TimezoneSelect, offsetLabel } from '@/components/ui/timezone-select';
import { SiteFavicon } from '@/components/sites/SiteFavicon';
import { api, ApiError } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';

export const Route = createFileRoute('/portal/settings')({
  component: SettingsPage,
});

const CARD = 'rounded-[20px] bg-card p-5 shadow-float sm:p-6';

/** Section icon tiles: brand ink + mint for settings, coral for delete / leave. */
const TONE = {
  // Brand: the logo's ink on a light wash of its mint.
  brand: 'bg-[#28E99F]/20 text-foreground',
  coral: 'bg-coral-soft text-coral-deep',
} as const;

/** Ink primary that reads as "nothing to do" when disabled, not faded mint. */
const PRIMARY =
  'shrink-0 bg-btn px-5 text-[13px] font-semibold text-white shadow-none hover:bg-btn-hover disabled:bg-muted disabled:text-faint disabled:opacity-100';

interface SiteRow {
  id: string;
  name: string;
  domain: string;
  timezone?: string | null;
  favicon?: string | null;
}

/**
 * Settings for the CURRENT workspace (header switcher): the page title with
 * the workspace's role and counts, then one card per setting. No side navigation - three sections never
 * needed one. Other workspaces are managed by switching to them.
 */
function SettingsPage(): ReactElement {
  const { current, workspaces } = useWorkspace();
  const isOwner = current?.role === 'owner';

  // One sites read serves the header count and the timezone card.
  const sitesQ = useQuery({
    queryKey: ['sites', current?.id],
    queryFn: () => api.getSites(current!.id),
    enabled: !!current,
    staleTime: 60_000,
  });
  const sites = ((sitesQ.data as any)?.data ?? []) as SiteRow[];

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <PageHeader />
      {current && (
        <div className="max-w-3xl space-y-4">
          {isOwner && <WorkspaceSection />}
          <TimezoneSection sites={sites} sitesLoaded={sitesQ.isSuccess} />
          <DangerSection isLastWorkspace={workspaces.length <= 1} />
        </div>
      )}
    </main>
  );
}

/** Section card: tinted icon tile, heading and one-line explanation, then the control. */
function SectionCard({
  id,
  icon,
  tone,
  title,
  sub,
  aside,
  children,
}: {
  id: string;
  icon: ReactNode;
  tone: keyof typeof TONE;
  title: string;
  sub: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
}): ReactElement {
  return (
    <section id={`settings-${id}`} className={`${CARD} scroll-mt-20`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] ${TONE[tone]}`}
          >
            {icon}
          </span>
          <div className="min-w-0">
            <h2 className="text-[14.5px] font-semibold text-foreground">{title}</h2>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-subtle">{sub}</p>
          </div>
        </div>
        {aside}
      </div>
      {children && <div className="mt-4 flex min-w-0 flex-col gap-2.5 sm:pl-12">{children}</div>}
    </section>
  );
}

/** Title like every other tab, plus the workspace's role, sites and members. */
function PageHeader(): ReactElement {
  const { current } = useWorkspace();
  const isOwner = current?.role === 'owner';
  // The roster is owner-only on the server; members just don't see a count.
  const membersQ = useQuery({
    queryKey: ['members', current?.id],
    queryFn: () => api.getMembers(current!.id),
    enabled: !!current && isOwner,
    staleTime: 60_000,
  });
  const memberCount = ((membersQ.data as any)?.data as unknown[] | undefined)?.length;

  return (
    <div className="mb-6">
      <h1 className="text-[26px] font-bold text-foreground tracking-[-0.02em]">Settings</h1>
      {current ? (
        <>
          <p className="mt-1 text-[14px] text-subtle">
            For the <span className="font-semibold text-foreground">{current.name}</span> workspace
            {' · '}
            {current.siteCount} {current.siteCount === 1 ? 'site' : 'sites'}
            {memberCount !== undefined &&
              ` · ${memberCount} ${memberCount === 1 ? 'member' : 'members'}`}
          </p>
          {/* Said in words, not just a pill: what the role lets you do here. */}
          <p className="mt-2 text-[13.5px] text-muted-foreground">
            {current.role === 'owner' ? (
              <>
                You are an <span className="font-semibold text-foreground">owner</span> of this
                workspace, so you can rename it, set its timezone and delete it.
              </>
            ) : (
              <>
                You are a <span className="font-semibold text-foreground">member</span> of this
                workspace. You can view its dashboards; only an owner can change these settings.
              </>
            )}
          </p>
        </>
      ) : (
        <p className="mt-1 text-[14px] text-subtle">Workspace preferences.</p>
      )}
    </div>
  );
}

/** Owners only: rename. The page header shows the name to everyone. */
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
  const wsNameError = requiredTextError(name, 100, 'Workspace name');
  const dirty = name.trim() !== current.name;
  const nameChanged = !wsNameError && dirty;

  return (
    <SectionCard
      id="workspace"
      icon={<Pencil className="h-4 w-4" />}
      tone="brand"
      title="Workspace name"
      sub="Shown in the header switcher and on invitations."
    >
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-start"
        onSubmit={e => {
          e.preventDefault();
          if (nameChanged && !rename.isPending) rename.mutate();
        }}
      >
        <div className="w-full sm:max-w-[360px] sm:flex-1">
          <Input
            value={name}
            maxLength={100}
            aria-label="Workspace name"
            aria-invalid={!!wsNameError}
            onChange={e => setName(e.target.value)}
            className="h-10 px-4 text-[14px]"
          />
          <FieldError message={wsNameError} />
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="submit"
            disabled={!nameChanged || rename.isPending}
            isLoading={rename.isPending}
            className={PRIMARY}
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
          {dirty && !rename.isPending && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setName(current.name)}
              className="text-[13px] text-muted-foreground"
            >
              Cancel
            </Button>
          )}
        </div>
      </form>
      {error && <p className="text-[12px] text-[#e07a5f]">{error}</p>}
    </SectionCard>
  );
}

/** Current wall-clock time in `tz`, refreshed every 30s. */
function useZoneClock(tz: string): { time: string; day: string } | null {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!tz) return null;
  try {
    return {
      time: new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
      }).format(now),
      day: new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }).format(now),
    };
  } catch {
    return null;
  }
}

/**
 * One reporting zone for every site. Owners pick and apply it (the bulk
 * endpoint skips member workspaces); members see it read-only, since it
 * shapes every chart they read.
 */
function TimezoneSection({
  sites,
  sitesLoaded,
}: {
  sites: SiteRow[];
  sitesLoaded: boolean;
}): ReactElement | null {
  const queryClient = useQueryClient();
  const { current } = useWorkspace();
  const isOwner = current?.role === 'owner';
  const [timezone, setTimezone] = useState('');
  const [applied, setApplied] = useState(false);

  const zoneOf = (s: SiteRow): string => s.timezone || 'UTC';
  const distinctZones = [...new Set(sites.map(zoneOf))];
  const uniformZone = distinctZones.length === 1 ? distinctZones[0] : null;

  // Seed the picker once per workspace, as soon as its sites load: the
  // shared zone if uniform, else the browser's zone as the suggested value to
  // unify on. Keyed by workspace so switching re-seeds instead of carrying
  // the previous workspace's pick over.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!current || !sitesLoaded || sites.length === 0) return;
    if (seededFor.current === current.id) return;
    seededFor.current = current.id;
    setTimezone(uniformZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, sitesLoaded, sites]);

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
  const shownZone = isOwner ? timezone : (uniformZone ?? '');
  const clock = useZoneClock(shownZone);

  if (!current) return null;

  const clockChip = clock && (
    <div className="flex items-center gap-2 rounded-full bg-muted px-3 py-1.5">
      <Clock className="h-3.5 w-3.5 text-subtle" />
      <span className="text-[13px] font-semibold tabular-nums text-foreground">{clock.time}</span>
      <span className="text-[11.5px] text-subtle">{clock.day}</span>
    </div>
  );

  const siteList = sites.length > 0 && (
    <ul className="grid gap-1">
      {sites.map(s => {
        const zone = zoneOf(s);
        const willChange = isOwner && timezone !== '' && zone !== timezone;
        return (
          <li
            key={s.id}
            className="flex min-w-0 items-center justify-between gap-3 rounded-[10px] bg-background px-3 py-2"
          >
            <span className="flex min-w-0 items-center gap-2">
              <SiteFavicon favicon={s.favicon} size={16} fallbackClassName="text-subtle" />
              <span className="truncate text-[12.5px] text-foreground">{s.domain || s.name}</span>
            </span>
            <span
              title={zone}
              className={`min-w-0 truncate text-[12px] ${willChange ? 'font-medium text-coral-deep' : 'text-subtle'}`}
            >
              {zone}
              {willChange && ' · will change'}
            </span>
          </li>
        );
      })}
    </ul>
  );

  if (!isOwner) {
    return (
      <SectionCard
        id="timezone"
        icon={<Globe className="h-4 w-4" />}
        tone="brand"
        title="Reporting timezone"
        sub={
          uniformZone
            ? `${uniformZone} (${offsetLabel(uniformZone)}), set by the workspace owner.`
            : sites.length > 0
              ? 'Sites use different zones, set by the workspace owner.'
              : 'Set by the workspace owner.'
        }
        aside={clockChip}
      >
        {uniformZone === null && siteList}
      </SectionCard>
    );
  }

  return (
    <SectionCard
      id="timezone"
      icon={<Globe className="h-4 w-4" />}
      tone="brand"
      title="Reporting timezone"
      sub="Where every site's days and hours start and end on the dashboard."
      aside={clockChip}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <TimezoneSelect value={timezone} onChange={setTimezone} className="sm:w-[360px]" />
        <Button
          onClick={() => applyTimezone.mutate()}
          disabled={!timezoneChanged || applyTimezone.isPending || sites.length === 0}
          isLoading={applyTimezone.isPending}
          className={PRIMARY}
        >
          {applied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Applied
            </>
          ) : sites.length > 1 ? (
            `Apply to ${sites.length} sites`
          ) : (
            'Apply'
          )}
        </Button>
      </div>
      {sitesLoaded && sites.length === 0 && (
        <p className="text-[12px] text-subtle">Add a site first - the zone applies per site.</p>
      )}
      {siteList}
      {uniformZone === null && sites.length > 0 && (
        <p className="text-[12px] text-coral-deep">
          Your sites use different timezones ({distinctZones.join(', ')}). Applying puts them all on
          one.
        </p>
      )}
      {applyError && (
        <p className="text-[12px] text-[#e07a5f]">
          {applyError}. Nothing was changed. Check your connection and try again.
        </p>
      )}
      <p className="max-w-[520px] text-[11.5px] leading-relaxed text-subtle">
        Takes effect on new data within a minute. Already-collected events keep their original
        bucketing, so past days may look shifted until new data accumulates.
      </p>
    </SectionCard>
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
    <>
      <SectionCard
        id="danger"
        icon={isOwner ? <Trash2 className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}
        tone="coral"
        title={isOwner ? 'Delete workspace' : 'Leave workspace'}
        sub={
          isOwner
            ? current.siteCount > 0
              ? `${current.siteCount} ${
                  current.siteCount === 1 ? 'site still lives' : 'sites still live'
                } here - the workspace must be empty to delete.`
              : isLastWorkspace
                ? 'This is your only workspace; create another from the header switcher first.'
                : 'The workspace is empty. Members lose access and pending invites stop working.'
            : workspaces.length <= 1
              ? 'This is your only workspace here - leaving also removes your account on this instance.'
              : 'You give up access to its sites and dashboards. Your other workspaces are unaffected.'
        }
        aside={
          isOwner ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={remove.isPending}
              className="shrink-0 text-[12px] text-[#e07a5f] shadow-[inset_0_0_0_1px_#f1c9bd] hover:text-coral-deep hover:shadow-[inset_0_0_0_1px_#e8a996]"
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
              className="shrink-0 text-[12px] text-[#e07a5f] shadow-[inset_0_0_0_1px_#f1c9bd] hover:text-coral-deep hover:shadow-[inset_0_0_0_1px_#e8a996]"
            >
              <LogOut className="h-3.5 w-3.5" />
              Leave workspace
            </Button>
          )
        }
      >
        {error && <p className="text-[12px] text-[#e07a5f]">{error}</p>}
      </SectionCard>

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
          <DialogFooter className="mx-6 border-t border-border/50 px-0 pb-5 pt-4">
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
          <DialogFooter className="mx-6 border-t border-border/50 px-0 pb-5 pt-4">
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
    </>
  );
}
