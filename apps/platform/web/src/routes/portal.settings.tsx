import { useState, useEffect, type ReactElement } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Globe, Layers, Pencil, Trash2, User, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TimezoneSelect } from '@/components/ui/timezone-select';
import { authClient } from '@/lib/auth-client';
import { api } from '@/lib/api';
import { useWorkspace, type Workspace } from '@/lib/workspace';

export const Route = createFileRoute('/portal/settings')({
  component: SettingsPage,
});

function SettingsPage(): ReactElement {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const [timezone, setTimezone] = useState('');
  const [applied, setApplied] = useState(false);

  const { data: sitesData } = useQuery({
    queryKey: ['sites'],
    queryFn: () => api.getSites(),
    staleTime: 60_000,
  });

  const sites = ((sitesData as any)?.data ?? []) as { timezone?: string }[];
  const distinctZones = [...new Set(sites.map(s => s.timezone || 'UTC'))];
  const uniformZone = distinctZones.length === 1 ? distinctZones[0] : null;

  const email: string | undefined = session?.user?.email;
  const displayName = session?.user?.name || email?.split('@')[0] || 'User';

  // Seed the picker once sites load: the shared zone if uniform, else the
  // browser's zone as the suggested value to unify on.
  useEffect(() => {
    if (sites.length > 0 && timezone === '') {
      setTimezone(uniformZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitesData]);

  const applyTimezone = useMutation({
    mutationFn: () => api.setAllSitesTimezone(timezone),
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

  const signOut = async (): Promise<void> => {
    await authClient.signOut();
    window.location.href = '/';
  };

  const timezoneChanged = timezone !== '' && (uniformZone === null || timezone !== uniformZone);

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-[26px] font-bold text-[#3D3B4F] tracking-[-0.02em]">Settings</h1>
        <p className="mt-1 text-[14px] text-[#9B9590]">Preferences for your account and sites</p>
      </div>

      <div className="flex max-w-[620px] flex-col gap-7">
        {/* Account */}
        <section>
          <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#9B9590]">
            Account
          </p>
          <div className="rounded-[20px] bg-white p-6 shadow-float">
            <div className="flex items-center gap-3.5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted">
                <User className="h-5 w-5 text-foreground" strokeWidth={1.8} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14.5px] font-bold text-[#3D3B4F]">{displayName}</p>
                <p className="mt-0.5 truncate text-[12.5px] text-[#9B9590]">{email}</p>
              </div>
              <span className="mr-2 rounded-full bg-muted px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.07em] text-foreground">
                Owner
              </span>
              <Button
                variant="outline"
                onClick={() => void signOut()}
                className="h-9 px-4 text-[12.5px]"
              >
                Sign out
              </Button>
            </div>
          </div>
        </section>

        {/* Workspaces */}
        <WorkspacesSection />

        {/* Timezone */}
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
                  Dashboard days and hours are bucketed in this timezone. Applies to all your sites.
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
                  'Apply to all sites'
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
                Your sites currently use different timezones ({distinctZones.join(', ')}). Applying
                will unify them.
              </p>
            )}
            <p className="mt-3.5 border-t border-[#F5F2EC] pt-3.5 text-[12px] text-[#B5B0AA]">
              Takes effect on new data within a minute. Events already collected keep their original
              bucketing, so past days may look shifted until new data accumulates.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function WorkspacesSection(): ReactElement {
  const { workspaces } = useWorkspace();

  return (
    <section>
      <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#9B9590]">
        Workspaces
      </p>
      <div className="rounded-[20px] bg-white p-6 shadow-float">
        <div className="flex items-center gap-3.5">
          <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] bg-muted">
            <Layers className="h-[17px] w-[17px] text-foreground" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold text-[#3D3B4F]">Your workspaces</p>
            <p className="mt-0.5 text-[12px] text-[#9B9590]">
              Workspaces group your sites. Create new ones from the switcher in the header.
            </p>
          </div>
        </div>

        <ul className="mt-4 divide-y divide-[#F5F2EC]">
          {workspaces.map(ws => (
            <WorkspaceRow key={ws.id} workspace={ws} isOnly={workspaces.length === 1} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function WorkspaceRow({
  workspace,
  isOnly,
}: {
  workspace: Workspace;
  isOnly: boolean;
}): ReactElement {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(workspace.name);

  const rename = useMutation({
    mutationFn: () => api.updateWorkspace(workspace.id, { name: name.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      setEditing(false);
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteWorkspace(workspace.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });

  const isOwner = workspace.role === 'owner';
  // An empty workspace is the only deletable kind (the API refuses otherwise).
  const canDelete = isOwner && !isOnly && workspace.siteCount === 0;
  const canRename = name.trim().length > 0 && !rename.isPending;
  const error = rename.isError
    ? (rename.error as Error).message
    : remove.isError
      ? (remove.error as Error).message
      : '';

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        {editing ? (
          <>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              className="h-9 px-3 text-[13.5px]"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && canRename) rename.mutate();
                if (e.key === 'Escape') {
                  setName(workspace.name);
                  setEditing(false);
                }
              }}
            />
            <Button
              onClick={() => rename.mutate()}
              disabled={!canRename}
              isLoading={rename.isPending}
              className="h-9 shrink-0 px-4 text-[12.5px]"
            >
              <Check className="h-3.5 w-3.5" />
              Save
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setName(workspace.name);
                setEditing(false);
              }}
              className="h-9 w-9 shrink-0 p-0"
              aria-label="Cancel rename"
            >
              <X className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold text-[#3D3B4F]">
                {workspace.name}
              </p>
              <p className="mt-0.5 text-[12px] text-[#9B9590]">
                {workspace.siteCount} {workspace.siteCount === 1 ? 'site' : 'sites'}
              </p>
            </div>
            <span className="rounded-full bg-muted px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.07em] text-foreground">
              {workspace.role}
            </span>
            {isOwner && (
              <Button
                variant="outline"
                onClick={() => setEditing(true)}
                className="h-9 w-9 shrink-0 p-0"
                aria-label={`Rename ${workspace.name}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {canDelete && (
              <Button
                variant="outline"
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
                className="h-9 w-9 shrink-0 p-0 text-[#e5484d] hover:text-[#e5484d]"
                aria-label={`Delete ${workspace.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        )}
      </div>
      {error && <p className="mt-2 text-[12px] text-[#e07a5f]">{error}</p>}
    </li>
  );
}
