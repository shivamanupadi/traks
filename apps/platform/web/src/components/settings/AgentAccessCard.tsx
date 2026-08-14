import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, Copy, Download, KeyRound, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useCollectUrl } from '@/lib/config';

interface TokenRow {
  id: string;
  name: string;
  suffix: string;
  scope: 'read' | 'manage';
  createdAt: string | null;
  lastUsedAt: string | null;
}

/** The SKILL.md a coding agent reads: instrumentation + MCP conventions,
 *  with this instance's real URLs baked in. */
function skillMarkdown(origin: string, collectUrl: string): string {
  return `---
name: traks-analytics
description: Instrument a website with Traks analytics (privacy-first, self-hosted) and configure its goals and funnels over MCP. Use when adding analytics, tracking custom events, or defining conversion goals/funnels for a site tracked by Traks.
---

# Traks Analytics

Traks is a privacy-first, cookieless analytics instance at ${origin}.
You have two jobs, done together:

1. **Instrument the site's code** — install the tracker, fire custom events.
2. **Configure Traks over MCP** — create the matching goals and funnels.

## Connect (MCP)

The Traks MCP server is at \`${origin}/api/mcp\` (Streamable HTTP), authorized
with a personal API token header. If not already connected:

\`\`\`sh
claude mcp add --transport http traks ${origin}/api/mcp \\
  --header "Authorization: Bearer <TRAKS_API_TOKEN>"
\`\`\`

Start every task with \`list_sites\` to get the site id.

## Instrumenting the site

Get the exact snippet with \`get_tracking_snippet\`. It belongs in the <head>
of every page:

\`\`\`html
<script defer data-site="SITE_KEY" src="${collectUrl}/t.js"></script>
\`\`\`

- SPA navigations (history API) are tracked automatically.
- Outbound link clicks and file downloads are tracked automatically.
- Optional attributes: \`data-hash\` for #/hash routing; \`data-404\` on the
  snippet in the 404 template records broken URLs as a \`404\` event.

### Custom events

\`\`\`js
window.traks(name, props?, value?)
// examples
traks('signup', { plan: 'pro' });
traks('purchase', { sku: 'T100' }, 49.99);
traks('console_click', { location: 'pricing' });
\`\`\`

- \`name\`: short snake_case verb phrases ('signup', 'trial_start').
- \`props\`: a FLAT object of scalar values — no nesting. Prop values are
  what goals filter on, so keep them low-cardinality ('claimed', 'timeout' —
  not timestamps or ids).
- \`value\`: optional number, summed in the dashboard.
- Guard for SSR: only call in browser context, after the script tag exists.
  \`window.traks\` is safe to call before the script loads (it queues).

## Configuring goals

A goal counts conversions. Two kinds:

- Event goal: \`create_goal {type: 'event', target: 'signup'}\` — optionally
  add \`propKey\`/\`propValue\` to count only matching events, e.g.
  \`{target: 'try_session_end', propKey: 'reason', propValue: 'claimed'}\`.
- Page goal: \`create_goal {type: 'page', target: '/thank-you'}\` — a trailing
  \`/*\` matches a whole section: \`/blog/*\` counts /blog and everything under
  it (never /blogfoo).

**Convention: when you add a custom event to the code, create the matching
goal in the same task**, so conversions appear in the dashboard immediately.

## Configuring funnels

\`create_funnel\` takes 2–8 ordered steps a visitor should complete in one
session. Steps are pages or events, with the same propKey/propValue and /*
options as goals:

\`\`\`json
{
  "name": "Demo to claim",
  "steps": [
    { "type": "page", "target": "/" },
    { "type": "event", "target": "section_view", "propKey": "section", "propValue": "pricing" },
    { "type": "event", "target": "console_click" }
  ]
}
\`\`\`

## Reading results

- \`get_stats {siteId, period}\` — visitors, pageviews, sessions, bounce,
  timeseries, top pages/referrers/countries/browsers.
- \`get_goal_stats\`, \`get_funnel_stats\`, \`get_custom_events\` — same periods.
- Periods: today, yesterday, 7d, 30d, 90d, 6m, 1y, all ('today' is live).

## Privacy rules (do not violate)

Traks is cookieless and stores no PII. Never put emails, user ids, or any
personal data into event names, props, or pathnames.
`;
}

export function AgentAccessCard(): ReactElement {
  const queryClient = useQueryClient();
  const collectUrl = useCollectUrl();
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
    mutationFn: () => api.createToken({ name: name.trim(), scope }),
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
              Mint an API token, connect the MCP server, and hand your agent the skill — it can
              instrument your site&rsquo;s code and configure goals and funnels here in one go.
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

        {/* Freshly minted secret — visible exactly once */}
        {createdSecret && (
          <div className="mt-3 rounded-xl border border-[#28E99F]/40 bg-mint/10 px-3.5 py-3">
            <p className="text-[12px] font-semibold text-[#123326]">
              Token created — copy it now, it won&rsquo;t be shown again.
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
            className="h-10 shrink-0 cursor-pointer rounded-xl border-none bg-white px-3 text-[13px] text-[#3D3B4F] shadow-[inset_0_0_0_1px_#E5E5EB] focus:outline-none"
          >
            <option value="manage">Manage (configure + read)</option>
            <option value="read">Read-only (stats)</option>
          </select>
          <Button
            onClick={() => createToken.mutate()}
            disabled={name.trim().length === 0}
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
            <code className="min-w-0 flex-1 truncate rounded-lg bg-[#F6F5F2] px-2.5 py-2 font-mono text-[11px] text-[#6E6C7C]">
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
            The skill teaches the agent how to instrument your site (tracker API, event conventions)
            and how to use the MCP tools together — drop it into your project&rsquo;s{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">.claude/skills/traks/</code>{' '}
            folder.
          </p>
          <Button variant="ghost" onClick={downloadSkill} className="mt-2 text-[12.5px]">
            <Download className="h-3.5 w-3.5" />
            Download SKILL.md
          </Button>
        </div>
      </div>
    </section>
  );
}
