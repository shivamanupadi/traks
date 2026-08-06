import { useQuery } from '@tanstack/react-query';

/**
 * Instance config served by the api worker (/api/config). Runtime, not
 * build-time: the same prebuilt SPA bundle works on any deployment —
 * custom domain or bare workers.dev — because the worker tells it where
 * the collect endpoint lives.
 */
interface InstanceConfig {
  collectUrl: string;
  /** Release version stamped by the deploy wizard; absent on dev/hosted. */
  version?: string;
  /** Wizard session that owns this instance, for update links; absent on dev/hosted. */
  deployInstanceId?: string;
}

/** Shown only for the instant before /api/config resolves. */
const FALLBACK_COLLECT_URL = 'https://collect.traks.dev';

export function useInstanceConfig(): InstanceConfig | undefined {
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
  return data;
}

export function useCollectUrl(): string {
  return useInstanceConfig()?.collectUrl ?? FALLBACK_COLLECT_URL;
}

/**
 * Latest published release, from traks.dev's public CORS-open endpoint.
 * Only queried on wizard-deployed instances (version + deployInstanceId set).
 */
export function useLatestVersion(): string | undefined {
  const config = useInstanceConfig();
  const { data } = useQuery({
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
  return data;
}
