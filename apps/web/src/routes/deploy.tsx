import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Cloud,
  ExternalLink,
  KeyRound,
  Loader2,
  RotateCw,
  Server,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';

export const Route = createFileRoute('/deploy')({
  component: DeployWizard,
  validateSearch: (search: Record<string, unknown>): { instance?: string } => ({
    instance: typeof search.instance === 'string' ? search.instance : undefined,
  }),
});

/* ── pre-filled Cloudflare token URLs (keys mined from permission labels) ── */

const tokenUrl = (name: string, keys: { key: string; type: string }[]): string =>
  `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(
    JSON.stringify(keys)
  )}&name=${encodeURIComponent(name)}&accountId=*`;

const INSTALLER_TOKEN_URL = tokenUrl('Traks Installer', [
  { key: 'workers_scripts', type: 'edit' },
  { key: 'd1', type: 'edit' },
  { key: 'workers_kv_storage', type: 'edit' },
  { key: 'pipelines', type: 'edit' },
  { key: 'workers_r2', type: 'edit' },
  { key: 'r2_catalog', type: 'edit' },
  { key: 'account_settings', type: 'read' },
]);

const CATALOG_TOKEN_URL = tokenUrl('Traks Catalog Token', [
  { key: 'workers_r2', type: 'edit' },
  { key: 'r2_catalog', type: 'edit' },
  { key: 'r2_catalog_sql', type: 'read' },
]);

/* ── types ──────────────────────────────────────────────────── */

interface StepEvent {
  stepId: string;
  label: string;
  status: 'start' | 'ok' | 'fail' | 'retry';
  detail?: string;
}

interface Account {
  id: string;
  name: string;
}

type Phase = 'intro' | 'tokens' | 'setup' | 'deploying' | 'done' | 'failed';

const PHASE_INDEX: Record<Phase, number> = {
  intro: 0,
  tokens: 1,
  setup: 2,
  deploying: 3,
  done: 3,
  failed: 3,
};

/* ── shared UI bits (ink + mint design system) ──────────────── */

function Progress({ phase }: { phase: Phase }): ReactElement {
  const active = PHASE_INDEX[phase];
  return (
    <div className="mb-8 flex items-center justify-center gap-2">
      {[0, 1, 2, 3].map(i => (
        <span
          key={i}
          className={`h-[4px] rounded-full transition-all duration-300 ${
            i === active ? 'w-10 bg-mint' : i < active ? 'w-5 bg-[#3D3B4F]/40' : 'w-5 bg-[#E4E4E9]'
          }`}
        />
      ))}
    </div>
  );
}

function Card({ children, footer }: { children: ReactNode; footer?: ReactNode }): ReactElement {
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

function PrimaryButton({
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

function TokenField({
  id,
  label,
  help,
  linkLabel,
  linkUrl,
  value,
  onChange,
  status,
  statusDetail,
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
            <span className="text-[#B3402F]">{statusDetail ?? 'Token check failed'}</span>
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

/* ── wizard ─────────────────────────────────────────────────── */

function DeployWizard(): ReactElement {
  const { instance: sessionId } = Route.useSearch();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>('intro');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [installerToken, setInstallerToken] = useState('');
  const [oauthEnabled, setOauthEnabled] = useState(false);
  const [oauthSignedIn, setOauthSignedIn] = useState(false);
  const [catalogToken, setCatalogToken] = useState('');
  const [installerStatus, setInstallerStatus] = useState<'checking' | 'ok' | 'bad' | undefined>();
  const [installerDetail, setInstallerDetail] = useState<string | undefined>();
  const [catalogStatus, setCatalogStatus] = useState<'checking' | 'ok' | 'bad' | undefined>();
  const [catalogDetail, setCatalogDetail] = useState<string | undefined>();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [instanceName, setInstanceName] = useState('traks');

  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [result, setResult] = useState<{ apiUrl: string; collectUrl: string } | null>(null);
  const startedRef = useRef(false);

  // Instance capabilities (is "Sign in with Cloudflare" configured?).
  useEffect(() => {
    void fetch('/api/config')
      .then(r => r.json() as Promise<{ oauthEnabled?: boolean }>)
      .then(cfg => setOauthEnabled(Boolean(cfg.oauthEnabled)))
      .catch(() => undefined);
  }, []);

  // Returning from the Cloudflare consent screen: the access token arrives in
  // the URL fragment (never sent to our server); an aborted sign-in arrives as
  // ?oauth_error=. Either way, scrub the URL immediately.
  useEffect(() => {
    if (!sessionId) return;
    const hashToken = new URLSearchParams(window.location.hash.slice(1)).get('cf_token');
    const oauthError = new URLSearchParams(window.location.search).get('oauth_error');
    if (!hashToken && !oauthError) return;
    window.history.replaceState(null, '', `/deploy?instance=${encodeURIComponent(sessionId)}`);
    setPhase('tokens');
    if (hashToken) {
      setInstallerToken(hashToken);
      setOauthSignedIn(true);
      void checkInstaller(hashToken, sessionId);
    } else {
      setError(
        oauthError === 'access_denied'
          ? 'Cloudflare sign-in was cancelled — try again, or paste a token instead.'
          : 'Cloudflare sign-in failed — try again, or paste a token instead.'
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Resume a returning ?instance= session.
  useEffect(() => {
    if (!sessionId || startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const res = await fetch(`/api/deploy/instance/${sessionId}`);
      if (!res.ok) return;
      const { data } = (await res.json()) as {
        data: {
          status: string;
          apiUrl?: string;
          collectUrl?: string;
          instanceName?: string;
          steps?: StepEvent[];
          error?: string;
        };
      };
      if (data.instanceName) setInstanceName(data.instanceName);
      if (data.steps) setSteps(collapse(data.steps));
      if (data.status === 'ready' && data.apiUrl && data.collectUrl) {
        setResult({ apiUrl: data.apiUrl, collectUrl: data.collectUrl });
        setPhase('done');
      } else if (data.status === 'failed' || data.status === 'deploying') {
        // An interrupted or failed run resumes by re-running (idempotent) —
        // tokens are never stored, so ask for them again.
        setError(data.error ?? '');
        setPhase('tokens');
      }
    })();
  }, [sessionId]);

  const begin = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await fetch('/api/deploy/instance', { method: 'POST' });
      const { data } = (await res.json()) as { data: { id: string } };
      void navigate({ to: '/deploy', search: { instance: data.id }, replace: true });
      setPhase('tokens');
    } finally {
      setBusy(false);
    }
  };

  const checkInstaller = async (token: string, session = sessionId): Promise<void> => {
    if (token.trim().length < 20) return;
    setInstallerStatus('checking');
    const res = await fetch(`/api/deploy/instance/${session}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiToken: token.trim() }),
    });
    const body = (await res.json()) as { data?: Account[]; error?: string };
    if (res.ok && body.data) {
      setAccounts(body.data);
      setAccountId(body.data[0].id);
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
  };

  const checkCatalog = async (chosenAccount: string): Promise<boolean> => {
    setCatalogStatus('checking');
    const res = await fetch(`/api/deploy/instance/${sessionId}/verify-catalog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogToken: catalogToken.trim(), accountId: chosenAccount }),
    });
    const body = (await res.json()) as { data?: { ok: boolean; reason?: string } };
    if (res.ok && body.data?.ok) {
      setCatalogStatus('ok');
      setCatalogDetail('Permissions verified');
      return true;
    }
    setCatalogStatus('bad');
    setCatalogDetail(body.data?.reason ?? 'Token check failed');
    return false;
  };

  const deploy = async (): Promise<void> => {
    setBusy(true);
    setError('');
    const catalogOk = await checkCatalog(accountId);
    if (!catalogOk) {
      setBusy(false);
      setPhase('tokens');
      return;
    }
    setSteps([]);
    setPhase('deploying');
    try {
      const res = await fetch(`/api/deploy/instance/${sessionId}/provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiToken: installerToken.trim(),
          catalogToken: catalogToken.trim(),
          accountId,
          instanceName,
        }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `deploy request failed (${res.status})`);
      }
      const reader = res.body.getReader();
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
          const payload = JSON.parse(line.slice(6)) as
            | ({ type: 'step' } & StepEvent)
            | { type: 'done'; apiUrl: string; collectUrl: string }
            | { type: 'error'; message: string };
          if (payload.type === 'step') {
            setSteps(prev => collapse([...prev, payload]));
          } else if (payload.type === 'done') {
            setResult({ apiUrl: payload.apiUrl, collectUrl: payload.collectUrl });
            setPhase('done');
          } else if (payload.type === 'error') {
            setError(payload.message);
            setPhase('failed');
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'deploy failed');
      setPhase('failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] px-4 py-10">
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
          <img src="/logo.svg" alt="Traks" className="h-9 w-9" />
          <h1 className="mt-3 text-[26px] font-bold tracking-[-0.02em] text-[#3D3B4F]">
            Deploy Traks
          </h1>
          <p className="mt-1 text-[13.5px] text-[#9B99A6]">
            Your own analytics instance, in your Cloudflare account
          </p>
        </div>
        <Progress phase={phase} />

        {phase === 'intro' && (
          <Card
            footer={
              <PrimaryButton onClick={() => void begin()} busy={busy}>
                Get started
                <ArrowRight className="h-4 w-4" />
              </PrimaryButton>
            }
          >
            <h2 className="mb-1 text-[16.5px] font-bold text-[#3D3B4F]">
              Deploy Traks to your Cloudflare account
            </h2>
            <p className="mb-5 text-[13px] text-[#9B99A6]">Here&rsquo;s what will happen</p>
            <div className="space-y-2.5">
              {[
                oauthEnabled
                  ? {
                      icon: KeyRound,
                      title: 'Sign in with Cloudflare',
                      desc: 'Approve the exact permissions on Cloudflare’s own consent screen — access is temporary and never stored. One storage token is pasted separately; it stays with your instance.',
                    }
                  : {
                      icon: KeyRound,
                      title: 'Create two tokens — pre-filled, one click each',
                      desc: 'Links open the Cloudflare dashboard with the exact permissions already selected. Click Create, copy, paste. We verify both before touching anything.',
                    },
                {
                  icon: Server,
                  title: 'We set Traks up for you',
                  desc: 'Two Workers, a D1 database, KV, R2 with Data Catalog, and an event pipeline — live on your workers.dev URL in about two minutes.',
                },
                {
                  icon: ShieldCheck,
                  title: 'Yours, entirely',
                  desc: 'Everything runs in your account. Your tokens are used for this deploy only — never stored. Cookieless analytics, no consent banners.',
                },
              ].map(item => (
                <div
                  key={item.title}
                  className="flex items-start gap-3.5 rounded-2xl border border-[#EEEEF2] bg-[#FAFAFA] p-4"
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-pill">
                    <item.icon className="h-4 w-4 text-[#3D3B4F]" strokeWidth={1.8} />
                  </span>
                  <div>
                    <p className="text-[13.5px] font-semibold text-[#3D3B4F]">{item.title}</p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-[#9B99A6]">
                      {item.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {phase === 'tokens' && (
          <Card
            footer={
              <PrimaryButton
                onClick={() => setPhase('setup')}
                disabled={installerStatus !== 'ok' || catalogToken.trim().length < 20}
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </PrimaryButton>
            }
          >
            <h2 className="mb-1 text-[16.5px] font-bold text-[#3D3B4F]">
              {oauthEnabled ? 'Connect your Cloudflare account' : 'Two tokens, two clicks'}
            </h2>
            <p className="mb-5 text-[13px] leading-relaxed text-[#9B99A6]">
              {oauthEnabled ? (
                <>
                  Sign in and approve the exact permissions Traks needs — nothing is stored, and
                  access expires on its own within the hour. One storage token is still pasted
                  manually: it stays with your instance as its data-warehouse credential.
                </>
              ) : (
                <>
                  Each link opens Cloudflare with the permissions pre-selected — click{' '}
                  <span className="font-medium text-[#6E6C7C]">Continue to summary</span>, then{' '}
                  <span className="font-medium text-[#6E6C7C]">Create Token</span>, and paste it
                  here. Tokens are used for this deploy only and never stored.
                </>
              )}
            </p>
            {error && (
              <p className="mb-4 rounded-xl bg-[#F7DCD4] px-4 py-3 text-[12.5px] text-[#8F3B2C]">
                Previous attempt: {error} — fix anything needed and deploy again; the install
                resumes where it left off.
              </p>
            )}
            <div className="space-y-5">
              {oauthSignedIn ? (
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#EEEEF2] bg-[#FAFAFA] px-4 py-3.5">
                  <p className="flex items-center gap-2.5 text-[13px] font-semibold text-[#3D3B4F]">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-mint/15">
                      <Check className="h-4 w-4 text-[#0E9F6E]" strokeWidth={2.4} />
                    </span>
                    Signed in with Cloudflare
                  </p>
                  <p className="text-[11.5px] text-[#9B99A6]">
                    {installerStatus === 'checking' ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" /> Checking access…
                      </span>
                    ) : installerStatus === 'ok' ? (
                      installerDetail
                    ) : installerStatus === 'bad' ? (
                      <span className="text-[#B3402F]">{installerDetail}</span>
                    ) : null}
                  </p>
                </div>
              ) : oauthEnabled ? (
                <div>
                  <button
                    onClick={() => {
                      window.location.href = `/api/deploy/oauth/start?instance=${encodeURIComponent(
                        sessionId ?? ''
                      )}`;
                    }}
                    className="flex h-12 w-full items-center justify-center gap-2.5 rounded-2xl bg-[#3D3B4F] text-[14px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-[#2C2B3B] hover:shadow-md cursor-pointer"
                  >
                    <Cloud className="h-[18px] w-[18px]" strokeWidth={2} />
                    Sign in with Cloudflare
                  </button>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-[#9B99A6]">
                    Opens Cloudflare&rsquo;s consent screen listing every permission — approve once
                    and you&rsquo;re back here. Prefer not to?{' '}
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
                </div>
              ) : null}
              {!oauthSignedIn && (
                <>
                  <TokenField
                    id="installer-token"
                    label="Installer token"
                    help="Creates the Workers, database, KV, and pipeline in your account."
                    linkLabel="Create installer token (pre-filled)"
                    linkUrl={INSTALLER_TOKEN_URL}
                    value={installerToken}
                    onChange={v => {
                      setInstallerToken(v);
                      setInstallerStatus(undefined);
                    }}
                    status={installerStatus}
                    statusDetail={installerDetail}
                  />
                  {installerToken.trim().length >= 20 && installerStatus === undefined && (
                    <button
                      onClick={() => void checkInstaller(installerToken)}
                      className="rounded-full bg-muted px-4 py-1.5 text-[12px] font-semibold text-[#3D3B4F] hover:bg-[#E4E4E9] transition-colors cursor-pointer"
                    >
                      Verify token
                    </button>
                  )}
                </>
              )}
              <TokenField
                id="catalog-token"
                label="Analytics storage token"
                help="Stays with your instance as its data-warehouse credential."
                linkLabel="Create storage token (pre-filled)"
                linkUrl={CATALOG_TOKEN_URL}
                value={catalogToken}
                onChange={v => {
                  setCatalogToken(v);
                  setCatalogStatus(undefined);
                }}
                status={catalogStatus}
                statusDetail={catalogDetail}
              />
            </div>
          </Card>
        )}

        {phase === 'setup' && (
          <Card
            footer={
              <PrimaryButton onClick={() => void deploy()} busy={busy}>
                <Sparkles className="h-4 w-4" />
                Deploy Traks
              </PrimaryButton>
            }
          >
            <h2 className="mb-1 text-[16.5px] font-bold text-[#3D3B4F]">Name your instance</h2>
            <p className="mb-5 text-[13px] text-[#9B99A6]">
              Where Traks deploys and what its resources are called
            </p>
            <div className="space-y-4">
              {accounts.length > 1 && (
                <div>
                  <label className="mb-1.5 block text-[12.5px] font-semibold text-[#3D3B4F]">
                    Cloudflare account
                  </label>
                  <select
                    value={accountId}
                    onChange={e => setAccountId(e.target.value)}
                    className="h-11 w-full cursor-pointer rounded-2xl border-none bg-white px-4 text-[13.5px] text-[#3D3B4F] shadow-[inset_0_0_0_1px_#E5E5EB] focus:shadow-[inset_0_0_0_1.5px_#3D3B4F] focus:outline-none"
                  >
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-[11.5px] text-[#9B99A6]">
                    Your token covers more than one account; Traks deploys into this one.
                  </p>
                </div>
              )}
              {accounts.length === 1 && (
                <p className="rounded-xl bg-[#F4F4F6] px-4 py-3 text-[12.5px] text-[#6E6C7C]">
                  Deploying into{' '}
                  <span className="font-semibold text-[#3D3B4F]">{accounts[0].name}</span>
                </p>
              )}
              <div>
                <label
                  htmlFor="instance-name"
                  className="mb-1.5 block text-[12.5px] font-semibold text-[#3D3B4F]"
                >
                  Instance name
                </label>
                <input
                  id="instance-name"
                  value={instanceName}
                  onChange={e => setInstanceName(e.target.value)}
                  placeholder="traks"
                  className="h-11 w-full rounded-2xl border-none bg-white px-4 text-[13.5px] text-[#3D3B4F] shadow-[inset_0_0_0_1px_#E5E5EB] focus:shadow-[inset_0_0_0_1.5px_#3D3B4F] focus:outline-none"
                />
                <p className="mt-1.5 text-[11.5px] text-[#9B99A6]">
                  Lowercase letters, digits, and dashes. Your dashboard will live at{' '}
                  <span className="font-mono text-[#6E6C7C]">
                    {/^[a-z][a-z0-9-]{2,20}$/.test(instanceName) ? instanceName : 'traks'}
                    -api.&lt;your-subdomain&gt;.workers.dev
                  </span>
                </p>
              </div>
            </div>
          </Card>
        )}

        {(phase === 'deploying' || phase === 'failed') && (
          <Card
            footer={
              phase === 'failed' ? (
                <PrimaryButton onClick={() => void deploy()} busy={busy}>
                  <RotateCw className="h-4 w-4" />
                  Retry deploy
                </PrimaryButton>
              ) : undefined
            }
          >
            <h2 className="mb-1 text-[16.5px] font-bold text-[#3D3B4F]">Deploying Traks</h2>
            <p className="mb-5 text-[13px] text-[#9B99A6]">
              Setting everything up in your Cloudflare account
            </p>
            <div className="space-y-1">
              {steps.length === 0 && (
                <p className="flex items-center gap-2 py-1.5 text-[13px] text-[#9B99A6]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting the deploy…
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
                        <span className="ml-2 rounded-full bg-[#F4F4F6] px-2 py-0.5 text-[10.5px] font-semibold text-[#6E6C7C]">
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
            {phase === 'failed' && error && (
              <p className="mt-4 rounded-xl bg-[#F7DCD4] px-4 py-3 text-[12.5px] leading-relaxed text-[#8F3B2C]">
                {error}
              </p>
            )}
          </Card>
        )}

        {phase === 'done' && result && (
          <Card
            footer={
              <a
                href={result.apiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-full bg-mint px-6 text-[13.5px] font-bold text-[#123326] transition-all hover:-translate-y-px hover:shadow-[0_8px_24px_rgba(40,233,159,0.35)]"
              >
                Open your Traks
                <ArrowRight className="h-4 w-4" />
              </a>
            }
          >
            <div className="flex flex-col items-center pt-2 text-center">
              <CheckCircle2 className="mb-3 h-12 w-12 text-mint" strokeWidth={1.5} />
              <h2 className="text-[17px] font-bold text-[#3D3B4F]">
                Your Traks instance is live 🎉
              </h2>
              <p className="mb-5 mt-1 text-[13px] text-[#9B99A6]">
                Everything deployed and verified in your account
              </p>
              <a
                href={result.apiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#E5E5EB] bg-white px-5 py-2.5 text-[13.5px] font-semibold text-[#3D3B4F] hover:border-[#cbcad4] transition-colors"
              >
                {result.apiUrl.replace('https://', '')}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <div className="w-full rounded-2xl border border-[#EEEEF2] bg-[#FAFAFA] p-4 text-left">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-[#3D3B4F]">
                  <ShieldCheck className="h-4 w-4" strokeWidth={1.8} />
                  Claim your instance
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-[#9B99A6]">
                  Open it and create your owner account — the first sign-up claims the instance and
                  sign-ups close afterwards. Then add your site and paste the tracking snippet it
                  gives you.
                </p>
              </div>
            </div>
          </Card>
        )}

      </div>
    </div>
  );
}

/** Keep one row per stepId, latest status wins (streams re-emit on retry). */
function collapse(events: StepEvent[]): StepEvent[] {
  const map = new Map<string, StepEvent>();
  for (const e of events) map.set(e.stepId, e);
  return [...map.values()];
}
