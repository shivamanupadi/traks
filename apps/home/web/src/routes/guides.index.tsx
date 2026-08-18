import { createFileRoute, redirect } from '@tanstack/react-router';

/** Legacy URL: the guides now live inside the docs. */
export const Route = createFileRoute('/guides/')({
  beforeLoad: () => {
    throw redirect({ to: '/docs', hash: 'install', replace: true });
  },
});
