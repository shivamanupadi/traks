import type { ReactElement } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  siAstro,
  siFramer,
  siHtml5,
  siNextdotjs,
  siNuxt,
  siReact,
  siShopify,
  siSvelte,
  siVuedotjs,
  siWebflow,
  siWordpress,
  type SimpleIcon,
} from 'simple-icons';
import type { InstallGuide } from '@traks/shared';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Official brand marks (Simple Icons, CC0) keyed by install-guide slug. */
const LOGOS: Record<string, SimpleIcon> = {
  html: siHtml5,
  nextjs: siNextdotjs,
  react: siReact,
  vue: siVuedotjs,
  nuxt: siNuxt,
  astro: siAstro,
  sveltekit: siSvelte,
  wordpress: siWordpress,
  webflow: siWebflow,
  framer: siFramer,
  shopify: siShopify,
};

export function PlatformLogo({
  slug,
  className,
}: {
  slug: string;
  className?: string;
}): ReactElement | null {
  const icon = LOGOS[slug];
  if (!icon) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-hidden
      className={cn('h-4 w-4 shrink-0', className)}
      style={{ color: `#${icon.hex}` }}
    >
      <path d={icon.path} fill="currentColor" />
    </svg>
  );
}

/** Flat pill dropdown of install guides, each with its brand mark. */
export function PlatformSelect({
  guides,
  value,
  onChange,
}: {
  guides: InstallGuide[];
  value: string;
  onChange: (slug: string) => void;
}): ReactElement {
  const current = guides.find(g => g.slug === value) ?? guides[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-10 w-full items-center gap-2.5 rounded-2xl bg-[#F2F1ED] px-3.5 text-left text-[13px] font-medium text-[#3D3B4F] hover:bg-[#E6E4DE] transition-colors cursor-pointer focus:outline-none focus-visible:bg-white focus-visible:shadow-[inset_0_0_0_1.5px_var(--ring)]">
        <PlatformLogo slug={current.slug} />
        <span className="min-w-0 flex-1 truncate">{current.name}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#9B9590]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-full overflow-y-auto">
        {guides.map(g => {
          const on = g.slug === current.slug;
          return (
            <DropdownMenuItem
              key={g.slug}
              onClick={() => onChange(g.slug)}
              className={cn(
                'gap-2.5 py-2 text-[12.5px]',
                on ? 'font-semibold text-[#3D3B4F]' : 'text-[#6E6C7C]'
              )}
            >
              <PlatformLogo slug={g.slug} />
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              {on && <Check className="h-3.5 w-3.5 shrink-0" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
