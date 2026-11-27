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
	it("redacts prefixed token keys before writing structured export logs", async () => {
		const { getExportDiagnosticLogs, recordExportDiagnostic } = await import(
			"./exportDiagnostics"
		);
		recordExportDiagnostic("configured", {
			access_token: "opaque-access-value",
			nested: { authToken: "opaque-auth-value", width: 1920 },
		});
		const [entry] = await getExportDiagnosticLogs();
		expect(append).toHaveBeenCalledWith(entry);
		expect(JSON.parse(entry.slice(entry.indexOf("{")))).toEqual({
			access_token: "[redacted]",
			nested: { authToken: "[redacted]", width: 1920 },
		});
	});

	it("keeps the completed outcome when JSON escaping exhausts the diagnostic budget", async () => {
		const { createExportDiagnostics, getExportDiagnosticLogs } = await import(
			"./exportDiagnostics"
		);
		const { redactDiagnosticLogEntry } = await import("./diagnosticRedaction");
		const { summarizeExportDiagnostics } = await import("./exportDiagnosticSummary");
		const tracker = createExportDiagnostics({ format: "mp4" }, "download");
		const escaped = '"'.repeat(450);
		tracker.beginAttempt("modern");
		tracker.stage("finalize-output-file");
		tracker.record("video-reader-retry", { reason: escaped });
		tracker.record("renderer-media-failure", {
			asset: "webcam",
			mediaStage: "decode",
			code: "RENDER_MEDIA_TIMEOUT",
			reason: escaped,
		});
		tracker.record("save-failed", { error: `ENOSPC ${escaped}` });
		tracker.complete(false);

		const logs = (await getExportDiagnosticLogs()).map(redactDiagnosticLogEntry);
		expect(logs.find((line) => line.includes("[export] complete"))?.length).toBeLessThan(2000);
		expect(summarizeExportDiagnostics(logs, [])).toEqual([
			expect.objectContaining({
				status: "failed",
				stage: "finalize-output-file",
				code: "ENOSPC",
			}),
		]);
	});
	it("keeps the final cause and last retry in the report after older checkpoints rotate out", async () => {
		const { createExportDiagnostics, getExportDiagnosticLogs, recordExportDiagnostic } =
			await import("./exportDiagnostics");
		const tracker = createExportDiagnostics({ format: "mp4" }, "download");
		tracker.beginAttempt("modern");
		tracker.record("source-metadata", {
			width: 3840,
			height: 2160,
			duration: 20,
			codec: "h264",
		});
		tracker.record("configured", { width: 1920, height: 1080, frameRate: 30 });
		tracker.record("video-reader-retry", { reason: "Video reader worker failed" });
		tracker.record("renderer-media-failure", {
			asset: "webcam",
			mediaStage: "decode",
			code: "RENDER_MEDIA_TIMEOUT",
			reason: "Timed out waiting for webcam frame",
		});
		for (let i = 0; i < 70; i++) recordExportDiagnostic("progress", { currentFrame: i });
		tracker.stage("finalize-output-file");
		tracker.record("save-failed", {
			error: "ENOSPC: no space left on device, rename '/Users/alice/private.mov'",
		});
		tracker.complete(false);
		read.mockResolvedValue({ success: true, logs: await getExportDiagnosticLogs() });
		vi.resetModules();
		const { collectFeedbackDiagnostics } = await import("./diagnostics");
		const report = JSON.parse(await collectFeedbackDiagnostics());
		expect(report.recentExports).toEqual([
			expect.objectContaining({
				status: "failed",
				stage: "finalize-output-file",
				route: "modern",
				code: "ENOSPC",
				width: 1920,
				height: 1080,
				frameRate: 30,
				recoveryCount: 1,
				source: { width: 3840, height: 2160, duration: 20, codec: "h264" },
				lastRecovery: { route: "video-reader", reason: "Video reader worker failed" },
				lastMediaFailure: {
					asset: "webcam",
					mediaStage: "decode",
					code: "RENDER_MEDIA_TIMEOUT",
					reason: "Timed out waiting for webcam frame",
				},
			}),
		]);
		expect(JSON.stringify(report)).not.toContain("private.mov");
	});

	it("records the in-flight frame during silence and correlates a renderer crash to that export", async () => {
		vi.useFakeTimers();
		Object.assign(window, { setInterval });
		const { createExportDiagnostics, getExportDiagnosticLogs } = await import(
			"./exportDiagnostics"
		);
		const { summarizeExportDiagnostics } = await import("./exportDiagnosticSummary");
		const operation = { id: "0123456789abcdef", step: vi.fn(), finish: vi.fn() };
		const tracker = createExportDiagnostics({ format: "gif" }, "download", operation);
		tracker.beginAttempt("gif");
		tracker.stage("render-frame", 150);
		await vi.advanceTimersByTimeAsync(15_000);
		const logs = await getExportDiagnosticLogs();
		expect(summarizeExportDiagnostics(logs, [])).toEqual([
			expect.objectContaining({
				status: "no-progress",
				stage: "render-frame",
				frame: 150,
				idleMs: 15_000,
			}),
		]);
		const timestamp = new Date().toISOString();
		const common = {
			timestamp,
			appRunId: "1234567890abcdef",
			windowId: 9,
			surface: "editor" as const,
			sequence: 1,
		};
		const [crashed] = summarizeExportDiagnostics(logs, [
			{
				...common,
				name: "export.run",
				source: "renderer",
				phase: "start",
				operationId: operation.id,
			},
			{
				...common,
				name: "app.renderer-exit",
				source: "main",
				phase: "finish",
				stage: "oom",
				outcome: "failed",
				operationId: "234567890abcdef1",
			},
		]);
		expect(crashed).toMatchObject({
			status: "interrupted",
			interruption: "oom",
			stage: "render-frame",
			frame: 150,
		});
		tracker.stage("encode-gif-frame", 150);
		tracker.complete(true, "user");
		expect(vi.getTimerCount()).toBe(0);
		expect(summarizeExportDiagnostics(await getExportDiagnosticLogs(), [])[0]).toMatchObject({
			status: "cancelled",
			cancellation: "user",
		});
	});

	it("reports the final outcome after recovery and the save dialog", async () => {
		const { createExportDiagnostics } = await import("./exportDiagnostics");
		const operation = { id: "example", step: vi.fn(), finish: vi.fn() };
		const tracker = createExportDiagnostics({ format: "mp4" }, "download", operation);
		tracker.result({ success: false, error: "backend unavailable" });
		tracker.record("recovery-started");
		tracker.result({ success: true });
		tracker.record("saving");
		tracker.record("save-canceled");
		tracker.complete(false);
		expect(operation.step.mock.calls.flat()).toEqual([
			"recovery-started",
			"saving",
			"save-canceled",
		]);
		expect(operation.finish).toHaveBeenCalledExactlyOnceWith("cancelled");
	});
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
