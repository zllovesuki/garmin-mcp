# garmin-mcp

A personal, read-only MCP server for Garmin Connect, hosted on Cloudflare Workers.
Connect ChatGPT or Claude to ask about activities, structured workouts, individual
laps and strength sets, daily health, and training trends. Data comes from Garmin's
official Personal API; the assistant supplies the analysis.

Cloudflare Access Managed OAuth handles client authorization through your chosen
identity provider. The
Worker checks the Access application and the configured owner before reading data.
The Garmin key remains on the server.

## Local development

Use a Node version supported by the pinned `cf` release. With nvm:

```sh
nvm use
pnpm install --ignore-scripts
pnpm exec cf workers types
```

Create a private `.env` file using `.env.example` as a guide:

```dotenv
GARMIN_PERSONAL_API_KEY=your-personal-key
OWNER_EMAIL=you@example.com
ACCESS_AUD=your-access-application-audience
```

`ACCESS_AUD` is needed for deployment; development uses a simulated Access identity.
Keep the file's permissions restricted (`chmod 600 .env`). The file and local runtime
state are ignored by Git. Start the Worker with `pnpm dev`; use the loopback URL
printed by Vite, followed by `/mcp`. Development mode simulates Access locally.
Do not expose the development server through a public tunnel.

## Development commands

| Command                         | Purpose                                                         |
| ------------------------------- | --------------------------------------------------------------- |
| `pnpm dev`                      | Run locally using `cf dev`                                      |
| `pnpm lint`                     | Typed Oxc linting and TypeScript checks                         |
| `pnpm format`                   | Format source, configuration, and documentation with Oxfmt      |
| `pnpm format:check`             | Check formatting without writing                                |
| `pnpm check`                    | Generate platform types, then check formatting, lint, and types |
| `pnpm test`                     | Run the focused Workers-runtime tests                           |
| `pnpm exec cf deploy --dry-run` | Build and validate deployment without uploading                 |

The `cf` scaffold's Vite+ tools own formatting, linting, and testing. Dependencies
and the CLI are resolved by `pnpm-lock.yaml`. The generated `.cloudflare/types/`
directory is local; regenerate it after changing bindings.

## Capabilities and limits

The service fetches data on demand. KV caches the Garmin bearer token, tied to the
current personal key, and can be discarded. It does not maintain a health database.

Original FIT recordings are decoded with Garmin's SDK. Results omit GPS and device
identifiers, retain lap/workout associations, and report truncation. Downloads and
expanded FIT files are limited to 4 MiB; unusually dense recordings may also hit
the decoder budget. Sensor samples are evenly spaced observations, not averages.

Health queries accept up to 90 calendar days. Training summaries accept up to 366
days and 1,000 activities, with explicit completeness and measurement-coverage
fields. Missing measurements remain unknown. Detailed workout instructions are
available only when Garmin associates a structured workout with the activity.

Read [the usage guide](docs/usage.md) for connection instructions and example
questions, and [deployment](docs/deployment.md) for the Access and Worker setup.

## Upstream references

Garmin's [Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api/)
and [API reference](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/)
define the supported data. Garmin's [FIT SDK](https://github.com/garmin/fit-javascript-sdk)
owns recording decoding and is distributed under its FIT Protocol License. This
project is not affiliated with Garmin.
