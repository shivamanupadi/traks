import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { SignUp, useAuth } from '@clerk/clerk-react';
import { useEffect } from 'react';

export const Route = createFileRoute('/signup')({
  component: SignupPage,
});

function SignupPage(): React.ReactNode {
  const { isSignedIn, isLoaded } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      navigate({ to: '/portal/sites' });
    }
  }, [isLoaded, isSignedIn, navigate]);

  return (
    <div className="min-h-screen flex bg-white">
      {/* Left side — Sign up form */}
      <div className="flex-1 flex flex-col justify-center px-6 py-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          {/* Back button */}
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm font-medium">Back</span>
          </Link>

          {/* Clerk SignUp */}
          <SignUp routing="hash" signInUrl="/login" forceRedirectUrl="/portal/sites" />

          {/* Footer */}
          <p className="text-center text-sm text-muted-foreground mt-8">
            Already have an account?{' '}
            <Link
              to="/login"
              className="font-semibold text-foreground hover:text-[#9b72cf] transition-colors"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>

      {/* Right side — Creative showcase */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-bl from-[#e07a5f]/5 via-white to-[#f3f0f7]/50 relative overflow-hidden">
        {/* Dot pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'radial-gradient(circle, #2D3436 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center justify-center w-full p-12">
          {/* Main showcase — setup snippet */}
          <div className="relative w-full max-w-sm">
            <div className="relative transform hover:scale-[1.02] transition-all duration-500 cursor-pointer group">
              {/* Washi tape */}
              <div className="absolute -top-3 left-8 w-16 h-6 bg-[#9b72cf]/20 rounded-sm transform -rotate-2" />
              <div className="absolute -top-3 right-8 w-12 h-6 bg-[#5b9a6f]/20 rounded-sm transform rotate-3" />

              <div className="bg-white p-5 rounded-lg shadow-[0_15px_50px_-12px_rgba(0,0,0,0.15)] group-hover:shadow-[0_25px_60px_-12px_rgba(0,0,0,0.2)] transition-shadow">
                <div className="mb-4">
                  <span className="text-[13px] font-semibold text-[#2D3436]">Quick setup</span>
                </div>

                <div className="bg-[#2D3436] rounded-lg p-4 font-mono text-[11px] leading-relaxed">
                  <div className="text-[#9B9590]">{'<!-- Add to your site -->'}</div>
                  <div className="mt-1">
                    <span className="text-[#e07a5f]">{'<script'}</span>
                    <span className="text-[#d4a574]"> defer</span>
                  </div>
                  <div className="pl-4">
                    <span className="text-[#d4a574]">data-site</span>
                    <span className="text-[#9B9590]">=</span>
                    <span className="text-[#5b9a6f]">"YOUR_KEY"</span>
                  </div>
                  <div className="pl-4">
                    <span className="text-[#d4a574]">src</span>
                    <span className="text-[#9B9590]">=</span>
                    <span className="text-[#5b9a6f]">"https://collect.traks.dev/t.js"</span>
                  </div>
                  <div>
                    <span className="text-[#e07a5f]">{'></script>'}</span>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <div className="flex -space-x-1">
                    <div className="w-5 h-5 rounded-full bg-[#9b72cf]/15 border-2 border-white" />
                    <div className="w-5 h-5 rounded-full bg-[#5b9a6f]/15 border-2 border-white" />
                    <div className="w-5 h-5 rounded-full bg-[#e07a5f]/15 border-2 border-white" />
                  </div>
                  <span className="text-[11px] text-[#9B9590]">Track all your sites</span>
                </div>
              </div>
            </div>

            {/* Floating accent card */}
            <div className="absolute -right-4 -bottom-8 transform rotate-6 hover:rotate-3 transition-all duration-300">
              <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-8 h-4 bg-[#e07a5f]/20 rounded-sm" />
              <div className="bg-white p-2.5 rounded-lg shadow-lg">
                <div className="w-20 h-20 bg-[#f3f0f7] rounded flex flex-col items-center justify-center gap-1">
                  <div className="text-[18px] font-bold text-[#9b72cf]">&lt;1KB</div>
                  <div className="text-[9px] text-[#9B9590]">script size</div>
                </div>
              </div>
            </div>
          </div>

          {/* Text */}
          <div className="mt-16 text-center">
            <h2 className="text-2xl font-semibold text-[#2D3436] mb-2">Start in minutes</h2>
            <p className="text-muted-foreground text-sm max-w-xs">
              Create an account and add analytics to your first site today
            </p>
          </div>

          {/* Decorative bars */}
          <div className="absolute bottom-8 left-8 flex gap-2 transform -rotate-[20deg]">
            <div className="w-3 h-16 rounded-t-full bg-[#5b9a6f]/30" />
            <div className="w-3 h-20 rounded-t-full bg-[#9b72cf]/30" />
            <div className="w-3 h-14 rounded-t-full bg-[#e07a5f]/30" />
          </div>
        </div>
      </div>
    </div>
  );
}
