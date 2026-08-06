import { useQuery } from '@tanstack/react-query';

/** Example collect hostname for docs/marketing snippets — every install gets
 *  its own (wizard: `<sub>-collect.<domain>` or `<name>-collect.workers.dev`). */
export const EXAMPLE_COLLECT_URL = 'https://analytics-collect.your-domain.com';

/** Latest published platform release (home api → releases manifest). */
export function useLatestVersion(): string | undefined {
  const { data } = useQuery({
    queryKey: ['latest-version'],
    queryFn: async (): Promise<string | undefined> => {
      const res = await fetch('/api/deploy/latest-version');
      if (!res.ok) throw new Error(`latest-version fetch failed: ${res.status}`);
      const body = (await res.json()) as { data?: { version?: string } };
      return body.data?.version;
    },
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  return data;
}
