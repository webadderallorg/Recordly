import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
	createHudCrashRecoveryDeps,
	createStartTracker,
	nativeCaptureSidecarPaths,
	type HudCrashRecoveryDeps,
	type NativeCaptureState,
	stopRecordingWhenHudGoes,
} from "./hudCrashRecovery";

function setup(overrides: Partial<HudCrashRecoveryDeps> = {}) {
	const hud = new EventEmitter();
	const deps = {
		startSettled: vi.fn(async () => {}),
		isRecordingWithoutStopRequest: vi.fn(() => true),
		isUserRecording: vi.fn(() => true),
		stopRecording: vi.fn(async () => ({ success: true, path: "/rec/recording-1.mp4" })),
		finishRecording: vi.fn(async (stopped) => stopped),
		discardRecording: vi.fn(async () => {}),
		takePendingStoppedVideo: vi.fn(
			async () => null as { path: string; userRecording: boolean } | null,
		),
		takeStoppedCountdownCapture: vi.fn(async () => null as string | null),
		muxPendingStoppedVideo: vi.fn(async () => ({
			success: true,
			path: "/rec/recording-1.mp4",
		})),
		setRecordingState: vi.fn(),
		reportRecovered: vi.fn(async () => {}),
		...overrides,
	} satisfies HudCrashRecoveryDeps;
	return { hud, deps };
}

const crash = (hud: EventEmitter, reason = "crashed") =>
	hud.emit("render-process-gone", {}, { reason });

describe("stopRecordingWhenHudGoes", () => {
	it("stops, finishes and reports the recording, and leaves the recording state", async () => {
		const { hud, deps } = setup({
			finishRecording: vi.fn(async () => ({
				success: true,
				path: "/rec/recording-1.muxed.mp4",
			})),
		});
		stopRecordingWhenHudGoes(hud, deps);

		crash(hud);

		await vi.waitFor(() => expect(deps.reportRecovered).toHaveBeenCalled());
		expect(deps.stopRecording).toHaveBeenCalledTimes(1);
		expect(deps.finishRecording).toHaveBeenCalledWith({
			success: true,
			path: "/rec/recording-1.mp4",
		});
		expect(deps.setRecordingState).toHaveBeenCalledWith(false);
		expect(deps.reportRecovered).toHaveBeenCalledWith(
			{ success: true, path: "/rec/recording-1.muxed.mp4" },
			"crashed",
		);
		expect(deps.discardRecording).not.toHaveBeenCalled();
	});

	it("does nothing when no recording is running or Stop was already requested", async () => {
		const { hud, deps } = setup({ isRecordingWithoutStopRequest: vi.fn(() => false) });
		stopRecordingWhenHudGoes(hud, deps);

		crash(hud);

		await vi.waitFor(() => expect(deps.isRecordingWithoutStopRequest).toHaveBeenCalled());
		expect(deps.stopRecording).not.toHaveBeenCalled();
		expect(deps.setRecordingState).not.toHaveBeenCalled();
	});

	it("ignores a clean renderer exit", async () => {
		const { hud, deps } = setup();
		stopRecordingWhenHudGoes(hud, deps);

		crash(hud, "clean-exit");

		await Promise.resolve();
		expect(deps.startSettled).not.toHaveBeenCalled();
		expect(deps.stopRecording).not.toHaveBeenCalled();
	});

	it("stops and deletes a capture that was only warm-started for the countdown", async () => {
		const { hud, deps } = setup({ isUserRecording: vi.fn(() => false) });
		stopRecordingWhenHudGoes(hud, deps);

		crash(hud);

		await vi.waitFor(() => expect(deps.discardRecording).toHaveBeenCalled());
		expect(deps.discardRecording).toHaveBeenCalledWith("/rec/recording-1.mp4");
		expect(deps.finishRecording).not.toHaveBeenCalled();
		expect(deps.setRecordingState).not.toHaveBeenCalled();
		expect(deps.reportRecovered).not.toHaveBeenCalled();
	});

	it("waits for a running start before it decides", async () => {
		let settle = () => {};
		let recording = false;
		const { hud, deps } = setup({
			startSettled: vi.fn(
				() =>
					new Promise<void>((resolve) => {
						settle = resolve;
					}),
			),
			isRecordingWithoutStopRequest: vi.fn(() => recording),
			isUserRecording: vi.fn(() => false),
		});
		stopRecordingWhenHudGoes(hud, deps);

		crash(hud);
		await Promise.resolve();
		expect(deps.stopRecording).not.toHaveBeenCalled();
		// The helper comes up after the HUD died.
		recording = true;
		settle();

		await vi.waitFor(() => expect(deps.discardRecording).toHaveBeenCalled());
		expect(deps.stopRecording).toHaveBeenCalledTimes(1);
	});

	it("still leaves the recording state and reports when stopping fails", async () => {
		const { hud, deps } = setup({
			stopRecording: vi.fn(async () => {
				throw new Error("helper gone");
			}),
		});
		stopRecordingWhenHudGoes(hud, deps);

		crash(hud, "oom");

		await vi.waitFor(() => expect(deps.reportRecovered).toHaveBeenCalled());
		expect(deps.setRecordingState).toHaveBeenCalledWith(false);
		expect(deps.reportRecovered).toHaveBeenCalledWith(
			{ success: false, error: "Error: helper gone" },
			"oom",
		);
	});

	it("does not leave an unhandled rejection when the dialog fails", async () => {
		const unhandled = vi.fn();
		process.on("unhandledRejection", unhandled);
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const { hud, deps } = setup({
				reportRecovered: vi.fn(async () => {
					throw new Error("no display");
				}),
			});
			stopRecordingWhenHudGoes(hud, deps);

			crash(hud);

			await vi.waitFor(() =>
				expect(error).toHaveBeenCalledWith(
					"[hud-crash-recovery] Recovery failed:",
					expect.any(Error),
				),
			);
			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(unhandled).not.toHaveBeenCalled();
		} finally {
			process.off("unhandledRejection", unhandled);
			error.mockRestore();
		}
	});

	it("adds one listener per HUD however many recordings it starts", () => {
		const { hud, deps } = setup();
		for (let i = 0; i < 20; i++) stopRecordingWhenHudGoes(hud, deps);

		expect(hud.listenerCount("render-process-gone")).toBe(1);
	});
});

describe("createHudCrashRecoveryDeps", () => {
	function platform(
		state: Partial<NativeCaptureState> & {
			pendingPath?: string;
			pendingFileExists?: boolean;
			countdownPath?: string;
			countdownFileExists?: boolean;
		},
	) {
		const capture: NativeCaptureState = {
			nativeActive: false,
			nativeStopRequested: false,
			windowsActive: false,
			windowsStopRequested: false,
			userRecording: true,
			lastStopEndedUserRecording: true,
			...state,
		};
		const io = {
			captureState: () => capture,
			startSettled: vi.fn(async () => {}),
			stopNativeScreenRecording: vi.fn(async () => {
				// The real stop clears the active flags before it returns.
				capture.nativeActive = false;
				capture.windowsActive = false;
				return { success: true, path: "C:/rec/recording-1.mp4" };
			}),
			muxNativeWindowsRecording: vi.fn(async () => ({
				success: true,
				path: "C:/rec/recording-1.mp4",
				message: "muxed",
			})),
			clearWindowsPendingVideo: vi.fn(),
			windowsPendingVideoPath: vi.fn(() => state.pendingPath ?? null),
			stoppedCountdownPath: vi.fn(() => state.countdownPath ?? null),
			clearStoppedCountdownPath: vi.fn(),
			fileExists: vi.fn(async (filePath: string) =>
				filePath === state.countdownPath
					? (state.countdownFileExists ?? true)
					: (state.pendingFileExists ?? true),
			),
			deleteFile: vi.fn(async () => {}),
			telemetryPathFor: (videoPath: string) => `${videoPath}.cursor.json`,
			diagnosticsPathFor: (videoPath: string) =>
				videoPath.replace(/\.mp4$/, ".recording-diagnostics.json"),
			setRecordingState: vi.fn(),
			reportRecovered: vi.fn(async () => {}),
		};
		const hud = new EventEmitter();
		stopRecordingWhenHudGoes(hud, createHudCrashRecoveryDeps(io));
		return { io, crash: () => crash(hud) };
	}

	it("muxes the audio on Windows, as the renderer would after a stop", async () => {
		const { io, crash } = platform({ nativeActive: true, windowsActive: true });

		crash();

		await vi.waitFor(() => expect(io.reportRecovered).toHaveBeenCalled());
		expect(io.muxNativeWindowsRecording).toHaveBeenCalledTimes(1);
		expect(io.reportRecovered).toHaveBeenCalledWith(
			{ success: true, path: "C:/rec/recording-1.mp4", message: "muxed" },
			"crashed",
		);
		expect(io.setRecordingState).toHaveBeenCalledWith(false);
	});

	it("does not mux on macOS", async () => {
		const { io, crash } = platform({ nativeActive: true });

		crash();

		await vi.waitFor(() => expect(io.reportRecovered).toHaveBeenCalled());
		expect(io.muxNativeWindowsRecording).not.toHaveBeenCalled();
	});

	it("deletes a Windows countdown capture and its telemetry, without a mux", async () => {
		const { io, crash } = platform({
			nativeActive: true,
			windowsActive: true,
			userRecording: false,
		});

		crash();

		await vi.waitFor(() => expect(io.deleteFile).toHaveBeenCalledTimes(10));
		expect(io.clearWindowsPendingVideo).toHaveBeenCalled();
		expect(io.deleteFile).toHaveBeenNthCalledWith(1, "C:/rec/recording-1.mp4");
		expect(io.deleteFile).toHaveBeenNthCalledWith(2, "C:/rec/recording-1.mp4.cursor.json");
		expect(io.deleteFile).toHaveBeenNthCalledWith(
			3,
			"C:/rec/recording-1.recording-diagnostics.json",
		);
		expect(io.muxNativeWindowsRecording).not.toHaveBeenCalled();
		expect(io.reportRecovered).not.toHaveBeenCalled();
	});

	it("leaves a Windows capture alone once its stop was requested, though it sets nativeActive too", async () => {
		const { io, crash } = platform({
			nativeActive: true,
			windowsActive: true,
			windowsStopRequested: true,
		});

		crash();

		await vi.waitFor(() => expect(io.startSettled).toHaveBeenCalled());
		await Promise.resolve();
		expect(io.stopNativeScreenRecording).not.toHaveBeenCalled();
	});

	it("muxes a stopped Windows recording whose renderer died before its mux", async () => {
		// After its Stop the renderer has already left the recording state.
		const { io, crash } = platform({
			userRecording: false,
			lastStopEndedUserRecording: true,
			pendingPath: "C:/rec/recording-1.mp4",
		});

		crash();

		await vi.waitFor(() => expect(io.reportRecovered).toHaveBeenCalled());
		expect(io.stopNativeScreenRecording).not.toHaveBeenCalled();
		expect(io.muxNativeWindowsRecording).toHaveBeenCalledTimes(1);
		expect(io.deleteFile).not.toHaveBeenCalled();
		expect(io.setRecordingState).toHaveBeenCalledWith(false);
	});

	it("deletes a stopped Windows countdown capture whose renderer died before deleting it", async () => {
		const { io, crash } = platform({
			userRecording: false,
			lastStopEndedUserRecording: false,
			pendingPath: "C:/rec/recording-1.mp4",
		});

		crash();

		await vi.waitFor(() => expect(io.deleteFile).toHaveBeenCalledTimes(10));
		expect(io.deleteFile).toHaveBeenNthCalledWith(1, "C:/rec/recording-1.mp4");
		expect(io.clearWindowsPendingVideo).toHaveBeenCalled();
		expect(io.muxNativeWindowsRecording).not.toHaveBeenCalled();
		expect(io.reportRecovered).not.toHaveBeenCalled();
	});

	it("deletes a countdown capture the renderer stopped but hadn't deleted (macOS)", async () => {
		const { io, crash } = platform({
			userRecording: false,
			countdownPath: "/rec/recording-1.mp4",
		});

		crash();

		await vi.waitFor(() => expect(io.deleteFile).toHaveBeenCalledTimes(10));
		expect(io.deleteFile).toHaveBeenNthCalledWith(1, "/rec/recording-1.mp4");
		expect(io.deleteFile).toHaveBeenCalledWith("/rec/recording-1.system.m4a");
		expect(io.clearStoppedCountdownPath).toHaveBeenCalled();
		expect(io.stopNativeScreenRecording).not.toHaveBeenCalled();
		expect(io.reportRecovered).not.toHaveBeenCalled();
	});

	it("only forgets a stopped countdown the renderer already deleted", async () => {
		const { io, crash } = platform({
			userRecording: false,
			countdownPath: "/rec/recording-1.mp4",
			countdownFileExists: false,
		});

		crash();

		await vi.waitFor(() => expect(io.clearStoppedCountdownPath).toHaveBeenCalled());
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(io.deleteFile).not.toHaveBeenCalled();
	});

	it("only forgets a pending Windows video the renderer already deleted", async () => {
		const { io, crash } = platform({
			userRecording: false,
			pendingPath: "C:/rec/recording-1.mp4",
			pendingFileExists: false,
		});

		crash();

		await vi.waitFor(() => expect(io.clearWindowsPendingVideo).toHaveBeenCalled());
		await Promise.resolve();
		expect(io.muxNativeWindowsRecording).not.toHaveBeenCalled();
		expect(io.reportRecovered).not.toHaveBeenCalled();
	});
});

describe("createStartTracker", () => {
	it("waits for every overlapping start, not only the latest", async () => {
		const starts = createStartTracker();
		let finishSlow = () => {};
		const slow = starts.track(
			() =>
				new Promise<void>((resolve) => {
					finishSlow = resolve;
				}),
		);
		const fast = starts.track(async () => {});
		void slow();
		await fast();

		let settled = false;
		void starts.settled().then(() => {
			settled = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(settled).toBe(false);

		finishSlow();
		await vi.waitFor(() => expect(settled).toBe(true));
	});

	it("settles after a start that fails", async () => {
		const starts = createStartTracker();
		await expect(
			starts.track(async () => Promise.reject(new Error("no helper")))(),
		).rejects.toThrow();
		await expect(starts.settled()).resolves.toBeUndefined();
	});
});

describe("nativeCaptureSidecarPaths", () => {
	it("lists the audio and native webcam files of one capture, and nothing else", () => {
		expect(nativeCaptureSidecarPaths("/rec/recording-1.mp4")).toEqual([
			"/rec/recording-1.system.m4a",
			"/rec/recording-1.mic.m4a",
			"/rec/recording-1.system.wav",
			"/rec/recording-1.mic.wav",
			"/rec/recording-1.system.wav.json",
			"/rec/recording-1.mic.wav.json",
			"/rec/recording-1-webcam.mp4",
		]);
	});

	it("returns nothing for a path that isn't an MP4", () => {
		expect(nativeCaptureSidecarPaths("/rec/recording-1.webm")).toEqual([]);
	});
});
