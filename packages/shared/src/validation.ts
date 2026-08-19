import { z } from 'zod';

/** Free-text tracker field: overlong values are trimmed, not rejected. */
const clipped = (max: number) => z.string().transform(s => s.slice(0, max));

/**
 * Tracker event payload. Strict mode rejects unknown keys so a misconfigured
 * tracker surfaces as a 400 rather than silently dropping data.
 *
 * Overlong free-text fields are truncated rather than rejected: a 3 KB
 * ad-click referrer or a chatty props object must not cost the pageview or
 * event it arrived with (that traffic is exactly what people look for). Size
 * is still bounded before parse by the collector's body cap. The tracker
 * clips the same limits client-side; this is the backstop for other clients.
 */
export const trackingEventSchema = z
  .object({
    t: z.enum(['pageview', 'event', 'engagement']),
    s: z.string().min(1).max(64),
    p: clipped(2048).default('/'),
    h: clipped(256).default(''),
    r: clipped(2048).default(''),
    sw: z.number().int().min(0).max(10000).catch(0),
    sid: clipped(64).default(''),
    us: clipped(256).optional(),
    um: clipped(256).optional(),
    uc: clipped(256).optional(),
    en: clipped(256).optional(),
    // Props JSON over the limit is dropped (''), not truncated - a cut JSON
    // string is unusable to the props breakdown and goal matching.
    ep: z
      .string()
      .transform(s => (s.length > 1024 ? '' : s))
      .optional(),
    // Bounded: the site key is public, so an unbounded value would let anyone
    // poison revenue/engagement sums (SUM over 1e308 → Infinity) for a site.
    // Non-numeric / out-of-range values fall back to 0 instead of rejecting.
    ev: z
      .preprocess(
        v => (typeof v === 'string' ? Number(v) : v),
        z.number().finite().min(0).max(1_000_000)
      )
      .catch(0)
      .optional(),
  })
  .strict();

export type ValidatedTrackingEvent = z.infer<typeof trackingEventSchema>;

/**
 * An invalid IANA zone would make Intl throw inside computeBucketKeys and
 * fail every ingest request for the site - reject it at the API boundary.
 */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const timezoneSchema = z
  .string()
  .max(64)
  .refine(isValidTimezone, { message: 'Invalid IANA timezone' });

/**
 * Free text that must survive trimming. `.min(1)` alone accepts "   ", which
 * then renders as a blank name nobody can click on.
 */
export const trimmedText = (max: number, label: string) =>
  z
    .string()
    .transform(s => s.trim())
    .pipe(
      z
        .string()
        .min(1, `${label} is required`)
        .max(max, `${label} must be ${max} characters or fewer`)
    );

/**
 * Reduce whatever the user pasted to the bare hostname we store and match on.
 *
 * Accepts a full URL, a trailing slash, a port, mixed case, or a `www.` prefix
 * because people copy from the address bar. `www.` is dropped deliberately:
 * the collect worker matches an event's Origin as `host === domain ||
 * host.endsWith('.' + domain)`, so the naked domain covers the apex AND every
 * subdomain, while storing `www.example.com` would silently reject the apex.
 */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // scheme
    .replace(/^[^/@]*@/, '') // userinfo
    .replace(/[/?#].*$/, '') // path, query, fragment
    .replace(/:\d+$/, '') // port
    .replace(/^www\./, '')
    .replace(/\.$/, ''); // fully-qualified trailing dot
}

/**
 * Validate an already-normalized domain. Returns a message explaining what to
 * fix, or null when it is good. Shared verbatim by the API and the forms so a
 * value can never pass one and fail the other.
 */
export function domainError(normalized: string): string | null {
  if (!normalized) return 'Enter the domain visitors use, like example.com';
  if (normalized.length > 253) return 'Domain is too long';
  if (normalized.includes(' ')) return 'A domain cannot contain spaces';
  if (!normalized.includes('.')) {
    return 'Include the full domain with its extension, like example.com';
  }
  const labels = normalized.split('.');
  for (const label of labels) {
    if (!label) return 'Domain has an empty part. Check for a doubled dot';
    if (label.length > 63) return 'One part of the domain is too long';
    if (!/^[a-z0-9-]+$/.test(label)) {
      return 'Use only letters, numbers and hyphens in a domain';
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      return 'Domain parts cannot start or end with a hyphen';
    }
  }
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/.test(tld)) return 'That does not look like a real domain extension';
  return null;
}

/** Bare hostname, normalized on the way in and rejected if malformed. */
export const domainSchema = z
  .string()
  .max(2048) // bound before any work; the real limit is applied post-normalize
  .transform(normalizeDomain)
  .superRefine((value, ctx) => {
    const message = domainError(value);
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });

export const createSiteSchema = z.object({
  name: trimmedText(100, 'Site name'),
  domain: domainSchema,
  timezone: timezoneSchema.default('UTC'),
  /** Target workspace; omitted → the caller's default workspace. */
  workspaceId: z.string().min(1).max(64).optional(),
});

export const updateSiteSchema = z.object({
  name: trimmedText(100, 'Site name'),
  domain: domainSchema,
  timezone: timezoneSchema.optional(),
});

/** Bulk "apply this timezone to sites", scoped to one workspace when given. */
export const allSitesTimezoneSchema = z.object({
  timezone: timezoneSchema,
  workspaceId: z.string().min(1).max(64).optional(),
});

/**
 * A goal/funnel target means different things per type, and a mismatch is
 * silent - the goal simply never converts - so it is rejected up front rather
 * than left for the customer to discover from a permanently empty panel.
 * Returns a message or null.
 */
export function targetError(type: 'event' | 'page', rawTarget: string): string | null {
  const target = rawTarget.trim();
  if (!target) return type === 'page' ? 'Enter a path, like /pricing' : 'Enter an event name';
  if (type === 'page') {
    if (!target.startsWith('/')) return 'A path must start with /, like /pricing';
    if (/\s/.test(target)) return 'A path cannot contain spaces';
    if (target.length > 2048) return 'Path is too long';
    // A trailing /* makes the target a section prefix (/blog/* matches
    // /blog and everything under it). The star is valid nowhere else.
    const star = target.indexOf('*');
    if (star !== -1) {
      if (!target.endsWith('/*') || star !== target.length - 1) {
        return 'A * wildcard can only appear at the end, as /section/*';
      }
      if (target === '/*') return 'Use a real prefix before /*, like /blog/*';
    }
    return null;
  }
  if (target.startsWith('/')) {
    return 'That looks like a path. Switch the type to Page, or enter an event name';
  }
  if (target.length > 256) return 'Event name must be 256 characters or fewer';
  return null;
}

/**
 * Optional event-prop condition (`where key = value`): both present or both
 * absent, event targets only. Shared by goal/funnel forms and their schemas
 * so the inline message and the API rejection can never disagree.
 */
export function propPairError(
  type: 'event' | 'page',
  rawKey: string,
  rawValue: string
): string | null {
  const key = rawKey.trim();
  const value = rawValue.trim();
  if (!key && !value) return null;
  if (type === 'page') return 'Property conditions only apply to event targets';
  if (!key) return 'Enter the property key, or clear the value';
  if (!value) return 'Enter the property value, or clear the key';
  if (key.length > 128) return 'Property key must be 128 characters or fewer';
  if (value.length > 512) return 'Property value must be 512 characters or fewer';
  return null;
}

const optionalProp = (max: number) =>
  z
    .string()
    .max(max)
    .transform(s => s.trim())
    .optional();

const refineTargetAndProp = (
  item: { type: 'event' | 'page'; target: string; propKey?: string; propValue?: string },
  ctx: z.RefinementCtx
): void => {
  const message = targetError(item.type, item.target);
  if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['target'], message });
  const propMessage = propPairError(item.type, item.propKey ?? '', item.propValue ?? '');
  if (propMessage) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['propKey'], message: propMessage });
  }
};

/** Goal definition: a custom event name or a pathname that counts as a conversion. */
export const createGoalSchema = z
  .object({
    name: trimmedText(100, 'Goal name'),
    type: z.enum(['event', 'page']),
    target: z
      .string()
      .max(2048)
      .transform(s => s.trim()),
    propKey: optionalProp(128),
    propValue: optionalProp(512),
  })
  .superRefine(refineTargetAndProp);

/** Saved filter set: at least one known filter dimension, unknown keys stripped. */
export const segmentFiltersSchema = z
  .object({
    page: z.string().min(1).max(2048),
    source: z.string().min(1).max(512),
    utmSource: z.string().min(1).max(512),
    utmMedium: z.string().min(1).max(512),
    utmCampaign: z.string().min(1).max(512),
    country: z.string().min(1).max(128),
    region: z.string().min(1).max(128),
    city: z.string().min(1).max(128),
    browser: z.string().min(1).max(128),
    os: z.string().min(1).max(128),
    device: z.string().min(1).max(128),
  })
  .partial()
  .refine(f => Object.values(f).some(v => v), {
    message: 'A segment needs at least one filter',
  });

export const createSegmentSchema = z.object({
  name: trimmedText(100, 'Segment name'),
  filters: segmentFiltersSchema,
});

/** One ordered funnel step: a pageview of a pathname or a custom event. */
export const funnelStepSchema = z
  .object({
    type: z.enum(['event', 'page']),
    target: z
      .string()
      .max(2048)
      .transform(s => s.trim()),
    propKey: optionalProp(128),
    propValue: optionalProp(512),
  })
  .superRefine(refineTargetAndProp);

/** Funnel definition: 2-8 ordered steps a session should complete in sequence. */
export const createFunnelSchema = z.object({
  name: trimmedText(100, 'Funnel name'),
  steps: z
    .array(funnelStepSchema)
    .min(2, 'A funnel needs at least 2 steps')
    .max(8, 'A funnel can have at most 8 steps'),
});

/* ── Field validators shared with the forms ─────────────────────────────
 * The dialogs call these directly so an inline message and the API's own
 * rejection can never disagree about what is acceptable. Each returns a
 * sentence to show the user, or null when the value is fine.
 */

/** Minimum password length; mirrored by the sign-up hook on the server. */
export const MIN_PASSWORD_LENGTH = 8;

export function requiredTextError(raw: string, max: number, label: string): string | null {
  const value = raw.trim();
  if (!value) return `${label} is required`;
  if (value.length > max) return `${label} must be ${max} characters or fewer`;
  return null;
}

export function emailError(raw: string): string | null {
  const value = raw.trim();
  if (!value) return 'Email is required';
  if (value.length > 256) return 'Email is too long';
  // Deliberately permissive - one @, something either side, a dotted domain.
  // Anything stricter rejects addresses that genuinely deliver.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return 'Enter a valid email address';
  return null;
}

export function passwordError(raw: string): string | null {
  if (!raw) return 'Password is required';
  if (raw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (raw.length > 512) return 'Password is too long';
  return null;
}

/** Domain check for forms: normalizes first, so paste-a-URL still passes. */
export function domainInputError(raw: string): string | null {
  return domainError(normalizeDomain(raw));
}

export const statsQuerySchema = z.object({
  period: z.enum(['today', '7d', '30d', '90d', '6m', '1y', 'all']).default('today'),
  from: z.string().optional(),
  to: z.string().optional(),
  siteIds: z.string().optional(),
});
