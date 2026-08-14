import { useState, type ReactElement } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Bot, Check, Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { skillMarkdown } from '@/lib/skill';
import { useCollectUrl } from '@/lib/config';

export const Route = createFileRoute('/portal/skill')({
  component: SkillPage,
});

/**
 * The agent skill, front and center: the SKILL.md a coding agent reads to
 * instrument a site with Traks and configure goals/funnels over MCP, with
 * this instance's real URLs baked in. Tokens are minted in Settings.
 */
function SkillPage(): ReactElement {
  const collectUrl = useCollectUrl();
  const origin = window.location.origin;
  const markdown = skillMarkdown(origin, collectUrl ?? origin);
  const mcpCommand = `claude mcp add --transport http traks ${origin}/api/mcp --header "Authorization: Bearer <token>"`;
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (text: string, tag: string): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setCopied(tag);
    setTimeout(() => setCopied(null), 2000);
  };

  const download = (): void => {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'SKILL.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-[26px] font-bold text-[#3D3B4F] tracking-[-0.02em]">
            <Bot className="h-6 w-6" strokeWidth={1.8} />
            Agent skill
          </h1>
          <p className="mt-1 max-w-[62ch] text-[14px] text-[#9B9590]">
            Drop this SKILL.md into your project&rsquo;s{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-[12px]">
              .claude/skills/traks/
            </code>{' '}
            folder and connect the MCP server — your coding agent can then instrument your
            site&rsquo;s code and configure goals and funnels here, in one task. Mint the API token
            in{' '}
            <Link
              to="/portal/settings"
              className="font-semibold text-[#3D3B4F] underline-offset-2 hover:underline"
            >
              Settings
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" onClick={() => void copy(markdown, 'md')} className="text-[13px]">
            {copied === 'md' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied === 'md' ? 'Copied' : 'Copy markdown'}
          </Button>
          <Button onClick={download} className="text-[13px] px-5">
            <Download className="h-3.5 w-3.5" />
            Download SKILL.md
          </Button>
        </div>
      </div>

      {/* Connect command */}
      <div className="mb-6 rounded-[20px] bg-white p-5 shadow-float">
        <p className="mb-2 text-[12px] font-semibold text-[#3D3B4F]">Connect the MCP server</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-[#F2F1ED] px-3 py-2.5 font-mono text-[11.5px] text-[#6E6C7C]">
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
      </div>

      {/* The skill itself */}
      <div className="overflow-hidden rounded-[20px] bg-white shadow-float">
        <div className="flex items-center justify-between border-b border-[#EEEDE9] px-5 py-3">
          <span className="font-mono text-[11.5px] text-[#9B9590]">SKILL.md</span>
          <span className="text-[11px] text-[#B5B0AA]">
            Your instance URLs are already filled in
          </span>
        </div>
        <pre className="max-h-[560px] overflow-y-auto whitespace-pre-wrap px-5 py-4 font-mono text-[12px] leading-relaxed text-[#3D3B4F]">
          {markdown}
        </pre>
      </div>
    </main>
  );
}
