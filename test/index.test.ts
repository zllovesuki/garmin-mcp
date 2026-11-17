import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { expect, it } from "vitest";
import worker from "../src/index";

function request() {
	return new Request("https://garmin.example.com/mcp", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			"MCP-Protocol-Version": "2025-11-25",
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
	});
}

it("requires the configured Access application and owner, not forwarded headers", async () => {
	const context = createExecutionContext();
	const req = request();
	req.headers.set("Cf-Access-Jwt-Assertion", "forged");
	expect((await worker.fetch(req, env, context)).status).toBe(403);
	for (const [aud, email] of [
		["another-app", "local@example.com"],
		[env.ACCESS_AUD, "someone-else@example.com"],
	]) {
		const denied = Object.assign(createExecutionContext(), {
			access: { aud, getIdentity: async () => ({ email }) },
		});
		expect((await worker.fetch(request(), env, denied)).status).toBe(403);
		await waitOnExecutionContext(denied);
	}
	await waitOnExecutionContext(context);
});

it("serves the real MCP tool catalogue through the authenticated Worker", async () => {
	const context = Object.assign(createExecutionContext(), {
		access: { aud: env.ACCESS_AUD, getIdentity: async () => ({ email: env.OWNER_EMAIL }) },
	});
	const response = await worker.fetch(request(), env, context);
	expect(response.status).toBe(200);
	const text = await response.text();
	const payload = JSON.parse(text.startsWith("event:") ? text.split("data: ")[1].trim() : text);
	expect(payload.result.tools.map((tool: { name: string }) => tool.name)).toContain(
		"get_activity_recording",
	);
	expect(
		payload.result.tools.every(
			(tool: { annotations: { readOnlyHint: boolean } }) => tool.annotations.readOnlyHint,
		),
	).toBe(true);
	expect(response.headers.get("Cache-Control")).toBe("no-store");
	await waitOnExecutionContext(context);
});
