import { useState, type ReactElement, type ReactNode } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Copy, Download, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  CreateTokenModal,
  ScopePill,
  maskedToken,
  type TokenRow,
} from '@/components/tokens/tokens';
import { api } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { useCollectUrl } from '@/lib/config';
import { skillMarkdown } from '@/lib/skill';

export const Route = createFileRoute('/portal/mcp')({
  component: McpPage,
});

/* ── clients ────────────────────────────────────────────────────── */

type ClientId = 'claude-code' | 'claude-desktop' | 'cursor' | 'vscode' | 'windsurf' | 'zed';

const CLIENTS: { id: ClientId; label: string; icon: string }[] = [
  { id: 'claude-code', label: 'Claude Code', icon: '/mcp-clients/claude.svg' },
  { id: 'claude-desktop', label: 'Claude Desktop', icon: '/mcp-clients/claude.svg' },
  { id: 'cursor', label: 'Cursor', icon: '/mcp-clients/cursor.svg' },
  { id: 'vscode', label: 'VS Code', icon: '/mcp-clients/vscode.svg' },
  { id: 'windsurf', label: 'Windsurf', icon: '/mcp-clients/windsurf.svg' },
  { id: 'zed', label: 'Zed', icon: '/mcp-clients/zed.svg' },
];

/** JSON-based clients embed the URL and token in a config file; mcp-remote
 *  bridges clients that only launch stdio servers. */
function buildConfig(
  client: ClientId,
  mcpUrl: string,
  token: string
): { title: string; snippet: string; hint: string } {
  const jsonHeaders = `"headers": { "Authorization": "Bearer ${token}" }`;
  switch (client) {
    case 'claude-code':
      return {
        title: 'Add Traks to Claude Code',
        snippet: `claude mcp add --transport http traks ${mcpUrl} \\
  --header "Authorization: Bearer ${token}"`,
        hint: 'Run once in any project, then ask Claude Code "what were my top pages yesterday?".',
      };
    case 'claude-desktop':
      return {
        title: 'Add Traks to Claude Desktop',
        snippet: `{
  "mcpServers": {
    "traks": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "${mcpUrl}",
        "--header", "Authorization: Bearer ${token}"
      ]
    }
  }
}`,
        hint: 'Settings → Developer → Edit Config (claude_desktop_config.json), then restart the app.',
      };
    case 'cursor':
      return {
        title: 'Add Traks to Cursor',
        snippet: `{
  "mcpServers": {
    "traks": {
      "url": "${mcpUrl}",
      ${jsonHeaders}
    }
  }
}`,
        hint: 'Add to .cursor/mcp.json in your project (or ~/.cursor/mcp.json for everywhere), then reload.',
      };
    case 'vscode':
      return {
        title: 'Add Traks to VS Code',
        snippet: `{
  "servers": {
    "traks": {
      "type": "http",
      "url": "${mcpUrl}",
      ${jsonHeaders}
    }
  }
}`,
        hint: 'Add to .vscode/mcp.json, then start the server from the Extensions → MCP Servers view.',
      };
    case 'windsurf':
      return {
        title: 'Add Traks to Windsurf',
        snippet: `{
  "mcpServers": {
    "traks": {
      "serverUrl": "${mcpUrl}",
      ${jsonHeaders}
    }
  }
}`,
        hint: 'Add to ~/.codeium/windsurf/mcp_config.json, then refresh plugins in Cascade.',
      };
    case 'zed':
      return {
        title: 'Add Traks to Zed',
        snippet: `{
  "context_servers": {
    "traks": {
      "command": {
        "path": "npx",
        "args": [
          "-y", "mcp-remote", "${mcpUrl}",
          "--header", "Authorization: Bearer ${token}"
        ]
      }
    }
  }
}`,
        hint: 'Add to Zed settings.json (cmd-,), then check the server under Agent Panel settings.',
      };
  }
}

/* ── tools ──────────────────────────────────────────────────────── */

/** Mirrors the tool list in api/src/routes/mcp.ts. Keep the two in step when
 *  a tool is added or renamed. */
const TOOLS: { name: string; desc: string; manage?: boolean }[] = [
  { name: 'list_sites', desc: 'sites in this workspace' },
  { name: 'get_tracking_snippet', desc: 'the script tag for a site' },
  { name: 'get_stats', desc: 'visitors, pageviews, breakdowns; today is live' },
  { name: 'get_paths', desc: 'pages viewed before or after a page' },
  { name: 'get_attribution', desc: 'conversions by UTM source' },
  { name: 'get_goal_stats', desc: 'conversions per goal' },
  { name: 'get_funnel_stats', desc: 'step completion and drop-off' },
  { name: 'get_custom_events', desc: 'events fired, counts and totals' },
  { name: 'get_event_props', desc: 'property breakdown for one event' },
  { name: 'get_webmcp_stats', desc: 'which WebMCP tools agents call' },
  { name: 'get_bot_stats', desc: 'bot pageviews by name' },
  { name: 'list_goals', desc: 'goals defined for a site' },
  { name: 'list_funnels', desc: 'funnels, name and steps' },
  { name: 'create_goal', desc: 'match an event or a page', manage: true },
  { name: 'update_goal', desc: 'change a goal', manage: true },
  { name: 'delete_goal', desc: 'definition only, never data', manage: true },
  { name: 'create_funnel', desc: 'define ordered steps', manage: true },
  { name: 'update_funnel', desc: 'replace name and steps', manage: true },
  { name: 'delete_funnel', desc: 'remove a funnel', manage: true },
];

/* ── page ───────────────────────────────────────────────────────── */

const CARD = 'rounded-[20px] bg-card shadow-float';
const EYEBROW = 'text-[10.5px] font-bold uppercase tracking-[0.1em] text-subtle';

/**
 * MCP server: the endpoint strip, then a guided "connect a client" stepper
 * (pick a client, pick or mint a token, paste that client's config, add the
 * skill) beside the tool reference. Tokens themselves are managed on the API
 * tokens tab.
 */
function McpPage(): ReactElement {
  const queryClient = useQueryClient();
  const { current } = useWorkspace();
  const origin = window.location.origin;
  const collectUrl = useCollectUrl();
  const mcpUrl = `${origin}/api/mcp`;

  const [client, setClient] = useState<ClientId>('claude-code');
  const [tokenId, setTokenId] = useState('');
  /** Full secret of a token minted on this page - the only time a real token
   *  can be embedded in the snippet (stored tokens are hashed, suffix-only). */
  const [minted, setMinted] = useState<{ id: string; secret: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

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

  const copy = async (text: string, tag: string): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setCopied(tag);
    setTimeout(() => setCopied(null), 2000);
  };

  const selected = tokens.find(t => t.id === tokenId);
  const tokenDone = Boolean(minted || selected);
  const snippetToken = minted
    ? minted.secret
    : selected
      ? `${maskedToken(selected.suffix)}  ⟵ paste the full token`
      : '<token>';
  const cfg = buildConfig(client, mcpUrl, snippetToken);

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
      variant="outline"
      size="sm"
      onClick={() => void copy(text, tag)}
      className="h-8 shrink-0 rounded-full px-3 text-[12px] text-foreground"
    >
      {copied === tag ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied === tag ? 'Copied' : 'Copy'}
    </Button>
  );

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[26px] font-bold text-foreground tracking-[-0.02em]">MCP server</h1>
        <p className="mt-1 max-w-[62ch] text-[14px] text-subtle">
          Give Claude Code and other agents their own analytics tools: read stats, set up goals and
          funnels, pull the tracking snippet.
        </p>
      </div>

      {/* Endpoint - always visible, independent of the steps below */}
      <div className={`${CARD} flex flex-wrap items-center justify-between gap-4 p-5`}>
        <div className="min-w-0 flex-1 basis-full sm:basis-0">
          <span className={`${EYEBROW} mb-2 block`}>Your MCP endpoint</span>
          <div className="flex items-center gap-2.5">
            <code className="min-w-0 flex-1 truncate rounded-[10px] bg-muted px-3.5 py-2.5 font-mono text-[12.5px] text-foreground">
              {mcpUrl}
            </code>
            <CopyButton text={mcpUrl} tag="url" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 sm:block sm:text-right">
          <span className="inline-flex rounded-full bg-mint-soft px-2.5 py-0.5 text-[11.5px] font-bold text-[#123326] dark:text-[#7df0c0]">
            {TOOLS.length} tools available
          </span>
          <p className="text-[11.5px] text-subtle sm:mt-1.5">Streamable HTTP · Bearer token auth</p>
        </div>
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[7fr_5fr]">
        {/* Guided setup */}
        <div className={`${CARD} p-5 sm:p-6`}>
          <h2 className="mb-5 text-[15px] font-semibold text-foreground">Connect a client</h2>

          <div className="grid grid-cols-[26px_1fr] gap-x-3.5">
            <Step n={1} done>
              <p className="pt-0.5 text-[13.5px] font-semibold text-foreground">
                Choose your client
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {CLIENTS.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setClient(c.id)}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] transition-colors cursor-pointer',
                      client === c.id
                        ? 'bg-btn font-semibold text-white'
                        : 'border border-border bg-card font-medium text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <img
                      src={c.icon}
                      alt=""
                      className={cn('h-3.5 w-3.5', client === c.id && 'brightness-0 invert')}
                    />
                    {c.label}
                  </button>
                ))}
              </div>
            </Step>

            <Step n={2} done={tokenDone}>
              <p className="pt-0.5 text-[13.5px] font-semibold text-foreground">Pick a token</p>
              <div className="mt-2 flex flex-wrap items-center gap-2.5">
                <div className="relative min-w-0 flex-1 basis-full sm:basis-0">
                  <select
                    value={tokenId}
                    onChange={e => {
                      setTokenId(e.target.value);
                      if (minted && e.target.value !== minted.id) setMinted(null);
                    }}
                    disabled={!current}
                    className="h-10 w-full cursor-pointer appearance-none rounded-[10px] bg-muted pl-4 pr-9 text-[13px] text-foreground outline-none focus:shadow-[inset_0_0_0_1.5px_var(--ring)] disabled:cursor-default"
                  >
                    <option value="">Select a token…</option>
                    {tokens.map(t => (
                      <option key={t.id} value={t.id}>
                        {maskedToken(t.suffix)} · {t.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreating(true)}
                  disabled={!current}
                  className="h-10 rounded-full px-4 text-[12px] text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create token
                </Button>
              </div>
              {minted ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="text-[12px] font-medium text-[#1C9C6C]">
                    New token is filled into the config below. It is shown only until you leave this
                    page.
                  </p>
                  <button
                    type="button"
                    onClick={() => void copy(minted.secret, 'secret')}
                    className="text-[12px] text-muted-foreground underline-offset-2 hover:underline cursor-pointer"
                  >
                    {copied === 'secret' ? 'Copied' : 'Copy token'}
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-[12px] leading-relaxed text-subtle">
                  Stored tokens are hashed, so an existing token leaves a blank to fill in. Create
                  one here to get a paste-ready config.{' '}
                  <Link
                    to="/portal/tokens"
                    className="font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Manage tokens
                  </Link>
                </p>
              )}
            </Step>

            <Step n={3} done={false}>
              <div className="flex items-center justify-between gap-3 pt-0.5">
                <p className="text-[13.5px] font-semibold text-foreground">{cfg.title}</p>
                <CopyButton text={cfg.snippet} tag="cmd" />
              </div>
              <pre className="mt-2 overflow-x-auto rounded-xl border border-border bg-card px-4 py-3.5 font-mono text-[12px] leading-[1.7] text-foreground">
                {cfg.snippet}
              </pre>
              <p className="mt-2 text-[12px] leading-relaxed text-subtle">{cfg.hint}</p>
            </Step>

            <Step n={4} done={false} last>
              <p className="pt-0.5 text-[13.5px] font-semibold text-foreground">
                Give it the skill
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-subtle">
                SKILL.md teaches the agent to instrument your site and use these tools well. Put it
                in{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                  .claude/skills/traks/
                </code>
                .
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <Button variant="dark" size="sm" onClick={downloadSkill} className="text-[12px]">
                  <Download className="h-3.5 w-3.5" />
                  Download SKILL.md
                </Button>
                <Button asChild variant="ghost" size="sm" className="text-[12px]">
                  <Link to="/portal/skill">View</Link>
                </Button>
              </div>
            </Step>
          </div>
        </div>

        {/* Tools reference */}
        <div className={`${CARD} p-5 sm:p-6`}>
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-foreground">Tools</h2>
            <span className="rounded-full bg-mint-soft px-2.5 py-0.5 text-[11.5px] font-bold text-[#123326] dark:text-[#7df0c0]">
              {TOOLS.length}
            </span>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-subtle">
            What a connected agent can do, scoped by the token it authenticates with.
          </p>
          <div className="mt-3">
            {TOOLS.map((t, i) => (
              <div
                key={t.name}
                className={cn('flex items-baseline gap-2.5 py-2', i > 0 && 'border-t border-muted')}
              >
                <code className="font-mono text-[12px] font-semibold text-foreground">
                  {t.name}
                </code>
                <span className="min-w-0 flex-1 text-[12px] text-muted-foreground">{t.desc}</span>
                {t.manage && <ScopePill scope="manage" />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {current && (
        <CreateTokenModal
          open={creating}
          onOpenChange={setCreating}
          workspaceId={current.id}
          workspaceName={current.name}
          defaultName={CLIENTS.find(c => c.id === client)?.label ?? ''}
          hint="The new token drops straight into step 2 and the config snippet."
          onCreated={(token, secret) => {
            setMinted({ id: token.id, secret });
            setTokenId(token.id);
            invalidate();
          }}
        />
      )}
    </main>
  );
}

/* ── pieces ─────────────────────────────────────────────────────── */

/** One stepper row: number disc (mint check when done) with a hairline rail
 *  down to the next step, and the step body. Rendered as two grid cells so
 *  every row shares the same rail column. */
function Step({
  n,
  done,
  last = false,
  children,
}: {
  n: number;
  done: boolean;
  last?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <>
      <div className="flex flex-col items-center">
        <span
          className={cn(
            'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
            done
              ? 'bg-mint text-[#123326]'
              : 'border-[1.5px] border-border-strong bg-card text-subtle'
          )}
        >
          {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : n}
        </span>
        {!last && <span className="mt-1.5 w-px flex-1 bg-border" />}
      </div>
      <div className={cn('min-w-0', !last && 'pb-6')}>{children}</div>
    </>
  );
}
