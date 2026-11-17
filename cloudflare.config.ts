import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig(({ mode }) => ({
	accountId: "6259e0f35111d6c3f7b6aa38ded6eccc",
	worker: {
		name: "garmin-mcp",
		compatibilityDate: "2026-11-16",
		entrypoint,
		compatibilityFlags: ["nodejs_compat"],
		domains: ["garmin.chens.link"],
		workersDev: false,
		previewUrls: false,
		// No static assets: Access context reaches the Worker directly.
		access:
			mode === "development" || mode === "test"
				? { dev: { aud: "local-garmin-mcp", identity: { email: "local@example.com" } } }
				: undefined,
		env: {
			GARMIN_PERSONAL_API_KEY: bindings.secret(),
			OWNER_EMAIL:
				mode === "development" || mode === "test"
					? bindings.text("local@example.com")
					: bindings.secret(),
			ACCESS_AUD:
				mode === "development" || mode === "test"
					? bindings.text("local-garmin-mcp")
					: bindings.secret(),
			TOKEN_CACHE: bindings.kv(),
		},
		observability: { enabled: true, logs: { invocationLogs: false } },
	},
}));
