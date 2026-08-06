import { useQuery } from '@tanstack/react-query';

/**
 * Instance config served by the api worker (/api/config). Runtime, not
 * build-time: the same prebuilt SPA bundle works on any deployment —
 * custom domain or bare workers.dev — because the worker tells it where
 * the collect endpoint lives.
 */
interface InstanceConfig {
  collectUrl: string;
}

/** Shown only for the instant before /api/config resolves. */
const FALLBACK_COLLECT_URL = 'https://collect.traks.dev';

export function useCollectUrl(): string {
  const { data } = useQuery({
    queryKey: ['instance-config'],
    queryFn: async (): Promise<InstanceConfig> => {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error(`config fetch failed: ${res.status}`);
      return (await res.json()) as InstanceConfig;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 2,
  });
  return data?.collectUrl ?? FALLBACK_COLLECT_URL;
}
