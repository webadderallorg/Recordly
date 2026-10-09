import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const react = vi.hoisted(() => {
	const slots: unknown[] = [];
	const effects: Array<() => void> = [];
	let index = 0;
	type EffectSlot = { deps?: unknown[]; cleanup?: () => void };
	return {
		reset() {
			slots.length = 0;
		},
		render(run: () => void) {
			index = 0;
			run();
			for (const effect of effects.splice(0)) effect();
		},
		useRef<T>(initial: T) {
			const i = index++;
			if (!(i in slots)) slots[i] = { current: initial };
			return slots[i];
		},
		useState<T>(initial: T) {
			const i = index++;
			if (!(i in slots)) slots[i] = initial;
			return [
				slots[i],
				(value: T) => {
					slots[i] = value;
				},
			];
		},
		useEffect(effect: () => (() => void) | undefined, deps?: unknown[]) {
			const i = index++;
			const previous = slots[i] as EffectSlot | undefined;
			if (previous?.deps && deps?.every((dep, k) => Object.is(dep, previous.deps?.[k])))
				return;
			const slot: EffectSlot = { deps };
			slots[i] = slot;
			effects.push(() => {
				previous?.cleanup?.();
				slot.cleanup = effect() ?? undefined;
			});
		},
	};
});
vi.mock("react", () => ({
	useRef: react.useRef,
	useState: react.useState,
	useEffect: react.useEffect,
}));

const { useRemoteExportBridge } = await import("./useRemoteExportBridge");

type Input = Parameters<typeof useRemoteExportBridge>[0];

const api = {
	sendRemoteEditorReady: vi.fn(),
	sendRemoteExportProgress: vi.fn(),
	sendRemoteExportResult: vi.fn(),
	onRemoteExportRequest: vi.fn(),
};

function baseInput(overrides: Partial<Input> = {}): Input {
	return {
		videoPath: "media://rec.mp4",
		videoSourcePath: "/rec.mp4",
		error: null,
		loading: false,
		isPreviewReady: true,
		duration: 10,
		cursorTelemetrySourcePath: "/rec.mp4",
		pendingFreshRecordingAutoZoomPathRef: { current: null },
		videoPlaybackRef: { current: { video: { videoWidth: 1920, videoHeight: 1080 } } },
		timeline: {
			clipRegions: [
				{ id: "a", startMs: 0, endMs: 4_000, sourceStartMs: 0, speed: 1 },
				{ id: "b", startMs: 6_000, endMs: 10_000, sourceStartMs: 20_000, speed: 1 },
			],
		},
		effectiveZoomRegions: [{ id: "z", startMs: 2_500, endMs: 3_500 }],
		settings: {
			mp4FrameRate: 30,
			exportBackendPreference: "auto",
			exportPipelineModel: "modern",
			gifFrameRate: 15,
			gifLoop: true,
			gifSizePreset: "medium",
		},
		session: { isExporting: false, hasPendingExportSave: false, exportProgress: null },
		handleExport: vi.fn(async () => "/out/a.mp4"),
		...overrides,
	} as unknown as Input;
}

const render = (input: Input) => react.render(() => useRemoteExportBridge(input));
const lastReady = () => api.sendRemoteEditorReady.mock.lastCall?.[0];
const request = (overrides: Partial<RemoteExportRequest> = {}) =>
	api.onRemoteExportRequest.mock.lastCall?.[0]({
		id: "r1",
		outputPath: "/out/a.mp4",
		format: "mp4",
		...overrides,
	});
const lastResult = () => api.sendRemoteExportResult.mock.lastCall?.[0];

beforeEach(() => {
	react.reset();
	vi.useFakeTimers();
	vi.stubGlobal("window", {
		electronAPI: api,
		setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
		clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
	});
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("readiness", () => {
	it("reports ready once the preview and cursor telemetry are loaded", () => {
		render(baseInput({ cursorTelemetrySourcePath: null }));
		expect(lastReady()).toEqual({ videoPath: "/rec.mp4", ready: false });
		render(baseInput());
		expect(lastReady()).toEqual({ videoPath: "/rec.mp4", ready: true });
	});

	it("waits up to 6 s for pending fresh-recording auto-zoom", () => {
		const input = baseInput({
			pendingFreshRecordingAutoZoomPathRef: { current: "media://rec.mp4" },
		});
		render(input);
		expect(lastReady()?.ready).toBe(false);
		vi.advanceTimersByTime(6_000);
		render(input);
		expect(lastReady()?.ready).toBe(true);
	});

	it("waits for agent edits to settle, up to the same grace", () => {
		render(baseInput({ agentEditsSettled: false }));
		expect(lastReady()?.ready).toBe(false);
		render(baseInput({ agentEditsSettled: true }));
		expect(lastReady()?.ready).toBe(true);

		react.reset();
		render(baseInput({ agentEditsSettled: false }));
		vi.advanceTimersByTime(6_000);
		render(baseInput({ agentEditsSettled: false }));
		expect(lastReady()?.ready).toBe(true);
	});
});

describe("requests", () => {
	it.each([
		["not ready", { loading: true }, /still loading/],
		["exporting", { session: { isExporting: true } }, /already running/],
		[
			"pending save",
			{ session: { isExporting: false, hasPendingExportSave: true } },
			/unsaved export/,
		],
		[
			"no video",
			{ videoPlaybackRef: { current: { video: { videoWidth: 0, videoHeight: 0 } } } },
			/not loaded/,
		],
	])("refuses when %s", async (_name, overrides, message) => {
		const input = baseInput(overrides as Partial<Input>);
		render(input);
		await request();
		expect(lastResult()).toEqual({
			id: "r1",
			ok: false,
			error: expect.stringMatching(message),
		});
		expect(input.handleExport).not.toHaveBeenCalled();
	});

	it("exports to the requested path with remote defaults", async () => {
		const input = baseInput();
		render(input);
		await request({ quality: "high" });
		expect(input.handleExport).toHaveBeenCalledWith(
			expect.objectContaining({ format: "mp4", quality: "high", encodingMode: "balanced" }),
			expect.objectContaining({ destination: "download", outputPath: "/out/a.mp4" }),
		);
		expect(lastResult()).toEqual({ id: "r1", ok: true, path: "/out/a.mp4" });
	});

	it("maps editor errors, cancels and throws", async () => {
		const handleExport = vi.fn();
		const input = baseInput({ handleExport });
		render(input);
		handleExport.mockImplementationOnce(async (_settings, options) => {
			options.onError("Disk full");
			return undefined;
		});
		await request();
		expect(lastResult()).toEqual({ id: "r1", ok: false, error: "Disk full" });
		handleExport.mockResolvedValueOnce(undefined);
		await request();
		expect(lastResult()?.error).toMatch(/canceled/);
		handleExport.mockRejectedValueOnce(new Error("boom"));
		await request();
		expect(lastResult()?.error).toBe("Error: boom");
	});

	it("forwards progress only when the rounded value changes", async () => {
		let finish: (path: string) => void = () => undefined;
		const input = baseInput({
			handleExport: vi.fn(
				() =>
					new Promise<string>((resolve) => {
						finish = resolve;
					}),
			),
		});
		render(input);
		const pending = request();
		for (const percentage of [10.2, 10.4, 11]) {
			render({
				...input,
				session: { ...input.session, exportProgress: { percentage } },
			} as Input);
		}
		expect(api.sendRemoteExportProgress.mock.calls).toEqual([
			[{ id: "r1", progress: 10 }],
			[{ id: "r1", progress: 11 }],
		]);
		finish("/out/a.mp4");
		await pending;
	});
});

describe("range requests", () => {
	it.each([
		[{ fromMs: 1_000 }, /both fromMs and toMs/],
		[{ fromMs: 2_000, toMs: 2_050 }, /at least 100 ms/],
		[{ fromMs: -5, toMs: 2_000 }, /0 or more/],
		[{ fromMs: 9_000, toMs: 12_000 }, /past the end of the edited timeline/],
		[{ fromMs: 4_200, toMs: 5_800 }, /whole span was cut/],
	])("refuses %o without rendering", async (overrides, message) => {
		const input = baseInput();
		render(input);
		await request(overrides as Partial<RemoteExportRequest>);
		expect(lastResult()).toEqual({
			id: "r1",
			ok: false,
			error: expect.stringMatching(message),
		});
		expect(input.handleExport).not.toHaveBeenCalled();
	});

	it("passes the range through and reports it back", async () => {
		const input = baseInput();
		render(input);
		await request({ fromMs: 2_000, toMs: 8_000 });
		expect(input.handleExport).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ range: { fromMs: 2_000, toMs: 8_000 } }),
		);
		expect(lastResult()).toEqual({
			id: "r1",
			ok: true,
			path: "/out/a.mp4",
			fromMs: 2_000,
			toMs: 8_000,
			timelineDurationMs: 10_000,
			warnings: undefined,
		});
	});

	it("warns when a zoom was already under way at the start", async () => {
		const input = baseInput();
		render(input);
		await request({ fromMs: 2_000, toMs: 8_000 });
		expect(lastResult()?.warnings).toBeUndefined();

		react.reset();
		const settling = baseInput({
			effectiveZoomRegions: [{ id: "z", startMs: 500, endMs: 3_000 }],
		} as unknown as Partial<Input>);
		render(settling);
		await request({ fromMs: 2_000, toMs: 8_000 });
		expect(lastResult()?.warnings).toEqual([
			expect.stringContaining("already under way at 2000 ms"),
		]);
	});

	it("accepts a range that starts exactly on a cut", async () => {
		const input = baseInput();
		render(input);
		await request({ fromMs: 4_000, toMs: 8_000 });
		expect(lastResult()?.ok).toBe(true);
	});

	it("leaves an export with no range alone", async () => {
		const input = baseInput();
		render(input);
		await request();
		expect(input.handleExport).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ range: undefined }),
		);
	});
});
