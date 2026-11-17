import { Encoder, Profile } from "@garmin/fitsdk";
import { zipSync } from "fflate/browser";
import { expect, it } from "vitest";
import { decodeActivityFile, MAX_ACTIVITY_FILE_BYTES } from "../src/fit";

function activityFixture() {
	const encoder = new Encoder();
	const write = (mesgNum: number, fields: Record<string, unknown>) =>
		encoder.onMesg(mesgNum, { mesgNum, ...fields });
	const start = new Date("2026-01-01T12:00:00Z");
	write(Profile.MesgNum.FILE_ID, {
		type: "activity",
		manufacturer: "development",
		timeCreated: start,
	});
	write(Profile.MesgNum.SESSION, {
		sport: "training",
		startTime: start,
		totalTimerTime: 120,
		totalDistance: 123.45,
	});
	write(Profile.MesgNum.LAP, {
		messageIndex: 0,
		wktStepIndex: 0,
		startTime: start,
		totalTimerTime: 60,
		totalDistance: 50.25,
		avgHeartRate: 120,
	});
	// The Encoder writes parent fields only; the Decoder expands milliseconds into durationTime seconds.
	write(Profile.MesgNum.WORKOUT_STEP, {
		messageIndex: 0,
		wktStepName: "Warm up",
		durationType: "time",
		durationValue: 60_000,
		targetType: "open",
		intensity: "warmup",
	});
	write(Profile.MesgNum.SET, {
		messageIndex: 0,
		startTime: start,
		duration: 30,
		setType: "active",
		repetitions: 8,
		weight: 22.5,
		category: [0],
		categorySubtype: [0],
		wktStepIndex: 0,
	});
	for (let index = 0; index < 5; index++) {
		write(Profile.MesgNum.RECORD, {
			timestamp: new Date(start.getTime() + index * 30_000),
			heartRate: 110 + index,
			distance: index * 10.25,
			speed: 2.5,
			altitude: 123.4,
			positionLat: 123456789,
			positionLong: -987654321,
		});
	}
	return encoder.close();
}

it("decodes original ZIPs into scaled workout structure and bounded samples without GPS", () => {
	const details = decodeActivityFile(
		zipSync({ "activity.fit": activityFixture(), "readme.txt": new Uint8Array([65]) }),
		{ maxSamples: 3 },
	);
	expect(details.sessions[0]).toMatchObject({ totalTimerTime: 120, totalDistance: 123.45 });
	expect(details.laps[0]).toMatchObject({
		wktStepIndex: 0,
		totalTimerTime: 60,
		totalDistance: 50.25,
		avgHeartRate: 120,
	});
	expect(details.workoutSteps[0]).toMatchObject({
		durationType: "time",
		durationTime: 60,
		wktStepName: "Warm up",
	});
	expect(details.strengthSets[0]).toMatchObject({
		setType: "active",
		repetitions: 8,
		weight: 22.5,
		category: ["benchPress"],
		categorySubtype: [0],
	});
	expect(details.samples.map((record) => record.heartRate)).toEqual([110, 112, 114]);
	expect(details.samples[0]).toMatchObject({ timestamp: "2026-01-01T12:00:00.000Z", speed: 2.5 });
	expect(details.samples[0].altitude).toBeCloseTo(123.4, 5);
	expect(details.samples.at(-1)?.timestamp).toBe("2026-01-01T12:02:00.000Z");
	expect(details.counts.records).toBe(5);
	expect(details.truncated.samples).toBe(true);
	expect(JSON.stringify(details)).not.toMatch(/positionLat|positionLong|123456789|987654321/);
});

it("rejects corruption and oversized downloads or expanded files", () => {
	const corrupt = activityFixture();
	corrupt[corrupt.length - 1] ^= 1;
	expect(() => decodeActivityFile(corrupt)).toThrow(/integrity/);
	const oversized = new Uint8Array(MAX_ACTIVITY_FILE_BYTES + 1);
	expect(() => decodeActivityFile(oversized)).toThrow(/download limit/);
	expect(() => decodeActivityFile(zipSync({ "large.fit": oversized }))).toThrow(/Expanded FIT/);
});
