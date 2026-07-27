import type { ReactElement } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Globe,
  Zap,
  Shield,
  Eye,
  MousePointer,
  MapPin,
  Smartphone,
  Code2,
  Cookie,
  Sparkles,
  LayoutDashboard,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

export const Route = createLazyFileRoute('/')({
  component: LandingPage,
});

interface Feature {
  icon: LucideIcon;
  label: string;
  desc: string;
  color: string;
}

const features: Feature[] = [
  { icon: Eye, label: 'Real-time', desc: 'Live visitor dashboard', color: '#9b72cf' },
  { icon: Globe, label: 'Top Pages', desc: 'Most visited pages', color: '#5b9a6f' },
  { icon: MapPin, label: 'Locations', desc: 'Country & city breakdown', color: '#e07a5f' },
  { icon: MousePointer, label: 'Referrers', desc: 'Traffic sources & UTMs', color: '#9b72cf' },
  { icon: Smartphone, label: 'Devices', desc: 'Browser, OS & screen size', color: '#5b9a6f' },
  { icon: Zap, label: 'Custom Events', desc: 'Track clicks & conversions', color: '#e07a5f' },
];

const highlights: { icon: LucideIcon; title: string; desc: string; color: string }[] = [
  {
    icon: Cookie,
    title: 'No cookies, ever',
    desc: 'Cookieless visitor tracking with daily-rotating hashed IDs. Fully GDPR compliant, no consent banner needed.',
    color: '#9b72cf',
  },
  {
    icon: Zap,
    title: 'Under 1KB script',
    desc: 'Lightweight tracking script that loads instantly. No impact on your site performance or Core Web Vitals.',
    color: '#5b9a6f',
  },
  {
    icon: Shield,
    title: 'Your data, your cloud',
    desc: 'Self-hosted on Cloudflare Workers & Analytics Engine. Data never leaves your account.',
    color: '#e07a5f',
  },
  {
    icon: Code2,
    title: 'One-line setup',
    desc: 'Add a single script tag to your site. Works with SPAs, static sites, and server-rendered pages.',
    color: '#6b8ead',
  },
];

function LandingPage(): ReactElement {
  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-[#fdfbf8]">
      {/* Background gradients */}
      <div className="fixed inset-0 pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 60% 50% at 85% 15%, rgba(155,114,207,0.06) 0%, transparent 70%), radial-gradient(ellipse 50% 50% at 10% 85%, rgba(91,154,111,0.05) 0%, transparent 70%), radial-gradient(ellipse 40% 40% at 50% 50%, rgba(224,122,95,0.03) 0%, transparent 60%)',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 py-5 max-w-5xl mx-auto w-full px-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img src="/logo64.png" alt="Traks" className="w-8 h-8 rounded-lg" />
          <span className="text-[17px] font-bold text-[#2D3436] tracking-tight">Traks</span>
        </div>
        <nav className="flex items-center gap-1">
          <a
            href="#features"
            onClick={e => {
              e.preventDefault();
              document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-[#6b6560] hover:text-[#2D3436] hover:bg-[#f3f0f7]/80 transition-all"
          >
            <Zap className="w-3.5 h-3.5" strokeWidth={1.75} />
            Features
          </a>
          <a
            href="#why"
            onClick={e => {
              e.preventDefault();
              document.getElementById('why')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-[#6b6560] hover:text-[#2D3436] hover:bg-[#f3f0f7]/80 transition-all"
          >
            <Sparkles className="w-3.5 h-3.5" strokeWidth={1.75} />
            Why Traks
          </a>
          <div className="w-px h-4 bg-[#e8e3ed] mx-1" />
          {/* Plain anchor: a full navigation lets Cloudflare Access gate /portal. */}
          <a href="/portal/sites">
            <Button variant="ghost" className="text-[13px] gap-1.5">
              <LayoutDashboard className="w-3.5 h-3.5" strokeWidth={1.75} />
              Dashboard
            </Button>
          </a>
        </nav>
      </header>

      {/* Hero - 2-column */}
      <main className="relative z-10 flex-1 flex flex-col">
        <div className="max-w-5xl w-full mx-auto flex-1 grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center px-6 py-12 sm:py-16 lg:py-24">
          {/* Left: Hero text */}
          <section className="flex flex-col justify-center items-center lg:items-start text-center lg:text-left">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
              className="mb-6"
            >
              <span className="block text-[42px] sm:text-[54px] lg:text-[62px] font-bold text-[#2D3436] leading-[1.05] tracking-[-0.03em]">
                Know your{' '}
                <span className="relative inline-block">
                  <span className="relative z-10 text-[#9b72cf]">audience</span>
                  <motion.span
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.5, delay: 0.55, ease: [0.25, 0.1, 0.25, 1] }}
                    className="absolute -bottom-1 left-0 right-0 h-[3px] bg-gradient-to-r from-[#9b72cf]/60 via-[#9b72cf]/40 to-transparent rounded-full origin-left"
                  />
                </span>
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.18 }}
              className="text-[16px] sm:text-[17px] text-[#8A8580] leading-relaxed mb-10 max-w-[420px]"
            >
              Privacy-friendly, cookieless analytics for all your sites. Self-hosted on Cloudflare,
              lightweight script, real-time dashboard.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.28 }}
              className="flex items-center gap-3.5"
            >
              <a href="/portal/sites">
                <Button className="h-[50px] px-7 rounded-2xl text-[14px] font-semibold bg-[#9b72cf] hover:bg-[#8a63bf] text-white shadow-lg shadow-[#9b72cf]/15 hover:shadow-xl hover:shadow-[#9b72cf]/20 transition-all duration-300 hover:-translate-y-0.5">
                  Go to Dashboard
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </a>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="mt-8 flex items-center gap-2 text-[12px] text-[#B5B0AA]"
            >
              <Cookie className="w-3.5 h-3.5 text-[#9b72cf]/60" />
              <span>No cookies, no consent banners, GDPR compliant</span>
            </motion.div>
          </section>

          {/* Right: Feature showcase cards */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 0 },
              visible: {
                opacity: 1,
                transition: { staggerChildren: 0.05, delayChildren: 0.3 },
              },
            }}
            className="hidden lg:flex flex-col gap-3"
          >
            {/* Top row - 3 cards */}
            <div className="grid grid-cols-3 gap-3">
              {features.slice(0, 3).map(f => (
                <motion.div
                  key={f.label}
                  variants={{
                    hidden: { opacity: 0, y: 18, scale: 0.97 },
                    visible: {
                      opacity: 1,
                      y: 0,
                      scale: 1,
                      transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as const },
                    },
                  }}
                  whileHover={{ y: -4, transition: { duration: 0.25, ease: 'easeOut' } }}
                  className="group relative rounded-2xl bg-white border border-[#e8e3ed]/80 p-5 cursor-default overflow-hidden transition-all duration-300 hover:shadow-xl hover:shadow-black/[0.06] hover:border-[#d5cfe0]"
                >
                  <div
                    className="absolute top-0 left-0 right-0 h-[2px] origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-400 ease-out"
                    style={{ backgroundColor: f.color }}
                  />
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 transition-transform duration-300 group-hover:scale-110"
                    style={{ backgroundColor: `${f.color}12` }}
                  >
                    <f.icon
                      className="w-[18px] h-[18px]"
                      style={{ color: f.color }}
                      strokeWidth={1.7}
                    />
                  </div>
                  <p className="text-[13px] font-semibold text-[#2D3436] leading-tight">
                    {f.label}
                  </p>
                  <p className="text-[11px] text-[#9B9590] leading-snug mt-1">{f.desc}</p>
                </motion.div>
              ))}
            </div>

            {/* Bottom row - 3 cards */}
            <div className="grid grid-cols-3 gap-3">
              {features.slice(3, 6).map(f => (
                <motion.div
                  key={f.label}
                  variants={{
                    hidden: { opacity: 0, y: 18, scale: 0.97 },
                    visible: {
                      opacity: 1,
                      y: 0,
                      scale: 1,
                      transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as const },
                    },
                  }}
                  whileHover={{ y: -4, transition: { duration: 0.25, ease: 'easeOut' } }}
                  className="group relative rounded-2xl bg-white border border-[#e8e3ed]/80 p-5 cursor-default overflow-hidden transition-all duration-300 hover:shadow-xl hover:shadow-black/[0.06] hover:border-[#d5cfe0]"
                >
                  <div
                    className="absolute top-0 left-0 right-0 h-[2px] origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-400 ease-out"
                    style={{ backgroundColor: f.color }}
                  />
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 transition-transform duration-300 group-hover:scale-110"
                    style={{ backgroundColor: `${f.color}12` }}
                  >
                    <f.icon
                      className="w-[18px] h-[18px]"
                      style={{ color: f.color }}
                      strokeWidth={1.7}
                    />
                  </div>
                  <p className="text-[13px] font-semibold text-[#2D3436] leading-tight">
                    {f.label}
                  </p>
                  <p className="text-[11px] text-[#9B9590] leading-snug mt-1">{f.desc}</p>
                </motion.div>
              ))}
            </div>

            {/* Code snippet card */}
            <motion.div
              variants={{
                hidden: { opacity: 0, y: 14 },
                visible: {
                  opacity: 1,
                  y: 0,
                  transition: { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] as const },
                },
              }}
              className="rounded-2xl bg-white border border-[#e8e3ed]/80 p-4 cursor-default overflow-hidden"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#e07a5f]/60" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#d4a574]/60" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#5b9a6f]/60" />
                  </div>
                  <span className="text-[11px] text-[#B5B0AA] font-medium ml-1">index.html</span>
                </div>
                <span className="text-[10px] text-[#9b72cf]/70 font-medium tracking-wide uppercase">
                  Add to any site
                </span>
              </div>
              <pre className="text-[12px] font-mono leading-[1.7] overflow-x-auto">
                <code>
                  <span className="text-[#6b8ead]">{'<'}</span>
                  <span className="text-[#9b72cf]">script</span>{' '}
                  <span className="text-[#d4a574]">defer</span>
                  {'\n'}
                  {'  '}
                  <span className="text-[#5b9a6f]">data-site</span>
                  <span className="text-[#B5B0AA]">=</span>
                  <span className="text-[#e07a5f]">{'"YOUR_KEY"'}</span>
                  {'\n'}
                  {'  '}
                  <span className="text-[#5b9a6f]">src</span>
                  <span className="text-[#B5B0AA]">=</span>
                  <span className="text-[#e07a5f]">{'"https://collect.traks.dev/t.js"'}</span>
                  <span className="text-[#6b8ead]">{'>'}</span>
                  {'\n'}
                  <span className="text-[#6b8ead]">{'</'}</span>
                  <span className="text-[#9b72cf]">script</span>
                  <span className="text-[#6b8ead]">{'>'}</span>
                </code>
              </pre>
            </motion.div>
          </motion.div>
        </div>

        {/* Why Traks section */}
        <section id="why" className="relative z-10 py-20 sm:py-28">
          <div className="max-w-5xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-100px' }}
              transition={{ duration: 0.5 }}
              className="text-center mb-14"
            >
              <h2 className="text-[32px] sm:text-[40px] font-bold text-[#2D3436] tracking-[-0.02em]">
                Why Traks?
              </h2>
              <p className="mt-3 text-[16px] text-[#8A8580] max-w-lg mx-auto">
                Analytics that respects your visitors and gives you the insights you actually need.
              </p>
            </motion.div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {highlights.map((item, i) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-50px' }}
                  transition={{ duration: 0.5, delay: i * 0.08 }}
                  className="group relative rounded-2xl bg-white border border-[#e8e3ed]/80 p-6 transition-all duration-300 hover:shadow-xl hover:shadow-black/[0.06] hover:border-[#d5cfe0]"
                >
                  <div
                    className="absolute top-0 left-0 right-0 h-[2px] origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-400 ease-out"
                    style={{ backgroundColor: item.color }}
                  />
                  <div className="flex items-start gap-4">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110"
                      style={{ backgroundColor: `${item.color}12` }}
                    >
                      <item.icon
                        className="w-5 h-5"
                        style={{ color: item.color }}
                        strokeWidth={1.7}
                      />
                    </div>
                    <div>
                      <h3 className="text-[15px] font-semibold text-[#2D3436]">{item.title}</h3>
                      <p className="text-[13px] text-[#9B9590] leading-relaxed mt-1.5">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Features section */}
        <section id="features" className="relative z-10 py-20 sm:py-28 bg-white/50">
          <div className="max-w-5xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-100px' }}
              transition={{ duration: 0.5 }}
              className="text-center mb-14"
            >
              <h2 className="text-[32px] sm:text-[40px] font-bold text-[#2D3436] tracking-[-0.02em]">
                Everything you need
              </h2>
              <p className="mt-3 text-[16px] text-[#8A8580] max-w-lg mx-auto">
                Comprehensive analytics without the complexity. No bloat, no learning curve.
              </p>
            </motion.div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {[
                {
                  icon: Eye,
                  title: 'Real-time Dashboard',
                  desc: 'See who is on your site right now. Live visitor count, active pages, and current traffic sources.',
                  color: '#9b72cf',
                },
                {
                  icon: Globe,
                  title: 'Top Pages',
                  desc: 'Know which pages drive the most traffic. Pageviews and unique visitors for every URL.',
                  color: '#5b9a6f',
                },
                {
                  icon: MousePointer,
                  title: 'Traffic Sources',
                  desc: 'See where your visitors come from. Referrers, UTM campaigns, and direct traffic breakdown.',
                  color: '#e07a5f',
                },
                {
                  icon: MapPin,
                  title: 'Geo Analytics',
                  desc: 'Country and city-level visitor breakdown. Know your audience geography at a glance.',
                  color: '#d4a574',
                },
                {
                  icon: Smartphone,
                  title: 'Device Insights',
                  desc: 'Browser, OS, and device type breakdown. Understand how visitors access your site.',
                  color: '#6b8ead',
                },
                {
                  icon: Zap,
                  title: 'Custom Events',
                  desc: 'Track button clicks, form submissions, and conversions with window.traks() API.',
                  color: '#9b72cf',
                },
              ].map((item, i) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-50px' }}
                  transition={{ duration: 0.5, delay: i * 0.06 }}
                  className="group relative rounded-2xl bg-white border border-[#e8e3ed]/80 p-6 transition-all duration-300 hover:shadow-xl hover:shadow-black/[0.06] hover:border-[#d5cfe0]"
                >
                  <div
                    className="absolute top-0 left-0 right-0 h-[2px] origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-400 ease-out"
                    style={{ backgroundColor: item.color }}
                  />
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 transition-transform duration-300 group-hover:scale-110"
                    style={{ backgroundColor: `${item.color}12` }}
                  >
                    <item.icon
                      className="w-5 h-5"
                      style={{ color: item.color }}
                      strokeWidth={1.7}
                    />
                  </div>
                  <h3 className="text-[15px] font-semibold text-[#2D3436]">{item.title}</h3>
                  <p className="text-[13px] text-[#9B9590] leading-relaxed mt-1.5">{item.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA section */}
        <section className="relative z-10 py-20 sm:py-28">
          <div className="max-w-2xl mx-auto px-6 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-100px' }}
              transition={{ duration: 0.5 }}
            >
              <h2 className="text-[32px] sm:text-[40px] font-bold text-[#2D3436] tracking-[-0.02em] mb-4">
                Ready to go?
              </h2>
              <p className="text-[16px] text-[#8A8580] mb-8 max-w-md mx-auto">
                Add the tracking script to your site and see visitors in real-time within minutes.
              </p>
              <a href="/portal/sites">
                <Button className="h-[50px] px-8 rounded-2xl text-[14px] font-semibold bg-[#9b72cf] hover:bg-[#8a63bf] text-white shadow-lg shadow-[#9b72cf]/15 hover:shadow-xl hover:shadow-[#9b72cf]/20 transition-all duration-300 hover:-translate-y-0.5">
                  Go to Dashboard
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </a>
            </motion.div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-8 border-t border-[#e8e3ed]">
        <div className="max-w-5xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo64.png" alt="Traks" className="w-6 h-6 rounded-md" />
            <span className="text-[13px] font-semibold text-[#2D3436]">Traks</span>
          </div>
          <p className="text-[12px] text-[#B5B0AA]">Privacy-friendly analytics on Cloudflare</p>
        </div>
      </footer>
    </div>
  );
}
