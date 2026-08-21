#!/usr/bin/env node
/**
 * Regenerates src/lib/worldmap-dots.ts: a dotted world map sampled from
 * Natural Earth 110m land polygons (world-atlas), equirectangular, with the
 * empty polar rows and Antarctica clipped. Self-hosted so the dashboard never
 * requests map tiles from a third party.
 *
 *   node scripts/generate-worldmap.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';
import { geoContains } from 'd3-geo';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const topo = JSON.parse(readFileSync(require.resolve('world-atlas/land-110m.json'), 'utf8'));
const land = feature(topo, topo.objects.land);

const W = 1000;
const LAT_MAX = 84;
const LAT_MIN = -56;
const H = Math.round((W / 360) * (LAT_MAX - LAT_MIN));
const STEP = 1.35; // degrees between dots

const dots = [];
for (let lat = LAT_MAX; lat >= LAT_MIN; lat -= STEP) {
  for (let lon = -180; lon <= 180; lon += STEP) {
    if (!geoContains(land, [lon, lat])) continue;
    const x = Math.round(((lon + 180) / 360) * W);
    const y = Math.round(((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * H);
    dots.push(`M${x} ${y}h.01`);
  }
}

const out = `/**
 * Dotted world map for the realtime view - generated from Natural Earth 110m
 * land polygons (world-atlas) sampled on a ${STEP}° grid, equirectangular,
 * latitudes clipped to [${LAT_MIN}, ${LAT_MAX}]. Self-hosted on purpose: no map
 * tiles, no third-party requests from the dashboard. Regenerate with
 * apps/platform/web/scripts/generate-worldmap.mjs.
 */
export const WORLD_W = ${W};
export const WORLD_H = ${H};
export const WORLD_LAT_MAX = ${LAT_MAX};
export const WORLD_LAT_MIN = ${LAT_MIN};
/** Round-capped zero-length strokes; stroke-width sets the dot size. */
export const WORLD_DOTS_PATH =
  '${dots.join('')}';
`;
writeFileSync(path.join(root, 'src/lib/worldmap-dots.ts'), out);
console.log(`wrote ${dots.length} dots`);
