import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { ZodSchema } from 'zod';

/**
 * zValidator with an error body the UI can actually show.
 *
 * The default hook responds with the raw Zod error under `error`, i.e. an
 * object - while every other endpoint here returns `{ error: string }`. The
 * web client reads that one field, so a validation failure surfaced as
 * "[object Object]" and the carefully worded messages in @traks/shared never
 * reached anyone. Emit the first issue's message instead, which is written for
 * an end user ("A path must start with /, like /pricing").
 */
export function validate<T extends ZodSchema, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? 'Invalid request';
      return c.json({ error: message }, 400);
    }
    return undefined;
  });
}
