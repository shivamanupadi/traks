import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Check, CheckCircle2, ExternalLink, RotateCw } from 'lucide-react';
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
import { ReleaseNotes, entriesBetween, compareVersions, useChangelog } from '@/changelog/shared';

export const Route = createFileRoute('/update')({
  component: UpdateWizard,
  validateSearch: (search: Record<string, unknown>): { instance?: string } => ({
    instance: typeof search.instance === 'string' ? search.instance : undefined,
  }),
});

type Phase = 'connect' | 'updating' | 'failed' | 'done';

const PHASE_INDEX: Record<Phase, number> = {
  connect: 0,
  updating: 1,
  failed: 1,
  done: 2,
};

const INTERRUPTED_MSG =
  'The previous update was interrupted before it finished. Re-connect and run it again; updates are safe to re-run.';

/**
 * Update flow: connect, then one "Update" click on the instance. There is no
 * separate confirm screen: the click runs the preflight probe, and only when
 * that probe says this instance is missing part of its storage does a token
 * field unfold under the row. A healthy instance updates in a single click.
 * Its URL is what the dashboards' "new version available" banner links to.
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

  // Storage-token repair state, scoped to the row that needs it.
  const [tokenFor, setTokenFor] = useState<string | null>(null);
  const [tokenReason, setTokenReason] = useState<string | null>(null);
  const [catalogToken, setCatalogToken] = useState('');
  const [catalogStatus, setCatalogStatus] = useState<'checking' | 'ok' | 'bad' | undefined>();
  const [catalogDetail, setCatalogDetail] = useState<string | undefined>();

  const [versions, setVersions] = useState<{ current?: string; latest?: string }>({});
  const changelog = useChangelog();
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [result, setResult] = useState<{
    apiUrl: string;
    collectUrl: string;
    claimCode?: string;
  } | null>(null);
  const startedRef = useRef(false);
  const pollRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (connect.oauthError) setError(connect.oauthError);
  }, [connect.oauthError]);

  // A session is needed for OAuth state and every API call - mint one when
  // the page is opened directly without ?instance=.
  useEffect(() => {
    if (sessionId) return;
    void createSession()
      .then(id => {
        setSessionId(id);
        void navigate({ to: '/update', search: { instance: id }, replace: true });
      })
      .catch(() =>
        setError('Could not reach the server to start. Check your connection and try again.')
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

  // Resume the ?instance= session: a running row gets watched live; a
  // failed one explains itself; a fresh row just connects.
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
   * A session row bound to one instance can only drive that instance - pick
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

  /** Does this update need a storage token? A probe that cannot answer is
   *  read conservatively as "yes". */
  const preflight = async (
    session: string,
    inst: ExistingInstall
  ): Promise<{ needed: boolean; reason: string | null }> => {
    const token = connect.installerToken.trim();
    if (token.length < 20 || !inst.accountId || !inst.instanceName) {
      return { needed: false, reason: null };
    }
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
      if (!res.ok) return { needed: true, reason: null };
      const { data } = (await res.json()) as {
        data: { catalogTokenNeeded: boolean; reason: string | null };
      };
      return { needed: data.catalogTokenNeeded, reason: data.reason };
    } catch {
      return { needed: true, reason: null };
    }
  };

  const checkCatalog = async (session: string, inst: ExistingInstall): Promise<boolean> => {
    setCatalogStatus('checking');
    try {
      const res = await fetch(`/api/deploy/instance/${session}/verify-catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          catalogToken: catalogToken.trim(),
          accountId: inst.accountId ?? connect.accountId,
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
      setCatalogDetail('Could not reach the server. Check your connection and try again.');
      return false;
    }
  };

  const provision = async (session: string, inst: ExistingInstall): Promise<void> => {
    const pastedToken = catalogToken.trim().length >= 20;
    setSteps([]);
    setPhase('updating');
    try {
      const res = await fetch(`/api/deploy/instance/${session}/provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiToken: connect.installerToken.trim(),
          ...(pastedToken ? { catalogToken: catalogToken.trim() } : {}),
          accountId: inst.accountId,
          instanceName: inst.instanceName,
          customDomain: inst.customDomain ?? undefined,
        }),
      });
      if (res.status === 409) {
        startPolling(session);
        return;
      }
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `update request failed (${res.status})`);
      }
      await readSse<
        | ({ type: 'step' } & StepEvent)
        | { type: 'done'; apiUrl: string; collectUrl: string; claimCode?: string }
        | { type: 'error'; message: string }
      >(res, payload => {
        if (payload.type === 'step') {
          setSteps(prev => collapse([...prev, payload]));
        } else if (payload.type === 'done') {
          setResult({
            apiUrl: payload.apiUrl,
            collectUrl: payload.collectUrl,
            claimCode: payload.claimCode,
          });
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
    }
  };

  /**
   * The one click. Binds the session, probes the instance, and either
   * starts the update or unfolds the storage-token field under the row.
   */
  const update = async (inst: ExistingInstall): Promise<void> => {
    if (!inst.instanceName || !inst.accountId) return;
    setBusy(true);
    setError('');
    try {
      const session = await ensureSessionFor(inst);
      setTarget(inst);
      connect.setAccountId(inst.accountId);
      setVersions(v => ({ ...v, current: inst.deployedVersion ?? undefined }));

      const hasToken = catalogToken.trim().length >= 20;
      if (tokenFor !== inst.id) {
        const probe = await preflight(session, inst);
        if (probe.needed && !hasToken) {
          setTokenFor(inst.id);
          setTokenReason(probe.reason);
          return;
        }
      }
      // A pasted token is verified before it is used; a healthy instance
      // updates without one and the server double-checks anyway.
      if (hasToken && catalogStatus !== 'ok' && !(await checkCatalog(session, inst))) return;
      if (tokenFor === inst.id && !hasToken) return;
      await provision(session, inst);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const retry = async (): Promise<void> => {
    if (!target || !sessionId) return;
    setBusy(true);
    setError('');
    try {
      await provision(sessionId, target);
    } finally {
      setBusy(false);
    }
  };

  const installs = connect.existingInstalls;
  const latest = versions.latest;

  // "What this update brings": every release newer than the oldest connected
  // instance, up to the latest. Before connecting (or when no version is
  // known) only the latest release is shown; older ones stay collapsed.
  const oldestInstalled = installs
    .map(i => i.deployedVersion)
    .filter((v): v is string => Boolean(v))
    .sort(compareVersions)[0];
  const notesFrom = oldestInstalled ?? versions.current;
  const pending = changelog
    ? notesFrom
      ? entriesBetween(changelog, notesFrom, latest)
      : changelog.slice(0, 1)
    : [];
  const olderNotes = changelog ? changelog.filter(e => !pending.includes(e)) : [];
  const accountName = (id: string | null | undefined): string =>
    connect.accounts.find(a => a.id === id)?.name ?? 'your account';

  return (
    <WizardShell
      title="Update Traks"
      subtitle={
        latest
          ? `Latest release v${latest}. Your data and settings stay.`
          : 'Data and settings stay'
      }
      progress={{ current: PHASE_INDEX[phase], total: 3 }}
    >
      {phase === 'connect' && (
        <Card>
          {connect.installerStatus !== 'ok' && (
            <>
              <h2 className="mb-1 text-[16.5px] font-bold text-[#3D3B4F]">
                Connect your Cloudflare account
              </h2>
              <p className="mb-5 text-[13px] leading-relaxed text-[#9B99A6]">
                So we can find your instance. The access token is used for this update only and
                never stored.
              </p>
            </>
          )}
          {error && <ErrorBox>{error}</ErrorBox>}
          <ConnectSection connect={connect} compactToken />

          {connect.installerStatus === 'ok' && (
            <div className="mt-5">
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
                <>
                  <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#9B99A6]">
                    {installs.length === 1 ? 'Your instance' : 'Your instances'}
                  </p>
                  <ul className="space-y-2.5">
                    {installs.map(inst => {
                      const upToDate = Boolean(latest && latest === inst.deployedVersion);
                      const needsToken = tokenFor === inst.id;
                      const rowBusy = busy && target?.id === inst.id;
                      const canRun = !needsToken || catalogToken.trim().length >= 20;
                      return (
                        <li
                          key={inst.id}
                          className="rounded-2xl border border-[#EEEEF2] bg-[#F6F5F2] p-4"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-[13.5px] font-semibold text-[#3D3B4F]">
                                <span className="font-mono">{inst.instanceName}</span>
                                {connect.accounts.length > 1 && (
                                  <span className="font-normal text-[#9B99A6]">
                                    {' '}
                                    in {accountName(inst.accountId)}
                                  </span>
                                )}
                              </p>
                              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[#9B99A6]">
                                {upToDate ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#3D3B4F]">
                                    <Check className="h-3 w-3" strokeWidth={2.4} />v
                                    {inst.deployedVersion} · up to date
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#3D3B4F]">
                                    <span className="text-[#9B99A6]">
                                      {inst.deployedVersion
                                        ? `v${inst.deployedVersion}`
                                        : 'unknown'}
                                    </span>
                                    <ArrowRight className="h-3 w-3 text-[#9B99A6]" />v
                                    {latest ?? '…'}
                                  </span>
                                )}
                                {inst.apiUrl && (
                                  <span className="truncate">
                                    {inst.apiUrl.replace('https://', '')}
                                  </span>
                                )}
                              </p>
                            </div>
                            <PrimaryButton
                              onClick={() => void update(inst)}
                              busy={rowBusy}
                              disabled={(busy && !rowBusy) || !canRun}
                            >
                              {upToDate ? (
                                <>
                                  <RotateCw className="h-4 w-4" />
                                  Re-run
                                </>
                              ) : (
                                <>
                                  Update
                                  <ArrowRight className="h-4 w-4" />
                                </>
                              )}
                            </PrimaryButton>
                          </div>

                          {needsToken && (
                            <div className="mt-4 border-t border-[#E6E4DE] pt-4">
                              <p className="mb-3 rounded-xl bg-[#F7DCD4] px-3.5 py-2.5 text-[12px] leading-relaxed text-[#8F3B2C]">
                                {tokenReason ??
                                  'This instance is missing part of its analytics storage, so this update needs a storage token to repair it.'}
                              </p>
                              <TokenField
                                id={`catalog-token-${inst.id}`}
                                label="Analytics storage token"
                                help="Needed for this one repair; it stays with your instance."
                                linkLabel="Create storage token (pre-filled)"
                                linkUrl={catalogTokenUrl(inst.accountId ?? undefined)}
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
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-4 text-[11.5px] leading-relaxed text-[#9B99A6]">
                    The deploy re-runs on the same instance. Sites, data, and domain stay exactly as
                    they are.
                  </p>
                </>
              )}
            </div>
          )}

          {changelog && changelog.length > 0 && (
            <div className="mt-6 border-t border-[#EEEEF2] pt-5">
              <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#9B99A6]">
                {pending.length > 1
                  ? `What this update brings (${pending.length} releases)`
                  : notesFrom && pending.length === 1
                    ? 'What this update brings'
                    : 'Latest release'}
              </p>
              {pending.length === 0 ? (
                <p className="text-[12.5px] text-[#9B99A6]">
                  You are on the latest release. Nothing new to install.
                </p>
              ) : (
                <div className="space-y-5">
                  {pending.map(entry => (
                    <ReleaseNotes key={entry.version} entry={entry} />
                  ))}
                </div>
              )}
              {olderNotes.length > 0 && (
                <details className="group mt-4">
                  <summary className="cursor-pointer list-none text-[12.5px] font-semibold text-[#3D3B4F] underline-offset-2 hover:underline">
                    Earlier releases ({olderNotes.length})
                  </summary>
                  <div className="mt-4 space-y-5 border-l-2 border-[#EEEEF2] pl-4">
                    {olderNotes.map(entry => (
                      <ReleaseNotes key={entry.version} entry={entry} />
                    ))}
                  </div>
                </details>
              )}
              <p className="mt-4 text-[12px] text-[#9B99A6]">
                Full history at{' '}
                <a
                  href="/changelog"
                  className="font-semibold text-[#3D3B4F] underline-offset-2 hover:underline"
                >
                  traks.dev/changelog
                </a>
                .
              </p>
            </div>
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
                  <PrimaryButton onClick={() => void retry()} busy={busy}>
                    <RotateCw className="h-4 w-4" />
                    Retry update
                  </PrimaryButton>
                )}
              </>
            ) : undefined
          }
        >
          <h2 className="mb-1 text-[16.5px] font-bold text-[#3D3B4F]">
            {phase === 'failed' ? 'Update did not finish' : 'Updating'}
            {target && (
              <>
                {' '}
                <span className="font-mono">{target.instanceName}</span>
              </>
            )}
            {latest && phase !== 'failed' && (
              <span className="font-normal text-[#9B99A6]"> to v{latest}</span>
            )}
          </h2>
          <p className="mb-5 text-[13px] text-[#9B99A6]">
            {phase === 'failed'
              ? 'Retries are safe; updates re-use everything already in place.'
              : 'Safe to leave open, safe to come back to.'}
          </p>
          {phase === 'failed' && error && <ErrorBox>{error}</ErrorBox>}
          <StepList steps={steps} startingLabel="Starting the update…" />
        </Card>
      )}

      {phase === 'done' && result && (
        <Card
          footer={
            <a
              href={
                result.claimCode
                  ? `${result.apiUrl}/login?claim=${encodeURIComponent(result.claimCode)}`
                  : result.apiUrl
              }
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
              Updated to v{latest ?? 'the latest release'}
            </h2>
            <p className="mb-5 mt-1 text-[13px] text-[#9B99A6]">
              Your data and settings are untouched. The new version is live now.
            </p>
            {result.claimCode && (
              <p className="mb-5 -mt-3 max-w-[420px] text-[12.5px] leading-relaxed text-[#6E6C7C]">
                This instance is still unclaimed. A fresh claim code was issued - open it from this
                page to create the owner account. Claim code:{' '}
                <span className="select-all font-mono">{result.claimCode}</span>
              </p>
            )}
            <a
              href={
                result.claimCode
                  ? `${result.apiUrl}/login?claim=${encodeURIComponent(result.claimCode)}`
                  : result.apiUrl
              }
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
