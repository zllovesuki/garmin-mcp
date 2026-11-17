import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { GarminClient } from "../src/garmin";
import { healthSummary, trainingSummary } from "../src/data";

function apiClient(handler: (url: URL) => unknown) {
	return new GarminClient(
		`test-${crypto.randomUUID()}`,
		env.TOKEN_CACHE,
		undefined,
		async (input) => {
			const url = new URL(
				typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
			);
			if (url.pathname.endsWith("/token"))
				return new Response(
					`header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86_400 }))}.signature`,
				);
			return Response.json(handler(url));
		},
	);
}

it("aggregates multiple activity pages, deduplicates IDs, and reports missing metric coverage", async () => {
	const activities = Array.from({ length: 51 }, (_, index) => ({
		activityId: index + 1,
		startTimeLocal: "2026-11-09 09:00:00",
		activityType: { typeKey: "running" },
		distance: index === 0 ? null : 1000,
		duration: 600,
	}));
	const client = apiClient((url) =>
		url.searchParams.get("start") === "0"
			? activities.slice(0, 50)
			: [activities[49], activities[50]],
	);
	const result = await trainingSummary(client, {
		start_date: "2026-11-09",
		end_date: "2026-11-15",
	});
	expect(result.complete).toBe(true);
	expect(result.activities).toBe(51);
	expect(result.weeks).toEqual([
		{
			week_start: "2026-11-09",
			sport: "running",
			activities: 51,
			distance_m: 50_000,
			duration_s: 30_600,
			elevation_gain_m: null,
			measurements: { distance: 50, duration: 51, elevation: 0 },
		},
	]);
});

it("splits inclusive health windows without gaps at a leap-day boundary and strips identity fields", async () => {
	const windows: string[][] = [];
	const client = apiClient((url) => {
		const start = url.searchParams.get("startDate")!;
		const end = url.searchParams.get("endDate")!;
		windows.push([start, end]);
		return {
			data: [
				{
					calendarDate: start,
					userProfilePk: 123,
					movement: { steps: { value: 1234, goal: 10000, distanceInMeters: 1000 } },
					heartRate: { restingValue: 50 },
					bodyBattery: { latestValue: 70, activityEvents: [{ deviceId: 555 }] },
				},
			],
		};
	});
	const result = await healthSummary(client, "2024-02-01", "2024-03-01", ["daily"]);
	expect(windows).toEqual([
		["2024-02-01", "2024-02-28"],
		["2024-02-29", "2024-03-01"],
	]);
	expect(JSON.stringify(result)).not.toMatch(/userProfilePk|deviceId/);
	expect(result).toMatchObject({
		daily: [
			{ movement: { steps: { value: 1234 } }, heartRate: { restingValue: 50 } },
			{ calendarDate: "2024-02-29" },
		],
	});
});
