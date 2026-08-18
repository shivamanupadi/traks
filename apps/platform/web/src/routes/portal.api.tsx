import type { ReactElement } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { AgentAccessCard } from '@/components/agents/AgentAccessCard';

export const Route = createFileRoute('/portal/api')({
  component: ApiPage,
});

/** API tokens + MCP connection, as a first-class tab (the skill itself has
 *  its own tab next door). */
function ApiPage(): ReactElement {
  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[26px] font-bold text-[#3D3B4F] tracking-[-0.02em]">API &amp; MCP</h1>
        <p className="mt-1 max-w-[62ch] text-[14px] text-[#9B9590]">
          Personal API tokens authenticate coding agents and scripts against this instance,
          including the MCP server your agent connects to.
        </p>
      </div>
      <div className="flex max-w-[620px] flex-col gap-7">
        <AgentAccessCard />
      </div>
    </main>
  );
}
