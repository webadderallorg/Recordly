import { describe, expect, it } from "vitest";
import { projectEditorState, requireClipDetail, requireSections } from "./editorStateView";

const state = () => ({
	videoPath: "/tmp/take.mp4",
	durationMs: 115_700,
	sourceDurationMs: 176_000,
	clips: [
		{ id: "c1", startMs: 0, endMs: 1_000, speed: 1 },
		{ id: "c2", startMs: 2_000, endMs: 5_000, speed: 2 },
	],
	zooms: [{ id: "z1" }],
	annotations: [{ id: "a1" }],
	audio: [{ id: "m1" }],
	captions: [{ text: "hello" }],
	captionSettings: { size: 2 },
	speeds: [{ id: "s1" }],
	sourceAudio: { status: "ready" },
	scenes: [{ index: 0 }],
	look: { padding: 4 },
	motion: { cursorSize: 1 },
	lookUndoable: false,
});

describe("projectEditorState", () => {
	it("returns every section when include is omitted", () => {
		const view = projectEditorState(state());
		expect(view.clips).toHaveLength(2);
		expect(view.zooms).toBeDefined();
		expect(view.captions).toBeDefined();
		expect(view.captionSettings).toBeDefined();
		expect(view.look).toBeDefined();
		expect(view.motion).toBeDefined();
		expect(view.omitted).toBeUndefined();
	});

	it("keeps only the named sections and says what it left out", () => {
		const view = projectEditorState(state(), { include: ["captions", "scenes"] });
		expect(view.captions).toBeDefined();
		expect(view.captionSettings).toBeDefined();
		expect(view.scenes).toBeDefined();
		expect(view.zooms).toBeUndefined();
		expect(view.motion).toBeUndefined();
		expect(view.clips).toBeUndefined();
		expect(view.omitted).toContain("motion");
		expect(view.omitted).toContain("clips");
	});

	it("always keeps the header fields a caller needs to orient itself", () => {
		const view = projectEditorState(state(), { include: ["look"] });
		expect(view.videoPath).toBe("/tmp/take.mp4");
		expect(view.durationMs).toBe(115_700);
		expect(view.sourceDurationMs).toBe(176_000);
	});

	it("summarises clips without listing them", () => {
		const view = projectEditorState(state(), { clips: "summary" });
		expect(view.clips).toMatchObject({ count: 2, keptSourceMs: 4_000, speedChanged: 1 });
		expect(JSON.stringify(view.clips)).not.toContain("c1");
	});

	it("drops clips entirely on none", () => {
		expect(projectEditorState(state(), { clips: "none" }).clips).toBeUndefined();
	});

	it("refuses an unknown section instead of ignoring it", () => {
		expect(() => projectEditorState(state(), { include: ["captions", "wallpaper"] })).toThrow(
			/unknown section "wallpaper"/,
		);
	});

	it("refuses an empty include rather than returning a bare header", () => {
		expect(() => projectEditorState(state(), { include: [] })).toThrow(/include was empty/);
	});

	it("refuses include that is not an array", () => {
		expect(() => projectEditorState(state(), { include: "captions" })).toThrow(
			/must be an array/,
		);
	});

	it("refuses an unknown clip detail", () => {
		expect(() => projectEditorState(state(), { clips: "brief" })).toThrow(
			/clips must be one of/,
		);
	});

	it("ignores a duplicate section", () => {
		const view = projectEditorState(state(), { include: ["look", "look"] });
		expect(view.look).toBeDefined();
	});

	it("survives a state missing optional sections", () => {
		const partial = { videoPath: "/tmp/a.mp4", durationMs: 1, sourceDurationMs: 1, clips: [] };
		const view = projectEditorState(partial);
		expect(view.clips).toEqual([]);
		expect(view.scenes).toBeUndefined();
	});

	it("counts a zero-length clip as keeping nothing", () => {
		const flat = { ...state(), clips: [{ id: "c1", startMs: 500, endMs: 500, speed: 1 }] };
		expect(projectEditorState(flat, { clips: "summary" }).clips).toMatchObject({
			count: 1,
			keptSourceMs: 0,
			speedChanged: 0,
		});
	});
});

describe("requireSections", () => {
	it("returns null when nothing was asked for", () => {
		expect(requireSections(undefined)).toBeNull();
	});
});

describe("requireClipDetail", () => {
	it("defaults to full", () => {
		expect(requireClipDetail(undefined)).toBe("full");
	});
});
