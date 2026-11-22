import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLightningExportError, collectRuntimeDiagnostics } from "./modernExportDiagnostics";
import { ModernExportSession } from "./modernExportSession";

const runtime: RendererExportRuntimeInfo = {
	appVersion: "2.0.0-beta.1",
	platform: "darwin",
	arch: "arm64",
	osVersion: "27.2",
	kernelRelease: "27.2.0",
	versions: { electron: "43.1.0", chromium: "152.0.7999.1", node: "24.15.0", v8: "15.2" },
};
const hooks = { getRuntimePlatform: () => "win32" as const };
const create = () =>
	new ModernExportSession({
		videoUrl: "file:///recording.mp4",
		width: 1200,
		height: 570,
		frameRate: 60,
		bitrate: 8_000_000,
	});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("native runtime identity", () => {
	it("prefers native runtime identity and labels an incompatible UA as compatibility text", async () => {
		vi.stubGlobal("navigator", {
			platform: "Win32",
			userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
		});
		vi.stubGlobal("window", {
			electronAPI: {
				getExportRuntimeInfo: async () => ({ success: true, runtime }),
				getAppVersion: async () => "old",
			},
		});
		const session = create();
		session.metrics.runtimeDiagnostics = await collectRuntimeDiagnostics(session, hooks);
		const message = buildLightningExportError(session, hooks, new Error("failure"));
		expect(message).toContain("Platform: macOS");
		expect(message).toContain("Recordly version: 2.0.0-beta.1");
		expect(message).toContain(
			"Runtime: Electron 43.1.0; Chromium 152.0.7999.1; Node.js 24.15.0; V8 15.2",
		);
		expect(message).toContain(
			"System: macOS 27.2; Electron process=arm64; kernel release=27.2.0",
		);
		expect(message).toContain("Browser user agent (compatibility string): Mozilla/5.0");
		expect(session.metrics.runtimeDiagnostics).toMatchObject({
			runtimeInfoStatus: "available",
			hardwareInfoStatus: "unavailable",
		});
	});
	it("bounds failed or missing runtime IPC independently of hardware", async () => {
		vi.stubGlobal("window", {
			electronAPI: {
				getExportRuntimeInfo: async () => {
					throw new Error("IPC failed");
				},
			},
		});
		const result = await collectRuntimeDiagnostics(create(), hooks);
		expect(result.runtimeInfoStatus).toBe("unavailable");
		expect(result.runtime).toBeUndefined();
	});
	it("times out runtime probes and never mutates the returned snapshot with a late reply", async () => {
		vi.useFakeTimers();
		let reply: (value: unknown) => void = () => undefined;
		vi.stubGlobal("window", {
			electronAPI: {
				getExportRuntimeInfo: () =>
					new Promise((resolve) => {
						reply = resolve;
					}),
				getAppVersion: async () => "2.0",
			},
		});
		const pending = collectRuntimeDiagnostics(create(), hooks);
		await vi.advanceTimersByTimeAsync(1500);
		const result = await pending;
		expect(result).toMatchObject({
			runtimeInfoStatus: "timed-out",
			hardwareInfoStatus: "unavailable",
			appVersion: "2.0",
		});
		reply({ success: true, runtime });
		await Promise.resolve();
		expect(result.runtime).toBeUndefined();
	});
});

it("separates unknown source FPS, original container duration, output timeline and retry elapsed times", () => {
	vi.spyOn(performance, "now").mockReturnValue(10_000);
	const session = create();
	session.sourceVideoInfo = {
		codec: "h264",
		width: 1920,
		height: 1080,
		frameRate: 60,
		frameRateSource: "fallback",
		duration: 33.732,
		hasAudio: false,
	};
	session.effectiveDurationSec = 31.16;
	session.metrics.diagnosticStartedAt = 1000;
	session.metrics.totalExportStartTimeMs = 8000;
	session.metrics.processedFrameCount = 9;
	const message = buildLightningExportError(session, hooks, new Error("failed"));
	expect(message).toContain(
		"unknown (decode fallback=60.000) FPS; 33.732s (untrimmed container duration)",
	);
	expect(message).toContain(
		"Output timeline: 31.160s; planned frames=1870; planned frame span=31.167s",
	);
	expect(message).toContain(
		"9/1870 (0.5%) reported output frames after 2.00s in current attempt",
	);
	expect(message).toContain("Total export elapsed: 9.00s (includes diagnostics and retries)");
	session.sourceVideoInfo.frameRateSource = "metadata";
	session.sourceVideoInfo.frameRate = 16.327;
	expect(buildLightningExportError(session, hooks, new Error("failed"))).toContain(
		"@ 16.327 FPS;",
	);
});

it("reports selected native, WebCodecs and rawvideo queue limits instead of the generic profile limit", () => {
	const session = create();
	session.config.maxEncodeQueue = 120;
	session.backpressureProfile = {
		name: "test-profile",
		maxEncodeQueue: 120,
		maxDecodeQueue: 12,
		maxPendingFrames: 32,
		maxInFlightNativeWrites: 2,
	};
	session.flow.maxNativeWriteInFlight = 2;
	session.native.nativeInputMode = "h264-stream";
	let report = buildLightningExportError(session, hooks, new Error("failed"));
	expect(report).toContain("Active encoder queue limit: 64 (native H.264 stream)");
	expect(report).toContain("Native writes in flight limit: 2");
	expect(report).not.toContain("encode queue=120");
	expect(report).not.toContain("encoder queue limit: 120");
	session.native.nativeInputMode = null;
	session.browser.encoder = {} as VideoEncoder;
	session.flow.webCodecsEncodeQueueLimit = 96;
	report = buildLightningExportError(session, hooks, new Error("failed"));
	expect(report).toContain("Active encoder queue limit: 96 (WebCodecs)");
	expect(report).not.toContain("encode queue=120");
	expect(report).not.toContain("encoder queue limit: 120");
	session.native.nativeInputMode = "rawvideo";
	report = buildLightningExportError(session, hooks, new Error("failed"));
	expect(report).toContain(
		"Native rawvideo writes in flight limit: 2; browser encoder queue not used",
	);
	expect(report).not.toContain("Active encoder queue limit:");
});
