import { createFileRoute, redirect } from '@tanstack/react-router';

/** The API tab became "MCP server" at /portal/mcp; keep old links working. */
export const Route = createFileRoute('/portal/api')({
  beforeLoad: () => {
    throw redirect({ to: '/portal/mcp', replace: true });
  },
});
