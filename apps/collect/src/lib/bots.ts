const BOT_PATTERNS = [
  /bot/i,
  /crawl/i,
  /spider/i,
  /slurp/i,
  /mediapartners/i,
  /googlebot/i,
  /bingbot/i,
  /yandexbot/i,
  /baiduspider/i,
  /facebookexternalhit/i,
  /twitterbot/i,
  /linkedinbot/i,
  /whatsapp/i,
  /telegrambot/i,
  /discordbot/i,
  /slackbot/i,
  /applebot/i,
  /duckduckbot/i,
  /bytespider/i,
  /semrushbot/i,
  /ahrefsbot/i,
  /dotbot/i,
  /petalbot/i,
  /mj12bot/i,
  /scrapy/i,
  /headlesschrome/i,
  /phantomjs/i,
  /lighthouse/i,
  /pingdom/i,
  /uptimerobot/i,
];

export function isBot(ua: string): boolean {
  if (!ua) return true;
  return BOT_PATTERNS.some(pattern => pattern.test(ua));
}
