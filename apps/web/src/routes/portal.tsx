import { createFileRoute, useNavigate, useLocation, Link, Outlet } from '@tanstack/react-router';
import { useAuth, useUser, useClerk } from '@clerk/clerk-react';
import { useEffect } from 'react';
import { LayoutGrid, Settings, User, ChevronDown, LogOut } from 'lucide-react';
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
  const { isSignedIn, isLoaded } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      navigate({ to: '/login' });
    }
  }, [isLoaded, isSignedIn, navigate]);

  // Redirect /portal to /portal/sites
  useEffect(() => {
    if (isLoaded && isSignedIn && window.location.pathname === '/portal') {
      navigate({ to: '/portal/sites' });
    }
  }, [isLoaded, isSignedIn, navigate]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#fdfbf8] flex items-center justify-center">
        <div className="text-[14px] text-[#9B9590]">Loading...</div>
      </div>
    );
  }

  if (!isSignedIn) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#fdfbf8]">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-[#e8e3ed]/50 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 group">
            <img
              src="/logo64.png"
              alt="Traks"
              className="h-9 w-9 rounded-lg group-hover:scale-105 transition-transform"
            />
            <span className="font-semibold text-[17px] text-[#2D3436] tracking-tight hidden sm:block">
              Traks
            </span>
          </Link>

          {/* Center Nav */}
          <nav className="hidden sm:flex items-center gap-1 bg-[#f3f0f7]/60 p-1 rounded-full">
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

      {/* Child routes render here */}
      <Outlet />
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
        isActive
          ? 'text-[#2D3436] bg-white shadow-sm'
          : 'text-[#9B9590] hover:text-[#6b6560] hover:bg-white/50'
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
        isActive
          ? 'bg-[#2D3436] text-white'
          : 'text-[#9B9590] hover:text-[#6b6560] hover:bg-[#f3f0f7]'
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
  const { user } = useUser();
  const { signOut } = useClerk();

  const displayName =
    user?.firstName || user?.emailAddresses?.[0]?.emailAddress?.split('@')[0] || 'User';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-full bg-[#f3f0f7]/60 hover:bg-[#f3f0f7] transition-colors focus:outline-none">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#9b72cf]/20 via-[#5b9a6f]/15 to-[#e07a5f]/15 flex items-center justify-center">
            <User className="w-4 h-4 text-[#2D3436]/60" />
          </div>
          <span className="hidden sm:block text-sm font-medium text-[#2D3436] max-w-[100px] truncate">
            {displayName}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-[#9B9590]" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-56 rounded-xl bg-white border border-[#e8e3ed] shadow-lg"
      >
        <DropdownMenuLabel className="px-4 py-3 bg-gradient-to-br from-[#9b72cf]/5 via-[#5b9a6f]/5 to-[#e07a5f]/5 -mx-1 -mt-1 rounded-t-lg">
          <p className="text-sm font-semibold text-[#2D3436] truncate">
            {user?.firstName} {user?.lastName}
          </p>
          <p className="text-xs text-[#9B9590] font-normal truncate">
            {user?.emailAddresses?.[0]?.emailAddress}
          </p>
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
          onClick={() => signOut({ redirectUrl: '/' })}
          className="flex items-center gap-3 px-4 py-2.5 text-[#e5484d] focus:text-[#e5484d] focus:bg-red-50 cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
