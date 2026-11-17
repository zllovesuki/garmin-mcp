# Working agreements

Start with the smallest correct implementation that preserves useful behavior,
clear ownership, and security. Reuse the MCP SDK, Garmin FIT SDK, and Cloudflare
mechanisms. Add structure only when it removes a responsibility or solves a
current problem.

Read the affected code and a caller or focused test before changing behavior.
The live source, package versions, and `cloudflare.config.ts` are authoritative.
Do not turn proposals or historical notes into requirements.

# Product boundaries

This is a personal, read-only Garmin MCP service. Access authenticates the MCP
client through its Managed OAuth flow and the operator's identity provider. The Worker authorizes
the configured Access application and owner before any Garmin operation.

Garmin credentials authenticate only outbound Garmin requests. Incoming MCP
tokens never go to Garmin. Keep production authorization fail-closed. Development
Access simulation belongs only in development/test configuration.

KV holds a disposable bearer-token cache, not account ownership or health history.
Fetch data on demand. Preserve bounded downloads, date windows, pagination, and
explicit incomplete/truncated results. Missing measurements are not zero.
Workout targets and measured execution have different meanings. Keep GPS and
profile/device identifiers out of ordinary tool results.

# Development

Use pnpm and the pinned `cf` CLI. `.nvmrc` selects a supported Node version.
The project uses TypeScript and Vite+ with typed Oxc linting. Inspect package
scripts before running them. Dependency lifecycle scripts are disabled by default;
inspect and enable a specific hook only when it is necessary.

Use `pnpm run lint` for lint/type checks, `pnpm test` for the focused suite, and
`pnpm exec cf deploy --dry-run` when changing runtime wiring or configuration.
Use `pnpm run format` for formatting. `cf workers types` regenerates ignored
platform types; do not hand-edit them.

Test meaningful boundaries: authorization, Garmin token renewal and error
handling, multi-page/range queries, and real FIT decoding. Keep tests independent
of private recordings and live credentials. Do not assert implementation trivia,
mirror each wrapper, or add broad testing infrastructure. Once relevant checks
pass, stop unless a change, failure, or concrete unresolved issue requires more.

# Secrets and operation

Never print, commit, or place credentials in tool results. `.env` is local only;
production uses Worker secrets. Keep secrets, tokens, authorization headers, and
health payloads out of logs. Do not read unrelated credentials or runtime state
in reference projects. Keep live-account validation separate from automated tests.

Use `cf cli search` to discover commands and inspect the selected command's help.
Keep discovery queries generic; pass account/domain values only to the actual
resource command. Preserve existing account resources and unrelated source changes.

# Git and communication

Use concise Conventional Commit subjects. Explain what changed and why; describe
the mechanism when it helps. Organize changes into coherent commits. Omit routine
validation blocks, file inventories, and task narration from commit messages.
Do not push or create a remote unless requested.

Prefer short paragraphs in responses. Report the result and material limits;
keep verification results in the handoff rather than the commit. Documentation
should explain supported use and consequential constraints, not duplicate source.
