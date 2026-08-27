import { useState, type ReactElement, type ReactNode } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, KeyRound, Loader2, LogOut, RefreshCw } from 'lucide-react';

export const Route = createFileRoute('/admin')({
  component: AdminPage,
});

/**
 * Operator-only registry stats, the UI over GET /api/admin/instances. Hidden
 * like the endpoint itself: nothing links here, and a wrong key looks exactly
 * like a 404. The key is sent as a Bearer header (never a query param) and
 * kept only in sessionStorage - closing the tab forgets it.
 */

interface AdminInstance {
  instanceName: string | null;
  apiUrl: string | null;
  collectUrl: string | null;
  version: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AdminFailure {
  instanceName: string | null;
  step: string | null;
  detail: string | null;
  error: string | null;
  updatedAt: string;
}

interface AdminStats {
  generatedAt: string;
  live: number;
  accounts: number;
  newLast7d: number;
  newLast30d: number;
  byStatus: Record<string, number>;
  byVersion: Record<string, number>;
  instances?: AdminInstance[];
  failed?: AdminFailure[];
}

const STORAGE_KEY = 'traks:admin-key';
const BAD_KEY = 'bad-key';

const readStoredKey = (): string => {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};

const storeKey = (key: string): void => {
  try {
    if (key) sessionStorage.setItem(STORAGE_KEY, key);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private-mode storage failures just mean re-entering the key next visit.
  }
};

async function fetchStats(key: string): Promise<AdminStats> {
  const res = await fetch('/api/admin/instances?detail=1', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (res.status === 404) throw new Error(BAD_KEY);
  if (!res.ok) throw new Error(`stats fetch failed (${res.status})`);
  return (await res.json()) as AdminStats;
}

/** Descending semver-ish sort; non-numeric versions ("unknown") sink last. */
const byVersionDesc = (a: string, b: string): number => {
  const parse = (v: string): number[] | null => {
    const parts = v.split('.').map(Number);
    return parts.length && parts.every(n => Number.isFinite(n)) ? parts : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return pa ? -1 : pb ? 1 : a.localeCompare(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

const ago = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 45) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

function AdminPage(): ReactElement {
  const [key, setKey] = useState(readStoredKey);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['admin-stats', key],
    queryFn: () => fetchStats(key),
    enabled: key.length > 0,
    staleTime: 30_000,
    retry: (count, err) => (err instanceof Error && err.message === BAD_KEY ? false : count < 2),
  });

  const badKey = query.error instanceof Error && query.error.message === BAD_KEY;

  const signIn = (entered: string): void => {
    storeKey(entered);
    setKey(entered);
  };
  const signOut = (): void => {
    storeKey('');
    setKey('');
    queryClient.removeQueries({ queryKey: ['admin-stats'] });
  };

  return (
    <div className="min-h-screen bg-[#F6F5F2] px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(61,59,79,0.06) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
          maskImage: 'linear-gradient(to bottom, black 0%, transparent 65%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 65%)',
        }}
      />
      <div className="relative mx-auto w-full max-w-[840px]">
        {!key || badKey || !query.data ? (
          <KeyGate
            onSubmit={signIn}
            checking={query.isLoading && key.length > 0}
            error={
              badKey
                ? 'That key was not accepted.'
                : query.error
                  ? 'Could not reach the server. Check your connection and try again.'
                  : undefined
            }
          />
        ) : (
          <Dashboard
            stats={query.data}
            refreshing={query.isFetching}
            onRefresh={() => void query.refetch()}
            onSignOut={signOut}
          />
        )}
      </div>
    </div>
  );
}

function KeyGate({
  onSubmit,
  checking,
  error,
}: {
  onSubmit: (key: string) => void;
  checking: boolean;
  error?: string;
}): ReactElement {
  const [entered, setEntered] = useState('');
  const submit = (): void => {
    const key = entered.trim();
    if (key) onSubmit(key);
  };
  return (
    <div className="mx-auto mt-[16vh] w-full max-w-[400px]">
      <div className="mb-6 flex flex-col items-center">
        <img src="/logo.svg" alt="Traks" className="h-9 w-9" />
        <h1 className="mt-3 text-[22px] font-bold tracking-[-0.02em] text-[#3D3B4F]">Operator</h1>
        <p className="mt-1 text-[13px] text-[#9B99A6]">Instance registry stats</p>
      </div>
      <div className="rounded-[20px] border border-[#E9E9EE] bg-white p-6 shadow-float">
        {error && (
          <p className="mb-4 rounded-xl bg-[#F7DCD4] px-4 py-3 text-[12.5px] leading-relaxed text-[#8F3B2C]">
            {error}
          </p>
        )}
        <label
          htmlFor="admin-key"
          className="mb-2 block text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#9B9590]"
        >
          Admin key
        </label>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#B5B0AA]" />
            <input
              id="admin-key"
              type="password"
              autoFocus
              autoComplete="off"
              value={entered}
              onChange={e => setEntered(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') submit();
              }}
              className="h-11 w-full rounded-full border border-transparent bg-[#F2F1ED] pl-10 pr-4 font-mono text-[13px] text-[#3D3B4F] outline-none transition-shadow placeholder:text-[#B5B0AA] focus:ring-2 focus:ring-[#3D3B4F]/20"
              placeholder="••••••••••••"
            />
          </div>
          <button
            onClick={submit}
            disabled={!entered.trim() || checking}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-[#3D3B4F] px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#2C2B3B] disabled:pointer-events-none disabled:opacity-40 cursor-pointer"
          >
            {checking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Dashboard({
  stats,
  refreshing,
  onRefresh,
  onSignOut,
}: {
  stats: AdminStats;
  refreshing: boolean;
  onRefresh: () => void;
  onSignOut: () => void;
}): ReactElement {
  const versions = Object.entries(stats.byVersion).sort(([a], [b]) => byVersionDesc(a, b));
  const latest = versions.find(([v]) => v !== 'unknown')?.[0];
  const maxVersionCount = Math.max(1, ...versions.map(([, n]) => n));
  const instances = stats.instances ?? [];
  const failed = stats.failed ?? [];

  return (
    <>
      <div className="mb-7 flex items-end justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <a
            href="/"
            aria-label="Back to traks.dev"
            className="transition-transform hover:scale-105"
          >
            <img src="/logo.svg" alt="Traks" className="h-9 w-9" />
          </a>
          <div>
            <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#3D3B4F]">Instances</h1>
            <p className="text-[12.5px] text-[#9B99A6]">
              Deploy registry · updated {ago(stats.generatedAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <FlatButton onClick={onRefresh} label="Refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </FlatButton>
          <FlatButton onClick={onSignOut} label="Forget key">
            <LogOut className="h-3.5 w-3.5" />
          </FlatButton>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Live instances" value={stats.live} accent />
        <StatTile label="Accounts" value={stats.accounts} />
        <StatTile label="New · 7 days" value={stats.newLast7d} />
        <StatTile label="New · 30 days" value={stats.newLast30d} />
      </div>

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <Panel title="By version">
          {versions.length === 0 ? (
            <Empty>No live instances yet.</Empty>
          ) : (
            <ul className="space-y-1">
              {versions.map(([version, n]) => (
                <li
                  key={version}
                  className="relative flex h-9 items-center justify-between overflow-hidden rounded-lg px-3 transition-colors hover:bg-[#E6E4DE]/60"
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 rounded-lg bg-[#F2F1ED]"
                    style={{ width: `${(n / maxVersionCount) * 100}%` }}
                  />
                  <span className="relative flex items-center gap-2 font-mono text-[12.5px] text-[#3D3B4F]">
                    {version === 'unknown' ? 'unknown' : `v${version}`}
                    {version === latest && (
                      <span className="rounded-full bg-mint/25 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-[#1B7A55]">
                        latest
                      </span>
                    )}
                  </span>
                  <span className="relative text-[12.5px] font-semibold tabular-nums text-[#3D3B4F]">
                    {n}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Registry by status">
          <ul className="space-y-1">
            {Object.entries(stats.byStatus)
              .sort(([, a], [, b]) => b - a)
              .map(([status, n]) => (
                <li
                  key={status}
                  className="flex h-9 items-center justify-between rounded-lg px-3 transition-colors hover:bg-[#E6E4DE]/60"
                >
                  <span className="flex items-center gap-2 text-[12.5px] text-[#3D3B4F]">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status] ?? 'bg-[#B5B0AA]'}`}
                    />
                    {STATUS_LABEL[status] ?? status}
                  </span>
                  <span className="text-[12.5px] font-semibold tabular-nums text-[#3D3B4F]">
                    {n}
                  </span>
                </li>
              ))}
          </ul>
          <p className="mt-3 text-[11.5px] leading-relaxed text-[#9B9590]">
            Every wizard session ever recorded; abandoned sessions sweep out nightly.
          </p>
        </Panel>
      </div>

      <Panel title={`Live instances (${instances.length})`} className="mb-4">
        {instances.length === 0 ? (
          <Empty>No live instances yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#9B9590]">
                  <th className="py-2 pl-3 pr-4 font-semibold">Instance</th>
                  <th className="py-2 pr-4 font-semibold">Version</th>
                  <th className="py-2 pr-4 font-semibold">Dashboard</th>
                  <th className="py-2 pr-3 text-right font-semibold">Deployed</th>
                </tr>
              </thead>
              <tbody>
                {instances.map((inst, i) => (
                  <tr
                    key={`${inst.instanceName ?? 'unnamed'}-${i}`}
                    className="border-t border-[#EEEEF2] transition-colors hover:bg-[#F2F1ED]"
                  >
                    <td className="py-2.5 pl-3 pr-4 font-mono text-[#3D3B4F]">
                      {inst.instanceName ?? '—'}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span
                        className={`font-mono tabular-nums ${
                          inst.version === latest ? 'text-[#3D3B4F]' : 'text-[#9B9590]'
                        }`}
                      >
                        {inst.version ? `v${inst.version}` : '—'}
                      </span>
                    </td>
                    <td className="max-w-[240px] truncate py-2.5 pr-4">
                      {inst.apiUrl ? (
                        <a
                          href={inst.apiUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#6E6C7C] underline-offset-2 hover:text-[#3D3B4F] hover:underline"
                        >
                          {inst.apiUrl.replace('https://', '')}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-right tabular-nums text-[#9B9590]">
                      {ago(inst.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {failed.length > 0 && (
        <Panel title={`Failed deploys (${failed.length})`}>
          <ul className="space-y-2">
            {failed.map((f, i) => (
              <li
                key={`${f.instanceName ?? 'unnamed'}-${i}`}
                className="rounded-xl bg-[#F2F1ED] px-3.5 py-2.5"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[12.5px] text-[#3D3B4F]">
                    {f.instanceName ?? '(no name yet)'}
                  </span>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-[#9B9590]">
                    {ago(f.updatedAt)}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-[#6E6C7C]">
                  {f.step && <span className="font-semibold">{f.step}: </span>}
                  {f.detail ?? f.error ?? 'No detail recorded.'}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

const STATUS_LABEL: Record<string, string> = {
  ready: 'Ready',
  failed: 'Failed',
  destroyed: 'Destroyed',
  new: 'In progress / abandoned',
  deploying: 'Deploying',
};

const STATUS_DOT: Record<string, string> = {
  ready: 'bg-mint',
  failed: 'bg-coral',
  destroyed: 'bg-[#B5B0AA]',
  new: 'bg-[#D4A574]',
  deploying: 'bg-[#6B8EAD]',
};

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}): ReactElement {
  return (
    <div className="rounded-2xl bg-[#F2F1ED] px-4 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#9B9590]">
        {label}
      </p>
      <p className="mt-1 flex items-center gap-2 text-[26px] font-bold tabular-nums tracking-[-0.02em] text-[#3D3B4F]">
        {value}
        {accent && value > 0 && <span className="h-2 w-2 rounded-full bg-mint" />}
      </p>
    </div>
  );
}

function Panel({
  title,
  children,
  className = '',
}: {
  title: string;
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div
      className={`rounded-[20px] border border-[#E9E9EE] bg-white p-5 shadow-float ${className}`}
    >
      <h2 className="mb-3 text-[13.5px] font-bold text-[#3D3B4F]">{title}</h2>
      {children}
    </div>
  );
}

function FlatButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-transparent px-3.5 text-[12.5px] font-semibold text-[#6E6C7C] transition-colors hover:border-[#E6E4DE] hover:bg-[#F2F1ED] hover:text-[#3D3B4F] cursor-pointer"
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: ReactNode }): ReactElement {
  return <p className="py-2 text-[12.5px] text-[#9B9590]">{children}</p>;
}
