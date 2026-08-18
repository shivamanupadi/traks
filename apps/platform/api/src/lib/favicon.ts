/**
 * Server-side favicon resolution for a site domain, run on create/domain
 * change. The api worker (the buyer's own instance) does the fetching - the
 * dashboard never calls the tracked site or a third-party favicon service.
 *
 * Result is a data URL small enough to live in the sites row and ride along
 * in the existing site JSON, so no extra endpoint or auth path is needed.
 */

/** Raw icon cap. Typical favicons are 1–15KB; anything larger is skipped in
 *  favor of the next candidate so site payloads stay small. */
const MAX_ICON_BYTES = 64 * 1024;
/** Homepage HTML is only scanned for <link rel=icon> tags in the head. */
const MAX_HTML_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 6_000;

const IMAGE_MIME = /^image\//i;
const EXT_MIME: Record<string, string> = {
  ico: 'image/x-icon',
  png: 'image/png',
  svg: 'image/svg+xml',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

async function get(url: string, accept: string): Promise<Response | null> {
  try {
    return await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: accept, 'User-Agent': 'Traks (favicon fetch)' },
    });
  } catch {
    return null;
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** <link rel*=icon> hrefs from homepage HTML, resolved absolute, in document
 *  order with apple-touch icons demoted (they're large and often decorated). */
function iconLinksFromHtml(html: string, baseUrl: string): string[] {
  const primary: string[] = [];
  const fallback: string[] = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = /\brel\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const relValue = (rel?.[2] ?? rel?.[3] ?? rel?.[4] ?? '').toLowerCase();
    if (!relValue.split(/\s+/).includes('icon') && !relValue.includes('apple-touch-icon')) {
      continue;
    }
    const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const hrefValue = href?.[2] ?? href?.[3] ?? href?.[4];
    if (!hrefValue || hrefValue.startsWith('data:')) continue;
    try {
      const abs = new URL(hrefValue, baseUrl).toString();
      (relValue.includes('apple-touch-icon') ? fallback : primary).push(abs);
    } catch {
      /* unresolvable href */
    }
  }
  return [...primary, ...fallback];
}

async function loadIcon(url: string): Promise<string | null> {
  const res = await get(url, 'image/*,*/*;q=0.8');
  if (!res?.ok) return null;
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const ext = new URL(res.url || url).pathname.split('.').pop()?.toLowerCase() ?? '';
  // Servers routinely mislabel .ico as text/octet-stream; trust the extension
  // as a fallback but never store something with no image signal at all.
  const mime = IMAGE_MIME.test(contentType) ? contentType : EXT_MIME[ext];
  if (!mime) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return null;
  return `data:${mime};base64,${toBase64(bytes)}`;
}

/** Best-effort favicon for a domain as a data URL, or null. Never throws. */
export async function fetchSiteFavicon(domain: string): Promise<string | null> {
  const origin = `https://${domain}`;
  const candidates: string[] = [];
  const home = await get(`${origin}/`, 'text/html,*/*;q=0.8');
  if (home?.ok) {
    const html = (await home.text()).slice(0, MAX_HTML_BYTES);
    candidates.push(...iconLinksFromHtml(html, home.url || origin));
  }
  candidates.push(`${origin}/favicon.ico`);
  const seen = new Set<string>();
  for (const url of candidates) {
    if (seen.has(url) || seen.size >= 4) continue;
    seen.add(url);
    const icon = await loadIcon(url);
    if (icon) return icon;
  }
  return null;
}
