# Deployment

Deploy into your own Cloudflare account, using a hostname you control. Production
denies access until the dedicated Access application and owner are configured.
The `workers.dev` and preview URLs are disabled. Set `accountId` and the custom
`domains` in `cloudflare.config.ts` for your deployment.

## Access setup

Create a dedicated self-hosted Access application for your hostname. Enable your
identity provider and restrict the Allow policy to your email address.
Use the whole hostname so OAuth discovery and `/mcp` share the
same application. Enable **Managed OAuth** under Advanced settings.

Allow the exact redirect URI shown by the ChatGPT custom MCP connection. Claude's
documented callback is `https://claude.ai/api/mcp/auth_callback`. Keep localhost
client registration disabled unless you also need a local OAuth client. Access
manages registration, token issuance, and refresh; this Worker does not implement
an OAuth server. Refer to
[Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)
for the current settings and defaults.

Put this Access application's AUD tag in the private `.env` file as `ACCESS_AUD`,
alongside `OWNER_EMAIL` and `GARMIN_PERSONAL_API_KEY`. The Worker checks both
the audience and owner, using Cloudflare's authenticated
`ctx.access` rather than trusting a caller-supplied header. Keep the Worker free of
Static Assets routing, which does not propagate that context.

For CLI administration, use `pnpm exec cf cli search "create access application"`
and inspect the selected command's schema. Existing Access apps and their policies
are independent of this application and should remain intact.

## Build and deploy

```sh
nvm use
pnpm install --ignore-scripts
pnpm check
pnpm test
pnpm exec cf deploy --dry-run
pnpm exec cf auth whoami
```

If needed, run `pnpm exec cf auth login`; `cf` uses credentials separate from
Wrangler. With Access configured and the personal key in the ignored `.env` file:

```sh
pnpm exec cf deploy --secrets-file .env
```

The CLI uploads the three private values with the Worker version and provisions the KV
namespace when needed. Use `.env` only for those values: every key declared in
the secrets file is eligible for upload. Keep key values out of shell arguments,
command output, and Git. Cloudflare's dotenv secrets loader expands dollar-sign
expressions; for secrets containing literal dollar signs, use its documented
escaping or a private JSON secrets file instead.

FIT decoding uses more CPU than simple JSON queries. Use a Workers plan that covers
the recordings you query; the Free plan's CPU allowance can be insufficient for
this workload. The application bounds input and decoded data but local tests do
not prove production CPU usage.

After deployment, connect both assistants and verify `get_connection_status`, one
activity query, and one recording. Also confirm that an unauthenticated request
gets Access's OAuth challenge and another identity cannot read data. A local
simulation or deployment dry run does not verify this external OAuth flow.

## Rotation and recovery

Garmin personal keys expire after the selected period, up to one year. Replace the
value privately in `.env` and deploy it again with `--secrets-file .env`. The token
cache is keyed by the personal key's fingerprint, so the new key starts with a
fresh exchange. The cache is disposable; removing it only causes another exchange.

To remove assistant access, revoke its Access grant or adjust this application's
policy. Access token and grant lifetimes govern reauthorization; an identity-provider account
change is not a promise of immediate revocation of an already-issued Access grant.
Deleting the Garmin key stops future Garmin access through that key.

The service stores no health history. The local `.cloudflare/` directory can hold
a cached bearer token, so keep it private and excluded from Git. Results already
returned to an assistant belong to that conversation's storage and retention.
