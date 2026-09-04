# Security

Traks handles other people's traffic data, so reports are taken seriously and
answered quickly.

## Reporting a vulnerability

Please do not open a public issue for anything security-related. Use GitHub's
private reporting instead:

**[Report a vulnerability](https://github.com/shivamanupadi/traks/security/advisories/new)**

Include what you found, how to reproduce it, and what you think the impact is.
You will get an acknowledgement within three days and a fix or a clear answer
within two weeks for anything confirmed. Credit is given in the release notes
unless you prefer otherwise.

## Scope

- The platform that runs in users' Cloudflare accounts: `apps/platform`
  (collect Worker, api Worker, dashboard) and `packages/tracker` (`t.js`).
- The traks.dev deploy wizard and its backend: `apps/home`.
- Release tooling under `installer/`.

Cloudflare's own services are out of scope; report those to Cloudflare.

## What Traks stores, for context

- User instances store only what the dashboard shows: visitor counts from a
  daily-rotating hash, pages, referrers, geography. No IP addresses, no
  cookies, no cross-day identifiers.
- traks.dev stores nothing about instances. The wizard rediscovers them from
  the user's own Cloudflare account on each sign-in; a run's progress lives in
  a Durable Object that wipes itself after a day. Tokens are used for the
  request they arrive in and never persisted.
