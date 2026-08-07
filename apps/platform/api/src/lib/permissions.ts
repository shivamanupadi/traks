import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, ownerAc, memberAc } from 'better-auth/plugins/organization/access';

/**
 * The single source of truth for workspace permissions, declared on Better
 * Auth's access-control engine — the same evaluator that guards the org
 * plugin's own endpoints (invites, member removal, org update/delete, via
 * the `ac`/`roles` options in lib/auth.ts). Custom resources extend the
 * plugin's defaults:
 *
 *   site:   create/update/delete plus `configure` (goals, segments, funnels)
 *   roster: who may see the workspace member list
 *
 * Adding a role (e.g. `admin`) or granting members a permission is an edit
 * HERE, not a hunt through route handlers.
 */
const statement = {
  ...defaultStatements,
  site: ['create', 'update', 'delete', 'configure'],
  roster: ['read'],
} as const;

export const ac = createAccessControl(statement);

const owner = ac.newRole({
  ...ownerAc.statements,
  site: ['create', 'update', 'delete', 'configure'],
  roster: ['read'],
});

/** Members are view-only: dashboards and stats, no mutations, no roster.
 *  `ac: []` deliberately overrides the plugin default of `ac: ['read']` — it
 *  is inert today but would hand members the role-introspection endpoints the
 *  moment dynamic access control is ever enabled. */
const member = ac.newRole({
  ...memberAc.statements,
  ac: [],
  site: [],
  roster: [],
});

export const workspaceRoles = { owner, member };

type Statement = typeof statement;
type PermissionRequest = { [K in keyof Statement]?: readonly Statement[K][number][] };

/** True iff `role` grants every requested permission. Unknown roles deny. */
export function roleAllows(role: string, request: PermissionRequest): boolean {
  const resolved = workspaceRoles[role as keyof typeof workspaceRoles];
  if (!resolved) return false;
  return resolved.authorize(request as Parameters<typeof resolved.authorize>[0]).success;
}
