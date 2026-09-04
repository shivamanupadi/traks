import { DurableObject } from 'cloudflare:workers';
import type { StepEvent } from './engine';

/**
 * The only state traks.dev keeps about a deploy: one Durable Object per wizard
 * session, alive for a day, then wiped by its own alarm. It exists so that a
 * refreshed tab can watch a run that is still going, and so that two tabs
 * cannot provision the same instance at once. It is never listed, never
 * aggregated, and holds no credentials.
 *
 * Two key spaces share this class:
 *   - `session:<id>`  progress replay for one wizard visit (status, steps,
 *                     the names it was bound to, the URLs it produced);
 *   - `lock:<account>/<instance>`  the run lock for one instance, so a second
 *                     tab (or a double click) gets a 409 instead of a race.
 * Both are removed by the alarm; nothing survives 24 hours.
 */
export interface SessionState {
  status: 'new' | 'deploying' | 'ready' | 'failed' | 'destroyed';
  /** Session id holding the lock (lock objects only). */
  owner?: string;
  accountId?: string;
  instanceName?: string;
  apiUrl?: string;
  collectUrl?: string;
  deployedVersion?: string;
  customDomain?: { zoneId: string; zoneName: string; subdomain: string } | null;
  steps?: StepEvent[];
  error?: string | null;
  /** Epoch ms of the last write; a 'deploying' state older than the stale
   *  window is a dead run and may be retaken. */
  updatedAt: number;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const KEY = 'state';

export class DeploySession extends DurableObject {
  async get(): Promise<SessionState | null> {
    return (await this.ctx.storage.get<SessionState>(KEY)) ?? null;
  }

  /** Merge a patch into the state and stamp it. First write arms the wipe. */
  async update(patch: Partial<SessionState>): Promise<SessionState> {
    const prev = (await this.get()) ?? { status: 'new' as const, updatedAt: 0 };
    const next: SessionState = { ...prev, ...patch, updatedAt: Date.now() };
    await this.ctx.storage.put(KEY, next);
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + TTL_MS);
    }
    return next;
  }

  /** Heartbeat for a live run: refreshes updatedAt without changing anything else. */
  async touch(): Promise<void> {
    const s = await this.get();
    if (s?.status === 'deploying') await this.update({});
  }

  /**
   * Lock objects: claim the run for `owner`. Refused while another live run
   * holds it; a run quieter than `staleMs` is dead and may be retaken.
   */
  async acquire(owner: string, staleMs: number): Promise<boolean> {
    const s = await this.get();
    if (s?.status === 'deploying' && s.owner !== owner && Date.now() - s.updatedAt < staleMs) {
      return false;
    }
    await this.update({ status: 'deploying', owner });
    return true;
  }

  /** Lock objects: hand the lock back (only the owner can). */
  async release(owner: string, status: SessionState['status']): Promise<void> {
    const s = await this.get();
    if (!s || s.owner === owner) await this.update({ status, owner: undefined });
  }

  /** A day after the first write, forget everything. */
  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
