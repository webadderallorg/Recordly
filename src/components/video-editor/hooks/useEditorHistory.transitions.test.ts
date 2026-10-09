import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClipTransition } from "../export/editorOps/transitions";

const refs: { current: unknown }[] = [];
let refCursor = 0;
let effects: (() => void)[] = [];

vi.mock("react", () => ({
	useRef: (initial: unknown) => {
		const existing = refs[refCursor];
		if (existing) {
			refCursor++;
			return existing;
		}
		const created = { current: initial };
		refs[refCursor++] = created;
		return created;
	},
	useState: (initial: unknown) => [initial, vi.fn()],
	useCallback: (callback: unknown) => callback,
	useEffect: (effect: () => void) => {
		effects.push(effect);
	},
}));

import { useEditorHistory } from "./useEditorHistory";

const dip: ClipTransition = { id: "dip-clip-2", kind: "dip", ms: 400, afterClipId: "clip-2" };

function timelineState(transitions: ClipTransition[], setTransitions: (next: unknown) => void) {
	return {
		zoomRegions: [],
		clipRegions: [{ id: "clip-1", startMs: 0, endMs: 9000, speed: 1 }],
		transitions,
		speedRegions: [],
		annotationRegions: [],
		audioRegions: [],
		autoCaptions: [],
		selectedZoomId: null,
		selectedClipId: null,
		selectedAnnotationId: null,
		selectedAudioId: null,
		setZoomRegions: vi.fn(),
		setClipRegions: vi.fn(),
		setTransitions,
		setSpeedRegions: vi.fn(),
		setAnnotationRegions: vi.fn(),
		setAudioRegions: vi.fn(),
		setAutoCaptions: vi.fn(),
		setSelectedZoomId: vi.fn(),
		setSelectedClipId: vi.fn(),
		setSelectedAnnotationId: vi.fn(),
		setSelectedAudioId: vi.fn(),
	};
}

function render(transitions: ClipTransition[], setTransitions: (next: unknown) => void) {
	refCursor = 0;
	effects = [];
	const result = useEditorHistory({
		timeline: timelineState(transitions, setTransitions) as never,
		nextZoomIdRef: { current: 1 },
		nextClipIdRef: { current: 1 },
		nextAnnotationIdRef: { current: 1 },
		nextAudioIdRef: { current: 1 },
		nextAnnotationZIndexRef: { current: 1 },
	});
	for (const effect of effects) effect();
	return result;
}

describe("useEditorHistory with transitions", () => {
	beforeEach(() => {
		refs.length = 0;
		refCursor = 0;
		effects = [];
	});

	it("puts a dip back in the timeline on undo", () => {
		const setTransitions = vi.fn();
		render([], setTransitions);
		const history = render([dip], setTransitions);
		history.handleUndo();
		expect(setTransitions).toHaveBeenCalledWith([]);
	});

	it("restores the dip again on redo", () => {
		const setTransitions = vi.fn();
		render([], setTransitions);
		const added = render([dip], setTransitions);
		added.handleUndo();
		setTransitions.mockClear();
		const back = render([], setTransitions);
		back.handleRedo();
		expect(setTransitions).toHaveBeenCalledWith([dip]);
	});

	it("banks an undo step for the dip and nothing for an unchanged re-render", () => {
		const setTransitions = vi.fn();
		const stack = () => (refs[0].current as { past: unknown[] }).past;
		render([], setTransitions);
		expect(stack()).toHaveLength(0);
		render([dip], setTransitions);
		expect(stack()).toHaveLength(1);
		render([dip], setTransitions);
		expect(stack()).toHaveLength(1);
	});

	it("falls back to an empty list for a snapshot saved before transitions existed", () => {
		const setTransitions = vi.fn();
		render([], setTransitions);
		const history = render([dip], setTransitions);
		(refs[0].current as { past: unknown[] }).past = [
			{
				zoomRegions: [],
				clipRegions: [],
				speedRegions: [],
				annotationRegions: [],
				audioRegions: [],
				autoCaptions: [],
				selectedZoomId: null,
				selectedClipId: null,
				selectedAnnotationId: null,
				selectedAudioId: null,
			},
		];
		history.handleUndo();
		expect(setTransitions).toHaveBeenCalledWith([]);
	});
});
