import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { EXAMPLE_API_URL, EXAMPLE_COLLECT_URL } from '@/lib/config';

export const Route = createFileRoute('/docs')({
  component: DocsPage,
});

/* ── building blocks ─────────────────────────────────────────── */

function Code({ children }: { children: ReactNode }): ReactElement {
  return (
    <pre className="mt-3 overflow-x-auto rounded-2xl bg-[#34324A] px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-[#C9C8D4] whitespace-pre-wrap break-all select-all">
      {children}
    </pre>
  );
}

function Inline({ children }: { children: ReactNode }): ReactElement {
  return (
    <code className="rounded-md bg-[#F2F1ED] px-1.5 py-0.5 font-mono text-[12px] text-[#3D3B4F]">
      {children}
    </code>
  );
}

function Section({
  id,
  n,
  title,
  lede,
  children,
}: {
  id: string;
  n: string;
  title: string;
  lede?: string;
  children: ReactNode;
}): ReactElement {
  const idx = TOC.findIndex(t => t.id === id);
  const prev = idx > 0 ? TOC[idx - 1] : undefined;
  const next = idx < TOC.length - 1 ? TOC[idx + 1] : undefined;
  return (
    <section
      id={id}
      data-doc-section
      className="scroll-mt-24 rounded-[18px] border border-[#E6E4DE] bg-white p-6 shadow-float sm:p-8"
    >
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#B3B1BE]">
        {n}
      </span>
      <h2 className="mt-2 text-[22px] font-bold tracking-[-0.01em] text-[#3D3B4F]">{title}</h2>
      {lede && <p className="mt-2 text-[14px] leading-relaxed text-[#6E6C7C]">{lede}</p>}
      <div className="mt-5 space-y-4 text-[14px] leading-relaxed text-[#5a5550]">{children}</div>
      <div className="mt-8 flex items-center justify-between gap-4 border-t border-[#EEEEF2] pt-4 text-[12.5px]">
        {prev ? (
          <a href={`#${prev.id}`} className="text-[#8C8A99] hover:text-[#3D3B4F]">
            ← {prev.label}
          </a>
        ) : (
          <span />
        )}
        {next ? (
          <a href={`#${next.id}`} className="font-semibold text-[#3D3B4F] hover:underline">
            Next: {next.label} →
          </a>
        ) : (
          <a href="/deploy" className="font-semibold text-[#3D3B4F] hover:underline">
            Deploy Traks →
          </a>
        )}
      </div>
    </section>
  );
}

/** Numbered sub-steps inside a section. */
function Steps({ items }: { items: { title: string; body: ReactNode }[] }): ReactElement {
  return (
    <ol className="space-y-4">
      {items.map((s, i) => (
        <li key={s.title} className="flex gap-4">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#E6E4DE] bg-white font-mono text-[11.5px] font-semibold text-[#3D3B4F]">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-[#3D3B4F]">{s.title}</p>
            <div className="mt-1 text-[13.5px] leading-relaxed text-[#5a5550]">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Note({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="rounded-2xl border border-[#EEEEF2] bg-white p-4 text-[13px] leading-relaxed text-[#6E6C7C] shadow-float">
      {children}
    </div>
  );
}

function A({ href, children }: { href: string; children: ReactNode }): ReactElement {
  return (
    <a href={href} className="font-semibold text-[#3D3B4F] underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

/* ── navigation ──────────────────────────────────────────────── */

const TOC: { id: string; label: string; group: string }[] = [
  { id: 'before', label: 'Before you start', group: 'Get started' },
  { id: 'deploy', label: 'Deploy to Cloudflare', group: 'Get started' },
  { id: 'claim', label: 'Claim your instance', group: 'Get started' },
  { id: 'site', label: 'Add your first site', group: 'Get started' },
  { id: 'install', label: 'Install the tracker', group: 'Get started' },
  { id: 'verify', label: 'Verify it works', group: 'Get started' },
  { id: 'events', label: 'Custom events', group: 'Measure' },
  { id: 'goals', label: 'Goals, funnels, and segments', group: 'Measure' },
  { id: 'team', label: 'Invite your team', group: 'Operate' },
  { id: 'agents', label: 'Coding agents and the API', group: 'Operate' },
  { id: 'update', label: 'Updates', group: 'Operate' },
  { id: 'destroy', label: 'Removing Traks', group: 'Operate' },
  { id: 'privacy', label: 'Privacy', group: 'Operate' },
];

const GROUPS = Array.from(new Set(TOC.map(t => t.group)));

/** Which section is nearest the top of the viewport. */
function useActiveSection(): string {
  const [active, setActive] = useState(TOC[0].id);
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-doc-section]'));
    const onScroll = (): void => {
      const line = 120;
      let current = els[0]?.id ?? '';
      for (const el of els) {
        if (el.getBoundingClientRect().top - line <= 0) current = el.id;
      }
      // Bottom of page: the last section wins even if it never reaches the line.
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 2) {
        current = els[els.length - 1]?.id ?? current;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);
  return active;
}

function Sidebar({ active }: { active: string }): ReactElement {
  return (
    <nav aria-label="Documentation" className="space-y-6">
      {GROUPS.map(g => (
        <div key={g}>
          <p className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#B3B1BE]">
            {g}
          </p>
          <ul className="space-y-0.5 border-l border-[#E6E4DE]">
            {TOC.filter(t => t.group === g).map(t => {
              const on = t.id === active;
              return (
                <li key={t.id}>
                  <a
                    href={`#${t.id}`}
                    aria-current={on ? 'true' : undefined}
                    className={`-ml-px block border-l-2 py-1 pl-3.5 text-[13px] leading-snug transition-colors ${
                      on
                        ? 'border-[#3D3B4F] font-semibold text-[#3D3B4F]'
                        : 'border-transparent text-[#6E6C7C] hover:border-[#B3B1BE] hover:text-[#3D3B4F]'
                    }`}
                  >
                    {t.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Mobile: a sticky jump menu instead of the sidebar. */
function JumpMenu({ active }: { active: string }): ReactElement {
  const current = TOC.find(t => t.id === active);
  return (
    <div className="sticky top-0 z-20 -mx-4 border-b border-[#E6E4DE] bg-[#F6F5F2]/95 px-4 py-2.5 backdrop-blur lg:hidden">
      <label className="flex items-center gap-2">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#B3B1BE]">
          Section
        </span>
        <select
          value={current?.id ?? TOC[0].id}
          onChange={e => {
            document.getElementById(e.target.value)?.scrollIntoView({ behavior: 'smooth' });
          }}
          className="h-9 flex-1 rounded-lg border border-[#E6E4DE] bg-white px-2.5 text-[13px] font-medium text-[#3D3B4F]"
        >
          {GROUPS.map(g => (
            <optgroup key={g} label={g}>
              {TOC.filter(t => t.group === g).map(t => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
    </div>
  );
}

const QUICK_START: { title: string; body: string; href: string }[] = [
  { title: 'Deploy', body: 'traks.dev/deploy, sign in with Cloudflare, ~2 min.', href: '#deploy' },
  { title: 'Claim', body: 'Open your URL, create the owner account.', href: '#claim' },
  { title: 'Add a site', body: 'Name, domain, timezone. Copy the snippet.', href: '#site' },
  { title: 'Install', body: 'One script tag in <head>. Watch visitors land.', href: '#install' },
];

/* ── page ────────────────────────────────────────────────────── */

function DocsPage(): ReactElement {
  const active = useActiveSection();
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
        <div className="flex items-center gap-1">
          <Link
            to="/guides"
            className="rounded-md px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#6E6C7C] transition-colors hover:text-[#3D3B4F]"
          >
            Guides
          </Link>
          <a
            href="/deploy"
            className="ml-1 inline-flex h-9 items-center rounded-full bg-[#3D3B4F] px-4 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#2C2B3B]"
          >
            Deploy now
          </a>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1120px] px-4 sm:px-6 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14">
        {/* sidebar */}
        <aside className="hidden lg:block">
          <div className="sticky top-8 max-h-[calc(100vh-4rem)] overflow-y-auto pb-8 pr-2">
            <Sidebar active={active} />
          </div>
        </aside>

        <main className="pb-24 pt-2 lg:pt-0">
          <JumpMenu active={active} />

          <h1 className="mt-6 text-[32px] font-bold tracking-[-0.02em] text-[#3D3B4F] lg:mt-2">
            Documentation
          </h1>
          <p className="mt-2 max-w-[58ch] text-[15px] leading-relaxed text-[#8A8580]">
            From an empty Cloudflare account to a live dashboard in about ten minutes: deploy,
            claim, add a site, paste one script tag. Everything after that is optional.
          </p>

          {/* quick start */}
          <div className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-[18px] border border-[#E6E4DE] bg-[#E6E4DE] sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_START.map((q, i) => (
              <a
                key={q.title}
                href={q.href}
                className="group flex flex-col bg-white p-4 transition-colors hover:bg-[#FBFAF8]"
              >
                <span className="font-mono text-[11px] text-[#B3B1BE]">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="mt-1.5 text-[14px] font-semibold text-[#3D3B4F] group-hover:underline">
                  {q.title}
                </span>
                <span className="mt-1 text-[12.5px] leading-relaxed text-[#8C8A99]">{q.body}</span>
              </a>
            ))}
          </div>

          <div className="mt-8 space-y-6">
            {/* 01 */}
            <Section
              id="before"
              n="01"
              title="Before you start"
              lede="Traks runs entirely inside your own Cloudflare account. You need three things."
            >
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  <strong>A Cloudflare account on the Workers Paid plan</strong> ($5/mo). Traks uses
                  Durable Objects, R2, Pipelines, and R2 SQL, which sit on the paid plan; the $5
                  covers millions of events. See the <A href="/#cost">cost calculator</A> for what
                  your traffic level costs.
                </li>
                <li>
                  <strong>R2 enabled</strong> on that account. If you have never used R2, open R2 in
                  the Cloudflare dashboard once and accept the terms; it asks for a payment method
                  even though storage is free at Traks&rsquo; scale.
                </li>
                <li>
                  <strong>Optionally, a domain on Cloudflare.</strong> Without one, your dashboard
                  lives on a <Inline>*.workers.dev</Inline> URL, which works fine. With one, you can
                  pick a subdomain (for example <Inline>analytics.your-domain.com</Inline>) and the
                  wizard attaches DNS and certificates for you.
                </li>
              </ul>
              <Note>
                You never create anything by hand. The wizard provisions every resource, and the
                matching <A href="/destroy">destroy</A> flow removes them again.
              </Note>
            </Section>

            {/* 02 */}
            <Section
              id="deploy"
              n="02"
              title="Deploy to Cloudflare"
              lede="Open traks.dev/deploy in your browser. There is no CLI and nothing to clone."
            >
              <Steps
                items={[
                  {
                    title: 'Get started',
                    body: 'The first screen lists exactly what will happen. Click Get started.',
                  },
                  {
                    title: 'Connect your Cloudflare account',
                    body: (
                      <>
                        Click <strong>Sign in with Cloudflare</strong> and approve the permissions
                        on Cloudflare&rsquo;s own consent screen. That access is temporary and never
                        stored. If you would rather not use OAuth, the same screen offers two
                        pre-filled token links instead: each opens the Cloudflare dashboard with the
                        right permissions already selected, so it is Create Token, copy, paste.
                      </>
                    ),
                  },
                  {
                    title: 'Paste the storage token',
                    body: (
                      <>
                        One extra token, the <strong>analytics storage token</strong>, is needed for
                        the R2 Data Catalog and stays with your instance. Use the pre-filled link,
                        click Create Token, and paste the token <em>value</em> (not the token ID).
                        Traks verifies it automatically before continuing.
                      </>
                    ),
                  },
                  {
                    title: 'Name it and pick a domain',
                    body: (
                      <>
                        The instance name defaults to <Inline>traks</Inline>; leave it unless you
                        run several. Choose <strong>workers.dev</strong> (no setup) or one of your
                        Cloudflare zones plus an optional subdomain. The dashboard lives at the
                        subdomain (<Inline>analytics.your-domain.com</Inline>) and the collector at{' '}
                        <Inline>analytics-collect.your-domain.com</Inline>.
                      </>
                    ),
                  },
                  {
                    title: 'Watch it deploy',
                    body: (
                      <>
                        Two Workers, a D1 database, KV, an R2 bucket with Data Catalog, an event
                        pipeline, and a Durable Object are created and smoke-tested, with a live log
                        of each step. It takes about two minutes. If it is interrupted, come back to
                        the same page and deploy again: everything already created is reused.
                      </>
                    ),
                  },
                  {
                    title: 'Open your instance',
                    body: 'The done screen shows your dashboard URL. Click it. That URL is yours from now on.',
                  },
                ]}
              />
            </Section>

            {/* 03 */}
            <Section
              id="claim"
              n="03"
              title="Claim your instance"
              lede="A freshly deployed instance has no users. The first sign-up becomes the owner."
            >
              <p>
                Open the dashboard URL and you land on <strong>Create your owner account</strong>.
                Pick a password. If you deployed with Sign in with Cloudflare, your Cloudflare email
                is already set as the owner and only that address can claim the instance. After the
                first account exists, public sign-ups close: everyone else joins by invitation (see{' '}
                <A href="#team">Invite your team</A>).
              </p>
              <Note>
                Auth is self-hosted inside your api Worker (email + password). There is no Traks
                account, and traks.dev never sees your login.
              </Note>
            </Section>

            {/* 04 */}
            <Section
              id="site"
              n="04"
              title="Add your first site"
              lede="Sites live inside a workspace; your first workspace was created when you claimed the instance."
            >
              <Steps
                items={[
                  {
                    title: 'Sites → Add Site',
                    body: 'Enter a name and the domain visitors use (for example example.com). Subdomains of that domain are accepted automatically.',
                  },
                  {
                    title: 'Pick a reporting timezone',
                    body: 'Every day and hour bucket in the dashboard is computed in this zone, DST-correct. You can change it later per site, or for a whole workspace at once under Settings.',
                  },
                  {
                    title: 'Copy the snippet',
                    body: 'The success screen shows your site key already filled into the tracking snippet, plus tailored guides for the stack you use. The same snippet is always available later from the Install button on the site page.',
                  },
                ]}
              />
            </Section>

            {/* 05 */}
            <Section
              id="install"
              n="05"
              title="Install the tracker"
              lede="One deferred script tag in the <head> of every page. 1.4 KB gzipped, no cookies, no build step."
            >
              <Code>{`<script>window.traks=window.traks||function(){(window.traks.q=window.traks.q||[]).push(arguments)}</script>\n<script defer data-site="YOUR_SITE_KEY" src="${EXAMPLE_COLLECT_URL}/t.js"></script>`}</Code>
              <p>
                The one-line stub on the first line is optional but recommended: it queues any{' '}
                <Inline>traks()</Inline> calls made before the script loads and replays them in
                order. Replace <Inline>YOUR_SITE_KEY</Inline> and the collector hostname with the
                values from your dashboard (the dashboard already did this for you).
              </p>
              <p>
                Using a framework or site builder? There are{' '}
                <Link to="/guides" className="font-semibold text-foreground hover:underline">
                  install guides
                </Link>{' '}
                for HTML, Next.js, React, Vue, Nuxt, Astro, SvelteKit, WordPress, Webflow, Framer,
                and Shopify.
              </p>
              <p className="font-semibold text-[#3D3B4F]">What is tracked automatically</p>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>Pageviews, including single-page-app navigations via the History API</li>
                <li>Referrer, UTM source / medium / campaign, country, region, city</li>
                <li>Browser, operating system, device type, screen size</li>
                <li>Visit duration (time the tab was actually visible) and bounce rate</li>
                <li>
                  Outbound link clicks and file downloads, shown in the <strong>Links</strong> panel
                  and usable as goals
                </li>
              </ul>
              <p className="font-semibold text-[#3D3B4F]">Optional attributes</p>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>
                  <Inline>data-hash</Inline>: for hash-based routers, so <Inline>#/route</Inline>{' '}
                  becomes part of the page path.
                </li>
                <li>
                  <Inline>data-404</Inline>: put it on the snippet in your 404 template to record
                  broken URLs as a <Inline>404</Inline> event; click that event in the Custom Events
                  panel to see which paths.
                </li>
              </ul>
            </Section>

            {/* 06 */}
            <Section
              id="verify"
              n="06"
              title="Verify it works"
              lede="Deploy your site with the snippet, then open it in a normal browser tab."
            >
              <p>
                Back in the dashboard, the site page shows an <strong>online now</strong> counter
                and the Today numbers within a few seconds. Today and realtime are served from an
                edge Durable Object, so there is no processing delay. Historical periods (7D and
                beyond) are read from your R2 warehouse and cached for a few minutes.
              </p>
              <p className="font-semibold text-[#3D3B4F]">If nothing shows up</p>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>
                  <strong>Domain mismatch.</strong> Your site key only accepts events sent from the
                  domain you registered, its subdomains, and localhost. Check the site&rsquo;s
                  domain under Site settings.
                </li>
                <li>
                  <strong>Ad blocker.</strong> Some blockers stop the request; try a private window
                  with extensions off.
                </li>
                <li>
                  <strong>Bot filtering.</strong> Headless browsers, Lighthouse, and known crawlers
                  are dropped on purpose; test with a real browser.
                </li>
                <li>
                  <strong>Preview builds.</strong> Make sure the deployed HTML actually contains the
                  snippet; view source on the live page.
                </li>
              </ul>
            </Section>

            {/* 07 */}
            <Section
              id="events"
              n="07"
              title="Custom events"
              lede="Fire an event anywhere in your code. Calls made before the script loads are queued by the stub."
            >
              <Code>{`window.traks(name, props?, value?)\n\ntraks('signup', { plan: 'pro' });\ntraks('purchase', { sku: 'T100' }, 49.99);`}</Code>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>
                  <Inline>name</Inline>: a short snake_case verb phrase.
                </li>
                <li>
                  <Inline>props</Inline>: a flat object of scalar values. Props are what goals and
                  funnels can filter on, so keep them low-cardinality (a plan name, not a user id).
                  Click any event in the Custom Events panel to see a per-prop breakdown.
                </li>
                <li>
                  <Inline>value</Inline>: an optional number, summed per event in the dashboard.
                </li>
              </ul>
            </Section>

            {/* 08 */}
            <Section
              id="goals"
              n="08"
              title="Goals, funnels, and segments"
              lede="All three are configured from the site page, no code changes required."
            >
              <p>
                <strong>Goals</strong> turn a custom event or a page visit into a conversion with a
                rate against period visitors. Page goals accept a <Inline>/section/*</Inline>{' '}
                prefix; event goals can require a prop to equal a value (for example{' '}
                <Inline>plan = pro</Inline>). Outbound clicks, downloads, and 404s work as goals
                too.
              </p>
              <p>
                <strong>Funnels</strong> chain two to eight ordered steps, each a page (or prefix)
                or an event with an optional prop condition, and show how many sessions reached each
                step and the drop-off between them.
              </p>
              <p>
                <strong>Filters and segments</strong>: click any row in any panel to filter the
                whole dashboard by it; filters stack and live in the URL. Save the active
                combination as a named segment from the bookmark menu and re-apply it in one click.
              </p>
            </Section>

            {/* 09 */}
            <Section
              id="team"
              n="09"
              title="Invite your team"
              lede="Workspaces group sites; membership decides who sees what."
            >
              <p>
                Owners open <strong>Members</strong> in the header and invite by email. Your
                instance does not send email, so copy the invite link and share it yourself; it is
                pinned to that address and expires after seven days. There are two roles:{' '}
                <strong>owners</strong> manage sites, goals, and invites, and{' '}
                <strong>members</strong> get read-only dashboards. Switch between workspaces from
                the breadcrumb in the header.
              </p>
            </Section>

            {/* 10 */}
            <Section
              id="agents"
              n="10"
              title="Coding agents and the API"
              lede="Every instance ships an MCP server and a REST API behind the same permissions as the dashboard."
            >
              <Steps
                items={[
                  {
                    title: 'Mint a token',
                    body: (
                      <>
                        Open the <strong>API</strong> tab, name the token, and choose a scope:{' '}
                        <em>read</em> (stats only) or <em>manage</em> (also create and edit goals
                        and funnels). Tokens are bound to the current workspace, shown once, and can
                        be revoked at any time.
                      </>
                    ),
                  },
                  {
                    title: 'Connect your agent',
                    body: (
                      <>
                        The MCP endpoint is <Inline>{`${EXAMPLE_API_URL}/api/mcp`}</Inline>{' '}
                        (Streamable HTTP). For Claude Code:
                        <Code>{`claude mcp add --transport http traks ${EXAMPLE_API_URL}/api/mcp \\\n  --header "Authorization: Bearer traks_pat_..."`}</Code>
                        Any MCP client that supports HTTP transport and a bearer header works the
                        same way.
                      </>
                    ),
                  },
                  {
                    title: 'Give it the skill',
                    body: (
                      <>
                        The <strong>Skill</strong> tab renders a ready-made{' '}
                        <Inline>SKILL.md</Inline> with your instance URLs filled in. Drop it into
                        your agent&rsquo;s skills folder and it knows how to install the snippet,
                        name events, and create the matching goals and funnels over MCP.
                      </>
                    ),
                  },
                ]}
              />
              <p>
                MCP tools: <Inline>list_sites</Inline>, <Inline>get_tracking_snippet</Inline>,{' '}
                <Inline>get_stats</Inline>, <Inline>get_custom_events</Inline>,{' '}
                <Inline>get_event_props</Inline>,{' '}
                <Inline>list / create / update / delete_goal</Inline>,{' '}
                <Inline>get_goal_stats</Inline>,{' '}
                <Inline>list / create / update / delete_funnel</Inline>,{' '}
                <Inline>get_funnel_stats</Inline>. The same bearer token authorizes plain REST calls
                under <Inline>/api</Inline>. Tokens can never mint other tokens or manage members;
                those actions need a signed-in session.
              </p>
            </Section>

            {/* 11 */}
            <Section
              id="update"
              n="11"
              title="Updates"
              lede="Instances do not update themselves; you decide when."
            >
              <p>
                The version pill in the dashboard header turns into a{' '}
                <span className="font-medium text-[#3D3B4F]">vX.Y.Z available</span> link when
                traks.dev publishes a newer release (you can also choose{' '}
                <strong>Check for updates</strong> from the account menu). It takes you to{' '}
                <A href="/update">traks.dev/update</A>: connect your Cloudflare account, pick the
                instance, click <strong>Update</strong>. Both Workers, migrations, and the dashboard
                ship together; your data and settings are untouched.
              </p>
            </Section>

            {/* 12 */}
            <Section
              id="destroy"
              n="12"
              title="Removing Traks"
              lede="Everything the wizard created, it can remove."
            >
              <p>
                <A href="/destroy">traks.dev/destroy</A> connects to your account, lists exactly
                what will be deleted (Workers, D1, KV, the pipeline, the catalog), and asks you to
                type the instance name to confirm. The R2 events bucket is emptied and removed only
                when you also provide the storage token; without it the bucket, and your history,
                are left in place.
              </p>
            </Section>

            {/* 13 */}
            <Section id="privacy" n="13" title="Privacy">
              <ul className="list-disc space-y-1.5 pl-5">
                <li>No cookies and no persistent identifiers, so no consent banner is required.</li>
                <li>
                  Visitors are counted with a daily-rotating hash (HMAC of IP + user agent + site
                  key with a server-side secret), so the same person cannot be linked across days.
                </li>
                <li>
                  IP addresses are used in memory to resolve geography and then discarded; referrer
                  query strings are stripped before storage.
                </li>
                <li>Known bots and crawlers are filtered at the edge.</li>
                <li>
                  All data lives in your Cloudflare account. traks.dev only knows that an instance
                  exists and which version it runs, so it can offer updates.
                </li>
              </ul>
            </Section>
          </div>
        </main>
      </div>
    </div>
  );
}
