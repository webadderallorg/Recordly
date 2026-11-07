import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("./constants", () => ({ execFileAsync: state.exec }));

import { probeNativeVideoStreamStats, validateNativeVideoOutputFile } from "./probe";

const result = (duration = 600, frames = 18000) => ({
	stdout: JSON.stringify({
		streams: [
			{ duration: String(duration), nb_read_frames: String(frames), avg_frame_rate: "30/1" },
		],
	}),
});
beforeEach(() => {
	state.exec.mockReset().mockResolvedValue(result());
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});
it("allows a valid long export scan to complete after the old120second deadline", async () => {
	state.exec.mockImplementation(
		(_command, args, options) =>
			new Promise((resolve, reject) => {
				expect(args).toContain("-count_frames");
				const complete = setTimeout(() => {
					clearTimeout(deadline);
					resolve(result());
				}, 240_000);
				const deadline = setTimeout(() => {
					clearTimeout(complete);
					reject(new Error("probe timed out"));
				}, options.timeout);
			}),
	);
	const validation = expect(
		validateNativeVideoOutputFile("ffprobe", "/completed.mp4", {
			durationSec: 600,
			targetFrames: 18000,
		}),
	).resolves.toBeUndefined();
	await vi.advanceTimersByTimeAsync(240_000);
	await validation;
});
it("budgets high-frame-rate scans by frame workload and keeps a bounded short-scan floor", async () => {
	await probeNativeVideoStreamStats("ffprobe", "/short.mp4");
	expect(state.exec.mock.calls[0][2].timeout).toBe(120_000);
	await probeNativeVideoStreamStats("ffprobe", "/60fps.mp4", {
		durationSec: 600,
		targetFrames: 36000,
	});
	expect(state.exec.mock.calls[1][2].timeout).toBeGreaterThan(600_000);
	await probeNativeVideoStreamStats("ffprobe", "/huge.mp4", {
		durationSec: Number.MAX_VALUE,
		targetFrames: Number.MAX_VALUE,
	});
	expect(state.exec.mock.calls[2][2].timeout).toBe(2_147_483_647);
});
it("still rejects incomplete frame counts after a scan completes", async () => {
	state.exec.mockResolvedValue(result(600, 50));
	await expect(
		validateNativeVideoOutputFile("ffprobe", "/broken.mp4", {
			durationSec: 600,
			targetFrames: 18000,
		}),
	).rejects.toThrow("video frames 50");
});
