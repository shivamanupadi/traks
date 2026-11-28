import { useState, type ReactElement, type ReactNode } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  Copy,
  EyeOff,
  KeyRound,
  Layers,
  Plus,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  CreateTokenModal,
  ScopePill,
  TOKEN_LIMIT,
  formatWhen,
  maskedToken,
  type TokenRow,
} from '@/components/tokens/tokens';
import { api } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';

export const Route = createFileRoute('/portal/tokens')({
  component: TokensPage,
});

const CARD = 'rounded-[20px] bg-card shadow-float';

/**
 * API tokens: personal bearer tokens that agents and scripts use against the
 * API and the MCP server. Each is bound to one workspace, so this tab lists
 * the ones for the current workspace (plus legacy unscoped ones, which still
 * work everywhere and must stay revocable). The server caps tokens per person
 * across all workspaces, so the count shown is the all-workspaces one.
 */
function TokensPage(): ReactElement {
  const queryClient = useQueryClient();
  const { current } = useWorkspace();
  const [creating, setCreating] = useState(false);
  /** The one moment a full token exists client-side: right after creating. */
  const [fresh, setFresh] = useState<{ token: TokenRow; secret: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // All of the person's tokens: the list filters to this workspace, the
  // limit counts across every workspace (that's how the server enforces it).
  const tokensQ = useQuery({
    queryKey: ['api-tokens', 'all'],
    queryFn: () => api.getTokens(),
    staleTime: 60_000,
  });
  const all = ((tokensQ.data as any)?.data ?? []) as TokenRow[];
  const tokens = current
    ? all.filter(t => t.workspaceId === current.id || t.workspaceId === null)
    : [];
  const atLimit = all.length >= TOKEN_LIMIT;

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeToken(id),
    onSuccess: (_res, id) => {
      setConfirmId(null);
      if (fresh?.token.id === id) setFresh(null);
      // Prefix match: also refreshes the MCP page's per-workspace list.
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6 flex max-w-4xl flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold text-foreground tracking-[-0.02em]">API tokens</h1>
          <p className="mt-1 max-w-[62ch] text-[14px] text-subtle">
            Let agents and scripts read {current ? current.name : 'this workspace'}&rsquo;s
            analytics through the API and the{' '}
            <Link
              to="/portal/mcp"
              className="font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              MCP server
            </Link>
            . Tokens are personal: each person creates their own.
          </p>
        </div>
        <Button
          variant="dark"
          onClick={() => setCreating(true)}
          disabled={!current || atLimit}
          title={
            atLimit ? `You have ${TOKEN_LIMIT} tokens - revoke one to create another` : undefined
          }
          className="text-[13px] px-5"
        >
          <Plus className="h-4 w-4" />
          Create token
        </Button>
      </div>

      <div className="max-w-4xl space-y-4">
        {fresh && (
          <NewTokenPanel
            token={fresh.token}
            secret={fresh.secret}
            onDismiss={() => setFresh(null)}
          />
        )}

        <section className={CARD}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3 pt-4 sm:px-6">
            <h2 className="text-[14.5px] font-semibold text-foreground">
              Your tokens
              {current && <span className="ml-1.5 font-normal text-subtle">in {current.name}</span>}
            </h2>
            {tokensQ.isSuccess && (
              <span
                className={`text-[12px] tabular-nums ${atLimit ? 'font-medium text-coral-deep' : 'text-subtle'}`}
                title="Across all your workspaces"
              >
                {all.length} of {TOKEN_LIMIT} used
              </span>
            )}
          </div>
          {error && <p className="px-5 pb-2 text-[12px] text-[#e07a5f] sm:px-6">{error}</p>}

          {tokensQ.isPending ? (
            <div className="space-y-2 px-5 pb-5 sm:px-6">
              {[0, 1].map(i => (
                <div key={i} className="h-[58px] animate-pulse rounded-[14px] bg-muted" />
              ))}
            </div>
          ) : tokensQ.isError ? (
            <p className="px-5 pb-8 pt-4 text-center text-[13px] text-[#e07a5f] sm:px-6">
              Couldn&rsquo;t load your tokens. Refresh to try again.
            </p>
          ) : tokens.length === 0 ? (
            <div className="flex flex-col items-center px-5 pb-10 pt-6 text-center">
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-[12px] bg-[#28E99F]/20 text-foreground">
                <KeyRound className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </span>
              <p className="text-[13.5px] font-semibold text-foreground">No tokens yet</p>
              <p className="mt-1 max-w-[44ch] text-[12.5px] leading-relaxed text-subtle">
                Create one to connect Claude Code or another agent, then follow the setup on the MCP
                server tab.
              </p>
            </div>
          ) : (
            <ul className="border-t border-muted">
              {tokens.map(t => (
                <TokenItem
                  key={t.id}
                  token={t}
                  isNew={fresh?.token.id === t.id}
                  confirming={confirmId === t.id}
                  revoking={revoke.isPending && revoke.variables === t.id}
                  onAskRevoke={() => {
                    setError('');
                    setConfirmId(t.id);
                  }}
                  onCancel={() => setConfirmId(null)}
                  onRevoke={() => revoke.mutate(t.id)}
                />
              ))}
            </ul>
          )}
        </section>

        <section className={`${CARD} grid gap-4 p-5 sm:grid-cols-3 sm:p-6`}>
          <Fact icon={<EyeOff className="h-4 w-4" />} title="Shown once">
            Copy a token when you create it. Afterwards only its last four characters are shown.
          </Fact>
          <Fact icon={<Layers className="h-4 w-4" />} title="One workspace each">
            A token only reaches the sites in the workspace it was created in.
          </Fact>
          <Fact icon={<ShieldCheck className="h-4 w-4" />} title="Manage or read-only">
            Manage can create and edit goals and funnels. Read-only sees stats. Revoking works
            immediately.
          </Fact>
        </section>
      </div>

      {current && (
        <CreateTokenModal
          open={creating}
          onOpenChange={setCreating}
          workspaceId={current.id}
          workspaceName={current.name}
          onCreated={(token, secret) => {
            setFresh({ token, secret });
            queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
          }}
        />
      )}
    </main>
  );
}

/** One token: identity, scope, when it was used and made, and revoke. */
function TokenItem({
  token,
  isNew,
  confirming,
  revoking,
  onAskRevoke,
  onCancel,
  onRevoke,
}: {
  token: TokenRow;
  isNew: boolean;
  confirming: boolean;
  revoking: boolean;
  onAskRevoke: () => void;
  onCancel: () => void;
  onRevoke: () => void;
}): ReactElement {
  return (
    <li
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-muted px-5 py-3.5 last:border-b-0 sm:px-6 ${
        confirming ? 'bg-coral-soft' : ''
      }`}
    >
      <div className="flex min-w-0 flex-1 basis-[240px] items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[#28E99F]/20 text-foreground">
          <KeyRound className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-semibold text-foreground">
              {token.name}
            </span>
            {isNew && (
              <span className="shrink-0 rounded-full bg-[#28E99F]/20 px-2 py-0.5 text-[10.5px] font-semibold text-foreground">
                New
              </span>
            )}
          </p>
          <p className="truncate font-mono text-[11.5px] text-subtle">
            {maskedToken(token.suffix)}
            {token.workspaceId === null && (
              <span className="ml-2 font-sans">· works in all workspaces (older token)</span>
            )}
          </p>
        </div>
      </div>

      {confirming ? (
        <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto">
          <p className="text-[12.5px] text-coral-deep">
            Revoke? Anything using it stops working right away.
          </p>
          <div className="flex gap-1">
            <button
              onClick={onCancel}
              className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-muted-foreground hover:bg-card transition-colors cursor-pointer"
            >
              Keep
            </button>
            <button
              onClick={onRevoke}
              disabled={revoking}
              className="rounded-full bg-[#e07a5f] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#c9694f] transition-colors cursor-pointer disabled:opacity-60"
            >
              {revoking ? 'Revoking…' : 'Revoke'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="sm:w-[84px]">
            <ScopePill scope={token.scope} />
          </div>
          <div className="min-w-0 flex-1 text-[12px] leading-snug sm:w-[150px] sm:flex-none">
            <p className={`truncate ${token.lastUsedAt ? 'text-muted-foreground' : 'text-faint'}`}>
              {token.lastUsedAt ? `Used ${formatWhen(token.lastUsedAt)}` : 'Never used'}
            </p>
            {token.createdAt && (
              <p className="truncate text-faint">Created {formatWhen(token.createdAt)}</p>
            )}
          </div>
          <button
            onClick={onAskRevoke}
            className="ml-auto shrink-0 rounded-full border border-border px-3 py-1.5 text-[12px] font-semibold text-muted-foreground hover:border-[#f1c9bd] hover:bg-coral-soft hover:text-coral-deep transition-colors cursor-pointer"
          >
            Revoke
          </button>
        </>
      )}
    </li>
  );
}

/**
 * The only time the full token can be shown: straight after it's created.
 * Stays until dismissed or the page is left.
 */
function NewTokenPanel({
  token,
  secret,
  onDismiss,
}: {
  token: TokenRow;
  secret: string;
  onDismiss: () => void;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    navigator.clipboard
      .writeText(secret)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Clipboard refused: select the token so ⌘C is one keystroke away.
        const el = document.getElementById('new-token-secret');
        if (el) window.getSelection()?.selectAllChildren(el);
      });
  };

  return (
    <section
      className={`${CARD} relative p-5 shadow-[inset_0_0_0_1.5px_rgba(40,233,159,0.55),0_1px_2px_rgba(61,59,79,0.04),0_10px_32px_rgba(61,59,79,0.07)] sm:p-6`}
      aria-live="polite"
    >
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-3 rounded-full p-1.5 text-subtle hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
      >
        <X className="h-4 w-4" />
      </button>
      <h2 className="pr-8 text-[14.5px] font-semibold text-foreground">
        Copy &ldquo;{token.name}&rdquo; now
      </h2>
      <p className="mt-0.5 text-[12.5px] text-subtle">
        This is the only time the full token is shown. Put it in your agent&rsquo;s config before
        you leave this page.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code
          id="new-token-secret"
          className="min-w-0 flex-1 select-all break-all rounded-[12px] bg-muted px-3.5 py-2.5 font-mono text-[12.5px] text-foreground"
        >
          {secret}
        </code>
        <Button onClick={copy} className="shrink-0 px-4 text-[12.5px] shadow-none">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy token'}
        </Button>
      </div>
      <Link
        to="/portal/mcp"
        className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"
      >
        Connect a client on the MCP server tab
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
}

function Fact({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-subtle">{children}</p>
      </div>
    </div>
  );
}
