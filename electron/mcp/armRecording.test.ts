import { describe, expect, it, vi } from "vitest";
import { type ArmDeps, waitUntilQuiet } from "./armRecording";

const frame = { x: 0, y: 0, width: 100, height: 100 };

function makeDeps(overrides: Partial<ArmDeps> = {}) {
	let clock = 0;
	const deps: ArmDeps = {
		now: () => clock,
		sleep: async (ms) => {
			clock += ms;
		},
		lastInputAt: () => 0,
		waitForStill: vi.fn(async () => {
			clock += 400;
			return { settled: true, elapsedMs: 400 };
		}),
		...overrides,
	};
	return deps;
}

describe("waitUntilQuiet", () => {
	it("is quiet as soon as the screen settles and input is old", async () => {
		const deps = makeDeps();
		expect(await waitUntilQuiet(frame, { quietMs: 1000, timeoutMs: 5000 }, deps)).toMatchObject(
			{
				quiet: true,
			},
		);
		expect(deps.waitForStill).toHaveBeenCalledWith(
			frame,
			expect.objectContaining({ quietMs: 1000 }),
		);
	});

	it("waits for recent input to age out, then reports quiet", async () => {
		let clock = 0;
		const deps = makeDeps({
			now: () => clock,
			sleep: async (ms) => {
				clock += ms;
			},
			lastInputAt: () => 500,
			waitForStill: vi.fn(async () => ({ settled: true, elapsedMs: 0 })),
		});
		const result = await waitUntilQuiet(frame, { quietMs: 1000, timeoutMs: 5000 }, deps);
		expect(result.quiet).toBe(true);
		expect(clock).toBeGreaterThanOrEqual(1500);
	});

	it("times out with a reason when the screen never settles", async () => {
		const deps = makeDeps({
			waitForStill: vi.fn(async () => ({ settled: false, elapsedMs: 5000 })),
		});
		const result = await waitUntilQuiet(frame, { quietMs: 1000, timeoutMs: 5000 }, deps);
		expect(result.quiet).toBe(false);
		expect(result.message).toContain("no recording was started");
	});

	it("times out when input keeps arriving", async () => {
		let clock = 0;
		const deps = makeDeps({
			now: () => clock,
			sleep: async (ms) => {
				clock += ms;
			},
			lastInputAt: () => clock,
			waitForStill: vi.fn(async () => ({ settled: true, elapsedMs: 0 })),
		});
		expect((await waitUntilQuiet(frame, { quietMs: 1000, timeoutMs: 3000 }, deps)).quiet).toBe(
			false,
		);
	});

	it("rejects without waiting when the signal is already aborted", async () => {
		const deps = makeDeps();
		const controller = new AbortController();
		controller.abort(new Error("cancelled"));
		await expect(waitUntilQuiet(frame, { signal: controller.signal }, deps)).rejects.toThrow(
			"cancelled",
		);
		expect(deps.waitForStill).not.toHaveBeenCalled();
	});

	it("stops waiting for input to age out when the signal aborts", async () => {
		const controller = new AbortController();
		let clock = 0;
		const deps = makeDeps({
			now: () => clock,
			sleep: async (ms) => {
				clock += ms;
				controller.abort(new Error("cancelled"));
			},
			lastInputAt: () => clock,
			waitForStill: vi.fn(async () => ({ settled: true, elapsedMs: 0 })),
		});
		await expect(
			waitUntilQuiet(
				frame,
				{ quietMs: 1000, timeoutMs: 60_000, signal: controller.signal },
				deps,
			),
		).rejects.toThrow("cancelled");
		expect(deps.waitForStill).toHaveBeenCalledTimes(1);
	});

	it("falls back to the defaults for a NaN window instead of looping on NaN", async () => {
		const deps = makeDeps();
		const result = await waitUntilQuiet(
			frame,
			{ quietMs: Number.NaN, timeoutMs: Number.NaN },
			deps,
		);
		expect(result.quiet).toBe(true);
		expect(deps.waitForStill).toHaveBeenCalledWith(
			frame,
			expect.objectContaining({ quietMs: 1000, timeoutMs: expect.any(Number) }),
		);
		const passed = (deps.waitForStill as ReturnType<typeof vi.fn>).mock.calls[0][1].timeoutMs;
		expect(Number.isFinite(passed)).toBe(true);
	});

	it("reports an honest waitedMs and caps the timeout when the screen never settles", async () => {
		let clock = 0;
		const deps = makeDeps({
			now: () => clock,
			waitForStill: vi.fn(async (_f, o) => {
				clock += o.timeoutMs;
				return { settled: false, elapsedMs: o.timeoutMs };
			}),
		});
		const result = await waitUntilQuiet(frame, { timeoutMs: 10 ** 9 }, deps);
		expect(result).toMatchObject({ quiet: false, waitedMs: 120_000 });
	});

	it("times out at once for a zero timeout without sampling", async () => {
		const deps = makeDeps();
		expect(await waitUntilQuiet(frame, { timeoutMs: 0 }, deps)).toMatchObject({
			quiet: false,
			waitedMs: 0,
		});
		expect(deps.waitForStill).not.toHaveBeenCalled();
	});

	it("lets a failure from the stillness check through instead of reporting quiet", async () => {
		const deps = makeDeps({
			waitForStill: vi.fn(async () => {
				throw new Error("capture denied");
			}),
		});
		await expect(waitUntilQuiet(frame, {}, deps)).rejects.toThrow("capture denied");
	});
});
