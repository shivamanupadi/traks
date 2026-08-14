import { useState, type FormEvent, type ReactElement } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Layers, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';
import { api, ApiError } from '@/lib/api';
import { FieldError } from '@/components/ui/field-error';
import { emailError, passwordError, requiredTextError } from '@traks/shared';

export const Route = createFileRoute('/invite/$token')({
  component: InvitePage,
});

function InvitePage(): ReactElement {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const { data: session, isPending: sessionPending } = authClient.useSession();

  const {
    data: inviteData,
    isLoading,
    error: inviteError,
  } = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.getInvitation(token),
    retry: false,
  });
  const invite = (inviteData as any)?.data;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldsTouched, setFieldsTouched] = useState(false);

  const lockedEmail: string | null = invite?.email ?? null;

  const joinAsExisting = async (): Promise<void> => {
    setError('');
    setSubmitting(true);
    try {
      const result = await api.acceptInvitation(token);
      localStorage.setItem('traks-workspace', result.data.workspaceId);
      navigate({ to: '/portal/sites' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  };

  const signUpAndJoin = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setFieldsTouched(true);
    const signUpEmail = lockedEmail ?? email;
    // Checked here as well as by the browser: the same rules run on the API,
    // and a rejection there costs a round trip to say the same thing.
    const firstProblem =
      requiredTextError(name, 100, 'Your name') ??
      (lockedEmail ? null : emailError(signUpEmail)) ??
      passwordError(password);
    if (firstProblem) {
      setError(firstProblem);
      return;
    }
    setSubmitting(true);
    // inviteToken rides along in the sign-up body; the API's auth hooks
    // validate it and attach the workspace membership.
    const result = await authClient.signUp.email({
      email: signUpEmail,
      password,
      name: name.trim() || signUpEmail.split('@')[0],
      inviteToken: token,
    } as Parameters<typeof authClient.signUp.email>[0]);
    if (result.error) {
      setError(result.error.message || 'Something went wrong');
      setSubmitting(false);
      return;
    }
    navigate({ to: '/portal/sites' });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F9F8F6] px-4 py-12">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex flex-col items-center">
          <img src="/logo.svg" alt="Traks" className="h-11 w-11" />
          <span className="mt-3 text-[19px] font-bold tracking-tight text-[#3D3B4F]">Traks</span>
        </div>

        <div className="rounded-[20px] border border-[#E9E9EE] bg-white p-8 shadow-float">
          {isLoading || sessionPending ? (
            <p className="py-8 text-center text-[14px] text-[#9B99A6]">Loading invitation...</p>
          ) : inviteError || !invite ? (
            <div className="py-4 text-center">
              <p className="text-[16px] font-semibold text-[#3D3B4F]">
                This invitation isn&rsquo;t valid
              </p>
              <p className="mx-auto mt-2 max-w-[300px] text-[13px] text-[#9B9590]">
                It may have expired, been revoked, or already been used. Ask the workspace owner for
                a new link.
              </p>
              <Link
                to="/login"
                className="mt-5 inline-flex h-10 items-center rounded-full bg-[#3D3B4F] px-5 text-[13px] font-semibold text-white transition-colors hover:bg-[#2C2B3B]"
              >
                Go to sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                  <Layers className="h-5 w-5 text-foreground" strokeWidth={1.7} />
                </div>
                <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-[#3D3B4F]">
                  Join {invite.workspaceName}
                </h1>
                <p className="mt-1 text-[13px] text-[#9B9590]">
                  {invite.invitedBy} invited you to the{' '}
                  <span className="font-semibold text-[#3D3B4F]">{invite.workspaceName}</span>{' '}
                  workspace as {invite.role === 'owner' ? 'an owner' : 'a member'}.
                </p>
              </div>

              {session ? (
                <div>
                  <p className="mb-4 text-[13px] text-[#9B9590]">
                    You&rsquo;re signed in as{' '}
                    <span className="font-semibold text-[#3D3B4F]">{session.user.email}</span>.
                  </p>
                  <Button
                    onClick={() => void joinAsExisting()}
                    isLoading={submitting}
                    className="w-full text-[13.5px]"
                  >
                    <UserPlus className="h-4 w-4" />
                    Join workspace
                  </Button>
                </div>
              ) : (
                <form onSubmit={e => void signUpAndJoin(e)} className="space-y-4">
                  <div>
                    <label className="mb-2 block text-[13px] font-medium text-[#3D3B4F]">
                      Your name
                    </label>
                    <Input
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="Ada Lovelace"
                      maxLength={100}
                      required
                      aria-invalid={fieldsTouched && !!requiredTextError(name, 100, 'Your name')}
                      className="h-11 px-4 text-[14px]"
                      autoFocus
                    />
                    <FieldError
                      message={fieldsTouched ? requiredTextError(name, 100, 'Your name') : null}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-[13px] font-medium text-[#3D3B4F]">
                      Email
                    </label>
                    <Input
                      type="email"
                      value={lockedEmail ?? email}
                      onChange={e => setEmail(e.target.value)}
                      disabled={!!lockedEmail}
                      required
                      placeholder="you@example.com"
                      className="h-11 px-4 text-[14px]"
                    />
                    {lockedEmail && (
                      <p className="mt-1.5 text-[12px] text-[#B5B0AA]">
                        This invitation is for {lockedEmail}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="mb-2 block text-[13px] font-medium text-[#3D3B4F]">
                      Password
                    </label>
                    <Input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      minLength={8}
                      placeholder="At least 8 characters"
                      className="h-11 px-4 text-[14px]"
                    />
                  </div>
                  {error && <p className="text-[13px] text-[#e5484d]">{error}</p>}
                  <Button type="submit" isLoading={submitting} className="w-full text-[13.5px]">
                    <UserPlus className="h-4 w-4" />
                    Create account &amp; join
                  </Button>
                  <p className="text-center text-[12px] text-[#B5B0AA]">
                    Already have an account here?{' '}
                    <Link to="/login" className="font-semibold text-[#3D3B4F] hover:underline">
                      Sign in
                    </Link>{' '}
                    first, then open this link again.
                  </p>
                </form>
              )}
              {session && error && <p className="mt-3 text-[13px] text-[#e5484d]">{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
