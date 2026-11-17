import { createMcpHandler } from "@modelcontextprotocol/server";
import { GarminClient } from "./garmin";
import { createServer } from "./tools";

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);
		if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
		// ctx.access is authenticated by Cloudflare, not supplied by request headers.
		// Requiring our specific application also closes alternate Worker URLs.
		if (!env.ACCESS_AUD || !ctx.access || ctx.access.aud !== env.ACCESS_AUD) {
			return new Response("Access required", { status: 403 });
		}
		const identity = await ctx.access.getIdentity();
		if (!env.OWNER_EMAIL || identity?.email?.toLowerCase() !== env.OWNER_EMAIL.toLowerCase()) {
			return new Response("Forbidden", { status: 403 });
		}
		const origin = request.headers.get("Origin");
		if (origin && ![url.origin, "https://chatgpt.com", "https://claude.ai"].includes(origin)) {
			return new Response("Origin not allowed", { status: 403 });
		}
		const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
		const client = new GarminClient(env.GARMIN_PERSONAL_API_KEY, env.TOKEN_CACHE, signal);
		const handler = createMcpHandler(() => createServer(client), {
			maxRequestBodySize: 16_384,
			maxSubscriptions: 0,
		});
		const response = await handler.fetch(request);
		const headers = new Headers(response.headers);
		headers.set("Cache-Control", "no-store");
		return new Response(response.body, { status: response.status, headers });
	},
} satisfies ExportedHandler<Env>;
