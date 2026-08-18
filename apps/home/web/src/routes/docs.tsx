import type { ReactElement } from 'react';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { JumpMenu, Sidebar, useDocsActive } from '@/docs/shared';

export const Route = createFileRoute('/docs')({
  component: DocsLayout,
});

function DocsLayout(): ReactElement {
  const active = useDocsActive();
  return (
    <div className="min-h-screen bg-[#F6F5F2]">
      {/* header */}
      <header className="mx-auto flex w-full max-w-[1120px] items-center justify-between px-4 py-5 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <img src="/logo.svg" alt="Traks" className="h-6 w-6" />
          <span className="text-[15px] font-bold tracking-tight text-[#3D3B4F]">Traks</span>
          <span className="ml-1 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#B3B1BE]">
            Docs
          </span>
        </Link>
        <a
          href="/deploy"
          className="inline-flex h-9 items-center rounded-full bg-[#3D3B4F] px-4 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#2C2B3B]"
        >
          Deploy now
        </a>
      </header>

      <div className="mx-auto w-full max-w-[1120px] px-4 sm:px-6 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14">
        <aside className="hidden lg:block">
          <div className="sticky top-8 max-h-[calc(100vh-4rem)] overflow-y-auto pb-8 pr-2">
            <Sidebar active={active} />
          </div>
        </aside>

        <main className="pb-24 pt-2 lg:pt-0">
          <JumpMenu active={active} />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
