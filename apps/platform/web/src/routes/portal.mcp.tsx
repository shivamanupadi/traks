import { useState, type ReactElement } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Download, KeyRound, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { useCollectUrl } from '@/lib/config';
import { skillMarkdown } from '@/lib/skill';

export const Route = createFileRoute('/portal/mcp')({
  component: McpPage,
});

interface TokenRow {
  id: string;
  name: string;
  suffix: string;
  scope: 'read' | 'manage';
  workspaceId: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
}

type Scope = 'read' | 'manage';

const CARD = 'rounded-[20px] bg-white shadow-float';
const EYEBROW = 'text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#9B9590]';

/**
 * MCP server: a three-step "connect a coding agent" strip (mint a token →
 * add the MCP server → hand over the skill) over a quiet table of the
 * tokens bound to the current workspace.
 */
function McpPage(): ReactElement {
  const queryClient = useQueryClient();
  const { current } = useWorkspace();
  const origin = window.location.origin;
  const collectUrl = useCollectUrl();

  const [name, setName] = useState('');
  const [scope, setScope] = useState<Scope>('manage');
  const [created, setCreated] = useState<{ name: string; secret: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Only this workspace's tokens (plus legacy unscoped ones, which apply
  // everywhere and must stay revocable from somewhere).
  const tokensQ = useQuery({
    queryKey: ['api-tokens', current?.id],
    queryFn: () => api.getTokens(current!.id),
    enabled: Boolean(current),
    staleTime: 60_000,
  });
  const tokens = ((tokensQ.data as any)?.data ?? []) as TokenRow[];

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
  };

  const createToken = useMutation({
    mutationFn: () => api.createToken({ name: name.trim(), scope, workspaceId: current!.id }),
    onSuccess: (result: any) => {
      setCreated({ name: result.data?.name ?? name.trim(), secret: result.secret as string });
      setName('');
      setError('');
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const revokeToken = useMutation({
    mutationFn: (tokenId: string) => api.revokeToken(tokenId),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });

  const copy = async (text: string, tag: string): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setCopied(tag);
    setTimeout(() => setCopied(null), 2000);
  };

  // While the freshly minted secret is on screen the command carries it, so
  // the next step is a single paste.
  const bearer = created?.secret ?? '<token>';
  const mcpCommand = `claude mcp add --transport http traks ${origin}/api/mcp --header "Authorization: Bearer ${bearer}"`;

  const downloadSkill = (): void => {
    const blob = new Blob([skillMarkdown(origin, collectUrl ?? origin)], {
      type: 'text/markdown',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'SKILL.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const CopyButton = ({ text, tag }: { text: string; tag: string }): ReactElement => (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void copy(text, tag)}
      className="shrink-0 text-[12px]"
    >
      {copied === tag ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied === tag ? 'Copied' : 'Copy'}
    </Button>
  );

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[26px] font-bold text-[#3D3B4F] tracking-[-0.02em]">MCP server</h1>
        <p className="mt-1 max-w-[62ch] text-[14px] text-[#9B9590]">
          Let a coding agent run your analytics: create a token, connect the MCP server, hand it the
          skill.
        </p>
      </div>

      {/* Three steps */}
      <div className={`${CARD} p-5`}>
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          <StepTile
            n={1}
            title="Create a token"
            sub={
              <>
                Bound to{' '}
                <strong className="font-semibold text-[#3D3B4F]">{current?.name ?? '…'}</strong>.
                Manage can configure goals and funnels; Read-only sees stats.
              </>
            }
          >
            {created ? (
              <div className="flex flex-col gap-1.5 rounded-xl bg-[#E3F6EE] px-3.5 py-3">
                <p className="flex items-center gap-2 text-[12.5px] font-semibold text-[#123326]">
                  <Check className="h-3.5 w-3.5 text-[#1C9C6C]" />
                  {created.name} created. Copy it now - it won&rsquo;t be shown again.
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2.5 py-1.5 font-mono text-[11.5px] text-[#3D3B4F]">
                    {created.secret}
                  </code>
                  <CopyButton text={created.secret} tag="secret" />
                </div>
                <button
                  onClick={() => setCreated(null)}
                  className="self-start text-[11.5px] text-[#1C9C6C] underline-offset-2 hover:underline cursor-pointer"
                >
                  Done, create another
                </button>
              </div>
            ) : (
              <form
                className="flex flex-col gap-2"
                onSubmit={e => {
                  e.preventDefault();
                  if (name.trim() && current) createToken.mutate();
                }}
              >
                <Input
                  placeholder="Token name, e.g. Claude Code"
                  value={name}
                  maxLength={100}
                  onChange={e => {
                    setName(e.target.value);
                    setError('');
                  }}
                  className="h-10 bg-white px-4 text-[13px] shadow-[inset_0_0_0_1px_#ECEAE5] focus:shadow-[inset_0_0_0_1.5px_var(--ring)]"
                />
                <div className="flex items-center justify-between gap-2">
                  <ScopeToggle value={scope} onChange={setScope} />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={name.trim().length === 0 || !current}
                    isLoading={createToken.isPending}
                    className="text-[12px] px-4"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create
                  </Button>
                </div>
                {error && <p className="text-[12px] text-[#e07a5f]">{error}</p>}
              </form>
            )}
          </StepTile>

          <StepTile
            n={2}
            title="Connect the MCP server"
            sub={
              created
                ? 'Your new token is already in the command - run it in your project.'
                : 'Paste the token in place of <token>. Works with Claude Code, Cursor and any MCP client.'
            }
          >
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2.5 py-2 font-mono text-[11.5px] text-[#6E6C7C]">
                {mcpCommand}
              </code>
              <CopyButton text={mcpCommand} tag="cmd" />
            </div>
          </StepTile>

          <StepTile
            n={3}
            title="Give it the skill"
            sub={
              <>
                SKILL.md teaches the agent to instrument your site and use these tools. Drop it in{' '}
                <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-[#3D3B4F]">
                  .claude/skills/traks/
                </code>
                .
              </>
            }
          >
            <div className="flex items-center gap-2">
              <Button variant="dark" size="sm" onClick={downloadSkill} className="text-[12px]">
                <Download className="h-3.5 w-3.5" />
                Download SKILL.md
              </Button>
              <Button asChild variant="ghost" size="sm" className="text-[12px]">
                <Link to="/portal/skill">View</Link>
              </Button>
            </div>
          </StepTile>
        </div>
      </div>

      {/* Tokens table */}
      <div className={`${CARD} mt-5 overflow-hidden`}>
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
          <p className="text-[14px] font-semibold text-[#3D3B4F]">
            Active tokens
            {current && (
              <span className="ml-2 text-[12px] font-normal text-[#9B9590]">{current.name}</span>
            )}
          </p>
          <p className="text-[12px] text-[#9B9590]">Revoking takes effect immediately</p>
        </div>

        {tokens.length === 0 ? (
          <p className="border-t border-[#F2F1ED] px-5 py-8 text-center text-[13px] text-[#9B9590]">
            {tokensQ.isPending ? 'Loading…' : 'No tokens in this workspace yet - create one above.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div
                className={`grid grid-cols-[minmax(0,2fr)_110px_140px_130px_40px] gap-3 px-4 py-2 ${EYEBROW}`}
              >
                <span>Name</span>
                <span>Scope</span>
                <span>Last used</span>
                <span>Created</span>
                <span />
              </div>
              {tokens.map(t => (
                <div
                  key={t.id}
                  className="grid grid-cols-[minmax(0,2fr)_110px_140px_130px_40px] items-center gap-3 border-t border-[#F2F1ED] px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#F2F1ED] text-[#6E6C7C]">
                      <KeyRound className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] font-semibold text-[#3D3B4F]">
                        {t.name}
                      </span>
                      <span className="truncate font-mono text-[11px] text-[#9B9590]">
                        traks_pat_…{t.suffix}
                        {t.workspaceId === null && (
                          <span className="ml-2 font-sans">· all workspaces (legacy)</span>
                        )}
                      </span>
                    </div>
                  </div>
                  <span>
                    <ScopePill scope={t.scope} />
                  </span>
                  <span
                    className={`text-[12.5px] ${t.lastUsedAt ? 'text-[#6E6C7C]' : 'text-[#B5B0AA]'}`}
                  >
                    {t.lastUsedAt ? formatDate(t.lastUsedAt) : 'Never used'}
                  </span>
                  <span className="text-[12.5px] text-[#6E6C7C]">
                    {t.createdAt ? formatDate(t.createdAt) : '—'}
                  </span>
                  <button
                    onClick={() => revokeToken.mutate(t.id)}
                    disabled={revokeToken.isPending}
                    title="Revoke token"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[#B5B0AA] transition-colors hover:bg-[#e07a5f]/10 hover:text-[#e07a5f] cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function StepTile({
  n,
  title,
  sub,
  children,
}: {
  n: number;
  title: string;
  sub: React.ReactNode;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl bg-[#F9F8F6] p-[18px]">
      <div className="flex items-center gap-2.5">
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#3D3B4F] text-[11px] font-bold text-white">
          {n}
        </span>
        <span className="text-[13.5px] font-semibold text-[#3D3B4F]">{title}</span>
      </div>
      <p className="text-[12px] leading-relaxed text-[#9B9590]">{sub}</p>
      <div className="mt-auto">{children}</div>
    </div>
  );
}

/** Flat two-way switch: inset track, white active segment with a hairline. */
function ScopeToggle({
  value,
  onChange,
}: {
  value: Scope;
  onChange: (s: Scope) => void;
}): ReactElement {
  const seg = (s: Scope, label: string): ReactElement => (
    <button
      type="button"
      onClick={() => onChange(s)}
      className={`rounded-full px-3 py-[5px] text-[12px] transition-colors cursor-pointer ${
        value === s
          ? 'bg-white font-semibold text-[#3D3B4F] shadow-[inset_0_0_0_1px_#E6E4DE]'
          : 'text-[#6E6C7C] hover:text-[#3D3B4F]'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex rounded-full bg-[#F2F1ED] p-[3px]">
      {seg('manage', 'Manage')}
      {seg('read', 'Read-only')}
    </div>
  );
}

function ScopePill({ scope }: { scope: Scope }): ReactElement {
  return scope === 'manage' ? (
    <span className="inline-flex rounded-full bg-[#3D3B4F] px-2 py-0.5 text-[11px] font-medium text-white">
      Manage
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[#6E6C7C] shadow-[inset_0_0_0_1px_#E6E4DE]">
      Read-only
    </span>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
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
