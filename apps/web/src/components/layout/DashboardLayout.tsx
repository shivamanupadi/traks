import type { ReactElement, ReactNode } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useAuth, UserButton } from '@clerk/clerk-react';
import {
  BarChart3,
  Globe,
  Settings,
  Zap,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface DashboardLayoutProps {
  children: ReactNode;
}

const NAV_ITEMS = [
  { label: 'Analytics', icon: BarChart3, path: '/portal/site/$siteId' },
  { label: 'Realtime', icon: Zap, path: '/portal/site/$siteId/realtime' },
  { label: 'Events', icon: Globe, path: '/portal/site/$siteId/events' },
];

export function DashboardLayout({ children }: DashboardLayoutProps): ReactElement {
  const { getToken } = useAuth();
  const params = useParams({ strict: false }) as { siteId?: string };

  const { data: sitesData } = useQuery({
    queryKey: ['sites'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return api.getSites(token);
    },
  });

  const sites = (sitesData as any)?.data || [];
  const currentSite = sites.find((s: any) => s.id === params.siteId);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-sidebar-border bg-sidebar">
        {/* Logo */}
        <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <BarChart3 className="h-4 w-4 text-white" />
          </div>
          <span className="text-[15px] font-semibold tracking-tight">Traks</span>
        </div>

        {/* Site picker */}
        <div className="border-b border-sidebar-border px-3 py-3">
          <div className="flex items-center gap-2 rounded-lg bg-sidebar-accent px-3 py-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 truncate text-[13px] font-medium">
              {currentSite?.name || 'Select a site'}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </div>

          {/* Site list */}
          {sites.length > 1 && (
            <div className="mt-1 space-y-0.5">
              {sites.map((site: any) => (
                <Link
                  key={site.id}
                  to="/portal/site/$siteId"
                  params={{ siteId: site.id }}
                  className={cn(
                    'block rounded-md px-3 py-1.5 text-[13px] transition-colors',
                    site.id === params.siteId
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-sidebar-accent'
                  )}
                >
                  {site.name}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Navigation */}
        {params.siteId && (
          <nav className="flex-1 px-3 py-3">
            <div className="space-y-0.5">
              {NAV_ITEMS.map(item => (
                <Link
                  key={item.label}
                  to={item.path}
                  params={{ siteId: params.siteId! }}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground [&.active]:bg-primary/10 [&.active]:text-primary"
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>
        )}

        {/* Bottom */}
        <div className="border-t border-sidebar-border p-3">
          <Link
            to="/portal/settings"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
          <div className="mt-2 px-3">
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-64 flex-1 p-6">{children}</main>
    </div>
  );
}
