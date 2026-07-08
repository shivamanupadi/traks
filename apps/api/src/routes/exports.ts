import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { sites } from '../db/schema';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Object keys are `<siteId>/<dateKey>[.N].ndjson.gz`; the public routes only
// ever accept the filename part.
const FILE_RE = /^\d{4}-\d{2}-\d{2}(\.\d+)?\.ndjson\.gz$/;

/**
 * Public, token-authenticated export access. The token is a long random
 * secret generated when the site owner enables exports; it grants read-only
 * access to that one site's export files, so DuckDB can read them directly:
 *
 *   SELECT * FROM read_ndjson_auto(
 *     'https://api.traks.dev/api/exports/<TOKEN>/2026-07-07.ndjson.gz');
 */
export const exportsRoute = app
  // List available export files for a token (JSON; feeds globs/scripts)
  .get('/:token', async c => {
    const token = c.req.param('token');
    const db = c.get('db')!;
    const [site] = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.exportToken, token), eq(sites.exportEnabled, true)));
    if (!site) return c.json({ error: 'Not found' }, 404);

    const listed = await c.env.EXPORTS.list({ prefix: `${site.id}/`, limit: 1000 });
    return c.json({
      data: listed.objects.map(o => ({
        file: o.key.slice(site.id.length + 1),
        size: o.size,
        uploaded: o.uploaded.toISOString(),
      })),
    });
  })

  // Download one export file
  .get('/:token/:file', async c => {
    const token = c.req.param('token');
    const file = c.req.param('file');
    if (!FILE_RE.test(file)) return c.json({ error: 'Not found' }, 404);

    const db = c.get('db')!;
    const [site] = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.exportToken, token), eq(sites.exportEnabled, true)));
    if (!site) return c.json({ error: 'Not found' }, 404);

    const object = await c.env.EXPORTS.get(`${site.id}/${file}`);
    if (!object) return c.json({ error: 'Not found' }, 404);

    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Length': String(object.size),
        'Content-Disposition': `attachment; filename="${file}"`,
      },
    });
  });
