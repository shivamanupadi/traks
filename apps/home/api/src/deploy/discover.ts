import { instanceNames, listZones } from './engine';

/**
 * Live instance discovery: everything the wizard needs to know about a Traks
 * install is rebuilt from the user's own Cloudflare account with the token
 * they just supplied. Nothing here is remembered by traks.dev.
 *
 * An instance is a pair of Workers named `<name>-api` and `<name>-collect`
 * (the engine's naming convention). Its address is whichever of these the
 * api Worker answers on, in order of preference:
 *   1. a Workers custom domain attached to it,
 *   2. a zone route pointing at it,
 *   3. its workers.dev address, if workers.dev is enabled for the script.
 * Its version is the TRAKS_VERSION binding the engine stamps on every deploy.
 *
 * Failures are per account and per instance: a slow or unusual account
 * degrades to "unknown" fields rather than an error, because a missing
 * field only affects what the wizard displays, never what it can update.
 */
export interface DiscoveredInstance {
  /** Synthetic id, stable per account+name, for React keys and selection. */
  id: string;
  accountId: string;
  instanceName: string;
  apiUrl: string | null;
  deployedVersion: string | null;
  /** Wizard-scheme custom domain, when the attached hostnames follow it. */
  customDomain: { zoneId: string; zoneName: string; subdomain: string } | null;
  /** Did the api Worker answer /api/health at apiUrl within the probe budget? */
  reachable: boolean | null;
}

const API = 'https://api.cloudflare.com/client/v4';
const CALL_TIMEOUT_MS = 6000;
const HEALTH_TIMEOUT_MS = 4000;
const MAX_ZONES_FOR_ROUTES = 10;

async function cfGet<T>(token: string, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => null)) as { success?: boolean; result?: T } | null;
    if (!res.ok || data?.success === false) return null;
    return (data?.result ?? null) as T | null;
  } catch {
    return null;
  }
}

interface ScriptRow {
  id: string;
}
interface DomainRow {
  hostname: string;
  service: string;
  zone_id: string;
  zone_name: string;
}
interface RouteRow {
  pattern: string;
  script?: string | null;
}
interface SettingsRow {
  bindings?: { type: string; name: string; text?: string }[];
}

/** Invert the wizard's custom-domain scheme (see resolveCustomDomain in routes.ts). */
function wizardCustomDomain(
  api: DomainRow | undefined,
  collect: DomainRow | undefined
): DiscoveredInstance['customDomain'] {
  if (!api || !collect || api.zone_id !== collect.zone_id) return null;
  const zone = api.zone_name;
  if (api.hostname !== zone && !api.hostname.endsWith(`.${zone}`)) return null; // not under this zone
  const subdomain = api.hostname === zone ? '' : api.hostname.slice(0, -(zone.length + 1));
  const expectedCollect = subdomain ? `${subdomain}-collect.${zone}` : `collect.${zone}`;
  if (collect.hostname !== expectedCollect) return null;
  return { zoneId: api.zone_id, zoneName: zone, subdomain };
}

async function healthy(apiUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      redirect: 'manual',
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function discoverInAccount(token: string, accountId: string): Promise<DiscoveredInstance[]> {
  const scripts = (await cfGet<ScriptRow[]>(token, `/accounts/${accountId}/workers/scripts`)) ?? [];
  const names = new Set(scripts.map(s => s.id));
  const instances = [...names]
    .filter(n => n.endsWith('-api') && names.has(`${n.slice(0, -4)}-collect`))
    .map(n => n.slice(0, -4));
  if (instances.length === 0) return [];

  // Account-wide lookups, fetched once and shared by every instance.
  const [subdomainRes, domains, zones] = await Promise.all([
    cfGet<{ subdomain?: string }>(token, `/accounts/${accountId}/workers/subdomain`),
    cfGet<DomainRow[]>(token, `/accounts/${accountId}/workers/domains`),
    listZones(token, accountId).catch(() => [] as { id: string; name: string }[]),
  ]);
  const subdomain = subdomainRes?.subdomain ?? null;
  const routes = (
    await Promise.all(
      zones
        .slice(0, MAX_ZONES_FOR_ROUTES)
        .map(z => cfGet<RouteRow[]>(token, `/zones/${z.id}/workers/routes`))
    )
  ).flatMap(r => r ?? []);

  return Promise.all(
    instances.map(async (instance): Promise<DiscoveredInstance> => {
      const N = instanceNames(instance);
      const [settings, scriptSub] = await Promise.all([
        cfGet<SettingsRow>(token, `/accounts/${accountId}/workers/scripts/${N.apiWorker}/settings`),
        cfGet<{ enabled?: boolean }>(
          token,
          `/accounts/${accountId}/workers/scripts/${N.apiWorker}/subdomain`
        ),
      ]);
      const version =
        settings?.bindings?.find(b => b.type === 'plain_text' && b.name === 'TRAKS_VERSION')
          ?.text ?? null;

      const apiDomain = (domains ?? []).find(d => d.service === N.apiWorker);
      const collectDomain = (domains ?? []).find(d => d.service === N.collectWorker);
      const routeHost = routes
        .filter(r => r.script === N.apiWorker)
        .map(r => r.pattern.split('/')[0].replace(/^\*\./, ''))
        .find(h => h && !h.includes('*'));
      const candidates = [
        apiDomain ? `https://${apiDomain.hostname}` : null,
        routeHost ? `https://${routeHost}` : null,
        subdomain && scriptSub?.enabled !== false
          ? `https://${N.apiWorker}.${subdomain}.workers.dev`
          : null,
      ].filter((u): u is string => Boolean(u));

      // First reachable candidate wins; if none answers, keep the preferred
      // one for display and flag it. The update itself never needs the URL.
      let apiUrl: string | null = candidates[0] ?? null;
      let reachable: boolean | null = null;
      for (const url of candidates) {
        if (await healthy(url)) {
          apiUrl = url;
          reachable = true;
          break;
        }
        reachable = false;
      }

      return {
        id: `live:${accountId}:${instance}`,
        accountId,
        instanceName: instance,
        apiUrl,
        deployedVersion: version,
        customDomain: wizardCustomDomain(apiDomain, collectDomain),
        reachable,
      };
    })
  );
}

/** Discover every Traks instance across the accounts a token can see. */
export async function discoverInstances(
  token: string,
  accounts: { id: string }[]
): Promise<DiscoveredInstance[]> {
  const perAccount = await Promise.allSettled(accounts.map(a => discoverInAccount(token, a.id)));
  return perAccount.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
}
