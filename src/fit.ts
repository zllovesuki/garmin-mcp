import { Decoder, Stream, type Mesg } from "@garmin/fitsdk";
import { Unzip, UnzipInflate } from "fflate/browser";

export const MAX_ACTIVITY_FILE_BYTES = 4 * 1024 * 1024;
const MAX_MESSAGES = 100_000;
const MAX_FIELDS = 750_000;
const MAX_COLLECTION = 256;

type Scalar = string | number | null;
type Metric = Record<string, Scalar | Scalar[]>;

const summaryFields = [
	"messageIndex",
	"startTime",
	"timestamp",
	"sport",
	"subSport",
	"totalElapsedTime",
	"totalTimerTime",
	"totalDistance",
	"totalCalories",
	"avgHeartRate",
	"maxHeartRate",
	"avgCadence",
	"maxCadence",
	"avgRunningCadence",
	"maxRunningCadence",
	"avgPower",
	"maxPower",
	"normalizedPower",
	"totalAscent",
	"totalDescent",
	"totalReps",
	"totalTrainingEffect",
	"totalAnaerobicTrainingEffect",
	"lapTrigger",
	"wktStepIndex",
];
const stepFields = [
	"messageIndex",
	"wktStepName",
	"intensity",
	"durationType",
	"durationValue",
	"durationTime",
	"durationDistance",
	"durationHr",
	"durationCalories",
	"durationStep",
	"durationPower",
	"durationReps",
	"targetType",
	"targetValue",
	"targetSpeedZone",
	"targetHrZone",
	"targetCadenceZone",
	"targetPowerZone",
	"repeatSteps",
	"repeatTime",
	"repeatDistance",
	"repeatCalories",
	"repeatHr",
	"repeatPower",
	"targetStrokeType",
	"customTargetValueLow",
	"customTargetValueHigh",
	"customTargetSpeedLow",
	"customTargetSpeedHigh",
	"customTargetHeartRateLow",
	"customTargetHeartRateHigh",
	"customTargetCadenceLow",
	"customTargetCadenceHigh",
	"customTargetPowerLow",
	"customTargetPowerHigh",
	"equipment",
	"exerciseCategory",
	"exerciseName",
	"exerciseWeight",
	"weightDisplayUnit",
];
const setFields = [
	"messageIndex",
	"startTime",
	"timestamp",
	"duration",
	"repetitions",
	"weight",
	"setType",
	"category",
	"categorySubtype",
	"weightDisplayUnit",
	"wktStepIndex",
];
const sampleFields = ["timestamp", "heartRate", "cadence", "distance", "power", "temperature"];

function extractFit(bytes: Uint8Array): Uint8Array {
	if (bytes.byteLength > MAX_ACTIVITY_FILE_BYTES) {
		throw new Error("Activity file exceeds the 4 MiB download limit.");
	}
	if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return bytes;

	let entries = 0;
	let fitFiles = 0;
	let size = 0;
	let complete = false;
	let failure: Error | undefined;
	const chunks: Uint8Array[] = [];
	const unzip = new Unzip((file) => {
		if (++entries > 64) throw new Error("Activity archive contains too many entries.");
		if (!file.name.toLowerCase().endsWith(".fit")) return;
		if (++fitFiles > 1) throw new Error("Activity archive contains multiple FIT files.");
		if ((file.originalSize ?? 0) > MAX_ACTIVITY_FILE_BYTES) {
			throw new Error("Expanded FIT file exceeds the 4 MiB limit.");
		}
		file.ondata = (error, chunk, final) => {
			if (failure) return;
			if (error) {
				failure = new Error("Activity archive could not be decompressed.");
				return;
			}
			size += chunk.byteLength;
			if (size > MAX_ACTIVITY_FILE_BYTES) {
				failure = new Error("Expanded FIT file exceeds the 4 MiB limit.");
				return;
			}
			chunks.push(chunk);
			complete = final;
		};
		file.start();
	});
	unzip.register(UnzipInflate);
	try {
		// Small compressed chunks bound allocation before each expansion-limit check.
		for (let offset = 0; offset < bytes.length; offset += 1024) {
			unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
			if (failure) throw failure;
		}
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("Activity archive")) throw error;
		if (error instanceof Error && error.message.startsWith("Expanded FIT")) throw error;
		throw new Error("Activity archive is invalid or unsupported.");
	}
	if (fitFiles === 0) throw new Error("Activity archive does not contain a FIT file.");
	if (!complete) throw new Error("Activity archive contains an incomplete FIT file.");
	const fit = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		fit.set(chunk, offset);
		offset += chunk.length;
	}
	return fit;
}

function scalar(value: unknown): Scalar | undefined {
	if (value instanceof Date)
		return Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	if (typeof value === "string") return value.slice(0, 256);
	return undefined;
}

function select(message: Mesg, fields: string[]): Metric {
	const source = message as Record<string, unknown>;
	const result: Metric = {};
	for (const field of fields) {
		const value = source[field];
		if (Array.isArray(value)) {
			// Keep category/subtype indices aligned, including missing values.
			result[field] = value.slice(0, 16).map((item) => scalar(item) ?? null);
		} else {
			const cleaned = scalar(value);
			if (cleaned !== undefined) result[field] = cleaned;
		}
	}
	return result;
}

function summary(message: Mesg): Metric {
	const source = message as Record<string, unknown>;
	const result = select(message, summaryFields);
	for (const key of ["avgSpeed", "maxSpeed", "avgAltitude", "maxAltitude", "minAltitude"]) {
		const enhancedKey = `enhanced${key[0].toUpperCase()}${key.slice(1)}`;
		const value = scalar(source[enhancedKey]) ?? scalar(source[key]);
		if (value !== undefined) result[key] = value;
	}
	return result;
}

function sample(message: Mesg): Metric {
	const source = message as Record<string, unknown>;
	const result = select(message, sampleFields);
	for (const key of ["speed", "altitude"]) {
		const enhancedKey = `enhanced${key[0].toUpperCase()}${key.slice(1)}`;
		const value = scalar(source[enhancedKey]) ?? scalar(source[key]);
		if (value !== undefined) result[key] = value;
	}
	return result;
}

export function decodeActivityFile(
	bytes: Uint8Array,
	{ maxSamples = 500 }: { maxSamples?: number } = {},
) {
	if (!Number.isInteger(maxSamples) || maxSamples < 2 || maxSamples > 2000) {
		throw new Error("maxSamples must be an integer from 2 to 2000.");
	}
	const fit = extractFit(bytes);
	const decoder = new Decoder(Stream.fromArrayBuffer(fit.slice().buffer));
	if (!decoder.isFIT() || !decoder.checkIntegrity()) {
		throw new Error("Activity is not a valid FIT file or failed its integrity check.");
	}
	let messageCount = 0;
	let fieldCount = 0;
	let limitExceeded = false;
	const checkLimits = () => {
		if (messageCount > MAX_MESSAGES || fieldCount > MAX_FIELDS) {
			limitExceeded = true;
			throw new Error("FIT decoding limit exceeded.");
		}
	};
	const { messages, errors } = decoder.read({
		includeUnknownData: false,
		decodeMemoGlobs: false,
		mesgDefinitionListener: (definition) => {
			messageCount++;
			fieldCount += definition.numFields + definition.developerFieldDefinitions.length;
			checkLimits();
		},
		mesgListener: (_number, message) => {
			messageCount++;
			for (const value of Object.values(message)) {
				fieldCount += Array.isArray(value) ? value.length : 1;
			}
			for (const value of Object.values(message.developerFields ?? {})) {
				fieldCount += Array.isArray(value) ? value.length : 1;
			}
			checkLimits();
		},
	});
	if (limitExceeded) throw new Error("Activity contains too much FIT data to decode safely.");
	if (errors.length) throw new Error("Activity FIT data could not be decoded completely.");

	const sessions = messages.sessionMesgs ?? [];
	const laps = messages.lapMesgs ?? [];
	const steps = messages.workoutStepMesgs ?? [];
	const sets = messages.setMesgs ?? [];
	const records = messages.recordMesgs ?? [];
	const sampleCount = Math.min(records.length, maxSamples);
	const samples = Array.from({ length: sampleCount }, (_, index) => {
		const sourceIndex =
			sampleCount <= 1 ? 0 : Math.round((index * (records.length - 1)) / (sampleCount - 1));
		return sample(records[sourceIndex]);
	});
	const counts = {
		sessions: sessions.length,
		laps: laps.length,
		workoutSteps: steps.length,
		strengthSets: sets.length,
		records: records.length,
	};
	const truncated = {
		sessions: sessions.length > 16,
		laps: laps.length > MAX_COLLECTION,
		workoutSteps: steps.length > MAX_COLLECTION,
		strengthSets: sets.length > MAX_COLLECTION,
		samples: records.length > maxSamples,
	};
	return {
		units: {
			timestamps: "ISO 8601 UTC",
			time: "seconds",
			distance: "metres",
			speed: "metres/second",
			altitude: "metres",
			heartRate: "beats/minute",
			cadence: "cycles/minute (running: strides/minute)",
			power: "watts",
			temperature: "degrees Celsius",
			weight: "kilograms",
			calories: "kilocalories",
			workoutTargets:
				"FIT target semantics; raw values retain their durationType/targetType encoding",
		},
		sampling:
			"Evenly spaced record indices, preserving first and last; observations, not averages.",
		fieldLimits: { stringCharacters: 256, arrayItems: 16 },
		counts,
		truncated,
		sessions: sessions.slice(0, 16).map(summary),
		laps: laps.slice(0, MAX_COLLECTION).map(summary),
		workoutSteps: steps.slice(0, MAX_COLLECTION).map((message) => select(message, stepFields)),
		strengthSets: sets.slice(0, MAX_COLLECTION).map((message) => select(message, setFields)),
		samples,
	};
}
