# Migration rules

These migrations run on **every customer instance** (our own included — it is
installed through the wizard like any other customer), applied by the
deploy-wizard engine (`apps/home/api/src/deploy/engine.ts` → `applyMigrations`)
**before** the new worker code is uploaded. If an update fails between those
steps, the instance runs the _previous_ app version against the _new_ schema
until the user retries. There is no wrangler prod deploy of the platform; dev
uses `yarn db:migrate:dev`.

Therefore every migration must be **expand-contract**:

- Additive only: new tables, new nullable columns, new indexes.
- Never drop or rename a column/table the previous release still reads —
  do that at least one release _after_ the code stopped using it.
- No data rewrites that the previous release's queries can't tolerate.

Also: releases are stamped with the root `package.json` version
(`installer/upload-release.mjs` → `manifest.version`), which drives the
update-available banner on customer instances. `yarn traks:release` bumps it
automatically (patch by default; pass `minor`/`major`), anchored to the
currently published version — re-uploading under an unchanged version would be
invisible to instances, and the upload script refuses it.
