import { afterEach, expect, it, vi } from "vitest";
import type {
	IOSCaptureEvent,
	IOSCaptureSnapshot,
	IOSDeviceSource,
} from "../../../../src/shared/iosCapture";
import { IOSCaptureController, type IOSControllerDependencies } from "./controller";
import type { IOSHelperRequest, IOSHelperTransport } from "./helperProcess";
import { getRecordingLease } from "../recordingLease";

const source = {
	sourceType: "ios-device",
	id: "ios-device:phone",
	deviceToken: "phone",
	displayName: "Phone",
	generation: 1,
	deviceAudio: "unknown",
} as const;
const options = { deviceAudio: false, microphoneToken: null };
const format = {
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
	fingerprint: "test-format",
} as const;
const controllers: IOSCaptureController[] = [];

function harness(
	overrides: Partial<IOSControllerDependencies> = {},
	initialDevices: readonly IOSDeviceSource[] | null = [source],
) {
	let discoveryDevices = initialDevices;
	let listener: (event: IOSCaptureEvent) => void = () => {};
	let exit: (error: Error) => void = () => {};
	let sequence = 0;
	const requests: IOSHelperRequest[] = [];
	const committed = vi.fn();
	const finalize = vi.fn(async (storage) => ({
		sessionId: storage.sessionId,
		videoPath: `${storage.directory}/source-video.mov`,
		hideOverlayCursorByDefault: true,
		captureMetadata: {
			version: 1,
			sourceKind: "ios-device",
			mode: "passthrough",
			format,
			deviceAudioRecorded: false,
			narrationRecorded: false,
			stopReason: "stopped",
			interrupted: false,
		},
	}));
	const controller = new IOSCaptureController({
		enabled: true,
		createHelper: async () => ({
			request: async (input) => {
				requests.push(input);
				const devices = discoveryDevices;
				if (input.command === "discover" && devices !== null)
					queueMicrotask(() =>
						emit(
							"inventoryChanged",
							{ devices, microphones: [], inventoryGeneration: 1 },
							false,
						),
					);
				if (input.command === "prepare")
					queueMicrotask(() =>
						emit("prepared", { source, options, format, mode: "passthrough" }),
					);
				return {
					protocolVersion: 1,
					event: "accepted",
					sequence: ++sequence,
					requestId: "r",
					payload: {},
				} as IOSCaptureEvent;
			},
			onEvent: (callback) => {
				listener = callback;
				return () => {};
			},
			onExit: (callback) => {
				exit = callback;
				return () => {};
			},
			onPreview: () => () => {},
			shutdown: async () => {},
		}),
		allocate: async (sessionId) => ({
			sessionId,
			directory: `/tmp/ios-${sessionId}`,
			journalPath: `/tmp/ios-${sessionId}/capture-journal.json`,
		}),
		permissions: async () => {},
		finalize,
		discard: async () => {},
		onCommitted: committed,
		...overrides,
	});
	function emit(event: string, payload: unknown, scoped = true) {
		const s = controller.getSnapshot();
		listener({
			protocolVersion: 1,
			event,
			sequence: ++sequence,
			...(scoped ? { sessionId: s.sessionId, generation: s.generation } : {}),
			payload,
		} as IOSCaptureEvent);
	}
	async function ready() {
		await controller.discover();
		await controller.prepare({ deviceToken: source.deviceToken, generation: 1, options });
		return controller.getSnapshot().sessionId!;
	}
	function nativeFinished() {
		const sessionId = controller.getSnapshot().sessionId!;
		emit("nativeFinalized", {
			result: {
				sessionId,
				stopReason: "stopped",
				mode: "passthrough",
				format,
				timingFile: "native-timing.json",
				video: {
					relativeName: "source-video.mov",
					mediaKind: "video",
					firstHostTime: { value: "100", timescale: 1 },
					duration: { value: "1", timescale: 1 },
					sampleCount: 1,
					videoFormat: format,
				},
			},
		});
	}
	controllers.push(controller);
	return {
		controller,
		requests,
		ready,
		emit,
		exit: () => exit(new Error("HELPER_EXITED")),
		nativeFinished,
		finalize,
		committed,
		setDiscoveryDevices: (devices: readonly IOSDeviceSource[] | null) => {
			discoveryDevices = devices;
		},
	};
}
afterEach(async () => {
	for (const controller of controllers.splice(0)) await controller.shutdown();
	vi.useRealTimers();
});

function helperWithDelayedRequest(command?: "hello" | "discover") {
	const listeners = new Set<(event: IOSCaptureEvent) => void>();
	let sequence = 0;
	let rejectRequest!: (error: Error) => void;
	const delayed = new Promise<IOSCaptureEvent>((_resolve, reject) => {
		rejectRequest = reject;
	});
	const shutdown = vi.fn(async () => {
		listeners.clear();
	});
	const helper: IOSHelperTransport = {
		request: async (input) => {
			if (input.command === command) return delayed;
			if (input.command === "discover")
				queueMicrotask(() => {
					const event: IOSCaptureEvent = {
						protocolVersion: 1,
						event: "inventoryChanged",
						sequence: ++sequence,
						payload: { devices: [source], microphones: [], inventoryGeneration: 1 },
					};
					for (const listener of listeners) listener(event);
				});
			return {
				protocolVersion: 1,
				event: "accepted",
				requestId: "test",
				sequence: ++sequence,
				payload: {},
			};
		},
		onEvent: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		onExit: () => () => {},
		onPreview: () => () => {},
		shutdown,
	};
	return { helper, rejectRequest, shutdown };
}

it.each([
	"hello",
	"discover",
] as const)("replaces a helper whose %s fails after the discovery observation window", async (command) => {
	vi.useFakeTimers();
	const delayed = helperWithDelayedRequest(command);
	const fresh = helperWithDelayedRequest();
	const createHelper = vi
		.fn()
		.mockResolvedValueOnce(delayed.helper)
		.mockResolvedValueOnce(fresh.helper);
	const h = harness({ createHelper });
	const first = h.controller.discover();
	await vi.advanceTimersByTimeAsync(5_000);
	expect(await first).toMatchObject({ phase: "idle", devices: [] });
	delayed.rejectRequest(new Error("HELPER_UNAVAILABLE"));
	await vi.advanceTimersByTimeAsync(0);
	expect(h.controller.getSnapshot()).toMatchObject({
		phase: "failed",
		error: { code: "HELPER_UNAVAILABLE" },
	});
	expect(delayed.shutdown).toHaveBeenCalledOnce();
	const refreshed = h.controller.discover();
	await vi.advanceTimersByTimeAsync(0);
	expect(await refreshed).toMatchObject({ phase: "idle", devices: [source], error: null });
	expect(createHelper).toHaveBeenCalledTimes(2);
});

it("ignores a delayed hello failure from a helper replaced after shutdown", async () => {
	vi.useFakeTimers();
	const delayed = helperWithDelayedRequest("hello");
	const fresh = helperWithDelayedRequest();
	const createHelper = vi
		.fn()
		.mockResolvedValueOnce(delayed.helper)
		.mockResolvedValueOnce(fresh.helper);
	const h = harness({ createHelper });
	const rejected = expect(h.controller.discover()).rejects.toThrow("HELPER_UNAVAILABLE");
	await vi.advanceTimersByTimeAsync(0);
	await h.controller.shutdown();
	await rejected;
	const refreshed = h.controller.discover();
	await vi.advanceTimersByTimeAsync(0);
	await refreshed;
	delayed.rejectRequest(new Error("HELPER_UNAVAILABLE"));
	await vi.advanceTimersByTimeAsync(0);
	expect(h.controller.getSnapshot()).toMatchObject({
		phase: "idle",
		devices: [source],
		error: null,
	});
	expect(fresh.shutdown).not.toHaveBeenCalled();
});

it("keeps an empty initial inventory discovering until a device arrives", async () => {
	vi.useFakeTimers();
	const h = harness({}, []);
	let result: IOSCaptureSnapshot | undefined;
	const discovery = h.controller.discover().then((snapshot) => {
		result = snapshot;
	});
	await vi.advanceTimersByTimeAsync(0);
	expect(h.controller.getSnapshot()).toMatchObject({ phase: "discovering", devices: [] });
	expect(result).toBeUndefined();
	h.emit(
		"inventoryChanged",
		{ devices: [source], microphones: [], inventoryGeneration: 1 },
		false,
	);
	await discovery;
	expect(result).toMatchObject({ phase: "idle", devices: [source] });
});

it("shares a pending discovery across repeated refresh requests", async () => {
	vi.useFakeTimers();
	const h = harness({}, []);
	const first = h.controller.discover();
	await vi.advanceTimersByTimeAsync(0);
	const second = h.controller.discover();
	await vi.advanceTimersByTimeAsync(0);
	expect(h.requests.filter((request) => request.command === "discover")).toHaveLength(1);
	h.emit(
		"inventoryChanged",
		{ devices: [source], microphones: [], inventoryGeneration: 1 },
		false,
	);
	expect(await first).toEqual(await second);
	expect((await first).devices).toEqual([source]);
});

it("settles empty discovery after five seconds and still accepts later device arrivals", async () => {
	vi.useFakeTimers();
	const h = harness({}, []);
	let result: IOSCaptureSnapshot | undefined;
	const discovery = h.controller.discover().then((snapshot) => {
		result = snapshot;
	});
	await vi.advanceTimersByTimeAsync(4_999);
	expect(result).toBeUndefined();
	expect(h.controller.getSnapshot().phase).toBe("discovering");
	await vi.advanceTimersByTimeAsync(1);
	await discovery;
	expect(result).toMatchObject({ phase: "idle", devices: [] });
	h.emit(
		"inventoryChanged",
		{ devices: [source], microphones: [], inventoryGeneration: 1 },
		false,
	);
	expect(h.controller.getSnapshot()).toMatchObject({ phase: "idle", devices: [source] });
	expect(h.requests.filter((request) => request.command === "discover")).toHaveLength(1);
});

it("retains a prepared source and ready phase while refresh waits for inventory", async () => {
	vi.useFakeTimers();
	const h = harness();
	const id = await h.ready();
	h.setDiscoveryDevices([]);
	let result: IOSCaptureSnapshot | undefined;
	const refresh = h.controller.discover().then((snapshot) => {
		result = snapshot;
	});
	await vi.advanceTimersByTimeAsync(0);
	expect(h.controller.getSnapshot()).toMatchObject({
		phase: "ready",
		source,
		sessionId: id,
		format,
	});
	expect(result).toBeUndefined();
	h.emit(
		"inventoryChanged",
		{ devices: [source], microphones: [], inventoryGeneration: 1 },
		false,
	);
	await refresh;
	expect(result).toMatchObject({ phase: "ready", source, sessionId: id, format });
	expect(h.requests.filter((request) => request.command === "prepare")).toHaveLength(1);
});

it("shutdown rejects pending discovery and cancels its wait without a timeout", async () => {
	vi.useFakeTimers();
	const h = harness({}, null);
	let outcome: unknown;
	const discovery = h.controller.discover().then(
		(snapshot) => {
			outcome = snapshot;
		},
		(error) => {
			outcome = error;
		},
	);
	await vi.advanceTimersByTimeAsync(0);
	await h.controller.shutdown();
	await vi.advanceTimersByTimeAsync(0);
	expect(outcome).toEqual(new Error("HELPER_UNAVAILABLE"));
	expect(h.controller.getSnapshot().phase).toBe("idle");
	expect(vi.getTimerCount()).toBe(0);
	await discovery;
});

it.each([
	"preparing",
	"starting",
	"recording",
	"stopping",
	"finalising",
] as const)("rejects discovery during %s without replacing recording inputs", async (phase) => {
	let allowPermission!: () => void;
	const permissions = new Promise<void>((resolve) => {
		allowPermission = resolve;
	});
	const h = harness(
		phase === "preparing"
			? { permissions: () => permissions }
			: phase === "finalising"
				? { finalize: () => new Promise(() => {}) }
				: {},
	);
	const pending: Promise<unknown>[] = [];
	try {
		await h.controller.discover();
		if (phase === "preparing") {
			pending.push(
				h.controller
					.prepare({ deviceToken: "phone", generation: 1, options })
					.catch(() => {}),
			);
		} else {
			await h.controller.prepare({ deviceToken: "phone", generation: 1, options });
			const id = h.controller.getSnapshot().sessionId!;
			const start = h.controller.start(id);
			pending.push(start.catch(() => {}));
			if (phase !== "starting") {
				h.emit("recordingStarted", {
					firstHostTime: { value: "100", timescale: 1 },
					acceptedVideoSamples: 1,
				});
				await start;
			}
			if (phase === "stopping" || phase === "finalising")
				pending.push(h.controller.stop(id).catch(() => {}));
			if (phase === "finalising") h.nativeFinished();
		}
		expect(h.controller.getSnapshot().phase).toBe(phase);
		await expect(h.controller.discover()).rejects.toThrow("RECORDING_BUSY");
		expect(h.controller.getSnapshot().phase).toBe(phase);
		expect(h.requests.filter((request) => request.command === "discover")).toHaveLength(1);
	} finally {
		h.exit();
		allowPermission();
		await Promise.all(pending);
	}
});

it("does not mark recording on command acceptance alone", async () => {
	const h = harness();
	const id = await h.ready();
	const started = h.controller.start(id);
	await Promise.resolve();
	expect(h.controller.getSnapshot().phase).toBe("starting");
	h.emit("recordingStarted", {
		firstHostTime: { value: "100", timescale: 1 },
		acceptedVideoSamples: 1,
	});
	await started;
	expect(h.controller.getSnapshot().phase).toBe("recording");
	const stop1 = h.controller.stop(id);
	const stop2 = h.controller.stop(id);
	h.nativeFinished();
	expect(await stop1).toEqual(await stop2);
	expect(h.finalize).toHaveBeenCalledTimes(1);
	expect(h.committed).toHaveBeenCalledTimes(1);
	expect(h.requests.filter((r) => r.command === "stop")).toHaveLength(1);
});
it("commits spontaneous interruption without a surviving renderer stop promise", async () => {
	const h = harness();
	const id = await h.ready();
	const start = h.controller.start(id);
	h.emit("recordingStarted", {
		firstHostTime: { value: "100", timescale: 1 },
		acceptedVideoSamples: 1,
	});
	await start;
	h.nativeFinished();
	await vi.waitFor(() => expect(h.committed).toHaveBeenCalledTimes(1));
	expect(h.controller.getSnapshot().phase).toBe("completed");
});
it("rejects stale tokens and source generations before creating a prepared session", async () => {
	const h = harness();
	await h.controller.discover();
	await expect(
		h.controller.prepare({ deviceToken: "other", generation: 1, options }),
	).rejects.toThrow("DEVICE_NOT_FOUND");
	await expect(
		h.controller.prepare({ deviceToken: "phone", generation: 0, options }),
	).rejects.toThrow("DEVICE_NOT_FOUND");
	expect(h.requests.some((r) => r.command === "prepare")).toBe(false);
});
it("helper exit rejects pending start and never reports an empty take complete", async () => {
	const h = harness();
	const id = await h.ready();
	const start = h.controller.start(id);
	const failure = expect(start).rejects.toThrow("HELPER_EXITED");
	h.exit();
	await failure;
	expect(h.controller.getSnapshot().phase).toBe("failed");
	expect(h.committed).not.toHaveBeenCalled();
});

it("ignores native finalization outside an armed take and request-scoped failures", async () => {
	const h = harness();
	await h.ready();
	h.nativeFinished();
	await Promise.resolve();
	expect(h.finalize).not.toHaveBeenCalled();
	expect(h.controller.getSnapshot().phase).toBe("ready");
});
it("reprepares on the same helper so inventory tokens remain valid", async () => {
	const h = harness();
	await h.ready();
	await h.controller.prepare({ deviceToken: "phone", generation: 1, options });
	expect(h.requests.filter((r) => r.command === "hello")).toHaveLength(1);
	expect(h.requests.filter((r) => r.command === "prepare")).toHaveLength(2);
});

it("does not resume a cancelled preparation after permission resolves", async () => {
	let allow!: () => void;
	const permissions = new Promise<void>((resolve) => {
		allow = resolve;
	});
	const allocate = vi.fn(async (sessionId: string) => ({
		sessionId,
		directory: `/tmp/ios-${sessionId}`,
		journalPath: `/tmp/ios-${sessionId}/capture-journal.json`,
	}));
	const h = harness({ permissions: () => permissions, allocate });
	await h.controller.discover();
	const preparing = h.controller.prepare({ deviceToken: "phone", generation: 1, options });
	const failed = expect(preparing).rejects.toThrow("INVALID_REQUEST");
	await h.controller.release(h.controller.getSnapshot().sessionId!);
	allow();
	await failed;
	expect(allocate).not.toHaveBeenCalled();
	expect(h.requests.filter((r) => r.command === "prepare")).toHaveLength(0);
	expect(h.controller.getSnapshot()).toMatchObject({ phase: "idle", sessionId: null });
	expect(getRecordingLease()).toBeNull();
});

it("keeps terminal work exclusive until editor handoff has finished", async () => {
	let finishHandoff!: () => void;
	const handoff = new Promise<void>((resolve) => {
		finishHandoff = resolve;
	});
	const onCommitted = vi.fn(() => handoff);
	const h = harness({ onCommitted });
	const id = await h.ready();
	const started = h.controller.start(id);
	h.emit("recordingStarted", {
		firstHostTime: { value: "100", timescale: 1 },
		acceptedVideoSamples: 1,
	});
	await started;
	const stopped = h.controller.stop(id);
	h.nativeFinished();
	await vi.waitFor(() => expect(onCommitted).toHaveBeenCalledOnce());
	expect(h.controller.getSnapshot().phase).toBe("finalising");
	expect(getRecordingLease()?.owner).toBe("ios-device");
	await expect(
		h.controller.prepare({ deviceToken: "phone", generation: 1, options }),
	).rejects.toThrow("RECORDING_BUSY");
	finishHandoff();
	await stopped;
	expect(h.controller.getSnapshot().phase).toBe("completed");
	expect(getRecordingLease()).toBeNull();
});
it("bounds quit while a finalizer is stalled and retains the take without handoff", async () => {
	let abortSignal: AbortSignal | undefined;
	const h = harness({
		shutdownGraceMs: 20,
		finalize: (_storage, _result, signal) => {
			abortSignal = signal;
			return new Promise((_resolve, reject) =>
				signal?.addEventListener("abort", () => reject(new Error("FINALIZATION_FAILED")), {
					once: true,
				}),
			);
		},
	});
	const id = await h.ready();
	const started = h.controller.start(id);
	h.emit("recordingStarted", {
		firstHostTime: { value: "100", timescale: 1 },
		acceptedVideoSamples: 1,
	});
	await started;
	h.nativeFinished();
	await h.controller.shutdown();
	expect(abortSignal?.aborted).toBe(true);
	expect(h.controller.getSnapshot().phase).toBe("recoveryAvailable");
	expect(h.committed).not.toHaveBeenCalled();
	expect(getRecordingLease()).toBeNull();
});
