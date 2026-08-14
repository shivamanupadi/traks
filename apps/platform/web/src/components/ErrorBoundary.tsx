import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * Last line of defence for render-time throws. Without this a single malformed
 * payload or component bug white-screens the whole dashboard, which reads to a
 * customer as "the product is down" rather than "one screen failed".
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaced in the instance owner's own Workers logs, not sent anywhere.
    console.error('[traks] render error:', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F9F8F6] px-6">
        <div className="w-full max-w-md rounded-[20px] bg-white p-8 text-center shadow-float">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <AlertCircle className="h-7 w-7 text-[#e07a5f]" strokeWidth={1.6} />
          </div>
          <h1 className="text-[17px] font-semibold text-[#3D3B4F]">Something went wrong</h1>
          <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-[#9B9590]">
            This screen hit an unexpected error. Your analytics data is unaffected — reloading
            usually clears it.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="h-10 rounded-full bg-[#3D3B4F] px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#2C2B3B]"
            >
              Reload
            </button>
            <a
              href="/portal/sites"
              className="h-10 rounded-full px-5 text-[13.5px] font-semibold leading-10 text-[#6E6C7C] transition-colors hover:bg-muted"
            >
              Back to sites
            </a>
          </div>
        </div>
      </div>
    );
  }
}
