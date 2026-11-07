import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEffectiveRecordingDurationMs } from "@/lib/mediaTiming";
import { getWebcamMediaTargetTimeSeconds } from "@/components/video-editor/videoPlayback/webcamSync";
import { startBrowserRecorder } from "./browserRecorderStart";

function createRecorder(hasAudio = true) {
	const events = new EventTarget();
	const recorder = Object.assign(events, {
		state: "inactive" as RecordingState,
		stream: { getAudioTracks: () => (hasAudio ? [{}] : []) },
		start: vi.fn((_timeslice: number) => {
			recorder.state = "recording";
		}),
		stop: vi.fn(() => {
			recorder.state = "inactive";
			events.dispatchEvent(new Event("stop"));
		}),
	});
	return { recorder, mediaRecorder: recorder as unknown as MediaRecorder };
}

describe("browser recorder startup clock", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(100_000);
	});
	afterEach(() => vi.useRealTimers());

	it("retains buffered audio time in duration, telemetry and webcam offset", async () => {
		const { recorder, mediaRecorder } = createRecorder();
		const started = startBrowserRecorder(mediaRecorder, 250);
		const resolved = vi.fn();
		void started.then(resolved);
		await vi.advanceTimersByTimeAsync(11_203);
		expect(resolved).not.toHaveBeenCalled();
		recorder.dispatchEvent(new Event("start"));
		const origin = await started;
		expect(origin).toBe(100_000);
		expect(recorder.start).toHaveBeenCalledExactlyOnceWith(250);
		// The hook starts the webcam after success, but relative to the media clock.
		const webcamStartedAt = Date.now();
		const offset = webcamStartedAt - origin;
		expect(offset).toBe(11_203);
		expect(
			getWebcamMediaTargetTimeSeconds({
				currentTime: 12.203,
				timeOffsetMs: offset,
			}),
		).toBeCloseTo(1);
		expect(
			getEffectiveRecordingDurationMs({
				startTimeMs: origin,
				endTimeMs: 242_687,
				accumulatedPausedDurationMs: 0,
				pauseStartedAtMs: null,
			}),
		).toBe(142_687);
		expect(webcamStartedAt - origin).toBe(11_203); // telemetry elapsed time
		expect(vi.getTimerCount()).toBe(0);
	});

	it("preserves the first-output boundary for video-only capture", async () => {
		const { recorder, mediaRecorder } = createRecorder(false);
		const started = startBrowserRecorder(mediaRecorder, 250);
		await vi.advanceTimersByTimeAsync(5_000);
		recorder.dispatchEvent(new Event("start"));
		expect(await started).toBe(105_000);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("rejects a recorder stopped before its first output", async () => {
		const { recorder, mediaRecorder } = createRecorder();
		const started = startBrowserRecorder(mediaRecorder, 250);
		const rejected = expect(started).rejects.toThrow("stopped before starting");
		recorder.stop();
		recorder.dispatchEvent(new Event("start"));
		await rejected;
		expect(vi.getTimerCount()).toBe(0);
	});

	it("rejects a start event emitted while flushing an inactive recorder", async () => {
		const { recorder, mediaRecorder } = createRecorder();
		const started = startBrowserRecorder(mediaRecorder, 250);
		recorder.state = "inactive";
		recorder.dispatchEvent(new Event("start"));
		await expect(started).rejects.toThrow("stopped before starting");
		expect(vi.getTimerCount()).toBe(0);
	});

	it("stops and rejects on startup timeout", async () => {
		const { recorder, mediaRecorder } = createRecorder();
		const started = startBrowserRecorder(mediaRecorder, 250);
		const rejected = expect(started).rejects.toThrow("Timed out");
		await vi.advanceTimersByTimeAsync(15_000);
		await rejected;
		expect(recorder.stop).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("cleans up on asynchronous recorder errors", async () => {
		const { recorder, mediaRecorder } = createRecorder();
		const started = startBrowserRecorder(mediaRecorder, 250);
		recorder.dispatchEvent(new Event("error"));
		await expect(started).rejects.toThrow("failed to start");
		expect(vi.getTimerCount()).toBe(0);
	});

	it("cleans up when start throws synchronously", async () => {
		const { recorder, mediaRecorder } = createRecorder();
		recorder.start.mockImplementation(() => {
			throw new Error("Unsupported codec");
		});
		await expect(startBrowserRecorder(mediaRecorder, 250)).rejects.toThrow("Unsupported codec");
		expect(vi.getTimerCount()).toBe(0);
	});
});
