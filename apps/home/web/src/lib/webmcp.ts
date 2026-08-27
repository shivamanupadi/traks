/**
 * WebMCP tools for traks.dev: structured capabilities for AI agents visiting
 * the site (Chrome 146+ early preview, document.modelContext). Agents helping
 * someone evaluate or install Traks get answers as data instead of scraping
 * the landing page.
 *
 * This is also our own dogfood: the tracker in index.html patches
 * registerTool before this module runs, so every agent invocation of these
 * tools lands in our dashboard's "Agent Tools (WebMCP)" panel.
 */
import { INSTALL_GUIDES, guideWithSnippet, type InstallGuide } from '@traks/shared';
import { TOC } from '@/docs/shared';

interface ToolContent {
  content: { type: 'text'; text: string }[];
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean };
  execute: (input: Record<string, unknown>) => Promise<ToolContent>;
}

/** The API is experimental: probe both homes without assuming either. */
interface ModelContext {
  registerTool?: (tool: ToolDef) => unknown;
  provideContext?: (context: { tools: ToolDef[] }) => unknown;
}

const text = (value: string): ToolContent => ({ content: [{ type: 'text', text: value }] });

const OVERVIEW = `Traks is free, self-hosted web analytics that deploys into the visitor's OWN Cloudflare account (Workers + D1 + R2 + Pipelines). There is no hosted plan and no pricing: the software is free forever; the only cost is the user's own Cloudflare usage, which stays in Cloudflare's free tier for most sites.

Key facts:
- Privacy-first: no cookies, no fingerprinting; visitor ids rotate daily. Analytics data never leaves the user's Cloudflare account.
- Features: realtime dashboard and live map, pageviews/sources/locations/devices, custom events with properties, goals, funnels, UTM tracking, AI-assistant referrer breakdown, bot traffic counts, and WebMCP agent tool-call analytics.
- Built for agents: every deployed instance exposes an MCP server (/api/mcp, personal access token auth) so coding agents can query stats, manage goals/funnels, and fetch tracking snippets. See https://traks.dev/docs#agents
- Plausible-compatible ingest: existing Plausible snippets and Events API payloads work unchanged. See https://traks.dev/docs#plausible
- Deploy: one wizard at https://traks.dev/deploy ("Sign in with Cloudflare", ~2 minutes). Docs: https://traks.dev/docs`;

const TOOLS: ToolDef[] = [
  {
    name: 'get_product_overview',
    description:
      'What Traks is: free self-hosted web analytics on Cloudflare. Features, privacy model, cost, how to deploy, and where the docs and MCP server live.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => text(OVERVIEW),
  },
  {
    name: 'list_docs',
    description:
      'Table of contents of the Traks documentation, with a direct URL per section.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () =>
      text(
        TOC.map(s => `[${s.group}] ${s.label}: https://traks.dev/docs#${s.id}`).join('\n')
      ),
  },
  {
    name: 'list_install_guides',
    description:
      'Frameworks and platforms Traks has step-by-step tracker install guides for. Use get_install_guide for the full steps.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () =>
      text(INSTALL_GUIDES.map(g => `${g.slug}: ${g.name} - ${g.blurb}`).join('\n')),
  },
  {
    name: 'get_install_guide',
    description:
      'Full tracker install steps for one platform (slug from list_install_guides), with code samples. Samples use YOUR_SITE_KEY / YOUR_COLLECT_URL placeholders; the real values come from the "Add site" dialog of a deployed Traks instance.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Guide slug, e.g. "nextjs", "react", "html"' },
      },
      required: ['platform'],
    },
    annotations: { readOnlyHint: true },
    execute: async input => {
      const slug = String(input?.platform || '').toLowerCase();
      const found = INSTALL_GUIDES.find(g => g.slug === slug);
      if (!found) {
        return text(
          `Unknown platform "${slug}". Available: ${INSTALL_GUIDES.map(g => g.slug).join(', ')}`
        );
      }
      return text(renderGuide(guideWithSnippet(found, 'YOUR_SITE_KEY', 'https://YOUR_COLLECT_URL')));
    },
  },
];

function renderGuide(guide: InstallGuide): string {
  const steps = guide.steps.map((step, i) => {
    let out = `${i + 1}. ${step.title}`;
    if (step.body) out += `\n${step.body}`;
    if (step.code) {
      const file = step.code.filename ? ` (${step.code.filename})` : '';
      out += `\n\`\`\`${step.code.lang}${file}\n${step.code.code}\n\`\`\``;
    }
    return out;
  });
  return `# Install Traks: ${guide.name}\n${guide.blurb}\n\n${steps.join('\n\n')}`;
}

/**
 * Register the tools if the browser exposes a WebMCP registry. Safe no-op
 * everywhere else; must never break the page.
 */
export function registerWebmcpTools(): void {
  try {
    const doc = document as Document & { modelContext?: ModelContext };
    const nav = navigator as Navigator & { modelContext?: ModelContext };
    const modelContext = doc.modelContext || nav.modelContext;
    if (!modelContext) return;
    if (typeof modelContext.registerTool === 'function') {
      for (const tool of TOOLS) modelContext.registerTool(tool);
    } else if (typeof modelContext.provideContext === 'function') {
      modelContext.provideContext({ tools: TOOLS });
    }
  } catch {
    /* experimental API - never let it break the page */
  }
}
