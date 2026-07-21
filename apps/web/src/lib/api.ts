import { hc } from 'hono/client';
import type { AppType } from '@traks/api';
import type { Period } from '@traks/shared';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5011';

/** Click-to-filter params, passed through to the analytics endpoints. */
export interface AnalyticsFilters {
  page?: string;
  source?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  country?: string;
  city?: string;
  browser?: string;
  os?: string;
  device?: string;
}

const client = hc<AppType>(API_URL);

function authHeaders(token: string): { headers: Record<string, string> } {
  return { headers: { Authorization: `Bearer ${token}` } };
}

async function assertOk(res: Response): Promise<void> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${text}`);
  }
}

export const api = {
  // Sites
  async getSites(token: string): Promise<any> {
    const res = await client.api.sites.$get({}, authHeaders(token));
    await assertOk(res);
    return res.json();
  },

  async createSite(
    data: { name: string; domain: string; timezone?: string },
    token: string
  ): Promise<any> {
    const res = await client.api.sites.$post({ json: data }, authHeaders(token));
    await assertOk(res);
    return res.json();
  },

  async getSite(siteId: string, token: string): Promise<any> {
    const res = await client.api.sites[':id'].$get({ param: { id: siteId } }, authHeaders(token));
    await assertOk(res);
    return res.json();
  },

  async updateSite(
    siteId: string,
    data: { name: string; domain: string; timezone?: string },
    token: string
  ): Promise<any> {
    const res = await client.api.sites[':id'].$patch(
      { param: { id: siteId }, json: data },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async setAllSitesTimezone(timezone: string, token: string): Promise<any> {
    const res = await client.api.sites.timezone.$post({ json: { timezone } }, authHeaders(token));
    await assertOk(res);
    return res.json();
  },

  async deleteSite(siteId: string, token: string): Promise<any> {
    const res = await client.api.sites[':id'].$delete(
      { param: { id: siteId } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async togglePublic(siteId: string, enabled: boolean, token: string): Promise<any> {
    const res = await client.api.sites[':id'].public.$post(
      { param: { id: siteId }, json: { enabled } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async toggleExport(siteId: string, enabled: boolean, token: string): Promise<any> {
    const res = await client.api.sites[':id'].export.$post(
      { param: { id: siteId }, json: { enabled } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  // Analytics
  async getBatchStats(period: Period, token: string, siteIds?: string[]): Promise<any> {
    const query: { period: Period; siteIds?: string } = { period };
    if (siteIds && siteIds.length > 0) {
      query.siteIds = siteIds.join(',');
    }
    const res = await client.api.analytics.batch.stats.$get({ query }, authHeaders(token));
    await assertOk(res);
    return res.json();
  },

  async getAllStats(siteId: string, period: Period, token: string): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.all.$get(
      { param: { siteId }, query: { period } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async getMainStats(
    siteId: string,
    period: Period,
    token: string,
    filters?: AnalyticsFilters
  ): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.main.$get(
      { param: { siteId }, query: { period, ...filters } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async getTimeseries(
    siteId: string,
    period: Period,
    token: string,
    filters?: AnalyticsFilters
  ): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.timeseries.$get(
      { param: { siteId }, query: { period, ...filters } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async getTopPages(
    siteId: string,
    period: Period,
    token: string,
    filters?: AnalyticsFilters
  ): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.pages.$get(
      { param: { siteId }, query: { period, ...filters } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async getTopReferrers(
    siteId: string,
    period: Period,
    token: string,
    filters?: AnalyticsFilters
  ): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.referrers.$get(
      { param: { siteId }, query: { period, ...filters } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async getUtm(
    siteId: string,
    period: Period,
    type: 'source' | 'medium' | 'campaign',
    token: string,
    filters?: AnalyticsFilters
  ): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.utm.$get(
      { param: { siteId }, query: { period, type, ...filters } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async getLocations(
    siteId: string,
    period: Period,
    type: 'country' | 'city',
    token: string,
    filters?: AnalyticsFilters
  ): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.locations.$get(
      { param: { siteId }, query: { period, type, ...filters } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async getDevices(
    siteId: string,
    period: Period,
    type: 'browser' | 'os' | 'device',
    token: string,
    filters?: AnalyticsFilters
  ): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.devices.$get(
      { param: { siteId }, query: { period, type, ...filters } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  // Account
  async getAccount(token: string): Promise<any> {
    const res = await client.api.account.me.$get({}, authHeaders(token));
    await assertOk(res);
    return res.json();
  },

  async setPreferences(
    prefs: { weeklyReport?: boolean; dailyReport?: boolean },
    token: string
  ): Promise<any> {
    const res = await client.api.account.preferences.$post({ json: prefs }, authHeaders(token));
    await assertOk(res);
    return res.json();
  },

  async getRealtime(siteId: string, token: string): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.realtime.$get(
      { param: { siteId } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async getEvents(
    siteId: string,
    period: Period,
    token: string,
    filters?: AnalyticsFilters
  ): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.events.$get(
      { param: { siteId }, query: { period, ...filters } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },
};
