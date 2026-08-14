import { createFileRoute, useNavigate, useLocation, Link, Outlet } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { User, ChevronDown, LogOut, ArrowUpCircle, X, Bot, RefreshCw } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { useInstanceConfig, useLatestVersion } from '@/lib/config';
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
      <div className="min-h-screen bg-[#F9F8F6] flex items-center justify-center">
        <div className="text-[14px] text-[#9B9590]">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <WorkspaceProvider>
      <div className="min-h-screen bg-[#F9F8F6]">
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

  return (
    // One-line chrome: identity, navigation, and account share a single row —
    // the old tab rail's 42px goes back to the content.
    <header className="sticky top-0 z-40 border-b border-[#ECEAE5] bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex h-full min-w-0 items-center">
          <Link to="/portal/sites" className="flex shrink-0 items-center gap-2">
            <img src="/logo.svg" alt="Traks" className="h-6 w-6" />
            <span className="hidden lg:block text-[15px] font-semibold tracking-[-0.01em] text-[#3D3B4F]">
              Traks
            </span>
          </Link>
          <BreadcrumbSlash />
          <WorkspaceSwitcher />
          <BreadcrumbSlash />
          <nav className="flex h-full items-center gap-0.5">
            <HeaderTab to="/portal/sites" alsoMatchPaths={['/portal/site/']}>
              Sites
            </HeaderTab>
            <HeaderTab to="/portal/skill">Skill</HeaderTab>
            <HeaderTab to="/portal/api">API</HeaderTab>
            {current?.role === 'owner' && <HeaderTab to="/portal/members">Members</HeaderTab>}
            <HeaderTab to="/portal/settings">Settings</HeaderTab>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <VersionPill />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

function BreadcrumbSlash(): React.ReactNode {
  return <span aria-hidden className="mx-3 h-[22px] w-px shrink-0 rotate-[18deg] bg-[#E3E2E6]" />;
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
            ? 'font-semibold text-[#3D3B4F]'
            : 'text-[#6F6D7A] hover:bg-[#F2F2F0] hover:text-[#3D3B4F]'
        }`}
      >
        {children}
      </span>
      {isActive && (
        <span className="absolute inset-x-3 -bottom-px h-[2px] rounded-t-sm bg-[#3D3B4F]" />
      )}
    </Link>
  );
}

/**
 * "A newer Traks is available" — only on wizard-deployed instances (version +
 * deployInstanceId vars present). Checks traks.dev's public latest-version
 * endpoint (CORS-open) and links back to this instance's wizard session,
 * which re-runs the deploy idempotently. Dismissal is per-version.
 */
function UpdateBanner(): React.ReactNode {
  const config = useInstanceConfig();
  const latest = useLatestVersion();
  const dismissKey = `traks-update-dismissed-${latest ?? ''}`;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (latest) setDismissed(localStorage.getItem(dismissKey) === '1');
  }, [latest, dismissKey]);

  if (!config?.version || !config.deployInstanceId || !latest) return null;
  if (latest === config.version || dismissed) return null;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#E6E4DE] bg-white px-4 py-3">
        <p className="flex items-center gap-2.5 text-[13px] text-[#3D3B4F]">
          <ArrowUpCircle className="w-4 h-4 shrink-0 text-[#3D3B4F]" />
          <span>
            <span className="font-semibold">Traks {latest} is available</span>
            <span className="text-[#9B9590]"> — you&rsquo;re running {config.version}.</span>
          </span>
        </p>
        <div className="flex items-center gap-2">
          <a
            href={`https://traks.dev/update?instance=${encodeURIComponent(config.deployInstanceId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-[#3D3B4F] px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-[#2C2B3B] transition-colors"
          >
            Update
          </a>
          <button
            onClick={() => {
              localStorage.setItem(dismissKey, '1');
              setDismissed(true);
            }}
            aria-label="Dismiss update notice"
            className="w-7 h-7 flex items-center justify-center rounded-full text-[#9B9590] hover:text-[#3D3B4F] hover:bg-muted transition-colors"
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
  if (updateAvailable && config.deployInstanceId) {
    return (
      <a
        href={`https://traks.dev/update?instance=${encodeURIComponent(config.deployInstanceId)}`}
        target="_blank"
        rel="noopener noreferrer"
        title={`Traks ${latest} is available — you're running ${config.version}`}
        className="flex h-8 items-center gap-1.5 rounded-full bg-mint px-3 text-[11.5px] font-bold text-[#123326] transition-all hover:-translate-y-px"
      >
        <ArrowUpCircle className="h-3.5 w-3.5" strokeWidth={2.2} />
        <span className="font-mono">v{latest}</span>
        <span className="hidden sm:inline">available</span>
      </a>
    );
  }
  return (
    <span
      title={updateAvailable ? `Traks ${latest} is available` : 'Up to date'}
      className="hidden sm:flex h-8 items-center rounded-full border border-[#E6E4DE] bg-white px-3 font-mono text-[11px] text-[#9B9590]"
    >
      v{config.version}
    </span>
  );
}

function UserMenu(): React.ReactNode {
  const { data: session } = authClient.useSession();
  const config = useInstanceConfig();
  const latest = useLatestVersion();
  const navigate = useNavigate();
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full bg-white border border-[#E6E4DE] transition-colors hover:border-[#D8D5CD] focus:outline-none">
          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center">
            <User className="w-4 h-4 text-foreground" />
          </div>
          <span className="hidden sm:block text-sm font-medium text-[#3D3B4F] max-w-[100px] truncate">
            {displayName}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-[#9B9590]" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-56 rounded-2xl bg-white border-none shadow-float"
      >
        <DropdownMenuLabel className="px-4 py-3 bg-muted -mx-1 -mt-1 rounded-t-xl">
          <p className="text-sm font-semibold text-[#3D3B4F] truncate">{displayName}</p>
          <p className="text-xs text-[#9B9590] font-normal truncate">{email}</p>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => void navigate({ to: '/portal/api' })}
          className="flex items-center gap-3 px-4 py-2.5 cursor-pointer"
        >
          <Bot className="w-4 h-4 text-[#9B9590]" />
          API tokens &amp; agents
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => void signOut()}
          className="flex items-center gap-3 px-4 py-2.5 text-[#e5484d] focus:text-[#e5484d] focus:bg-red-50 cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </DropdownMenuItem>

        {config?.version && (
          <>
            <DropdownMenuSeparator />
            {/* Plain button, not a menu item: keeps the menu open so the
                result ("Up to date" / "vX available") is actually seen. */}
            <button
              onClick={e => {
                e.stopPropagation();
                void checkForUpdates();
              }}
              disabled={checking}
              className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-sm text-[#3D3B4F] hover:bg-muted transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 text-[#9B9590] ${checking ? 'animate-spin' : ''}`} />
              {checkNote ?? 'Check for updates'}
            </button>
            <div className="px-4 pb-2.5 pt-1.5 font-mono text-[10.5px] leading-relaxed text-[#9B9590]">
              <p>
                Traks v{config.version}
                {latest && (
                  <span className="text-[#B5B0AA]">
                    {latest === config.version ? ' · up to date' : ` · v${latest} available`}
                  </span>
                )}
              </p>
              {config.deployInstanceId && (
                <button
                  onClick={() => void navigator.clipboard.writeText(config.deployInstanceId!)}
                  title="Copy instance id"
                  className="cursor-pointer break-all text-left hover:text-[#3D3B4F] transition-colors"
                >
                  instance {config.deployInstanceId} <span className="text-[#B5B0AA]">⧉</span>
                </button>
              )}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
