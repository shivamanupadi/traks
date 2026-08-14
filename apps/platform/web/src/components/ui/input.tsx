import * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>): React.ReactElement {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'file:text-foreground placeholder:text-[#B5B0AA] h-10 w-full min-w-0 rounded-2xl border-none bg-[#F2F1ED] px-4 py-1 text-base transition-shadow outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus:bg-white focus:shadow-[inset_0_0_0_1.5px_var(--ring)]',
        'aria-invalid:shadow-[inset_0_0_0_1.5px_var(--destructive)]',
        className
      )}
      {...props}
    />
  );
}

export { Input };
