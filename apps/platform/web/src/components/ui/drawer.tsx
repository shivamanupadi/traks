import * as React from 'react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  /** Panel width; defaults to 400px (full width on small screens). */
  className?: string;
}

/**
 * Right-side sheet that slides in over the page. Sits at z-[45]: above the
 * sticky portal header (z-40) but below Dialog (z-50), so a modal opened
 * from inside the drawer stacks on top of it. Portals to <body> for the same
 * containing-block reason as Dialog.
 */
function Drawer({ open, onOpenChange, children, className }: DrawerProps): React.ReactNode {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    if (open) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [open, onOpenChange]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[45] bg-black/40"
            onClick={() => onOpenChange(false)}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            initial={{ x: 32, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 32, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
            className={cn(
              'fixed inset-y-0 right-0 z-[45] flex w-full max-w-[400px] flex-col bg-white shadow-float-lg',
              className
            )}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}

function DrawerHeader({
  className,
  onClose,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { onClose?: () => void }): React.ReactNode {
  return (
    <div
      className={cn('flex items-start justify-between gap-3 px-6 pt-6 pb-3', className)}
      {...props}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <button
          onClick={onClose}
          className="-mr-2 -mt-1 shrink-0 rounded-full p-1.5 text-[#9B9590] hover:bg-muted hover:text-[#3D3B4F] transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function DrawerTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>): React.ReactNode {
  return (
    <h2
      className={cn('text-[17px] font-semibold text-[#3D3B4F] tracking-[-0.01em]', className)}
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>): React.ReactNode {
  return <p className={cn('mt-0.5 text-[13px] text-[#9B9590]', className)} {...props} />;
}

function DrawerBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactNode {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 pb-4', className)} {...props} />;
}

function DrawerFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactNode {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 border-t border-[#E6E4DE] px-6 py-3.5',
        className
      )}
      {...props}
    />
  );
}

export { Drawer, DrawerHeader, DrawerTitle, DrawerDescription, DrawerBody, DrawerFooter };
