import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const react = vi.hoisted(() => {
	const slots: unknown[] = [];
	let index = 0;
	return {
		reset() {
			slots.length = 0;
		},
		render(run: () => void) {
			index = 0;
			run();
		},
		useRef<T>(initial: T) {
			const i = index++;
			if (!(i in slots)) slots[i] = { current: initial };
			return slots[i];
		},
		useEffect(effect: () => (() => void) | undefined, deps?: unknown[]) {
			const i = index++;
			if (i in slots && deps?.length === 0) return;
			slots[i] = true;
			effect();
		},
	};
});
vi.mock("react", () => ({ useRef: react.useRef, useEffect: react.useEffect }));

const { useRemoteReviewBridge } = await import("./useRemoteReviewBridge");

type Input = Parameters<typeof useRemoteReviewBridge>[0];

const api = { onRemoteReviewRequest: vi.fn(), sendRemoteReviewResult: vi.fn() };

function baseInput(overrides: Partial<Input> = {}): Input {
	return {
		ready: true,
		duration: 20,
		videoPlaybackRef: { current: { video: { videoWidth: 1920, videoHeight: 1080 } } },
		timeline: {
			clipRegions: [
				{ id: "a", startMs: 0, endMs: 3000, sourceStartMs: 2000, speed: 1 },
				{ id: "b", startMs: 3000, endMs: 5000, speed: 2 },
			],
			zoomRegions: [{ id: "z" }],
			autoCaptions: [{ id: "c1" }, { id: "c2" }],
			autoCaptionSettings: { enabled: true },
		},
		...overrides,
	} as unknown as Input;
}

const render = (input: Input) => react.render(() => useRemoteReviewBridge(input));
const request = () => api.onRemoteReviewRequest.mock.lastCall?.[0]({ id: "r1" });
const lastResult = () => api.sendRemoteReviewResult.mock.lastCall?.[0];

beforeEach(() => {
	react.reset();
	vi.stubGlobal("window", { electronAPI: api });
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("useRemoteReviewBridge", () => {
	it("describes the current timeline once ready", () => {
		render(baseInput({ ready: false }));
		request();
		expect(lastResult()).toEqual({
			id: "r1",
			ok: false,
			error: "The editor is still loading the recording.",
		});
		render(baseInput());
		request();
		expect(api.onRemoteReviewRequest).toHaveBeenCalledTimes(1);
		expect(lastResult()).toEqual({
			id: "r1",
			ok: true,
			timeline: {
				clips: [
					{ startMs: 0, endMs: 3000, sourceStartMs: 2000, speed: 1 },
					{ startMs: 3000, endMs: 5000, sourceStartMs: 3000, speed: 2 },
				],
				zooms: 1,
				captions: 2,
				durationMs: 5000,
				sourceDurationMs: 20_000,
				width: 1920,
				height: 1080,
			},
		});
	});

	it("reports the whole source with no clips and no captions when they are off", () => {
		const input = baseInput();
		render({
			...input,
			timeline: {
				...input.timeline,
				clipRegions: [],
				autoCaptionSettings: { enabled: false },
			},
		} as Input);
		request();
		expect(lastResult().timeline).toMatchObject({
			clips: [],
			captions: 0,
			durationMs: 20_000,
		});
	});

	it("refuses when the video element is not loaded", () => {
		render(baseInput({ videoPlaybackRef: { current: null } }));
		request();
		expect(lastResult()).toEqual({
			id: "r1",
			ok: false,
			error: "The video is not loaded in the editor.",
		});
	});
});
