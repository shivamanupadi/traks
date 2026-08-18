/**
 * AI assistants as a traffic channel.
 *
 * Classification happens at QUERY time from `referrer_hostname` - no event
 * schema change, and the list can grow in a release without touching stored
 * data. Hostnames are matched exactly (the collect worker stores the URL
 * hostname verbatim), so common variants are enumerated per assistant.
 */

export const AI_ASSISTANTS: { name: string; hosts: string[] }[] = [
  {
    name: 'ChatGPT',
    hosts: ['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com', 'openai.com', 'www.openai.com'],
  },
  { name: 'Claude', hosts: ['claude.ai', 'www.claude.ai', 'claude.com', 'www.claude.com'] },
  { name: 'Perplexity', hosts: ['perplexity.ai', 'www.perplexity.ai', 'pplx.ai'] },
  { name: 'Gemini', hosts: ['gemini.google.com', 'bard.google.com', 'aistudio.google.com'] },
  {
    name: 'Copilot',
    hosts: ['copilot.microsoft.com', 'copilot.cloud.microsoft', 'm365.cloud.microsoft'],
  },
  { name: 'Grok', hosts: ['grok.com', 'www.grok.com', 'grok.x.ai'] },
  { name: 'DeepSeek', hosts: ['chat.deepseek.com', 'deepseek.com', 'www.deepseek.com'] },
  { name: 'Meta AI', hosts: ['meta.ai', 'www.meta.ai'] },
  {
    name: 'Mistral',
    hosts: ['chat.mistral.ai', 'lechat.mistral.ai', 'mistral.ai', 'www.mistral.ai'],
  },
  { name: 'Poe', hosts: ['poe.com', 'www.poe.com'] },
  { name: 'You.com', hosts: ['you.com', 'www.you.com'] },
  { name: 'Phind', hosts: ['phind.com', 'www.phind.com'] },
  { name: 'Kimi', hosts: ['kimi.com', 'www.kimi.com', 'kimi.moonshot.cn'] },
  { name: 'Qwen', hosts: ['chat.qwen.ai', 'qwen.ai', 'www.qwen.ai'] },
  { name: 'DuckDuckGo AI', hosts: ['duck.ai', 'www.duck.ai'] },
];

/** Every AI referrer hostname, for WHERE ... IN clauses. */
export const AI_HOSTNAMES: string[] = AI_ASSISTANTS.flatMap(a => a.hosts);

/** The IN-list literal. Hostnames are our own constants - no user input. */
export const AI_HOSTNAME_IN: string = AI_HOSTNAMES.map(h => `'${h}'`).join(', ');

/** Hostname column -> assistant display name. Searched CASE (not simple
 *  CASE) - the form both R2 SQL and the DO's SQLite support. */
export function aiSourceCaseSql(col: string): string {
  const whens = AI_ASSISTANTS.flatMap(a =>
    a.hosts.map(h => `WHEN ${col} = '${h}' THEN '${a.name}'`)
  ).join(' ');
  return `CASE ${whens} ELSE 'Other' END`;
}
