import { useState, type ReactElement, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, Globe2, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface SharingState {
  public: boolean;
  publicGoals: boolean;
  publicFunnels: boolean;
  publicEvents: boolean;
}

type SharingField = keyof SharingState;

/** Flat on/off switch: mint track when on, inset grey when off. */
function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30',
        'disabled:cursor-default disabled:opacity-50',
        checked ? 'bg-[#28E99F]' : 'bg-border'
      )}
    >
      <span
        className={cn(
          'inline-block h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(61,59,79,0.2)] transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
        )}
      />
    </button>
  );
}

function SectionRow({
  title,
  detail,
  control,
}: {
  title: string;
  detail: string;
  control: ReactNode;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-foreground">{title}</p>
        <p className="text-[12px] text-subtle">{detail}</p>
      </div>
      {control}
    </div>
  );
}

/**
 * Owner controls for a site's public dashboard (/share/<id>): one switch to
 * publish it, the link, and opt-ins for the sections whose names can reveal
 * business details. Each switch saves on its own; the section choices are
 * remembered while the site is private.
 */
export function ShareDialog({
  open,
  onOpenChange,
  siteId,
  siteName,
  sharing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  siteName: string;
  sharing: SharingState;
}): ReactElement {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const shareUrl = `${window.location.origin}/share/${siteId}`;

  const save = useMutation({
    mutationFn: (patch: Partial<SharingState>) => api.updateSiteSharing(siteId, patch),
    // Optimistic: flip the switch now, roll back if the save fails.
    onMutate: async patch => {
      await queryClient.cancelQueries({ queryKey: ['site', siteId] });
      const previous = queryClient.getQueryData(['site', siteId]);
      queryClient.setQueryData(['site', siteId], (old: any) =>
        old?.data ? { ...old, data: { ...old.data, ...patch } } : old
      );
      return { previous };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['site', siteId], ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['site', siteId] });
      // The share page caches the site's sections; drop it so an open tab
      // picks the change up on its next load.
      queryClient.removeQueries({ queryKey: ['public-site', siteId] });
    },
  });

  const set = (field: SharingField, value: boolean): void => {
    save.mutate({ [field]: value });
  };

  const copy = (): void => {
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        const el = document.getElementById('share-url');
        if (el) window.getSelection()?.selectAllChildren(el);
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <div
            className={cn(
              'mb-3 flex h-10 w-10 items-center justify-center rounded-xl',
              sharing.public ? 'bg-[#28E99F]/20 text-foreground' : 'bg-muted text-muted-foreground'
            )}
          >
            {sharing.public ? (
              <Globe2 className="h-5 w-5" strokeWidth={1.7} />
            ) : (
              <Lock className="h-5 w-5" strokeWidth={1.7} />
            )}
          </div>
          <DialogTitle>Share {siteName}</DialogTitle>
          <DialogDescription>
            A public dashboard anyone with the link can view, without signing in. Visitors can
            change the period and filter, but can&rsquo;t change anything.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4 rounded-[14px] bg-muted px-4 py-3">
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-foreground">Public dashboard</p>
              <p className="text-[12px] text-subtle">
                {sharing.public
                  ? 'On - anyone with the link can view it.'
                  : 'Off - only your workspace can view it.'}
              </p>
            </div>
            <Switch
              checked={sharing.public}
              onChange={v => set('public', v)}
              label="Public dashboard"
            />
          </div>

          {sharing.public && (
            <div className="flex items-center gap-2">
              <code
                id="share-url"
                className="min-w-0 flex-1 select-all truncate rounded-[12px] border border-border px-3.5 py-2.5 font-mono text-[12px] text-foreground"
              >
                {shareUrl}
              </code>
              <button
                onClick={copy}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-[#1FC285]" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open the public dashboard"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">
              What it shows
            </p>
            <div className="divide-y divide-muted">
              <SectionRow
                title="Traffic"
                detail="Visitors, pages, sources, locations and devices"
                control={
                  <span className="shrink-0 text-[12px] font-medium text-subtle">Always</span>
                }
              />
              <SectionRow
                title="Goals"
                detail="Goal names and their conversions"
                control={
                  <Switch
                    checked={sharing.publicGoals}
                    onChange={v => set('publicGoals', v)}
                    label="Share goals"
                  />
                }
              />
              <SectionRow
                title="Funnels"
                detail="Funnel names, steps and drop-off"
                control={
                  <Switch
                    checked={sharing.publicFunnels}
                    onChange={v => set('publicFunnels', v)}
                    label="Share funnels"
                  />
                }
              />
              <SectionRow
                title="Custom events"
                detail="Event names, counts and properties"
                control={
                  <Switch
                    checked={sharing.publicEvents}
                    onChange={v => set('publicEvents', v)}
                    label="Share custom events"
                  />
                }
              />
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
              Links, bots, agent tools and the live view always stay private.
            </p>
          </div>

          {save.isError && (
            <p className="text-[12px] text-[#e07a5f]">
              {(save.error as Error).message}. Your change wasn&rsquo;t saved.
            </p>
          )}
        </DialogBody>

        <DialogFooter className="mx-6 border-t border-border/50 px-0 pb-5 pt-4">
          <Button onClick={() => onOpenChange(false)} className="px-5 text-[13px] shadow-none">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
