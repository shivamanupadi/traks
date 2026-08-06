# Migration rules

These migrations run in two very different places:

1. **Our hosted DB** (`yarn db:migrate:prod`) — applied before the new worker
   deploys, standard flow.
2. **Every customer instance**, applied by the deploy-wizard engine
   (`apps/home/api/src/deploy/engine.ts` → `applyMigrations`) **before** the new
   worker code is uploaded. If an update fails between those steps, the
   instance runs the *previous* app version against the *new* schema until the
   user retries.

Therefore every migration must be **expand-contract**:

- Additive only: new tables, new nullable columns, new indexes.
- Never drop or rename a column/table the previous release still reads —
  do that at least one release *after* the code stopped using it.
- No data rewrites that the previous release's queries can't tolerate.

Also: releases are stamped with the root `package.json` version
(`installer/upload-release.mjs` → `manifest.version`), which drives the
update-available banner on customer instances. **Bump the root version with
every `yarn traks:release`** — re-uploading under an unchanged version means
existing instances won't know an update exists.
