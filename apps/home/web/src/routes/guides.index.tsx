import type { ReactElement } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { INSTALL_GUIDES } from '@traks/shared';

export const Route = createFileRoute('/guides/')({
  component: GuidesIndex,
});

function GuidesIndex(): ReactElement {
  return (
    <div className="min-h-screen bg-[#F6F5F2]">
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <Link to="/" className="text-[13px] font-semibold text-foreground hover:underline">
          ← traks.dev
        </Link>
        <h1 className="mt-4 text-[32px] font-bold text-[#3D3B4F] tracking-[-0.02em]">
          Install guides
        </h1>
        <p className="mt-2 text-[15px] text-[#8A8580]">
          Tailored walkthroughs for every stack. The snippet is the same everywhere: under 1KB,
          cookieless, zero config.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {INSTALL_GUIDES.map(guide => (
            <Link
              key={guide.slug}
              to="/guides/$slug"
              params={{ slug: guide.slug }}
              className="group rounded-2xl bg-white p-5 shadow-float transition-all hover:-translate-y-[2px] hover:shadow-float-lg"
            >
              <p className="text-[15px] font-bold text-[#3D3B4F]">{guide.name}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[#9B9590]">{guide.blurb}</p>
            </Link>
          ))}
        </div>

        <p className="mt-10 text-[13px] text-[#8A8580]">
          Missing your stack? The plain{' '}
          <Link
            to="/guides/$slug"
            params={{ slug: 'html' }}
            className="font-semibold text-foreground hover:underline"
          >
            HTML guide
          </Link>{' '}
          works anywhere that renders a &lt;head&gt;.
        </p>
      </main>
    </div>
  );
}
