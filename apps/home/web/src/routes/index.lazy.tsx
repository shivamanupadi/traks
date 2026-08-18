import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { EXAMPLE_COLLECT_URL, useLatestVersion } from '@/lib/config';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  ArrowUpRight,
  Activity,
  Check,
  FileText,
  Filter,
  Globe,
  MapPin,
  MousePointerClick,
  Smartphone,
  Target,
  type LucideIcon,
} from 'lucide-react';

export const Route = createLazyFileRoute('/')({
  component: LandingPage,
});

/* ── shared bits ─────────────────────────────────────────────── */

const EASE = [0.25, 0.1, 0.25, 1] as const;

interface RiseProps {
  initial: { opacity: number; y: number };
  whileInView: { opacity: number; y: number };
  viewport: { once: boolean; margin: string };
  transition: { duration: number; delay: number; ease: typeof EASE };
}

const rise = (delay = 0): RiseProps => ({
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.55, delay, ease: EASE },
});

function Mono({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <span className={`font-mono text-[11px] font-medium uppercase tracking-[0.14em] ${className}`}>
      {children}
    </span>
  );
}

function SectionRule({ n, label }: { n: string; label: string }): ReactElement {
  return (
    <div className="flex items-baseline gap-4 border-t border-[#E6E4DE] pt-5">
      <Mono className="text-[#B3B1BE]">{n}</Mono>
      <Mono className="text-[#6E6C7C]">{label}</Mono>
    </div>
  );
}

/* ── dashboard mock ──────────────────────────────────────────── */

const SPARK = [18, 24, 21, 30, 26, 34, 31, 42, 38, 47, 43, 56, 50, 62, 58, 70, 64, 76, 72, 84];

function sparkPath(values: number[], w: number, h: number): { line: string; area: string } {
  const max = Math.max(...values) * 1.15;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - (v / max) * h] as const);
  const line = pts
    .map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x.toFixed(1)} ${y.toFixed(1)}`))
    .join(' ');
  return { line, area: `${line} L ${w} ${h} L 0 ${h} Z` };
}

const METRICS = [
  { label: 'Visitors', value: '12,481', change: '+8.2%' },
  { label: 'Pageviews', value: '38,204', change: '+12.4%' },
  { label: 'Bounce rate', value: '42%', change: '−3.1%' },
  { label: 'Visit duration', value: '1m 54s', change: '+0.9%' },
];

const MOCK_PAGES = [
  { name: '/', share: 92, value: '9,320' },
  { name: '/pricing', share: 61, value: '4,187' },
  { name: '/blog/launch', share: 44, value: '2,905' },
  { name: '/docs', share: 27, value: '1,733' },
];

const MOCK_SOURCES = [
  { name: 'google.com', share: 88, value: '6,914' },
  { name: 'news.ycombinator.com', share: 52, value: '3,516' },
  { name: 'Direct', share: 46, value: '3,102' },
  { name: 'x.com', share: 22, value: '1,048' },
];

function MockList({ title, rows }: { title: string; rows: typeof MOCK_PAGES }): ReactElement {
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between">
        <Mono className="text-[#8C8A99]">{title}</Mono>
        <Mono className="text-[#B3B1BE]">Visitors</Mono>
      </div>
      <div className="space-y-1">
        {rows.map(r => (
          <div
            key={r.name}
            className="relative flex items-center justify-between rounded-md px-2.5 py-[7px]"
          >
            <span
              className="absolute inset-y-0 left-0 rounded-md bg-[#3D3B4F]/[0.05]"
              style={{ width: `${r.share}%` }}
            />
            <span className="relative z-10 text-[12.5px] text-[#3D3B4F]">{r.name}</span>
            <span className="relative z-10 font-mono text-[12px] tabular-nums text-[#6E6C7C]">
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardMock(): ReactElement {
  const { line, area } = sparkPath(SPARK, 720, 120);
  return (
    <div className="overflow-hidden rounded-[18px] border border-[#E6E4DE] bg-white shadow-[0_1px_2px_rgba(61,59,79,0.04),0_16px_48px_rgba(61,59,79,0.07)]">
      {/* window chrome */}
      <div className="flex items-center justify-between border-b border-[#EEEEF2] px-5 py-3">
        <div className="flex items-center gap-2.5">
          <img src="/logo.svg" alt="" className="h-4.5 w-4.5" />
          <span className="text-[13px] font-semibold text-[#3D3B4F]">yoursite.com</span>
        </div>
        <span className="flex items-center gap-2 rounded-full bg-[#F2F1ED] py-1 pl-2.5 pr-3">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-mint" />
          </span>
          <span className="font-mono text-[11px] font-medium text-[#3D3B4F]">23 online</span>
        </span>
      </div>

      {/* metrics */}
      <div className="grid grid-cols-2 gap-px bg-[#EEEEF2] sm:grid-cols-4">
        {METRICS.map(m => (
          <div key={m.label} className="bg-white px-5 py-4">
            <Mono className="text-[#8C8A99]">{m.label}</Mono>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="font-mono text-[20px] font-semibold tabular-nums tracking-tight text-[#3D3B4F]">
                {m.value}
              </span>
              <span className="font-mono text-[11px] text-[#8C8A99]">{m.change}</span>
            </div>
          </div>
        ))}
      </div>

      {/* sparkline */}
      <div className="border-t border-[#EEEEF2] px-5 pb-1 pt-4">
        <svg viewBox="0 0 720 120" className="block h-[110px] w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#28E99F" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#28E99F" stopOpacity="0" />
            </linearGradient>
          </defs>
          <motion.path
            d={area}
            fill="url(#spark-fill)"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.7 }}
          />
          <motion.path
            d={line}
            fill="none"
            stroke="#3D3B4F"
            strokeWidth="2"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.1, delay: 0.25, ease: EASE }}
          />
        </svg>
      </div>

      {/* panels */}
      <div className="grid grid-cols-1 gap-8 border-t border-[#EEEEF2] px-5 py-5 sm:grid-cols-2">
        <MockList title="Top pages" rows={MOCK_PAGES} />
        <MockList title="Top sources" rows={MOCK_SOURCES} />
      </div>
    </div>
  );
}

/* ── content ─────────────────────────────────────────────────── */

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: Activity,
    title: 'Real-time',
    desc: 'A live visitor count served from the edge, with today’s numbers updating every few seconds. No ingest delay.',
  },
  {
    icon: FileText,
    title: 'Pages',
    desc: 'Pageviews and unique visitors for every URL, including entry and exit pages, so you see where journeys start and stall.',
  },
  {
    icon: ArrowUpRight,
    title: 'Sources',
    desc: 'Referrers plus full UTM breakdowns (source, medium, and campaign) to tell you which channels actually convert.',
  },
  {
    icon: MapPin,
    title: 'Locations',
    desc: 'Visitors by country, region, and city, resolved at the edge without storing a single IP address.',
  },
  {
    icon: Smartphone,
    title: 'Devices',
    desc: 'Browser, operating system, and screen size: enough to know what to test on, nothing you don’t need.',
  },
  {
    icon: Target,
    title: 'Events & goals',
    desc: 'Custom events with one call to window.traks(). Outbound clicks and file downloads are tracked automatically. Turn any of them into a goal with a conversion value.',
  },
];

const PRIVACY_POINTS = [
  'No cookies and nothing stored in the browser, so no consent banner is required',
  'Visitors are counted with daily-rotating hashed identifiers, never profiles',
  'IP addresses are used in-memory to resolve geography, then discarded',
  'GDPR, ePrivacy, and PECR compliant by design, not by checkbox',
];

const STACK = ['Workers', 'D1', 'R2 SQL', 'Durable Objects'];

/* ── page ────────────────────────────────────────────────────── */

function NavLink({ id, children }: { id: string; children: ReactNode }): ReactElement {
  return (
    <a
      href={`#${id}`}
      onClick={e => {
        e.preventDefault();
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
      }}
      className="rounded-md px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#6E6C7C] transition-colors hover:text-[#3D3B4F]"
    >
      {children}
    </a>
  );
}

function LandingPage(): ReactElement {
  const latestVersion = useLatestVersion();
  return (
    <div className="min-h-screen bg-[#F6F5F2] text-[#3D3B4F]">
      {/* dot grid ground */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(61,59,79,0.075) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
          maskImage: 'linear-gradient(to bottom, black 0%, transparent 55%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 55%)',
        }}
      />

      {/* header */}
      <header className="relative z-10 mx-auto flex w-full max-w-[1060px] items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <img src="/logo.svg" alt="Traks" className="h-7 w-7" />
          <span className="text-[16px] font-bold tracking-tight">Traks</span>
        </div>
        <nav className="flex items-center gap-1">
          <div className="hidden sm:flex sm:items-center sm:gap-1">
            <NavLink id="features">Features</NavLink>
            <NavLink id="how">How it works</NavLink>
            <NavLink id="cost">Cost</NavLink>
            <a
              href="/docs"
              className="rounded-md px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#6E6C7C] transition-colors hover:text-[#3D3B4F]"
            >
              Docs
            </a>
          </div>
          <a
            href="/deploy"
            className="ml-2 inline-flex h-9 items-center gap-1.5 rounded-full bg-[#3D3B4F] px-4 text-[12.5px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-[#2C2B3B] hover:shadow-md"
          >
            Deploy now
          </a>
        </nav>
      </header>

      <main className="relative z-10">
        {/* hero */}
        <section className="mx-auto w-full max-w-[1060px] px-6 pb-20 pt-14 sm:pt-20">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            <Mono className="text-[#8C8A99]">Self-hosted web analytics</Mono>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08, ease: EASE }}
            className="mt-5 max-w-[15ch] text-[clamp(40px,7vw,72px)] font-bold leading-[1.02] tracking-[-0.035em]"
          >
            Analytics you{' '}
            <span className="relative inline-block">
              own
              <motion.span
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.5, delay: 0.7, ease: EASE }}
                className="absolute -bottom-1 left-0 right-0 h-[5px] origin-left rounded-full bg-mint"
              />
            </span>
            , not rent.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.18, ease: EASE }}
            className="mt-6 max-w-[52ch] text-[16px] leading-relaxed text-[#6E6C7C] sm:text-[17px]"
          >
            Traks runs entirely in your own Cloudflare account: a cookieless tracker under
            1&nbsp;KB, a real-time dashboard, and traffic data that never touches anyone
            else&rsquo;s servers.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.28, ease: EASE }}
            className="mt-9 flex flex-wrap items-center gap-4"
          >
            <a
              href="/deploy"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-[#3D3B4F] px-7 text-[14px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-[#2C2B3B] hover:shadow-lg"
            >
              Deploy to your Cloudflare
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="/docs"
              className="inline-flex h-12 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold text-[#3D3B4F] underline-offset-4 transition-colors hover:underline"
            >
              Read the docs
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.45 }}
            className="mt-8"
          >
            <Mono className="text-[#B3B1BE]">
              No cookies&ensp;·&ensp;No consent banner&ensp;·&ensp;&lt;&thinsp;1 KB script
            </Mono>
          </motion.div>

          {/* dashboard mock */}
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.4, ease: EASE }}
            className="mt-16"
          >
            <DashboardMock />
          </motion.div>
        </section>

        {/* features */}
        <section id="features" className="mx-auto w-full max-w-[1060px] px-6 py-16 sm:py-20">
          <motion.div {...rise()}>
            <SectionRule n="01" label="Everything measured" />
            <h2 className="mt-8 max-w-[24ch] text-[28px] font-bold leading-tight tracking-[-0.02em] sm:text-[36px]">
              The numbers you check daily, without the two hundred reports you don&rsquo;t.
            </h2>
          </motion.div>

          <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-[18px] border border-[#E6E4DE] bg-[#E6E4DE] sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.div key={f.title} {...rise(i * 0.05)} className="bg-white p-7">
                <f.icon className="h-[18px] w-[18px] text-[#8C8A99]" strokeWidth={1.6} />
                <h3 className="mt-4 text-[15px] font-semibold">{f.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-[#8C8A99]">{f.desc}</p>
              </motion.div>
            ))}
          </div>

          <motion.div {...rise(0.1)} className="mt-6 flex items-center gap-3 px-1">
            <Filter className="h-3.5 w-3.5 shrink-0 text-[#B3B1BE]" strokeWidth={1.6} />
            <p className="text-[13px] text-[#8C8A99]">
              Every row is a filter. Click any page, country, or referrer to segment the whole
              dashboard by it.
            </p>
          </motion.div>
        </section>

        {/* how it works */}
        <section id="how" className="mx-auto w-full max-w-[1060px] px-6 py-16 sm:py-20">
          <motion.div {...rise()}>
            <SectionRule n="02" label="How it works" />
          </motion.div>

          <div className="mt-12 grid grid-cols-1 gap-12 lg:grid-cols-[5fr_6fr] lg:gap-16">
            <div className="flex flex-col gap-9">
              {[
                {
                  n: '1',
                  title: 'Drop in one script tag',
                  desc: 'Under 1 KB, loads deferred, zero impact on Core Web Vitals. Works with SPAs, hash routers, and plain HTML alike.',
                },
                {
                  n: '2',
                  title: 'Watch visitors arrive',
                  desc: 'Today’s traffic streams in live from an edge Durable Object. No sampling, no processing queue, no "data may take 24 hours".',
                },
                {
                  n: '3',
                  title: 'Track what matters',
                  desc: 'Fire custom events for signups and purchases, then promote them to goals with conversion values. Outbound links and downloads come free.',
                },
              ].map((s, i) => (
                <motion.div key={s.n} {...rise(i * 0.07)} className="flex gap-5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E6E4DE] bg-white font-mono text-[12px] font-semibold text-[#3D3B4F]">
                    {s.n}
                  </span>
                  <div>
                    <h3 className="text-[15px] font-semibold">{s.title}</h3>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-[#8C8A99]">{s.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* code block */}
            <motion.div {...rise(0.12)}>
              <div className="overflow-hidden rounded-[18px] bg-[#34324A] shadow-[0_16px_48px_rgba(61,59,79,0.18)]">
                <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3">
                  <Mono className="text-[#8C8A99]">index.html</Mono>
                  <Mono className="text-mint">Add to any site</Mono>
                </div>
                <pre className="overflow-x-auto p-5 font-mono text-[12.5px] leading-[1.8] text-[#C9C8D4]">
                  <code>
                    <span className="text-[#75738C]">{'<'}</span>
                    <span className="text-white">script</span>{' '}
                    <span className="text-[#93F4CF]">defer</span>
                    {'\n  '}
                    <span className="text-[#93F4CF]">data-site</span>
                    <span className="text-[#75738C]">=</span>
                    <span className="text-[#F2B5A4]">&quot;YOUR_SITE_KEY&quot;</span>
                    {'\n  '}
                    <span className="text-[#93F4CF]">src</span>
                    <span className="text-[#75738C]">=</span>
                    <span className="text-[#F2B5A4]">&quot;{EXAMPLE_COLLECT_URL}/t.js&quot;</span>
                    <span className="text-[#75738C]">{'>'}</span>
                    {'\n'}
                    <span className="text-[#75738C]">{'</'}</span>
                    <span className="text-white">script</span>
                    <span className="text-[#75738C]">{'>'}</span>
                    {'\n\n'}
                    <span className="text-[#75738C]">{'// later, anywhere:'}</span>
                    {'\n'}
                    <span className="text-white">window</span>
                    <span className="text-[#75738C]">.</span>
                    <span className="text-[#93F4CF]">traks</span>
                    <span className="text-[#75738C]">(</span>
                    <span className="text-[#F2B5A4]">&apos;signup&apos;</span>
                    <span className="text-[#75738C]">, {'{'} </span>
                    <span className="text-[#C9C8D4]">plan</span>
                    <span className="text-[#75738C]">: </span>
                    <span className="text-[#F2B5A4]">&apos;pro&apos;</span>
                    <span className="text-[#75738C]"> {'}'}, </span>
                    <span className="text-[#93F4CF]">49</span>
                    <span className="text-[#75738C]">)</span>
                  </code>
                </pre>
              </div>
            </motion.div>
          </div>
        </section>

        {/* privacy + stack */}
        <section className="mx-auto w-full max-w-[1060px] px-6 py-16 sm:py-20">
          <div className="grid grid-cols-1 gap-14 lg:grid-cols-2 lg:gap-16">
            <motion.div {...rise()}>
              <SectionRule n="03" label="Private by default" />
              <h2 className="mt-8 text-[24px] font-bold tracking-[-0.02em] sm:text-[28px]">
                Respectful of every visitor.
              </h2>
              <ul className="mt-6 space-y-3.5">
                {PRIVACY_POINTS.map(p => (
                  <li
                    key={p}
                    className="flex items-start gap-3 text-[13.5px] leading-relaxed text-[#6E6C7C]"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#3D3B4F]" strokeWidth={2} />
                    {p}
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div {...rise(0.08)}>
              <SectionRule n="04" label="Your stack" />
              <h2 className="mt-8 text-[24px] font-bold tracking-[-0.02em] sm:text-[28px]">
                Deployed once, yours forever.
              </h2>
              <p className="mt-4 text-[13.5px] leading-relaxed text-[#6E6C7C]">
                Traks isn&rsquo;t a subscription dashboard holding your history hostage. It deploys
                into your own Cloudflare account, stores events in your own database, and serves the
                dashboard from your own domain. Cloudflare&rsquo;s $5/mo Workers plan covers
                millions of events, and if you ever leave, the data is already yours.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {STACK.map(s => (
                  <span
                    key={s}
                    className="rounded-full border border-[#E6E4DE] bg-white px-3.5 py-1.5 font-mono text-[11px] font-medium text-[#6E6C7C]"
                  >
                    {s}
                  </span>
                ))}
              </div>
              <div className="mt-6 flex items-center gap-2.5">
                <Globe className="h-3.5 w-3.5 text-[#B3B1BE]" strokeWidth={1.6} />
                <p className="text-[12.5px] text-[#8C8A99]">
                  One worker, one database, one cron. Nothing else to operate.
                </p>
              </div>
            </motion.div>
          </div>
        </section>

        {/* cost */}
        <section id="cost" className="mx-auto w-full max-w-[1060px] px-6 py-16 sm:py-20">
          <motion.div {...rise()}>
            <SectionRule n="05" label="What it costs" />
            <h2 className="mt-8 max-w-[26ch] text-[28px] font-bold leading-tight tracking-[-0.02em] sm:text-[36px]">
              Your Cloudflare bill, not our subscription.
            </h2>
            <p className="mt-4 max-w-[62ch] text-[13.5px] leading-relaxed text-[#6E6C7C]">
              Traks runs entirely in your Cloudflare account, so the running cost is
              Cloudflare&rsquo;s usage pricing, paid to them, not to us. Slide to your traffic to
              see where every cent goes.
            </p>
          </motion.div>
          <motion.div {...rise(0.08)} className="mt-10">
            <CostCalculator />
          </motion.div>
        </section>

        {/* CTA */}
        <section className="mx-auto w-full max-w-[1060px] px-6 pb-24 pt-8">
          <motion.div
            {...rise()}
            className="relative overflow-hidden rounded-[24px] bg-[#3D3B4F] px-8 py-14 text-center sm:py-16"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  'radial-gradient(circle, rgba(255,255,255,0.09) 1px, transparent 1px)',
                backgroundSize: '22px 22px',
                maskImage: 'radial-gradient(ellipse 70% 90% at 50% 0%, black, transparent)',
                WebkitMaskImage: 'radial-gradient(ellipse 70% 90% at 50% 0%, black, transparent)',
              }}
            />
            <h2 className="relative text-[28px] font-bold tracking-[-0.02em] text-white sm:text-[34px]">
              See who&rsquo;s on your site right now.
            </h2>
            <p className="relative mx-auto mt-3 max-w-[44ch] text-[14.5px] leading-relaxed text-white/60">
              Add the script, reload your site, and watch the first pageview land in the dashboard
              within seconds.
            </p>
            <a
              href="/deploy"
              className="relative mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-mint px-8 text-[14px] font-bold text-[#123326] transition-all hover:-translate-y-px hover:shadow-[0_8px_24px_rgba(40,233,159,0.35)]"
            >
              Deploy Traks now
              <ArrowRight className="h-4 w-4" />
            </a>
          </motion.div>
        </section>
      </main>

      {/* footer */}
      <footer className="relative z-10 border-t border-[#E6E4DE]">
        <div className="mx-auto flex w-full max-w-[1060px] flex-wrap items-center justify-between gap-4 px-6 py-8">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="Traks" className="h-5 w-5" />
            <span className="text-[13px] font-semibold">Traks</span>
            {latestVersion && (
              <span className="ml-1 rounded-full bg-[#F2F1ED] px-2 py-0.5 font-mono text-[10.5px] font-medium text-[#8C8A99]">
                v{latestVersion}
              </span>
            )}
          </div>
          <div className="flex items-center gap-6">
            <a
              href="/docs"
              className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#8C8A99] transition-colors hover:text-[#3D3B4F]"
            >
              Docs
            </a>
            <MousePointerClick
              className="hidden h-3.5 w-3.5 text-[#D8D7DE] sm:block"
              strokeWidth={1.6}
            />
            <Mono className="text-[#B3B1BE]">
              Privacy-first analytics · self-hosted on Cloudflare
            </Mono>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── cost calculator ─────────────────────────────────────────── */

const COST_STEPS = [10e3, 25e3, 50e3, 100e3, 250e3, 500e3, 1e6, 2e6, 5e6, 10e6, 15e6, 20e6, 25e6];

const fmtEvents = (n: number): string => (n >= 1e6 ? `${n / 1e6}M` : `${n / 1e3}k`);

const gb = (bytes: number): number => bytes / 1024 ** 3;
/** Metered amount above an included allowance. */
const over = (used: number, included: number): number => Math.max(0, used - included);

/**
 * Row writes billed per event by the live-stats Durable Object. Cloudflare
 * bills every index update as its own row write, and counts deletes as
 * writes too:
 *   1 events row + 2 index entries        = 3 on insert
 *   the same 3 again when the 50-hour     = 3 on prune
 *   retention window deletes the row
 * The monthly usage counter used to add a 7th here; it is now persisted once
 * per 50 events (see COUNTER_PERSIST_EVERY in the collect worker), which
 * rounds to nothing per event. This is the single largest line item at scale,
 * so it is modelled explicitly rather than folded into the request charge.
 */
const DO_ROWS_PER_EVENT = 6;

interface CostLine {
  label: string;
  detail: string;
  amount: number;
}

/**
 * Cloudflare list prices, verified 7 Aug 2026 against developers.cloudflare.com
 * (Workers, Durable Objects, R2, Pipelines and R2 SQL pricing pages). Billing
 * for Pipelines, R2 SQL and R2 Data Catalog was switched on 3 Aug 2026, so
 * these are live charges, not beta freebies.
 *
 * Volume assumptions, deliberately on the pessimistic side: one ingest request
 * per event, ~5% more requests for dashboard use, ~800 B per raw event through
 * the pipeline sink, ~250 B per event once written as compacted Parquet, and
 * six months of accumulated history in R2.
 */
function traksCost(events: number): { total: number; lines: CostLine[] } {
  const lines: CostLine[] = [
    { label: 'Workers Paid plan', detail: 'flat monthly minimum', amount: 5 },
    {
      label: 'Worker requests',
      detail: '10M/mo included, then $0.30/M',
      amount: (over(events * 1.05, 10e6) / 1e6) * 0.3,
    },
    {
      label: 'Durable Object requests',
      detail: '1M/mo included, then $0.15/M',
      amount: (over(events, 1e6) / 1e6) * 0.15,
    },
    {
      label: 'Durable Object row writes',
      detail: `~${DO_ROWS_PER_EVENT}/event · 50M/mo included, then $1.00/M`,
      amount: (over(events * DO_ROWS_PER_EVENT, 50e6) / 1e6) * 1.0,
    },
    {
      label: 'Pipelines sink',
      detail: '50 GB/mo included, then $0.06/GB',
      amount: over(gb(events * 800), 50) * 0.06,
    },
    {
      label: 'R2 storage',
      detail: '10 GB/mo included, then $0.015/GB',
      amount: over(gb(events * 250 * 6), 10) * 0.015,
    },
    {
      label: 'R2 SQL scans',
      detail: '10 GB/mo included, then $0.0025/GB',
      amount: over(gb(events * 500), 10) * 0.0025,
    },
  ];
  return { total: lines.reduce((sum, l) => sum + l.amount, 0), lines };
}

const fmtUsd = (n: number): string => (n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`);

/** One metered line: name, the rule behind it, and a share-of-total bar. */
function CostLineRow({ line, total }: { line: CostLine; total: number }): ReactElement {
  const included = line.amount === 0 && line.label !== 'Workers Paid plan';
  const share = total > 0 ? (line.amount / total) * 100 : 0;

  return (
    <div className="flex items-baseline gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] text-[#3D3B4F]">{line.label}</span>
          <span
            className={`shrink-0 font-mono text-[12.5px] tabular-nums ${
              included ? 'text-[#B3B1BE]' : 'text-[#3D3B4F]'
            }`}
          >
            {included ? 'included' : fmtUsd(Math.round(line.amount * 100) / 100)}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-[#F0F0F3]">
            <div
              className="h-full rounded-full bg-mint transition-all duration-300"
              style={{ width: `${share}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-[10px] text-[#B3B1BE]">{line.detail}</span>
        </div>
      </div>
    </div>
  );
}

function CostCalculator(): ReactElement {
  const [step, setStep] = useState(3); // 100k default
  const events = COST_STEPS[step];
  const { total, lines } = useMemo(() => traksCost(events), [events]);

  const metered = lines.filter(l => l.label !== 'Workers Paid plan');
  const usage = metered.reduce((sum, l) => sum + l.amount, 0);
  const perMillion = events >= 1e6 ? total / (events / 1e6) : null;

  return (
    <div className="rounded-[18px] border border-[#E6E4DE] bg-white p-7 sm:p-9">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <label htmlFor="cost-events" className="text-[13px] font-semibold text-[#3D3B4F]">
          Events per month
        </label>
        <span className="font-mono text-[22px] font-bold tracking-tight text-[#3D3B4F]">
          {fmtEvents(events)}
        </span>
      </div>
      <input
        id="cost-events"
        type="range"
        min={0}
        max={COST_STEPS.length - 1}
        step={1}
        value={step}
        onChange={e => setStep(Number(e.target.value))}
        className="w-full accent-[#3D3B4F]"
      />
      <div className="mt-1 flex justify-between font-mono text-[10.5px] text-[#B3B1BE]">
        <span>{fmtEvents(COST_STEPS[0])}</span>
        <span>{fmtEvents(COST_STEPS[COST_STEPS.length - 1])}</span>
      </div>

      {/* Headline total */}
      <div className="mt-8 flex flex-wrap items-end justify-between gap-4 border-b border-[#EFEFF2] pb-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[#B3B1BE]">
            Estimated Cloudflare bill
          </p>
          <p className="mt-1.5 font-mono text-[34px] font-bold leading-none tracking-tight text-[#3D3B4F]">
            {fmtUsd(Math.round(total * 100) / 100)}
            <span className="ml-1 text-[15px] font-semibold text-[#8C8A99]">/mo</span>
          </p>
        </div>
        <p className="text-right font-mono text-[11px] leading-relaxed text-[#B3B1BE]">
          $5.00 plan + {fmtUsd(Math.round(usage * 100) / 100)} usage
          {perMillion && (
            <>
              <br />
              {fmtUsd(Math.round(perMillion * 100) / 100)} per million events
            </>
          )}
        </p>
      </div>

      {/* Where it goes */}
      <p className="mt-6 mb-1 text-[11px] font-semibold uppercase tracking-[0.09em] text-[#B3B1BE]">
        Where it goes
      </p>
      <div className="divide-y divide-[#F2F1ED]">
        {lines.map(line => (
          <CostLineRow key={line.label} line={line} total={total} />
        ))}
      </div>

      <p className="mt-6 text-[11.5px] leading-relaxed text-[#B3B1BE]">
        Cloudflare list prices, verified 7 Aug 2026, paid to Cloudflare, not to us. Billing for
        Pipelines, R2 SQL and R2 Data Catalog began 3 Aug 2026, so these are live charges. Assumes
        one request per event, ~800 B through the pipeline, ~250 B stored as Parquet and six months
        of history; Analytics Engine is not yet billed by Cloudflare. Your real bill moves with how
        often dashboards are opened and how much history you keep. Excludes the one-time Traks
        licence.
      </p>
    </div>
  );
}
