import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowRight, CheckCircle2, ExternalLink, Loader2, RotateCw } from 'lucide-react';
import {
  Card,
  ConnectSection,
  ErrorBox,
  NoteBox,
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
  type ExistingInstall,
  type InstanceRow,
  type StepEvent,
} from '../deploy/shared';

export const Route = createFileRoute('/update')({
  component: UpdateWizard,
  validateSearch: (search: Record<string, unknown>): { instance?: string } => ({
    instance: typeof search.instance === 'string' ? search.instance : undefined,
  }),
});

type Phase = 'connect' | 'confirm' | 'updating' | 'failed' | 'done';

const PHASE_INDEX: Record<Phase, number> = {
  connect: 0,
  confirm: 1,
  updating: 2,
  failed: 2,
  done: 2,
};

const INTERRUPTED_MSG =
  'The previous update was interrupted before it finished. Re-connect and run it again — updates are safe to re-run.';

/**
 * Update flow: connect → confirm the instance → run. Its URL is what the
 * dashboards' "new version available" banner links to. Updating a healthy
 * instance needs NO storage token — the token field only appears when the
 * preflight probe says this specific instance is missing something.
 */
function UpdateWizard(): ReactElement {
  const { instance: urlSession } = Route.useSearch();
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState(urlSession);
  const connect = useConnect('update', sessionId);

  const [phase, setPhase] = useState<Phase>('connect');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [target, setTarget] = useState<ExistingInstall | null>(null);
  /** The instance the current session row is bound to (null = unbound). */
  const boundRef = useRef<{ accountId: string; instanceName: string } | null>(null);

  const [catalogToken, setCatalogToken] = useState('');
  const [catalogStatus, setCatalogStatus] = useState<'checking' | 'ok' | 'bad' | undefined>();
  const [catalogDetail, setCatalogDetail] = useState<string | undefined>();
  // Whether this update still needs a storage token. `undefined` while the
  // preflight probe is in flight — the confirm screen shows a neutral
  // "checking" state instead of flashing the token field in and out. A probe
  // that fails resolves to the conservative `true`.
  const [catalogRequired, setCatalogRequired] = useState<boolean | undefined>(undefined);
  const [catalogReason, setCatalogReason] = useState<string | null>(null);

  const [versions, setVersions] = useState<{ current?: string; latest?: string }>({});
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [result, setResult] = useState<{ apiUrl: string; collectUrl: string } | null>(null);
  const startedRef = useRef(false);
  const pollRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (connect.oauthError) setError(connect.oauthError);
  }, [connect.oauthError]);

  // A session is needed for OAuth state and every API call — mint one when
  // the page is opened directly without ?instance=.
  useEffect(() => {
    if (sessionId) return;
    void createSession()
      .then(id => {
        setSessionId(id);
        void navigate({ to: '/update', search: { instance: id }, replace: true });
      })
      .catch(() =>
        setError('Could not reach the server to start — check your connection and try again.')
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    void fetch('/api/deploy/latest-version')
      .then(r => (r.ok ? (r.json() as Promise<{ data: { version?: string } }>) : Promise.reject(r)))
      .then(({ data }) => setVersions(v => ({ ...v, latest: data.version })))
      .catch(() => undefined);
  }, []);

  const stopPolling = (): void => {
    if (pollRef.current !== undefined) {
      window.clearInterval(pollRef.current);
      pollRef.current = undefined;
    }
  };
  useEffect(() => stopPolling, []);

  const startPolling = (session: string): void => {
    stopPolling();
    pollRef.current = window.setInterval(() => {
      void fetch(`/api/deploy/instance/${session}`)
        .then(r => (r.ok ? (r.json() as Promise<{ data: InstanceRow }>) : Promise.reject(r)))
        .then(({ data }) => {
          if (data.steps) setSteps(collapse(data.steps));
          if (data.status === 'ready' && data.apiUrl && data.collectUrl) {
            stopPolling();
            setResult({ apiUrl: data.apiUrl, collectUrl: data.collectUrl });
            setVersions(v => ({ ...v, current: v.latest }));
            setPhase('done');
          } else if (data.status === 'failed') {
            stopPolling();
            setError(data.error ?? INTERRUPTED_MSG);
            setPhase('failed');
          } else if (!runIsFresh(data)) {
            stopPolling();
            setError(INTERRUPTED_MSG);
            setPhase('connect');
          }
        })
        .catch(() => undefined);
    }, 3000);
  };

  // Resume the ?instance= session: a ready row identifies the instance to
  // update; a running row gets watched live; a fresh row just connects.
  useEffect(() => {
    if (!sessionId || startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const res = await fetch(`/api/deploy/instance/${sessionId}`);
      if (!res.ok) return;
      const { data } = (await res.json()) as { data: InstanceRow };
      if (data.instanceName) {
        boundRef.current = { accountId: '', instanceName: data.instanceName };
      }
      if (data.deployedVersion) setVersions(v => ({ ...v, current: data.deployedVersion }));
      if (data.status === 'destroyed') {
        setError('This instance was destroyed. Deploy a fresh one instead.');
        return;
      }
      if (data.status === 'deploying' && runIsFresh(data)) {
        if (data.steps) setSteps(collapse(data.steps));
        setPhase('updating');
        startPolling(sessionId);
      } else if (data.status === 'failed') {
        setError(data.error ? `The previous run failed: ${data.error}` : INTERRUPTED_MSG);
      }
    })().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  /**
   * A session row bound to one instance can only drive that instance — pick
   * a different target and we mint a fresh session for it.
   */
  const ensureSessionFor = async (inst: ExistingInstall): Promise<string> => {
    const bound = boundRef.current;
    if (!sessionId || (bound && bound.instanceName !== inst.instanceName)) {
      const id = await createSession();
      boundRef.current = null;
      setSessionId(id);
      void navigate({ to: '/update', search: { instance: id }, replace: true });
      return id;
    }
    return sessionId;
  };

  const runPreflight = async (session: string, inst: ExistingInstall): Promise<void> => {
    const token = connect.installerToken.trim();
    if (token.length < 20 || !inst.accountId || !inst.instanceName) return;
    setCatalogRequired(undefined);
    setCatalogReason(null);
    try {
      const res = await fetch(`/api/deploy/instance/${session}/preflight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiToken: token,
          accountId: inst.accountId,
          instanceName: inst.instanceName,
          intent: 'update',
        }),
      });
      if (!res.ok) {
        // A probe that could not answer must not be read as "nothing needed".
        setCatalogRequired(true);
        return;
      }
      const { data } = (await res.json()) as {
        data: { catalogTokenNeeded: boolean; reason: string | null };
      };
      setCatalogRequired(data.catalogTokenNeeded);
      setCatalogReason(data.reason);
    } catch {
      setCatalogRequired(true);
    }
  };

  const pickTarget = async (inst: ExistingInstall): Promise<void> => {
    setBusy(true);
    try {
      const session = await ensureSessionFor(inst);
      setTarget(inst);
      if (inst.accountId) connect.setAccountId(inst.accountId);
      setVersions(v => ({ ...v, current: inst.deployedVersion ?? undefined }));
      setError('');
      setPhase('confirm');
      void runPreflight(session, inst);
    } catch {
      setError('Could not reach the server — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const checkCatalog = async (): Promise<boolean> => {
    setCatalogStatus('checking');
    try {
      const res = await fetch(`/api/deploy/instance/${sessionId}/verify-catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          catalogToken: catalogToken.trim(),
          accountId: target?.accountId ?? connect.accountId,
        }),
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
      setCatalogDetail('Could not reach the server — check your connection and try again.');
      return false;
    }
  };

  const runUpdate = async (): Promise<void> => {
    if (!target?.instanceName || !target.accountId || !sessionId) return;
    setBusy(true);
    setError('');
    // Only verify a storage token when one is actually in play — a healthy
    // instance updates without one, and the server double-checks anyway.
    const pastedToken = catalogToken.trim().length >= 20;
    if ((catalogRequired !== false || pastedToken) && catalogStatus !== 'ok' && !(await checkCatalog())) {
      setBusy(false);
      return;
    }
    setSteps([]);
    setPhase('updating');
    try {
      const res = await fetch(`/api/deploy/instance/${sessionId}/provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiToken: connect.installerToken.trim(),
          ...(pastedToken ? { catalogToken: catalogToken.trim() } : {}),
          accountId: target.accountId,
          instanceName: target.instanceName,
          customDomain: target.customDomain ?? undefined,
        }),
      });
      if (res.status === 409) {
        startPolling(sessionId);
        return;
      }
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `update request failed (${res.status})`);
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
          setVersions(v => ({ ...v, current: v.latest }));
          setPhase('done');
        } else if (payload.type === 'error') {
          setError(payload.message);
          setPhase('failed');
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'update failed');
      setPhase('failed');
    } finally {
      setBusy(false);
    }
  };

  const installs = connect.existingInstalls;
  const upToDate = Boolean(
    versions.latest && target?.deployedVersion && versions.latest === target.deployedVersion
  );

  return (
    <WizardShell
      title="Update Traks"
      subtitle="Bring your instance to the latest release — data and settings stay"
      progress={{ current: PHASE_INDEX[phase], total: 3 }}
    >
      {phase === 'connect' && (
        <Card>
          <h2 className="mb-1 text-[16.5px] font-bold text-[#3D3B4F]">
            Connect your Cloudflare account
          </h2>
          <p className="mb-5 text-[13px] leading-relaxed text-[#9B99A6]">
            Sign in (or paste the same installer token you used before) so we can find your
            instance. Nothing is stored — access is for this update only.
            {versions.latest && (
              <>
                {' '}
                Latest release: <span className="font-semibold text-[#3D3B4F]">
                  v{versions.latest}
                </span>
                .
              </>
            )}
          </p>
          {error && <ErrorBox>{error}</ErrorBox>}
          <ConnectSection connect={connect} />
          {connect.installerStatus === 'ok' && (
            <div className="mt-5 space-y-3">
              {installs.length === 0 ? (
                <NoteBox>
                  No Traks instance was found in{' '}
                  {connect.accounts.length === 1 ? 'this account' : 'these accounts'}. Looking to
                  install one?{' '}
                  <button
                    onClick={() => void navigate({ to: '/deploy' })}
                    className="font-semibold text-[#3D3B4F] underline-offset-2 hover:underline cursor-pointer"
                  >
                    Deploy Traks
                  </button>
                </NoteBox>
              ) : (
                installs.map(inst => (
                  <div
                    key={inst.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-[#EEEEF2] bg-[#F6F5F2] p-4"
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-[#3D3B4F]">
                        <span className="font-mono">{inst.instanceName}</span>
                        <span className="font-normal text-[#9B99A6]">
                          {' '}
                          in {connect.accounts.find(a => a.id === inst.accountId)?.name ?? 'account'}
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-[12px] text-[#9B99A6]">
                        {inst.deployedVersion ? `v${inst.deployedVersion}` : 'version unknown'}
                        {versions.latest &&
                          (versions.latest === inst.deployedVersion ? (
                            <> · up to date</>
                          ) : (
                            <span className="font-semibold text-[#3D3B4F]">
                              {' '}
                              · v{versions.latest} available
                            </span>
                          ))}
                        {inst.apiUrl && <> · {inst.apiUrl.replace('https://', '')}</>}
                      </p>
                    </div>
                    <PrimaryButton onClick={() => void pickTarget(inst)} busy={busy}>
                      {versions.latest && versions.latest === inst.deployedVersion
                        ? 'Re-run update'
                        : 'Update'}
                      <ArrowRight className="h-4 w-4" />
                    </PrimaryButton>
                  </div>
                ))
              )}
            </div>
          )}
        </Card>
      )}

      {phase === 'confirm' && target && (
        <Card
          footer={
            <>
              <BackButton onClick={() => setPhase('connect')} disabled={busy} />
              <PrimaryButton
                onClick={() => void runUpdate()}
                busy={busy}
                disabled={catalogRequired !== false && catalogToken.trim().length < 20}
              >
                <RotateCw className="h-4 w-4" />
                {upToDate ? 'Re-run update' : `Update to v${versions.latest ?? 'latest'}`}
              </PrimaryButton>
            </>
          }
        >
          <h2 className="mb-1 text-[16.5px] font-bold text-[#3D3B4F]">Confirm the update</h2>
          <p className="mb-5 text-[13px] leading-relaxed text-[#9B99A6]">
            The deploy re-runs on this same instance — your sites, data, and settings stay exactly
            as they are.
          </p>
          {error && <ErrorBox>{error}</ErrorBox>}
          {upToDate && (
            <NoteBox>
              This instance already runs the latest release — re-running is safe and simply
              re-applies it.
            </NoteBox>
          )}
          <div className="mb-4 rounded-2xl border border-[#EEEEF2] bg-[#F6F5F2] p-4">
            <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-[#6E6C7C]">
              <li>
                Instance: <span className="font-mono text-[#3D3B4F]">{target.instanceName}</span>
                <span className="text-[#9B99A6]">
                  {' '}
                  in {connect.accounts.find(a => a.id === target.accountId)?.name ?? 'your account'}
                </span>
              </li>
              <li>
                Version:{' '}
                <span className="font-semibold text-[#3D3B4F]">
                  {target.deployedVersion ? `v${target.deployedVersion}` : 'unknown'}
                </span>{' '}
                → <span className="font-semibold text-[#3D3B4F]">v{versions.latest ?? '…'}</span>
              </li>
              <li>
                Domain:{' '}
                <span className="font-mono text-[#3D3B4F]">
                  {target.customDomain
                    ? `${target.customDomain.subdomain ? `${target.customDomain.subdomain}.` : ''}${target.customDomain.zoneName}`
                    : (target.apiUrl?.replace('https://', '') ?? 'workers.dev')}
                </span>{' '}
                <span className="text-[#9B99A6]">(unchanged)</span>
              </li>
            </ul>
          </div>
          {catalogRequired === undefined ? (
            <p className="flex items-center gap-2 text-[12.5px] text-[#9B99A6]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking what this update needs…
            </p>
          ) : catalogRequired ? (
            <>
              <ErrorBox>
                {catalogReason ??
                  'This instance is missing part of its analytics storage, so this update needs a storage token to repair it.'}
              </ErrorBox>
              <TokenField
                id="catalog-token"
                label="Analytics storage token"
                help="Needed for this one repair — it stays with your instance."
                linkLabel="Create storage token (pre-filled)"
                linkUrl={catalogTokenUrl(target.accountId ?? undefined)}
                value={catalogToken}
                onChange={v => {
                  setCatalogToken(v);
                  setCatalogStatus(undefined);
                }}
                status={catalogStatus}
                statusDetail={catalogDetail}
                errorHelp="Use the pre-filled storage-token link (scoped to the selected account), click “Create Token”, and paste the token value — not the token ID."
              />
            </>
          ) : (
            <p className="text-[11.5px] leading-relaxed text-[#9B99A6]">
              No storage token needed — this instance&rsquo;s data warehouse is healthy, so the
              update only refreshes the workers, dashboard, and database schema.
            </p>
          )}
        </Card>
      )}

      {(phase === 'updating' || phase === 'failed') && (
        <Card
          footer={
            phase === 'failed' ? (
              <>
                <BackButton onClick={() => setPhase('connect')} disabled={busy} />
                {target && (
                  <PrimaryButton onClick={() => void runUpdate()} busy={busy}>
                    <RotateCw className="h-4 w-4" />
                    Retry update
                  </PrimaryButton>
                )}
              </>
            ) : undefined
          }
        >
          <h2 className="mb-1 text-[16.5px] font-bold text-[#3D3B4F]">Updating Traks</h2>
          <p className="mb-5 text-[13px] text-[#9B99A6]">
            Re-running the deploy on your instance — safe to leave open
          </p>
          <StepList steps={steps} startingLabel="Starting the update…" />
          {phase === 'failed' && error && (
            <p className="mt-4 rounded-xl bg-[#F7DCD4] px-4 py-3 text-[12.5px] leading-relaxed text-[#8F3B2C]">
              {error} — retries are safe; updates re-use everything already in place.
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
              Updated to v{versions.latest ?? 'the latest release'} 🎉
            </h2>
            <p className="mb-5 mt-1 text-[13px] text-[#9B99A6]">
              Your data and settings are untouched — the new version is live now.
            </p>
            <a
              href={result.apiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-[#E5E5EB] bg-white px-5 py-2.5 text-[13.5px] font-semibold text-[#3D3B4F] hover:border-[#cbcad4] transition-colors"
            >
              {result.apiUrl.replace('https://', '')}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </Card>
      )}
    </WizardShell>
  );
}
