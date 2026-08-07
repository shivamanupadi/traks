import { useState, type ReactElement } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, LogOut, UserMinus, UserPlus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { useWorkspace } from '@/lib/workspace';

export function MembersSection(): ReactElement | null {
  const { current } = useWorkspace();
  const { data: session } = authClient.useSession();
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmMember, setConfirmMember] = useState<{
    userId: string;
    email: string;
    name: string | null;
  } | null>(null);
  const [actionError, setActionError] = useState('');

  const workspaceId = current?.id;
  const isOwner = current?.role === 'owner';
  const myUserId: string | undefined = session?.user?.id;

  const { data: membersData } = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => api.getMembers(workspaceId!),
    enabled: !!workspaceId,
  });
  const members = ((membersData as any)?.data ?? []) as {
    userId: string;
    role: 'owner' | 'member';
    email: string;
    name: string | null;
  }[];

  const { data: invitesData } = useQuery({
    queryKey: ['invitations', workspaceId],
    queryFn: () => api.getInvitations(workspaceId!),
    enabled: !!workspaceId && isOwner,
  });
  const invites = ((invitesData as any)?.data ?? []) as {
    id: string;
    email: string;
    role: string;
    expiresAt: string;
  }[];

  const removeMember = useMutation({
    // Self-removal is "leave" in the org plugin; removing others goes by email.
    mutationFn: (member: { userId: string; email: string }) =>
      member.userId === myUserId
        ? api.leaveWorkspace(workspaceId!)
        : api.removeMember(workspaceId!, member.email),
    onSuccess: (_res, member) => {
      setActionError('');
      setConfirmMember(null);
      queryClient.invalidateQueries({ queryKey: ['members', workspaceId] });
      // Leaving the workspace yourself: your workspace list changed too.
      if (member.userId === myUserId) {
        queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      }
    },
    onError: err => {
      setConfirmMember(null);
      setActionError(err instanceof ApiError ? err.message : 'Could not remove the member');
    },
  });

  const revokeInvite = useMutation({
    mutationFn: (invitationId: string) => api.revokeInvitation(workspaceId!, invitationId),
    onSuccess: () => {
      setActionError('');
      queryClient.invalidateQueries({ queryKey: ['invitations', workspaceId] });
    },
    onError: err =>
      setActionError(err instanceof ApiError ? err.message : 'Could not revoke the invite'),
  });

  // Owners only: members don't get the workspace roster.
  if (!current || current.role !== 'owner') return null;

  return (
    <section>
      <div className="rounded-[20px] bg-white p-6 shadow-float">
        <div className="flex items-center gap-3.5">
          <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] bg-muted">
            <Users className="h-[17px] w-[17px] text-foreground" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold text-[#3D3B4F]">Who has access</p>
            <p className="mt-0.5 text-[12px] text-[#9B9590]">
              Members can view dashboards; owners manage sites and invites.
            </p>
          </div>
          {isOwner && (
            <Button onClick={() => setInviteOpen(true)} className="h-9 shrink-0 px-4 text-[12.5px]">
              <UserPlus className="h-3.5 w-3.5" />
              Invite
            </Button>
          )}
        </div>

        <ul className="mt-4 divide-y divide-[#F5F2EC]">
          {members.map(m => (
            <li key={m.userId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-[#3D3B4F]">
                  {m.name || m.email.split('@')[0]}
                  {m.userId === myUserId && (
                    <span className="ml-1.5 font-normal text-[#9B9590]">(you)</span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-[12px] text-[#9B9590]">{m.email}</p>
              </div>
              <span className="rounded-full bg-muted px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.07em] text-foreground">
                {m.role}
              </span>
              {(isOwner || m.userId === myUserId) && (
                <Button
                  variant="outline"
                  onClick={() => setConfirmMember(m)}
                  disabled={removeMember.isPending}
                  className="h-8 px-3 text-[12px] text-[#e5484d] hover:text-[#e5484d]"
                >
                  {m.userId === myUserId ? 'Leave' : 'Remove'}
                </Button>
              )}
            </li>
          ))}
        </ul>

        {isOwner && invites.length > 0 && (
          <>
            <p className="mt-5 mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#B5B0AA]">
              Pending invites
            </p>
            <ul className="divide-y divide-[#F5F2EC]">
              {invites.map(inv => (
                <li key={inv.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-[#B5B0AA]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-[#3D3B4F]">
                      {inv.email}
                      <span className="ml-1.5 text-[11.5px] text-[#9B9590]">as {inv.role}</span>
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-[#B5B0AA]">
                      Expires {new Date(inv.expiresAt).toLocaleDateString()} · link visible only
                      when created
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => revokeInvite.mutate(inv.id)}
                    disabled={revokeInvite.isPending}
                    className="h-8 px-3 text-[12px]"
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}

        {actionError && <p className="mt-3 text-[12px] text-[#e07a5f]">{actionError}</p>}
      </div>

      {workspaceId && (
        <InviteDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          workspaceId={workspaceId}
          workspaceName={current.name}
        />
      )}

      <Dialog open={!!confirmMember} onOpenChange={open => !open && setConfirmMember(null)}>
        <DialogContent onClose={() => setConfirmMember(null)} className="max-w-md">
          {confirmMember && (
            <>
              <DialogHeader>
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#e07a5f]/10">
                  {confirmMember.userId === myUserId ? (
                    <LogOut className="h-5 w-5 text-[#e07a5f]" strokeWidth={1.7} />
                  ) : (
                    <UserMinus className="h-5 w-5 text-[#e07a5f]" strokeWidth={1.7} />
                  )}
                </div>
                <DialogTitle>
                  {confirmMember.userId === myUserId
                    ? `Leave ${current.name}?`
                    : `Remove ${confirmMember.name || confirmMember.email}?`}
                </DialogTitle>
                <DialogDescription>
                  {confirmMember.userId === myUserId
                    ? 'You immediately lose access to this workspace. As an owner, you can only leave while the workspace has another owner. If this was your only workspace on this instance, your account here is removed as well and you would need a new invitation to come back.'
                    : `${confirmMember.email} immediately loses access to ${current.name}. If this is their only workspace on this instance, their account here is removed entirely and a new invitation would be needed to bring them back. Sites and analytics data stay in the workspace.`}
                </DialogDescription>
              </DialogHeader>

              <DialogFooter className="mx-6 border-t border-[#e6e5ea]/50 px-0 pb-5 pt-4">
                <Button
                  variant="ghost"
                  onClick={() => setConfirmMember(null)}
                  className="text-[13px] cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => removeMember.mutate(confirmMember)}
                  isLoading={removeMember.isPending}
                  className="bg-coral hover:bg-[#d06a4f] text-white shadow-none text-[13px] px-5 cursor-pointer"
                >
                  {confirmMember.userId === myUserId ? (
                    <>
                      <LogOut className="h-3.5 w-3.5" />
                      Leave workspace
                    </>
                  ) : (
                    <>
                      <UserMinus className="h-3.5 w-3.5" />
                      Remove member
                    </>
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workspaceName: string;
}): ReactElement {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'owner'>('member');
  const [inviteUrl, setInviteUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const createInvite = useMutation({
    mutationFn: () => api.createInvitation(workspaceId, { email: email.trim(), role }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['invitations', workspaceId] });
      setInviteUrl(`${window.location.origin}/invite/${result.token}`);
    },
  });

  const handleClose = (): void => {
    onOpenChange(false);
    setTimeout(() => {
      setEmail('');
      setRole('member');
      setInviteUrl('');
      setCopied(false);
      createInvite.reset();
    }, 200);
  };

  const handleCopy = async (): Promise<void> => {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent onClose={handleClose} className="max-w-md">
        <DialogHeader>
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
            <UserPlus className="h-5 w-5 text-foreground" strokeWidth={1.7} />
          </div>
          <DialogTitle>Invite to {workspaceName}</DialogTitle>
          <DialogDescription>
            {inviteUrl
              ? 'Share this link with them however you like — chat, text, carrier pigeon. This instance doesn’t send emails.'
              : 'Creates an invite link, valid for 7 days. Only the invited email can use it.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {inviteUrl ? (
            <div className="relative overflow-hidden rounded-xl border border-[#e6e5ea] bg-[#fafafa]">
              <div className="flex items-center justify-between border-b border-[#e6e5ea]/60 px-4 py-2.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#B5B0AA]">
                  Invite link — shown once
                </span>
                <button
                  onClick={() => void handleCopy()}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium text-[#9B9590] transition-colors hover:text-foreground"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3 text-[#6E6C7C]" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>
              <pre className="select-all whitespace-pre-wrap break-all px-4 py-3.5 font-mono text-[12px] leading-relaxed text-[#3D3B4F]">
                {inviteUrl}
              </pre>
            </div>
          ) : (
            <div>
              <label className="mb-2 block text-[13px] font-medium text-[#3D3B4F]">Email</label>
              <Input
                type="email"
                placeholder="them@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="h-11 px-4 text-[14px]"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter' && email.trim() && !createInvite.isPending)
                    createInvite.mutate();
                }}
              />
              <p className="mt-2 text-[12px] text-[#B5B0AA]">
                Only this email will be able to use the invite.
              </p>

              <label className="mt-4 mb-2 block text-[13px] font-medium text-[#3D3B4F]">Role</label>
              <div className="flex gap-2">
                {(
                  [
                    { value: 'member', label: 'Member', hint: 'View dashboards and stats' },
                    { value: 'owner', label: 'Owner', hint: 'Manage sites, invite people' },
                  ] as const
                ).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setRole(opt.value)}
                    className={`flex-1 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      role === opt.value
                        ? 'border-[#3D3B4F] bg-[#3D3B4F]/[0.04]'
                        : 'border-[#e6e5ea] hover:border-[#c9c8d4]'
                    }`}
                  >
                    <span className="block text-[13px] font-semibold text-[#3D3B4F]">
                      {opt.label}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-[#9B9590]">{opt.hint}</span>
                  </button>
                ))}
              </div>
              {createInvite.isError && (
                <p className="mt-3 text-[13px] text-[#e5484d]">{createInvite.error.message}</p>
              )}
            </div>
          )}
        </DialogBody>

        <DialogFooter className="mx-6 border-t border-[#e6e5ea]/50 px-0 pb-5 pt-4">
          {inviteUrl ? (
            <>
              <Button
                variant="ghost"
                onClick={() => void handleCopy()}
                className="rounded-xl text-[13px]"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? 'Copied!' : 'Copy link'}
              </Button>
              <Button onClick={handleClose} className="text-[13px] px-5">
                <Check className="h-3.5 w-3.5" />
                Done
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={handleClose} className="rounded-xl text-[13px]">
                Cancel
              </Button>
              <Button
                onClick={() => createInvite.mutate()}
                disabled={!email.trim()}
                isLoading={createInvite.isPending}
                className="text-[13px] px-5"
              >
                <Link2 className="h-3.5 w-3.5" />
                Create link
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
