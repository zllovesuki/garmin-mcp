import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { GarminClient } from "../src/garmin";

function token(name: string) {
	return `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86_400, name }))}.signature`;
}

it("caches Garmin's text token, renews once after a 401, and isolates replacement keys", async () => {
	const first = token("first");
	const renewed = token("renewed");
	let exchanges = 0;
	let refuseFirst = false;
	const fetcher = vi.fn<typeof fetch>(async (input, init) => {
		const headers = new Headers(init?.headers);
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		if (url.endsWith("/token")) {
			expect(headers.get("Accept")).toBe("*/*");
			expect(headers.get("Authorization")).toMatch(/^ApiKey test-/);
			exchanges++;
			return new Response(exchanges === 1 ? first : renewed);
		}
		if (refuseFirst && headers.get("Authorization") === `Bearer ${first}`)
			return new Response(null, { status: 401 });
		return Response.json({ available: true });
	});
	const key = `test-${crypto.randomUUID()}`;
	await new GarminClient(key, env.TOKEN_CACHE, undefined, fetcher).json("/test");
	await new GarminClient(key, env.TOKEN_CACHE, undefined, fetcher).json("/test");
	expect(exchanges).toBe(1);
	refuseFirst = true;
	expect(await new GarminClient(key, env.TOKEN_CACHE, undefined, fetcher).json("/test")).toEqual({
		available: true,
	});
	expect(exchanges).toBe(2);
	await new GarminClient(`${key}-rotated`, env.TOKEN_CACHE, undefined, fetcher).json("/test");
	expect(exchanges).toBe(3);
});

it("does not retry rate limits or leak Garmin response bodies", async () => {
	const fetcher = vi.fn<typeof fetch>(
		async () =>
			new Response("sensitive upstream diagnostics", {
				status: 429,
				headers: { "Retry-After": "120" },
			}),
	);
	const client = new GarminClient(
		`test-${crypto.randomUUID()}`,
		env.TOKEN_CACHE,
		undefined,
		fetcher,
	);
	await expect(client.json("/test")).rejects.toMatchObject({
		code: "garmin_rate_limited",
		retryAfterSeconds: 120,
	});
	expect(fetcher).toHaveBeenCalledTimes(1);
});
