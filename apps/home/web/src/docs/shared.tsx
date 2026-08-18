import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { INSTALL_GUIDES } from '@traks/shared';

/* ── building blocks ─────────────────────────────────────────── */

export function Code({ children }: { children: ReactNode }): ReactElement {
  return (
    <pre className="mt-3 overflow-x-auto rounded-2xl bg-[#34324A] px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-[#C9C8D4] whitespace-pre-wrap break-all select-all">
      {children}
    </pre>
  );
}

export function Inline({ children }: { children: ReactNode }): ReactElement {
  return (
    <code className="rounded-md bg-[#F2F1ED] px-1.5 py-0.5 font-mono text-[12px] text-[#3D3B4F]">
      {children}
    </code>
  );
}

export function Section({
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
export function Steps({ items }: { items: { title: string; body: ReactNode }[] }): ReactElement {
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

export function Note({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="rounded-2xl border border-[#EEEEF2] bg-white p-4 text-[13px] leading-relaxed text-[#6E6C7C] shadow-float">
      {children}
    </div>
  );
}

export function A({ href, children }: { href: string; children: ReactNode }): ReactElement {
  return (
    <a href={href} className="font-semibold text-[#3D3B4F] underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

/* ── navigation ──────────────────────────────────────────────── */

export const TOC: { id: string; label: string; group: string }[] = [
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

export const GROUPS = Array.from(new Set(TOC.map(t => t.group)));

/** Which section is nearest the top of the viewport. */
function useActiveSection(): string {
  const [active, setActive] = useState(TOC[0].id);
  const { pathname } = useLocation();
  useEffect(() => {
    const onScroll = (): void => {
      // Re-query each time: the layout outlives the index page's sections.
      const els = Array.from(document.querySelectorAll<HTMLElement>('[data-doc-section]'));
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
  }, [pathname]);
  return active;
}

/** Where the reader is: a docs section id (index page) or `guide:<slug>`. */
export function useDocsActive(): string {
  const { pathname } = useLocation();
  const scrolled = useActiveSection();
  const m = /^\/docs\/install\/([^/]+)\/?$/.exec(pathname);
  return m ? `guide:${m[1]}` : scrolled;
}

/** Sidebar entry: smooth-scroll when already on the index, navigate otherwise. */
function useGoToSection(): (id: string) => void {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return id => {
    if (pathname === '/docs' || pathname === '/docs/') {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
      history.replaceState(null, '', `#${id}`);
    } else {
      void navigate({ to: '/docs', hash: id });
    }
  };
}

const linkClass = (on: boolean): string =>
  `-ml-px block border-l-2 py-1 pl-3.5 text-[13px] leading-snug transition-colors ${
    on
      ? 'border-[#3D3B4F] font-semibold text-[#3D3B4F]'
      : 'border-transparent text-[#6E6C7C] hover:border-[#B3B1BE] hover:text-[#3D3B4F]'
  }`;

function GroupLabel({ children }: { children: ReactNode }): ReactElement {
  return (
    <p className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#B3B1BE]">
      {children}
    </p>
  );
}

export function Sidebar({ active }: { active: string }): ReactElement {
  const go = useGoToSection();
  return (
    <nav aria-label="Documentation" className="space-y-6">
      {GROUPS.map(g => (
        <div key={g}>
          <GroupLabel>{g}</GroupLabel>
          <ul className="space-y-0.5 border-l border-[#E6E4DE]">
            {TOC.filter(t => t.group === g).map(t => {
              const on = t.id === active;
              return (
                <li key={t.id}>
                  <a
                    href={`/docs#${t.id}`}
                    onClick={e => {
                      e.preventDefault();
                      go(t.id);
                    }}
                    aria-current={on ? 'true' : undefined}
                    className={linkClass(on)}
                  >
                    {t.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div>
        <GroupLabel>Install guides</GroupLabel>
        <ul className="space-y-0.5 border-l border-[#E6E4DE]">
          {INSTALL_GUIDES.map(gd => {
            const on = active === `guide:${gd.slug}`;
            return (
              <li key={gd.slug}>
                <Link
                  to="/docs/install/$slug"
                  params={{ slug: gd.slug }}
                  aria-current={on ? 'true' : undefined}
                  className={linkClass(on)}
                >
                  {gd.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

/** Mobile: a sticky jump menu instead of the sidebar. */
export function JumpMenu({ active }: { active: string }): ReactElement {
  const go = useGoToSection();
  const navigate = useNavigate();
  const known =
    TOC.some(t => t.id === active) || INSTALL_GUIDES.some(g => `guide:${g.slug}` === active);
  return (
    <div className="sticky top-0 z-20 -mx-4 border-b border-[#E6E4DE] bg-[#F6F5F2]/95 px-4 py-2.5 backdrop-blur lg:hidden">
      <label className="flex items-center gap-2">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#B3B1BE]">
          Section
        </span>
        <select
          value={known ? active : TOC[0].id}
          onChange={e => {
            const v = e.target.value;
            if (v.startsWith('guide:')) {
              void navigate({ to: '/docs/install/$slug', params: { slug: v.slice(6) } });
            } else {
              go(v);
            }
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
          <optgroup label="Install guides">
            {INSTALL_GUIDES.map(gd => (
              <option key={gd.slug} value={`guide:${gd.slug}`}>
                {gd.name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
    </div>
  );
}

export const QUICK_START: { title: string; body: string; href: string }[] = [
  { title: 'Deploy', body: 'traks.dev/deploy, sign in with Cloudflare, ~2 min.', href: '#deploy' },
  { title: 'Claim', body: 'Open your URL, create the owner account.', href: '#claim' },
  { title: 'Add a site', body: 'Name, domain, timezone. Copy the snippet.', href: '#site' },
  { title: 'Install', body: 'One script tag in <head>. Watch visitors land.', href: '#install' },
];
