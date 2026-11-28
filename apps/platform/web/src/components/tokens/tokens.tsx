import { useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Eye, PenLine, Plus } from 'lucide-react';
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
import { api } from '@/lib/api';

/** Shared by the API tokens tab and the MCP server page's token step. */

export type TokenScope = 'read' | 'manage';

/** A token as listed by the API: metadata only, never the secret. */
export interface TokenRow {
  id: string;
  name: string;
  suffix: string;
  scope: TokenScope;
  /** null = legacy token from before tokens were workspace-bound. */
  workspaceId: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
}

/** Server-side cap on tokens per person, across all their workspaces. */
export const TOKEN_LIMIT = 10;

/** A token's display form: the prefix plus the only part we keep, its suffix. */
export function maskedToken(suffix: string): string {
  return `traks_pat_…${suffix}`;
}

/**
 * Name + scope, then mint. The secret comes back once, in the create
 * response, and is handed to `onCreated` - after that only the suffix exists.
 */
export function CreateTokenModal({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
  defaultName,
  hint,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workspaceName: string;
  /** Placeholder suggestion, e.g. the MCP client being set up. */
  defaultName?: string;
  /** Extra line under the scope choice, e.g. where the new token will go. */
  hint?: ReactNode;
  onCreated: (token: TokenRow, secret: string) => void;
}): ReactElement {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<TokenScope>('manage');

  const create = useMutation({
    mutationFn: () => api.createToken({ name: name.trim(), scope, workspaceId }),
    onSuccess: (result: any) => {
      onCreated(
        { lastUsedAt: null, ...(result.data as Omit<TokenRow, 'lastUsedAt'>) },
        result.secret as string
      );
      setName('');
      setScope('manage');
      onOpenChange(false);
    },
  });

  const close = (): void => {
    create.reset();
    onOpenChange(false);
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (name.trim()) create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={o => (o ? onOpenChange(true) : close())}>
      <DialogContent onClose={close} className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create a token</DialogTitle>
          <DialogDescription>
            Works with {workspaceName} only. You&rsquo;ll see the full token once, right after
            creating it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody>
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-semibold text-muted-foreground">
                  Name
                </span>
                <Input
                  autoFocus
                  placeholder={defaultName || 'e.g. Claude Code'}
                  value={name}
                  maxLength={100}
                  onChange={e => setName(e.target.value)}
                  className="h-10 bg-muted px-4 text-[13px] focus:shadow-[inset_0_0_0_1.5px_var(--ring)]"
                />
              </label>
              <div>
                <span className="mb-1.5 block text-[12px] font-semibold text-muted-foreground">
                  Scope
                </span>
                <ScopeToggle value={scope} onChange={setScope} />
                <p className="mt-2 text-[12px] leading-relaxed text-subtle">
                  Manage can create and edit goals and funnels. Read-only sees stats.
                  {hint && <> {hint}</>}
                </p>
              </div>
              {create.error && (
                <p className="text-[12px] text-[#e07a5f]">{(create.error as Error).message}</p>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={name.trim().length === 0}
              isLoading={create.isPending}
              className="text-[12px] px-4"
            >
              <Plus className="h-3.5 w-3.5" />
              Create token
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Flat two-way switch: inset track, white active segment with a hairline. */
export function ScopeToggle({
  value,
  onChange,
}: {
  value: TokenScope;
  onChange: (s: TokenScope) => void;
}): ReactElement {
  const seg = (s: TokenScope, label: string): ReactElement => (
    <button
      type="button"
      onClick={() => onChange(s)}
      aria-pressed={value === s}
      className={`rounded-full px-3 py-[5px] text-[12px] transition-colors cursor-pointer ${
        value === s
          ? 'bg-card font-semibold text-foreground shadow-[inset_0_0_0_1px_var(--border)]'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex rounded-full bg-muted p-[3px]">
      {seg('manage', 'Manage')}
      {seg('read', 'Read-only')}
    </div>
  );
}

/**
 * What a token (or tool) is allowed to do - a label, not a control: square-ish
 * corners, a tint instead of a solid fill, and an icon for the permission.
 */
export function ScopePill({ scope }: { scope: TokenScope }): ReactElement {
  return scope === 'manage' ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-[6px] bg-[#28E99F]/20 px-1.5 py-0.5 text-[11px] font-medium text-foreground">
      <PenLine className="h-3 w-3" strokeWidth={2} aria-hidden />
      Manage
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-[6px] bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      <Eye className="h-3 w-3" strokeWidth={2} aria-hidden />
      Read-only
    </span>
  );
}

/** "Today, 10:32" / "Yesterday" / "Sep 3" / "Sep 3, 2025". */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `Today, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}
