import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const append = vi.fn();
const read = vi.fn();
beforeEach(() => {
	vi.resetModules();
	append.mockReset().mockResolvedValue({ success: true });
	read.mockReset().mockResolvedValue({ success: true, logs: [] });
	vi.stubGlobal("window", {
		electronAPI: { appendExportDiagnostic: append, getExportDiagnostics: read },
	});
	vi.stubGlobal("navigator", { platform: "test", userAgent: "test" });
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("export support logs", () => {
	it("persists selected progress, backend and failure details and includes them in feedback after reload", async () => {
		const { createExportDiagnostics, getExportDiagnosticLogs } = await import(
			"./exportDiagnostics"
		);
		const tracker = createExportDiagnostics({ format: "mp4", quality: "high" }, "download");
		const progress = {
			currentFrame: 12,
			totalFrames: 100,
			percentage: 12,
			estimatedTimeRemaining: 4,
			renderBackend: "webgl" as const,
			encodeBackend: "ffmpeg" as const,
			encoderName: "Breeze",
			phase: "extracting" as const,
		};
		for (let i = 0; i < 20; i++) tracker.progress(progress);
		tracker.result({
			success: false,
			error: "Encoder failed for /Users/alice/movie.mp4 Bearer secret someone@example.com https://secret.test",
		});
		const logs = await getExportDiagnosticLogs();
		expect(logs).toHaveLength(3);
		expect(append).toHaveBeenCalledTimes(3);
		expect(logs.join("\n")).toContain('"encoderName":"Breeze"');
		for (const privateValue of ["alice", "secret", "someone@example.com", "movie.mp4"])
			expect(logs.join("\n")).not.toContain(privateValue);
		read.mockResolvedValue({ success: true, logs });
		vi.resetModules();
		const { collectFeedbackDiagnostics } = await import("./diagnostics");
		const payload = JSON.parse(await collectFeedbackDiagnostics());
		expect(payload.logs).toEqual(logs);
		expect(payload.logs.join("\n")).toContain("[export] failed");
	});
	it("bounds history and falls back to memory when disk logging fails", async () => {
		append.mockRejectedValue(new Error("disk unavailable"));
		read.mockRejectedValue(new Error("disk unavailable"));
		const { recordExportDiagnostic, getExportDiagnosticLogs } = await import(
			"./exportDiagnostics"
		);
		for (let i = 0; i < 80; i++)
			recordExportDiagnostic("progress", { frame: i, error: "x".repeat(4000) });
		const logs = await getExportDiagnosticLogs();
		expect(logs).toHaveLength(60);
		expect(logs.every((entry) => entry.length < 2000)).toBe(true);
		expect(logs[0]).toContain('"frame":20');
	});
	it("does not stall feedback when desktop logging never responds", async () => {
		vi.useFakeTimers();
		append.mockReturnValue(new Promise(() => {}));
		const { recordExportDiagnostic, getExportDiagnosticLogs } = await import(
			"./exportDiagnostics"
		);
		recordExportDiagnostic("started", { format: "gif" });
		const pending = getExportDiagnosticLogs();
		await vi.advanceTimersByTimeAsync(1500);
		expect(await pending).toHaveLength(1);
	});
});

it("persists GPU, encoder, fallback and timing evidence without project data", async () => {
	const { createExportDiagnostics, getExportDiagnosticLogs } = await import(
		"./exportDiagnostics"
	);
	const tracker = createExportDiagnostics(
		{ format: "mp4", backendPreference: "auto" },
		"download",
	);
	tracker.result({
		success: true,
		metrics: {
			totalElapsedMs: 600,
			frameCount: 30,
			renderBackend: "webgpu",
			encodeBackend: "webcodecs",
			nativeStaticLayoutSkipReasons: ["unsupported-caption-overlay"],
			metadataLoadMs: 20,
			decodeLoopMs: 350,
			encodeWaitMs: 40,
			finalizationStageMs: { encoderFlushMs: 12, muxerFinalizeMs: 5 },
			diagnostics: {
				elapsedMs: 900,
				requestedBackend: "auto",
				muxer: "mediabunny",
				encoder: {
					api: "webcodecs",
					codec: "avc1.640034",
					hardwareAcceleration: "prefer-software",
					latencyMode: "quality",
					hardwareEncoder: "not-exposed-by-webcodecs",
				},
				environment: {
					platform: "win32",
					hardwareInfoStatus: "available",
					arch: "x64",
					runtimeInfoStatus: "available",
					runtime: {
						appVersion: "2.0.0",
						platform: "win32",
						arch: "x64",
						osVersion: "10.0.26100",
						kernelRelease: "10.0.26100",
						versions: { electron: "43.1.0", chromium: "152.0", node: "24.15.0" },
					},
					gpus: [{ name: "AMD Radeon", vendor: "AMD", active: true }],
					gpuFeatures: {
						videoEncode: "disabled",
						videoDecode: "enabled",
						webgl: "enabled",
						webgpu: "enabled",
					},
				},
				attempts: [
					{
						route: "native-stream",
						status: "unavailable",
						elapsedMs: 50,
						reason: "Failed /Users/alice/movie.mp4 Bearer secret",
					},
					{
						route: "webcodecs",
						status: "selected",
						elapsedMs: 80,
						codec: "avc1.640034",
						hardwareAcceleration: "prefer-software",
					},
				],
			},
		},
	});
	const logs = await getExportDiagnosticLogs();
	const joined = logs.join("\n");
	for (const value of [
		"AMD Radeon",
		'"electron":"43.1.0"',
		'"osVersion":"10.0.26100"',
		'"runtimeInfoStatus":"available"',
		"not-exposed-by-webcodecs",
		"native-stream",
		"prefer-software",
		'"decodeLoopMs":350',
		'"encoderFlushMs":12',
		'"exportElapsedMs":900',
		"unsupported-caption-overlay",
	])
		expect(joined).toContain(value);
	for (const value of ["alice", "movie.mp4", "secret"]) expect(joined).not.toContain(value);
	expect(logs.at(-1)).toContain("[export] rendered");
	expect(logs.every((entry) => entry.length < 2000)).toBe(true);
});

it("keeps outcome fields when a backend error is very long", async () => {
	const { createExportDiagnostics, getExportDiagnosticLogs } = await import(
		"./exportDiagnostics"
	);
	createExportDiagnostics({ format: "mp4" }, "download").result({
		success: false,
		error: "x".repeat(8000),
		metrics: {
			totalElapsedMs: 20,
			frameCount: 0,
			encodeBackend: "webcodecs",
			encoderName: "avc1.640034/prefer-software",
		},
	});
	const last = (await getExportDiagnosticLogs()).at(-1)!;
	expect(last).toContain('"encoderName":"avc1.640034/prefer-software"');
	expect(last).toContain('"frameCount":0');
});

it("records the selected format's FPS and captures a restarted frame counter without inventing native versions", async () => {
	const { createExportDiagnostics, getExportDiagnosticLogs } = await import(
		"./exportDiagnostics"
	);
	const tracker = createExportDiagnostics(
		{
			format: "gif",
			mp4FrameRate: 60,
			gifConfig: { frameRate: 15, width: 320, height: 180 } as never,
		},
		"download",
	);
	const progress = {
		phase: "extracting" as const,
		currentFrame: 8,
		totalFrames: 1000,
		percentage: 0.8,
		estimatedTimeRemaining: 0,
	};
	tracker.progress(progress);
	tracker.progress({ ...progress, currentFrame: 0, percentage: 0 });
	const logs = await getExportDiagnosticLogs();
	expect(logs[0]).toContain('"frameRate":15');
	expect(logs.at(-1)).toContain('"currentFrame":0');
	expect(logs.at(-1)).toContain('"frameCounterEpoch":1');
});
