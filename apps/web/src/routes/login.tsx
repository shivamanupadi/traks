import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { SignIn, useAuth } from '@clerk/clerk-react';
import { useEffect } from 'react';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function LoginPage(): React.ReactNode {
  const { isSignedIn, isLoaded } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      navigate({ to: '/portal/sites' });
    }
  }, [isLoaded, isSignedIn, navigate]);

  return (
    <div className="min-h-screen flex bg-white">
      {/* Left side - Sign in form */}
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

          {/* Clerk SignIn */}
          <SignIn routing="hash" signUpUrl="/signup" forceRedirectUrl="/portal/sites" />

          {/* Footer */}
          <p className="text-center text-sm text-muted-foreground mt-8">
            Don&apos;t have an account?{' '}
            <Link
              to="/signup"
              className="font-semibold text-foreground hover:text-[#9b72cf] transition-colors"
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>

      {/* Right side - Decorative */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#f3f0f7] via-white to-[#e8f5e9]/30 relative overflow-hidden">
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
          {/* Dashboard preview cards */}
          <div className="relative w-full max-w-md h-[400px]">
            {/* Card 1 - Stats card */}
            <div className="absolute left-0 top-8 transform -rotate-3 hover:rotate-0 hover:scale-105 transition-all duration-500 cursor-pointer group">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-14 h-6 bg-[#9b72cf]/20 rounded-sm transform -rotate-1" />
              <div className="bg-white p-4 rounded-lg shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] group-hover:shadow-[0_20px_50px_-10px_rgba(0,0,0,0.2)] transition-shadow">
                <div className="w-48 h-28 rounded flex flex-col gap-2 p-3">
                  <div className="text-[10px] font-medium text-[#9B9590]">Visitors today</div>
                  <div className="text-[28px] font-bold text-[#2D3436]">2,847</div>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] font-medium text-[#5b9a6f]">+12.4%</span>
                    <span className="text-[10px] text-[#9B9590]">vs yesterday</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2 - Mini chart */}
            <div className="absolute right-0 top-0 transform rotate-2 hover:rotate-0 hover:scale-105 transition-all duration-500 cursor-pointer group">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-12 h-6 bg-[#5b9a6f]/20 rounded-sm transform rotate-2" />
              <div className="bg-white p-4 rounded-lg shadow-[0_10px_40px_-10px_rgba(0,0,0,0.12)] group-hover:shadow-[0_20px_50px_-10px_rgba(0,0,0,0.18)] transition-shadow">
                <div className="w-40 h-24 rounded flex flex-col gap-2 p-3">
                  <div className="text-[10px] font-medium text-[#9B9590]">Pageviews</div>
                  <svg viewBox="0 0 120 40" className="w-full h-full" fill="none">
                    <path
                      d="M0 35 L15 30 L30 32 L45 22 L60 25 L75 15 L90 18 L105 8 L120 12"
                      stroke="#9b72cf"
                      strokeWidth="2"
                      strokeLinecap="round"
                      fill="none"
                    />
                    <path
                      d="M0 35 L15 30 L30 32 L45 22 L60 25 L75 15 L90 18 L105 8 L120 12 L120 40 L0 40 Z"
                      fill="url(#chartGrad)"
                      opacity="0.15"
                    />
                    <defs>
                      <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#9b72cf" />
                        <stop offset="100%" stopColor="#9b72cf" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
              </div>
            </div>

            {/* Card 3 - Top pages */}
            <div className="absolute left-16 bottom-0 transform -rotate-1 hover:rotate-0 hover:scale-105 transition-all duration-500 cursor-pointer group">
              <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-10 h-5 bg-[#e07a5f]/20 rounded-sm transform rotate-1" />
              <div className="bg-white p-3 rounded-lg shadow-[0_8px_30px_-8px_rgba(0,0,0,0.1)] group-hover:shadow-[0_15px_40px_-8px_rgba(0,0,0,0.15)] transition-shadow">
                <div className="w-44 rounded p-2">
                  <div className="text-[10px] font-medium text-[#9B9590] mb-2">Top pages</div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-[#2D3436]">/pricing</span>
                      <span className="text-[#9B9590]">842</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-[#2D3436]">/blog</span>
                      <span className="text-[#9B9590]">631</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-[#2D3436]">/docs</span>
                      <span className="text-[#9B9590]">428</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Text */}
          <div className="mt-8 text-center">
            <h2 className="text-2xl font-semibold text-[#2D3436] mb-2">Your dashboard awaits</h2>
            <p className="text-muted-foreground text-sm max-w-xs">
              Sign in to see real-time analytics across all your sites
            </p>
          </div>

          {/* Decorative bars */}
          <div className="absolute bottom-8 right-8 flex gap-1.5 transform rotate-[15deg]">
            <div className="w-2.5 h-20 rounded-t-full bg-[#9b72cf]/30" />
            <div className="w-2.5 h-16 rounded-t-full bg-[#5b9a6f]/30" />
            <div className="w-2.5 h-24 rounded-t-full bg-[#e07a5f]/30" />
            <div className="w-2.5 h-14 rounded-t-full bg-[#d4a574]/30" />
          </div>
        </div>
      </div>
    </div>
  );
}
