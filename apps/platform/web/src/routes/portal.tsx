import { createFileRoute, useNavigate, useLocation, Link, Outlet } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { User, ChevronDown, LogOut, ArrowUpCircle, X } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { api } from '@/lib/api';
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
      <div className="min-h-screen bg-[#fafafa] flex items-center justify-center">
        <div className="text-[14px] text-[#9B9590]">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <WorkspaceProvider>
      <div className="min-h-screen bg-[#fafafa]">
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
  const location = useLocation();
  const { current } = useWorkspace();

  // Third breadcrumb segment: the site name while inside a dashboard. Reads
  // the same query the dashboard page populates, so it costs no extra fetch.
  const siteMatch = location.pathname.match(/^\/portal\/site\/([^/]+)/);
  const siteId = siteMatch?.[1];
  const { data: siteData } = useQuery({
    queryKey: ['site', siteId],
    queryFn: () => api.getSite(siteId!),
    enabled: !!siteId,
    staleTime: 60_000,
  });
  const siteCrumb = siteId
    ? ((siteData as any)?.data?.name ?? (siteData as any)?.data?.domain ?? null)
    : null;

  return (
    <header className="sticky top-0 z-40 bg-white">
      {/* Identity row */}
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex min-w-0 items-center">
          <Link to="/portal/sites" className="flex shrink-0 items-center gap-2">
            <img src="/logo.svg" alt="Traks" className="h-6 w-6" />
            <span className="hidden sm:block text-[15px] font-semibold tracking-[-0.01em] text-[#3D3B4F]">
              Traks
            </span>
          </Link>
          <BreadcrumbSlash />
          <WorkspaceSwitcher />
          {siteCrumb && (
            <>
              <BreadcrumbSlash />
              <span className="truncate text-[13.5px] text-[#8F8D99]">{siteCrumb}</span>
            </>
          )}
        </div>
        <UserMenu />
      </div>

      {/* Tab rail: border spans the full width, tabs align with the content column */}
      <div className="border-b border-[#E9E8EC]">
        <nav className="mx-auto flex h-[42px] max-w-6xl items-center px-2 sm:px-4">
          <HeaderTab to="/portal/sites" alsoMatchPaths={['/portal/site/']}>
            Sites
          </HeaderTab>
          {current?.role === 'owner' && <HeaderTab to="/portal/members">Members</HeaderTab>}
          <HeaderTab to="/portal/settings">Settings</HeaderTab>
        </nav>
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
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-white shadow-pill px-4 py-3">
        <p className="flex items-center gap-2.5 text-[13px] text-[#3D3B4F]">
          <ArrowUpCircle className="w-4 h-4 shrink-0 text-[#3D3B4F]" />
          <span>
            <span className="font-semibold">Traks {latest} is available</span>
            <span className="text-[#9B9590]"> — you&rsquo;re running {config.version}.</span>
          </span>
        </p>
        <div className="flex items-center gap-2">
          <a
            href={`https://traks.dev/deploy?instance=${encodeURIComponent(config.deployInstanceId)}`}
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

function UserMenu(): React.ReactNode {
  const { data: session } = authClient.useSession();
  const config = useInstanceConfig();
  const latest = useLatestVersion();

  const email: string | undefined = session?.user?.email;
  const displayName = session?.user?.name || email?.split('@')[0] || 'User';

  const signOut = async (): Promise<void> => {
    await authClient.signOut();
    window.location.href = '/';
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full bg-white shadow-pill hover:shadow-md transition-shadow focus:outline-none">
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
          onClick={() => void signOut()}
          className="flex items-center gap-3 px-4 py-2.5 text-[#e5484d] focus:text-[#e5484d] focus:bg-red-50 cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </DropdownMenuItem>

        {config?.version && (
          <>
            <DropdownMenuSeparator />
            <p className="px-4 py-2 font-mono text-[10.5px] text-[#9B9590]">
              Traks v{config.version}
              {latest &&
                (latest === config.version ? (
                  <span> · up to date</span>
                ) : (
                  <span className="font-semibold text-[#3D3B4F]"> · v{latest} available</span>
                ))}
            </p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
