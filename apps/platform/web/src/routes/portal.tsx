import { createFileRoute, useNavigate, useLocation, Link, Outlet } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  User,
  ChevronDown,
  LogOut,
  ArrowUpCircle,
  X,
  Globe,
  RefreshCw,
  Trash2,
  AlertTriangle,
  ExternalLink,
  Mail,
  Copy,
  Check,
  Github,
  Menu,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { authClient } from '@/lib/auth-client';
import { destroyUrl, updateUrl, useInstanceConfig, useLatestVersion } from '@/lib/config';
import { useWorkspace, WorkspaceProvider } from '@/lib/workspace';
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/portal')({
  component: PortalLayout,
});

function PortalLayout(): React.ReactNode {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && !session) {
      navigate({ to: '/login' });
    }
  }, [isPending, session, navigate]);

  // Redirect /portal to /portal/sites
  useEffect(() => {
    if (!isPending && session && window.location.pathname === '/portal') {
      navigate({ to: '/portal/sites' });
    }
  }, [isPending, session, navigate]);

  if (isPending) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-[14px] text-subtle">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <WorkspaceProvider>
      <div className="min-h-screen bg-background">
        <PortalHeader />
        <UpdateBanner />

        {/* Child routes render here */}
        <Outlet />
      </div>
    </WorkspaceProvider>
  );
}

/**
 * Two-row chrome: a white top row carrying identity (logo / workspace / site
 * breadcrumb) and account, and a tab rail carrying navigation with an ink
 * underline on the active tab.
 */
function PortalHeader(): React.ReactNode {
  const { current } = useWorkspace();
  const tabs = NAV_TABS.filter(t => !t.ownerOnly || current?.role === 'owner');
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const location = useLocation();

  // Navigating from the mobile menu closes it.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    // One-line chrome: identity, navigation, and account share a single row -
    // the old tab rail's 42px goes back to the content. Below lg the tabs
    // don't fit beside the workspace switcher, so they fold into a menu.
    <header className="sticky top-0 z-40 border-b border-border bg-card">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
        <div className="flex h-full min-w-0 items-center">
          <Link to="/portal/sites" className="flex shrink-0 items-center gap-2">
            <img src="/logo.svg" alt="Traks" className="h-6 w-6" />
            <span className="hidden lg:block text-[15px] font-semibold tracking-[-0.01em] text-foreground">
              Traks
            </span>
          </Link>
          <BreadcrumbSlash />
          <WorkspaceSwitcher />
          <span className="hidden h-full items-center lg:flex">
            <BreadcrumbSlash />
            <nav className="flex h-full items-center gap-0.5">
              {tabs.map(tab => (
                <HeaderTab key={tab.to} to={tab.to} alsoMatchPaths={tab.alsoMatchPaths}>
                  {tab.label}
                </HeaderTab>
              ))}
            </nav>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <VersionPill />
          <ContactButton />
          <UserMenu />
          <button
            onClick={() => setMenuOpen(o => !o)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted lg:hidden cursor-pointer"
          >
            {menuOpen ? (
              <X className="h-[18px] w-[18px]" strokeWidth={1.8} />
            ) : (
              <Menu className="h-[18px] w-[18px]" strokeWidth={1.8} />
            )}
          </button>
        </div>
      </div>
      {menuOpen && <MobileNav tabs={tabs} onClose={closeMenu} />}
    </header>
  );
}

const NAV_TABS: { to: string; label: string; alsoMatchPaths?: string[]; ownerOnly?: boolean }[] = [
  { to: '/portal/sites', label: 'Sites', alsoMatchPaths: ['/portal/site/'] },
  { to: '/portal/skill', label: 'Skill' },
  { to: '/portal/mcp', label: 'MCP server' },
  { to: '/portal/tokens', label: 'API tokens' },
  { to: '/portal/members', label: 'Members', ownerOnly: true },
  { to: '/portal/settings', label: 'Settings' },
];

/** The header tabs as a drop-down sheet under the header (below lg). */
function MobileNav({
  tabs,
  onClose,
}: {
  tabs: typeof NAV_TABS;
  onClose: () => void;
}): React.ReactNode {
  const location = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-x-0 bottom-0 top-14 bg-btn/20 lg:hidden animate-in fade-in-0 duration-150"
      />
      <nav
        id="mobile-nav"
        className="absolute inset-x-0 top-full border-b border-border bg-card px-4 pb-3 pt-2 shadow-float lg:hidden animate-in slide-in-from-top-1 fade-in-0 duration-150 sm:px-6"
      >
        {tabs.map(tab => {
          const isActive =
            location.pathname.startsWith(tab.to) ||
            (tab.alsoMatchPaths?.some(p => location.pathname.startsWith(p)) ?? false);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              onClick={onClose}
              className={`flex h-11 items-center rounded-[10px] px-3 text-[15px] transition-colors ${
                isActive
                  ? 'bg-muted font-semibold text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function BreadcrumbSlash(): React.ReactNode {
  return <span aria-hidden className="mx-3 h-[22px] w-px shrink-0 rotate-[18deg] bg-border" />;
}

function HeaderTab({
  to,
  alsoMatchPaths,
  children,
}: {
  to: string;
  alsoMatchPaths?: string[];
  children: React.ReactNode;
}): React.ReactNode {
  const location = useLocation();
  const isActive =
    location.pathname.startsWith(to) ||
    (alsoMatchPaths?.some(p => location.pathname.startsWith(p)) ?? false);

  return (
    <Link to={to} className="relative flex h-full items-center px-1">
      <span
        className={`rounded-[7px] px-2.5 py-1.5 text-[13.5px] transition-colors ${
          isActive
            ? 'font-semibold text-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        {children}
      </span>
      {isActive && <span className="absolute inset-x-3 -bottom-px h-[2px] rounded-t-sm bg-btn" />}
    </Link>
  );
}

/**
 * "A newer Traks is available" - only on wizard-deployed instances (version
 * var present). Checks traks.dev's public latest-version endpoint (CORS-open)
 * and links to traks.dev/update with this instance's own origin, name and
 * version, so the wizard pre-selects it. Dismissal is per-version.
 */
function UpdateBanner(): React.ReactNode {
  const config = useInstanceConfig();
  const latest = useLatestVersion();
  const dismissKey = `traks-update-dismissed-${latest ?? ''}`;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (latest) setDismissed(localStorage.getItem(dismissKey) === '1');
  }, [latest, dismissKey]);

  if (!config?.version || !latest) return null;
  if (latest === config.version || dismissed) return null;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
        <p className="flex items-center gap-2.5 text-[13px] text-foreground">
          <ArrowUpCircle className="w-4 h-4 shrink-0 text-foreground" />
          <span>
            <span className="font-semibold">Traks {latest} is available</span>
            <span className="text-subtle"> (you&rsquo;re running {config.version})</span>
          </span>
        </p>
        <div className="flex items-center gap-2">
          <a
            href={updateUrl(config)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-btn px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-btn-hover transition-colors"
          >
            Update
          </a>
          <button
            onClick={() => {
              localStorage.setItem(dismissKey, '1');
              setDismissed(true);
            }}
            aria-label="Dismiss update notice"
            className="w-7 h-7 flex items-center justify-center rounded-full text-subtle hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Running version beside the account menu: a quiet mono pill normally, a
 * mint "update" pill linking to the wizard when a newer release exists.
 */
function VersionPill(): React.ReactNode {
  const config = useInstanceConfig();
  const latest = useLatestVersion();
  if (!config?.version) return null;

  const updateAvailable = Boolean(latest && latest !== config.version);
  if (updateAvailable) {
    return (
      <a
        href={updateUrl(config)}
        target="_blank"
        rel="noopener noreferrer"
        title={`Traks ${latest} is available (you're running ${config.version})`}
        className="flex h-8 items-center gap-1.5 rounded-full bg-mint px-2 text-[11.5px] font-bold text-[#123326] transition-all hover:-translate-y-px sm:px-3"
      >
        <ArrowUpCircle className="h-3.5 w-3.5" strokeWidth={2.2} />
        {/* Phones: icon only - the banner under the header spells it out.
            The text stays for screen readers. */}
        <span className="font-mono max-sm:sr-only">v{latest}</span>
        <span className="max-sm:sr-only">available</span>
      </a>
    );
  }
  return (
    <span
      title={updateAvailable ? `Traks ${latest} is available` : 'Up to date'}
      className="hidden sm:flex h-8 items-center rounded-full border border-border bg-card px-3 font-mono text-[11px] text-subtle"
    >
      v{config.version}
    </span>
  );
}

/** Header shortcut to the contact modal (also in the account menu). */
function ContactButton(): React.ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Contact us"
        title="Contact us"
        className="hidden sm:flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground cursor-pointer"
      >
        <Mail className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </button>
      <ContactDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function UserMenu(): React.ReactNode {
  const { data: session } = authClient.useSession();
  const config = useInstanceConfig();
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);

  /** Force-refresh past every cache layer: the react-query staleTime, the
   *  browser cache, and traks.dev's 5-minute edge cache (bust param). */
  const checkForUpdates = async (): Promise<void> => {
    setChecking(true);
    setCheckNote(null);
    try {
      const res = await fetch(`https://traks.dev/api/deploy/latest-version?bust=${Date.now()}`);
      const body = (await res.json()) as { data?: { version?: string } };
      const version = body.data?.version;
      if (version) {
        queryClient.setQueryData(['latest-version'], version);
        setCheckNote(version === config?.version ? 'Up to date' : `v${version} available`);
      } else {
        setCheckNote('Check failed');
      }
    } catch {
      setCheckNote('Check failed');
    }
    setChecking(false);
    setTimeout(() => setCheckNote(null), 4000);
  };

  const email: string | undefined = session?.user?.email;
  const displayName = session?.user?.name || email?.split('@')[0] || 'User';

  const signOut = async (): Promise<void> => {
    await authClient.signOut();
    window.location.href = '/';
  };

  const { theme, cycle: cycleTheme } = useTheme();
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const [destroyOpen, setDestroyOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

  return (
    <>
      <DestroyDialog open={destroyOpen} onOpenChange={setDestroyOpen} />
      <ContactDialog open={contactOpen} onOpenChange={setContactOpen} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`${displayName} - account menu`}
            className="flex items-center gap-2 pl-1.5 pr-1.5 sm:pr-3 py-1.5 rounded-full bg-card border border-border transition-colors hover:border-border-strong focus:outline-none"
          >
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center">
              <User className="w-4 h-4 text-foreground" />
            </div>
            <span className="hidden sm:block text-sm font-medium text-foreground max-w-[100px] truncate">
              {displayName}
            </span>
            <ChevronDown className="hidden sm:block w-3.5 h-3.5 text-subtle" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          className="w-56 rounded-2xl bg-card border-none shadow-float"
        >
          <DropdownMenuLabel className="px-4 py-3 bg-muted -mx-1 -mt-1 rounded-t-xl">
            <p className="text-sm font-semibold text-foreground truncate">{displayName}</p>
            <p className="text-xs text-subtle font-normal truncate">{email}</p>
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          {/* Everyday actions first, then instance-level ones, sign-out last. */}
          <DropdownMenuItem asChild className="flex items-center gap-3 px-4 py-2.5 cursor-pointer">
            <a href="https://traks.dev" target="_blank" rel="noopener noreferrer">
              <Globe className="w-4 h-4 text-subtle" />
              <span className="flex-1">traks.dev</span>
              <ExternalLink className="w-3.5 h-3.5 text-faint" />
            </a>
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => setContactOpen(true)}
            className="flex items-center gap-3 px-4 py-2.5 cursor-pointer"
          >
            <Mail className="w-4 h-4 text-subtle" />
            Contact us
          </DropdownMenuItem>

          {/* Plain button so the menu stays open and the change is visible. */}
          <button
            onClick={e => {
              e.stopPropagation();
              cycleTheme();
            }}
            className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-sm text-foreground hover:bg-muted transition-colors"
          >
            <ThemeIcon className="w-4 h-4 text-subtle" />
            Theme: {theme === 'system' ? 'System' : theme === 'light' ? 'Light' : 'Dark'}
          </button>

          {config?.version && (
            <>
              {/* Plain button, not a menu item: keeps the menu open so the
                result ("Up to date" / "vX available") is actually seen. The
                running version itself lives in the header pill. */}
              <button
                onClick={e => {
                  e.stopPropagation();
                  void checkForUpdates();
                }}
                disabled={checking}
                className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 text-subtle ${checking ? 'animate-spin' : ''}`} />
                {checkNote ?? 'Check for updates'}
              </button>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={() => setDestroyOpen(true)}
                className="flex items-center gap-3 px-4 py-2.5 text-subtle focus:text-[#e5484d] focus:bg-coral-soft cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                Destroy this instance…
              </DropdownMenuItem>
            </>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => void signOut()}
            className="flex items-center gap-3 px-4 py-2.5 text-[#e5484d] focus:text-[#e5484d] focus:bg-coral-soft cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

const CONTACT_EMAIL = 'hello@traks.dev';
const ISSUES_URL = 'https://github.com/shivamanupadi/traks/issues';

/**
 * How to reach us, shown in place rather than handing off to a mail client
 * (a mailto: does nothing on machines without one configured). The address
 * is selectable text with a copy button; bug reports get the instance's
 * version and name to paste along.
 */
function ContactDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactNode {
  const config = useInstanceConfig();
  const [copied, setCopied] = useState<'email' | 'details' | null>(null);
  const details = [
    config?.version && `Traks v${config.version}`,
    config?.instanceName && `instance ${config.instanceName}`,
  ]
    .filter(Boolean)
    .join(' · ');

  useEffect(() => {
    if (!open) setCopied(null);
  }, [open]);

  const copy = (text: string, what: 'email' | 'details', fallbackId: string): void => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(what);
        setTimeout(() => setCopied(c => (c === what ? null : c)), 2000);
      })
      .catch(() => {
        // Clipboard refused (permissions, insecure origin): select the text
        // so a manual copy is one keystroke away.
        const el = document.getElementById(fallbackId);
        if (el) window.getSelection()?.selectAllChildren(el);
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[13px] bg-[#28E99F]/20">
            <img src="/logo.svg" alt="" className="h-6 w-6" />
          </div>
          <DialogTitle>Contact the Traks team</DialogTitle>
          <DialogDescription>
            Questions, ideas, something broken? Write to us and we&rsquo;ll get back to you.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 rounded-[14px] bg-muted py-2 pl-4 pr-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">
                Email
              </p>
              <p
                id="contact-email"
                className="select-all truncate text-[14px] font-semibold text-foreground"
              >
                {CONTACT_EMAIL}
              </p>
            </div>
            <button
              onClick={() => copy(CONTACT_EMAIL, 'email', 'contact-email')}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-[12px] font-semibold text-foreground shadow-[0_0_0_1px_var(--border)] hover:bg-background transition-colors cursor-pointer"
            >
              {copied === 'email' ? (
                <>
                  <Check className="h-3.5 w-3.5 text-[#1FC285]" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </>
              )}
            </button>
          </div>

          <a
            href={ISSUES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 rounded-[14px] border border-border px-4 py-3 hover:bg-background transition-colors"
          >
            <span className="flex min-w-0 items-center gap-3">
              <Github className="h-4 w-4 shrink-0 text-foreground" strokeWidth={1.8} />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-foreground">
                  Report a bug or request a feature
                </span>
                <span className="block truncate text-[12px] text-subtle">
                  Open an issue on GitHub
                </span>
              </span>
            </span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-subtle" />
          </a>

          {details && (
            <div className="flex items-center justify-between gap-3 px-1">
              <p className="min-w-0 text-[12px] leading-relaxed text-subtle">
                Reporting a problem? Include{' '}
                <span id="contact-details" className="select-all font-mono text-muted-foreground">
                  {details}
                </span>
              </p>
              <button
                onClick={() => copy(details, 'details', 'contact-details')}
                className="shrink-0 text-[12px] font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                {copied === 'details' ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
        </DialogBody>
        <DialogFooter className="mx-6 border-t border-border/50 px-0 pb-5 pt-4">
          <Button onClick={() => onOpenChange(false)} className="px-5 text-[13px] shadow-none">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What "destroy" means, before anyone leaves for the wizard. The wizard on
 * traks.dev does the actual teardown and asks for the instance name to be
 * typed; this is the plain-language briefing so nobody arrives there
 * surprised. Opens the wizard in a new tab with this instance pre-filled.
 */
function DestroyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactNode {
  const config = useInstanceConfig();
  const name = config?.instanceName;
  const removed: { label: string; detail: string }[] = [
    { label: 'Both Workers', detail: 'collect and dashboard' },
    { label: 'Database and cache', detail: 'D1 and KV' },
    { label: 'Event pipeline', detail: 'stream, sink and catalog' },
    { label: 'Everything in the dashboard', detail: 'sites, goals, funnels, members, history' },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#e07a5f]/10">
            <AlertTriangle className="h-5 w-5 text-[#e07a5f]" strokeWidth={1.7} />
          </div>
          <DialogTitle>
            {name ? (
              <>
                Destroy <span className="font-mono">{name}</span>?
              </>
            ) : (
              'Destroy this instance?'
            )}
          </DialogTitle>
          <DialogDescription>
            Everything Traks created in your Cloudflare account is removed. There is no undo.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <div className="rounded-[14px] bg-muted px-4 py-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">
              Removed from your account
            </p>
            <ul className="flex flex-col gap-1.5">
              {removed.map(item => (
                <li key={item.label} className="flex items-baseline gap-2.5 text-[13px]">
                  <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-faint" />
                  <span className="font-medium text-foreground">{item.label}</span>
                  <span className="text-subtle">{item.detail}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[14px] bg-coral-soft px-4 py-3 text-[12.5px] leading-relaxed text-coral-ink">
            The raw events bucket is emptied only if you give the wizard a storage token. Without
            one it stays in your account and keeps costing R2 storage.
          </div>
          <p className="text-[12px] leading-relaxed text-subtle">
            Nothing is deleted yet. The wizard on traks.dev asks you to type the instance name
            before it removes anything.
          </p>
        </DialogBody>
        <DialogFooter className="mx-6 border-t border-border/50 px-0 pb-5 pt-4">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-[13px] cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              window.open(destroyUrl(config), '_blank', 'noopener,noreferrer');
              onOpenChange(false);
            }}
            className="bg-coral hover:bg-[#d06a4f] text-white shadow-none text-[13px] px-5 cursor-pointer"
          >
            Continue on traks.dev
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
