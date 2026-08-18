import type { ReactElement } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { findInstallGuide, guideWithSnippet, INSTALL_GUIDES } from '@traks/shared';
import { EXAMPLE_COLLECT_URL } from '@/lib/config';
import { Note } from '@/docs/shared';

export const Route = createFileRoute('/docs/install/$slug')({
  component: GuidePage,
});

function GuidePage(): ReactElement {
  const { slug } = Route.useParams();
  const raw = findInstallGuide(slug);
  // Public pages show a placeholder key; the dashboard's install dialog
  // renders these same guides with the site's real snippet.
  const guide = raw && guideWithSnippet(raw, 'YOUR_SITE_KEY', EXAMPLE_COLLECT_URL);
  const idx = INSTALL_GUIDES.findIndex(g => g.slug === slug);
  const prev = idx > 0 ? INSTALL_GUIDES[idx - 1] : undefined;
  const next = idx >= 0 && idx < INSTALL_GUIDES.length - 1 ? INSTALL_GUIDES[idx + 1] : undefined;

  if (!guide) {
    return (
      <div className="mt-6 lg:mt-0">
        <h1 className="text-[26px] font-bold text-[#3D3B4F]">Guide not found</h1>
        <p className="mt-2 text-[14px] text-[#8A8580]">
          No guide for &ldquo;{slug}&rdquo;. The{' '}
          <Link
            to="/docs/install/$slug"
            params={{ slug: 'html' }}
            className="font-semibold text-[#3D3B4F] hover:underline"
          >
            HTML guide
          </Link>{' '}
          covers any stack that renders a &lt;head&gt;.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 lg:mt-0">
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#B3B1BE]">
        Install guide
      </span>
      <h1 className="mt-2 text-[32px] font-bold tracking-[-0.02em] text-[#3D3B4F]">
        Install Traks on {guide.name}
      </h1>
      <p className="mt-2 max-w-[58ch] text-[15px] leading-relaxed text-[#8A8580]">
        {guide.blurb} Create a site in your dashboard first; its Install button shows this exact
        snippet with your real site key filled in.
      </p>

      <div className="mt-8 space-y-4">
        {guide.steps.map((step, i) => (
          <section
            key={step.title}
            className="rounded-[18px] border border-[#E6E4DE] bg-white p-6 shadow-float sm:p-7"
          >
            <div className="flex items-start gap-4">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#E6E4DE] bg-white font-mono text-[11.5px] font-semibold text-[#3D3B4F]">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[16px] font-bold tracking-[-0.01em] text-[#3D3B4F]">
                  {step.title}
                </h2>
                {step.body && (
                  <p className="mt-1.5 text-[14px] leading-relaxed text-[#5a5550]">{step.body}</p>
                )}
                {step.code && (
                  <div className="mt-3 overflow-hidden rounded-2xl bg-[#34324A]">
                    {step.code.filename && (
                      <div className="border-b border-white/[0.07] px-4 py-2 font-mono text-[11px] text-[#8C8A99]">
                        {step.code.filename}
                      </div>
                    )}
                    <pre className="overflow-x-auto whitespace-pre-wrap break-all select-all px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-[#C9C8D4]">
                      {step.code.code}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>

      <div className="mt-6">
        <Note>
          Once the snippet is live, head back to{' '}
          <Link to="/docs" hash="verify" className="font-semibold text-[#3D3B4F] hover:underline">
            Verify it works
          </Link>{' '}
          in the docs, then set up{' '}
          <Link to="/docs" hash="events" className="font-semibold text-[#3D3B4F] hover:underline">
            custom events
          </Link>{' '}
          and goals.
        </Note>
      </div>

      <div className="mt-8 flex items-center justify-between gap-4 border-t border-[#E6E4DE] pt-4 text-[12.5px]">
        {prev ? (
          <Link
            to="/docs/install/$slug"
            params={{ slug: prev.slug }}
            className="text-[#8C8A99] hover:text-[#3D3B4F]"
          >
            ← {prev.name}
          </Link>
        ) : (
          <Link to="/docs" hash="install" className="text-[#8C8A99] hover:text-[#3D3B4F]">
            ← Install the tracker
          </Link>
        )}
        {next ? (
          <Link
            to="/docs/install/$slug"
            params={{ slug: next.slug }}
            className="font-semibold text-[#3D3B4F] hover:underline"
          >
            Next: {next.name} →
          </Link>
        ) : (
          <Link to="/docs" hash="verify" className="font-semibold text-[#3D3B4F] hover:underline">
            Next: Verify it works →
          </Link>
        )}
      </div>
    </div>
  );
}
