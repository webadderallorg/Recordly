import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	listeners: new Map<string, (...args: unknown[]) => unknown>(),
	trusted: vi.fn(() => true),
	claimAutoZooms: vi.fn(async () => true),
	acquire: vi.fn(() => true),
	release: vi.fn(),
	broadcast: vi.fn(),
	showCursor: vi.fn(),
	stopTelemetry: vi.fn(),
	startTelemetry: vi.fn(),
	recoverWindows: vi.fn(),
}));

vi.mock("electron", () => ({
	app: {
		requestSingleInstanceLock: mocks.acquire,
		releaseSingleInstanceLock: mocks.release,
		getPath: () => "/recordly-test",
		getAppPath: () => "/recordly-test",
	},
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
			if (mocks.handlers.has(channel)) throw new Error(`Duplicate channel: ${channel}`);
			mocks.handlers.set(channel, handler);
		},
		on: (channel: string, listener: (...args: unknown[]) => unknown) =>
			mocks.listeners.set(channel, listener),
	},
	BrowserWindow: {
		getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: mocks.broadcast } }],
	},
	dialog: { showMessageBox: vi.fn() },
	shell: { showItemInFolder: vi.fn(), openExternal: vi.fn() },
}));
vi.mock("../../trustedRenderer", () => ({ isTrustedRenderer: mocks.trusted }));
vi.mock("../recording/firstRecordingAutoZooms", () => ({
	claimFirstRecordingAutoZooms: mocks.claimAutoZooms,
}));
vi.mock("../../windows", () => ({
	beginHudCaptureProtection: vi.fn(),
	getHudOverlayCaptureProtectionEnabled: () => false,
	showAreaRecordingBorder: vi.fn(),
	hideAreaRecordingBorder: vi.fn(),
}));
vi.mock("./sources", () => ({ bringSelectedWindowForward: vi.fn() }));
vi.mock("../../cursorHider", () => ({ showCursor: mocks.showCursor }));
vi.mock("../recording/focus", () => ({
	recordingFocus: { start: vi.fn(), stop: vi.fn() },
}));
vi.mock("../cursor/telemetry", () => ({
	stopCursorCapture: mocks.stopTelemetry,
	startCursorSampling: mocks.startTelemetry,
	resetCursorCaptureClock: vi.fn(),
	sampleCursorPoint: vi.fn(),
	snapshotCursorTelemetryForPersistence: vi.fn(),
	persistPendingCursorTelemetry: vi.fn(),
	normalizeCursorTelemetrySamples: vi.fn(),
	pauseCursorCaptureAtBoundary: vi.fn(),
	resumeCursorCapture: vi.fn(),
	writeCursorTelemetry: vi.fn(),
}));
vi.mock("../cursor/interaction", () => ({
	startInteractionCapture: vi.fn(),
	stopInteractionCapture: vi.fn(),
}));
vi.mock("../cursor/bounds", () => ({
	startWindowBoundsCapture: vi.fn(),
	stopWindowBoundsCapture: vi.fn(),
}));
vi.mock("../cursor/monitor", () => ({
	startNativeCursorMonitor: vi.fn(),
	stopNativeCursorMonitor: vi.fn(),
}));
vi.mock("../project/manager", () => ({
	rememberApprovedLocalReadPath: vi.fn(),
}));
vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: () => "/ffmpeg-test",
}));
vi.mock("../recording/windows", () => ({
	isNativeWindowsCaptureAvailable: vi.fn(),
	recoverNativeWindowsCaptureOutput: mocks.recoverWindows,
	attachWindowsCaptureLifecycle: vi.fn(),
	waitForWindowsCaptureStart: vi.fn(),
	waitForWindowsCaptureStop: vi.fn(),
	muxNativeWindowsVideoWithAudio: vi.fn(),
}));

import {
	isCursorCaptureActive,
	setCurrentVideoPath,
	setSelectedSource,
	setWindowsPendingVideoPath,
} from "../state";
import { registerRecordingHandlers } from "./recording";

const platform = process.platform;
const invoke = (channel: string, ...args: unknown[]) => mocks.handlers.get(channel)!(...args);
const sender = () => Object.assign(new EventEmitter(), { id: 42 });

describe("recording IPC composition", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.handlers.clear();
		mocks.listeners.clear();
		mocks.trusted.mockReturnValue(true);
		mocks.acquire.mockReturnValue(true);
		setSelectedSource(null);
		setCurrentVideoPath(null);
		setWindowsPendingVideoPath(null);
		Object.defineProperty(process, "platform", { value: "linux" });
	});
	afterEach(() => Object.defineProperty(process, "platform", { value: platform }));

	it("registers every recording route once without acquiring hardware or ownership", () => {
		registerRecordingHandlers();
		expect([...mocks.handlers.keys()].sort()).toEqual(
			[
				"append-recording-file-stream",
				"close-recording-file-stream",
				"claim-first-recording-auto-zooms",
				"discard-recording-file-stream",
				"get-cursor-telemetry",
				"get-last-native-capture-diagnostics",
				"get-recorded-video-path",
				"get-system-cursor-assets",
				"get-video-audio-fallback-paths",
				"is-native-windows-capture-available",
				"mux-native-windows-recording",
				"open-recording-file-stream",
				"pause-cursor-capture",
				"pause-native-screen-recording",
				"recover-native-screen-recording",
				"recover-recording-owner",
				"reserve-recording-session",
				"resume-cursor-capture",
				"resume-native-screen-recording",
				"set-cursor-telemetry",
				"set-recording-state",
				"start-ffmpeg-recording",
				"start-native-screen-recording",
				"stop-ffmpeg-recording",
				"stop-native-screen-recording",
				"store-microphone-sidecar",
				"store-recorded-video",
			].sort(),
		);
		expect([...mocks.listeners.keys()]).toEqual(["recording-startup-finished"]);
		expect(mocks.acquire).not.toHaveBeenCalled();
		expect(mocks.startTelemetry).not.toHaveBeenCalled();
	});

	it("keeps reservation ownership until the matching startup token is released", () => {
		registerRecordingHandlers();
		const event = { sender: sender() };
		const reserved = invoke("reserve-recording-session", event) as {
			success: boolean;
			token: string;
		};
		expect(reserved).toMatchObject({
			success: true,
			token: expect.any(String),
		});
		mocks.listeners.get("recording-startup-finished")!(event, "different-token");
		expect(invoke("reserve-recording-session", event)).toMatchObject({
			success: false,
		});
		expect(mocks.release).not.toHaveBeenCalled();
		mocks.listeners.get("recording-startup-finished")!(event, reserved.token);
		expect(invoke("reserve-recording-session", event)).toMatchObject({
			success: true,
		});
		expect(mocks.acquire).not.toHaveBeenCalled();
		expect(mocks.release).not.toHaveBeenCalled();
	});

	it("lets separate main processes reserve sessions even when the OS app lock is unavailable", () => {
		mocks.acquire.mockReturnValue(false);
		registerRecordingHandlers();
		const reserveFirst = mocks.handlers.get("reserve-recording-session")!;
		// Simulate the independent IPC registry in another main process.
		mocks.handlers.clear();
		mocks.listeners.clear();
		registerRecordingHandlers();
		const reserveSecond = mocks.handlers.get("reserve-recording-session")!;
		const event = { sender: sender() };
		expect(reserveFirst(event)).toMatchObject({ success: true });
		expect(reserveSecond(event)).toMatchObject({ success: true });
		expect(reserveFirst(event)).toMatchObject({ success: false });
		expect(reserveSecond(event)).toMatchObject({ success: false });
		expect(mocks.acquire).not.toHaveBeenCalled();
		expect(mocks.release).not.toHaveBeenCalled();
	});

	it("retains trust checks at reservation, capture, state and file boundaries", async () => {
		registerRecordingHandlers();
		mocks.trusted.mockReturnValue(false);
		const event = { sender: sender() };
		for (const channel of [
			"reserve-recording-session",
			"start-native-screen-recording",
			"stop-native-screen-recording",
			"recover-recording-owner",
			"set-recording-state",
		]) {
			expect(() => invoke(channel, event, true)).toThrow(/caller/);
		}
		await expect(
			invoke("open-recording-file-stream", event, "recording.webm", "video/webm"),
		).resolves.toMatchObject({
			success: false,
			error: expect.stringContaining("Untrusted"),
		});
		expect(mocks.acquire).not.toHaveBeenCalled();
	});

	it("only lets trusted renderers claim a recording's automatic zooms", async () => {
		registerRecordingHandlers();
		const event = { sender: sender() };
		expect(await invoke("claim-first-recording-auto-zooms", event, "recording.mp4")).toBe(true);
		expect(mocks.claimAutoZooms).toHaveBeenCalledExactlyOnceWith("recording.mp4");
		mocks.claimAutoZooms.mockClear();
		mocks.trusted.mockReturnValue(false);
		expect(await invoke("claim-first-recording-auto-zooms", event, "recording.mp4")).toBe(
			false,
		);
		expect(mocks.claimAutoZooms).not.toHaveBeenCalled();
	});
	it("uses live source state and preserves cursor cleanup and broadcasts", () => {
		const changed = vi.fn();
		registerRecordingHandlers(changed);
		const event = { sender: sender() };
		setSelectedSource({ id: "screen:1:0", name: "First screen" });
		invoke("set-recording-state", event, true);
		expect(isCursorCaptureActive).toBe(true);
		expect(mocks.startTelemetry).toHaveBeenCalledOnce();
		expect(changed).toHaveBeenLastCalledWith(true, "First screen");
		setSelectedSource({ id: "screen:2:0", name: "Second screen" });
		invoke("set-recording-state", event, false);
		expect(isCursorCaptureActive).toBe(false);
		expect(mocks.showCursor).toHaveBeenCalledOnce();
		expect(changed).toHaveBeenLastCalledWith(false, "Second screen");
		expect(mocks.broadcast).toHaveBeenLastCalledWith("recording-state-changed", {
			recording: false,
			sourceName: "Second screen",
		});
	});

	it("shares a Windows interrupted-recovery failure across repeated requests", async () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		mocks.recoverWindows.mockResolvedValue({
			success: false,
			message: "No recoverable take",
		});
		registerRecordingHandlers();
		const first = invoke("recover-native-screen-recording");
		const second = invoke("recover-native-screen-recording");
		await expect(first).resolves.toMatchObject({
			success: false,
			message: "No recoverable take",
		});
		await expect(second).resolves.toMatchObject({
			success: false,
			message: "No recoverable take",
		});
		expect(mocks.recoverWindows).toHaveBeenCalledOnce();
	});

	it("rejects untrusted recovery callers before touching native output", async () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		mocks.trusted.mockReturnValue(false);
		registerRecordingHandlers();
		await expect(
			invoke("recover-native-screen-recording", { sender: sender() }),
		).rejects.toThrow("Untrusted recording caller");
		expect(mocks.recoverWindows).not.toHaveBeenCalled();
	});

	it("retries a failed Windows recovery when a later request has new output evidence", async () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		mocks.recoverWindows
			.mockResolvedValueOnce({ success: false, message: "Still closing" })
			.mockResolvedValueOnce({ success: false, message: "Closed but invalid" });
		registerRecordingHandlers();
		await expect(invoke("recover-native-screen-recording")).resolves.toMatchObject({
			message: "Still closing",
		});
		await expect(invoke("recover-native-screen-recording")).resolves.toMatchObject({
			message: "Closed but invalid",
		});
		expect(mocks.recoverWindows).toHaveBeenCalledTimes(2);
	});

	it("rejects unsupported streamed formats before filesystem access", async () => {
		registerRecordingHandlers();
		await expect(
			invoke(
				"open-recording-file-stream",
				{ sender: sender() },
				"recording.mp4",
				"video/mp4",
			),
		).resolves.toMatchObject({
			success: false,
			error: expect.stringContaining("Only WebM"),
		});
		await expect(
			invoke("append-recording-file-stream", { sender: sender() }, "id", "invalid"),
		).resolves.toMatchObject({
			success: false,
			error: expect.stringContaining("Invalid recording chunk"),
		});
	});
});
