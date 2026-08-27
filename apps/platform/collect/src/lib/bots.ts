// Bot traffic is counted, not dropped: ingest stores matching pageviews as
// event_type 'bot_pageview' with the display name below in `browser`, so
// every human-facing query (all predicated on event_type) never sees them
// while the dashboard's Bots panel can GROUP BY name.
//
// Order matters: the first matching pattern names the bot, so specific
// entries (googlebot, bingbot) sit above the generic /bot/i catch-all.
const NAMED_BOTS: [RegExp, string][] = [
  [/googlebot/i, 'Googlebot'],
  [/mediapartners/i, 'Google Mediapartners'],
  [/bingbot/i, 'Bingbot'],
  [/yandexbot/i, 'YandexBot'],
  [/baiduspider/i, 'Baiduspider'],
  [/duckduckbot/i, 'DuckDuckBot'],
  [/applebot/i, 'Applebot'],
  // AI crawlers and assistant fetchers. All would match the generic /bot/i
  // fallback; named entries give them stable display names in the panel.
  [/gptbot/i, 'GPTBot'],
  [/oai-searchbot/i, 'OAI-SearchBot'],
  [/chatgpt-user/i, 'ChatGPT-User'],
  [/claudebot/i, 'ClaudeBot'],
  [/claude-user/i, 'Claude-User'],
  [/claude-searchbot/i, 'Claude-SearchBot'],
  [/perplexitybot/i, 'PerplexityBot'],
  [/perplexity-user/i, 'Perplexity-User'],
  [/meta-externalagent/i, 'Meta-ExternalAgent'],
  [/amazonbot/i, 'Amazonbot'],
  [/bytespider/i, 'Bytespider'],
  // Social link preview fetchers
  [/facebookexternalhit/i, 'Facebook'],
  [/twitterbot/i, 'Twitterbot'],
  [/linkedinbot/i, 'LinkedInBot'],
  [/whatsapp/i, 'WhatsApp'],
  [/telegrambot/i, 'Telegram'],
  [/discordbot/i, 'Discord'],
  [/slackbot/i, 'Slack'],
  // SEO / marketing crawlers
  [/semrushbot/i, 'SemrushBot'],
  [/ahrefsbot/i, 'AhrefsBot'],
  [/dotbot/i, 'DotBot'],
  [/petalbot/i, 'PetalBot'],
  [/mj12bot/i, 'MJ12bot'],
  // Monitoring and automation
  [/lighthouse/i, 'Lighthouse'],
  [/pingdom/i, 'Pingdom'],
  [/uptimerobot/i, 'UptimeRobot'],
  [/headlesschrome/i, 'Headless Chrome'],
  [/phantomjs/i, 'PhantomJS'],
  [/scrapy/i, 'Scrapy'],
];

// Generic signals with no named entry: pull the product token containing the
// signal ("SomeNewBot/1.2" -> "SomeNewBot") so unknown crawlers still get a
// usable panel row instead of an "Other" bucket.
const GENERIC_BOT = /([a-z0-9._-]*(?:bot|crawl|spider|slurp)[a-z0-9._-]*)/i;

/**
 * Display name of the bot behind a user agent, or null for human traffic.
 * An empty UA is treated as a bot: no real browser omits the header.
 */
export function botName(ua: string): string | null {
  if (!ua) return 'Unknown Bot';
  for (const [pattern, name] of NAMED_BOTS) {
    if (pattern.test(ua)) return name;
  }
  const generic = GENERIC_BOT.exec(ua);
  if (generic) return generic[1].slice(0, 64);
  return null;
}

export function isBot(ua: string): boolean {
  return botName(ua) !== null;
}
