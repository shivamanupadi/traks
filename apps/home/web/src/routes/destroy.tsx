import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowRight, CheckCircle2, Trash2 } from 'lucide-react';
import {
  Card,
  ConnectSection,
  DangerButton,
  ErrorBox,
  NoteBox,
  BackButton,
  StepList,
  TokenField,
  WizardShell,
  catalogTokenUrl,
  collapse,
  createSession,
  readSse,
  useConnect,
  type ExistingInstall,
  type StepEvent,
} from '../deploy/shared';

export const Route = createFileRoute('/destroy')({
  component: DestroyWizard,
  validateSearch: (search: Record<string, unknown>): { instance?: string } => ({
    instance: typeof search.instance === 'string' ? search.instance : undefined,
  }),
});

type Phase = 'connect' | 'confirm' | 'destroying' | 'destroyed';

const PHASE_INDEX: Record<Phase, number> = {
  connect: 0,
  confirm: 1,
  destroying: 2,
  destroyed: 2,
};

/**
 * Teardown flow, on its own page so it can never be mistaken for a deploy or
 * an update. Connect → pick the instance → type its name → destroy.
 */
function DestroyWizard(): ReactElement {
  const { instance: urlSession } = Route.useSearch();
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState(urlSession);
  const connect = useConnect('destroy', sessionId);

  const [phase, setPhase] = useState<Phase>('connect');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [target, setTarget] = useState<ExistingInstall | null>(null);
  const [confirmName, setConfirmName] = useState('');
  /** The instance the current session row is bound to (null = unbound). */
  const boundRef = useRef<string | null>(null);

  const [catalogToken, setCatalogToken] = useState('');
  // Whether the purge needs a storage token (OAuth sign-ins can't sign S3
  // deletes). `undefined` while the preflight probe is in flight so the
  // warning doesn't flash in and out; a failed probe resolves to true.
  const [catalogRequired, setCatalogRequired] = useState<boolean | undefined>(undefined);
  const [catalogReason, setCatalogReason] = useState<string | null>(null);

  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [retainedBucket, setRetainedBucket] = useState<string | null>(null);
  const [retainedReason, setRetainedReason] = useState<string | null>(null);
  const startedRef = useRef(false);

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
        void navigate({ to: '/destroy', search: { instance: id }, replace: true });
      })
      .catch(() =>
        setError('Could not reach the server to start. Check your connection and try again.')
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Learn what the ?instance= session is bound to, so a mismatched target
  // gets a fresh session instead of a server-side 403.
  useEffect(() => {
    if (!sessionId || startedRef.current) return;
    startedRef.current = true;
    void fetch(`/api/deploy/instance/${sessionId}`)
      .then(r => (r.ok ? (r.json() as Promise<{ data: { instanceName?: string } }>) : null))
      .then(res => {
        if (res?.data.instanceName) boundRef.current = res.data.instanceName;
      })
      .catch(() => undefined);
  }, [sessionId]);

  const ensureSessionFor = async (inst: ExistingInstall): Promise<string> => {
    if (!sessionId || (boundRef.current && boundRef.current !== inst.instanceName)) {
      const id = await createSession();
      boundRef.current = null;
      setSessionId(id);
      void navigate({ to: '/destroy', search: { instance: id }, replace: true });
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
          intent: 'destroy',
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
      setConfirmName('');
      setError('');
      setPhase('confirm');
      void runPreflight(session, inst);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const destroyRun = async (): Promise<void> => {
    if (!target?.instanceName || !target.accountId || !sessionId) return;
    setBusy(true);
    setError('');
    setSteps([]);
    setPhase('destroying');
    try {
      const res = await fetch(`/api/deploy/instance/${sessionId}/destroy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiToken: connect.installerToken.trim(),
          ...(catalogToken.trim().length >= 20 ? { catalogToken: catalogToken.trim() } : {}),
          accountId: target.accountId,
          instanceName: target.instanceName,
          confirmName: confirmName.trim(),
        }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `destroy request failed (${res.status})`);
      }
      await readSse<
        | ({ type: 'step' } & StepEvent)
        | { type: 'done'; retainedBucket?: string | null; retainedReason?: string | null }
        | { type: 'error'; message: string }
      >(res, payload => {
        if (payload.type === 'step') {
          setSteps(prev => collapse([...prev, payload]));
        } else if (payload.type === 'done') {
          setRetainedBucket(payload.retainedBucket ?? null);
          setRetainedReason(payload.retainedReason ?? null);
          connect.setExistingInstalls(prev =>
            prev.filter(
              i => !(i.accountId === target.accountId && i.instanceName === target.instanceName)
            )
          );
          setPhase('destroyed');
        } else if (payload.type === 'error') {
          setError(payload.message);
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'destroy failed');
    } finally {
      setBusy(false);
    }
  };

  const installs = connect.existingInstalls;

  return (
    <WizardShell
      title="Destroy a Traks instance"
      subtitle="Remove an instance and its data from your Cloudflare account"
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
                So we can find the instance to remove. The access token is used for this teardown
                only and never stored.
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
                  {connect.accounts.length === 1 ? 'this account' : 'these accounts'}, nothing to
                  destroy.
                </NoteBox>
              ) : (
                <>
                  <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#9B99A6]">
                    {installs.length === 1 ? 'Your instance' : 'Your instances'}
                  </p>
                  <ul className="space-y-2.5">
                    {installs.map(inst => (
                      <li
                        key={inst.id}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-[#EEEEF2] bg-[#F6F5F2] p-4"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px] font-semibold text-[#3D3B4F]">
                            <span className="font-mono">{inst.instanceName}</span>
                            {connect.accounts.length > 1 && (
                              <span className="font-normal text-[#9B99A6]">
                                {' '}
                                in{' '}
                                {connect.accounts.find(a => a.id === inst.accountId)?.name ??
                                  'account'}
                              </span>
                            )}
                          </p>
                          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[#9B99A6]">
                            {inst.deployedVersion && (
                              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#3D3B4F]">
                                v{inst.deployedVersion}
                              </span>
                            )}
                            {inst.apiUrl && (
                              <span className="truncate">
                                {inst.apiUrl.replace('https://', '')}
                              </span>
                            )}
                          </p>
                        </div>
                        <DangerButton onClick={() => void pickTarget(inst)} busy={busy}>
                          <Trash2 className="h-4 w-4" />
                          Destroy…
                        </DangerButton>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </Card>
      )}

      {phase === 'confirm' && target?.instanceName && (
        <Card
          footer={
            <>
              <BackButton onClick={() => setPhase('connect')} disabled={busy} />
              <DangerButton
                onClick={() => void destroyRun()}
                busy={busy}
                // Deliberately NOT gated on the storage token. Teardown
                // survives an un-emptiable bucket - everything else is
                // removed and the bucket is reported back - so a missing
                // token is a disclosed consequence, not a dead end.
                disabled={confirmName.trim() !== target.instanceName}
              >
                <Trash2 className="h-4 w-4" />
                Destroy instance
              </DangerButton>
            </>
          }
        >
          <h2 className="mb-1 text-[16.5px] font-bold text-[#B3402F]">
            Destroy {target.instanceName}?
          </h2>
          <p className="mb-4 text-[13px] leading-relaxed text-[#9B99A6]">
            This permanently deletes the instance and{' '}
            <span className="font-semibold text-[#3D3B4F]">all of its analytics data</span>. It
            cannot be undone.
          </p>
          <div className="mb-4 rounded-2xl border border-[#EEEEF2] bg-[#F6F5F2] p-4">
            <p className="mb-2 text-[12.5px] font-semibold text-[#3D3B4F]">
              Deleted from your Cloudflare account:
            </p>
            <ul className="space-y-1 text-[12px] leading-relaxed text-[#6E6C7C]">
              {(() => {
                const n = target.instanceName;
                const us = n.replaceAll('-', '_');
                return [
                  [
                    `${n}-api`,
                    'worker, your dashboard' +
                      (target.customDomain ? ' (custom domain detaches)' : ''),
                  ],
                  [`${n}-collect`, 'worker, the tracker endpoint'],
                  [`${n}-db`, 'D1 database: sites, users, settings'],
                  [`${n}-events`, 'R2 bucket: every analytics event ever collected'],
                  [`${n}-r2sql-cache`, 'KV namespace: query cache'],
                  [`${us}_events`, 'pipeline, stream, and sink'],
                ].map(([name, what]) => (
                  <li key={name}>
                    <span className="font-mono text-[#3D3B4F]">{name}</span>: {what}
                  </li>
                ));
              })()}
            </ul>
            <p className="mt-2 text-[11.5px] leading-relaxed text-[#9B99A6]">
              The ingest-failure metrics dataset has no delete API; its data expires on its own
              within 90 days.
            </p>
          </div>
          {catalogRequired === true && catalogToken.trim().length < 20 && (
            <>
              <ErrorBox>
                {catalogReason ??
                  'Removing your stored analytics needs a Cloudflare API token; the sign-in alone cannot delete R2 objects.'}{' '}
                Paste a storage token below, or destroy without it: everything else is removed and
                the events bucket stays, still costing R2 storage until you delete it yourself.
              </ErrorBox>
              <div className="mb-4">
                <TokenField
                  id="catalog-token"
                  label="Analytics storage token (optional)"
                  help="Lets the teardown empty and delete the events bucket."
                  linkLabel="Create storage token (pre-filled)"
                  linkUrl={catalogTokenUrl(target.accountId ?? undefined)}
                  value={catalogToken}
                  onChange={setCatalogToken}
                />
              </div>
            </>
          )}
          <label
            htmlFor="destroy-confirm"
            className="mb-1.5 block text-[12.5px] font-semibold text-[#3D3B4F]"
          >
            Type <span className="font-mono">{target.instanceName}</span> to confirm
          </label>
          <input
            id="destroy-confirm"
            value={confirmName}
            onChange={e => setConfirmName(e.target.value)}
            placeholder={target.instanceName}
            autoComplete="off"
            className="h-11 w-full rounded-2xl border-none bg-white px-4 font-mono text-[13.5px] text-[#3D3B4F] shadow-[inset_0_0_0_1px_#E5E5EB] transition-shadow placeholder:text-[#D8D7DE] focus:shadow-[inset_0_0_0_1.5px_#B3402F] focus:outline-none"
          />
          {error && (
            <p className="mt-4 rounded-xl bg-[#F7DCD4] px-4 py-3 text-[12.5px] leading-relaxed text-[#8F3B2C]">
              {error}
            </p>
          )}
        </Card>
      )}

      {phase === 'destroying' && (
        <Card
          footer={
            error ? (
              <>
                <BackButton onClick={() => setPhase('confirm')} disabled={busy} />
                <DangerButton onClick={() => void destroyRun()} busy={busy}>
                  Retry destroy
                </DangerButton>
              </>
            ) : undefined
          }
        >
          <h2 className="mb-1 text-[16.5px] font-bold text-[#3D3B4F]">
            Destroying {target?.instanceName}
          </h2>
          <p className="mb-5 text-[13px] text-[#9B9590]">
            Removing everything from your Cloudflare account
          </p>
          <StepList steps={steps} startingLabel="Starting the teardown…" showStarting={!error} />
          {error && (
            <p className="mt-4 rounded-xl bg-[#F7DCD4] px-4 py-3 text-[12.5px] leading-relaxed text-[#8F3B2C]">
              {error}. Retries are safe; already-deleted resources are skipped.
            </p>
          )}
        </Card>
      )}

      {phase === 'destroyed' && (
        <Card
          footer={
            <a
              href="/"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[#3D3B4F] px-6 text-[13.5px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-[#2C2B3B] hover:shadow-md"
            >
              Back to traks.dev
              <ArrowRight className="h-4 w-4" />
            </a>
          }
        >
          <div className="flex flex-col items-center pt-2 text-center">
            <CheckCircle2 className="mb-3 h-12 w-12 text-[#3D3B4F]" strokeWidth={1.5} />
            <h2 className="text-[17px] font-bold text-[#3D3B4F]">
              {retainedBucket ? 'Instance destroyed, one thing left' : 'Instance destroyed'}
            </h2>
            <p className="mb-2 mt-1 text-[13px] leading-relaxed text-[#9B99A6]">
              {retainedBucket
                ? 'The workers, database, KV namespace and pipeline are gone. Your tokens were used for this teardown only, so you can revoke them now.'
                : 'Everything was removed from your Cloudflare account. Your tokens were used for this teardown only, so you can revoke them in the Cloudflare dashboard now.'}
            </p>
            {retainedBucket && (
              <div className="mb-2 w-full rounded-xl bg-[#F7DCD4] px-4 py-3 text-left text-[12.5px] leading-relaxed text-[#8F3B2C]">
                <p className="font-semibold">
                  Your events bucket <code className="font-mono">{retainedBucket}</code> is still
                  there.
                </p>
                <p className="mt-1">
                  {retainedReason ?? 'It could not be emptied during teardown.'} It keeps costing R2
                  storage until you delete it. Do that from R2 in the Cloudflare dashboard, or
                  re-run this destroy with a storage token.
                </p>
              </div>
            )}
            <p className="text-[12px] text-[#9B99A6]">
              Changed your mind later? Installing fresh takes about two minutes.
            </p>
          </div>
        </Card>
      )}
    </WizardShell>
  );
}
