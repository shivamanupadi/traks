interface ReferrerResult {
  hostname: string;
  pathname: string;
}

/** Cap on the stored referrer path - long paths carry no analytical value. */
const MAX_PATH = 512;

/**
 * Referrer hostname + path, with the QUERY STRING DROPPED.
 *
 * Referring URLs routinely carry campaign recipient ids, password-reset and
 * session tokens, and search terms. Warehousing them verbatim would persist
 * third parties' secrets in the customer's data lake - indefensible for a
 * product that claims to be privacy-first by construction, and the campaign
 * data we actually want already arrives as explicit UTM fields.
 */
export function parseReferrer(referrer: string): ReferrerResult {
  if (!referrer) return { hostname: '', pathname: '' };

  try {
    const url = new URL(referrer);
    return {
      hostname: url.hostname,
      pathname: url.pathname.slice(0, MAX_PATH),
    };
  } catch {
    return { hostname: '', pathname: '' };
  }
}
