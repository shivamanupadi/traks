/**
 * Install guides: one content source, two renderers.
 *
 * traks.dev renders these publicly with a placeholder snippet; the dashboard
 * renders the same guides with the site's REAL snippet substituted, so every
 * code sample is copy-paste-ready. Code samples embed SNIPPET_TOKEN wherever
 * the tracker tag belongs - replace it via guideWithSnippet().
 */

export const SNIPPET_TOKEN = '__TRAKS_SNIPPET__';

/** The queue stub lets window.traks() be called before t.js executes -
 *  the tracker drains window.traks.q on load. One line, two tags. */
export const TRACKER_STUB =
  '<script>window.traks=window.traks||function(){(window.traks.q=window.traks.q||[]).push(arguments)}</script>';

export function trackerSnippet(siteKey: string, collectUrl: string): string {
  return `${TRACKER_STUB}<script defer data-site="${siteKey}" src="${collectUrl}/t.js"></script>`;
}

export interface GuideCode {
  lang: string;
  filename?: string;
  code: string;
}

export interface GuideStep {
  title: string;
  body?: string;
  code?: GuideCode;
}

export interface InstallGuide {
  slug: string;
  name: string;
  /** One-liner for index cards. */
  blurb: string;
  steps: GuideStep[];
}

/**
 * Substitute the real (or example) site key + collect URL into a guide's code
 * samples. Three tokens: SNIPPET_TOKEN for the whole HTML tag, and
 * TRAKS_KEY / TRAKS_SRC for samples that embed the values in framework
 * config or JSX where a raw <script> tag can't appear.
 */
export function guideWithSnippet(
  guide: InstallGuide,
  siteKey: string,
  collectUrl: string
): InstallGuide {
  const snippet = trackerSnippet(siteKey, collectUrl);
  const sub = (text: string): string =>
    text
      .replaceAll(SNIPPET_TOKEN, snippet)
      .replaceAll('TRAKS_SRC', `${collectUrl}/t.js`)
      .replaceAll('TRAKS_KEY', siteKey);
  return {
    ...guide,
    steps: guide.steps.map(s =>
      s.code ? { ...s, code: { ...s.code, code: sub(s.code.code) } } : s
    ),
  };
}

export const INSTALL_GUIDES: InstallGuide[] = [
  {
    slug: 'html',
    name: 'HTML',
    blurb: 'Any site that serves HTML, no framework required.',
    steps: [
      {
        title: 'Add the snippet to your <head>',
        body: 'Paste the tracker tag into the <head> of every page you want to track. It is under 1KB, deferred, and cookieless.',
        code: {
          lang: 'html',
          filename: 'index.html',
          code: `<head>\n  ...\n  ${SNIPPET_TOKEN}\n</head>`,
        },
      },
      {
        title: 'Verify',
        body: 'Open your site in a new tab and watch yourself appear in the dashboard within seconds.',
      },
    ],
  },
  {
    slug: 'nextjs',
    name: 'Next.js',
    blurb: 'App Router or Pages Router, via next/script.',
    steps: [
      {
        title: 'Add the tracker to your root layout',
        body: 'Use next/script in app/layout.tsx so the tag ships on every page. The tracker follows client-side navigations automatically.',
        code: {
          lang: 'tsx',
          filename: 'app/layout.tsx',
          code: `import Script from 'next/script';\n\nconst TRAKS_STUB =\n  'window.traks=window.traks||function(){(window.traks.q=window.traks.q||[]).push(arguments)}';\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang="en">\n      <body>\n        {children}\n        <Script id="traks-stub" strategy="beforeInteractive">{TRAKS_STUB}</Script>\n        <Script defer data-site="TRAKS_KEY" src="TRAKS_SRC" strategy="afterInteractive" />\n      </body>\n    </html>\n  );\n}`,
        },
      },
      {
        title: 'Pages Router?',
        body: 'Put the same <Script> tag in pages/_app.tsx instead. Everything else is identical.',
      },
      {
        title: 'Verify',
        body: 'Run the site and click between pages. Each route change appears as a pageview in the dashboard.',
      },
    ],
  },
  {
    slug: 'react',
    name: 'React (Vite)',
    blurb: 'Vite, CRA, or any React SPA served from index.html.',
    steps: [
      {
        title: 'Add the snippet to index.html',
        body: 'SPAs need no extra wiring: the tracker hooks history.pushState, so client-side route changes are tracked as pageviews.',
        code: {
          lang: 'html',
          filename: 'index.html',
          code: `<head>\n  ...\n  ${SNIPPET_TOKEN}\n</head>`,
        },
      },
      {
        title: 'Hash-based routing?',
        body: 'If your router uses #/paths, add the data-hash attribute to the snippet so the hash becomes part of the tracked path.',
      },
    ],
  },
  {
    slug: 'vue',
    name: 'Vue',
    blurb: 'Vue 3 with Vite: one tag in index.html.',
    steps: [
      {
        title: 'Add the snippet to index.html',
        body: 'Router navigations (history mode) are tracked automatically.',
        code: {
          lang: 'html',
          filename: 'index.html',
          code: `<head>\n  ...\n  ${SNIPPET_TOKEN}\n</head>`,
        },
      },
    ],
  },
  {
    slug: 'nuxt',
    name: 'Nuxt',
    blurb: 'Nuxt 3, via app.head in nuxt.config.',
    steps: [
      {
        title: 'Register the script in nuxt.config.ts',
        body: 'Nuxt injects it into the <head> of every page, server- and client-rendered alike.',
        code: {
          lang: 'ts',
          filename: 'nuxt.config.ts',
          code: `export default defineNuxtConfig({\n  app: {\n    head: {\n      script: [\n        {\n          innerHTML:\n            'window.traks=window.traks||function(){(window.traks.q=window.traks.q||[]).push(arguments)}',\n        },\n        {\n          src: 'TRAKS_SRC',\n          defer: true,\n          'data-site': 'TRAKS_KEY',\n        },\n      ],\n    },\n  },\n});`,
        },
      },
      {
        title: 'Verify',
        body: 'Run the app and navigate between routes. Each shows up as a pageview.',
      },
    ],
  },
  {
    slug: 'astro',
    name: 'Astro',
    blurb: 'One is:inline tag in your base layout.',
    steps: [
      {
        title: 'Add the snippet to your layout',
        body: 'Mark it is:inline so Astro ships the tag untouched instead of bundling it.',
        code: {
          lang: 'astro',
          filename: 'src/layouts/Layout.astro',
          code: `<head>\n  ...\n  <script is:inline>window.traks=window.traks||function(){(window.traks.q=window.traks.q||[]).push(arguments)}</script>\n  <script is:inline defer data-site="TRAKS_KEY" src="TRAKS_SRC"></script>\n</head>`,
        },
      },
      {
        title: 'View transitions?',
        body: 'Astro view transitions use the history API, which the tracker follows automatically, so there is no extra setup.',
      },
    ],
  },
  {
    slug: 'sveltekit',
    name: 'SvelteKit',
    blurb: 'One tag in src/app.html.',
    steps: [
      {
        title: 'Add the snippet to app.html',
        body: 'Place it just above %sveltekit.head% so it ships with every page.',
        code: {
          lang: 'html',
          filename: 'src/app.html',
          code: `<head>\n  ...\n  ${SNIPPET_TOKEN}\n  %sveltekit.head%\n</head>`,
        },
      },
    ],
  },
  {
    slug: 'wordpress',
    name: 'WordPress',
    blurb: 'A one-line hook, no plugin required.',
    steps: [
      {
        title: 'Add a wp_head hook',
        body: "Drop this into your child theme's functions.php, or paste it into a snippets plugin like WPCode as a PHP snippet.",
        code: {
          lang: 'php',
          filename: 'functions.php',
          code: `add_action('wp_head', function () {\n  echo '${SNIPPET_TOKEN}';\n});`,
        },
      },
      {
        title: 'Prefer an editor-only route?',
        body: 'Block themes can instead paste the plain snippet into a Custom HTML block in the site-wide header template part.',
      },
    ],
  },
  {
    slug: 'webflow',
    name: 'Webflow',
    blurb: 'Site settings → Custom code, then publish.',
    steps: [
      {
        title: 'Open Site settings → Custom code',
        body: 'Paste the snippet into the "Head code" box. Custom code requires a paid Webflow site plan.',
        code: { lang: 'html', filename: 'Head code', code: SNIPPET_TOKEN },
      },
      {
        title: 'Publish',
        body: 'Custom code only ships on publish. Hit Publish and then load your live site to verify.',
      },
    ],
  },
  {
    slug: 'framer',
    name: 'Framer',
    blurb: 'Site Settings → Custom Code, then publish.',
    steps: [
      {
        title: 'Open Site Settings → General → Custom Code',
        body: 'Paste the snippet into "End of <head> tag". Custom code needs a paid Framer site plan.',
        code: { lang: 'html', filename: 'End of <head> tag', code: SNIPPET_TOKEN },
      },
      {
        title: 'Publish',
        body: 'Republish the site, then open it and watch yourself appear in the dashboard.',
      },
    ],
  },
  {
    slug: 'shopify',
    name: 'Shopify',
    blurb: 'One edit in theme.liquid.',
    steps: [
      {
        title: 'Edit your theme code',
        body: 'Online Store → Themes → ⋯ → Edit code, open layout/theme.liquid, and paste the snippet just before </head>.',
        code: {
          lang: 'liquid',
          filename: 'layout/theme.liquid',
          code: `  ...\n  ${SNIPPET_TOKEN}\n</head>`,
        },
      },
      {
        title: 'Save and verify',
        body: 'Save the file, open your storefront, and check the dashboard for your visit.',
      },
    ],
  },
];

export function findInstallGuide(slug: string): InstallGuide | undefined {
  return INSTALL_GUIDES.find(g => g.slug === slug);
}
