import type { ReactElement, ReactNode } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { EXAMPLE_COLLECT_URL } from '@/lib/config';

export const Route = createFileRoute('/docs')({
  component: DocsPage,
});

function Code({ children }: { children: ReactNode }): ReactElement {
  return (
    <pre className="mt-3 rounded-2xl bg-white px-4 py-3.5 text-[12.5px] leading-relaxed text-[#3D3B4F] font-mono whitespace-pre-wrap break-all select-all shadow-float">
      {children}
    </pre>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="mt-12">
      <h2 className="text-[20px] font-bold text-[#3D3B4F] tracking-[-0.01em]">{title}</h2>
      <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-[#5a5550]">{children}</div>
    </section>
  );
}

function DocsPage(): ReactElement {
  return (
    <div className="min-h-screen bg-[#F6F5F2]">
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <Link to="/" className="text-[13px] font-semibold text-foreground hover:underline">
          ← traks.dev
        </Link>
        <h1 className="mt-4 text-[32px] font-bold text-[#3D3B4F] tracking-[-0.02em]">
          Documentation
        </h1>
        <p className="mt-2 text-[15px] text-[#8A8580]">
          Everything you need to install Traks and work with your data.
        </p>

        <Section title="1. Install the tracker">
          <p>
            Create a site in the dashboard, then add the snippet to your site&apos;s{' '}
            <code>&lt;head&gt;</code>. It&apos;s under 1KB, loads async, uses no cookies, and tracks
            SPA navigations automatically. Clicks on outbound links and file downloads are tracked
            out of the box and appear in the dashboard&apos;s <strong>Links</strong> panel (and as
            the <code>Outbound Link: Click</code> / <code>File Download</code> events, usable as
            goals).
          </p>
          <Code>{`<script>window.traks=window.traks||function(){(window.traks.q=window.traks.q||[]).push(arguments)}</script>\n<script defer data-site="YOUR_SITE_KEY" src="${EXAMPLE_COLLECT_URL}/t.js"></script>`}</Code>
          <p>
            Using a framework or site builder? There are{' '}
            <Link to="/guides" className="font-semibold text-foreground hover:underline">
              tailored install guides
            </Link>{' '}
            for Next.js, WordPress, Astro, Shopify, Webflow and more.
          </p>
          <p>
            Optional attributes: add <code>data-hash</code> if your app uses hash-based routing (
            <code>#/route</code> becomes part of the page path), and put <code>data-404</code> on
            the snippet in your 404 template to record broken URLs as a <code>404</code> event
            (click it in the Custom Events panel to see which paths).
          </p>
        </Section>

        <Section title="2. Track custom events">
          <p>
            Call <code>window.traks(name, props?, value?)</code> anywhere; calls made before the
            script loads are queued by the one-line stub and flushed on load (dropped only if the
            script never loads, e.g. an ad blocker):
          </p>
          <Code>{`traks('signup', { plan: 'pro' });\ntraks('purchase', { sku: 'T100' }, 49.99);`}</Code>
        </Section>

        <Section title="Privacy">
          <p>
            Traks stores no cookies and no raw IP addresses. Visitors are counted with a
            daily-rotating hash (HMAC of IP + user agent + site key with a server secret), so the
            same visitor cannot be linked across days. All data lives in your Cloudflare region and
            is never sold or shared.
          </p>
        </Section>
      </main>
    </div>
  );
}
