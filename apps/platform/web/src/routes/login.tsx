import { useEffect, useState, type ReactElement, type FormEvent } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Activity, Filter, Lock, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

const FEATURES = [
  {
    icon: ShieldCheck,
    title: 'Cookieless & private',
    desc: 'No cookies, no fingerprinting, no consent banners needed.',
  },
  {
    icon: Lock,
    title: 'Yours, entirely',
    desc: 'Runs in your own Cloudflare account. Data never leaves it.',
  },
  {
    icon: Activity,
    title: 'Live by default',
    desc: 'Realtime visitors, pageviews, and goals as they happen.',
  },
  {
    icon: Filter,
    title: 'Deep when you need it',
    desc: 'Funnels, saved segments, UTM breakdowns, custom events.',
  },
];

function BrandPanel(): ReactElement {
  return (
    <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-[#3D3B4F] p-12 lg:flex">
      {/* dot grid on ink */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.09) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
          maskImage: 'linear-gradient(to bottom, black 0%, transparent 75%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 75%)',
        }}
      />
      <div className="relative flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white shadow-md">
          <img src="/logo.svg" alt="" className="h-7 w-7" />
        </span>
        <span className="text-[20px] font-bold tracking-tight text-white">Traks</span>
      </div>

      <div className="relative">
        <h2 className="max-w-[380px] text-[28px] font-bold leading-[1.2] tracking-[-0.02em] text-white">
          Web analytics that lives in <span className="text-mint">your</span> Cloudflare account
        </h2>
        <div className="mt-9 space-y-6">
          {FEATURES.map(f => (
            <div key={f.title} className="flex items-start gap-3.5">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10">
                <f.icon className="h-4 w-4 text-mint" strokeWidth={2} />
              </span>
              <div>
                <p className="text-[14px] font-semibold text-white">{f.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-white/55">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="relative font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-white/35">
        Self-hosted · traks.dev
      </p>
    </div>
  );
}

function LoginPage(): ReactElement {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();
  // null = loading; false = claimed (sign in); true = first run (create owner)
  const [firstRun, setFirstRun] = useState<boolean | null>(null);
  // The wizard's done card links here with ?claim=<code>&email=<owner>; the
  // code is what authorises the first sign-up (instance URLs are guessable).
  const urlParams = new URLSearchParams(window.location.search);
  const [claimCode, setClaimCode] = useState(urlParams.get('claim') ?? '');
  const [needsCode, setNeedsCode] = useState(false);
  const [email, setEmail] = useState(urlParams.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isPending && session) {
      navigate({ to: '/portal/sites' });
    }
  }, [isPending, session, navigate]);

  useEffect(() => {
    fetch('/api/claim-status')
      .then(res => res.json() as Promise<{ claimed: boolean; needsCode?: boolean }>)
      .then(data => {
        setFirstRun(!data.claimed);
        setNeedsCode(Boolean(data.needsCode));
      })
      .catch(() => setFirstRun(false));
  }, []);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const result = firstRun
      ? await authClient.signUp.email({
          email,
          password,
          name: email.split('@')[0],
          // Validated by the API's sign-up hook against the CLAIM_TOKEN secret.
          claimToken: claimCode.trim(),
        } as Parameters<typeof authClient.signUp.email>[0])
      : await authClient.signIn.email({ email, password });
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message || 'Something went wrong');
      return;
    }
    navigate({ to: '/portal/sites' });
  };

  return (
    <div className="flex min-h-screen bg-[#F9F8F6]">
      <BrandPanel />

      <div className="relative flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="relative w-full max-w-[384px]">
          <div className="mb-9 flex flex-col items-center lg:hidden">
            <img src="/logo.svg" alt="Traks" className="h-11 w-11" />
            <span className="mt-3 text-[19px] font-bold tracking-tight text-[#3D3B4F]">Traks</span>
          </div>

          <div className="rounded-[20px] bg-white p-8 shadow-float">
            {firstRun === null ? (
              <p className="py-8 text-center text-[14px] text-[#9B99A6]">Loading...</p>
            ) : (
              <>
                <div className="mb-6">
                  <h1 className="text-[18px] font-bold tracking-[-0.01em] text-[#3D3B4F]">
                    {firstRun ? 'Create your owner account' : 'Sign in'}
                  </h1>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-[#9B99A6]">
                    {firstRun
                      ? 'This instance is unclaimed. The account you create here becomes its owner, and sign-ups close afterwards.'
                      : 'Welcome back. Sign in to your dashboard.'}
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-[12.5px] font-semibold text-[#3D3B4F]">
                      Email
                    </label>
                    <Input
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="h-11 px-4 text-[14px]"
                      autoFocus={!email}
                    />
                    {firstRun && (
                      <p className="mt-1.5 text-[12px] text-[#B3B1BE]">
                        Deployed with Sign in with Cloudflare? Use that account’s email.
                      </p>
                    )}
                  </div>
                  {firstRun && needsCode && !urlParams.get('claim') && (
                    <div>
                      <label className="mb-1.5 block text-[12.5px] font-semibold text-[#3D3B4F]">
                        Claim code
                      </label>
                      <Input
                        type="text"
                        required
                        autoComplete="off"
                        spellCheck={false}
                        value={claimCode}
                        onChange={e => setClaimCode(e.target.value)}
                        className="h-11 px-4 font-mono text-[14px]"
                      />
                      <p className="mt-1.5 text-[12px] text-[#B3B1BE]">
                        Shown on the traks.dev deploy page when this instance was created. Lost it?
                        Run Update there to get a new one.
                      </p>
                    </div>
                  )}
                  <div>
                    <label className="mb-1.5 block text-[12.5px] font-semibold text-[#3D3B4F]">
                      Password
                    </label>
                    <Input
                      type="password"
                      required
                      minLength={8}
                      autoComplete={firstRun ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="h-11 px-4 text-[14px]"
                      autoFocus={Boolean(email)}
                    />
                    {firstRun && (
                      <p className="mt-1.5 text-[12px] text-[#B3B1BE]">At least 8 characters</p>
                    )}
                  </div>

                  {error && <p className="text-[13px] text-[#e5484d]">{error}</p>}

                  <Button
                    type="submit"
                    isLoading={submitting}
                    className="mt-1 h-[46px] w-full text-[14px]"
                  >
                    {firstRun ? 'Create account' : 'Sign in'}
                  </Button>
                </form>
              </>
            )}
          </div>

          <p className="mt-7 text-center font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#B3B1BE]">
            Self-hosted instance · {window.location.host}
          </p>
        </div>
      </div>
    </div>
  );
}
