import { useEffect, type ReactElement } from 'react';
import { createFileRoute, Link, useLocation } from '@tanstack/react-router';
import { INSTALL_GUIDES } from '@traks/shared';
import { EXAMPLE_API_URL, EXAMPLE_COLLECT_URL } from '@/lib/config';
import { A, Code, Inline, Note, QUICK_START, Section, Steps } from '@/docs/shared';

export const Route = createFileRoute('/docs/')({
  component: DocsIndex,
});

function DocsIndex(): ReactElement {
  const { hash } = useLocation();
  // Arriving from a guide page (or a deep link): land on the requested section.
  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash)?.scrollIntoView({ block: 'start' });
  }, [hash]);
  return (
    <>
      <h1 className="mt-6 text-[32px] font-bold tracking-[-0.02em] text-[#3D3B4F] lg:mt-0">
        Documentation
      </h1>
      <p className="mt-2 max-w-[58ch] text-[15px] leading-relaxed text-[#8A8580]">
        From an empty Cloudflare account to a live dashboard in about ten minutes: deploy, claim,
        add a site, paste one script tag. Everything after that is optional.
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
              Durable Objects, R2, Pipelines, and R2 SQL, which sit on the paid plan; the $5 covers
              millions of events. See the <A href="/#cost">cost calculator</A> for what your traffic
              level costs.
            </li>
            <li>
              <strong>R2 enabled</strong> on that account. If you have never used R2, open R2 in the
              Cloudflare dashboard once and accept the terms; it asks for a payment method even
              though storage is free at Traks&rsquo; scale.
            </li>
            <li>
              <strong>Optionally, a domain on Cloudflare.</strong> Without one, your dashboard lives
              on a <Inline>*.workers.dev</Inline> URL, which works fine. With one, you can pick a
              subdomain (for example <Inline>analytics.your-domain.com</Inline>) and the wizard
              attaches DNS and certificates for you.
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
                    Click <strong>Sign in with Cloudflare</strong> and approve the permissions on
                    Cloudflare&rsquo;s own consent screen. That access is temporary and never
                    stored. If you would rather not use OAuth, the same screen offers two pre-filled
                    token links instead: each opens the Cloudflare dashboard with the right
                    permissions already selected, so it is Create Token, copy, paste.
                  </>
                ),
              },
              {
                title: 'Paste the storage token',
                body: (
                  <>
                    One extra token, the <strong>analytics storage token</strong>, is needed for the
                    R2 Data Catalog and stays with your instance. Use the pre-filled link, click
                    Create Token, and paste the token <em>value</em> (not the token ID). Traks
                    verifies it automatically before continuing.
                  </>
                ),
              },
              {
                title: 'Name it and pick a domain',
                body: (
                  <>
                    The instance name defaults to <Inline>traks</Inline>; leave it unless you run
                    several. Choose <strong>workers.dev</strong> (no setup) or one of your
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
                    pipeline, and a Durable Object are created and smoke-tested, with a live log of
                    each step. It takes about two minutes. If it is interrupted, come back to the
                    same page and deploy again: everything already created is reused.
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
          lede="A freshly deployed instance has no users. The first sign-up becomes the owner - and only the deploy page can authorise it."
        >
          <p>
            Use the <strong>Open your Traks</strong> link on the deploy page: it carries a one-time
            claim code, so nobody who merely finds your instance URL can take it first. You land on{' '}
            <strong>Create your owner account</strong>; pick a password (if you deployed with Sign
            in with Cloudflare, sign up with that Cloudflare email - it is pinned as the owner).
            After the first account exists, public sign-ups close: everyone else joins by invitation
            (see <A href="#team">Invite your team</A>). Lost the link before claiming? Run{' '}
            <A href="/update">Update</A> on the same instance and a fresh code is issued.
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
          lede="One deferred script tag in the <head> of every page. 1.5 KB gzipped, no cookies, no build step."
        >
          <Code>{`<script>window.traks=window.traks||function(){(window.traks.q=window.traks.q||[]).push(arguments)}</script>\n<script defer data-site="YOUR_SITE_KEY" src="${EXAMPLE_COLLECT_URL}/t.js"></script>`}</Code>
          <p>
            The one-line stub on the first line is optional but recommended: it queues any{' '}
            <Inline>traks()</Inline> calls made before the script loads and replays them in order.
            Replace <Inline>YOUR_SITE_KEY</Inline> and the collector hostname with the values from
            your dashboard (the dashboard already did this for you).
          </p>
          <div>
            <p className="font-semibold text-[#3D3B4F]">Using a framework or site builder?</p>
            <p className="mt-1">
              Pick your stack for a step-by-step guide with the snippet already placed:
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {INSTALL_GUIDES.map(g => (
                <Link
                  key={g.slug}
                  to="/docs/install/$slug"
                  params={{ slug: g.slug }}
                  className="rounded-full border border-[#E6E4DE] bg-white px-3.5 py-1.5 text-[12.5px] font-medium text-[#3D3B4F] transition-colors hover:border-[#B3B1BE]"
                >
                  {g.name}
                </Link>
              ))}
            </div>
          </div>
          <p className="font-semibold text-[#3D3B4F]">What is tracked automatically</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Pageviews, including single-page-app navigations via the History API</li>
            <li>Referrer, UTM source / medium / campaign, country, region, city</li>
            <li>Browser, operating system, device type, screen size</li>
            <li>Visit duration (time the tab was actually visible) and bounce rate</li>
            <li>
              Outbound link clicks and file downloads, shown in the <strong>Links</strong> panel and
              usable as goals
            </li>
          </ul>
          <p className="font-semibold text-[#3D3B4F]">Optional attributes</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <Inline>data-hash</Inline>: for hash-based routers, so <Inline>#/route</Inline>{' '}
              becomes part of the page path.
            </li>
            <li>
              <Inline>data-404</Inline>: put it on the snippet in your 404 template to record broken
              URLs as a <Inline>404</Inline> event; click that event in the Custom Events panel to
              see which paths.
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
            Back in the dashboard, the site page shows an <strong>online now</strong> counter and
            the Today numbers within a few seconds. Today and realtime are served from an edge
            Durable Object, so there is no processing delay. Historical periods (7D and beyond) are
            read from your R2 warehouse and cached for a few minutes.
          </p>
          <p className="font-semibold text-[#3D3B4F]">If nothing shows up</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Domain mismatch.</strong> Your site key only accepts events sent from the
              domain you registered, its subdomains, and localhost. Check the site&rsquo;s domain
              under Site settings.
            </li>
            <li>
              <strong>Ad blocker.</strong> Some blockers stop the request; try a private window with
              extensions off.
            </li>
            <li>
              <strong>Bot filtering.</strong> Headless browsers, Lighthouse, and known crawlers are
              dropped on purpose; test with a real browser.
            </li>
            <li>
              <strong>Preview builds.</strong> Make sure the deployed HTML actually contains the
              snippet; view source on the live page.
            </li>
          </ul>
        </Section>

        {/* 07 */}
        <Section
          id="plausible"
          n="07"
          title="Migrate from Plausible"
          lede="Your collector speaks Plausible's event API. Repoint the payloads and keep everything else."
        >
          <p>
            The collect worker accepts Plausible-compatible payloads on the same{' '}
            <Inline>/api/event</Inline> path it already serves - both the tracker script&rsquo;s
            payload and the public Events API shape. Events are matched to your site by the{' '}
            <Inline>data-domain</Inline> value, so no site key is needed.
          </p>
          <Steps
            items={[
              {
                title: 'Add the site in Traks',
                body: (
                  <>
                    Use the exact domain your Plausible snippet declares in{' '}
                    <Inline>data-domain</Inline> - that is how events find the site.
                  </>
                ),
              },
              {
                title: 'Point the events at your collector',
                body: (
                  <>
                    Keep your existing snippet and add a <Inline>data-api</Inline> attribute, or
                    change the endpoint in a server-side SDK:
                  </>
                ),
              },
            ]}
          />
          <Code>{`<script defer data-domain="yoursite.com"
  data-api="${EXAMPLE_COLLECT_URL}/api/event"
  src="https://plausible.io/js/script.js"></script>`}</Code>
          <p>
            UTM tags are read from the page URL server-side; custom events, props, and revenue
            amounts carry over; <Inline>engagement</Inline> beacons feed visit duration. Plausible
            sessionizes on its servers, so Traks derives session ids from 30-minute windows - visits
            and bounce rate for Plausible-sourced traffic are close to, not identical to,
            Plausible&rsquo;s.
          </p>
          <Note>
            The compatibility path is for zero-change migrations and server-side senders. For the
            full feature set - outbound link and download autotracking, 404 capture, the queued{' '}
            <Inline>traks()</Inline> API - switch the page to the native snippet from{' '}
            <A href="#install">Install the tracker</A> when convenient. Historical Plausible data is
            not imported; your Traks history starts at cutover.
          </Note>
        </Section>

        {/* 08 */}
        <Section
          id="events"
          n="08"
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

        {/* 09 */}
        <Section
          id="goals"
          n="09"
          title="Goals, funnels, and segments"
          lede="All three are configured from the site page, no code changes required."
        >
          <p>
            <strong>Goals</strong> turn a custom event or a page visit into a conversion with a rate
            against period visitors. Page goals accept a <Inline>/section/*</Inline> prefix; event
            goals can require a prop to equal a value (for example <Inline>plan = pro</Inline>).
            Outbound clicks, downloads, and 404s work as goals too.
          </p>
          <p>
            <strong>Funnels</strong> chain two to eight ordered steps, each a page (or prefix) or an
            event with an optional prop condition, and show how many sessions reached each step and
            the drop-off between them.
          </p>
          <p>
            <strong>Filters and segments</strong>: click any row in any panel to filter the whole
            dashboard by it; filters stack and live in the URL. Save the active combination as a
            named segment from the bookmark menu and re-apply it in one click.
          </p>
        </Section>

        {/* 10 */}
        <Section
          id="team"
          n="10"
          title="Invite your team"
          lede="Workspaces group sites; membership decides who sees what."
        >
          <p>
            Owners open <strong>Members</strong> in the header and invite by email. Your instance
            does not send email, so copy the invite link and share it yourself; it is pinned to that
            address and expires after seven days. There are two roles: <strong>owners</strong>{' '}
            manage sites, goals, and invites, and <strong>members</strong> get read-only dashboards.
            Switch between workspaces from the breadcrumb in the header.
          </p>
        </Section>

        {/* 11 */}
        <Section
          id="agents"
          n="11"
          title="Coding agents and the API"
          lede="Every instance ships an MCP server and a REST API behind the same permissions as the dashboard."
        >
          <Steps
            items={[
              {
                title: 'Mint a token',
                body: (
                  <>
                    Open the <strong>MCP server</strong> tab, name the token, and choose a scope:{' '}
                    <em>read</em> (stats only) or <em>manage</em> (also create and edit goals and
                    funnels). Tokens are bound to the current workspace, shown once, and can be
                    revoked at any time.
                  </>
                ),
              },
              {
                title: 'Connect your agent',
                body: (
                  <>
                    The MCP endpoint is <Inline>{`${EXAMPLE_API_URL}/api/mcp`}</Inline> (Streamable
                    HTTP). For Claude Code:
                    <Code>{`claude mcp add --transport http traks ${EXAMPLE_API_URL}/api/mcp \\\n  --header "Authorization: Bearer traks_pat_..."`}</Code>
                    Any MCP client that supports HTTP transport and a bearer header works the same
                    way.
                  </>
                ),
              },
              {
                title: 'Give it the skill',
                body: (
                  <>
                    The <strong>Skill</strong> tab renders a ready-made <Inline>SKILL.md</Inline>{' '}
                    with your instance URLs filled in. Drop it into your agent&rsquo;s skills folder
                    and it knows how to install the snippet, name events, and create the matching
                    goals and funnels over MCP.
                  </>
                ),
              },
            ]}
          />
          <p>
            MCP tools: <Inline>list_sites</Inline>, <Inline>get_tracking_snippet</Inline>,{' '}
            <Inline>get_stats</Inline>, <Inline>get_custom_events</Inline>,{' '}
            <Inline>get_event_props</Inline>, <Inline>list / create / update / delete_goal</Inline>,{' '}
            <Inline>get_goal_stats</Inline>, <Inline>list / create / update / delete_funnel</Inline>
            , <Inline>get_funnel_stats</Inline>. The same bearer token authorizes plain REST calls
            under <Inline>/api</Inline>. Tokens can never mint other tokens or manage members; those
            actions need a signed-in session.
          </p>
        </Section>

        {/* 12 */}
        <Section
          id="update"
          n="12"
          title="Updates"
          lede="Instances do not update themselves; you decide when."
        >
          <p>
            The version pill in the dashboard header turns into a{' '}
            <span className="font-medium text-[#3D3B4F]">vX.Y.Z available</span> link when traks.dev
            publishes a newer release (you can also choose <strong>Check for updates</strong> from
            the account menu). It takes you to <A href="/update">traks.dev/update</A>: connect your
            Cloudflare account, pick the instance, click <strong>Update</strong>. Both Workers,
            migrations, and the dashboard ship together; your data and settings are untouched.
          </p>
          <p>
            The update page lists what each pending release changes, and the full history of every
            platform release is at <A href="/changelog">traks.dev/changelog</A>.
          </p>
        </Section>

        {/* 13 */}
        <Section
          id="destroy"
          n="13"
          title="Removing Traks"
          lede="Everything the wizard created, it can remove."
        >
          <p>
            <A href="/destroy">traks.dev/destroy</A> connects to your account, lists exactly what
            will be deleted (Workers, D1, KV, the pipeline, the catalog), and asks you to type the
            instance name to confirm. The R2 events bucket is emptied and removed only when you also
            provide the storage token; without it the bucket, and your history, are left in place.
          </p>
        </Section>

        {/* 14 */}
        <Section id="privacy" n="14" title="Privacy">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>No cookies and no persistent identifiers, so no consent banner is required.</li>
            <li>
              Visitors are counted with a daily-rotating hash (HMAC of IP + user agent + site key
              with a server-side secret), so the same person cannot be linked across days.
            </li>
            <li>
              IP addresses are used in memory to resolve geography and then discarded; referrer
              query strings are stripped before storage.
            </li>
            <li>Known bots and crawlers are filtered at the edge.</li>
            <li>
              All data lives in your Cloudflare account. traks.dev keeps no record of your instance:
              the deploy, update, and destroy wizards find it live in your account each time you
              sign in, and the only thing they hold is the progress of a run, wiped within a day.
            </li>
          </ul>
        </Section>
      </div>
    </>
  );
}
