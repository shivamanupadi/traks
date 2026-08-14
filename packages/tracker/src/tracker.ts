(function () {
  // Prevent double initialization (HMR, duplicate script tags)
  const w = window as any;
  if (w.__pb) return;
  w.__pb = true;

  const scriptEl = document.currentScript as HTMLScriptElement | null;
  if (!scriptEl) return;

  const siteKey = scriptEl.getAttribute('data-site');
  if (!siteKey) return;

  // Opt-in script attributes:
  //   data-hash  - hash-based SPA routing: '#/route' becomes part of the page
  //                path and hashchange fires pageviews
  //   data-404   - put on the 404 template's snippet: fires a '404' event with
  //                the broken path as a prop (view it via the props breakdown)
  const useHash = scriptEl.hasAttribute('data-hash');
  const is404Page = scriptEl.hasAttribute('data-404');

  const endpoint = new URL(scriptEl.src).origin + '/api/event';
  let lastPage: string;

  function currentPath(): string {
    return useHash ? location.pathname + location.hash : location.pathname;
  }

  // Random session ID via sessionStorage (not a fingerprint - just a random
  // token). Storage access THROWS in partitioned iframes, Safari Lockdown
  // Mode, and when site data is blocked — so every access is guarded and we
  // fall back to an in-memory id. Losing session continuity is acceptable;
  // losing every event from that visitor is not.
  let memorySession = '';
  function newSessionId(): string {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  function getSessionId(): string {
    const key = '_pb_s';
    const now = Date.now();
    let store: Storage | null = null;
    try {
      store = window.sessionStorage;
    } catch {
      store = null;
    }
    if (!store) {
      if (!memorySession) memorySession = newSessionId();
      return memorySession;
    }
    try {
      const stored = store.getItem(key);
      if (stored) {
        const sep = stored.lastIndexOf(':');
        const existingId = stored.slice(0, sep);
        const ts = parseInt(stored.slice(sep + 1));
        if (now - ts < 30 * 60 * 1000) {
          store.setItem(key, existingId + ':' + now);
          return existingId;
        }
      }
      const id = newSessionId();
      store.setItem(key, id + ':' + now);
      return id;
    } catch {
      if (!memorySession) memorySession = newSessionId();
      return memorySession;
    }
  }

  // Send via fetch keepalive; on failure fall back to sendBeacon (survives
  // rapid navigations where the fetch is rejected before it's queued).
  function sendRequest(payload: Record<string, unknown>): void {
    const body = JSON.stringify(payload);
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      keepalive: true,
      body: body,
    }).catch(function () {
      try {
        if (navigator.sendBeacon) navigator.sendBeacon(endpoint, body);
      } catch {
        /* nothing left to try */
      }
    });
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
      flushEngagement(lastPage || currentPath());
    } else if (lastPage) {
      engagedStart = Date.now();
    }
  });
  window.addEventListener('pagehide', function () {
    flushEngagement(lastPage || currentPath());
  });

  function page(isSPANavigation?: boolean): void {
    if (isSPANavigation && lastPage === currentPath()) return;
    // SPA navigation: credit accumulated time to the page being left.
    if (isSPANavigation && lastPage) flushEngagement(lastPage);
    lastPage = currentPath();
    engagedStart = Date.now();

    const params = new URLSearchParams(location.search);

    sendRequest({
      t: 'pageview',
      s: siteKey,
      p: currentPath(),
      h: location.hostname,
      r: document.referrer || '',
      sw: screen.width,
      sid: getSessionId(),
      us: params.get('utm_source') || '',
      um: params.get('utm_medium') || '',
      uc: params.get('utm_campaign') || '',
    });
  }

  // Custom event API: window.traks('event_name', { props }, value).
  // The install snippet ships a stub that queues calls made before this
  // script executes (window.traks.q) — capture and replay them in order,
  // so early CTA clicks and hydration-effect events are never lost.
  const pending: IArguments[] =
    typeof w.traks === 'function' && Array.isArray(w.traks.q) ? w.traks.q : [];
  w.traks = function (name: string, props?: Record<string, unknown>, value?: number): void {
    sendRequest({
      t: 'event',
      s: siteKey,
      p: currentPath(),
      h: location.hostname,
      sid: getSessionId(),
      en: name,
      ep: props ? JSON.stringify(props) : '',
      ev: value || 0,
    });
  };
  for (let q = 0; q < pending.length; q++) {
    w.traks.apply(null, pending[q]);
  }

  // ---- Outbound links + file downloads ----
  // Auto-fired as reserved custom events ("Outbound Link: Click" /
  // "File Download") with the target URL in props. The keepalive fetch in
  // sendRequest survives the navigation, so no click delay is needed.
  const FILE_RE =
    /\.(7z|avi|csv|dmg|docx?|dxf|eps|exe|gz|iso|key|midi?|mov|mp3|mp4|mpe?g|pdf|pkg|pps|ppt|pptx|rar|rtf|tgz|txt|wav|wma|wmv|xlsx?|zip)$/i;

  function handleLinkClick(event: MouseEvent): void {
    // auxclick fires for all non-primary buttons; only middle-click navigates.
    if (event.type === 'auxclick' && event.button !== 1) return;
    let el = event.target as Element | null;
    while (el && el.tagName !== 'A') el = el.parentElement;
    const link = el as HTMLAnchorElement | null;
    if (!link || !link.href || !/^https?:$/.test(link.protocol)) return;

    let name: string;
    if (link.hostname && link.hostname !== location.hostname) {
      name = 'Outbound Link: Click';
    } else if (FILE_RE.test(link.pathname) || link.hasAttribute('download')) {
      name = 'File Download';
    } else {
      return;
    }
    sendRequest({
      t: 'event',
      s: siteKey,
      p: currentPath(),
      h: location.hostname,
      sid: getSessionId(),
      en: name,
      ep: JSON.stringify({ url: link.href.slice(0, 500) }),
      ev: 0,
    });
  }

  document.addEventListener('click', handleLinkClick, true);
  document.addEventListener('auxclick', handleLinkClick, true);

  if (useHash) {
    window.addEventListener('hashchange', function () {
      page(true);
    });
  }

  // 404 template: report the broken path once per load, alongside the pageview.
  if (is404Page) {
    sendRequest({
      t: 'event',
      s: siteKey,
      p: currentPath(),
      h: location.hostname,
      sid: getSessionId(),
      en: '404',
      ep: JSON.stringify({ path: currentPath().slice(0, 500) }),
      ev: 0,
    });
  }

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

  // Prerendered documents (Chrome speculation rules / omnibox) may never be
  // shown — defer their initial pageview until activation, using the signal
  // designed for exactly this (prerenderingchange). Everything else — even a
  // load in a hidden background tab — counts immediately: the old
  // visibility-based deferral silently LOST pageviews for pages evaluated
  // hidden and left before ever becoming visible.
  const doc = document as Document & { prerendering?: boolean };
  if (doc.prerendering) {
    doc.addEventListener(
      'prerenderingchange',
      function () {
        page();
      },
      { once: true }
    );
  } else {
    page();
  }

  // Handle bfcache (back/forward navigation restoring cached page). Flagged as
  // an SPA navigation so the lastPage dedup applies: popstate can fire first on
  // a bfcache restore, and an unflagged call would then double-count the view.
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) {
      page(true);
    }
  });
})();
