import { useEffect, useState, type ReactElement, type FormEvent } from 'react';
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { Lock, UserPlus } from 'lucide-react';
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
      .then(res => res.json() as Promise<{ claimed: boolean }>)
      .then(data => setFirstRun(!data.claimed))
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
    <div className="min-h-screen bg-[#fdfbf8] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="flex items-center justify-center gap-2.5 mb-8">
          <img src="/logo64.png" alt="Traks" className="h-10 w-10 rounded-lg" />
          <span className="font-semibold text-[20px] text-[#2D3436] tracking-tight">Traks</span>
        </Link>

        <div className="rounded-2xl border border-[#e8e3ed] bg-white p-6 shadow-sm">
          {firstRun === null ? (
            <p className="py-8 text-center text-[14px] text-[#9B9590]">Loading...</p>
          ) : (
            <>
              <div className="mb-5">
                <div className="w-10 h-10 rounded-xl bg-[#9b72cf]/10 flex items-center justify-center mb-3">
                  {firstRun ? (
                    <UserPlus className="w-5 h-5 text-[#9b72cf]" strokeWidth={1.7} />
                  ) : (
                    <Lock className="w-5 h-5 text-[#9b72cf]" strokeWidth={1.7} />
                  )}
                </div>
                <h1 className="text-[18px] font-bold text-[#2D3436] tracking-[-0.01em]">
                  {firstRun ? 'Create your owner account' : 'Sign in'}
                </h1>
                <p className="mt-1 text-[13px] text-[#9B9590]">
                  {firstRun
                    ? 'This instance is unclaimed. The account you create here becomes its owner — sign-ups close afterwards.'
                    : 'Welcome back. Sign in to your dashboard.'}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-[#2D3436]">
                    Email
                  </label>
                  <Input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="rounded-xl h-11 border-[#e8e3ed] focus:border-[#9b72cf]/40 px-4 text-[14px]"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-[#2D3436]">
                    Password
                  </label>
                  <Input
                    type="password"
                    required
                    minLength={8}
                    autoComplete={firstRun ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="rounded-xl h-11 border-[#e8e3ed] focus:border-[#9b72cf]/40 px-4 text-[14px]"
                  />
                  {firstRun && (
                    <p className="mt-1.5 text-[12px] text-[#B5B0AA]">At least 8 characters</p>
                  )}
                </div>

                {error && <p className="text-[13px] text-[#e5484d]">{error}</p>}

                <Button
                  type="submit"
                  isLoading={submitting}
                  className="w-full h-11 rounded-xl bg-[#9b72cf] hover:bg-[#8a63bf] text-white text-[14px] font-semibold"
                >
                  {firstRun ? 'Create account' : 'Sign in'}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
