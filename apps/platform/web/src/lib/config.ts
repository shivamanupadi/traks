import { useQuery } from '@tanstack/react-query';

/**
 * Instance config served by the api worker (/api/config). Runtime, not
 * build-time: the same prebuilt SPA bundle works on any deployment -
 * custom domain or bare workers.dev - because the worker tells it where
 * the collect endpoint lives.
 */
interface InstanceConfig {
  collectUrl: string;
  /** Release version stamped by the deploy wizard; absent on dev/hosted. */
  version?: string;
  /** Instance name (`<name>` in `<name>-api`); absent on dev/hosted. */
  instanceName?: string;
}

/**
 * Where "Update" sends the owner: traks.dev/update, told which instance is
 * asking (its own origin, name, and version) so the wizard can show it
 * immediately and pre-select it after the Cloudflare sign-in. Nothing is
 * remembered by traks.dev; the token the owner signs in with is what
 * authorizes the update.
 */
export function updateUrl(config: InstanceConfig | undefined): string {
  return wizardUrl('update', config, true);
}

/** traks.dev/destroy, told which instance is asking (no version needed). */
export function destroyUrl(config: InstanceConfig | undefined): string {
  return wizardUrl('destroy', config, false);
}

function wizardUrl(
  flow: 'update' | 'destroy',
  config: InstanceConfig | undefined,
  withVersion: boolean
): string {
  const params = new URLSearchParams();
  if (typeof window !== 'undefined') params.set('url', window.location.origin);
  if (config?.instanceName) params.set('name', config.instanceName);
  if (withVersion && config?.version) params.set('version', config.version);
  const qs = params.toString();
  return `https://traks.dev/${flow}${qs ? `?${qs}` : ''}`;
}

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

/**
 * This deployment's collect origin. Returns undefined until /api/config
 * resolves - deliberately NOT defaulted: a fallback to some other host would
 * hand the customer an install snippet that ships their events elsewhere.
 * Callers must render a loading/error state instead of a wrong snippet.
 */
export function useCollectUrl(): string | undefined {
  return useInstanceConfig()?.collectUrl;
}

/**
 * Latest published release, from traks.dev's public CORS-open endpoint.
 * Only queried on wizard-deployed instances (version set).
 */
export function useLatestVersion(): string | undefined {
  const config = useInstanceConfig();
  const { data } = useQuery({
    queryKey: ['latest-version'],
    enabled: Boolean(config?.version),
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
