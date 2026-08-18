/**
 * Body scroll lock that doesn't jerk the page. Hiding the scrollbar makes
 * the viewport wider, so everything centred in it shifts; we compensate by
 * padding the body (and any sticky/fixed header) by the scrollbar width.
 * Reference-counted so a modal opened over a drawer doesn't unlock early.
 */
let locks = 0;
let saved: { overflow: string; paddingRight: string } | null = null;

export function lockScroll(): () => void {
  if (locks++ === 0) {
    const body = document.body;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    saved = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    body.style.overflow = 'hidden';
    if (gap > 0) {
      const current = parseFloat(getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${current + gap}px`;
      body.style.setProperty('--scrollbar-gap', `${gap}px`);
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0 && saved) {
      document.body.style.overflow = saved.overflow;
      document.body.style.paddingRight = saved.paddingRight;
      document.body.style.removeProperty('--scrollbar-gap');
      saved = null;
    }
  };
}
