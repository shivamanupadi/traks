# @traks/cli

[Traks](https://traks.dev) — privacy-first web analytics that deploys into
**your own Cloudflare account**. No cookies, no consent banners, no event
caps; your traffic data never leaves your account.

## Install

```sh
# prerequisites (once per machine)
brew install opentofu        # or: https://opentofu.org/docs/intro/install/
npx wrangler login           # authorize your Cloudflare account

# create an R2 API token in the Cloudflare dashboard:
#   R2 → Manage API Tokens → permissions:
#   Workers R2 SQL Read + Workers R2 Data Catalog Write + Workers R2 Storage Write

CATALOG_TOKEN=<your-token> npx @traks/cli install
```

The installer provisions everything (D1, KV, R2 + Data Catalog, an event
pipeline, two Workers), runs smoke tests, and prints your dashboard URL and
tracking snippet. Open the URL and create your owner account — the first
sign-up claims the instance.

## Manage your instance

```sh
npx @traks/cli@latest update             # after a new release
npx @traks/cli doctor                    # health + drift check
npx @traks/cli destroy --instance traks  # full teardown (typed confirmation)
```

Or install globally for the short command: `npm i -g @traks/cli`, then
`traks install` / `traks update` / `traks doctor` / `traks destroy`.

Multiple instances (staging, per-client) via `--instance <name>`. State lives
in `~/.traks` — the Terraform workspace per instance is the ownership record,
so destroy only ever removes resources that instance created.

## Requirements

- Node 20+, OpenTofu (or Terraform) on PATH
- A Cloudflare account with R2 enabled (payment method on file; free tier
  bills $0) and Pipelines available
- Windows note: wrangler OAuth detection is macOS/Linux only — set
  `CLOUDFLARE_API_TOKEN` instead
