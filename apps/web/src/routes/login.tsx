import { useEffect, useState, type ReactElement, type FormEvent } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function LoginPage(): ReactElement {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();
  // null = loading; false = claimed (sign in); true = first run (create owner)
  const [firstRun, setFirstRun] = useState<boolean | null>(null);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [email, setEmail] = useState('');
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
      .then(res => res.json() as Promise<{ claimed: boolean; ownerEmail?: string }>)
      .then(data => {
        setFirstRun(!data.claimed);
        if (!data.claimed && data.ownerEmail) {
          setOwnerEmail(data.ownerEmail);
          setEmail(data.ownerEmail);
        }
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
        })
      : await authClient.signIn.email({ email, password });
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message || 'Something went wrong');
      return;
    }
    navigate({ to: '/portal/sites' });
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#FAFAFA] px-4 py-12">
      {/* faint dot grid, fading out below the card */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(61,59,79,0.06) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
          maskImage: 'linear-gradient(to bottom, black 0%, transparent 70%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 70%)',
        }}
      />

      <div className="relative w-full max-w-[384px]">
        <div className="mb-9 flex flex-col items-center">
          <img src="/logo.svg" alt="Traks" className="h-11 w-11" />
          <span className="mt-3 text-[19px] font-bold tracking-tight text-[#3D3B4F]">Traks</span>
        </div>

        <div className="rounded-[20px] border border-[#E9E9EE] bg-white p-8 shadow-float">
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
                    ? 'This instance is unclaimed. The account you create here becomes its owner — sign-ups close afterwards.'
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
                    readOnly={firstRun && ownerEmail !== ''}
                    className={`h-11 px-4 text-[14px] ${
                      firstRun && ownerEmail ? 'bg-[#F4F4F6] text-[#6E6C7C]' : ''
                    }`}
                    autoFocus={!(firstRun && ownerEmail)}
                  />
                  {firstRun && ownerEmail && (
                    <p className="mt-1.5 text-[12px] text-[#B3B1BE]">
                      Your Cloudflare account email — fixed when this instance was deployed.
                    </p>
                  )}
                </div>
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
                  />
                  {firstRun && (
                    <p className="mt-1.5 text-[12px] text-[#B3B1BE]">At least 8 characters</p>
                  )}
                </div>

                {error && <p className="text-[13px] text-[#e5484d]">{error}</p>}

                <Button
                  type="submit"
                  variant="dark"
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
  );
}
