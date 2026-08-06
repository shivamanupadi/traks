import { createFileRoute, useNavigate, useLocation, Link, Outlet } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LayoutGrid, Settings, User, ChevronDown, LogOut, ArrowUpCircle, X } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { useInstanceConfig } from '@/lib/config';
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
    <div className="min-h-screen bg-[#fafafa]">
      {/* Header */}
      <header className="bg-[#fafafa]/85 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-[68px] flex items-center justify-between">
          {/* Logo */}
          <Link to="/portal/sites" className="flex items-center gap-2.5 group">
            <img
              src="/logo.svg"
              alt="Traks"
              className="h-9 w-9 group-hover:scale-105 transition-transform"
            />
            <span className="font-semibold text-[17px] text-[#3D3B4F] tracking-tight hidden sm:block">
              Traks
            </span>
          </Link>

          {/* Center Nav */}
          <nav className="hidden sm:flex items-center gap-0.5 bg-white p-1 rounded-full shadow-pill">
            <NavLink to="/portal/sites" icon="sites" alsoMatchPaths={['/portal/site/']}>
              Sites
            </NavLink>
            <NavLink to="/portal/settings" icon="settings">
              Settings
            </NavLink>
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {/* Mobile nav */}
            <nav className="flex sm:hidden items-center gap-1">
              <MobileNavLink to="/portal/sites" icon="sites" alsoMatchPaths={['/portal/site/']} />
              <MobileNavLink to="/portal/settings" icon="settings" />
            </nav>

            <UserMenu />
          </div>
        </div>
      </header>

      <UpdateBanner />

      {/* Child routes render here */}
      <Outlet />
    </div>
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
  const { data: latest } = useQuery({
    queryKey: ['latest-version'],
    enabled: Boolean(config?.version && config?.deployInstanceId),
    queryFn: async (): Promise<string | undefined> => {
      const res = await fetch('https://traks.dev/api/deploy/latest-version');
      if (!res.ok) throw new Error(`latest-version fetch failed: ${res.status}`);
      const body = (await res.json()) as { data?: { version?: string } };
      return body.data?.version;
    },
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
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

function NavLink({
  to,
  icon,
  alsoMatchPaths,
  children,
}: {
  to: string;
  icon: 'sites' | 'settings';
  alsoMatchPaths?: string[];
  children: React.ReactNode;
}): React.ReactNode {
  const location = useLocation();
  const isActive =
    location.pathname.startsWith(to) ||
    (alsoMatchPaths?.some(p => location.pathname.startsWith(p)) ?? false);

  return (
    <Link
      to={to}
      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full transition-all ${
        isActive ? 'text-white bg-[#3D3B4F] font-semibold' : 'text-[#9B9590] hover:text-[#6b6560]'
      }`}
    >
      <NavIcon type={icon} />
      {children}
    </Link>
  );
}

function MobileNavLink({
  to,
  icon,
  alsoMatchPaths,
}: {
  to: string;
  icon: 'sites' | 'settings';
  alsoMatchPaths?: string[];
}): React.ReactNode {
  const location = useLocation();
  const isActive =
    location.pathname.startsWith(to) ||
    (alsoMatchPaths?.some(p => location.pathname.startsWith(p)) ?? false);

  return (
    <Link
      to={to}
      className={`w-9 h-9 flex items-center justify-center rounded-full transition-all ${
        isActive ? 'bg-[#3D3B4F] text-white' : 'text-[#9B9590] hover:text-[#6b6560] hover:bg-muted'
      }`}
    >
      <NavIcon type={icon} />
    </Link>
  );
}

function NavIcon({ type }: { type: 'sites' | 'settings' }): React.ReactNode {
  if (type === 'sites') return <LayoutGrid className="w-4 h-4" />;
  return <Settings className="w-4 h-4" />;
}

function UserMenu(): React.ReactNode {
  const { data: session } = authClient.useSession();

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

        <DropdownMenuItem asChild>
          <Link to="/portal/sites" className="flex items-center gap-3 px-4 py-2.5 cursor-pointer">
            <LayoutGrid className="w-4 h-4" />
            Sites
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link
            to="/portal/settings"
            className="flex items-center gap-3 px-4 py-2.5 cursor-pointer"
          >
            <Settings className="w-4 h-4" />
            Settings
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => void signOut()}
          className="flex items-center gap-3 px-4 py-2.5 text-[#e5484d] focus:text-[#e5484d] focus:bg-red-50 cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
