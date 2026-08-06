interface ReferrerResult {
  hostname: string;
  pathname: string;
}

export function parseReferrer(referrer: string): ReferrerResult {
  if (!referrer) return { hostname: '', pathname: '' };

  try {
    const url = new URL(referrer);
    return {
      hostname: url.hostname,
      pathname: url.pathname + url.search,
    };
  } catch {
    return { hostname: '', pathname: '' };
  }
}
