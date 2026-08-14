/**
 * MCP server for coding agents — stateless Streamable HTTP transport.
 *
 * One POST endpoint speaking JSON-RPC 2.0 (initialize / tools/list /
 * tools/call). Auth is the personal API token via requireAuth, exactly like
 * every REST route. Tools don't reimplement anything: each call dispatches
 * INTERNALLY to the existing /api routes (same Hono app, no network hop),
 * so validation, permissions, caching, and the live/cold split are all the
 * ones the dashboard uses. Connect with:
 *
 *   claude mcp add --transport http traks https://<instance>/api/mcp \
 *     --header "Authorization: Bearer traks_pat_…"
 */
import type { Context } from 'hono';
import { PERIODS } from '@traks/shared';
import type { Bindings, Variables } from '../types';

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

/** Internal dispatcher — index.ts passes app.request bound to the live app. */
export type Dispatch = (path: string, init: RequestInit, c: Ctx) => Promise<Response>;

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Maps validated args to an internal REST request. */
  request: (args: Record<string, unknown>) => { method: string; path: string; body?: unknown };
}

const str = (desc: string): object => ({ type: 'string', description: desc });
const period = {
  type: 'string',
  enum: [...PERIODS],
  description: "Reporting period ('today' is served live)",
};
const goalProps = {
  siteId: str('Site id (from list_sites)'),
  name: str('Human-readable goal name'),
  type: { type: 'string', enum: ['event', 'page'], description: 'What the goal matches' },
  target: str(
    "Event name for 'event' goals; pathname for 'page' goals (a trailing /* matches the whole section, e.g. /blog/*)"
  ),
  propKey: str(
    "Optional: only count events where this prop key… (requires propValue; 'event' goals only)"
  ),
  propValue: str('…equals this value (exact match)'),
};
const stepSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['event', 'page'] },
    target: str('Event name, or pathname (trailing /* allowed)'),
    propKey: str('Optional event-prop condition key'),
    propValue: str('Optional event-prop condition value'),
  },
  required: ['type', 'target'],
};

const TOOLS: ToolDef[] = [
  {
    name: 'list_sites',
    description:
      'List the sites this token can access (id, name, domain, timezone). Site ids are the handle every other tool takes.',
    inputSchema: { type: 'object', properties: {} },
    request: () => ({ method: 'GET', path: '/api/sites' }),
  },
  {
    name: 'get_tracking_snippet',
    description:
      "A site's install snippet and site key. Paste the snippet into the site's <head>; fire custom events with window.traks(name, props?, value?).",
    inputSchema: {
      type: 'object',
      properties: { siteId: str('Site id') },
      required: ['siteId'],
    },
    request: a => ({ method: 'GET', path: `/api/sites/${a.siteId}` }),
  },
  {
    name: 'list_goals',
    description: 'List the conversion goals defined for a site.',
    inputSchema: {
      type: 'object',
      properties: { siteId: str('Site id') },
      required: ['siteId'],
    },
    request: a => ({ method: 'GET', path: `/api/sites/${a.siteId}/goals` }),
  },
  {
    name: 'create_goal',
    description:
      "Create a conversion goal: a custom event (optionally 'where propKey = propValue') or a page visit.",
    inputSchema: {
      type: 'object',
      properties: goalProps,
      required: ['siteId', 'name', 'type', 'target'],
    },
    request: a => ({
      method: 'POST',
      path: `/api/sites/${a.siteId}/goals`,
      body: {
        name: a.name,
        type: a.type,
        target: a.target,
        ...(a.propKey && a.propValue ? { propKey: a.propKey, propValue: a.propValue } : {}),
      },
    }),
  },
  {
    name: 'update_goal',
    description: 'Update an existing goal (same fields as create_goal).',
    inputSchema: {
      type: 'object',
      properties: { ...goalProps, goalId: str('Goal id (from list_goals)') },
      required: ['siteId', 'goalId', 'name', 'type', 'target'],
    },
    request: a => ({
      method: 'PATCH',
      path: `/api/sites/${a.siteId}/goals/${a.goalId}`,
      body: {
        name: a.name,
        type: a.type,
        target: a.target,
        ...(a.propKey && a.propValue ? { propKey: a.propKey, propValue: a.propValue } : {}),
      },
    }),
  },
  {
    name: 'delete_goal',
    description: 'Delete a goal. Removes only the goal definition, never any analytics data.',
    inputSchema: {
      type: 'object',
      properties: { siteId: str('Site id'), goalId: str('Goal id') },
      required: ['siteId', 'goalId'],
    },
    request: a => ({ method: 'DELETE', path: `/api/sites/${a.siteId}/goals/${a.goalId}` }),
  },
  {
    name: 'list_funnels',
    description: 'List the funnels defined for a site (name + ordered steps).',
    inputSchema: {
      type: 'object',
      properties: { siteId: str('Site id') },
      required: ['siteId'],
    },
    request: a => ({ method: 'GET', path: `/api/sites/${a.siteId}/funnels` }),
  },
  {
    name: 'create_funnel',
    description:
      'Create a funnel: 2-8 ordered steps (pages or events) a visitor should complete in one session.',
    inputSchema: {
      type: 'object',
      properties: {
        siteId: str('Site id'),
        name: str('Funnel name'),
        steps: { type: 'array', items: stepSchema, minItems: 2, maxItems: 8 },
      },
      required: ['siteId', 'name', 'steps'],
    },
    request: a => ({
      method: 'POST',
      path: `/api/sites/${a.siteId}/funnels`,
      body: { name: a.name, steps: a.steps },
    }),
  },
  {
    name: 'update_funnel',
    description: 'Replace a funnel’s name and steps (same fields as create_funnel).',
    inputSchema: {
      type: 'object',
      properties: {
        siteId: str('Site id'),
        funnelId: str('Funnel id (from list_funnels)'),
        name: str('Funnel name'),
        steps: { type: 'array', items: stepSchema, minItems: 2, maxItems: 8 },
      },
      required: ['siteId', 'funnelId', 'name', 'steps'],
    },
    request: a => ({
      method: 'PATCH',
      path: `/api/sites/${a.siteId}/funnels/${a.funnelId}`,
      body: { name: a.name, steps: a.steps },
    }),
  },
  {
    name: 'delete_funnel',
    description: 'Delete a funnel definition.',
    inputSchema: {
      type: 'object',
      properties: { siteId: str('Site id'), funnelId: str('Funnel id') },
      required: ['siteId', 'funnelId'],
    },
    request: a => ({ method: 'DELETE', path: `/api/sites/${a.siteId}/funnels/${a.funnelId}` }),
  },
  {
    name: 'get_stats',
    description:
      'Full dashboard for a site and period: main stats (visitors, pageviews, sessions, bounce, duration, deltas), timeseries, top pages, referrers, countries, browsers, OS.',
    inputSchema: {
      type: 'object',
      properties: { siteId: str('Site id'), period },
      required: ['siteId', 'period'],
    },
    request: a => ({
      method: 'GET',
      path: `/api/analytics/${a.siteId}/stats/all?period=${a.period}`,
    }),
  },
  {
    name: 'get_goal_stats',
    description: 'Conversion counts and rates for every goal in the period.',
    inputSchema: {
      type: 'object',
      properties: { siteId: str('Site id'), period },
      required: ['siteId', 'period'],
    },
    request: a => ({
      method: 'GET',
      path: `/api/analytics/${a.siteId}/stats/goals?period=${a.period}`,
    }),
  },
  {
    name: 'get_funnel_stats',
    description: 'Step-by-step completion counts and drop-off rates for one funnel.',
    inputSchema: {
      type: 'object',
      properties: { siteId: str('Site id'), funnelId: str('Funnel id'), period },
      required: ['siteId', 'funnelId', 'period'],
    },
    request: a => ({
      method: 'GET',
      path: `/api/analytics/${a.siteId}/stats/funnel/${a.funnelId}?period=${a.period}`,
    }),
  },
  {
    name: 'get_custom_events',
    description: 'Custom events fired in the period, with counts and total values.',
    inputSchema: {
      type: 'object',
      properties: { siteId: str('Site id'), period },
      required: ['siteId', 'period'],
    },
    request: a => ({
      method: 'GET',
      path: `/api/analytics/${a.siteId}/stats/events?period=${a.period}`,
    }),
  },
];

const rpcError = (id: unknown, code: number, message: string): object => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
});

const rpcResult = (id: unknown, result: unknown): object => ({ jsonrpc: '2.0', id, result });

export function mcpHandler(dispatch: Dispatch) {
  return async (c: Ctx): Promise<Response> => {
    let msg: {
      jsonrpc?: string;
      id?: unknown;
      method?: string;
      params?: Record<string, unknown>;
    };
    try {
      msg = await c.req.json();
    } catch {
      return c.json(rpcError(null, -32700, 'Parse error'), 400);
    }
    const { id, method, params } = msg;

    // Notifications get no response body.
    if (method?.startsWith('notifications/')) return c.body(null, 202);

    switch (method) {
      case 'initialize': {
        const requested = String(params?.protocolVersion ?? '');
        return c.json(
          rpcResult(id, {
            protocolVersion: PROTOCOL_VERSIONS.includes(requested)
              ? requested
              : PROTOCOL_VERSIONS[0],
            capabilities: { tools: {} },
            serverInfo: {
              name: 'traks',
              title: 'Traks Analytics',
              version: c.env.TRAKS_VERSION ?? 'dev',
            },
          })
        );
      }
      case 'ping':
        return c.json(rpcResult(id, {}));
      case 'tools/list':
        return c.json(
          rpcResult(id, {
            tools: TOOLS.map(t => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          })
        );
      case 'tools/call': {
        const tool = TOOLS.find(t => t.name === params?.name);
        if (!tool) return c.json(rpcError(id, -32602, `Unknown tool: ${String(params?.name)}`));
        const args = (params?.arguments ?? {}) as Record<string, unknown>;
        const { method: httpMethod, path, body } = tool.request(args);
        // Same-app dispatch: the token in the Authorization header flows
        // through, so requireAuth and every permission check run as usual.
        const res = await dispatch(
          path,
          {
            method: httpMethod,
            headers: {
              authorization: c.req.header('authorization') ?? '',
              ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
            },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          },
          c
        );
        const text = await res.text();
        let payload: unknown = text;
        // The snippet tool composes its answer from the site response.
        if (tool.name === 'get_tracking_snippet' && res.ok) {
          try {
            const site = (JSON.parse(text) as { data?: { apiKeys?: { key: string }[] } }).data;
            const key = site?.apiKeys?.[0]?.key;
            payload = JSON.stringify({
              siteKey: key ?? null,
              snippet: key
                ? `<script defer data-site="${key}" src="${c.env.COLLECT_URL}/t.js"></script>`
                : null,
              docs: "Place the snippet in the <head>. Custom events: window.traks('signup', { plan: 'pro' }, 49.99) — name, optional flat props object, optional numeric value. SPA navigations, outbound links, and file downloads are tracked automatically.",
            });
          } catch {
            /* fall through with raw text */
          }
        }
        return c.json(
          rpcResult(id, {
            content: [{ type: 'text', text: typeof payload === 'string' ? payload : text }],
            isError: !res.ok,
          })
        );
      }
      default:
        return c.json(rpcError(id, -32601, `Method not found: ${String(method)}`));
    }
  };
}
