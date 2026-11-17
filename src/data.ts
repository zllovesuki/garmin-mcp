import { GarminClient, GarminError } from "./garmin";

type Row = Record<string, unknown>;
const DAY = 86_400_000;

export function row(value: unknown): Row {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
	return value as Row;
}

function rows(value: unknown): Row[] {
	if (value === null) return [];
	if (!Array.isArray(value))
		throw new GarminError(
			"garmin_invalid_data",
			"Garmin returned an unexpected collection format.",
		);
	return value.map(row);
}

function pick(source: Row, keys: readonly string[]): Row {
	const result: Row = {};
	for (const key of keys) {
		const value = source[key];
		if (
			(typeof value === "number" && Number.isFinite(value)) ||
			typeof value === "boolean" ||
			value === null
		)
			result[key] = value;
		else if (typeof value === "string") result[key] = value.slice(0, 512);
	}
	return result;
}

function scalars(source: unknown): Row {
	return pick(row(source), Object.keys(row(source)));
}

function movement(source: unknown): Row {
	const value = row(source);
	return Object.fromEntries(
		["steps", "pushes", "floorsAscended", "floorsDescended"]
			.filter((key) => value[key] != null)
			.map((key) => [key, pick(row(value[key]), ["goal", "value", "distanceInMeters"])]),
	);
}

const activityFields = [
	"activityName",
	"description",
	"startTimeLocal",
	"startTimeGMT",
	"endTimeGMT",
	"distance",
	"duration",
	"movingDuration",
	"elapsedDuration",
	"elevationGain",
	"elevationLoss",
	"averageSpeed",
	"averageMovingSpeed",
	"maxSpeed",
	"averageHR",
	"minHR",
	"maxHR",
	"averagePower",
	"avgPower",
	"maxPower",
	"normalizedPower",
	"normPower",
	"calories",
	"averageRunningCadenceInStepsPerMinute",
	"averageBikingCadenceInRevPerMinute",
	"averageRunCadence",
	"averageBikeCadence",
	"averageSwimCadence",
	"averageSwimCadenceInStrokesPerMinute",
	"trainingEffect",
	"aerobicTrainingEffect",
	"anaerobicTrainingEffect",
	"trainingEffectLabel",
	"activityTrainingLoad",
	"trainingStressScore",
	"intensityFactor",
	"vO2MaxValue",
	"totalSets",
	"activeSets",
	"totalReps",
	"lapCount",
	"steps",
	"averageSWOLF",
	"averageSwolf",
	"poolLength",
	"numberOfActiveLengths",
	"activeLengths",
	"totalNumberOfStrokes",
	"strokes",
	"avgStrideLength",
	"strideLength",
	"groundContactTime",
	"verticalOscillation",
	"avgVerticalOscillation",
	"groundContactBalanceLeft",
	"avgGroundContactTime",
	"verticalRatio",
	"avgVerticalRatio",
	"hrTimeInZone_1",
	"hrTimeInZone_2",
	"hrTimeInZone_3",
	"hrTimeInZone_4",
	"hrTimeInZone_5",
	"powerTimeInZone_1",
	"powerTimeInZone_2",
	"powerTimeInZone_3",
	"powerTimeInZone_4",
	"powerTimeInZone_5",
	"powerTimeInZone_6",
	"powerTimeInZone_7",
	"directWorkoutRpe",
	"directWorkoutFeel",
	"splitType",
	"noOfSplits",
	"messageIndex",
] as const;

export const activityUnits = {
	distance: "metres",
	duration: "seconds",
	speed: "metres/second",
	heartRate: "beats/minute",
	power: "watts",
	elevation: "metres",
	calories: "kilocalories",
	strengthSummary: "maxWeight in grams; volume in gram-repetitions; duration in milliseconds",
};

export function activitySummary(source: Row): Row {
	const id = source.activityId;
	if (typeof id !== "number" && typeof id !== "string")
		throw new GarminError("garmin_invalid_data", "An activity was missing its ID.");
	const summary = row(source.summaryDTO);
	const result: Row = {
		...pick(source, activityFields),
		...pick(summary, activityFields),
		activityId: String(id),
		activityType: row(source.activityType ?? source.activityTypeDTO).typeKey,
		url: `https://connect.garmin.com/modern/activity/${id}`,
	};
	if (Array.isArray(source.summarizedExerciseSets)) {
		result.strengthSummary = source.summarizedExerciseSets
			.slice(0, 100)
			.map((set) =>
				pick(row(set), [
					"category",
					"subCategory",
					"sets",
					"reps",
					"maxWeight",
					"volume",
					"duration",
				]),
			);
	}
	return result;
}

export interface ActivityQuery {
	start_date: string;
	end_date: string;
	activity_type?: string;
	search?: string;
	limit?: number;
	offset?: number;
}

export async function listActivities(client: GarminClient, query: ActivityQuery) {
	const limit = query.limit ?? 20;
	const offset = query.offset ?? 0;
	const params = new URLSearchParams({
		start: String(offset),
		limit: String(limit),
		startDate: query.start_date,
		endDate: query.end_date,
		excludeChildren: "true",
		sortOrder: "desc",
	});
	if (query.activity_type) params.set("activityType", query.activity_type);
	if (query.search) params.set("search", query.search);
	const activities = rows(
		await client.json(`/activitylist-service/activities/search/activities?${params.toString()}`),
	).map(activitySummary);
	return {
		activities,
		next_offset: activities.length === limit ? offset + limit : null,
		units: activityUnits,
	};
}

export async function getActivity(client: GarminClient, id: string) {
	const source = row(await client.json(`/activity-service/activity/${id}`));
	return {
		...activitySummary(source),
		units: activityUnits,
		splitSummaries: Array.isArray(source.splitSummaries)
			? source.splitSummaries.slice(0, 100).map((split) => pick(row(split), activityFields))
			: [],
		splits_truncated: Array.isArray(source.splitSummaries) && source.splitSummaries.length > 100,
	};
}

export async function getWorkouts(client: GarminClient, id: string) {
	const workouts = rows(await client.json(`/activity-service/activity/${id}/workouts`));
	return {
		activityId: id,
		interpretation:
			"These are workout instructions associated with the recorded activity, not measured execution. TIME is seconds, DISTANCE metres, REPS count. For repeat instructions durationValue is the step index to return to. HR targets use % max HR or bpm + 100; power uses % FTP or watts + 1000. Exercise weights are kilograms regardless of display unit.",
		truncated:
			workouts.length > 20 ||
			workouts.some((workout) => Array.isArray(workout.steps) && workout.steps.length > 256),
		workouts: workouts.slice(0, 20).map((workout) => ({
			...pick(workout, ["index", "workoutName", "timeCreated", "sport", "workoutPhrase"]),
			steps: rows(workout.steps ?? [])
				.slice(0, 256)
				.map((step) =>
					pick(step, [
						"stepIndex",
						"name",
						"intensity",
						"durationType",
						"durationValue",
						"targetType",
						"targetValue",
						"targetValueLow",
						"targetValueHigh",
						"notes",
						"equipmentType",
						"exerciseCategory",
						"exerciseName",
						"exerciseWeightValue",
						"weightDisplayUnit",
					]),
				),
		})),
	};
}

/** Garmin range endpoints use inclusive calendar dates, not elapsed UTC hours. */
export function dateWindows(start: string, end: string, days = 28) {
	const windows: { start: string; end: string }[] = [];
	for (let cursor = Date.parse(start); cursor <= Date.parse(end); cursor += days * DAY) {
		windows.push({
			start: new Date(cursor).toISOString().slice(0, 10),
			end: new Date(Math.min(cursor + (days - 1) * DAY, Date.parse(end)))
				.toISOString()
				.slice(0, 10),
		});
	}
	return windows;
}

export type HealthMetric = "daily" | "sleep" | "hrv" | "weight";

async function healthWindow(
	client: GarminClient,
	metric: HealthMetric,
	start: string,
	end: string,
): Promise<Row[]> {
	const range = new URLSearchParams({ startDate: start, endDate: end });
	switch (metric) {
		case "daily": {
			const value = await client.json(`/usersummary-service/v2/dailysummaries?${range.toString()}`);
			return rows(value === null ? null : row(value).data).map((day) => ({
				...pick(day, ["calendarDate", "includesWellnessData", "includesActivityData"]),
				...Object.fromEntries(
					[
						"movement",
						"calories",
						"heartRate",
						"intensityMinutes",
						"stress",
						"bodyBattery",
						"hydration",
						"respiration",
						"pulseOx",
					]
						.filter((key) => day[key] != null)
						.map((key) => [key, key === "movement" ? movement(day[key]) : scalars(day[key])]),
				),
			}));
		}
		case "sleep":
			return rows(
				await client.json(`/sleep-service/sleep/dailySleepSummariesByDate?${range.toString()}`),
			).map((night) => ({
				...pick(night, [
					"calendarDate",
					"sleepTimeSeconds",
					"napTimeSeconds",
					"sleepStartTimestampGMT",
					"sleepEndTimestampGMT",
					"deepSleepSeconds",
					"lightSleepSeconds",
					"remSleepSeconds",
					"awakeSleepSeconds",
					"unmeasurableSleepSeconds",
					"averageSpO2Value",
					"averageRespirationValue",
					"avgSleepStress",
					"avgHeartRate",
					"awakeCount",
				]),
				sleepScore: row(row(night.sleepScores).overall).value ?? null,
			}));
		case "hrv": {
			const value = await client.json(`/hrv-service/hrv/daily/${start}/${end}`);
			return rows(value === null ? null : row(value).hrvSummaries).map((day) => ({
				...pick(day, ["calendarDate", "weeklyAvg", "lastNightAvg", "lastNight5MinHigh", "status"]),
				baseline: scalars(day.baseline),
			}));
		}
		case "weight": {
			const value = await client.json(
				`/weight-service/weight/range/${start}/${end}?includeAll=false`,
			);
			return rows(value === null ? null : row(value).dailyWeightSummaries).map((day) => ({
				calendarDate: day.summaryDate,
				...pick(row(day.latestWeight), [
					"weight",
					"bmi",
					"bodyFat",
					"bodyWater",
					"boneMass",
					"muscleMass",
					"visceralFat",
					"metabolicAge",
					"timestampGMT",
				]),
			}));
		}
	}
}

export async function healthSummary(
	client: GarminClient,
	start: string,
	end: string,
	metrics: HealthMetric[],
) {
	const data = await Promise.all(
		[...new Set(metrics)].map(async (metric) => {
			const values: Row[] = [];
			for (const window of dateWindows(start, end))
				values.push(...(await healthWindow(client, metric, window.start, window.end)));
			return [metric, values] as const;
		}),
	);
	return {
		start_date: start,
		end_date: end,
		date_basis: "Garmin calendar dates",
		missing_data: "Missing measurements are unknown, not zero.",
		units: {
			sleep: "seconds; timestamps in milliseconds since Unix epoch",
			hrv: "milliseconds",
			weight: "grams; body composition percentages",
			daily: "Garmin named summary fields; durations as named, heart rate in bpm",
		},
		...Object.fromEntries(data),
	};
}

export async function trainingSummary(client: GarminClient, query: ActivityQuery) {
	const activities: Row[] = [];
	const seen = new Set<string>();
	let next: number | null = 0;
	for (let page = 0; page < 20 && next !== null; page++) {
		const result = await listActivities(client, { ...query, offset: next, limit: 50 });
		for (const activity of result.activities) {
			const id = String(activity.activityId);
			if (!seen.has(id)) {
				seen.add(id);
				activities.push(activity);
			}
		}
		next = result.next_offset;
	}
	const groups = new Map<
		string,
		{
			week_start: string;
			sport: string;
			activities: number;
			distance_m: number;
			duration_s: number;
			elevation_gain_m: number;
			measurements: { distance: number; duration: number; elevation: number };
		}
	>();
	for (const activity of activities) {
		const date = new Date(`${String(activity.startTimeLocal).slice(0, 10)}T00:00:00Z`);
		if (!Number.isFinite(date.getTime()))
			throw new GarminError(
				"garmin_invalid_data",
				"An activity had no usable local date for aggregation.",
			);
		date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
		const week = date.toISOString().slice(0, 10);
		const sport = typeof activity.activityType === "string" ? activity.activityType : "unknown";
		const key = `${week}:${sport}`;
		const group = groups.get(key) ?? {
			week_start: week,
			sport,
			activities: 0,
			distance_m: 0,
			duration_s: 0,
			elevation_gain_m: 0,
			measurements: { distance: 0, duration: 0, elevation: 0 },
		};
		group.activities++;
		for (const [source, target, count] of [
			["distance", "distance_m", "distance"],
			["duration", "duration_s", "duration"],
			["elevationGain", "elevation_gain_m", "elevation"],
		] as const) {
			const value = activity[source];
			if (typeof value === "number") {
				group[target] += value;
				group.measurements[count]++;
			}
		}
		groups.set(key, group);
	}
	return {
		start_date: query.start_date,
		end_date: query.end_date,
		activities: activities.length,
		complete: next === null,
		next_offset: next,
		notes:
			"Weeks start Monday using activity-local dates. Multisport children are excluded to avoid double counting. Totals include only present measurements; counts show coverage. Narrow the dates if complete is false.",
		weeks: [...groups.values()]
			.sort((a, b) => a.week_start.localeCompare(b.week_start) || a.sport.localeCompare(b.sport))
			.map((group) => ({
				...group,
				distance_m: group.measurements.distance ? group.distance_m : null,
				duration_s: group.measurements.duration ? group.duration_s : null,
				elevation_gain_m: group.measurements.elevation ? group.elevation_gain_m : null,
			})),
	};
}
