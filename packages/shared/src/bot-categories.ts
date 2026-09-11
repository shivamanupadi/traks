/**
 * Query-time labels for crawler traffic. Ingest still stores bot pageviews
 * as event_type 'bot_pageview' with a display name in `browser`; this file
 * only groups those names (plus AI-assistant referrers) for the Crawlers
 * panel. The list can grow without rewriting stored events.
 */

export type VisitorCategory =
  | 'human'
  | 'search_bot'
  | 'ai_bot'
  | 'ai_referral'
  | 'other_bot';

const SEARCH_BOTS = new Set([
  'Googlebot',
  'Google Mediapartners',
  'Bingbot',
  'YandexBot',
  'Baiduspider',
  'DuckDuckBot',
  'Applebot',
]);

const AI_BOTS = new Set([
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
  'Perplexity-User',
  'Meta-ExternalAgent',
  'Amazonbot',
  'Bytespider',
  'Google-Extended',
  'Google-CloudVertexBot',
]);

const AI_BOT_RE =
  /gptbot|oai-searchbot|chatgpt|claudebot|claude-user|claude-search|perplexity|google-extended|google-cloudvertex|ccbot|diffbot|bytespider|meta-external/i;

const SEARCH_BOT_RE = /googlebot|bingbot|yandex|baiduspider|duckduckbot|applebot|mediapartners/i;

/** Map an ingest bot display name (or raw UA token) onto a visitor category. */
export function botCategory(name: string): Exclude<VisitorCategory, 'human' | 'ai_referral'> {
  if (!name) return 'other_bot';
  if (AI_BOTS.has(name) || AI_BOT_RE.test(name)) return 'ai_bot';
  if (SEARCH_BOTS.has(name) || SEARCH_BOT_RE.test(name)) return 'search_bot';
  return 'other_bot';
}

export const VISITOR_CATEGORY_LABEL: Record<VisitorCategory, string> = {
  human: 'Human',
  search_bot: 'Search crawler',
  ai_bot: 'AI crawler',
  ai_referral: 'AI referral',
  other_bot: 'Other bot',
};
