import type { ReactElement } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace';
import { MembersSection } from '@/components/workspace/MembersSection';

export const Route = createFileRoute('/portal/members')({
  component: MembersPage,
});

function MembersPage(): ReactElement {
  const { current } = useWorkspace();
  const isOwner = current?.role === 'owner';

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-[26px] font-bold text-[#3D3B4F] tracking-[-0.02em]">Members</h1>
        <p className="mt-1 text-[14px] text-[#9B9590]">
          {current ? `People with access to ${current.name}` : 'People with access'}
        </p>
      </div>

      <div className="flex max-w-[620px] flex-col gap-7">
        {isOwner ? (
          <MembersSection />
        ) : (
          <div className="rounded-[20px] bg-white px-8 py-14 text-center shadow-float">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
              <Users className="h-6 w-6 text-[#9B9590]" strokeWidth={1.6} />
            </div>
            <p className="text-[15px] font-semibold text-[#3D3B4F]">Owners manage members</p>
            <p className="mx-auto mt-2 max-w-sm text-[13px] text-[#9B9590]">
              Only a workspace owner can view and invite members here.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
