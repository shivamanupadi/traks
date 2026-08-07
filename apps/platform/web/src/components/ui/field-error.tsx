import type { ReactElement } from 'react';

/**
 * The inline message under a field. Rendered only once the user has left the
 * field or tried to submit — validating while someone is still typing their
 * first character reads as nagging.
 *
 * `role="alert"` so screen readers announce it; pair with `aria-invalid` on
 * the input itself, which the Input component already styles.
 */
export function FieldError({ message }: { message?: string | null }): ReactElement | null {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1.5 text-[12px] text-[#e5484d]">
      {message}
    </p>
  );
}
