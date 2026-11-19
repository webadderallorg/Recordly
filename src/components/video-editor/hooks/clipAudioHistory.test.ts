import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZoomRegion } from "../types";
import type { SourceAudioTrackSettings } from "../audio/audioTypes";
import { useSourceAudioTrackSettings } from "../audio/useSourceAudioTrackSettings";
import { useTimelineState } from "../state/useTimelineState";
import { useClipRegionCommands } from "./useClipRegionCommands";
import { useEditorHistory } from "./useEditorHistory";

// Exercise the hooks together, including dependency changes, batched state, and
// effects, without mounting the editor's canvas or requiring a browser runtime.
const hooks = vi.hoisted(() => {
	const slots: unknown[] = [];
	let cursor = 0;
	let effects: (() => void)[] = [];
	let dirty = false;
	function memo<T>(factory: () => T, deps: readonly unknown[]): T {
		const index = cursor++;
		const previous = slots[index] as { deps: readonly unknown[]; value: T } | undefined;
		if (
			previous &&
			deps.length === previous.deps.length &&
			deps.every((value, i) => Object.is(value, previous.deps[i]))
		)
			return previous.value;
		const value = factory();
		slots[index] = { deps, value };
		return value;
	}
	return {
		reset: () => {
			slots.length = 0;
			cursor = 0;
			effects = [];
			dirty = false;
		},
		render<T>(factory: () => T): T {
			let result: T;
			do {
				dirty = false;
				cursor = 0;
				effects = [];
				result = factory();
				for (const effect of effects) effect();
			} while (dirty);
			return result;
		},
		useMemo: memo,
		useCallback: <T>(callback: T, deps: readonly unknown[]) => memo(() => callback, deps),
		useEffect: (effect: () => void, deps: readonly unknown[]) =>
			memo(() => {
				effects.push(effect);
			}, deps),
		useRef<T>(current: T) {
			const index = cursor++;
			slots[index] ??= { current };
			return slots[index] as { current: T };
		},
		useState<T>(initial: T | (() => T)) {
			const index = cursor++;
			if (!slots[index]) {
				const state = {
					value: typeof initial === "function" ? (initial as () => T)() : initial,
					set: (update: T | ((previous: T) => T)) => {
						const next =
							typeof update === "function"
								? (update as (previous: T) => T)(state.value)
								: update;
						if (!Object.is(state.value, next)) {
							state.value = next;
							dirty = true;
						}
					},
				};
				slots[index] = state;
			}
			const state = slots[index] as {
				value: T;
				set: (update: T | ((previous: T) => T)) => void;
			};
			return [state.value, state.set] as const;
		},
	};
});

vi.mock("react", () => ({ ...hooks, default: hooks }));
vi.mock("@/components/ui/toast", () => ({ toast: { error: vi.fn() } }));

function setup(
	overrides: Record<string, SourceAudioTrackSettings> = {
		"clip-1": { mic: { volume: 0, normalize: true } },
	},
	zoomRegions: ZoomRegion[] = [],
	speed = 1,
) {
	const refs = {
		nextZoomIdRef: { current: zoomRegions.length + 1 },
		nextClipIdRef: { current: 2 },
		nextAnnotationIdRef: { current: 1 },
		nextAudioIdRef: { current: 1 },
		nextAnnotationZIndexRef: { current: 1 },
	};
	const render = () =>
		hooks.render(() => {
			const timeline = useTimelineState();
			const history = useEditorHistory({ timeline, ...refs });
			const clips = useClipRegionCommands({
				...timeline,
				sourceDurationMs: 4000,
				setActiveEffectSection: vi.fn(),
				nextClipIdRef: refs.nextClipIdRef,
				nextZoomIdRef: refs.nextZoomIdRef,
				t: (key) => key,
			});
			const audio = useSourceAudioTrackSettings({
				...timeline,
				activeClipId: timeline.selectedClipId,
			});
			return { timeline, history, clips, audio };
		});
	// Load the timeline before mounting history, matching a loaded baseline.
	const initial = hooks.render(useTimelineState);
	initial.setClipRegions([{ id: "clip-1", startMs: 0, endMs: 4000, speed }]);
	initial.setZoomRegions(zoomRegions);
	initial.setSelectedClipId("clip-1");
	initial.setSourceAudioTrackSettingsByClip(overrides);
	initial.setDefaultSourceAudioTrackSettings({ mic: { volume: 1, normalize: false } });
	render();
	return render;
}

beforeEach(() => {
	hooks.reset();
	vi.stubGlobal("document", { activeElement: null });
});
afterEach(() => vi.unstubAllGlobals());

describe("clip source audio editing history", () => {
	it("preserves silent source tracks in both split halves through undo and redo", () => {
		const render = setup();
		render().clips.handleClipSplit(2000);
		const split = render();
		expect(split.timeline.clipRegions.map(({ id }) => id)).toEqual(["clip-2", "clip-3"]);
		for (const clip of split.timeline.clipRegions) {
			expect(split.audio.getSourceAudioTrackSettingsForClip(clip.id).mic).toEqual({
				volume: 0,
				normalize: true,
			});
		}
		expect(split.timeline.sourceAudioTrackSettingsByClip["clip-1"]).toBeUndefined();
		split.history.handleUndo();
		const undone = render();
		expect(undone.timeline.clipRegions.map(({ id }) => id)).toEqual(["clip-1"]);
		expect(Object.keys(undone.timeline.sourceAudioTrackSettingsByClip)).toEqual(["clip-1"]);
		expect(undone.audio.getSourceAudioTrackSettingsForClip("clip-1").mic.volume).toBe(0);
		undone.history.handleRedo();
		const redone = render();
		expect(redone.timeline.clipRegions).toEqual(split.timeline.clipRegions);
		expect(redone.timeline.sourceAudioTrackSettingsByClip).toEqual(
			split.timeline.sourceAudioTrackSettingsByClip,
		);
		expect(redone.history.canRedo).toBe(false);
	});

	it("records source volume and normalization edits as separate undoable changes", () => {
		const render = setup({});
		expect(render().history.canUndo).toBe(false);
		render().audio.onSelectedClipSourceAudioTrackVolumeChange("mic", 0);
		const silent = render();
		expect(silent.history.canUndo).toBe(true);
		silent.audio.onSelectedClipSourceAudioTrackNormalizeChange("mic", true);
		const normalized = render();
		expect(normalized.audio.selectedClipSourceAudioTrackSettings.mic).toEqual({
			volume: 0,
			normalize: true,
		});
		normalized.history.handleUndo();
		const undoneNormalize = render();
		expect(undoneNormalize.audio.selectedClipSourceAudioTrackSettings.mic).toEqual({
			volume: 0,
			normalize: false,
		});
		undoneNormalize.history.handleUndo();
		const undoneVolume = render();
		expect(undoneVolume.audio.selectedClipSourceAudioTrackSettings.mic).toEqual({
			volume: 1,
			normalize: false,
		});
		expect(undoneVolume.history.canUndo).toBe(false);
		undoneVolume.history.handleRedo();
		render().history.handleRedo();
		expect(render().audio.selectedClipSourceAudioTrackSettings.mic).toEqual({
			volume: 0,
			normalize: true,
		});
	});

	it("restores default source settings with undo and redo", () => {
		const render = setup({});
		render().timeline.setDefaultSourceAudioTrackSettings({
			mic: { volume: 0.4, normalize: true },
		});
		const changed = render();
		expect(changed.audio.selectedClipSourceAudioTrackSettings.mic.volume).toBe(0.4);
		changed.history.handleUndo();
		const undone = render();
		expect(undone.timeline.defaultSourceAudioTrackSettings.mic).toEqual({
			volume: 1,
			normalize: false,
		});
		undone.history.handleRedo();
		expect(render().timeline.defaultSourceAudioTrackSettings.mic).toEqual({
			volume: 0.4,
			normalize: true,
		});
	});

	it("does not reuse abandoned split settings when undo reuses clip IDs", () => {
		const render = setup({});
		render().clips.handleClipSplit(2000);
		render().audio.onSelectedClipSourceAudioTrackVolumeChange("mic", 0);
		render().history.handleUndo(); // Volume edit.
		render().history.handleUndo(); // Split.
		const original = render();
		expect(original.timeline.sourceAudioTrackSettingsByClip).toEqual({});
		original.clips.handleClipSplit(1000);
		const replacement = render();
		expect(replacement.timeline.clipRegions.map(({ id }) => id)).toEqual(["clip-2", "clip-3"]);
		for (const clip of replacement.timeline.clipRegions) {
			expect(replacement.audio.getSourceAudioTrackSettingsForClip(clip.id).mic.volume).toBe(
				1,
			);
		}
		expect(replacement.history.canRedo).toBe(false);
	});

	it("removes deleted source settings through undo and redo before reusing an ID", () => {
		const render = setup({
			"clip-2": { mic: { volume: 0, normalize: true } },
		});
		const initial = render();
		initial.timeline.setClipRegions([
			{ id: "clip-1", startMs: 0, endMs: 2000, speed: 1 },
			{ id: "clip-2", startMs: 2000, endMs: 4000, speed: 1 },
		]);
		render().clips.handleClipDelete("clip-2");
		const deleted = render();
		expect(deleted.timeline.sourceAudioTrackSettingsByClip).toEqual({});
		deleted.history.handleUndo();
		const undone = render();
		expect(undone.audio.getSourceAudioTrackSettingsForClip("clip-2").mic).toEqual({
			volume: 0,
			normalize: true,
		});
		undone.history.handleRedo();
		const redone = render();
		expect(redone.timeline.sourceAudioTrackSettingsByClip).toEqual({});
		// Recording imports allocate the next clip ID and use the existing map.
		redone.timeline.setClipRegions([
			...redone.timeline.clipRegions,
			{ id: "clip-2", startMs: 2000, endMs: 4000, speed: 1 },
		]);
		const imported = render();
		expect(imported.audio.getSourceAudioTrackSettingsForClip("clip-2").mic).toEqual({
			volume: 1,
			normalize: false,
		});
	});
});

describe("clip and zoom splitting history", () => {
	const zoom: ZoomRegion = {
		id: "zoom-1",
		startMs: 500,
		endMs: 3500,
		depth: 3,
		focus: { cx: 0.4, cy: 0.6 },
		focusSpace: "source",
		mode: "auto",
	};

	it.each([
		null,
		"other",
	])("selects the split half for the next delete when the previous clip selection is %s", (selectedClipId) => {
		const render = setup({});
		const initial = render();
		initial.timeline.setClipRegions([
			{ id: "other", startMs: 0, endMs: 1000, speed: 1 },
			{ id: "clip-1", startMs: 1000, endMs: 4000, speed: 1 },
		]);
		initial.timeline.setSelectedClipId(selectedClipId);
		initial.timeline.setSelectedZoomId("zoom-selected");
		initial.timeline.setSelectedAnnotationId("annotation-selected");
		initial.timeline.setSelectedAudioId("audio-selected");
		initial.timeline.setSelectedCaptionId("caption-selected");
		render().clips.handleClipSplit(2500);
		const split = render();
		expect(split.timeline.selectedClipId).toBe("clip-2");
		expect(split.timeline.selectedZoomId).toBeNull();
		expect(split.timeline.selectedAnnotationId).toBeNull();
		expect(split.timeline.selectedAudioId).toBeNull();
		expect(split.timeline.selectedCaptionId).toBeNull();
		// The delete shortcut consumes the active clip ID, so it must target the new half.
		split.clips.handleClipDelete(split.timeline.selectedClipId!);
		expect(render().timeline.clipRegions.map(({ id }) => id)).toEqual(["other", "clip-3"]);
	});

	it.each([
		"auto",
		"manual",
	] as const)("splits %s zooms at timeline time and undoes both changes together", (mode) => {
		const original = { ...zoom, mode };
		const render = setup({}, [original], 2);
		render().clips.handleClipSplit(2000.4);
		const split = render();
		expect(split.timeline.zoomRegions).toEqual([
			{ ...original, endMs: 2000 },
			{ ...original, id: "zoom-2", startMs: 2000 },
		]);
		expect(split.timeline.clipRegions[1]).toMatchObject({ startMs: 2000, sourceStartMs: 4000 });
		split.history.handleUndo();
		const undone = render();
		expect(undone.timeline.clipRegions).toHaveLength(1);
		expect(undone.timeline.zoomRegions).toEqual([original]);
		expect(undone.history.canUndo).toBe(false);
		undone.history.handleRedo();
		const redone = render();
		expect(redone.timeline.clipRegions).toEqual(split.timeline.clipRegions);
		expect(redone.timeline.zoomRegions).toEqual(split.timeline.zoomRegions);
	});

	it("leaves zooms outside the cut and zooms touching its boundary unchanged", () => {
		const zooms = [
			{ ...zoom, endMs: 2000 },
			{ ...zoom, id: "zoom-2", startMs: 2000 },
		];
		const render = setup({}, zooms);
		render().clips.handleClipSplit(2000);
		const split = render();
		expect(split.timeline.clipRegions).toHaveLength(2);
		expect(split.timeline.zoomRegions).toBe(zooms);
	});

	it("does not split zooms when the clip cannot be split", () => {
		const original = { ...zoom, startMs: -100, endMs: 5000 };
		const render = setup({}, [original]);
		for (const at of [0, 4000, -1, 4500, Number.NaN, Number.POSITIVE_INFINITY]) {
			render().clips.handleClipSplit(at);
			expect(render().timeline.zoomRegions).toEqual([original]);
			expect(render().history.canUndo).toBe(false);
		}
	});

	it("keeps short zoom halves exact and allocates distinct IDs on repeated cuts after undo", () => {
		const render = setup({}, [zoom]);
		render().clips.handleClipSplit(501);
		const first = render();
		expect(first.timeline.zoomRegions[0]).toEqual({ ...zoom, endMs: 501 });
		first.clips.handleClipSplit(2000);
		const second = render();
		expect(second.timeline.zoomRegions.map(({ id }) => id)).toEqual([
			"zoom-1",
			"zoom-2",
			"zoom-3",
		]);
		second.history.handleUndo();
		render().clips.handleClipSplit(3000);
		const replacement = render();
		expect(replacement.timeline.zoomRegions).toEqual([
			{ ...zoom, endMs: 501 },
			{ ...zoom, id: "zoom-2", startMs: 501, endMs: 3000 },
			{ ...zoom, id: "zoom-3", startMs: 3000 },
		]);
		replacement.clips.handleClipDelete(replacement.timeline.clipRegions[1].id);
		expect(render().timeline.zoomRegions.map(({ startMs, endMs }) => [startMs, endMs])).toEqual(
			[
				[500, 501],
				[501, 1001],
			],
		);
	});
});
