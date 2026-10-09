import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEditorState } from "./state";
import type { EditorOpContext } from "./types";

const clips = [{ id: "clip-1", startMs: 0, endMs: 10_000, sourceStartMs: 0, speed: 1 }];

function makeContext(): EditorOpContext {
	return {
		duration: 10,
		videoSourcePath: "/tmp/take.mp4",
		timeline: {
			clipRegions: clips,
			zoomRegions: [],
			annotationRegions: [],
			audioRegions: [],
			autoCaptions: [],
		},
		appearance: {
			wallpaper: "aurora",
			padding: 12,
			borderRadius: 8,
			shadowIntensity: 0.4,
			backgroundBlur: 2,
			cursorSize: 1.5,
			zoomInEasing: "glide",
			somethingElse: "ignored",
		},
		history: { undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false },
		ids: {
			zoom: { current: 1 },
			clip: { current: 1 },
			audio: { current: 1 },
			annotation: { current: 1 },
			annotationZIndex: { current: 1 },
		},
		assertSameRecording: () => undefined,
		adoptJoinedMedia: () => undefined,
	} as unknown as EditorOpContext;
}

describe("get_state", () => {
	beforeEach(() => {
		vi.stubGlobal("window", {
			electronAPI: {
				getAgentActivity: vi.fn(async () => ({
					success: true,
					log: {
						version: 1,
						spans: [],
						scenes: [
							{ startMs: 4000, endMs: 9000, failed: false, title: "Pay the run" },
							{ startMs: 0, endMs: 4000, failed: false, title: "Open payroll" },
						],
					},
				})),
			},
		});
	});

	it("reports the look and the motion settings, and leaves unrelated state out", async () => {
		const state = await getEditorState(makeContext());
		expect(state.look).toEqual({
			wallpaper: "aurora",
			padding: 12,
			borderRadius: 8,
			shadowIntensity: 0.4,
			backgroundBlur: 2,
		});
		expect(state.motion).toMatchObject({ cursorSize: 1.5, zoomInEasing: "glide" });
		expect(state.look).not.toHaveProperty("somethingElse");
		expect(state.motion).not.toHaveProperty("somethingElse");
		expect(state.lookUndoable).toBe(false);
	});

	it("reports scenes in edited time, in order, so a length budget can be checked", async () => {
		const state = await getEditorState(makeContext());
		expect(state.scenes).toEqual([
			{
				index: 0,
				title: "Open payroll",
				failed: false,
				startMs: 0,
				endMs: 4000,
				sourceStartMs: 0,
				sourceEndMs: 4000,
			},
			{
				index: 1,
				title: "Pay the run",
				failed: false,
				startMs: 4000,
				endMs: 9000,
				sourceStartMs: 4000,
				sourceEndMs: 9000,
			},
		]);
	});

	it("says why scenes are missing instead of failing the whole read", async () => {
		vi.stubGlobal("window", {
			electronAPI: {
				getAgentActivity: vi.fn(async () => ({ success: false, error: "no log here" })),
			},
		});
		const state = await getEditorState(makeContext());
		expect(state.scenes).toMatchObject({ unavailable: expect.stringContaining("no log here") });
		expect(state.durationMs).toBe(10_000);
	});
});
