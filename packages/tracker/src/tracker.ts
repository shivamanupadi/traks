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

  // Random session ID via sessionStorage (not a fingerprint - just a random token)
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

  // ---- Engagement time ----
  // Accumulate wall-clock time while the page is visible; flush it as an
  // 'engagement' event (ev = engaged seconds) when the visitor hides the tab,
  // leaves the page, or SPA-navigates away. Powers the visit-duration metric.
  let engagedStart = 0; // epoch ms while accumulating, 0 while paused
  let engagedMs = 0;

  function pauseEngagement(): void {
    if (engagedStart) {
      engagedMs += Date.now() - engagedStart;
      engagedStart = 0;
    }
  }

  function flushEngagement(path: string): void {
    pauseEngagement();
    const seconds = Math.round(engagedMs / 1000);
    engagedMs = 0;
    // Skip sub-second blips and absurd values (suspended laptops etc.)
    if (seconds < 1 || seconds > 4 * 3600) return;
    sendRequest({
      t: 'engagement',
      s: siteKey,
      p: path,
      h: location.hostname,
      sid: getSessionId(),
      ev: seconds,
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      flushEngagement(lastPage || location.pathname);
    } else if (lastPage) {
      engagedStart = Date.now();
    }
  });
  window.addEventListener('pagehide', function () {
    flushEngagement(lastPage || location.pathname);
  });

  function page(isSPANavigation?: boolean): void {
    if (isSPANavigation && lastPage === location.pathname) return;
    // SPA navigation: credit accumulated time to the page being left.
    if (isSPANavigation && lastPage) flushEngagement(lastPage);
    lastPage = location.pathname;
    engagedStart = Date.now();

    const params = new URLSearchParams(location.search);

    sendRequest({
      t: 'pageview',
      s: siteKey,
      p: location.pathname,
      h: location.hostname,
      r: document.referrer || '',
      sw: screen.width,
      sid: getSessionId(),
      us: params.get('utm_source') || '',
      um: params.get('utm_medium') || '',
      uc: params.get('utm_campaign') || '',
    });
  }

  // Custom event API: window.traks('event_name', { props }, value)
  w.traks = function (name: string, props?: Record<string, unknown>, value?: number): void {
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

  // SPA support - mirrors Plausible exactly:
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
    window.addEventListener('popstate', function () {
      page(true);
    });
  }

  // Prerender and hidden tabs: defer the initial pageview until the page is actually visible.
  // `prerender` is valid at runtime but not in every @types/dom version; cast narrowly.
  const initialVis = document.visibilityState as 'visible' | 'hidden' | 'prerender';
  if (initialVis === 'hidden' || initialVis === 'prerender') {
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
