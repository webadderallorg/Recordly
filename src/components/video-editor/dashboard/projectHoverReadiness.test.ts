import { describe, expect, it, vi } from "vitest";
import type { ProjectPreviewData } from "@/types/projectPreview";
import { ProjectHoverPreview } from "./ProjectHoverPreview";
import { createHoverCompositionGate, type HoverCompositionStatus } from "./projectHoverReadiness";

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useMemo: (create: () => unknown) => create(),
}));
vi.mock("../VideoPlayback", () => ({ default: () => null }));

function setup() {
	const status: HoverCompositionStatus = {
		prerequisitesReady: false,
		canRetain: true,
		frameValid: true,
		key: "source:640x360",
		revision: 1,
	};
	const requestComposition = vi.fn();
	const onVisibilityChange = vi.fn();
	const gate = createHoverCompositionGate({
		read: () => status,
		requestComposition,
		onVisibilityChange,
	});
	return { status, gate, requestComposition, onVisibilityChange };
}
describe("hover composition loading", () => {
	it("never exposes the early main frame while another composition resource is loading", () => {
		const s = setup();
		s.gate.postrender();
		expect(s.onVisibilityChange.mock.calls).toEqual([[false]]);
		s.status.prerequisitesReady = true;
		s.gate.refresh();
		expect(s.requestComposition).toHaveBeenCalledOnce();
		s.gate.postrender(); // A resize/render of the old frame cannot satisfy the gate.
		expect(s.onVisibilityChange.mock.calls).toEqual([[false]]);
		s.status.revision++;
		s.gate.postrender();
		expect(s.onVisibilityChange.mock.calls).toEqual([[false], [true]]);
	});
	it("waits for the corrected viewport rather than a frame composed at fallback geometry", () => {
		const s = setup();
		s.status.prerequisitesReady = true;
		s.status.canRetain = false;
		s.gate.refresh();
		s.status.revision++;
		s.gate.postrender();
		expect(s.onVisibilityChange.mock.calls).toEqual([[false]]);
		expect(s.requestComposition).toHaveBeenCalledTimes(2);
		s.status.canRetain = true;
		s.status.revision++;
		s.gate.postrender();
		expect(s.onVisibilityChange).toHaveBeenLastCalledWith(true);
	});
	it("holds an already complete frame during decoder seeks but hides invalid geometry", () => {
		const s = setup();
		s.status.prerequisitesReady = true;
		s.gate.refresh();
		s.status.revision++;
		s.gate.postrender();
		s.status.frameValid = false;
		s.gate.postrender();
		expect(s.onVisibilityChange.mock.calls).toEqual([[false], [true]]);
		s.status.key = "source:360x640";
		s.status.canRetain = false;
		s.gate.postrender();
		expect(s.onVisibilityChange).toHaveBeenLastCalledWith(false);
		s.status.canRetain = true;
		s.status.frameValid = true;
		s.gate.postrender();
		expect(s.onVisibilityChange).toHaveBeenLastCalledWith(false);
		s.status.revision++;
		s.gate.postrender();
		expect(s.onVisibilityChange).toHaveBeenLastCalledWith(true);
	});
	it("rejects a late completion after hover exit and requires a fresh frame for new resources", () => {
		const s = setup();
		s.status.prerequisitesReady = true;
		s.gate.refresh();
		s.status.revision++;
		s.gate.postrender();
		s.status.prerequisitesReady = false;
		s.gate.refresh();
		expect(s.onVisibilityChange).toHaveBeenLastCalledWith(false);
		s.status.prerequisitesReady = true;
		s.gate.refresh();
		s.gate.postrender();
		expect(s.onVisibilityChange).toHaveBeenLastCalledWith(false);
		s.gate.dispose();
		s.status.revision++;
		s.gate.postrender();
		s.gate.refresh();
		expect(s.onVisibilityChange.mock.calls).toEqual([[false], [true], [false]]);
	});
	it("requests a fresh paused composition when a secondary decoder settles after the last draw", () => {
		const s = setup();
		s.status.prerequisitesReady = true;
		s.status.frameValid = false;
		s.gate.refresh();
		s.status.revision++;
		s.gate.postrender();
		expect(s.onVisibilityChange.mock.calls).toEqual([[false]]);
		s.status.frameValid = true;
		s.gate.refresh();
		expect(s.requestComposition).toHaveBeenCalledTimes(2);
		s.gate.refresh(); // Repeated settled notifications cannot queue duplicate draws.
		expect(s.requestComposition).toHaveBeenCalledTimes(2);
		s.gate.postrender();
		expect(s.onVisibilityChange.mock.calls).toEqual([[false]]);
		s.status.revision++;
		s.gate.postrender();
		expect(s.onVisibilityChange).toHaveBeenLastCalledWith(true);
		s.gate.refresh();
		expect(s.requestComposition).toHaveBeenCalledTimes(2);
	});
});

function previewData(): ProjectPreviewData {
	return {
		videoUrl: "http://localhost/media/source.mp4",
		webcamUrl: null,
		revision: "saved-revision-1",
		project: { version: 1, videoPath: "/recordings/source.mp4", editor: { backgroundBlur: 0 } },
	};
}
const previewKey = (data: ProjectPreviewData) =>
	ProjectHoverPreview({ data, onFinish: () => undefined }).key;

describe("hover preview session identity", () => {
	it("does not traverse or retain multi-megabyte inline images in its session key", () => {
		const data = previewData();
		const content = "data:image/png;base64," + "A".repeat(8 * 1024 * 1024);
		const readContent = vi.fn(() => content);
		data.project.editor.annotationRegions = [
			{
				id: "later-image",
				type: "image",
				startMs: 6000,
				endMs: 9000,
				get content() {
					return readContent();
				},
			} as NonNullable<typeof data.project.editor.annotationRegions>[number],
		];
		const key = previewKey(data);
		expect(readContent).not.toHaveBeenCalled();
		expect(key).not.toBeNull();
		expect(key!.length).toBeLessThan(512);
		expect(key).not.toContain("data:image");
	});

	it("keeps the key bounded regardless of inline image size", () => {
		const data = previewData();
		data.project.editor.annotationRegions = [
			{
				id: "later-image",
				type: "image",
				startMs: 6000,
				endMs: 9000,
				content: "data:image/png;base64," + "A".repeat(8 * 1024 * 1024),
			} as NonNullable<typeof data.project.editor.annotationRegions>[number],
		];
		expect(previewKey(data)!.length).toBeLessThan(512);
	});

	it("keeps the same immutable metadata stable across ordinary parent rerenders", () => {
		const data = previewData();
		const key = previewKey(data);
		for (let count = 0; count < 5; count++) expect(previewKey(data)).toBe(key);
		// ProjectThumbnail stores the IPC object as-is; even a new wrapper around
		// the same immutable editor/source must not create a new session.
		expect(previewKey({ ...data, project: { ...data.project } })).toBe(key);
	});

	it.each([
		[
			"video URL",
			(data: ProjectPreviewData) => ({ ...data, videoUrl: "http://localhost/media/new.mp4" }),
		],
		[
			"webcam URL",
			(data: ProjectPreviewData) => ({
				...data,
				webcamUrl: "http://localhost/media/camera.mp4",
			}),
		],
		[
			"saved revision",
			(data: ProjectPreviewData) => ({ ...data, revision: "saved-revision-2" }),
		],
		[
			"video source path",
			(data: ProjectPreviewData) => ({
				...data,
				project: { ...data.project, videoPath: "/recordings/new.mp4" },
			}),
		],
	] as const)("starts a new session when the %s changes", (_label, change) => {
		const data = previewData();
		expect(previewKey(change(data))).not.toBe(previewKey(data));
	});

	it.each([
		"saved-revision-1",
		undefined,
	])("resets for an immutable composition edit even with revision %s", (revision) => {
		const data = { ...previewData(), revision };
		const changed = {
			...data,
			project: { ...data.project, editor: { ...data.project.editor, backgroundBlur: 20 } },
		};
		expect(previewKey(changed)).not.toBe(previewKey(data));
		expect(previewKey(changed)).toBe(previewKey(changed));
	});
});
