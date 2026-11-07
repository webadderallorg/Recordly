import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ZOOM_BLOCK_DURATION_MS } from "../../core/constants";
import { useTimelineZoomActions } from "./useTimelineZoomActions";

vi.mock("react", () => ({
	useCallback: (callback: unknown) => callback,
	useMemo: (factory: () => unknown) => factory(),
}));
vi.mock("../utils/timelineNotifications", () => ({
	timelineNotifications: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

type Params = Parameters<typeof useTimelineZoomActions>[0];
function setup(overrides: Partial<Params> = {}) {
	const params: Params = {
		timeline: { videoDuration: 6, totalMs: 6000, currentTimeMs: 0 },
		regions: {
			zoom: [],
			clip: [{ id: "clip", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }],
		},
		cursorTelemetry: [
			{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move" },
			{ timeMs: 2000, cx: 0.5, cy: 0.5, interactionType: "click" },
			{ timeMs: 2050, cx: 0.5, cy: 0.5, interactionType: "mouseup" },
			{ timeMs: 6000, cx: 0.5, cy: 0.5, interactionType: "move" },
		],
		onZoomAdded: vi.fn(),
		onZoomSuggested: vi.fn(),
		...overrides,
	};
	// biome-ignore lint/correctness/useHookAtTopLevel: This test intentionally mocks React hooks to simulate a component render.
	const actions = useTimelineZoomActions(params);
	return { params, actions };
}

describe("timeline zoom availability", () => {
	it.each([
		0,
		Number.NaN,
	])("does not suggest or add zooms before valid source duration (%s)", (videoDuration) => {
		const { actions, params } = setup({
			timeline: { videoDuration, totalMs: 0, currentTimeMs: 0 },
		});
		actions.handleSuggestZooms();
		actions.addZoomAtMs(1000);
		expect(params.onZoomSuggested).not.toHaveBeenCalled();
		expect(params.onZoomAdded).not.toHaveBeenCalled();
	});

	it("keeps manual placement usable when current-source telemetry is missing", () => {
		const { actions, params } = setup({ cursorTelemetry: [] });
		actions.handleSuggestZooms();
		expect(params.onZoomSuggested).not.toHaveBeenCalled();
		actions.addZoomAtMs(1000);
		expect(params.onZoomAdded).toHaveBeenCalledWith({
			start: 1000,
			end: 1000 + DEFAULT_ZOOM_BLOCK_DURATION_MS,
		});
	});

	it("suggests from usable current-source telemetry once it is available", () => {
		const { actions, params } = setup();
		actions.handleSuggestZooms();
		expect(params.onZoomSuggested).toHaveBeenCalledOnce();
	});
});
