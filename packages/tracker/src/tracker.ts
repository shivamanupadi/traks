(function () {
  // Prevent double initialization (HMR, duplicate script tags)
  const w = window as any;
  if (w.__pb) return;
  w.__pb = true;

  const scriptEl = document.currentScript as HTMLScriptElement | null;
  if (!scriptEl) return;

  const siteKey = scriptEl.getAttribute('data-site');
  if (!siteKey) return;

  const endpoint = new URL(scriptEl.src).origin + '/api/event';
  let lastPage: string;

  // Random session ID via sessionStorage (not a fingerprint — just a random token)
  function getSessionId(): string {
    const key = '_pb_s';
    const now = Date.now();
    const stored = sessionStorage.getItem(key);
    if (stored) {
      const sep = stored.lastIndexOf(':');
      const existingId = stored.slice(0, sep);
      const ts = parseInt(stored.slice(sep + 1));
      if (now - ts < 30 * 60 * 1000) {
        sessionStorage.setItem(key, existingId + ':' + now);
        return existingId;
      }
    }
    const id = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    sessionStorage.setItem(key, id + ':' + now);
    return id;
  }

  // Send event via fetch (Plausible uses fetch, not sendBeacon)
  function sendRequest(payload: Record<string, unknown>): void {
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      keepalive: true,
      body: JSON.stringify(payload),
    }).catch(function () {});
  }

  // Track a pageview — mirrors Plausible's autocapture.js logic
  function page(isSPANavigation?: boolean): void {
    // SPA dedup: skip if same pathname on SPA navigation
    if (isSPANavigation && lastPage === location.pathname) return;
    lastPage = location.pathname;

    // Parse UTM params
    const params = new URLSearchParams(location.search);

    sendRequest({
      t: 'pageview',
      s: siteKey,
      u: location.href,
      p: location.pathname,
      h: location.hostname,
      r: document.referrer || null,
      sw: screen.width,
      sid: getSessionId(),
      us: params.get('utm_source') || '',
      um: params.get('utm_medium') || '',
      uc: params.get('utm_campaign') || '',
    });
  }

  // Custom event API: window.traks('event_name', { props }, value)
  w.traks = function (
    name: string,
    props?: Record<string, unknown>,
    value?: number
  ): void {
    sendRequest({
      t: 'event',
      s: siteKey,
      p: location.pathname,
      h: location.hostname,
      sid: getSessionId(),
      en: name,
      ep: props ? JSON.stringify(props) : '',
      ev: value || 0,
    });
  };

  // SPA support — mirrors Plausible exactly:
  // - Intercept pushState only (NOT replaceState)
  // - Listen to popstate
  // - Pass isSPANavigation=true for dedup
  const his = history;
  if (his.pushState) {
    const originalPushState = his.pushState;
    his.pushState = function (...args: Parameters<typeof originalPushState>) {
      originalPushState.apply(this, args);
      page(true);
    };
    window.addEventListener('popstate', function () { page(true); });
  }

  // Handle prerendered/hidden pages (Plausible pattern)
  // Wait until page is visible before tracking
  if (document.visibilityState === 'hidden' || document.visibilityState === 'prerender') {
    document.addEventListener('visibilitychange', function handler() {
      if (document.visibilityState === 'visible') {
        page();
        document.removeEventListener('visibilitychange', handler);
      }
    });
  } else {
    page();
  }

  // Handle bfcache (back/forward navigation restoring cached page)
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) {
      page();
    }
  });
})();
