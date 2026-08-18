import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Bot, Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';

interface TokenRow {
  id: string;
  name: string;
  suffix: string;
  scope: 'read' | 'manage';
  workspaceId: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
}

export function AgentAccessCard(): ReactElement {
  const queryClient = useQueryClient();
  const { current, workspaces } = useWorkspace();
  const origin = window.location.origin;

  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'manage'>('manage');
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState('');

  const tokensQ = useQuery({
    queryKey: ['api-tokens'],
    queryFn: () => api.getTokens(),
    staleTime: 60_000,
  });
  const tokens = ((tokensQ.data as any)?.data ?? []) as TokenRow[];

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
  };

  const createToken = useMutation({
    mutationFn: () => api.createToken({ name: name.trim(), scope, workspaceId: current!.id }),
    onSuccess: (result: any) => {
      setCreatedSecret(result.secret as string);
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

  const mcpCommand = `claude mcp add --transport http traks ${origin}/api/mcp --header "Authorization: Bearer <token>"`;

  return (
    <section>
      <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#9B9590]">
        Coding agents &amp; API
      </p>
      <div className="rounded-[20px] bg-white p-6 shadow-float">
        <div className="flex items-center gap-3.5">
          <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] bg-muted">
            <Bot className="h-[17px] w-[17px] text-foreground" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold text-[#3D3B4F]">
              Let a coding agent run your analytics
            </p>
            <p className="mt-0.5 text-[12px] text-[#9B9590]">
              Tokens are scoped to the current workspace
              {current ? ` (${current.name})` : ''}, so an agent holding one can never see your
              other workspaces. Connect the MCP server, hand over the skill, and it configures goals
              and funnels while instrumenting your site&rsquo;s code.
            </p>
          </div>
        </div>

        {/* Tokens */}
        <div className="mt-[18px] space-y-1.5">
          {tokens.map(t => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-xl border border-[#e6e5ea]/80 px-3.5 py-2.5"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-[13px] font-medium text-[#3D3B4F]">
                  <KeyRound className="h-3.5 w-3.5 shrink-0 text-[#B5B0AA]" />
                  {t.name}
                  <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-[#9B9590]">
                    …{t.suffix} · {t.scope}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-[#9B9590]">
                    {workspaces.find(w => w.id === t.workspaceId)?.name ?? 'workspace'}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-[11px] text-[#9B9590]">
                  {t.lastUsedAt
                    ? `Last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                    : 'Never used'}
                </p>
              </div>
              <button
                onClick={() => revokeToken.mutate(t.id)}
                disabled={revokeToken.isPending}
                className="ml-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#B5B0AA] hover:bg-[#e07a5f]/10 hover:text-[#e07a5f] transition-colors cursor-pointer"
                title="Revoke token"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Freshly minted secret, visible exactly once */}
        {createdSecret && (
          <div className="mt-3 rounded-xl border border-[#28E99F]/40 bg-mint/10 px-3.5 py-3">
            <p className="text-[12px] font-semibold text-[#123326]">
              Token created. Copy it now, it won&rsquo;t be shown again.
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2.5 py-1.5 font-mono text-[11.5px] text-[#3D3B4F]">
                {createdSecret}
              </code>
              <Button
                variant="ghost"
                onClick={() => void copy(createdSecret, 'secret')}
                className="shrink-0 text-[12px]"
              >
                {copied === 'secret' ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied === 'secret' ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        )}

        {/* Mint */}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            placeholder="Token name (e.g. Claude Code)"
            value={name}
            maxLength={100}
            onChange={e => {
              setName(e.target.value);
              setError('');
            }}
            className="h-10 px-4 text-[13px]"
          />
          <select
            value={scope}
            onChange={e => setScope(e.target.value as 'read' | 'manage')}
            className="h-10 shrink-0 cursor-pointer rounded-xl border-none bg-[#F2F1ED] px-3 text-[13px] text-[#3D3B4F] focus:outline-none"
          >
            <option value="manage">Manage (configure + read)</option>
            <option value="read">Read-only (stats)</option>
          </select>
          <Button
            onClick={() => createToken.mutate()}
            disabled={name.trim().length === 0 || !current}
            isLoading={createToken.isPending}
            className="shrink-0 text-[13px] px-4"
          >
            <Plus className="h-3.5 w-3.5" />
            Create token
          </Button>
        </div>
        {error && <p className="mt-2 text-[12px] text-[#e07a5f]">{error}</p>}

        {/* Connect + skill */}
        <div className="mt-4 border-t border-[#F5F2EC] pt-4">
          <p className="mb-1.5 text-[12px] font-semibold text-[#3D3B4F]">
            1 · Connect the MCP server
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-[#F9F8F6] px-2.5 py-2 font-mono text-[11px] text-[#6E6C7C]">
              {mcpCommand}
            </code>
            <Button
              variant="ghost"
              onClick={() => void copy(mcpCommand, 'cmd')}
              className="shrink-0 text-[12px]"
            >
              {copied === 'cmd' ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied === 'cmd' ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="mb-1.5 mt-3 text-[12px] font-semibold text-[#3D3B4F]">
            2 · Give your agent the skill
          </p>
          <p className="text-[12px] leading-relaxed text-[#9B9590]">
            The skill that teaches your agent to instrument the site and use these tools lives in
            the{' '}
            <Link
              to="/portal/skill"
              className="font-semibold text-[#3D3B4F] underline-offset-2 hover:underline"
            >
              Skill tab
            </Link>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
