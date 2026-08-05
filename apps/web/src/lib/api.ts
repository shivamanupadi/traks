import { hc } from 'hono/client';
import type { AppType } from '@traks/api';
import type { Period } from '@traks/shared';

/** Click-to-filter params, passed through to the analytics endpoints. */
export interface AnalyticsFilters {
  page?: string;
  source?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  country?: string;
  region?: string;
  city?: string;
  browser?: string;
  os?: string;
  device?: string;
}

// Same-origin: /api/* is served by the API worker via a zone route in prod
// and the vite proxy in dev, so the Access cookie is attached automatically.
const client = hc<AppType>('');

async function assertOk(res: Response): Promise<void> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = `API error ${res.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed?.error) message = parsed.error;
    } catch {
      if (text) message = `${message}: ${text}`;
    }
    throw new Error(message);
  }
}

export const api = {
  // Current user
  async getMe(): Promise<any> {
    const res = await client.api.me.$get();
    await assertOk(res);
    return res.json();
  },

  // Sites
  async getSites(): Promise<any> {
    const res = await client.api.sites.$get();
    await assertOk(res);
    return res.json();
  },

  async createSite(data: { name: string; domain: string; timezone?: string }): Promise<any> {
    const res = await client.api.sites.$post({ json: data });
    await assertOk(res);
    return res.json();
  },

  async getSite(siteId: string): Promise<any> {
    const res = await client.api.sites[':id'].$get({ param: { id: siteId } });
    await assertOk(res);
    return res.json();
  },

  async updateSite(
    siteId: string,
    data: { name: string; domain: string; timezone?: string }
  ): Promise<any> {
    const res = await client.api.sites[':id'].$patch({ param: { id: siteId }, json: data });
    await assertOk(res);
    return res.json();
  },

  async setAllSitesTimezone(timezone: string): Promise<any> {
    const res = await client.api.sites.timezone.$post({ json: { timezone } });
    await assertOk(res);
    return res.json();
  },

  async deleteSite(siteId: string): Promise<any> {
    const res = await client.api.sites[':id'].$delete({ param: { id: siteId } });
    await assertOk(res);
    return res.json();
  },

  // Goals
  async getGoals(siteId: string): Promise<any> {
    const res = await client.api.sites[':id'].goals.$get({ param: { id: siteId } });
    await assertOk(res);
    return res.json();
  },

  async createGoal(
    siteId: string,
    data: { name: string; type: 'event' | 'page'; target: string }
  ): Promise<any> {
    const res = await client.api.sites[':id'].goals.$post({ param: { id: siteId }, json: data });
    await assertOk(res);
    return res.json();
  },

  async deleteGoal(siteId: string, goalId: string): Promise<any> {
    const res = await client.api.sites[':id'].goals[':goalId'].$delete({
      param: { id: siteId, goalId },
    });
    await assertOk(res);
    return res.json();
  },

  async getSegments(siteId: string): Promise<any> {
    const res = await client.api.sites[':id'].segments.$get({ param: { id: siteId } });
    await assertOk(res);
    return res.json();
  },

  async createSegment(
    siteId: string,
    data: { name: string; filters: Record<string, string> }
  ): Promise<any> {
    const res = await client.api.sites[':id'].segments.$post({
      param: { id: siteId },
      json: data,
    });
    await assertOk(res);
    return res.json();
  },

  async deleteSegment(siteId: string, segmentId: string): Promise<any> {
    const res = await client.api.sites[':id'].segments[':segmentId'].$delete({
      param: { id: siteId, segmentId },
    });
    await assertOk(res);
    return res.json();
  },

  async getFunnels(siteId: string): Promise<any> {
    const res = await client.api.sites[':id'].funnels.$get({ param: { id: siteId } });
    await assertOk(res);
    return res.json();
  },

  async createFunnel(
    siteId: string,
    data: { name: string; steps: { type: 'event' | 'page'; target: string }[] }
  ): Promise<any> {
    const res = await client.api.sites[':id'].funnels.$post({ param: { id: siteId }, json: data });
    await assertOk(res);
    return res.json();
  },

  async deleteFunnel(siteId: string, funnelId: string): Promise<any> {
    const res = await client.api.sites[':id'].funnels[':funnelId'].$delete({
      param: { id: siteId, funnelId },
    });
    await assertOk(res);
    return res.json();
  },

  async getFunnelStats(
    siteId: string,
    funnelId: string,
    period: Period,
    filters?: AnalyticsFilters
  ): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.funnel[':funnelId'].$get({
      param: { siteId, funnelId },
      query: { period, ...filters },
    });
    await assertOk(res);
    return res.json();
  },

  async getGoalStats(siteId: string, period: Period, filters?: AnalyticsFilters): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.goals.$get({
      param: { siteId },
      query: { period, ...filters },
    });
    await assertOk(res);
    return res.json();
  },

  // Analytics
  async getBatchStats(period: Period, siteIds?: string[]): Promise<any> {
    const query: { period: Period; siteIds?: string } = { period };
    if (siteIds && siteIds.length > 0) {
      query.siteIds = siteIds.join(',');
    }
    const res = await client.api.analytics.batch.stats.$get({ query });
    await assertOk(res);
    return res.json();
  },

  async getAllStats(siteId: string, period: Period): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.all.$get({
      param: { siteId },
      query: { period },
    });
    await assertOk(res);
    return res.json();
  },

  async getMainStats(siteId: string, period: Period, filters?: AnalyticsFilters): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.main.$get({
      param: { siteId },
      query: { period, ...filters },
    });
    await assertOk(res);
    return res.json();
  },

  async getTimeseries(siteId: string, period: Period, filters?: AnalyticsFilters): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.timeseries.$get({
      param: { siteId },
      query: { period, ...filters },
    });
    await assertOk(res);
    return res.json();
  },

  async getTopPages(
    siteId: string,
    period: Period,
    type: 'top' | 'entry' | 'exit',
    filters?: AnalyticsFilters
  ): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.pages.$get({
      param: { siteId },
      query: { period, type, ...filters },
    });
    await assertOk(res);
    return res.json();
  },

  async getLinks(
    siteId: string,
    period: Period,
    type: 'outbound' | 'download',
    filters?: AnalyticsFilters
  ): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.links.$get({
      param: { siteId },
      query: { period, type, ...filters },
    });
    await assertOk(res);
    return res.json();
  },

  async getTopReferrers(siteId: string, period: Period, filters?: AnalyticsFilters): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.referrers.$get({
      param: { siteId },
      query: { period, ...filters },
    });
    await assertOk(res);
    return res.json();
  },

  async getUtm(
    siteId: string,
    period: Period,
    type: 'source' | 'medium' | 'campaign',
    filters?: AnalyticsFilters
  ): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.utm.$get({
      param: { siteId },
      query: { period, type, ...filters },
    });
    await assertOk(res);
    return res.json();
  },

  async getLocations(
    siteId: string,
    period: Period,
    type: 'country' | 'region' | 'city',
    filters?: AnalyticsFilters
  ): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.locations.$get({
      param: { siteId },
      query: { period, type, ...filters },
    });
    await assertOk(res);
    return res.json();
  },

  async getDevices(
    siteId: string,
    period: Period,
    type: 'browser' | 'os' | 'device' | 'size',
    filters?: AnalyticsFilters
  ): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.devices.$get({
      param: { siteId },
      query: { period, type, ...filters },
    });
    await assertOk(res);
    return res.json();
  },

  async getRealtime(siteId: string): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.realtime.$get({ param: { siteId } });
    await assertOk(res);
    return res.json();
  },

  async getEvents(siteId: string, period: Period, filters?: AnalyticsFilters): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats.events.$get({
      param: { siteId },
      query: { period, ...filters },
    });
    await assertOk(res);
    return res.json();
  },

  async getEventProps(
    siteId: string,
    period: Period,
    event: string,
    filters?: AnalyticsFilters
  ): Promise<any> {
    const res = await client.api.analytics[':siteId'].stats['event-props'].$get({
      param: { siteId },
      query: { period, event, ...filters },
    });
    await assertOk(res);
    return res.json();
  },
};
