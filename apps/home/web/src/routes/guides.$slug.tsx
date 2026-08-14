import type { ReactElement } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { findInstallGuide, guideWithSnippet } from '@traks/shared';
import { EXAMPLE_COLLECT_URL } from '@/lib/config';

export const Route = createFileRoute('/guides/$slug')({
  component: GuidePage,
});

function GuidePage(): ReactElement {
  const { slug } = Route.useParams();
  const raw = findInstallGuide(slug);
  // Public pages show a placeholder key; the dashboard's install dialog
  // renders these same guides with the site's real snippet.
  const guide = raw && guideWithSnippet(raw, 'YOUR_SITE_KEY', EXAMPLE_COLLECT_URL);

  if (!guide) {
    return (
      <div className="min-h-screen bg-[#F6F5F2]">
        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
          <Link to="/guides" className="text-[13px] font-semibold text-foreground hover:underline">
            ← All guides
          </Link>
          <h1 className="mt-4 text-[26px] font-bold text-[#3D3B4F]">Guide not found</h1>
          <p className="mt-2 text-[14px] text-[#8A8580]">
            No guide for &ldquo;{slug}&rdquo; — the HTML guide covers any stack that renders a
            &lt;head&gt;.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F6F5F2]">
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <Link to="/guides" className="text-[13px] font-semibold text-foreground hover:underline">
          ← All guides
        </Link>
        <h1 className="mt-4 text-[32px] font-bold text-[#3D3B4F] tracking-[-0.02em]">
          Install Traks on {guide.name}
        </h1>
        <p className="mt-2 text-[15px] text-[#8A8580]">
          {guide.blurb} Create a site in your dashboard first — its settings page shows this exact
          snippet with your real site key filled in.
        </p>

        <div className="mt-8 space-y-8">
          {guide.steps.map((step, i) => (
            <section key={step.title}>
              <h2 className="text-[18px] font-bold text-[#3D3B4F] tracking-[-0.01em]">
                {i + 1}. {step.title}
              </h2>
              {step.body && (
                <p className="mt-2 text-[14px] leading-relaxed text-[#5a5550]">{step.body}</p>
              )}
              {step.code && (
                <div className="mt-3 overflow-hidden rounded-2xl bg-white shadow-float">
                  {step.code.filename && (
                    <div className="border-b border-[#EEEEF2] px-4 py-2 font-mono text-[11px] text-[#9B9590]">
                      {step.code.filename}
                    </div>
                  )}
                  <pre className="whitespace-pre-wrap break-all select-all px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-[#3D3B4F]">
                    {step.code.code}
                  </pre>
                </div>
              )}
            </section>
          ))}
        </div>

        <div className="mt-12 rounded-2xl border border-[#EEEEF2] bg-white p-5 shadow-float">
          <p className="text-[14px] font-semibold text-[#3D3B4F]">Don&rsquo;t have Traks yet?</p>
          <p className="mt-1 text-[13px] leading-relaxed text-[#8A8580]">
            Deploy your own instance into your Cloudflare account in about two minutes — free,
            open, and your data never leaves your account.
          </p>
          <Link
            to="/deploy"
            className="mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-[#3D3B4F] px-5 text-[13px] font-semibold text-white transition-colors hover:bg-[#2C2B3B]"
          >
            Deploy Traks
          </Link>
        </div>
      </main>
    </div>
  );
}
