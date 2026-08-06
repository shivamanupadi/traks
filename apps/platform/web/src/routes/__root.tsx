import type { ReactElement } from 'react';
import { createRootRoute, Outlet } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout(): ReactElement {
  return (
    <div className="min-h-screen bg-background">
      <Outlet />
    </div>
  );
}
