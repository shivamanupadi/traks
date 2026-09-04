# Contributing to Traks

Thanks for helping. Issues, questions, and pull requests are all welcome.

## Before you start

- **Using Traks** needs none of this: install it at [traks.dev/deploy](https://traks.dev/deploy).
- **Two codebases live here.** `apps/platform` and `packages/*` are what ships
  to users' Cloudflare accounts; `apps/home` is the traks.dev site and wizard.
  Most contributions are to the platform.
- **Secrets come from Doppler only.** The `dev` scripts pull each Worker's
  secrets from Doppler and never read the shell environment or local files. To
  run the platform locally you need Doppler projects of your own named
  `traks-api`, `traks-collect`, and `traks-home`, each with a `dev` config
  holding the keys listed in the README's
  [Getting started](README.md#develop-traks). Type-check, lint, and build need
  no secrets at all, so `yarn check:ci` works on a fresh clone.

## Workflow

1. Fork, branch from `main`, keep the change focused.
2. Run `yarn check:ci` before opening the PR. It runs formatting, lint, build,
   the D1 schema-drift check, the tracker inlining check, and the changelog
   check. The same job runs on every pull request.
3. **Platform changes get a release note.** Add a bullet under
   `## Unreleased` in `CHANGELOG.md`, under `Added`, `Changed`, `Fixed`, or
   `Breaking`. Write it for the person running an instance, not for the code
   reviewer. traks.dev-only changes get no entry; instances never receive
   them.
4. Describe what the change does for a user in the PR, and how you verified
   it.

## Conventions

- TypeScript throughout, Prettier formatting (`yarn format`), ESLint clean.
- Commit messages say what changed and why, in the imperative
  (`Collect: accept Plausible-compatible payloads`).
- Design follows the tokens in the existing UI: flat controls, hairline
  borders, one inset tone. When in doubt, match the nearest existing screen.

## Releases

Maintainers cut platform releases with `yarn traks:release`, which promotes
the `Unreleased` section, uploads the build, tags the commit, and publishes a
GitHub Release. Contributors never need to touch this.
