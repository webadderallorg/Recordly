import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/toast";
import {
	createRecordingMicrophoneFallback,
	type BrowserMicrophoneProfile,
} from "./recordingMicrophoneFallback";

vi.mock("@/components/ui/toast", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/i18n/runtime", () => ({
	translate: (_key: string, fallback: string, values: Record<string, string> = {}) =>
		fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? ""),
}));

class FakeMediaRecorder {
	static instances: FakeMediaRecorder[] = [];
	static constructorError: Error | null = null;
	state: RecordingState = "inactive";
	mimeType: string;
	ondataavailable: ((event: BlobEvent) => void) | null = null;
	onstop: (() => void) | null = null;
	finalChunk = "tail";

	constructor(
		public stream: MediaStream,
		public options: MediaRecorderOptions,
	) {
		if (FakeMediaRecorder.constructorError) throw FakeMediaRecorder.constructorError;
		this.mimeType = options.mimeType ?? "audio/webm";
		FakeMediaRecorder.instances.push(this);
	}

	emitChunk(content: string) {
		this.ondataavailable?.({ data: new Blob([content]) } as BlobEvent);
	}

	start = vi.fn(() => {
		this.state = "recording";
	});
	requestData = vi.fn(() => this.emitChunk("flush"));
	pause = vi.fn(() => {
		this.state = "paused";
	});
	resume = vi.fn(() => {
		this.state = "recording";
	});
	stop = vi.fn(() => {
		this.state = "inactive";
		queueMicrotask(() => {
			this.emitChunk(this.finalChunk);
			this.onstop?.();
		});
	});
}

describe("browser microphone fallback capture", () => {
	let now: number;
	let profile: BrowserMicrophoneProfile;
	let track: {
		id: string;
		label: string;
		enabled: boolean;
		muted: boolean;
		readyState: MediaStreamTrackState;
		getSettings: ReturnType<typeof vi.fn>;
		stop: ReturnType<typeof vi.fn>;
	};
	let stream: MediaStream;
	let getUserMedia: ReturnType<typeof vi.fn>;
	let enumerateDevices: ReturnType<typeof vi.fn>;
	let storeMicrophoneSidecar: ReturnType<typeof vi.fn>;

	const createFallback = () =>
		createRecordingMicrophoneFallback({
			audioBitsPerSecond: 128_000,
			timesliceMs: 250,
			getBrowserMicrophoneProfile: () => profile,
			getRequestedBrowserMicrophoneProfile: () => "RAW",
		});
	const startFallback = (fallback: ReturnType<typeof createFallback>) =>
		fallback.start({
			microphoneDeviceId: "microphone-1",
			mainStartedAt: 10_000,
			startWasCancelled: () => false,
		});
	const recorder = () => FakeMediaRecorder.instances[FakeMediaRecorder.instances.length - 1];

	beforeEach(() => {
		vi.clearAllMocks();
		now = 1_000;
		profile = "processed";
		FakeMediaRecorder.instances = [];
		FakeMediaRecorder.constructorError = null;
		track = {
			id: "track-1",
			label: "Desk microphone",
			enabled: true,
			muted: false,
			readyState: "live",
			getSettings: vi.fn(() => ({ autoGainControl: true, sampleRate: 48_000 })),
			stop: vi.fn(),
		};
		stream = {
			getAudioTracks: () => [track],
			getTracks: () => [track],
		} as unknown as MediaStream;
		getUserMedia = vi.fn().mockResolvedValue(stream);
		enumerateDevices = vi.fn().mockResolvedValue([
			{ kind: "audioinput", deviceId: "microphone-1", groupId: "group-1", label: "Desk" },
			{ kind: "videoinput", deviceId: "camera-1", label: "Camera" },
		]);
		storeMicrophoneSidecar = vi.fn().mockResolvedValue({ success: true });
		vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, enumerateDevices } });
		vi.stubGlobal("window", { electronAPI: { storeMicrophoneSidecar } });
		vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
		vi.spyOn(performance, "now").mockImplementation(() => now);
		vi.spyOn(Date, "now").mockReturnValue(10_025);
		vi.spyOn(console, "info").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("reads the current profile, preserves settings, and captures the final stop chunk", async () => {
		const fallback = createFallback();
		profile = "raw";
		await expect(startFallback(fallback)).resolves.toBe(true);
		expect(getUserMedia).toHaveBeenCalledWith({
			audio: {
				deviceId: { exact: "microphone-1" },
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false,
				channelCount: { ideal: 1 },
				sampleRate: { ideal: 48_000 },
			},
			video: false,
		});
		expect(recorder().start).toHaveBeenCalledWith(250);
		expect(fallback.startDelayMs).toBe(25);
		expect(fallback.trackSettings).toMatchObject({
			trackId: "track-1",
			trackEnabled: true,
			trackReadyState: "live",
			autoGainControl: true,
			sampleRate: 48_000,
		});
		const blob = await fallback.stop();
		expect(await blob?.text()).toBe("tail");
		expect(blob?.type).toBe("audio/webm;codecs=opus");
		expect(track.stop).toHaveBeenCalledOnce();
		await expect(fallback.stop()).resolves.toBeNull();
		await fallback.storeSidecar(Promise.resolve(blob), "/recording.mp4");
		expect(storeMicrophoneSidecar).toHaveBeenCalledWith(
			expect.any(ArrayBuffer),
			"/recording.mp4",
			expect.objectContaining({
				startDelayMs: 25,
				browserMicrophoneProfile: "raw",
				requestedBrowserMicrophoneProfile: "RAW",
				audioInputDevices: [
					{ deviceId: "microphone-1", groupId: "group-1", label: "Desk" },
				],
				mediaRecorder: {
					mimeType: "audio/webm;codecs=opus",
					audioBitsPerSecond: 128_000,
					timesliceMs: 250,
				},
			}),
		);
	});

	it("releases a microphone acquired after cancellation without starting its recorder", async () => {
		let resolveStream!: (value: MediaStream) => void;
		getUserMedia.mockReturnValue(
			new Promise<MediaStream>((resolve) => {
				resolveStream = resolve;
			}),
		);
		let cancelled = false;
		const fallback = createFallback();
		const pending = fallback.start({
			mainStartedAt: 10_000,
			startWasCancelled: () => cancelled,
		});
		cancelled = true;
		resolveStream(stream);
		await expect(pending).resolves.toBe(false);
		expect(track.stop).toHaveBeenCalledOnce();
		expect(recorder().start).not.toHaveBeenCalled();
		await expect(fallback.stop()).resolves.toBeNull();
		expect(toast.error).not.toHaveBeenCalled();
	});

	it.each([
		"NotAllowedError",
		"SecurityError",
	])("keeps native recording usable after a %s microphone denial", async (name) => {
		getUserMedia.mockRejectedValue(new DOMException("Denied", name));
		const fallback = createFallback();
		await expect(startFallback(fallback)).resolves.toBe(true);
		expect(toast.error).toHaveBeenCalledWith(
			"Microphone permission denied. Recording will continue without microphone audio.",
			{ id: "recording-microphone-fallback-error", duration: 10_000 },
		);
		expect(fallback.startDelayMs).toBeNull();
		expect(fallback.trackSettings).toBeNull();
		await expect(fallback.stop()).resolves.toBeNull();
	});

	it("releases the acquired microphone after recorder setup fails", async () => {
		FakeMediaRecorder.constructorError = new Error("Opus unavailable");
		const fallback = createFallback();
		await expect(startFallback(fallback)).resolves.toBe(true);
		expect(track.stop).toHaveBeenCalledOnce();
		expect(toast.error).toHaveBeenCalledWith(
			"Opus unavailable. Recording will continue without microphone audio.",
			expect.objectContaining({ id: "recording-microphone-fallback-error" }),
		);
		expect(fallback.trackSettings).toBeNull();
	});

	it("continues recording when optional device enumeration is unavailable", async () => {
		enumerateDevices.mockRejectedValue(new Error("Device listing unavailable"));
		const fallback = createFallback();
		await expect(startFallback(fallback)).resolves.toBe(true);
		await fallback.storeSidecar(fallback.stop(), "/recording.mp4");
		expect(storeMicrophoneSidecar.mock.calls[0][2]).not.toHaveProperty("audioInputDevices");
		expect(toast.error).not.toHaveBeenCalled();
	});

	it("excludes pauses from chunk timing while retaining wall-clock diagnostics and the final chunk", async () => {
		const fallback = createFallback();
		await startFallback(fallback);
		now = 1_250;
		recorder().emitChunk("a");
		now = 1_500;
		fallback.pause();
		fallback.pause();
		expect(recorder().requestData).toHaveBeenCalledOnce();
		now = 1_700;
		recorder().emitChunk("b");
		now = 2_000;
		fallback.resume();
		fallback.resume();
		expect(recorder().resume).toHaveBeenCalledOnce();
		now = 2_250;
		recorder().emitChunk("c");
		now = 2_500;
		const blob = await fallback.stop();
		expect(await blob?.text()).toBe("aflushbctail");
		await fallback.storeSidecar(Promise.resolve(blob), "/recording.mp4");
		const options = storeMicrophoneSidecar.mock.calls[0][2];
		expect(options.pauseIntervals).toEqual([
			{ startElapsedMs: 500, endElapsedMs: 1_000, durationMs: 500 },
		]);
		expect(options.chunkEvents).toEqual([
			{
				index: 0,
				size: 1,
				elapsedMs: 250,
				deltaMs: null,
				recordedElapsedMs: 250,
				recordedDeltaMs: null,
			},
			{
				index: 1,
				size: 5,
				elapsedMs: 500,
				deltaMs: 250,
				recordedElapsedMs: 500,
				recordedDeltaMs: 250,
			},
			{
				index: 2,
				size: 1,
				elapsedMs: 700,
				deltaMs: 200,
				recordedElapsedMs: 500,
				recordedDeltaMs: 0,
			},
			{
				index: 3,
				size: 1,
				elapsedMs: 1_250,
				deltaMs: 550,
				recordedElapsedMs: 750,
				recordedDeltaMs: 250,
			},
			{
				index: 4,
				size: 4,
				elapsedMs: 1_500,
				deltaMs: 250,
				recordedElapsedMs: 1_000,
				recordedDeltaMs: 250,
			},
		]);
	});

	it("closes an outstanding pause before collecting the last stop chunk", async () => {
		const fallback = createFallback();
		await startFallback(fallback);
		now = 1_250;
		fallback.pause();
		now = 2_000;
		await fallback.storeSidecar(fallback.stop(), "/recording.mp4");
		const options = storeMicrophoneSidecar.mock.calls[0][2];
		expect(options.pauseIntervals).toEqual([
			{ startElapsedMs: 250, endElapsedMs: 1_000, durationMs: 750 },
		]);
		expect(options.chunkEvents.at(-1)).toMatchObject({
			elapsedMs: 1_000,
			recordedElapsedMs: 250,
		});
	});

	it("can pause even when a browser refuses the pre-pause data flush", async () => {
		const fallback = createFallback();
		await startFallback(fallback);
		recorder().requestData.mockImplementation(() => {
			throw new Error("Recorder busy");
		});
		expect(() => fallback.pause()).not.toThrow();
		expect(recorder().state).toBe("paused");
		fallback.resume();
		expect(recorder().state).toBe("recording");
		await fallback.stop();
	});

	it("retains diagnostics until persistence completes and accepts the stop-time snapshots", async () => {
		let finishStore!: (result: { success: boolean }) => void;
		storeMicrophoneSidecar.mockReturnValue(
			new Promise((resolve) => {
				finishStore = resolve;
			}),
		);
		const fallback = createFallback();
		await startFallback(fallback);
		const startDelayMs = fallback.startDelayMs;
		const trackSettings = fallback.trackSettings;
		const blob = await fallback.stop();
		fallback.resetStartDelay();
		const storing = fallback.storeSidecar(
			Promise.resolve(blob),
			"/recording.mp4",
			startDelayMs,
			trackSettings,
		);
		await vi.waitFor(() => expect(storeMicrophoneSidecar).toHaveBeenCalledOnce());
		expect(fallback.trackSettings).toEqual(trackSettings);
		expect(storeMicrophoneSidecar.mock.calls[0][2]).toMatchObject({
			startDelayMs: 25,
			mediaTrackSettings: trackSettings,
		});
		finishStore({ success: true });
		await storing;
		expect(fallback.trackSettings).toBeNull();
		expect(fallback.startDelayMs).toBeNull();
	});

	it.each([
		"failure",
		"rejection",
	])("reports a storage %s and clears diagnostic state before the next take", async (failure) => {
		if (failure === "failure")
			storeMicrophoneSidecar.mockResolvedValueOnce({ success: false, error: "Disk full" });
		else storeMicrophoneSidecar.mockRejectedValueOnce(new Error("Disk full"));
		const fallback = createFallback();
		await startFallback(fallback);
		now = 1_250;
		fallback.pause();
		now = 1_500;
		await expect(fallback.storeSidecar(fallback.stop(), "/first.mp4")).resolves.toBeUndefined();
		expect(toast.error).toHaveBeenCalledWith(
			"Disk full. Recording was saved without the fallback microphone track.",
			{ id: "recording-microphone-sidecar-error", duration: 10_000 },
		);
		expect(fallback.startDelayMs).toBeNull();
		expect(fallback.trackSettings).toBeNull();
		now = 3_000;
		await startFallback(fallback);
		now = 3_250;
		await fallback.storeSidecar(fallback.stop(), "/second.mp4");
		const options = storeMicrophoneSidecar.mock.calls[1][2];
		expect(options).not.toHaveProperty("pauseIntervals");
		expect(options.chunkEvents).toEqual([
			{
				index: 0,
				size: 4,
				elapsedMs: 250,
				deltaMs: null,
				recordedElapsedMs: 250,
				recordedDeltaMs: null,
			},
		]);
	});

	it("clears metadata without persisting a sidecar when recording produced no audio", async () => {
		const fallback = createFallback();
		await startFallback(fallback);
		recorder().finalChunk = "";
		const blob = await fallback.stop();
		expect(blob).toBeNull();
		await fallback.storeSidecar(Promise.resolve(blob), "/recording.mp4");
		expect(storeMicrophoneSidecar).not.toHaveBeenCalled();
		expect(fallback.trackSettings).toBeNull();
		expect(fallback.startDelayMs).toBeNull();
	});

	it("releases active capture on cleanup and leaves later stop calls harmless", async () => {
		const fallback = createFallback();
		await startFallback(fallback);
		recorder().emitChunk("abandoned");
		fallback.cleanup();
		expect(recorder().stop).toHaveBeenCalledOnce();
		expect(track.stop).toHaveBeenCalledOnce();
		expect(fallback.trackSettings).toBeNull();
		await expect(fallback.stop()).resolves.toBeNull();
		expect(storeMicrophoneSidecar).not.toHaveBeenCalled();
	});
});

const microphoneHooks = vi.hoisted(() => {
	const states: unknown[] = [];
	const cleanups: (() => void)[] = [];
	let writes = 0;
	return {
		states,
		reset() {
			states.length = 0;
			cleanups.length = 0;
			writes = 0;
		},
		cleanup() {
			for (const cleanup of cleanups.splice(0)) cleanup();
		},
		get writes() {
			return writes;
		},
		useState<T>(initial: T) {
			const index = states.length;
			states.push(initial);
			return [
				initial,
				(value: T | ((previous: T) => T)) => {
					writes++;
					states[index] =
						typeof value === "function"
							? (value as (previous: T) => T)(states[index] as T)
							: value;
				},
			] as const;
		},
		useEffect(effect: () => (() => void) | undefined) {
			const cleanup = effect();
			if (cleanup) cleanups.push(cleanup);
		},
	};
});
vi.mock("react", () => ({
	useState: microphoneHooks.useState,
	useEffect: microphoneHooks.useEffect,
}));
vi.mock("@/contexts/I18nContext", () => ({
	useI18n: () => ({
		t: (key: string, fallback: string, values: Record<string, string> = {}) =>
			key === "notifications.microphone"
				? `Micrófono ${values.id}`
				: fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => values[name] ?? ""),
	}),
}));

describe("microphone device label permission", () => {
	let useMicrophoneDevices: typeof import("./useMicrophoneDevices").useMicrophoneDevices;
	let enumerateDevices: ReturnType<typeof vi.fn>;
	let getUserMedia: ReturnType<typeof vi.fn>;
	let stop: ReturnType<typeof vi.fn>;
	let stream: MediaStream;
	let deviceChange: (() => void) | undefined;
	let removeEventListener: ReturnType<typeof vi.fn>;
	const microphone = (label = "", deviceId = "microphone-1") => ({
		kind: "audioinput",
		deviceId,
		groupId: "group-1",
		label,
	});
	const flush = async () => {
		for (let step = 0; step < 10; step++) await Promise.resolve();
	};
	const mount = (enabled = true, preferredDeviceId?: string) => {
		useMicrophoneDevices(enabled, preferredDeviceId);
	};
	beforeEach(async () => {
		vi.resetModules();
		microphoneHooks.reset();
		deviceChange = undefined;
		stop = vi.fn();
		stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
		enumerateDevices = vi.fn().mockResolvedValue([microphone()]);
		getUserMedia = vi.fn().mockResolvedValue(stream);
		removeEventListener = vi.fn();
		vi.stubGlobal("navigator", {
			mediaDevices: {
				enumerateDevices,
				getUserMedia,
				addEventListener: (_event: string, listener: () => void) => {
					deviceChange = listener;
				},
				removeEventListener,
			},
		});
		vi.spyOn(console, "error").mockImplementation(() => {});
		({ useMicrophoneDevices } = await import("./useMicrophoneDevices"));
	});
	afterEach(() => {
		microphoneHooks.cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("requests hidden microphone labels from raw devices and releases the permission stream", async () => {
		enumerateDevices
			.mockResolvedValueOnce([
				microphone(),
				{ kind: "videoinput", deviceId: "camera", label: "Camera" },
			])
			.mockResolvedValueOnce([microphone("Desk microphone")]);
		mount(true, "microphone-1");
		await flush();
		expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: true });
		expect(enumerateDevices).toHaveBeenCalledTimes(2);
		expect(microphoneHooks.states[0]).toEqual(
			[microphone("Desk microphone")].map(({ kind: _kind, ...device }) => device),
		);
		expect(microphoneHooks.states[1]).toBe("microphone-1");
		expect(microphoneHooks.states[2]).toBe(false);
		expect(stop).toHaveBeenCalledOnce();
	});

	it("retains localized display fallbacks if permission still leaves labels hidden", async () => {
		mount();
		await flush();
		expect(getUserMedia).toHaveBeenCalledOnce();
		expect(microphoneHooks.states[0]).toEqual([
			{ deviceId: "microphone-1", groupId: "group-1", label: "Micrófono micropho" },
		]);
		expect(stop).toHaveBeenCalledOnce();
	});

	it.each([
		["labeled", [microphone("Desk")]],
		["mixed", [microphone("Desk"), microphone("", "second")]],
		["no audio", [{ kind: "videoinput", deviceId: "camera", label: "" }]],
	])("does not request label permission for %s inputs", async (_label, devices) => {
		enumerateDevices.mockResolvedValue(devices);
		mount();
		await flush();
		expect(getUserMedia).not.toHaveBeenCalled();
		expect(stop).not.toHaveBeenCalled();
		if (_label === "mixed") {
			expect(microphoneHooks.states[0]).toContainEqual({
				deviceId: "second",
				groupId: "group-1",
				label: "Micrófono second",
			});
		}
	});

	it("treats whitespace-only raw labels as hidden", async () => {
		enumerateDevices.mockResolvedValue([microphone("   ")]);
		mount();
		await flush();
		expect(getUserMedia).toHaveBeenCalledOnce();
		expect(stop).toHaveBeenCalledOnce();
	});

	it("does not enumerate or request permission while disabled", async () => {
		mount(false);
		await flush();
		expect(enumerateDevices).not.toHaveBeenCalled();
		expect(getUserMedia).not.toHaveBeenCalled();
		expect(deviceChange).toBeUndefined();
	});

	it("reports permission denial and does not prompt again on device changes", async () => {
		getUserMedia.mockRejectedValue(new Error("Microphone permission denied"));
		mount();
		await flush();
		expect(microphoneHooks.states[3]).toBe("Microphone permission denied");
		expect(microphoneHooks.states[2]).toBe(false);
		expect(stop).not.toHaveBeenCalled();
		deviceChange?.();
		await flush();
		expect(getUserMedia).toHaveBeenCalledOnce();
		expect(microphoneHooks.states[3]).toBeNull();
	});

	it("releases the permission stream when follow-up enumeration rejects", async () => {
		enumerateDevices
			.mockResolvedValueOnce([microphone()])
			.mockRejectedValueOnce(new Error("Enumeration failed"));
		mount();
		await flush();
		expect(getUserMedia).toHaveBeenCalledOnce();
		expect(microphoneHooks.states[3]).toBe("Enumeration failed");
		expect(microphoneHooks.states[2]).toBe(false);
		expect(stop).toHaveBeenCalledOnce();
	});

	it("does not request permission after pending enumeration is unmounted", async () => {
		let resolve!: (devices: ReturnType<typeof microphone>[]) => void;
		enumerateDevices.mockReturnValueOnce(
			new Promise((done) => {
				resolve = done;
			}),
		);
		mount();
		microphoneHooks.cleanup();
		const writes = microphoneHooks.writes;
		resolve([microphone()]);
		await flush();
		expect(getUserMedia).not.toHaveBeenCalled();
		expect(microphoneHooks.writes).toBe(writes);
		expect(removeEventListener).toHaveBeenCalledWith("devicechange", deviceChange);
	});

	it("releases a late permission stream without state writes after unmount", async () => {
		let resolve!: (stream: MediaStream) => void;
		getUserMedia.mockReturnValueOnce(
			new Promise((done) => {
				resolve = done;
			}),
		);
		mount();
		await flush();
		expect(getUserMedia).toHaveBeenCalledOnce();
		microphoneHooks.cleanup();
		const writes = microphoneHooks.writes;
		resolve(stream);
		await flush();
		expect(stop).toHaveBeenCalledOnce();
		expect(microphoneHooks.writes).toBe(writes);
	});

	it("requests label permission only once per session after success", async () => {
		mount();
		await flush();
		deviceChange?.();
		await flush();
		expect(getUserMedia).toHaveBeenCalledOnce();
		expect(stop).toHaveBeenCalledOnce();
	});
});
