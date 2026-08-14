import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, ArrowRight, Check, CheckCircle2, Copy, Zap } from 'lucide-react';
import { SiteFavicon } from './SiteFavicon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { FieldError } from '@/components/ui/field-error';
import { domainInputError, normalizeDomain, requiredTextError } from '@traks/shared';
import { useCollectUrl } from '@/lib/config';

type WizardStep = 'details' | 'snippet';

interface CreatedSite {
  id: string;
  name: string;
  domain: string;
  key: string;
}

export function AddSiteWizard({
  open,
  onOpenChange,
  workspaceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Workspace the new site is created in; omitted → the default workspace. */
  workspaceId?: string;
}): ReactElement {
  const queryClient = useQueryClient();
  const collectUrl = useCollectUrl();
  const [step, setStep] = useState<WizardStep>('details');
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [createdSite, setCreatedSite] = useState<CreatedSite | null>(null);
  const [copied, setCopied] = useState(false);
  const [touched, setTouched] = useState<{ name?: boolean; domain?: boolean }>({});

  // Same rules the API enforces, imported rather than restated so a value can
  // never pass here and fail there.
  const nameError = requiredTextError(name, 100, 'Site name');
  const domainErr = domainInputError(domain);

  const createSite = useMutation({
    mutationFn: async () => {
      // Site timezone drives how dashboard buckets are computed at ingest;
      // default it to the browser's zone instead of UTC.
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      // Normalized here too so the confirmation screen shows the domain that
      // was actually stored, not the URL the user pasted.
      return api.createSite({
        name: name.trim(),
        domain: normalizeDomain(domain),
        timezone,
        workspaceId,
      });
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      setCreatedSite({
        id: result.data.id,
        name: result.data.name,
        domain: result.data.domain,
        key: result.key,
      });
      setStep('snippet');
    },
  });

  const reset = (): void => {
    setStep('details');
    setName('');
    setDomain('');
    setCreatedSite(null);
    setCopied(false);
    setTouched({});
    // Without this a failed create left its error on screen the next time the
    // wizard was opened, blaming the new attempt for the old failure.
    createSite.reset();
  };

  const handleClose = (): void => {
    onOpenChange(false);
    // Reset after animation completes
    setTimeout(reset, 200);
  };

  // The favicon is fetched server-side right after create (waitUntil), so it
  // isn't in the create response — poll the site briefly until it lands.
  // Same query key the dashboard uses, so this also warms its cache.
  const { data: siteDetail } = useQuery({
    queryKey: ['site', createdSite?.id],
    queryFn: () => api.getSite(createdSite!.id),
    enabled: !!createdSite,
    refetchInterval: query => {
      const favicon = (query.state.data as any)?.data?.favicon;
      // Stop once it arrives, or give up after ~15s — some sites have none.
      return favicon || query.state.dataUpdateCount > 10 ? false : 1500;
    },
  });
  const favicon = ((siteDetail as any)?.data?.favicon ?? null) as string | null;

  // Empty until the instance config resolves — never guess the collect origin.
  const snippet =
    createdSite && collectUrl
      ? `<script defer data-site="${createdSite.key}" src="${collectUrl}/t.js"></script>`
      : '';

  const handleCopy = async (): Promise<void> => {
    if (!snippet) return;
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const canCreate = !nameError && !domainErr;

  /** Reveal any problems at once when submission is attempted. */
  const submit = (): void => {
    setTouched({ name: true, domain: true });
    if (canCreate) createSite.mutate();
  };

  const stepIndicator = (
    <div className="flex items-center gap-1.5 mb-4">
      <div
        className={`h-1.5 rounded-full transition-all duration-300 ${
          step === 'details' ? 'w-8 bg-foreground' : 'w-8 bg-border'
        }`}
      />
      <div
        className={`h-1.5 rounded-full transition-all duration-300 ${
          step === 'snippet' ? 'w-8 bg-foreground' : 'w-8 bg-border'
        }`}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent onClose={handleClose} className="max-w-md">
        <DialogHeader>
          {stepIndicator}
          <AnimatePresence mode="wait">
            {step === 'details' ? (
              <motion.div
                key="details-header"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.15 }}
              >
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mb-3">
                  <Globe className="w-5 h-5 text-foreground" strokeWidth={1.7} />
                </div>
                <DialogTitle>Add a new site</DialogTitle>
                <DialogDescription>
                  Enter your website details to get started with analytics.
                </DialogDescription>
              </motion.div>
            ) : (
              <motion.div
                key="snippet-header"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.15 }}
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-mint/15">
                  <SiteFavicon favicon={favicon} size={22} fallbackClassName="text-[#0E9F6E]" />
                </div>
                <DialogTitle className="flex items-center gap-2">
                  {createdSite?.name} is ready
                  <CheckCircle2 className="h-[18px] w-[18px] text-[#0E9F6E]" strokeWidth={2} />
                </DialogTitle>
                <DialogDescription>
                  Your site was created — analytics for{' '}
                  <span className="font-semibold text-[#3D3B4F]">{createdSite?.domain}</span> starts
                  as soon as the snippet below is installed.
                </DialogDescription>
              </motion.div>
            )}
          </AnimatePresence>
        </DialogHeader>

        <DialogBody>
          <AnimatePresence mode="wait">
            {step === 'details' ? (
              <motion.div
                key="details-body"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.15 }}
                className="space-y-5"
              >
                <div>
                  <label className="mb-2 block text-[13px] font-medium text-[#3D3B4F]">
                    Site Name
                  </label>
                  <Input
                    placeholder="My SaaS"
                    value={name}
                    maxLength={100}
                    aria-invalid={touched.name && !!nameError}
                    onChange={e => setName(e.target.value)}
                    onBlur={() => setTouched(t => ({ ...t, name: true }))}
                    className="h-11 px-4 text-[14px]"
                    autoFocus
                  />
                  <FieldError message={touched.name ? nameError : null} />
                </div>
                <div>
                  <label className="mb-2 block text-[13px] font-medium text-[#3D3B4F]">
                    Domain
                  </label>
                  <Input
                    placeholder="example.com"
                    value={domain}
                    maxLength={253}
                    aria-invalid={touched.domain && !!domainErr}
                    onChange={e => setDomain(e.target.value)}
                    onBlur={() => setTouched(t => ({ ...t, domain: true }))}
                    className="h-11 px-4 text-[14px]"
                    onKeyDown={e => {
                      if (e.key === 'Enter') submit();
                    }}
                  />
                  {touched.domain && domainErr ? (
                    <FieldError message={domainErr} />
                  ) : (
                    <p className="mt-2 text-[12px] text-[#B5B0AA]">
                      {domain.trim() && normalizeDomain(domain) !== domain.trim()
                        ? `Will be saved as ${normalizeDomain(domain)}`
                        : 'Just the domain — a pasted URL works too'}
                    </p>
                  )}
                </div>
                {createSite.isError && (
                  <p className="text-[13px] text-[#e5484d]">{createSite.error.message}</p>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="snippet-body"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.15 }}
                className="space-y-4"
              >
                <p className="text-[12.5px] text-[#6E6C7C]">
                  Add this snippet to the{' '}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[12px] font-medium">
                    &lt;head&gt;
                  </code>{' '}
                  of <span className="font-semibold text-[#3D3B4F]">{createdSite?.domain}</span>:
                </p>
                {/* Snippet card */}
                <div className="relative rounded-xl border border-[#e6e5ea] bg-[#F9F8F6] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#e6e5ea]/60">
                    <span className="text-[11px] font-medium text-[#B5B0AA] uppercase tracking-wider">
                      HTML Snippet
                    </span>
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium text-[#9B9590] hover:text-foreground transition-colors"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3 h-3 text-[#6E6C7C]" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="text-[12px] leading-relaxed text-[#3D3B4F] font-mono whitespace-pre-wrap break-all select-all px-4 py-3.5">
                    {snippet}
                  </pre>
                </div>

                {/* Info note */}
                <div className="flex gap-3 rounded-xl bg-[#F2F1ED] border border-[#E6E4DE] px-4 py-3.5">
                  <Zap className="w-4 h-4 text-[#6E6C7C] shrink-0 mt-0.5" strokeWidth={1.7} />
                  <p className="text-[12px] text-[#6E6C7C] leading-relaxed">
                    Under 1KB, loads async - zero impact on page speed. Data appears within seconds
                    of the first visit.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </DialogBody>

        <DialogFooter className="border-t border-[#e6e5ea]/50 mx-6 px-0 pb-5 pt-4">
          {step === 'details' ? (
            <>
              <Button variant="ghost" onClick={handleClose} className="rounded-xl text-[13px]">
                Cancel
              </Button>
              <Button
                onClick={submit}
                isLoading={createSite.isPending}
                className="text-[13px] px-5"
              >
                Continue
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={handleCopy} className="rounded-xl text-[13px]">
                <Copy className="w-3.5 h-3.5" />
                {copied ? 'Copied!' : 'Copy snippet'}
              </Button>
              <Button onClick={handleClose} className="text-[13px] px-5">
                <Check className="w-3.5 h-3.5" />
                Done
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
