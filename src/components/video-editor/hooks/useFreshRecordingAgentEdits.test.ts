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
		useCallback<T>(callback: T) {
			index++;
			return callback;
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
	useCallback: react.useCallback,
	useState: react.useState,
	useEffect: react.useEffect,
}));

const planAgentEdits = vi.hoisted(() => vi.fn());
vi.mock("../agentEdits/planAgentEdits", () => ({ planAgentEdits }));

const { useFreshRecordingAgentEdits } = await import("./useFreshRecordingAgentEdits");
const { useFreshRecordingAutoZoom } = await import("./useFreshRecordingAutoZoom");

type Input = Parameters<typeof useFreshRecordingAgentEdits>[0];

const VIDEO = "media://rec.mp4";
const log = { version: 1, scenes: [], spans: [] };
const plan = {
	keepRanges: [
		{ startMs: 0, endMs: 1000 },
		{ startMs: 3000, endMs: 5000 },
	],
	zooms: [{ startMs: 3500, endMs: 4500, depth: 3, focus: { cx: 0.2, cy: 0.3 } }],
	captions: [{ startMs: 3000, endMs: 5500, text: "Open settings" }],
};
const getAgentActivity = vi.fn();
const setAutoSuggestZoomsTrigger = vi.fn();
const telemetry = [
	{ timeMs: 0, cx: 0.5, cy: 0.5 },
	{ timeMs: 500, cx: 0.4, cy: 0.4, interactionType: "click" as const },
];
let autoZoomRefs = {
	autoSuggestedVideoPathRef: { current: null as string | null },
	pendingFreshRecordingAutoSuggestTimeoutRef: { current: null as number | null },
	pendingFreshRecordingAutoSuggestTelemetryCountRef: { current: 0 },
};

function makeInput(overrides: Partial<Input> = {}): Input {
	return {
		enabled: true,
		applyZooms: true,
		videoPath: VIDEO,
		videoSourcePath: "/rec.mp4",
		loading: false,
		isPreviewReady: true,
		duration: 6,
		timeline: {
			clipRegions: [],
			zoomRegions: [],
			setClipRegions: vi.fn(),
			setZoomRegions: vi.fn(),
			setAnnotationRegions: vi.fn(),
			setAudioRegions: vi.fn(),
			setAutoCaptions: vi.fn(),
			setAutoCaptionSettings: vi.fn(),
		},
		videoPlaybackRef: { current: { video: { videoWidth: 1920, videoHeight: 1080 } } },
		nextZoomIdRef: { current: 4 },
		nextClipIdRef: { current: 2 },
		pendingFreshRecordingAutoZoomPathRef: { current: VIDEO },
		pendingFreshRecordingAgentEditsPathRef: { current: VIDEO },
		...overrides,
	} as unknown as Input;
}

const zoomRegions: never[] = [];
const agentZoom = {
	id: "zoom-4",
	startMs: 1500,
	endMs: 2500,
	depth: 3,
	focus: { cx: 0.2, cy: 0.3 },
	mode: "auto",
};

function updated(setter: (value: never) => void, current: unknown[]) {
	const value: unknown = vi.mocked(setter).mock.calls[0][0];
	return typeof value === "function" ? value(current) : value;
}

function renderBoth(input: Input) {
	let settled = false;
	react.render(() => {
		settled = useFreshRecordingAgentEdits(input).agentEditsSettled;
		useFreshRecordingAutoZoom({
			appPlatform: "darwin",
			agentEditsSettled: settled,
			videoPath: input.videoPath,
			loading: false,
			isPreviewReady: true,
			duration: 6,
			cursorTelemetryCount: 2,
			normalizedCursorTelemetry: telemetry,
			zoomRegions,
			setZoomRegions: vi.fn(),
			setAutoSuggestZoomsTrigger,
			videoPlaybackRef: input.videoPlaybackRef,
			pendingFreshRecordingAutoZoomPathRef: input.pendingFreshRecordingAutoZoomPathRef,
			...autoZoomRefs,
		});
	});
	return settled;
}

async function settle(input: Input) {
	renderBoth(input);
	await vi.advanceTimersByTimeAsync(0);
	renderBoth(input);
	return renderBoth(input);
}

beforeEach(() => {
	react.reset();
	autoZoomRefs = {
		autoSuggestedVideoPathRef: { current: null },
		pendingFreshRecordingAutoSuggestTimeoutRef: { current: null },
		pendingFreshRecordingAutoSuggestTelemetryCountRef: { current: 0 },
	};
	vi.useFakeTimers();
	planAgentEdits.mockReturnValue(plan);
	getAgentActivity.mockResolvedValue({ success: true, log });
	vi.stubGlobal("window", {
		electronAPI: { getAgentActivity },
		setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
		clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
	});
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("useFreshRecordingAgentEdits", () => {
	it("applies the plan once for a fresh recording with a log", async () => {
		const input = makeInput();
		expect(renderBoth(input)).toBe(false);
		await vi.advanceTimersByTimeAsync(0);
		expect(renderBoth(input)).toBe(false);
		expect(renderBoth(input)).toBe(true);
		renderBoth(input);

		expect(getAgentActivity).toHaveBeenCalledWith("/rec.mp4");
		expect(planAgentEdits).toHaveBeenCalledWith(log, 6000, 1920 / 1080, undefined);
		const { timeline } = input;
		expect(timeline.setClipRegions).toHaveBeenCalledTimes(1);
		expect(timeline.setClipRegions).toHaveBeenCalledWith([
			{ id: "clip-2", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 },
			{ id: "clip-3", startMs: 1000, endMs: 3000, sourceStartMs: 3000, speed: 1 },
		]);
		expect(
			updated(timeline.setZoomRegions, [{ id: "zoom-1", startMs: 3200, endMs: 3400 }]),
		).toEqual([{ id: "zoom-1", startMs: 1200, endMs: 1400 }, agentZoom]);
		expect(timeline.setAutoCaptions).toHaveBeenCalledWith([
			expect.objectContaining({ startMs: 3000, endMs: 5500, text: "Open settings" }),
		]);
		expect(updated(timeline.setAutoCaptionSettings, { enabled: false } as never)).toEqual({
			enabled: true,
		});
		expect(
			updated(timeline.setAnnotationRegions, [
				{ startMs: 3200, endMs: 3400 },
				{ startMs: 1500, endMs: 2000 },
			]),
		).toEqual([{ startMs: 1200, endMs: 1400 }]);
		expect(input.pendingFreshRecordingAutoZoomPathRef.current).toBeNull();
		expect(input.pendingFreshRecordingAgentEditsPathRef.current).toBeNull();

		await vi.advanceTimersByTimeAsync(1000);
		expect(setAutoSuggestZoomsTrigger).not.toHaveBeenCalled();
	});

	it("forwards the recorded screen change times to the planner", async () => {
		const changeTimesMs = [0, 240, 1800, 4200];
		getAgentActivity.mockResolvedValue({ success: true, log: { ...log, changeTimesMs } });
		const input = makeInput();
		renderBoth(input);
		await vi.advanceTimersByTimeAsync(0);
		renderBoth(input);
		renderBoth(input);

		expect(planAgentEdits).toHaveBeenCalledWith(
			{ ...log, changeTimesMs },
			6000,
			1920 / 1080,
			changeTimesMs,
		);
	});

	it("holds the click auto-suggest while the log is loading", async () => {
		let resolve: (value: unknown) => void = () => undefined;
		getAgentActivity.mockReturnValue(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const input = makeInput();
		renderBoth(input);
		await vi.advanceTimersByTimeAsync(1000);
		renderBoth(input);
		expect(setAutoSuggestZoomsTrigger).not.toHaveBeenCalled();
		resolve({ success: true, log });
		await settle(input);
		expect(input.timeline.setClipRegions).toHaveBeenCalledTimes(1);
	});

	it("turns a speed-ramped keep range into a sped-up clip", async () => {
		planAgentEdits.mockReturnValue({
			...plan,
			keepRanges: [
				{ startMs: 0, endMs: 1000 },
				{ startMs: 1000, endMs: 2600, speed: 4 },
				{ startMs: 2600, endMs: 5000 },
			],
			zooms: [],
			captions: [],
		});
		const input = makeInput();
		await settle(input);
		expect(input.timeline.setClipRegions).toHaveBeenCalledWith([
			{ id: "clip-2", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 },
			{ id: "clip-3", startMs: 1000, endMs: 1400, sourceStartMs: 1000, speed: 4 },
			{ id: "clip-4", startMs: 1400, endMs: 3800, sourceStartMs: 2600, speed: 1 },
		]);
	});

	it("leaves captions alone when the plan has none", async () => {
		planAgentEdits.mockReturnValue({ ...plan, captions: [] });
		const input = makeInput();
		await settle(input);
		expect(input.timeline.setClipRegions).toHaveBeenCalledTimes(1);
		expect(input.timeline.setAutoCaptions).not.toHaveBeenCalled();
		expect(input.timeline.setAutoCaptionSettings).not.toHaveBeenCalled();
	});

	it("blocks the click auto-suggest even when the plan has no zooms", async () => {
		planAgentEdits.mockReturnValue({ ...plan, zooms: [], captions: [] });
		await settle(makeInput());
		await vi.advanceTimersByTimeAsync(1000);
		expect(setAutoSuggestZoomsTrigger).not.toHaveBeenCalled();
	});

	it.each([
		["there is no log", () => getAgentActivity.mockResolvedValue({ success: true, log: null })],
		["the fetch fails", () => getAgentActivity.mockRejectedValue(new Error("boom"))],
		["the planner finds nothing", () => planAgentEdits.mockReturnValue(null)],
	])("hands over to auto zoom when %s", async (_name, arrange) => {
		arrange();
		const input = makeInput();
		expect(await settle(input)).toBe(true);
		expect(input.timeline.setClipRegions).not.toHaveBeenCalled();
		expect(input.pendingFreshRecordingAutoZoomPathRef.current).toBe(VIDEO);
		expect(input.pendingFreshRecordingAgentEditsPathRef.current).toBeNull();
		await vi.advanceTimersByTimeAsync(500);
		expect(setAutoSuggestZoomsTrigger).toHaveBeenCalledTimes(1);
	});

	it.each([
		["a zoom was added", { zoomRegions: [{ id: "zoom-1", startMs: 100, endMs: 900 }] }],
		[
			"the clip was split",
			{
				clipRegions: [
					{ id: "clip-1", startMs: 0, endMs: 2000, sourceStartMs: 0, speed: 1 },
					{ id: "clip-2", startMs: 2000, endMs: 6000, sourceStartMs: 2000, speed: 1 },
				],
			},
		],
		[
			"the clip was trimmed",
			{
				clipRegions: [
					{ id: "clip-1", startMs: 0, endMs: 5000, sourceStartMs: 1000, speed: 1 },
				],
			},
		],
	])("stands down when %s before the edits land", async (_name, edits) => {
		const input = makeInput();
		Object.assign(input.timeline, edits);
		expect(await settle(input)).toBe(true);
		expect(input.timeline.setClipRegions).not.toHaveBeenCalled();
		expect(input.timeline.setZoomRegions).not.toHaveBeenCalled();
		expect(input.pendingFreshRecordingAgentEditsPathRef.current).toBeNull();
	});

	it("applies cuts and captions but no zooms when auto zoom is off", async () => {
		const input = makeInput({
			applyZooms: false,
			pendingFreshRecordingAutoZoomPathRef: { current: null },
		});
		expect(await settle(input)).toBe(true);
		const { timeline } = input;
		expect(timeline.setClipRegions).toHaveBeenCalledTimes(1);
		expect(updated(timeline.setZoomRegions, [])).toEqual([]);
		expect(timeline.setAutoCaptions).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1000);
		expect(setAutoSuggestZoomsTrigger).not.toHaveBeenCalled();
	});

	it.each([
		["agent edits are off", { enabled: false }],
		[
			"both preferences are off",
			{
				enabled: false,
				applyZooms: false,
				pendingFreshRecordingAutoZoomPathRef: { current: null },
			},
		],
		[
			"a project is loaded",
			{
				pendingFreshRecordingAutoZoomPathRef: { current: null },
				pendingFreshRecordingAgentEditsPathRef: { current: null },
			},
		],
	])("does nothing when %s", async (_name, overrides) => {
		const input = makeInput(overrides as Partial<Input>);
		renderBoth(input);
		expect(renderBoth(input)).toBe(true);
		expect(getAgentActivity).not.toHaveBeenCalled();
		expect(input.timeline.setClipRegions).not.toHaveBeenCalled();
		expect(input.pendingFreshRecordingAgentEditsPathRef.current).toBeNull();
		await vi.advanceTimersByTimeAsync(1000);
		expect(setAutoSuggestZoomsTrigger).toHaveBeenCalledTimes(
			input.pendingFreshRecordingAutoZoomPathRef.current ? 1 : 0,
		);
	});

	it("waits for the preview before applying", async () => {
		const input = makeInput({ isPreviewReady: false });
		expect(await settle(input)).toBe(false);
		expect(input.timeline.setClipRegions).not.toHaveBeenCalled();
		const ready = { ...input, isPreviewReady: true };
		renderBoth(ready);
		expect(renderBoth(ready)).toBe(true);
		expect(input.timeline.setClipRegions).toHaveBeenCalledTimes(1);
	});
});
