import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IpcMainInvokeEvent } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
	CommittedIOSRecording,
	IOSCaptureEvent,
	IOSCaptureSnapshot,
} from "../../../src/shared/iosCapture";
import type { IOSHelperRequest } from "../recording/ios/helperProcess";

interface TestWindow {
	webContents: EventEmitter & {
		mainFrame: { url: string };
		send: ReturnType<typeof vi.fn>;
		isDestroyed: () => boolean;
	};
	isDestroyed: () => boolean;
	close: ReturnType<typeof vi.fn>;
}
interface TestHelper {
	requests: IOSHelperRequest[];
	shutdown: ReturnType<typeof vi.fn>;
}
const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (event: IpcMainInvokeEvent, value?: unknown) => unknown>(),
	windows: [] as TestWindow[],
	helpers: [] as TestHelper[],
	enabled: false,
	root: "",
	hud: undefined as TestWindow | undefined,
	selectedSource: undefined as unknown,
	scan: vi.fn(),
	recover: vi.fn(),
	resolveDirectory: vi.fn(),
	discard: vi.fn(),
	approveRead: vi.fn(),
	showMessageBox: vi.fn(),
	ensureBinary: vi.fn(),
	device: {
		sourceType: "ios-device",
		id: "ios-device:phone",
		deviceToken: "phone",
		displayName: "Phone",
		generation: 1,
		deviceAudio: "unknown",
	} as const,
	format: {
		codedWidth: 640,
		codedHeight: 480,
		displayWidth: 640,
		displayHeight: 480,
		codec: "avc1",
		colorPrimaries: "ITU_R_709_2",
		transferFunction: "ITU_R_709_2",
		ycbcrMatrix: "ITU_R_709_2",
		fullRange: false,
		transform: [1, 0, 0, 1, 0, 0],
		observedFrameRate: 30,
		fingerprint: "test",
	} as const,
}));
vi.mock("electron", () => ({
	app: { getAppPath: () => "/recordly", isPackaged: false, getVersion: () => "test" },
	BrowserWindow: {
		fromWebContents: (sender: unknown) =>
			mocks.windows.find((win) => win.webContents === sender),
		getAllWindows: () => mocks.windows,
	},
	ipcMain: {
		handle: (
			channel: string,
			handler: (event: IpcMainInvokeEvent, value?: unknown) => unknown,
		) => mocks.handlers.set(channel, handler),
		on: vi.fn(),
	},
	dialog: { showMessageBox: mocks.showMessageBox, showSaveDialog: vi.fn() },
	powerSaveBlocker: { start: vi.fn(() => 1), stop: vi.fn() },
	systemPreferences: { getMediaAccessStatus: () => "granted", askForMediaAccess: vi.fn() },
	shell: { openPath: vi.fn() },
	desktopCapturer: {},
}));
vi.mock("../../rendererServer", () => ({ getPackagedRendererBaseUrl: () => undefined }));
vi.mock("../../windows", () => ({
	getHudOverlayWindow: () => mocks.hud,
	reassertHudOverlayMousePassthrough: vi.fn(),
}));
vi.mock("../paths/binaries", () => ({ ensureIOSDeviceCaptureHelperBinary: mocks.ensureBinary }));
vi.mock("../project/manager", () => ({ rememberApprovedLocalReadPath: mocks.approveRead }));
vi.mock("../recording/ios/featurePolicy", () => ({ isIOSCaptureEnabled: () => mocks.enabled }));
vi.mock("../recording/ios/finalize", () => ({
	finalizeIOSRecording: vi.fn(async ({ storage, nativeResult }) =>
		recording(storage.sessionId, nativeResult.stopReason),
	),
}));
vi.mock("../recording/ios/recovery", () => ({
	IOSRecoveryRegistry: class {
		scan = mocks.scan;
		recover = mocks.recover;
		resolveDirectory = mocks.resolveDirectory;
		discard = mocks.discard;
	},
}));
vi.mock("../recording/ios/storage", async (importOriginal) => {
	const original = await importOriginal<typeof import("../recording/ios/storage")>();
	return {
		...original,
		allocateIOSSessionStorage: async (root: string, sessionId: string) => ({
			sessionId,
			directory: path.join(root, `ios-${sessionId}`),
			journalPath: path.join(root, `ios-${sessionId}`, "capture-journal.json"),
		}),
		updateIOSJournal: vi.fn(async () => undefined),
		validateIOSStorage: vi.fn(async () => undefined),
	};
});
vi.mock("../state", () => ({
	get selectedSource() {
		return mocks.selectedSource;
	},
	setSelectedSource: (source: unknown) => {
		mocks.selectedSource = source;
	},
	setCurrentProjectPath: vi.fn(),
	setCurrentRecordingSession: vi.fn(),
	setCurrentVideoPath: vi.fn(),
}));
vi.mock("../utils", () => ({
	getRecordingsDir: async () => mocks.root,
	getScreen: vi.fn(),
	parseWindowId: () => null,
}));
vi.mock("../constants", () => ({ ALLOW_RECORDLY_WINDOW_CAPTURE: false }));
vi.mock("../cursor/bounds", () => ({
	getNativeMacWindowSources: vi.fn(),
	resolveLinuxWindowBounds: vi.fn(),
	resolveMacWindowBounds: vi.fn(),
	stopWindowBoundsCapture: vi.fn(),
}));
vi.mock("../recording/ffmpeg", () => ({
	getDisplayBoundsForSource: vi.fn(),
	getDisplayWorkAreaForSource: vi.fn(),
}));
vi.mock("../windowsWindowControl", () => ({
	bringWindowsWindowForward: vi.fn(),
	resolveWindowsWindowBounds: vi.fn(),
}));
vi.mock("../recording/ios/helperProcess", () => ({
	IOSHelperProcess: class {
		requests: IOSHelperRequest[] = [];
		private listeners = new Set<(event: IOSCaptureEvent) => void>();
		private sequence = 0;
		private sessionId?: string;
		private generation = 0;
		shutdown = vi.fn(async () => undefined);
		constructor() {
			mocks.helpers.push(this);
		}
		private emit(event: string, payload: unknown, scoped = true) {
			const message = {
				protocolVersion: 1,
				sequence: ++this.sequence,
				event,
				payload,
				...(scoped ? { sessionId: this.sessionId, generation: this.generation } : {}),
			} as IOSCaptureEvent;
			for (const listener of this.listeners) listener(message);
		}
		async request(input: IOSHelperRequest) {
			this.requests.push(input);
			if (input.command === "discover")
				queueMicrotask(() =>
					this.emit(
						"inventoryChanged",
						{ devices: [mocks.device], microphones: [], inventoryGeneration: 1 },
						false,
					),
				);
			if (input.command === "prepare") {
				this.sessionId = input.sessionId;
				this.generation = input.generation!;
				queueMicrotask(() =>
					this.emit("prepared", {
						source: mocks.device,
						options: input.payload!.options,
						format: mocks.format,
						mode: "passthrough",
					}),
				);
			}
			if (input.command === "start")
				queueMicrotask(() =>
					this.emit("recordingStarted", {
						firstHostTime: { value: "1", timescale: 1 },
						acceptedVideoSamples: 1,
					}),
				);
			if (input.command === "stop")
				queueMicrotask(() =>
					this.emit("nativeFinalized", {
						result: {
							sessionId: this.sessionId,
							stopReason: "stopped",
							mode: "passthrough",
							format: mocks.format,
							timingFile: "native-timing.json",
							video: {
								relativeName: "source-video.mov",
								mediaKind: "video",
								firstHostTime: { value: "1", timescale: 1 },
								duration: { value: "1", timescale: 1 },
								sampleCount: 1,
								videoFormat: mocks.format,
							},
						},
					}),
				);
			return {
				protocolVersion: 1,
				event: "accepted",
				sequence: ++this.sequence,
				requestId: "test",
				payload: {},
			};
		}
		onEvent(listener: (event: IOSCaptureEvent) => void) {
			this.listeners.add(listener);
			return () => {
				this.listeners.delete(listener);
			};
		}
		onExit() {
			return () => undefined;
		}
		onPreview() {
			return () => undefined;
		}
	},
}));

function recording(sessionId: string, stopReason = "stopped"): CommittedIOSRecording {
	return {
		sessionId,
		videoPath: path.join(mocks.root, `ios-${sessionId}`, "source-video.mov"),
		hideOverlayCursorByDefault: true,
		captureMetadata: {
			version: 1,
			sourceKind: "ios-device",
			mode: "passthrough",
			format: mocks.format,
			deviceAudioRecorded: false,
			narrationRecorded: false,
			stopReason,
			interrupted: stopReason !== "stopped",
		},
	};
}
function createWindow(): TestWindow {
	const webContents = Object.assign(new EventEmitter(), {
		mainFrame: { url: "file:///recordly/dist/index.html?windowType=hud-overlay" },
		send: vi.fn(),
		isDestroyed: () => false,
	});
	const win = { webContents, isDestroyed: () => false, close: vi.fn() };
	mocks.windows.push(win);
	return win;
}
function event(win: TestWindow, patch: Partial<IpcMainInvokeEvent> = {}): IpcMainInvokeEvent {
	return {
		sender: win.webContents,
		senderFrame: win.webContents.mainFrame,
		...patch,
	} as unknown as IpcMainInvokeEvent;
}
async function invoke(channel: string, sender: IpcMainInvokeEvent, value?: unknown) {
	const handler = mocks.handlers.get(channel);
	if (!handler) throw new Error(`Handler missing: ${channel}`);
	return handler(sender, value);
}
let closeController: (() => Promise<void>) | undefined;
beforeEach(async () => {
	vi.resetModules();
	vi.clearAllMocks();
	vi.unstubAllEnvs();
	mocks.handlers.clear();
	mocks.windows.length = 0;
	mocks.helpers.length = 0;
	mocks.hud = undefined;
	mocks.selectedSource = undefined;
	mocks.enabled = false;
	mocks.root = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-ios-ipc-test-"));
	mocks.ensureBinary.mockResolvedValue("/recordly/helper");
	mocks.approveRead.mockResolvedValue(undefined);
	mocks.scan.mockResolvedValue([]);
	mocks.resolveDirectory.mockResolvedValue(mocks.root);
	mocks.showMessageBox.mockResolvedValue({ response: 1 });
});
afterEach(async () => {
	await closeController?.();
	closeController = undefined;
	await fs.rm(mocks.root, { recursive: true, force: true });
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});
async function register(enabled = true) {
	mocks.enabled = enabled;
	const main = createWindow();
	const picker = createWindow();
	const editor = createWindow();
	mocks.hud = main;
	const createEditor = vi.fn();
	const recordingChanged = vi.fn();
	const module = await import("./iosCapture");
	const controller = module.registerIOSCaptureHandlers({
		getMainWindow: () => main as never,
		getSourceSelectorWindow: () => picker as never,
		createEditorWindow: createEditor,
		onRecordingStateChange: recordingChanged,
	});
	closeController = () => controller.shutdown();
	const sources = await import("./sources");
	sources.registerSourceHandlers({
		createEditorWindow: createEditor,
		createSourceSelectorWindow: () => picker as never,
		getSourceSelectorWindow: () => picker as never,
	});
	return { main, picker, editor, controller, createEditor, recordingChanged };
}
async function prepare(main: TestWindow) {
	await invoke("ios-capture:discover", event(main));
	return (await invoke("ios-capture:prepare", event(main), {
		deviceToken: "phone",
		generation: 1,
		options: { deviceAudio: false, microphoneToken: null },
	})) as IOSCaptureSnapshot;
}

it("default-off registration, subscription and rejected discovery never spawn a helper", async () => {
	const h = await register(false);
	expect(await invoke("ios-capture:capabilities", event(h.main))).toEqual({ enabled: false });
	await invoke("ios-capture:subscribe", event(h.main));
	expect(await invoke("ios-capture:snapshot", event(h.main))).toMatchObject({
		phase: "unavailable",
	});
	await expect(invoke("ios-capture:discover", event(h.main))).rejects.toThrow(
		"UNSUPPORTED_PLATFORM",
	);
	expect(mocks.ensureBinary).not.toHaveBeenCalled();
	expect(mocks.helpers).toHaveLength(0);
});
it("registered IPC rejects foreign windows, subframes and documents before preparing or releasing inputs", async () => {
	const h = await register();
	const ready = await prepare(h.main);
	h.picker.webContents.mainFrame.url = "https://untrusted.example/";
	for (const untrusted of [
		event(h.editor),
		event(h.main, { senderFrame: { url: h.main.webContents.mainFrame.url } as never }),
		event(h.picker),
	]) {
		await expect(
			invoke("ios-capture:prepare", untrusted, {
				deviceToken: "phone",
				generation: 1,
				options: { deviceAudio: false, microphoneToken: null },
			}),
		).rejects.toThrow("INVALID_REQUEST");
		await expect(invoke("ios-capture:release", untrusted, ready.sessionId)).rejects.toThrow(
			"INVALID_REQUEST",
		);
		await expect(
			invoke("select-source", untrusted, {
				sourceType: "screen",
				id: "screen:1",
				name: "Screen",
			}),
		).rejects.toThrow("INVALID_REQUEST");
	}
	expect(h.controller.getSnapshot()).toMatchObject({
		phase: "ready",
		sessionId: ready.sessionId,
	});
	expect(
		mocks.helpers[0].requests.filter((request) => request.command === "prepare"),
	).toHaveLength(1);
	expect(mocks.helpers[0].requests.some((request) => request.command === "release")).toBe(false);
});
it("selecting a native device keeps the standalone picker alive through preparation", async () => {
	const h = await register();
	await invoke("ios-capture:discover", event(h.picker));
	await invoke("select-source", event(h.picker), mocks.device);
	expect(h.picker.close).not.toHaveBeenCalled();
	const prepared = await invoke("ios-capture:prepare", event(h.picker), {
		deviceToken: "phone",
		generation: 1,
		options: { deviceAudio: false, microphoneToken: null },
	});
	expect(prepared).toMatchObject({ phase: "ready", source: mocks.device });
});
it("blocks every active-session recovery action even when an earlier scan registered that UUID", async () => {
	const h = await register();
	const ready = await prepare(h.main);
	const id = ready.sessionId!;
	mocks.scan.mockResolvedValue([{ sessionId: id, status: "recoverable-video" }]);
	const state = h.controller.getSnapshot();
	const snapshot = vi
		.spyOn(h.controller, "getSnapshot")
		.mockReturnValue({ ...state, sessionId: null, phase: "idle" });
	await invoke("ios-capture:recovery-list", event(h.main));
	snapshot.mockRestore();
	await invoke("ios-capture:recovery-list", event(h.main));
	expect(mocks.scan.mock.calls.at(-1)?.[1]).toEqual(new Set([id]));
	for (const [channel, input] of [
		["recover", { sessionId: id, mode: "video-only" }],
		["recovery-discard", id],
		["recovery-folder", id],
		["diagnostics", id],
	] as const) {
		await expect(invoke(`ios-capture:${channel}`, event(h.main), input)).rejects.toThrow(
			"RECORDING_BUSY",
		);
	}
	expect(mocks.recover).not.toHaveBeenCalled();
	expect(mocks.resolveDirectory).not.toHaveBeenCalled();
	expect(mocks.discard).not.toHaveBeenCalled();
	expect(mocks.showMessageBox).not.toHaveBeenCalled();
});
it("rechecks active-session ownership after a recovery discard confirmation resolves", async () => {
	const h = await register();
	const ready = await prepare(h.main);
	const id = ready.sessionId!;
	const state = h.controller.getSnapshot();
	const snapshot = vi
		.spyOn(h.controller, "getSnapshot")
		.mockReturnValue({ ...state, sessionId: null, phase: "idle" });
	let confirm!: (value: { response: number }) => void;
	mocks.showMessageBox.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				confirm = resolve;
			}),
	);
	const discarding = invoke("ios-capture:recovery-discard", event(h.main), id);
	const failed = expect(discarding).rejects.toThrow("RECORDING_BUSY");
	await vi.waitFor(() => expect(mocks.showMessageBox).toHaveBeenCalledOnce());
	snapshot.mockRestore();
	confirm({ response: 1 });
	await failed;
	expect(mocks.discard).not.toHaveBeenCalled();
});
it("concurrent recovery IPC calls deliver one editor while file approval is pending", async () => {
	const h = await register();
	const result = recording("12345678-1234-4123-8123-123456789abc", "recovered-interruption");
	mocks.recover.mockResolvedValue(result);
	let approve!: () => void;
	mocks.approveRead.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				approve = resolve;
			}),
	);
	const first = invoke("ios-capture:recover", event(h.main), {
		sessionId: result.sessionId,
		mode: "video-only",
	});
	const second = invoke("ios-capture:recover", event(h.picker), {
		sessionId: result.sessionId,
		mode: "video-only",
	});
	await vi.waitFor(() => expect(mocks.approveRead).toHaveBeenCalledOnce());
	expect(h.createEditor).not.toHaveBeenCalled();
	approve();
	await Promise.all([first, second]);
	expect(h.createEditor).toHaveBeenCalledOnce();
	expect(
		h.main.webContents.send.mock.calls.filter(
			([channel]) => channel === "recording-session-changed",
		),
	).toHaveLength(1);
});
it("keeps prepared inputs when the picker closes with a subscribed launcher, then releases on last-client loss", async () => {
	const h = await register();
	await invoke("ios-capture:subscribe", event(h.main));
	await invoke("ios-capture:subscribe", event(h.picker));
	const ready = await prepare(h.picker);
	h.picker.webContents.emit("destroyed");
	await Promise.resolve();
	expect(h.controller.getSnapshot()).toMatchObject({
		phase: "ready",
		sessionId: ready.sessionId,
	});
	expect(mocks.helpers[0].shutdown).not.toHaveBeenCalled();
	h.main.webContents.emit("destroyed");
	await vi.waitFor(() =>
		expect(h.controller.getSnapshot()).toMatchObject({ phase: "idle", sessionId: null }),
	);
	expect(mocks.helpers[0].shutdown).toHaveBeenCalledOnce();
});
it("renderer crash stops an active take even when another subscribed window survives", async () => {
	const h = await register();
	await invoke("ios-capture:subscribe", event(h.main));
	await invoke("ios-capture:subscribe", event(h.picker));
	const ready = await prepare(h.main);
	await invoke("ios-capture:start", event(h.main), ready.sessionId);
	expect(h.controller.getSnapshot().phase).toBe("recording");
	h.main.webContents.emit("render-process-gone");
	await vi.waitFor(() => expect(h.controller.getSnapshot().phase).toBe("interrupted"));
	expect(h.controller.getCommitted()?.captureMetadata.stopReason).toBe("renderer-loss");
	expect(mocks.helpers[0].requests.filter((request) => request.command === "stop")).toHaveLength(
		1,
	);
	expect(h.createEditor).toHaveBeenCalledOnce();
});
it("closing discovery does not report an unrelated desktop recording as stopped", async () => {
	const h = await register();
	const leases = await import("../recording/recordingLease");
	leases.beginDesktopRecording();
	try {
		await invoke("ios-capture:discovery-active", event(h.picker), true);
		await invoke("ios-capture:discover", event(h.picker));
		await invoke("ios-capture:discovery-active", event(h.picker), false);
		expect(mocks.helpers[0].shutdown).toHaveBeenCalledOnce();
		expect(leases.getRecordingLease()?.owner).toBe("desktop");
		expect(h.recordingChanged).not.toHaveBeenCalled();
	} finally {
		leases.endDesktopRecording();
	}
});
