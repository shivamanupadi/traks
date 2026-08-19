import { useState, type ReactElement } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Copy, Link2, LogOut, Mail, UserMinus, Users } from 'lucide-react';
import { emailError } from '@traks/shared';
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
import { api, ApiError } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { useWorkspace } from '@/lib/workspace';

export const Route = createFileRoute('/portal/members')({
  component: MembersPage,
});

type Role = 'owner' | 'member';

interface Member {
  userId: string;
  role: Role;
  email: string;
  name: string | null;
  joinedAt: string | null;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
}

const CARD = 'rounded-[20px] bg-white shadow-float';
const EYEBROW = 'text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#9B9590]';
const ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_110px_120px] items-center gap-3';

// Deterministic avatar tint per person - the chart palette, so the roster
// reads with the rest of the product.
const AVATAR_COLORS = ['#3D3B4F', '#5B9A6F', '#6B8EAD', '#D4A574', '#E07A5F'];

/**
 * Members (owner view): the roster as a table on the left - people, then
 * pending invites as dashed rows - and an always-visible invite panel on the
 * right. No dialog: the invite link appears in the panel, shown once.
 */
function MembersPage(): ReactElement {
  const { current } = useWorkspace();
  const isOwner = current?.role === 'owner';

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[26px] font-bold text-[#3D3B4F] tracking-[-0.02em]">Members</h1>
        <p className="mt-1 max-w-[62ch] text-[14px] text-[#9B9590]">
          {current ? `People with access to ${current.name}. ` : 'People with access. '}
          Members view dashboards; owners manage sites, tokens and invites.
        </p>
      </div>

      {isOwner && current ? (
        <OwnerView workspaceId={current.id} workspaceName={current.name} />
      ) : (
        <div className={`${CARD} max-w-[620px] px-8 py-14 text-center`}>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <Users className="h-6 w-6 text-[#9B9590]" strokeWidth={1.6} />
          </div>
          <p className="text-[15px] font-semibold text-[#3D3B4F]">Owners manage members</p>
          <p className="mx-auto mt-2 max-w-sm text-[13px] text-[#9B9590]">
            Only a workspace owner can view and invite members here.
          </p>
        </div>
      )}
    </main>
  );
}

function OwnerView({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}): ReactElement {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const myUserId: string | undefined = session?.user?.id;

  const [confirmMember, setConfirmMember] = useState<Member | null>(null);
  const [actionError, setActionError] = useState('');

  const membersQ = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => api.getMembers(workspaceId),
  });
  const members = ((membersQ.data as any)?.data ?? []) as Member[];

  const invitesQ = useQuery({
    queryKey: ['invitations', workspaceId],
    queryFn: () => api.getInvitations(workspaceId),
  });
  const invites = ((invitesQ.data as any)?.data ?? []) as Invite[];

  const removeMember = useMutation({
    // Self-removal is "leave" in the org plugin; removing others goes by email.
    mutationFn: (member: Member) =>
      member.userId === myUserId
        ? api.leaveWorkspace(workspaceId)
        : api.removeMember(workspaceId, member.email),
    onSuccess: (_res, member) => {
      setActionError('');
      setConfirmMember(null);
      queryClient.invalidateQueries({ queryKey: ['members', workspaceId] });
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
    mutationFn: (invitationId: string) => api.revokeInvitation(workspaceId, invitationId),
    onSuccess: () => {
      setActionError('');
      queryClient.invalidateQueries({ queryKey: ['invitations', workspaceId] });
    },
    onError: err =>
      setActionError(err instanceof ApiError ? err.message : 'Could not revoke the invite'),
  });

  const owners = members.filter(m => m.role === 'owner').length;

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      {/* Roster */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="flex items-center justify-between gap-3 px-5 pb-2.5 pt-4">
          <p className="text-[14px] font-semibold text-[#3D3B4F]">
            {members.length} {members.length === 1 ? 'member' : 'members'}
            <span className="font-normal text-[#9B9590]">
              {' '}
              · {owners} {owners === 1 ? 'owner' : 'owners'}
            </span>
          </p>
          <p className="text-[12px] text-[#9B9590]">
            {invites.length > 0
              ? `${invites.length} ${invites.length === 1 ? 'invite' : 'invites'} pending`
              : 'No pending invites'}
          </p>
        </div>

        {members.map((m, i) => {
          const isMe = m.userId === myUserId;
          return (
            <div
              key={m.userId}
              className={`${ROW_GRID} px-5 py-3 ${i ? 'border-t border-[#F2F1ED]' : ''}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={m.name || m.email} index={i} />
                <div className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-1.5 truncate text-[13.5px] font-semibold text-[#3D3B4F]">
                    {m.name || m.email.split('@')[0]}
                    {isMe && <span className="font-normal text-[#9B9590]">(you)</span>}
                  </span>
                  <span className="truncate text-[12px] text-[#9B9590]">
                    {m.email}
                    {m.joinedAt && <> · joined {formatDate(m.joinedAt)}</>}
                  </span>
                </div>
              </div>
              <div>
                <RolePill role={m.role} />
              </div>
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmMember(m)}
                  disabled={removeMember.isPending}
                  className="h-8 px-3 text-[12px] hover:text-[#e5484d]"
                >
                  {isMe ? (
                    <>
                      <LogOut className="h-3.5 w-3.5" />
                      Leave
                    </>
                  ) : (
                    'Remove'
                  )}
                </Button>
              </div>
            </div>
          );
        })}

        {members.length === 0 && (
          <p className="border-t border-[#F2F1ED] px-5 py-8 text-center text-[13px] text-[#9B9590]">
            {membersQ.isPending ? 'Loading…' : 'No members yet.'}
          </p>
        )}

        {invites.length > 0 && (
          <>
            <div className={`${EYEBROW} border-t border-[#F2F1ED] px-5 pb-1.5 pt-3.5`}>
              Pending invites
            </div>
            {invites.map(inv => (
              <div
                key={inv.id}
                className={`${ROW_GRID} border-t border-dashed border-[#E6E4DE] px-5 py-2.5`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-[#C7C6D2] text-[#9B9590]">
                    <Mail className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13.5px] font-medium text-[#6E6C7C]">
                      {inv.email}
                    </span>
                    <span className="flex items-center gap-1.5 text-[12px] text-[#9B9590]">
                      <Clock className="h-3 w-3" strokeWidth={1.8} />
                      Invite expires {formatRelative(inv.expiresAt)}
                    </span>
                  </div>
                </div>
                <div>
                  <RolePill role={inv.role === 'owner' ? 'owner' : 'member'} />
                </div>
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => revokeInvite.mutate(inv.id)}
                    disabled={revokeInvite.isPending}
                    className="h-8 px-3 text-[12px]"
                  >
                    Revoke
                  </Button>
                </div>
              </div>
            ))}
          </>
        )}
        {actionError && <p className="px-5 py-3 text-[12px] text-[#e07a5f]">{actionError}</p>}
        <div className="h-1.5" />
      </div>

      {/* Invite panel */}
      <InvitePanel workspaceId={workspaceId} />

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
                    ? `Leave ${workspaceName}?`
                    : `Remove ${confirmMember.name || confirmMember.email}?`}
                </DialogTitle>
                <DialogDescription>
                  {confirmMember.userId === myUserId
                    ? 'You immediately lose access to this workspace. As an owner, you can only leave while the workspace has another owner. If this was your only workspace on this instance, your account here is removed as well and you would need a new invitation to come back.'
                    : `${confirmMember.email} immediately loses access to ${workspaceName}. If this is their only workspace on this instance, their account here is removed entirely and a new invitation would be needed to bring them back. Sites and analytics data stay in the workspace.`}
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
    </div>
  );
}

/** Always-visible invite form; the created link replaces the form, shown once. */
function InvitePanel({ workspaceId }: { workspaceId: string }): ReactElement {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [role, setRole] = useState<Role>('member');
  const [inviteUrl, setInviteUrl] = useState('');
  const [invitedEmail, setInvitedEmail] = useState('');
  const [copied, setCopied] = useState(false);
  const emailErr = emailError(email);

  const createInvite = useMutation({
    mutationFn: () => api.createInvitation(workspaceId, { email: email.trim(), role }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['invitations', workspaceId] });
      setInvitedEmail(email.trim());
      setInviteUrl(`${window.location.origin}/invite/${result.token}`);
      setEmail('');
      setEmailTouched(false);
    },
  });

  const submit = (): void => {
    setEmailTouched(true);
    if (!emailErr && !createInvite.isPending) createInvite.mutate();
  };

  const reset = (): void => {
    setInviteUrl('');
    setInvitedEmail('');
    setCopied(false);
    setRole('member');
    createInvite.reset();
  };

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`${CARD} p-[22px]`}>
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-[#F2F1ED] text-[#3D3B4F]">
          <Users className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[14px] font-semibold text-[#3D3B4F]">Invite someone</span>
          <span className="text-[12px] text-[#9B9590]">
            You get a link to share - no email is sent
          </span>
        </div>
      </div>

      {inviteUrl ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-xl bg-[#E3F6EE] px-3.5 py-3">
            <Check className="h-4 w-4 shrink-0 text-[#1C9C6C]" />
            <p className="min-w-0 text-[12.5px] font-semibold text-[#123326]">
              Link for <span className="break-all">{invitedEmail}</span> - shown once.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-[14px] bg-[#F2F1ED] py-2.5 pl-3.5 pr-2.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-[#3D3B4F]">
              {inviteUrl}
            </code>
            <Button variant="dark" size="sm" onClick={() => void copy()} className="text-[12px]">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
          <p className="flex gap-2 text-[11.5px] leading-relaxed text-[#9B9590]">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#B5B0AA]" strokeWidth={1.8} />
            <span>
              Valid 7 days, single use, {role} role. Revoke it from the roster any time - it shows
              as pending until they accept.
            </span>
          </p>
          <Button variant="ghost" size="sm" onClick={reset} className="self-start text-[12px]">
            Invite someone else
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <Input
              type="email"
              placeholder="them@example.com"
              value={email}
              maxLength={256}
              aria-invalid={emailTouched && !!emailErr}
              onChange={e => setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
              className="h-11 px-4 text-[13.5px]"
            />
            {emailTouched && emailErr && <FieldError message={emailErr} />}
          </div>
          <div className="flex flex-col gap-2">
            <RoleChoice
              value="member"
              current={role}
              onChange={setRole}
              title="Member"
              desc="View dashboards and stats for every site here."
            />
            <RoleChoice
              value="owner"
              current={role}
              onChange={setRole}
              title="Owner"
              desc="Everything a member can, plus sites, tokens and invites."
            />
          </div>
          <Button type="submit" isLoading={createInvite.isPending} className="text-[13px]">
            <Link2 className="h-3.5 w-3.5" />
            Create invite link
          </Button>
          {createInvite.isError && (
            <p className="text-[12px] text-[#e5484d]">{createInvite.error.message}</p>
          )}
          <p className="text-[11.5px] leading-relaxed text-[#9B9590]">
            Valid 7 days, single use, only that email can accept it. The link is shown once.
          </p>
        </form>
      )}
    </div>
  );
}

function RoleChoice({
  value,
  current,
  onChange,
  title,
  desc,
}: {
  value: Role;
  current: Role;
  onChange: (r: Role) => void;
  title: string;
  desc: string;
}): ReactElement {
  const on = value === current;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`flex gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors cursor-pointer ${
        on ? 'bg-white shadow-[inset_0_0_0_1.5px_#3D3B4F]' : 'bg-[#F2F1ED] hover:bg-[#E6E4DE]'
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
          on ? 'bg-[#3D3B4F]' : 'shadow-[inset_0_0_0_1.5px_#C7C6D2]'
        }`}
      >
        {on && <span className="h-[5px] w-[5px] rounded-full bg-[#28E99F]" />}
      </span>
      <span className="flex flex-col">
        <span className="text-[13px] font-semibold text-[#3D3B4F]">{title}</span>
        <span className="text-[11.5px] leading-snug text-[#9B9590]">{desc}</span>
      </span>
    </button>
  );
}

function Avatar({ name, index }: { name: string; index: number }): ReactElement {
  const parts = name
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  const initials = (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
  return (
    <span
      className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tracking-[0.02em] text-white"
      style={{ background: AVATAR_COLORS[index % AVATAR_COLORS.length] }}
    >
      {initials}
    </span>
  );
}

function RolePill({ role }: { role: Role }): ReactElement {
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

function formatRelative(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'now';
  const days = Math.round(ms / 86_400_000);
  if (days >= 1) return `in ${days} ${days === 1 ? 'day' : 'days'}`;
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}
