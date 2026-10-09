import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorProjectData } from "../../projectPersistence";
import { projectOps } from "./project";
import type { EditorOpContext, EditorProjectHooks } from "./types";

const editor = {
	wallpaper: "aurora",
	padding: 12,
	borderRadius: 8,
	shadowIntensity: 0.4,
	backgroundBlur: 2,
	clipRegions: [{ id: "clip-1", startMs: 0, endMs: 10_000, speed: 1 }],
	zoomRegions: [{ id: "zoom-1" }, { id: "zoom-2" }],
	annotationRegions: [{ id: "annotation-1", zIndex: 1 }],
	autoCaptions: [1, 2, 3].map((n) => ({
		id: `c${n}`,
		startMs: n * 1000,
		endMs: n * 1000 + 500,
		text: `line ${n}`,
	})),
};
const snapshot = { version: 2, videoPath: "/rec/a.mp4", editor } as unknown as EditorProjectData;

function makeContext(over: Partial<EditorProjectHooks> = {}, duration = 10) {
	const calls = { cleared: [] as string[], clips: null as unknown, detached: 0, saved: 0 };
	const project: EditorProjectHooks = {
		snapshot,
		hasUnsavedChanges: false,
		isExporting: false,
		applyLoaded: vi.fn(async () => true),
		markSaved: vi.fn(() => {
			calls.saved += 1;
		}),
		detach: () => {
			calls.detached += 1;
		},
		...over,
	};
	const clear = (name: string) => () => calls.cleared.push(name);
	const context = {
		duration,
		videoSourcePath: "/rec/a.mp4",
		timeline: {
			clipRegions: editor.clipRegions,
			zoomRegions: editor.zoomRegions,
			annotationRegions: [],
			autoCaptions: [],
			audioRegions: [],
			speedRegions: [],
			setZoomRegions: clear("zoom"),
			setTrimRegions: clear("trim"),
			setSpeedRegions: clear("speed"),
			setAnnotationRegions: clear("annotation"),
			setAudioRegions: clear("audio"),
			setAutoCaptions: clear("captions"),
			setClipRegions: (next: unknown) => {
				calls.clips = next;
			},
			setSelectedZoomId: () => undefined,
			setSelectedClipId: () => undefined,
			setSelectedAnnotationId: () => undefined,
			setSelectedAudioId: () => undefined,
		},
		ids: { clip: { current: 5 } },
		project,
	} as unknown as EditorOpContext;
	return { context, project, calls };
}

const api = {
	saveProjectFileNamed: vi.fn(),
	openProjectFileAtPath: vi.fn(),
	getProjectsDirectory: vi.fn(),
};

type Result = {
	counts: Record<string, number>;
	look: Record<string, unknown>;
	videoChanged: boolean;
	videoPath: string;
	undoable: boolean;
	cleared: Record<string, number>;
};

const run = (op: string, payload: unknown, context: EditorOpContext) =>
	Promise.resolve().then(() => projectOps[op](payload, context)) as Promise<Result>;

beforeEach(() => {
	for (const fn of Object.values(api)) fn.mockReset();
	api.saveProjectFileNamed.mockResolvedValue({
		success: true,
		path: "/projects/Demo.recordly",
		projectId: "p1",
	});
	api.getProjectsDirectory.mockResolvedValue({ success: true, path: "/projects" });
	api.openProjectFileAtPath.mockResolvedValue({
		success: true,
		path: "/projects/Demo.recordly",
		project: snapshot,
	});
	vi.stubGlobal("window", { electronAPI: api });
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("project.save", () => {
	it("writes the snapshot under the name and reports what went in, look included", async () => {
		const { context, project } = makeContext();
		const result = await run("project.save", { name: " Demo " }, context);
		expect(api.saveProjectFileNamed).toHaveBeenCalledWith(snapshot, "Demo", null, "copy");
		expect(project.markSaved).toHaveBeenCalledWith({
			path: "/projects/Demo.recordly",
			projectId: "p1",
		});
		expect(result.counts).toMatchObject({ clips: 1, zooms: 2, annotations: 1, captions: 3 });
		expect(result.look).toMatchObject({ wallpaper: "aurora", padding: 12 });
	});

	it.each([
		"",
		"   ",
		"../escape",
		"a/b",
		"a\\b",
		"..",
		"x".repeat(101),
		"bad|name",
		"ends.",
	])("refuses the name %j before touching disk", async (name) => {
		const { context } = makeContext();
		await expect(run("project.save", { name }, context)).rejects.toThrow(/name/);
		expect(api.saveProjectFileNamed).not.toHaveBeenCalled();
	});

	it("refuses unknown fields and a path", async () => {
		const { context } = makeContext();
		await expect(
			run("project.save", { name: "x", path: "/tmp/x.recordly" }, context),
		).rejects.toThrow(/unknown field path/);
	});

	it("refuses when no recording is loaded", async () => {
		const { context } = makeContext({ snapshot: null });
		await expect(run("project.save", { name: "x" }, context)).rejects.toThrow(/no recording/);
		expect(api.saveProjectFileNamed).not.toHaveBeenCalled();
	});

	it("passes on the refusal to overwrite another project and does not mark saved", async () => {
		api.saveProjectFileNamed.mockResolvedValue({
			success: false,
			message: "A different project already uses this name.",
		});
		const { context, project } = makeContext();
		await expect(run("project.save", { name: "Demo" }, context)).rejects.toThrow(
			/different project already uses this name/,
		);
		expect(project.markSaved).not.toHaveBeenCalled();
	});

	it("times out instead of hanging when the write never settles", async () => {
		vi.useFakeTimers();
		api.saveProjectFileNamed.mockReturnValue(new Promise(() => undefined));
		const { context } = makeContext();
		const pending = run("project.save", { name: "Demo" }, context);
		const assertion = expect(pending).rejects.toThrow(
			/Timed out after 15 seconds waiting for the project file/,
		);
		await vi.advanceTimersByTimeAsync(15_000);
		await assertion;
	});
});

describe("project.open", () => {
	it("opens by name from the projects folder, applies it and reports counts", async () => {
		const { context, project } = makeContext();
		const result = await run("project.open", { name: "Demo" }, context);
		expect(api.openProjectFileAtPath).toHaveBeenCalledWith("/projects/Demo.recordly");
		expect(project.applyLoaded).toHaveBeenCalledWith(snapshot, "/projects/Demo.recordly");
		expect(result.counts).toMatchObject({ clips: 1, zooms: 2, annotations: 1, captions: 3 });
		expect(result.videoChanged).toBe(false);
	});

	it("says when the project belongs to a different recording", async () => {
		api.openProjectFileAtPath.mockResolvedValue({
			success: true,
			path: "/p/o.recordly",
			project: { ...snapshot, videoPath: "/rec/b.mp4" },
		});
		const { context } = makeContext();
		const result = await run("project.open", { path: "/p/o.recordly" }, context);
		expect(result).toMatchObject({ videoChanged: true, videoPath: "/rec/b.mp4" });
	});

	it("refuses to replace unsaved changes unless discard is true", async () => {
		const { context, project } = makeContext({ hasUnsavedChanges: true });
		await expect(run("project.open", { name: "Demo" }, context)).rejects.toThrow(/not saved/);
		expect(api.openProjectFileAtPath).not.toHaveBeenCalled();
		await run("project.open", { name: "Demo", discard: true }, context);
		expect(project.applyLoaded).toHaveBeenCalled();
	});

	it("refuses while an export is running", async () => {
		const { context } = makeContext({ isExporting: true });
		await expect(run("project.open", { name: "Demo" }, context)).rejects.toThrow(/export/);
		expect(api.openProjectFileAtPath).not.toHaveBeenCalled();
	});

	it.each([
		[{}, /exactly one/],
		[{ name: "a", path: "/p/a.recordly" }, /exactly one/],
		[{ path: "relative/a.recordly" }, /absolute/],
		[{ path: "/p/a.json" }, /not a Recordly project/],
		[{ name: "../x" }, /cannot be used/],
	])("rejects %j before reading anything", async (args, message) => {
		const { context } = makeContext();
		await expect(run("project.open", args, context)).rejects.toThrow(message);
		expect(api.openProjectFileAtPath).not.toHaveBeenCalled();
	});

	it("reports a corrupt file and leaves the editor alone", async () => {
		api.openProjectFileAtPath.mockResolvedValue({
			success: false,
			message: "Failed to read project file: Unexpected end of JSON input",
		});
		const { context, project } = makeContext();
		await expect(run("project.open", { name: "Demo" }, context)).rejects.toThrow(
			/Unexpected end of JSON input.*editor was not changed/,
		);
		expect(project.applyLoaded).not.toHaveBeenCalled();
	});

	it.each([
		[
			"missing",
			"Project video file not found: /rec/a.mp4",
			/video file not found: \/rec\/a\.mp4\. The editor was not changed/,
		],
		[
			"empty",
			"Project video file is empty (0 bytes): /rec/a.mp4",
			/is empty \(0 bytes\).*editor was not changed/,
		],
		[
			"not-a-file",
			"Project video is not a file: /rec/a.mp4",
			/not a file.*editor was not changed/,
		],
	])("keeps a %s project video distinct and leaves the editor alone", async (reason, message, expected) => {
		api.openProjectFileAtPath.mockResolvedValue({ success: false, reason, message });
		const { context, project } = makeContext();
		await expect(run("project.open", { name: "Demo" }, context)).rejects.toThrow(expected);
		expect(project.applyLoaded).not.toHaveBeenCalled();
	});

	it("refuses a file that parses but is not a project", async () => {
		api.openProjectFileAtPath.mockResolvedValue({ success: true, project: { hello: 1 } });
		const { context, project } = makeContext();
		await expect(run("project.open", { name: "Demo" }, context)).rejects.toThrow(
			/not a Recordly project/,
		);
		expect(project.applyLoaded).not.toHaveBeenCalled();
	});

	it("fails loudly when the editor cannot apply the project", async () => {
		const { context } = makeContext({ applyLoaded: vi.fn(async () => false) });
		await expect(run("project.open", { name: "Demo" }, context)).rejects.toThrow(
			/could not be applied/,
		);
	});
});

describe("project.new", () => {
	it("clears the edit to one full clip, detaches from the project and says it is undoable", async () => {
		const { context, calls } = makeContext();
		const result = await run("project.new", {}, context);
		expect(calls.cleared.sort()).toEqual(
			["annotation", "audio", "captions", "speed", "trim", "zoom"].sort(),
		);
		expect(calls.clips).toEqual([{ id: "clip-5", startMs: 0, endMs: 10_000, speed: 1 }]);
		expect(calls.detached).toBe(1);
		expect(result.undoable).toBe(true);
		expect(result.cleared).toMatchObject({ clips: 1, zooms: 2 });
	});

	it("changes nothing while exporting or before the recording has a duration", async () => {
		const busy = makeContext({ isExporting: true });
		await expect(run("project.new", {}, busy.context)).rejects.toThrow(/export/);
		const unloaded = makeContext({}, 0);
		await expect(run("project.new", {}, unloaded.context)).rejects.toThrow(/finished loading/);
		expect(busy.calls.cleared).toEqual([]);
		expect(unloaded.calls.detached).toBe(0);
	});
});
