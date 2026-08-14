/**
 * The SKILL.md a coding agent reads: instrumentation + MCP conventions,
 * with this instance's real URLs baked in.
 */
export function skillMarkdown(origin: string, collectUrl: string): string {
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
