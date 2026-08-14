import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => process.env.TEMP ?? process.cwd()),
		getAppPath: vi.fn(() => process.cwd()),
		isPackaged: false,
	},
}));

vi.mock("../constants", () => ({
	APP_SETTINGS_FILE: `${process.env.TEMP ?? process.cwd()}/prewarm-app-settings.json`,
}));

const fsMocks = vi.hoisted(() => ({
	readFile: vi.fn(async () => ""),
}));

vi.mock("node:fs/promises", () => ({
	default: fsMocks,
	...fsMocks,
}));

// Fully isolate the coordinator: the underlying cache work (native-video) is
// mocked so dedup/supersede/skip behaviors are deterministic.
const childProcessMocks = vi.hoisted(() => ({
	spawn: vi.fn(),
}));

// Mock the child_process spawn so no real helper process is launched during
// tests; warmNvidiaCudaCapabilityOnly builds its own fake child EventEmitter.
vi.mock("node:child_process", () => childProcessMocks);

// Mock the native-export module. getNativeExportCapabilities defaults the
// capability warm to a clean skip (available:false) so existing coordinator
// tests never spawn; session maps are empty so the active-export guard is off.
const capabilityPrewarmChildren = vi.hoisted(() => new Set<unknown>());
const nativeVideoMocks = vi.hoisted(() => ({
	prewarmNativeExportCaches: vi.fn(),
	getNativeExportCapabilities: vi.fn(),
	registerCapabilityOnlyPrewarmChild: vi.fn((child: unknown) => {
		capabilityPrewarmChildren.add(child);
		return () => {
			capabilityPrewarmChildren.delete(child);
		};
	}),
	cancelInFlightCapabilityOnlyPrewarms: vi.fn(() => {
		let cancelled = 0;
		for (const child of capabilityPrewarmChildren) {
			(child as { kill?: (sig: string) => void }).kill?.("SIGKILL");
			cancelled += 1;
		}
		capabilityPrewarmChildren.clear();
		return cancelled;
	}),
	nativeVideoExportSessions: new Map(),
	nativeStaticLayoutExportSessions: new Map(),
}));

vi.mock("./native-video", () => nativeVideoMocks);

import { EventEmitter } from "node:events";
import {
	beginNewRecordingGeneration,
	resetNvidiaCudaCapabilityPrewarmKeys,
	triggerNativeExportPrewarm,
	warmNvidiaCudaCapabilityOnly,
} from "./native-prewarm";
import {
	cancelInFlightCapabilityOnlyPrewarms,
	getNativeExportCapabilities,
	nativeVideoExportSessions,
	prewarmNativeExportCaches,
	registerCapabilityOnlyPrewarmChild,
} from "./native-video";

const mockedPrewarm = prewarmNativeExportCaches as unknown as ReturnType<typeof vi.fn>;
const mockedCapabilities = getNativeExportCapabilities as unknown as ReturnType<typeof vi.fn>;
const mockedSpawn = childProcessMocks.spawn as unknown as ReturnType<typeof vi.fn>;

// Builds a fake child process emitted by the mocked spawn, with stdout/stderr
// streams. Returns a helper to emit output, error, and close, and record kills.
function fakeChild() {
	const stdout = new EventEmitter();
	const stderr = new EventEmitter();
	const child = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter;
		stderr: EventEmitter;
		killedWith: string[];
		kill: (signal?: NodeJS.Signals) => void;
	};
	child.stdout = stdout;
	child.stderr = stderr;
	child.killedWith = [];
	child.kill = (signal?: NodeJS.Signals) => {
		if (signal) {
			child.killedWith.push(signal as string);
		}
	};
	return child;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function settingsJson(exportVideoCodec?: unknown, exportEncoderPreference?: unknown): string {
	return JSON.stringify({
		"recordly.editor.preferences": {
			exportVideoCodec,
			exportEncoderPreference,
		},
	});
}

function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
	beginNewRecordingGeneration();
	vi.clearAllMocks();
	resetNvidiaCudaCapabilityPrewarmKeys();
	// Capability warm defaults to a clean skip so coordinator tests never spawn.
	mockedCapabilities.mockResolvedValue({
		platform: "win32",
		nvidiaCuda: { available: false, skipReason: "test-disabled" },
	});
	mockedPrewarm.mockResolvedValue({
		sourceMetadataCached: true,
		cudaAvailabilityResolved: false,
		resolvedEncoders: ["h264_nvenc", "libx264"],
		skipReasons: ["source-metadata-cached:h264"],
	});
	mockedSpawn.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

function setupConsoleSpy() {
	const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
	return info;
}

describe("triggerNativeExportPrewarm", () => {
	it("coalesces duplicate concurrent requests for the same route into one prewarm", async () => {
		fsMocks.readFile.mockResolvedValue(settingsJson("h264", "auto"));
		const gate = deferred<void>();
		mockedPrewarm.mockReturnValueOnce(
			gate.promise.then(() => ({
				sourceMetadataCached: true,
				cudaAvailabilityResolved: false,
				resolvedEncoders: ["h264_nvenc", "libx264"],
				skipReasons: ["source-metadata-cached:h264"],
			})),
		);
		const info = setupConsoleSpy();

		const first = triggerNativeExportPrewarm("C:/rec/recording.mp4");
		const second = triggerNativeExportPrewarm("C:/rec/recording.mp4");
		gate.resolve();
		await Promise.all([first, second]);

		expect(mockedPrewarm).toHaveBeenCalledTimes(1);
		const startedLogs = info.mock.calls.filter((call) => call[1] === "[native-prewarm] start");
		expect(startedLogs).toHaveLength(1);
	});

	it("uses the persisted high-level codec and encoder preference when known", async () => {
		fsMocks.readFile.mockResolvedValue(settingsJson("hevc", "hardware"));
		const info = setupConsoleSpy();

		await triggerNativeExportPrewarm("C:/rec/hevc-recording.mp4");

		expect(mockedPrewarm).toHaveBeenCalledTimes(1);
		expect(mockedPrewarm.mock.calls[0][0]).toMatchObject({
			inputPath: "C:/rec/hevc-recording.mp4",
			videoCodec: "hevc",
			encoderPreference: "hardware",
		});
		expect(info.mock.calls.some((call) => call[1] === "[native-prewarm] complete")).toBe(true);
	});

	it("skips a redundant identical route within the same generation", async () => {
		fsMocks.readFile.mockResolvedValue(settingsJson("h264", "auto"));
		const info = setupConsoleSpy();

		await triggerNativeExportPrewarm("C:/rec/recording.mp4");
		await triggerNativeExportPrewarm("C:/rec/recording.mp4");

		expect(mockedPrewarm).toHaveBeenCalledTimes(1);
		const skipLogs = info.mock.calls.filter(
			(call) =>
				call[1] === "[native-prewarm] skip" && call[2]?.reason === "already-prewarmed",
		);
		expect(skipLogs).toHaveLength(1);
	});

	it("ignores stale prewarm work when a new recording starts (supersedes, no complete)", async () => {
		fsMocks.readFile.mockResolvedValue(settingsJson("h264", "auto"));
		const gate = deferred<void>();
		mockedPrewarm.mockReturnValueOnce(
			gate.promise.then(() => ({
				sourceMetadataCached: true,
				cudaAvailabilityResolved: false,
				resolvedEncoders: ["h264_nvenc", "libx264"],
				skipReasons: ["source-metadata-cached:h264"],
			})),
		);
		const info = setupConsoleSpy();

		const running = triggerNativeExportPrewarm("C:/rec/recording.mp4");
		await flush();
		// A new recording starts while the prewarm is in flight.
		beginNewRecordingGeneration();
		gate.resolve();
		await running;

		expect(info.mock.calls.some((call) => call[1] === "[native-prewarm] complete")).toBe(false);
		const supersededLog = info.mock.calls.find(
			(call) =>
				call[1] === "[native-prewarm] skip" && call[2]?.reason === "superseded-during-run",
		);
		expect(supersededLog).toBeDefined();
	});

	it("does not wait for the prewarm to begin before returning (fire-and-forget)", async () => {
		fsMocks.readFile.mockResolvedValue(settingsJson("h264", "auto"));
		const gate = deferred<void>();
		mockedPrewarm.mockReturnValueOnce(
			gate.promise.then(() => ({
				sourceMetadataCached: true,
				cudaAvailabilityResolved: false,
				resolvedEncoders: ["h264_nvenc", "libx264"],
				skipReasons: ["source-metadata-cached:h264"],
			})),
		);

		// The caller does not await; the returned promise stays pending until the
		// underlying cache work resolves, never blocking the stop/mux response.
		const pending = triggerNativeExportPrewarm("C:/rec/recording.mp4");
		await flush();
		expect(mockedPrewarm).toHaveBeenCalledTimes(1);
		gate.resolve();
		await pending;
	});

	it("is a no-op for an empty source path", async () => {
		const info = setupConsoleSpy();
		await triggerNativeExportPrewarm("");
		expect(mockedPrewarm).not.toHaveBeenCalled();
		expect(info).not.toHaveBeenCalled();
	});
});

// Capability-only prewarm behavior is win32 (CUDA helper) specific. Skip the
// suite entirely on non-Windows runners so it never flakes on CI.
const capabilityDescribe = process.platform === "win32" ? describe : describe.skip;

capabilityDescribe("warmNvidiaCudaCapabilityOnly", () => {
	function enableAvailableCuda() {
		mockedCapabilities.mockResolvedValue({
			platform: "win32",
			nvidiaCuda: { available: true, skipReason: null },
		});
	}

	async function flushMicrotasks() {
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	}

	it("spawns the helper executable directly with capability-only args (no input/output/ffprobe)", async () => {
		enableAvailableCuda();
		const child = fakeChild();
		mockedSpawn.mockReturnValue(child);
		const info = setupConsoleSpy();

		const warm = warmNvidiaCudaCapabilityOnly("hevc");
		await flushMicrotasks();

		expect(mockedSpawn).toHaveBeenCalledTimes(1);
		const [exe, args, options] = mockedSpawn.mock.calls[0];
		expect(typeof exe).toBe("string");
		expect(args).toEqual(["--capability-only", "--output-codec", "hevc"]);
		expect(args).not.toContain("--input");
		expect(args).not.toContain("--output");
		expect(args).not.toContain("--prewarm-ms");
		expect(args.some((arg) => /ffprobe/i.test(arg))).toBe(false);
		expect(options.stdio).toEqual(["ignore", "pipe", "pipe"]);

		child.stdout.emit(
			"data",
			Buffer.from(
				'{"success":true,"capabilityOnly":true,"outputCodec":"hevc","nvencDiagnostics":{"deviceName":"NVIDIA","hevcSupported":true}}',
			),
		);
		child.emit("close");
		await warm;

		expect(
			info.mock.calls.some((call) => call[1] === "[native-prewarm] capability complete"),
		).toBe(true);
	});

	it("supports the h264 codec code path", async () => {
		enableAvailableCuda();
		const child = fakeChild();
		mockedSpawn.mockReturnValue(child);

		const warm = warmNvidiaCudaCapabilityOnly("h264");
		await flushMicrotasks();
		expect(mockedSpawn.mock.calls[0][1]).toEqual([
			"--capability-only",
			"--output-codec",
			"h264",
		]);
		child.emit("close");
		await warm;
	});

	it("deduplicates: a second identical codec+environment request does not spawn again", async () => {
		enableAvailableCuda();
		const child = fakeChild();
		mockedSpawn.mockReturnValue(child);

		const first = warmNvidiaCudaCapabilityOnly("hevc");
		await flushMicrotasks();
		child.emit("close");
		await first;

		const second = warmNvidiaCudaCapabilityOnly("hevc");
		await flushMicrotasks();
		await second;

		expect(mockedSpawn).toHaveBeenCalledTimes(1);
	});

	it("skips when CUDA is not available (environment gating)", async () => {
		mockedCapabilities.mockResolvedValue({
			platform: "win32",
			nvidiaCuda: { available: false, skipReason: "env-disabled" },
		});
		const info = setupConsoleSpy();

		await warmNvidiaCudaCapabilityOnly("hevc");

		expect(mockedSpawn).not.toHaveBeenCalled();
		expect(
			info.mock.calls.some(
				(call) =>
					call[1] === "[native-prewarm] capability skip" &&
					call[2]?.reason === "env-disabled",
			),
		).toBe(true);
	});

	it("skips while a real native export is active", async () => {
		enableAvailableCuda();
		nativeVideoExportSessions.set("active-export", {
			ffmpegProcess: {},
			temporary: true,
		} as never);
		const info = setupConsoleSpy();
		try {
			await warmNvidiaCudaCapabilityOnly("hevc");
			expect(mockedSpawn).not.toHaveBeenCalled();
			expect(
				info.mock.calls.some(
					(call) =>
						call[1] === "[native-prewarm] capability skip" &&
						call[2]?.reason === "active-export",
				),
			).toBe(true);
		} finally {
			nativeVideoExportSessions.clear();
		}
	});

	it("real native export start cancels an in-flight capability-only prewarm child", async () => {
		enableAvailableCuda();
		const child = fakeChild();
		mockedSpawn.mockReturnValue(child);

		const warm = warmNvidiaCudaCapabilityOnly("hevc");
		await flushMicrotasks();
		expect(mockedSpawn).toHaveBeenCalledTimes(1);
		// Prewarm child is still in flight, not yet killed.
		expect(capabilityPrewarmChildren.size).toBe(1);
		expect(child.killedWith.length).toBe(0);

		// Simulate a real native export starting immediately: opening its NVENC
		// session must terminate the in-flight capability-only child.
		const cancelled = cancelInFlightCapabilityOnlyPrewarms();
		expect(cancelled).toBe(1);
		expect(child.killedWith).toContain("SIGKILL");
		// Child is unregistered once it settles (kill -> close in real life).

		child.emit("close");
		await warm;
		expect(capabilityPrewarmChildren.size).toBe(0);

		// Dedupe/timeout behavior is preserved: the capability key was marked
		// warmed at spawn time, so a follow-up identical request does not re-spawn.
		const second = warmNvidiaCudaCapabilityOnly("hevc");
		await flushMicrotasks();
		child.emit("close");
		await second;
		expect(mockedSpawn).toHaveBeenCalledTimes(1);
	});

	it("export-start cancellation is synchronous and never awaits the prewarm child", async () => {
		enableAvailableCuda();
		const child = fakeChild();
		mockedSpawn.mockReturnValue(child);

		const warm = warmNvidiaCudaCapabilityOnly("hevc");
		await flushMicrotasks();
		expect(mockedSpawn).toHaveBeenCalledTimes(1);

		// Starting a real export calls the sync cancel hook: it kills the child
		// inline (no IPC round-trip) and does not await the prewarm promise,
		// which stays pending until the child settles on its own.
		const cancelled = cancelInFlightCapabilityOnlyPrewarms();
		expect(cancelled).toBe(1);
		expect(child.killedWith).toContain("SIGKILL");
		// The warm promise is not settled by the kill alone (no close emitted).
		expect(capabilityPrewarmChildren.size).toBe(0);

		child.emit("close");
		await warm;
	});

	it("handles an already-exited child kill error (process-not-found race) as settled diagnostics", async () => {
		enableAvailableCuda();
		const child = fakeChild();
		mockedSpawn.mockReturnValue(child);

		const warm = warmNvidiaCudaCapabilityOnly("hevc");
		await flushMicrotasks();
		expect(mockedSpawn).toHaveBeenCalledTimes(1);

		// A real export cancels the in-flight prewarm child. If its probe already
		// completed, kill() on the already-exited child emits an async 'error'
		// event on Windows ("The process <pid> not found"). The prewarm must
		// swallow it via its error listener and settle the coordinator, never
		// surface as an uncaught exception.
		const cancelled = cancelInFlightCapabilityOnlyPrewarms();
		expect(cancelled).toBe(1);
		expect(child.killedWith).toContain("SIGKILL");
		child.emit(
			"error",
			Object.assign(new Error("The process 9320 not found"), { code: "ESRCH" }),
		);

		// The kill race resolves the warm promise (no close needed) and never
		// throws an uncaught error.
		await expect(warm).resolves.toBeUndefined();
		expect(capabilityPrewarmChildren.size).toBe(0);
	});

	it("kills the child on timeout and resolves without a retry", async () => {
		enableAvailableCuda();
		const child = fakeChild();
		mockedSpawn.mockReturnValue(child);
		vi.useFakeTimers();
		try {
			const warm = warmNvidiaCudaCapabilityOnly("hevc");
			await vi.advanceTimersByTimeAsync(20_000);
			expect(child.killedWith).toContain("SIGKILL");
			expect(mockedSpawn).toHaveBeenCalledTimes(1);
			// The warm promise settles on close (kill triggers close in real life).
			child.emit("close");
			await warm;
			// No retry after the kill/timeout.
			expect(mockedSpawn).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("failure is diagnostics-only and never poisons availability", async () => {
		enableAvailableCuda();
		const child = fakeChild();
		mockedSpawn.mockReturnValue(child);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		const warm = warmNvidiaCudaCapabilityOnly("hevc");
		await flushMicrotasks();
		// Helper emits a failure summary then closes nonzero.
		child.stderr.emit(
			"data",
			Buffer.from(
				'{"success":false,"capabilityOnly":true,"error":"NVENC probe failed","nvencDiagnostics":{}}',
			),
		);
		child.emit("close");
		await warm;

		expect(
			warn.mock.calls.some(
				(call) => call[1] === "[native-prewarm] capability failed (diagnostics-only)",
			),
		).toBe(true);
		// Availability resolution for the real export path is untouched.
		expect(mockedCapabilities).toHaveBeenCalled();
		const availability = await mockedCapabilities.mock.results[0].value;
		expect(availability.nvidiaCuda.available).toBe(true);
		// No retry on failure.
		expect(mockedSpawn).toHaveBeenCalledTimes(1);
	});

	it("does not block the coordinator (trigger returns without awaiting the warm probe)", async () => {
		fsMocks.readFile.mockResolvedValue(settingsJson("hevc", "auto"));
		enableAvailableCuda();
		const child = fakeChild();
		mockedSpawn.mockReturnValue(child);
		mockedPrewarm.mockResolvedValue({
			sourceMetadataCached: true,
			cudaAvailabilityResolved: false,
			resolvedEncoders: ["hevc_nvenc", "libx265"],
			skipReasons: ["source-metadata-cached:h264"],
		});

		// The warm child never closes; the coordinator must still resolve.
		await triggerNativeExportPrewarm("C:/rec/hevc.mp4");

		expect(mockedSpawn).toHaveBeenCalledTimes(1);
		expect(child.killedWith.length).toBe(0); // not waited on / not closed
		expect(mockedPrewarm).toHaveBeenCalledTimes(1);
		// Settle the warm probe so its real 15s timeout is cleared.
		child.emit("close");
	});
});
