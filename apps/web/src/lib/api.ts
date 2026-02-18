import { hc } from 'hono/client';
import type { AppType } from '@traks/api';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5011';

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
  async getSites(token: string) {
    const res = await client.api.sites.$get({}, authHeaders(token));
    await assertOk(res);
    return res.json();
  },

  async createSite(data: { name: string; domain: string; timezone?: string }, token: string) {
    const res = await client.api.sites.$post({ json: data }, authHeaders(token));
    await assertOk(res);
    return res.json();
  },

  async getSite(siteId: string, token: string) {
    const res = await client.api.sites[':id'].$get(
      { param: { id: siteId } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async updateSite(siteId: string, data: { name: string; domain: string }, token: string) {
    const res = await client.api.sites[':id'].$patch(
      { param: { id: siteId }, json: data },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  // Analytics
  async getBatchStats(period: string, token: string, siteIds?: string[]) {
    const query: Record<string, string> = { period };
    if (siteIds && siteIds.length > 0) {
      query.siteIds = siteIds.join(',');
    }
    const res = await client.api.analytics.batch.stats.$get(
      { query },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async getAllStats(siteId: string, period: string, token: string) {
    const res = await client.api.analytics[':siteId'].stats.all.$get(
      { param: { siteId }, query: { period } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async getMainStats(siteId: string, period: string, token: string) {
    const res = await client.api.analytics[':siteId'].stats.main.$get(
      { param: { siteId }, query: { period } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async getTimeseries(siteId: string, period: string, token: string) {
    const res = await client.api.analytics[':siteId'].stats.timeseries.$get(
      { param: { siteId }, query: { period } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async getTopPages(siteId: string, period: string, token: string) {
    const res = await client.api.analytics[':siteId'].stats.pages.$get(
      { param: { siteId }, query: { period } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async getTopReferrers(siteId: string, period: string, token: string) {
    const res = await client.api.analytics[':siteId'].stats.referrers.$get(
      { param: { siteId }, query: { period } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async getLocations(siteId: string, period: string, type: string, token: string) {
    const res = await client.api.analytics[':siteId'].stats.locations.$get(
      { param: { siteId }, query: { period, type } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async getDevices(siteId: string, period: string, type: string, token: string) {
    const res = await client.api.analytics[':siteId'].stats.devices.$get(
      { param: { siteId }, query: { period, type } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async getRealtime(siteId: string, token: string) {
    const res = await client.api.analytics[':siteId'].stats.realtime.$get(
      { param: { siteId } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },

  async getEvents(siteId: string, period: string, token: string) {
    const res = await client.api.analytics[':siteId'].stats.events.$get(
      { param: { siteId }, query: { period } },
      authHeaders(token)
    );
    await assertOk(res);
    return res.json();
  },
};
