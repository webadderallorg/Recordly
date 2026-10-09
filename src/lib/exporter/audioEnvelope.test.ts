import { describe, expect, it, vi } from "vitest";
import { envelopeBreakpointsMs, envelopeGainAt, hasEnvelope } from "./audioEnvelope";

describe("envelopeGainAt", () => {
	it("ramps a fade in and a fade out linearly", () => {
		const env = { fadeInMs: 1000, fadeOutMs: 1000 };
		const at = (t: number) => envelopeGainAt(env, 4000, [], t);
		expect([at(0), at(500), at(1000), at(2000), at(3500), at(4000)]).toEqual([
			0, 0.5, 1, 1, 0.5, 0,
		]);
	});

	it("takes the lower of an overlapping in and out", () => {
		const env = { fadeInMs: 3000, fadeOutMs: 3000 };
		expect(envelopeGainAt(env, 4000, [], 2000)).toBeCloseTo(2 / 3);
		expect(envelopeBreakpointsMs(env, 4000, [])).toContain(2000);
	});

	it("dips to the level inside a range and ramps back out", () => {
		const env = { duck: { level: 0.2, ranges: [] } };
		const ranges = [{ startMs: 1000, endMs: 2000 }];
		const at = (t: number) => envelopeGainAt(env, 5000, ranges, t);
		expect(at(500)).toBe(1);
		expect(at(1500)).toBeCloseTo(0.2);
		expect(at(2040)).toBeCloseTo(0.6);
		expect(at(3000)).toBe(1);
	});

	it("has nothing to apply for zero fades or an empty or level-1 duck", () => {
		expect(hasEnvelope({})).toBe(false);
		expect(hasEnvelope({ fadeInMs: 0, fadeOutMs: 0 })).toBe(false);
		expect(hasEnvelope({ duck: { level: 1, ranges: [{ startMs: 0, endMs: 1 }] } })).toBe(false);
		expect(hasEnvelope({ duck: { level: 0.5, ranges: [] } })).toBe(false);
		expect(hasEnvelope({ fadeOutMs: 1 })).toBe(true);
	});
});

describe("the exporter applies the envelope", () => {
	it("schedules gain automation on the region's gain node, offset into a later chunk", async () => {
		const { OfflineAudioProcessor } = await import("./offlineAudioProcessor");
		const calls: Array<[string, number, number?]> = [];
		const gain = {
			value: 0,
			setValueAtTime: vi.fn((v: number, t: number) => calls.push(["set", v, t])),
			linearRampToValueAtTime: vi.fn((v: number, t: number) => calls.push(["ramp", v, t])),
		};
		const ctx = {
			createGain: () => ({ gain, connect: vi.fn() }),
			createBufferSource: () => ({ connect: vi.fn(), start: vi.fn() }),
		};
		const processor = Object.create(OfflineAudioProcessor.prototype);
		const run = (region: object) =>
			processor.scheduleRegionForChunk(ctx, { duration: 10 }, region, [], 0, 10, true);
		run({
			id: "r",
			startMs: 0,
			endMs: 4000,
			audioPath: "",
			volume: 0.5,
			fadeInMs: 1000,
			fadeOutMs: 1000,
		});
		expect(calls).toEqual([
			["set", 0, 0],
			["ramp", 0.5, 1],
			["ramp", 0.5, 3],
			["ramp", 0, 4],
		]);
		calls.length = 0;
		run({ id: "r", startMs: 0, endMs: 4000, audioPath: "", volume: 1 });
		expect(calls).toEqual([]);
	});
});
