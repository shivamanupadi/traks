/**
 * Shared pieces of the three wizard flows - /deploy (install), /update, and
 * /destroy. Each flow is its own route with its own URL and screens; what
 * lives here is the design system (cards, buttons, token fields, step list),
 * the wizard session/connect logic, and the SSE plumbing they all share.
 */
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { ArrowLeft, Check, ExternalLink, Loader2, XCircle } from 'lucide-react';

/* ── pre-filled Cloudflare token URLs (keys mined from permission labels) ── */

const tokenUrl = (name: string, keys: { key: string; type: string }[], accountId = '*'): string =>
  `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(
    JSON.stringify(keys)
  )}&name=${encodeURIComponent(name)}&accountId=${accountId}`;

export const INSTALLER_TOKEN_URL = tokenUrl('Traks Installer', [
  { key: 'workers_scripts', type: 'edit' },
  { key: 'd1', type: 'edit' },
  { key: 'workers_kv_storage', type: 'edit' },
  { key: 'pipelines', type: 'edit' },
  { key: 'workers_r2', type: 'edit' },
  { key: 'r2_catalog', type: 'edit' },
  { key: 'account_settings', type: 'read' },
  { key: 'zone', type: 'read' },
  { key: 'workers_routes', type: 'edit' },
  { key: 'user_details', type: 'read' },
]);

// Once the account is known (OAuth sign-in or installer-token verify), the
// link pre-selects it under Account Resources instead of "All accounts".
export const catalogTokenUrl = (accountId?: string): string =>
  tokenUrl(
    'Traks Catalog Token',
    [
      { key: 'workers_r2', type: 'edit' },
      { key: 'r2_catalog', type: 'edit' },
      { key: 'r2_catalog_sql', type: 'read' },
    ],
    accountId || '*'
  );

/* ── types ──────────────────────────────────────────────────── */

export type Flow = 'deploy' | 'update' | 'destroy';

export interface StepEvent {
  stepId: string;
  label: string;
  status: 'start' | 'ok' | 'fail' | 'retry';
  detail?: string;
}

export interface Account {
  id: string;
  name: string;
}

/** A ready instance the verified account already runs (from the registry). */
export interface ExistingInstall {
  id: string;
  accountId: string | null;
  instanceName: string | null;
  apiUrl: string | null;
  deployedVersion: string | null;
  customDomain: { zoneId: string; zoneName: string; subdomain: string } | null;
}

export interface InstanceRow {
  status: string;
  apiUrl?: string;
  collectUrl?: string;
  instanceName?: string;
  steps?: StepEvent[];
  error?: string;
  updatedAt?: string;
  deployedVersion?: string;
  customDomain?: { zoneId: string; zoneName: string; subdomain: string } | null;
}

/** A run that hasn't touched its row for this long is considered dead. A live
 *  run heartbeats updated_at every ~20 s (even while the smoke test waits on
 *  DNS + certificates), so three quiet minutes means the worker is gone.
 *  Mirrors RUN_STALE_MS in the API. */
export const RUN_STALE_MS = 3 * 60_000;

export const runIsFresh = (row: InstanceRow): boolean =>
  Boolean(row.updatedAt) && Date.now() - new Date(row.updatedAt!).getTime() < RUN_STALE_MS;

/** Keep one row per stepId, latest status wins (streams re-emit on retry). */
export function collapse(events: StepEvent[]): StepEvent[] {
  const map = new Map<string, StepEvent>();
  for (const e of events) map.set(e.stepId, e);
  return [...map.values()];
}

/** Read an SSE response body, invoking onEvent per parsed `data:` payload. */
export async function readSse<T>(res: Response, onEvent: (payload: T) => void): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const raw of events) {
      const line = raw.trim();
      if (!line.startsWith('data: ')) continue;
      onEvent(JSON.parse(line.slice(6)) as T);
    }
  }
}

/** Create a fresh wizard session row; returns its id. */
export async function createSession(): Promise<string> {
  const res = await fetch('/api/deploy/instance', { method: 'POST' });
  if (!res.ok) throw new Error(`could not start a session (${res.status})`);
  const { data } = (await res.json()) as { data: { id: string } };
  return data.id;
}

/* ── shared UI bits (ink + mint design system) ──────────────── */

export function WizardShell({
  title,
  subtitle,
  progress,
  children,
}: {
  title: string;
  subtitle: string;
  progress: { current: number; total: number };
  children: ReactNode;
}): ReactElement {
  return (
    <div className="min-h-screen bg-[#F6F5F2] px-4 py-10">
      {/* dot grid */}
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
      <div className="relative">
        <div className="mb-7 flex flex-col items-center">
          <a
            href="/"
            aria-label="Back to traks.dev"
            className="transition-transform hover:scale-105"
          >
            <img src="/logo.svg" alt="Traks" className="h-9 w-9" />
          </a>
          <h1 className="mt-3 text-[26px] font-bold tracking-[-0.02em] text-[#3D3B4F]">{title}</h1>
          <p className="mt-1 text-[13.5px] text-[#9B99A6]">{subtitle}</p>
        </div>
        <div className="mb-8 flex items-center justify-center gap-2">
          {Array.from({ length: progress.total }, (_, i) => (
            <span
              key={i}
              className={`h-[4px] rounded-full transition-all duration-300 ${
                i === progress.current
                  ? 'w-10 bg-mint'
                  : i < progress.current
                    ? 'w-5 bg-[#3D3B4F]/40'
                    : 'w-5 bg-[#E6E4DE]'
              }`}
            />
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Card({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}): ReactElement {
  return (
    <div className="mx-auto w-full max-w-[560px] rounded-[20px] border border-[#E9E9EE] bg-white shadow-float">
      <div className="p-7">{children}</div>
      {footer && (
        <div className="flex items-center justify-end gap-3 border-t border-[#EEEEF2] px-7 py-4">
          {footer}
        </div>
      )}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  busy,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}): ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className="inline-flex h-11 items-center gap-2 rounded-full bg-[#3D3B4F] px-6 text-[13.5px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-[#2C2B3B] hover:shadow-md disabled:pointer-events-none disabled:opacity-40 cursor-pointer"
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function DangerButton({
  children,
  onClick,
  disabled,
  busy,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}): ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className="inline-flex h-11 items-center gap-2 rounded-full bg-[#B3402F] px-6 text-[13.5px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-[#96331F] hover:shadow-md disabled:pointer-events-none disabled:opacity-40 cursor-pointer"
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function BackButton({
  onClick,
  disabled,
  label = 'Back',
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}): ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="mr-auto inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-semibold text-[#6E6C7C] transition-colors hover:bg-[#F2F1ED] hover:text-[#3D3B4F] disabled:pointer-events-none disabled:opacity-40 cursor-pointer"
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </button>
  );
}

export function ErrorBox({ children }: { children: ReactNode }): ReactElement {
  return (
    <p className="mb-4 rounded-xl bg-[#F7DCD4] px-4 py-3 text-[12.5px] leading-relaxed text-[#8F3B2C]">
      {children}
    </p>
  );
}

export function NoteBox({ children }: { children: ReactNode }): ReactElement {
  return (
    <p className="mb-4 rounded-xl bg-[#F2F1ED] px-4 py-3 text-[12.5px] leading-relaxed text-[#6E6C7C]">
      {children}
    </p>
  );
}

export function TokenField({
  id,
  label,
  help,
  linkLabel,
  linkUrl,
  value,
  onChange,
  status,
  statusDetail,
  errorHelp,
}: {
  id: string;
  label: string;
  help: string;
  linkLabel: string;
  linkUrl: string;
  value: string;
  onChange: (v: string) => void;
  status?: 'checking' | 'ok' | 'bad';
  statusDetail?: string;
  errorHelp?: string;
}): ReactElement {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[12.5px] font-semibold text-[#3D3B4F]">
        {label}
      </label>
      <input
        id={id}
        type="password"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Paste the token here"
        autoComplete="off"
        className="h-11 w-full rounded-2xl border-none bg-white px-4 text-[13.5px] text-[#3D3B4F] shadow-[inset_0_0_0_1px_#E5E5EB] transition-shadow placeholder:text-[#B3B1BE] focus:shadow-[inset_0_0_0_1.5px_#3D3B4F] focus:outline-none"
      />
      <div className="mt-1.5 flex items-start justify-between gap-3">
        <p className="text-[11.5px] leading-relaxed text-[#9B99A6]">
          {status === 'checking' ? (
            <span className="inline-flex items-center gap-1.5 text-[#6E6C7C]">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking…
            </span>
          ) : status === 'ok' ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-[#3D3B4F]">
              <Check className="h-3 w-3" /> {statusDetail ?? 'Looks good'}
            </span>
          ) : status === 'bad' ? (
            <span className="text-[#B3402F]">
              {statusDetail ?? 'Token check failed'}
              {errorHelp && <span className="mt-0.5 block text-[#9B99A6]">{errorHelp}</span>}
            </span>
          ) : (
            help
          )}
        </p>
        <a
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-semibold text-[#3D3B4F] underline-offset-2 hover:underline"
        >
          {linkLabel}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

/** Streaming step list shared by the deploying/destroying screens. */
export function StepList({
  steps,
  startingLabel,
  showStarting = true,
}: {
  steps: StepEvent[];
  startingLabel: string;
  showStarting?: boolean;
}): ReactElement {
  return (
    <div className="space-y-1">
      {steps.length === 0 && showStarting && (
        <p className="flex items-center gap-2 py-1.5 text-[13px] text-[#9B99A6]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {startingLabel}
        </p>
      )}
      {steps.map(s => (
        <div key={s.stepId} className="flex items-start gap-2.5 py-1.5">
          {s.status === 'ok' ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#3D3B4F]" strokeWidth={2.2} />
          ) : s.status === 'fail' ? (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#B3402F]" />
          ) : (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[#9B99A6]" />
          )}
          <div className="min-w-0">
            <p
              className={`text-[13px] ${
                s.status === 'fail'
                  ? 'font-medium text-[#B3402F]'
                  : s.status === 'ok'
                    ? 'text-[#3D3B4F]'
                    : 'text-[#6E6C7C]'
              }`}
            >
              {s.label}
              {s.status === 'retry' && (
                <span className="ml-2 rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10.5px] font-semibold text-[#6E6C7C]">
                  retrying
                </span>
              )}
            </p>
            {s.detail && s.status !== 'ok' && (
              <p className="mt-0.5 break-words text-[11.5px] leading-relaxed text-[#9B99A6]">
                {s.detail}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── connect logic shared by every flow ─────────────────────── */

export interface Connect {
  oauthEnabled: boolean;
  oauthSignedIn: boolean;
  cfEmail: string;
  installerToken: string;
  setInstallerToken: (v: string) => void;
  installerStatus: 'checking' | 'ok' | 'bad' | undefined;
  setInstallerStatus: (v: 'checking' | 'ok' | 'bad' | undefined) => void;
  installerDetail: string | undefined;
  accounts: Account[];
  accountId: string;
  setAccountId: (v: string) => void;
  existingInstalls: ExistingInstall[];
  setExistingInstalls: (
    updater: ExistingInstall[] | ((prev: ExistingInstall[]) => ExistingInstall[])
  ) => void;
  signInWithCloudflare: () => void;
  oauthError: string;
}

/**
 * Account connection: "Sign in with Cloudflare" (flow-aware return URL) or a
 * pasted installer token, auto-verified into accounts + existing installs.
 */
export function useConnect(flow: Flow, sessionId: string | undefined): Connect {
  const [oauthEnabled, setOauthEnabled] = useState(false);
  const [oauthSignedIn, setOauthSignedIn] = useState(false);
  const [cfEmail, setCfEmail] = useState('');
  const [installerToken, setInstallerToken] = useState('');
  const [installerStatus, setInstallerStatus] = useState<'checking' | 'ok' | 'bad' | undefined>();
  const [installerDetail, setInstallerDetail] = useState<string | undefined>();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [existingInstalls, setExistingInstalls] = useState<ExistingInstall[]>([]);
  const [oauthError, setOauthError] = useState('');

  // Instance capabilities (is "Sign in with Cloudflare" configured?).
  useEffect(() => {
    void fetch('/api/config')
      .then(r => r.json() as Promise<{ oauthEnabled?: boolean }>)
      .then(cfg => setOauthEnabled(Boolean(cfg.oauthEnabled)))
      .catch(() => undefined);
  }, []);

  const checkInstaller = async (token: string, session = sessionId): Promise<void> => {
    if (token.trim().length < 20) return;
    setInstallerStatus('checking');
    try {
      const res = await fetch(`/api/deploy/instance/${session}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiToken: token.trim() }),
      });
      const body = (await res.json()) as {
        data?: Account[];
        email?: string;
        installs?: ExistingInstall[];
        error?: string;
      };
      if (res.ok && body.data) {
        setAccounts(body.data);
        setAccountId(prev => (body.data!.some(a => a.id === prev) ? prev : body.data![0].id));
        setExistingInstalls(body.installs ?? []);
        if (body.email) setCfEmail(body.email);
        setInstallerStatus('ok');
        setInstallerDetail(
          body.data.length === 1
            ? `Account: ${body.data[0].name}`
            : `${body.data.length} accounts available`
        );
      } else {
        setInstallerStatus('bad');
        setInstallerDetail(body.error ?? 'Token check failed');
      }
    } catch {
      setInstallerStatus('bad');
      setInstallerDetail('Could not reach the server. Check your connection and try again.');
    }
  };

  // Returning from the Cloudflare consent screen: the access token arrives in
  // the URL fragment (never sent to our server); an aborted sign-in arrives as
  // ?oauth_error=. Either way, scrub the URL immediately.
  useEffect(() => {
    if (!sessionId) return;
    const hashToken = new URLSearchParams(window.location.hash.slice(1)).get('cf_token');
    const err = new URLSearchParams(window.location.search).get('oauth_error');
    if (!hashToken && !err) return;
    window.history.replaceState(null, '', `/${flow}?instance=${encodeURIComponent(sessionId)}`);
    if (hashToken) {
      setInstallerToken(hashToken);
      setOauthSignedIn(true);
      void checkInstaller(hashToken, sessionId);
    } else {
      setOauthError(
        err === 'access_denied'
          ? 'Cloudflare sign-in was cancelled. Try again, or paste a token instead.'
          : 'Cloudflare sign-in failed. Try again, or paste a token instead.'
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Auto-verify a pasted token shortly after typing stops - no extra clicks.
  useEffect(() => {
    if (oauthSignedIn || installerStatus !== undefined || installerToken.trim().length < 20) {
      return;
    }
    const t = window.setTimeout(() => void checkInstaller(installerToken), 600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installerToken, installerStatus, oauthSignedIn]);

  return {
    oauthEnabled,
    oauthSignedIn,
    cfEmail,
    installerToken,
    setInstallerToken,
    installerStatus,
    setInstallerStatus,
    installerDetail,
    accounts,
    accountId,
    setAccountId,
    existingInstalls,
    setExistingInstalls,
    signInWithCloudflare: () => {
      window.location.href = `/api/deploy/oauth/start?instance=${encodeURIComponent(
        sessionId ?? ''
      )}&flow=${flow}`;
    },
    oauthError,
  };
}

/** Shared connect screen body: sign-in button / signed-in chip / token field
 *  + account picker. Flow screens compose this inside their own Card. */
export function ConnectSection({
  connect,
  onAccountChange,
  compactToken = false,
}: {
  connect: Connect;
  onAccountChange?: (accountId: string) => void;
  /** Hide the installer-token field behind a "use a token instead" link
   *  while "Sign in with Cloudflare" is available, so the card leads with
   *  one action. */
  compactToken?: boolean;
}): ReactElement {
  const c = connect;
  const [tokenOpen, setTokenOpen] = useState(false);
  const showToken =
    !c.oauthSignedIn && (!compactToken || !c.oauthEnabled || tokenOpen || c.installerToken !== '');
  return (
    <div className="space-y-5">
      {c.oauthSignedIn ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#EEEEF2] bg-[#F6F5F2] px-4 py-3.5">
          <p className="flex items-center gap-2.5 text-[13px] font-semibold text-[#3D3B4F]">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-mint/15">
              <Check className="h-4 w-4 text-[#0E9F6E]" strokeWidth={2.4} />
            </span>
            {c.cfEmail ? `Signed in as ${c.cfEmail}` : 'Signed in with Cloudflare'}
          </p>
          <p className="text-[11.5px] text-[#9B99A6]">
            {c.installerStatus === 'checking' ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Checking access…
              </span>
            ) : c.installerStatus === 'ok' ? (
              c.installerDetail
            ) : c.installerStatus === 'bad' ? (
              <span className="text-[#B3402F]">{c.installerDetail}</span>
            ) : null}
          </p>
        </div>
      ) : c.oauthEnabled ? (
        <div>
          <button
            onClick={c.signInWithCloudflare}
            className="flex h-12 w-full items-center justify-center gap-2.5 rounded-2xl bg-[#3D3B4F] text-[14px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-[#2C2B3B] hover:shadow-md cursor-pointer"
          >
            <CloudGlyph />
            Sign in with Cloudflare
          </button>
          {compactToken && !showToken ? (
            <p className="mt-2 text-center text-[11.5px] text-[#9B99A6]">
              Approve once on Cloudflare&rsquo;s consent screen and you&rsquo;re back here.{' '}
              <button
                onClick={() => setTokenOpen(true)}
                className="font-semibold text-[#3D3B4F] underline-offset-2 hover:underline cursor-pointer"
              >
                Use a token instead
              </button>
            </p>
          ) : (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[#9B99A6]">
              Opens Cloudflare&rsquo;s consent screen listing every permission. Approve once and
              you&rsquo;re back here. Prefer not to?{' '}
              <a
                href={INSTALLER_TOKEN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-[#3D3B4F] underline-offset-2 hover:underline"
              >
                Create a token manually
              </a>{' '}
              and paste it below instead.
            </p>
          )}
        </div>
      ) : null}
      {showToken && (
        <TokenField
          id="installer-token"
          label="Installer token"
          help="Lets Traks act on the Workers, database, KV, and pipeline in your account."
          linkLabel="Create installer token (pre-filled)"
          linkUrl={INSTALLER_TOKEN_URL}
          value={c.installerToken}
          onChange={v => {
            c.setInstallerToken(v);
            c.setInstallerStatus(undefined);
          }}
          status={c.installerStatus}
          statusDetail={c.installerDetail}
          errorHelp="Recreate it with the pre-filled link. Keep all pre-selected permissions, click “Continue to summary”, then “Create Token”, and copy the full value."
        />
      )}
      {c.accounts.length > 1 && (
        <div>
          <label
            htmlFor="wizard-account"
            className="mb-1.5 block text-[12.5px] font-semibold text-[#3D3B4F]"
          >
            Cloudflare account
          </label>
          <select
            id="wizard-account"
            value={c.accountId}
            onChange={e => {
              c.setAccountId(e.target.value);
              onAccountChange?.(e.target.value);
            }}
            className="h-11 w-full cursor-pointer rounded-2xl border-none bg-white px-4 text-[13.5px] text-[#3D3B4F] shadow-[inset_0_0_0_1px_#E5E5EB] focus:shadow-[inset_0_0_0_1.5px_#3D3B4F] focus:outline-none"
          >
            {c.accounts.map(a => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function CloudGlyph(): ReactElement {
  // lucide Cloud, inlined to keep this module's imports minimal.
  return (
    <svg
      className="h-[18px] w-[18px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </svg>
  );
}
