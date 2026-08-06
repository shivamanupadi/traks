import { createFileRoute, redirect } from '@tanstack/react-router';

// Product app has no landing page — the marketing site is its own app
// (apps/site, traks.dev). On an instance, the root is the door to the
// dashboard: /login bounces straight to /portal when a session exists.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/login' });
  },
});
