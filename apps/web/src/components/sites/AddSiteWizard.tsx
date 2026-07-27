import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, ArrowRight, Check, Copy, Code2, Zap } from 'lucide-react';
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

const COLLECT_URL = import.meta.env.VITE_COLLECT_URL || 'https://collect.traks.dev';

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<WizardStep>('details');
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [createdSite, setCreatedSite] = useState<CreatedSite | null>(null);
  const [copied, setCopied] = useState(false);

  const createSite = useMutation({
    mutationFn: async () => {
      // Site timezone drives how dashboard buckets are computed at ingest;
      // default it to the browser's zone instead of UTC.
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      return api.createSite({ name, domain, timezone });
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
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
  };

  const handleClose = (): void => {
    onOpenChange(false);
    // Reset after animation completes
    setTimeout(reset, 200);
  };

  const snippet = createdSite
    ? `<script defer data-site="${createdSite.key}" src="${COLLECT_URL}/t.js"></script>`
    : '';

  const handleCopy = async (): Promise<void> => {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const canCreate = name.trim().length > 0 && domain.trim().length > 0;

  const stepIndicator = (
    <div className="flex items-center gap-1.5 mb-4">
      <div
        className={`h-1.5 rounded-full transition-all duration-300 ${
          step === 'details' ? 'w-8 bg-[#9b72cf]' : 'w-8 bg-[#9b72cf]/20'
        }`}
      />
      <div
        className={`h-1.5 rounded-full transition-all duration-300 ${
          step === 'snippet' ? 'w-8 bg-[#9b72cf]' : 'w-8 bg-[#e8e3ed]'
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
                <div className="w-10 h-10 rounded-xl bg-[#9b72cf]/10 flex items-center justify-center mb-3">
                  <Globe className="w-5 h-5 text-[#9b72cf]" strokeWidth={1.7} />
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
                <div className="w-10 h-10 rounded-xl bg-[#5b9a6f]/10 flex items-center justify-center mb-3">
                  <Code2 className="w-5 h-5 text-[#5b9a6f]" strokeWidth={1.7} />
                </div>
                <DialogTitle>Install tracking script</DialogTitle>
                <DialogDescription>
                  Add this snippet to the{' '}
                  <code className="text-[12px] bg-[#f3f0f7] px-1.5 py-0.5 rounded font-medium">
                    &lt;head&gt;
                  </code>{' '}
                  of <span className="font-semibold text-[#2D3436]">{createdSite?.domain}</span>
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
                  <label className="mb-2 block text-[13px] font-medium text-[#2D3436]">
                    Site Name
                  </label>
                  <Input
                    placeholder="My SaaS"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="rounded-xl h-11 border-[#e8e3ed] focus:border-[#9b72cf]/40 px-4 text-[14px]"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="mb-2 block text-[13px] font-medium text-[#2D3436]">
                    Domain
                  </label>
                  <Input
                    placeholder="example.com"
                    value={domain}
                    onChange={e => setDomain(e.target.value)}
                    className="rounded-xl h-11 border-[#e8e3ed] focus:border-[#9b72cf]/40 px-4 text-[14px]"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && canCreate) createSite.mutate();
                    }}
                  />
                  <p className="mt-2 text-[12px] text-[#B5B0AA]">Without http:// or https://</p>
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
                {/* Snippet card */}
                <div className="relative rounded-xl border border-[#e8e3ed] bg-[#fdfbf8] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#e8e3ed]/60">
                    <span className="text-[11px] font-medium text-[#B5B0AA] uppercase tracking-wider">
                      HTML Snippet
                    </span>
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium text-[#9B9590] hover:text-[#9b72cf] transition-colors"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3 h-3 text-[#5b9a6f]" />
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
                  <pre className="text-[12px] leading-relaxed text-[#2D3436] font-mono whitespace-pre-wrap break-all select-all px-4 py-3.5">
                    {snippet}
                  </pre>
                </div>

                {/* Info note */}
                <div className="flex gap-3 rounded-xl bg-[#5b9a6f]/5 border border-[#5b9a6f]/10 px-4 py-3.5">
                  <Zap className="w-4 h-4 text-[#5b9a6f] shrink-0 mt-0.5" strokeWidth={1.7} />
                  <p className="text-[12px] text-[#5b9a6f]/80 leading-relaxed">
                    Under 1KB, loads async - zero impact on page speed. Data appears within seconds
                    of the first visit.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </DialogBody>

        <DialogFooter className="border-t border-[#e8e3ed]/50 mx-6 px-0 pb-5 pt-4">
          {step === 'details' ? (
            <>
              <Button variant="ghost" onClick={handleClose} className="rounded-xl text-[13px]">
                Cancel
              </Button>
              <Button
                onClick={() => createSite.mutate()}
                disabled={!canCreate}
                isLoading={createSite.isPending}
                className="bg-[#9b72cf] hover:bg-[#8a63bf] text-white rounded-xl text-[13px] px-5"
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
              <Button
                onClick={handleClose}
                className="bg-[#5b9a6f] hover:bg-[#4e8a62] text-white rounded-xl text-[13px] px-5"
              >
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
