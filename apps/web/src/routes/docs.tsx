import type { ReactElement, ReactNode } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';

const COLLECT_URL = import.meta.env.VITE_COLLECT_URL || 'https://collect.traks.dev';
const API_URL = import.meta.env.VITE_API_URL || 'https://api.traks.dev';

export const Route = createFileRoute('/docs')({
  component: DocsPage,
});

function Code({ children }: { children: ReactNode }): ReactElement {
  return (
    <pre className="mt-3 rounded-xl border border-[#e8e3ed] bg-[#fdfbf8] px-4 py-3.5 text-[12.5px] leading-relaxed text-[#2D3436] font-mono whitespace-pre-wrap break-all select-all">
      {children}
    </pre>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="mt-12">
      <h2 className="text-[20px] font-bold text-[#2D3436] tracking-[-0.01em]">{title}</h2>
      <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-[#5a5550]">{children}</div>
    </section>
  );
}

function DocsPage(): ReactElement {
  return (
    <div className="min-h-screen bg-[#fdfbf8]">
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <Link to="/" className="text-[13px] text-[#9b72cf] hover:underline">
          ← traks.dev
        </Link>
        <h1 className="mt-4 text-[32px] font-bold text-[#2D3436] tracking-[-0.02em]">
          Documentation
        </h1>
        <p className="mt-2 text-[15px] text-[#8A8580]">
          Everything you need to install Traks and work with your data.
        </p>

        <Section title="1. Install the tracker">
          <p>
            Create a site in the dashboard, then add the snippet to your site&apos;s{' '}
            <code>&lt;head&gt;</code>. It&apos;s under 1KB, loads async, uses no cookies, and tracks
            SPA navigations automatically.
          </p>
          <Code>{`<script defer data-site="YOUR_SITE_KEY" src="${COLLECT_URL}/t.js"></script>`}</Code>
        </Section>

        <Section title="2. Track custom events">
          <p>
            Call <code>window.traks(name, props?, value?)</code> anywhere after the script loads:
          </p>
          <Code>{`traks('signup', { plan: 'pro' });\ntraks('purchase', { sku: 'T100' }, 49.99);`}</Code>
        </Section>

        <Section title="3. Query your raw data with DuckDB">
          <p>
            Enable <strong>Data export</strong> in your site settings. Every night we write the
            previous day&apos;s raw events as gzipped NDJSON, readable straight from DuckDB with
            your private token URL:
          </p>
          <Code>{`INSTALL httpfs; LOAD httpfs;\n\nSELECT country, COUNT(*) AS pageviews\nFROM read_ndjson_auto(\n  '${API_URL}/api/exports/YOUR_TOKEN/2026-07-07.ndjson.gz')\nGROUP BY country ORDER BY pageviews DESC;`}</Code>
          <p>
            List available files as JSON at <code>{API_URL}/api/exports/YOUR_TOKEN</code>. Each row
            contains the full event: timestamp, path, referrer, UTM tags, geo, device, session and
            (daily-rotating) visitor IDs, and custom event payloads.
          </p>
        </Section>

        <Section title="4. Share a public dashboard">
          <p>
            Flip on <strong>Public dashboard</strong> in site settings and share{' '}
            <code>{`${typeof window !== 'undefined' ? window.location.origin : 'https://traks.dev'}/share/SITE_ID`}</code>
            . Viewers see the same live stats you do — no account needed.
          </p>
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
