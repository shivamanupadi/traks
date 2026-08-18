import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  RotateCw,
  Server,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  Card,
  ConnectSection,
  ErrorBox,
  BackButton,
  PrimaryButton,
  StepList,
  TokenField,
  WizardShell,
  catalogTokenUrl,
  collapse,
  createSession,
  readSse,
  runIsFresh,
  useConnect,
  type InstanceRow,
  type StepEvent,
} from '../deploy/shared';

export const Route = createFileRoute('/deploy')({
  component: DeployWizard,
  validateSearch: (search: Record<string, unknown>): { instance?: string } => ({
    instance: typeof search.instance === 'string' ? search.instance : undefined,
  }),
});

type Phase = 'intro' | 'tokens' | 'setup' | 'deploying' | 'failed' | 'done';

const PHASE_INDEX: Record<Phase, number> = {
  intro: 0,
  tokens: 1,
  setup: 2,
  deploying: 3,
  failed: 3,
  done: 3,
};

const INTERRUPTED_MSG =
  'The previous deploy was interrupted before it finished. Everything already created is reused. Re-enter your tokens and deploy again to pick up where it left off.';

const failedMsg = (detail: string): string =>
  `The previous deploy failed: ${detail}. Fix what it points at, re-enter your tokens, and deploy again; everything already created is reused.`;

/**
 * Install flow only. A session that already finished (`ready`) belongs to the
 * update flow and is redirected to /update - older instances' dashboards
 * still link their update banner here.
 */
function DeployWizard(): ReactElement {
  const { instance: sessionId } = Route.useSearch();
  const navigate = useNavigate();
  const connect = useConnect('deploy', sessionId);

  const [phase, setPhase] = useState<Phase>('intro');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [catalogToken, setCatalogToken] = useState('');
  const [catalogStatus, setCatalogStatus] = useState<'checking' | 'ok' | 'bad' | undefined>();
  const [catalogDetail, setCatalogDetail] = useState<string | undefined>();

  const [instanceName, setInstanceName] = useState('traks');
  const [zones, setZones] = useState<{ id: string; name: string }[]>([]);
  const [zoneId, setZoneId] = useState('');
  const [domainSub, setDomainSub] = useState('analytics');
  const [showNameEdit, setShowNameEdit] = useState(false);

  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [result, setResult] = useState<{ apiUrl: string; collectUrl: string } | null>(null);
  const startedRef = useRef(false);
  const pollRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (connect.oauthError) {
      setError(connect.oauthError);
      setPhase('tokens');
    } else if (connect.oauthSignedIn) {
      setPhase('tokens');
    }
  }, [connect.oauthError, connect.oauthSignedIn]);

  const stopPolling = (): void => {
    if (pollRef.current !== undefined) {
      window.clearInterval(pollRef.current);
      pollRef.current = undefined;
    }
  };
  useEffect(() => stopPolling, []);

  // Reattach to a deploy that's running server-side (this tab refreshed
  // mid-run, or another tab owns the SSE stream): watch the instance row.
  const startPolling = (): void => {
    stopPolling();
    pollRef.current = window.setInterval(() => {
      void fetch(`/api/deploy/instance/${sessionId}`)
        .then(r => (r.ok ? (r.json() as Promise<{ data: InstanceRow }>) : Promise.reject(r)))
        .then(({ data }) => {
          if (data.steps) setSteps(collapse(data.steps));
          if (data.status === 'ready' && data.apiUrl && data.collectUrl) {
            stopPolling();
            setResult({ apiUrl: data.apiUrl, collectUrl: data.collectUrl });
            setPhase('done');
          } else if (data.status === 'failed') {
            stopPolling();
            setError(data.error ? failedMsg(data.error) : INTERRUPTED_MSG);
            setPhase('tokens');
          } else if (!runIsFresh(data)) {
            stopPolling();
            setError(INTERRUPTED_MSG);
            setPhase('tokens');
          }
        })
        .catch(() => undefined);
    }, 3000);
  };

  // Resume a returning ?instance= session - or hand it to the right flow.
  useEffect(() => {
    if (!sessionId || startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const res = await fetch(`/api/deploy/instance/${sessionId}`);
      if (!res.ok) return;
      const { data } = (await res.json()) as { data: InstanceRow };
      if (data.status === 'ready') {
        // A finished session means "manage this instance" - that's /update.
        void navigate({ to: '/update', search: { instance: sessionId }, replace: true });
        return;
      }
      if (data.instanceName) setInstanceName(data.instanceName);
      if (data.steps) setSteps(collapse(data.steps));
      if (data.customDomain) {
        // Restore the domain choice so a resumed run re-deploys onto the
        // same hostnames; the zones fetch replaces this seed once verified.
        setZones([{ id: data.customDomain.zoneId, name: data.customDomain.zoneName }]);
        setZoneId(data.customDomain.zoneId);
        setDomainSub(data.customDomain.subdomain);
      }
      if (data.status === 'deploying' && runIsFresh(data)) {
        // The run is still going server-side - show it live, no tokens needed.
        setPhase('deploying');
        startPolling();
      } else if (data.status === 'failed' || data.status === 'deploying') {
        // A failed or abandoned run resumes by re-running (idempotent)  -
        // tokens are never stored, so ask for them again.
        setError(data.error ? failedMsg(data.error) : INTERRUPTED_MSG);
        setPhase('tokens');
      }
    })().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const begin = async (): Promise<void> => {
    if (sessionId) {
      setPhase('tokens');
      return;
    }
    setBusy(true);
    try {
      const id = await createSession();
      void navigate({ to: '/deploy', search: { instance: id }, replace: true });
      setError('');
      setPhase('tokens');
    } catch {
      setError('Could not reach the server to start. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const checkCatalog = async (chosenAccount: string): Promise<boolean> => {
    setCatalogStatus('checking');
    try {
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
    } catch {
      setCatalogStatus('bad');
      setCatalogDetail('Could not reach the server. Check your connection and try again.');
      return false;
    }
  };

  // Auto-verify the storage token shortly after it's pasted.
  useEffect(() => {
    if (connect.installerStatus !== 'ok' || !connect.accountId) return;
    if (catalogStatus !== undefined || catalogToken.trim().length < 20) return;
    const t = window.setTimeout(() => void checkCatalog(connect.accountId), 600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogToken, catalogStatus, connect.installerStatus, connect.accountId]);

  const continueFromTokens = async (): Promise<void> => {
    setBusy(true);
    try {
      if (catalogStatus === 'ok' || (await checkCatalog(connect.accountId))) {
        setError('');
        setPhase('setup');
      }
    } finally {
      setBusy(false);
    }
  };

  // Domains available for the custom-domain picker (per chosen account).
  useEffect(() => {
    if (phase !== 'setup' || !connect.accountId || !sessionId) return;
    void fetch(`/api/deploy/instance/${sessionId}/zones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiToken: connect.installerToken.trim(),
        accountId: connect.accountId,
      }),
    })
      .then(r =>
        r.ok ? (r.json() as Promise<{ data: { id: string; name: string }[] }>) : Promise.reject(r)
      )
      .then(({ data }) => {
        setZones(data);
        // Keep a restored/previous choice only if this account still has it.
        setZoneId(prev => (data.some(z => z.id === prev) ? prev : ''));
      })
      .catch(() => {
        setZones([]);
        setZoneId('');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, connect.accountId, sessionId]);

  const zoneName = zones.find(z => z.id === zoneId)?.name ?? '';
  // A selected zone must exist in the loaded list - otherwise the deploy
  // request would carry an empty zoneName and fail server-side validation.
  const zoneKnown = zoneId === '' || zones.some(z => z.id === zoneId);
  // Mirrors the server's schema so a bad name is caught here, not as a 400.
  const nameOk = /^[a-z][a-z0-9-]{2,20}$/.test(instanceName.trim());
  const sub = domainSub.trim();
  const subOk = sub === '' || /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(sub);
  const previewApiHost = sub ? `${sub}.${zoneName}` : zoneName;
  const previewCollectHost = sub ? `${sub}-collect.${zoneName}` : `collect.${zoneName}`;

  const deploy = async (): Promise<void> => {
    setBusy(true);
    setError('');
    // Fresh installs always need the storage token - verify before running.
    const catalogOk = await checkCatalog(connect.accountId);
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
          apiToken: connect.installerToken.trim(),
          catalogToken: catalogToken.trim(),
          accountId: connect.accountId,
          instanceName: instanceName.trim(),
          customDomain: zoneId
            ? {
                zoneId,
                zoneName: zones.find(z => z.id === zoneId)?.name ?? '',
                subdomain: domainSub.trim(),
              }
            : undefined,
        }),
      });
      if (res.status === 409) {
        // A run for this instance is already going (e.g. another tab)  -
        // watch it instead of erroring out.
        startPolling();
        return;
      }
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `deploy request failed (${res.status})`);
      }
      await readSse<
        | ({ type: 'step' } & StepEvent)
        | { type: 'done'; apiUrl: string; collectUrl: string }
        | { type: 'error'; message: string }
      >(res, payload => {
        if (payload.type === 'step') {
          setSteps(prev => collapse([...prev, payload]));
        } else if (payload.type === 'done') {
          setResult({ apiUrl: payload.apiUrl, collectUrl: payload.collectUrl });
          setPhase('done');
        } else if (payload.type === 'error') {
          setError(payload.message);
          setPhase('failed');
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'deploy failed');
      setPhase('failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <WizardShell
      title="Deploy Traks"
      subtitle="Your own analytics instance, in your Cloudflare account"
      progress={{ current: PHASE_INDEX[phase], total: 4 }}
    >
      {phase === 'intro' && (
        <Card
          footer={
            <>
              <button
                onClick={() => void navigate({ to: '/' })}
                className="mr-auto inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-semibold text-[#6E6C7C] transition-colors hover:bg-[#F2F1ED] hover:text-[#3D3B4F] cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to traks.dev
              </button>
              <PrimaryButton onClick={() => void begin()} busy={busy}>
                Get started
                <ArrowRight className="h-4 w-4" />
              </PrimaryButton>
            </>
          }
        >
          <h2 className="mb-1 text-[16.5px] font-bold text-[#3D3B4F]">
            Deploy Traks to your Cloudflare account
          </h2>
          <p className="mb-5 text-[13px] text-[#9B99A6]">Here&rsquo;s what will happen</p>
          {error && <ErrorBox>{error}</ErrorBox>}
          <div className="space-y-2.5">
            {[
              connect.oauthEnabled
                ? {
                    icon: KeyRound,
                    title: 'Sign in with Cloudflare',
                    desc: 'Approve the exact permissions on Cloudflare’s own consent screen. Access is temporary and never stored. One storage token is pasted separately; it stays with your instance.',
                  }
                : {
                    icon: KeyRound,
                    title: 'Create two tokens, pre-filled, one click each',
                    desc: 'Links open the Cloudflare dashboard with the exact permissions already selected. Click Create, copy, paste. We verify both before touching anything.',
                  },
              {
                icon: Server,
                title: 'We set Traks up for you',
                desc: 'Two Workers, a D1 database, KV, R2 with Data Catalog, and an event pipeline, live on your workers.dev URL in about two minutes.',
              },
              {
                icon: ShieldCheck,
                title: 'Yours, entirely',
                desc: 'Everything runs in your account. Your tokens are used for this deploy only, never stored. Cookieless analytics, no consent banners.',
              },
            ].map(item => (
              <div
                key={item.title}
                className="flex items-start gap-3.5 rounded-2xl border border-[#EEEEF2] bg-[#F6F5F2] p-4"
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-pill">
                  <item.icon className="h-4 w-4 text-[#3D3B4F]" strokeWidth={1.8} />
                </span>
                <div>
                  <p className="text-[13.5px] font-semibold text-[#3D3B4F]">{item.title}</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-[#9B99A6]">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {phase === 'tokens' && (
        <Card
          footer={
            <>
              <BackButton onClick={() => setPhase('intro')} disabled={busy} />
              <PrimaryButton
                onClick={() => void continueFromTokens()}
                busy={busy}
                disabled={connect.installerStatus !== 'ok' || catalogToken.trim().length < 20}
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </PrimaryButton>
            </>
          }
        >
          <h2 className="mb-1 text-[16.5px] font-bold text-[#3D3B4F]">
            {connect.oauthEnabled ? 'Connect your Cloudflare account' : 'Two tokens, two clicks'}
          </h2>
          <p className="mb-5 text-[13px] leading-relaxed text-[#9B99A6]">
            {connect.oauthEnabled ? (
              <>
                Sign in and approve the exact permissions Traks needs. Nothing is stored, and access
                expires on its own within the hour. One storage token is still pasted manually: it
                stays with your instance as its data-warehouse credential.
              </>
            ) : (
              <>
                Each link opens Cloudflare with the permissions pre-selected. Click{' '}
                <span className="font-medium text-[#6E6C7C]">Continue to summary</span>, then{' '}
                <span className="font-medium text-[#6E6C7C]">Create Token</span>, and paste it here.
                Tokens are used for this deploy only and never stored.
              </>
            )}
          </p>
          {error && <ErrorBox>{error}</ErrorBox>}
          <div className="space-y-5">
            <ConnectSection connect={connect} />
            {connect.existingInstalls.length > 0 && (
              <div className="space-y-3">
                {connect.existingInstalls.map(inst => (
                  <div
                    key={inst.id}
                    className="rounded-2xl border border-[#EEEEF2] bg-[#F6F5F2] p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-[#3D3B4F]">
                          Traks is already installed in{' '}
                          {connect.accounts.find(a => a.id === inst.accountId)?.name ??
                            'this account'}
                        </p>
                        <p className="mt-0.5 truncate text-[12px] text-[#9B9590]">
                          <span className="font-mono">{inst.instanceName}</span>
                          {inst.deployedVersion && <> · v{inst.deployedVersion}</>}
                        </p>
                      </div>
                      <button
                        onClick={() =>
                          void navigate({ to: '/update', search: { instance: sessionId } })
                        }
                        className="shrink-0 rounded-full bg-[#3D3B4F] px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-[#2C2B3B] transition-colors cursor-pointer"
                      >
                        Update it
                      </button>
                    </div>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-[#9B99A6]">
                      Updating and destroying have their own pages now. Continuing below installs a
                      separate, second instance.{' '}
                      <button
                        onClick={() =>
                          void navigate({ to: '/destroy', search: { instance: sessionId } })
                        }
                        className="font-semibold text-[#B3402F]/70 hover:text-[#B3402F] transition-colors cursor-pointer"
                      >
                        Destroy an instance…
                      </button>
                    </p>
                  </div>
                ))}
              </div>
            )}
            <TokenField
              id="catalog-token"
              label="Analytics storage token"
              help="Stays with your instance as its data-warehouse credential."
              linkLabel="Create storage token (pre-filled)"
              linkUrl={catalogTokenUrl(connect.accountId)}
              value={catalogToken}
              onChange={v => {
                setCatalogToken(v);
                setCatalogStatus(undefined);
              }}
              status={catalogStatus}
              statusDetail={catalogDetail}
              errorHelp="Use the pre-filled storage-token link (scoped to the selected account), click “Create Token”, and paste the token value, not the token ID."
            />
          </div>
        </Card>
      )}

      {phase === 'setup' && (
        <Card
          footer={
            <>
              <BackButton onClick={() => setPhase('tokens')} disabled={busy} />
              <PrimaryButton
                onClick={() => void deploy()}
                busy={busy}
                disabled={!nameOk || !zoneKnown || (zoneId !== '' && !subOk)}
              >
                <Sparkles className="h-4 w-4" />
                Deploy Traks
              </PrimaryButton>
            </>
          }
        >
          <h2 className="mb-1 text-[16.5px] font-bold text-[#3D3B4F]">Name your instance</h2>
          <p className="mb-5 text-[13px] text-[#9B99A6]">
            Where Traks deploys and what its resources are called
          </p>
          <div className="space-y-4">
            {connect.accounts.length > 0 && (
              <p className="rounded-xl bg-[#F2F1ED] px-4 py-3 text-[12.5px] text-[#6E6C7C]">
                Deploying into{' '}
                <span className="font-semibold text-[#3D3B4F]">
                  {connect.accounts.find(a => a.id === connect.accountId)?.name}
                </span>
              </p>
            )}
            <div>
              <label
                htmlFor="instance-name"
                className="mb-1.5 block text-[12.5px] font-semibold text-[#3D3B4F]"
              >
                Instance name
              </label>
              {!showNameEdit ? (
                <div className="flex h-11 w-full items-center justify-between rounded-2xl bg-[#F2F1ED] px-4">
                  <span className="font-mono text-[13.5px] text-[#3D3B4F]">{instanceName}</span>
                  <button
                    onClick={() => setShowNameEdit(true)}
                    className="text-[12px] font-semibold text-[#6E6C7C] hover:text-[#3D3B4F] transition-colors cursor-pointer"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <input
                  id="instance-name"
                  value={instanceName}
                  onChange={e => setInstanceName(e.target.value)}
                  placeholder="traks"
                  autoFocus
                  className="h-11 w-full rounded-2xl border-none bg-white px-4 text-[13.5px] text-[#3D3B4F] shadow-[inset_0_0_0_1px_#E5E5EB] focus:shadow-[inset_0_0_0_1.5px_#3D3B4F] focus:outline-none"
                />
              )}
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-[#9B99A6]">
                {!showNameEdit ? (
                  <>
                    Prefixes everything created in your account:{' '}
                    <span className="font-mono text-[#6E6C7C]">{instanceName.trim()}-api</span>{' '}
                    (dashboard),{' '}
                    <span className="font-mono text-[#6E6C7C]">{instanceName.trim()}-collect</span>{' '}
                    (tracker), database, storage. The default is right for a single instance; change
                    it only to run several (e.g. a staging copy).
                  </>
                ) : nameOk ? (
                  <>
                    Prefixes everything created in your account: workers{' '}
                    <span className="font-mono text-[#6E6C7C]">{instanceName.trim()}-api</span>{' '}
                    (your dashboard) and{' '}
                    <span className="font-mono text-[#6E6C7C]">{instanceName.trim()}-collect</span>{' '}
                    (the tracker), plus the database and storage.
                  </>
                ) : (
                  <span className="text-[#B3402F]">
                    3 to 21 characters, starting with a letter: lowercase letters, digits, and
                    dashes only.
                  </span>
                )}
              </p>
            </div>
            <div>
              <label
                htmlFor="deploy-domain"
                className="mb-1.5 block text-[12.5px] font-semibold text-[#3D3B4F]"
              >
                Domain
              </label>
              <select
                id="deploy-domain"
                value={zoneId}
                onChange={e => setZoneId(e.target.value)}
                className="h-11 w-full cursor-pointer rounded-2xl border-none bg-white px-4 text-[13.5px] text-[#3D3B4F] shadow-[inset_0_0_0_1px_#E5E5EB] focus:shadow-[inset_0_0_0_1.5px_#3D3B4F] focus:outline-none"
              >
                <option value="">workers.dev (default, no setup)</option>
                {zones.map(z => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
              {zoneId ? (
                <div className="mt-3">
                  <div className="flex items-center gap-2">
                    <input
                      id="domain-sub"
                      value={domainSub}
                      onChange={e => setDomainSub(e.target.value)}
                      placeholder="analytics"
                      className="h-11 w-40 rounded-2xl border-none bg-white px-4 text-[13.5px] text-[#3D3B4F] shadow-[inset_0_0_0_1px_#E5E5EB] focus:shadow-[inset_0_0_0_1.5px_#3D3B4F] focus:outline-none"
                    />
                    <span className="text-[13.5px] text-[#6E6C7C]">
                      .{zones.find(z => z.id === zoneId)?.name}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-[#9B99A6]">
                    {subOk ? (
                      <>
                        Dashboard at{' '}
                        <span className="font-mono text-[#6E6C7C]">{previewApiHost}</span>, tracker
                        served from{' '}
                        <span className="font-mono text-[#6E6C7C]">{previewCollectHost}</span>. DNS
                        records and certificates are created automatically. Leave the box empty to
                        use the domain itself.
                      </>
                    ) : (
                      <span className="text-[#B3402F]">
                        Subdomain: lowercase letters, digits, and dashes (or empty for the root
                        domain).
                      </span>
                    )}
                  </p>
                </div>
              ) : (
                <p className="mt-1.5 text-[11.5px] text-[#9B99A6]">
                  Your dashboard will live at{' '}
                  <span className="font-mono text-[#6E6C7C]">
                    {nameOk ? instanceName.trim() : 'traks'}
                    -api.&lt;your-subdomain&gt;.workers.dev
                  </span>
                  {zones.length === 0 && '. Add a domain to Cloudflare to use your own.'}
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {(phase === 'deploying' || phase === 'failed') && (
        <Card
          footer={
            phase === 'failed' ? (
              <>
                <BackButton onClick={() => setPhase('setup')} disabled={busy} />
                <PrimaryButton onClick={() => void deploy()} busy={busy}>
                  <RotateCw className="h-4 w-4" />
                  Retry deploy
                </PrimaryButton>
              </>
            ) : undefined
          }
        >
          <h2 className="mb-1 text-[16.5px] font-bold text-[#3D3B4F]">Deploying Traks</h2>
          <p className="mb-5 text-[13px] text-[#9B99A6]">
            Setting everything up in your Cloudflare account
          </p>
          <StepList steps={steps} startingLabel="Starting the deploy…" />
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
            <h2 className="text-[17px] font-bold text-[#3D3B4F]">Your Traks instance is live 🎉</h2>
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
            <div className="w-full rounded-2xl border border-[#EEEEF2] bg-[#F6F5F2] p-4 text-left">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-[#3D3B4F]">
                <ShieldCheck className="h-4 w-4" strokeWidth={1.8} />
                Claim your instance
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[#9B99A6]">
                {connect.cfEmail ? (
                  <>
                    Open it and pick a password.{' '}
                    <span className="font-medium text-[#6E6C7C]">{connect.cfEmail}</span> is already
                    set as the owner, and only that email can claim the instance. Then add your site
                    and paste the tracking snippet it gives you.
                  </>
                ) : (
                  <>
                    Open it and create your owner account. The first sign-up claims the instance and
                    sign-ups close afterwards. Then add your site and paste the tracking snippet it
                    gives you.
                  </>
                )}
              </p>
            </div>
          </div>
        </Card>
      )}
    </WizardShell>
  );
}
