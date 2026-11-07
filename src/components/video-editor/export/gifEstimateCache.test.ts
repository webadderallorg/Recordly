import { afterEach, describe, expect, it, vi } from "vitest";
import {
	cacheGifSizeEstimate,
	getCachedGifSizeEstimate,
	gifEstimateTelemetryKey,
	runGifSizeEstimate,
	stopGifSizeEstimates,
} from "./gifEstimateCache";

const estimate = {
	originalBytes: 100,
	optimizedBytes: 40,
	reductionPercent: 60,
	sampleFrames: 60,
	totalFrames: 300,
};
afterEach(() => {
	gifHooks.dispose();
	vi.useRealTimers();
});
describe("GIF estimate scheduling and cache", () => {
	it("expires measured results after five minutes without extending their lifetime on access", () => {
		vi.useFakeTimers();
		cacheGifSizeEstimate("ttl", estimate);
		vi.advanceTimersByTime(299_999);
		expect(getCachedGifSizeEstimate("ttl")).toEqual(estimate);
		vi.advanceTimersByTime(1);
		expect(getCachedGifSizeEstimate("ttl")).toBeUndefined();
	});
	it("keeps a bounded LRU cache", () => {
		for (let i = 0; i < 8; i++) cacheGifSizeEstimate(`lru-${i}`, estimate);
		expect(getCachedGifSizeEstimate("lru-0")).toEqual(estimate);
		cacheGifSizeEstimate("lru-8", estimate);
		expect(getCachedGifSizeEstimate("lru-1")).toBeUndefined();
		expect(getCachedGifSizeEstimate("lru-0")).toEqual(estimate);
	});
	it("distinguishes telemetry arrays without serializing their contents", () => {
		const telemetry = [];
		expect(gifEstimateTelemetryKey(telemetry)).toBe(gifEstimateTelemetryKey(telemetry));
		expect(gifEstimateTelemetryKey([])).not.toBe(gifEstimateTelemetryKey(telemetry));
	});
	it("serializes jobs and recovers after failures", async () => {
		let release!: () => void;
		const first = runGifSizeEstimate(
			new AbortController().signal,
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		const next = vi.fn(async () => {
			throw new Error("failed");
		});
		const second = runGifSizeEstimate(new AbortController().signal, next);
		const rejected = expect(second).rejects.toThrow("failed");
		await Promise.resolve();
		expect(next).not.toHaveBeenCalled();
		release();
		await first;
		await rejected;
		await expect(
			runGifSizeEstimate(new AbortController().signal, async () => 42),
		).resolves.toBe(42);
	});
	it("export cancellation drains active cleanup and skips queued samples", async () => {
		let finishCleanup!: () => void;
		let activeSignal!: AbortSignal;
		const first = runGifSizeEstimate(new AbortController().signal, (signal) => {
			activeSignal = signal;
			return new Promise<void>((resolve) => {
				finishCleanup = resolve;
			});
		});
		const next = vi.fn(async () => 1);
		const second = runGifSizeEstimate(new AbortController().signal, next);
		const rejected = expect(second).rejects.toMatchObject({ name: "AbortError" });
		await Promise.resolve();
		let drained = false;
		const stopped = stopGifSizeEstimates().then(() => {
			drained = true;
		});
		expect(activeSignal.aborted).toBe(true);
		await Promise.resolve();
		expect(drained).toBe(false);
		finishCleanup();
		await first;
		await rejected;
		await stopped;
		expect(next).not.toHaveBeenCalled();
		expect(drained).toBe(true);
	});
});

const gifHooks = vi.hoisted(() => {
	const slots: unknown[] = [];
	let cursor = 0;
	const same = (a: readonly unknown[], b: readonly unknown[]) =>
		a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
	return {
		reset() {
			slots.length = 0;
			cursor = 0;
		},
		render(factory: () => void) {
			cursor = 0;
			factory();
		},
		dispose() {
			for (const slot of slots) (slot as { cleanup?: () => void } | undefined)?.cleanup?.();
		},
		useMemo<T>(factory: () => T, deps: readonly unknown[]): T {
			const index = cursor++;
			const previous = slots[index] as { deps: readonly unknown[]; value: T } | undefined;
			if (previous && same(previous.deps, deps)) return previous.value;
			const value = factory();
			slots[index] = { deps, value };
			return value;
		},
		useRef<T>(current: T) {
			const index = cursor++;
			slots[index] ??= { current };
			return slots[index] as { current: T };
		},
		useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
			const index = cursor++;
			const previous = slots[index] as
				| { deps: readonly unknown[]; cleanup?: () => void }
				| undefined;
			if (previous && same(previous.deps, deps)) return;
			previous?.cleanup?.();
			slots[index] = { deps, cleanup: effect() };
		},
	};
});
vi.mock("react", () => gifHooks);
vi.mock("@/lib/exporter", () => ({
	GIF_SIZE_PRESETS: {},
	calculateOutputDimensions: (width: number, height: number) => ({ width, height }),
}));
import { useGifSizeEstimate } from "./useGifSizeEstimate";
import type { ExportRunnerInput } from "./exportRunnerSupport";
function gifInput(enabled = true) {
	gifHooks.reset();
	vi.useFakeTimers();
	const serializedAnnotations = vi.fn(() => ({ id: "annotation", text: "original" }));
	const serializedCaptions = vi.fn(() => ({ text: "caption" }));
	const sourcePath = vi.fn(() => null);
	const estimate = vi.fn();
	const video = { videoWidth: 1280, videoHeight: 720, duration: 10 };
	const input = {
		videoPath: "/recording.mp4",
		videoPlaybackRef: { current: { video } },
		exportSettings: {
			publishDestination: "local",
			exportFormat: "gif",
			gifFrameRate: 15,
			gifLoop: true,
			gifSizePreset: "original",
		},
		exportSession: {
			showExportDropdown: enabled,
			isExporting: false,
			setGifSizeEstimate: estimate,
		},
		appearance: {
			wallpaper: `data:image/png;base64,${"A".repeat(100_000)}`,
			padding: {},
			shadowIntensity: 0,
			webcam: {
				get sourcePath() {
					return sourcePath();
				},
			},
		},
		timeline: {
			annotationRegions: [{ toJSON: serializedAnnotations }],
			autoCaptions: [{ toJSON: serializedCaptions }],
			clipRegions: [],
			trimRegions: [],
		},
		effectiveCursorTelemetry: [],
		effectiveSpeedRegions: [],
		effectiveZoomRegions: [],
		effectiveShowCursor: false,
	} as unknown as ExportRunnerInput;
	const render = () =>
		gifHooks.render(() =>
			useGifSizeEstimate({
				...input,
				appearance: { ...input.appearance },
				timeline: { ...input.timeline },
				exportSession: { ...input.exportSession },
			}),
		);
	return {
		input,
		render,
		estimate,
		video,
		sourcePath,
		serializedAnnotations,
		serializedCaptions,
	};
}
describe("GIF estimate playback renders", () => {
	it("serializes unchanged large render inputs once despite new wrappers and playback renders", () => {
		const state = gifInput();
		state.render();
		for (let frame = 0; frame < 50; frame++) {
			state.input.isPlaying = frame % 2 === 0;
			state.render();
		}
		expect(state.serializedAnnotations).toHaveBeenCalledTimes(1);
		expect(state.serializedCaptions).toHaveBeenCalledTimes(1);
		expect(state.estimate).toHaveBeenCalledTimes(1);
	});
	it("skips disabled construction and invalidates the estimate for real content or source changes", () => {
		const state = gifInput(false);
		state.render();
		expect(state.sourcePath).not.toHaveBeenCalled();
		expect(state.serializedAnnotations).not.toHaveBeenCalled();
		state.input.exportSession.showExportDropdown = true;
		state.render();
		expect(state.serializedAnnotations).toHaveBeenCalledTimes(1);
		state.input.appearance.wallpaper = "#123456";
		state.render();
		expect(state.serializedAnnotations).toHaveBeenCalledTimes(2);
		state.video.duration = 20;
		state.render();
		expect(state.serializedAnnotations).toHaveBeenCalledTimes(3);
		state.input.timeline.annotationRegions = [];
		state.render();
		expect(state.serializedCaptions).toHaveBeenCalledTimes(4);
		state.video.videoWidth = 640;
		state.render();
		expect(state.serializedCaptions).toHaveBeenCalledTimes(5);
		state.input.timeline.autoCaptions = [];
		state.render();
		state.input.exportSettings.gifFrameRate = 30;
		state.render();
		expect(state.estimate.mock.calls.slice(1)).toEqual(
			Array.from({ length: 7 }, () => [{ status: "calculating" }]),
		);
	});
});
