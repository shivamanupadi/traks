/**
 * Regenerate every logo/icon asset from the Tunnel mark — the SVGs in public/
 * (logo, dark, mono, favicon) plus all raster favicons and the touch icon.
 *
 * The mark: an ink arch with the lavender track running through it and out
 * both sides, a tint half-disc glowing inside — events passing through the
 * pipeline. Same family language as otterkit (thread mark) and payweave
 * (P mark): 2-3 flat shapes, bold overlap, brand hue + ink + tint.
 *
 * Bump the geometry or colors below and re-run; everything stays in sync
 * because this script is the single source of truth.
 *
 * Run: node scripts/generate-logos.js  (from apps/web)
 */
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PUB = p => path.join(path.dirname(fileURLToPath(import.meta.url)), '../public', p);

const INK = '#2D3436';
const INK_DARK = '#FDFBF8'; // ink shapes on dark grounds (family cream)
const LAVENDER = '#9B72CF'; // --primary in src/styles/index.css
const TINT = '#CDB8E7'; // lavender lerped 50% to white, payweave-style

/** The Tunnel mark on a 64 grid: ink arch, tint glow, lavender track over. */
const mark = (ink, track = LAVENDER, tint = TINT) => `
  <path d="M 14 52 L 14 32 A 18 18 0 0 1 50 32 L 50 52 Z" fill="${ink}"/>
  <path d="M 25 52 L 25 34 A 7 7 0 0 1 39 34 L 39 52 Z" fill="${tint}"/>
  <rect x="4" y="39" width="56" height="11" rx="5.5" fill="${track}"/>`;

/** 16px cut: tint glow dropped, track slightly heavier. */
const markSmall = (ink, track = LAVENDER) => `
  <path d="M 14 52 L 14 32 A 18 18 0 0 1 50 32 L 50 52 Z" fill="${ink}"/>
  <rect x="4" y="39" width="56" height="12" rx="6" fill="${track}"/>`;

/** Mono: tunnel opening knocked out of the arch, track in the same color. */
const markMono = `
  <path fill-rule="evenodd" d="M 14 52 L 14 32 A 18 18 0 0 1 50 32 L 50 52 Z
    M 25 52 L 25 34 A 7 7 0 0 1 39 34 L 39 52 Z" fill="currentColor"/>
  <rect x="4" y="39" width="56" height="11" rx="5.5" fill="currentColor"/>`;

const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">${body}
</svg>`;

/** Cream rounded tile for raster favicons — legible on any tab color. */
const faviconTile = inner =>
  svg(`
  <rect width="64" height="64" rx="13" fill="#FDFBF8"/>
  <g transform="translate(6.4,6.4) scale(0.8)">${inner}</g>`);

/** Full-bleed cream square for iOS (iOS applies its own corner mask). */
const touchIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">
  <rect width="180" height="180" fill="#FDFBF8"/>
  <g transform="translate(37,37) scale(1.656)">${mark(INK)}</g>
</svg>`;

/** Theme-aware favicon.svg — ink arch flips with the browser's color scheme. */
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <style>
    .i { fill: ${INK} }
    @media (prefers-color-scheme: dark) { .i { fill: ${INK_DARK} } }
  </style>${mark('', LAVENDER, TINT).replaceAll(' fill=""', ' class="i"')}
</svg>`;

/** Family sibling hues, used as accents on marketing images. */
const SAGE = '#6B8F71';
const CORAL = '#E07A5F';
const INK_2 = '#6B6560';

/**
 * Open Graph card, payweave-style composition: cream ground, soft brand-color
 * orbs, mark on the left, title + subtitle + colored keyword line.
 */
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"
  font-family="Helvetica Neue, Helvetica, Arial, sans-serif">
  <defs>
    <radialGradient id="orb-a"><stop offset="0" stop-color="${LAVENDER}" stop-opacity="0.13"/><stop offset="1" stop-color="${LAVENDER}" stop-opacity="0"/></radialGradient>
    <radialGradient id="orb-b"><stop offset="0" stop-color="${SAGE}" stop-opacity="0.11"/><stop offset="1" stop-color="${SAGE}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#FDFBF8"/>
  <circle cx="120" cy="90" r="360" fill="url(#orb-a)"/>
  <circle cx="1110" cy="560" r="320" fill="url(#orb-b)"/>
  <g transform="translate(150 219) scale(3)">${mark(INK)}</g>
  <text x="418" y="299" font-size="64" font-weight="bold" letter-spacing="-1.5" fill="${INK}">Traks</text>
  <text x="418" y="357" font-size="27" fill="${INK_2}">Privacy-friendly web analytics, self-hosted on Cloudflare</text>
  <text x="418" y="410" font-size="21" font-weight="bold" fill="${LAVENDER}">no cookies<tspan dx="16" fill="#A8A099" font-weight="normal">&#183;</tspan><tspan dx="16" fill="${SAGE}">your data, your account</tspan><tspan dx="16" fill="#A8A099" font-weight="normal">&#183;</tspan><tspan dx="16" fill="${CORAL}">Workers + R2 SQL</tspan></text>
</svg>`;

async function render(src, size, out) {
  await sharp(Buffer.from(src), { density: 300 }).resize(size, size).png().toFile(PUB(out));
  console.log(`  public/${out} (${size}px)`);
}

// ── vector sources ──
await writeFile(PUB('logo.svg'), svg(mark(INK)) + '\n');
await writeFile(PUB('logo-dark.svg'), svg(mark(INK_DARK)) + '\n');
await writeFile(PUB('logo-mono.svg'), svg(markMono) + '\n');
await writeFile(PUB('favicon.svg'), faviconSvg + '\n');
console.log('  public/logo.svg, logo-dark.svg, logo-mono.svg, favicon.svg');

// ── rasters ──
await render(faviconTile(markSmall(INK)), 16, 'favicon-16x16.png');
await render(faviconTile(mark(INK)), 32, 'favicon-32x32.png');
await render(faviconTile(mark(INK)), 48, 'favicon-48x48.png');
await render(faviconTile(mark(INK)), 96, 'favicon.png');
await render(touchIcon, 180, 'apple-touch-icon.png');

await sharp(Buffer.from(ogSvg)).png().toFile(PUB('og.png'));
console.log('  public/og.png (1200x630)');

const ico = await pngToIco(
  ['favicon-16x16.png', 'favicon-32x32.png', 'favicon-48x48.png'].map(PUB)
);
await writeFile(PUB('favicon.ico'), ico);
console.log('  public/favicon.ico');
