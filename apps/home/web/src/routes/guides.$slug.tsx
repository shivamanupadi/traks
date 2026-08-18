import { createFileRoute, redirect } from '@tanstack/react-router';

/** Legacy URL: the guides now live inside the docs. */
export const Route = createFileRoute('/guides/$slug')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/docs/install/$slug', params: { slug: params.slug }, replace: true });
  },
});
