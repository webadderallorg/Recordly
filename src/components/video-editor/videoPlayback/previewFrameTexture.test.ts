import { DOMAdapter, VideoSource } from "pixi.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SourceRedactionOptions } from "@/lib/exporter/sourceRedaction";
import { type AnnotationRegion, DEFAULT_ANNOTATION_STYLE } from "../types";
import { PreviewFrameTexture } from "./previewFrameTexture";

const originalAdapter = DOMAdapter.get();
beforeAll(() => {
	DOMAdapter.set({
		...originalAdapter,
		createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement,
	});
});
afterAll(() => DOMAdapter.set(originalAdapter));

const annotation: AnnotationRegion = {
	id: "private",
	type: "blur",
	startMs: 4_000,
	endMs: 5_000,
	content: "",
	position: { x: 20, y: 30 },
	size: { width: 40, height: 20 },
	style: DEFAULT_ANNOTATION_STYLE,
	zIndex: 1,
};
const cropRegion = { x: 0.2, y: 0.1, width: 0.6, height: 0.8 };
const options = { annotations: [annotation], timeMs: 4_500, cropRegion };

function setup() {
	const video = Object.assign(new EventTarget(), {
		videoWidth: 1920,
		videoHeight: 1080,
		width: 1920,
		height: 1080,
		readyState: 4,
		HAVE_ENOUGH_DATA: 4,
		HAVE_FUTURE_DATA: 3,
		paused: true,
		currentTime: 1.5,
		playbackRate: 1,
		play: vi.fn(),
		pause: vi.fn(),
		load: vi.fn(),
	}) as unknown as HTMLVideoElement;
	const source = new VideoSource({ resource: video, autoPlay: false, autoLoad: false });
	const canvas = { width: 1920, height: 1080 } as HTMLCanvasElement;
	const redaction = {
		render: vi.fn((_video: CanvasImageSource | VideoFrame, frame: SourceRedactionOptions) =>
			frame.timeMs >= annotation.startMs && frame.timeMs <= annotation.endMs ? canvas : null,
		),
		dispose: vi.fn(),
	};
	const owner = new PreviewFrameTexture(source, redaction);
	return { video, source, canvas, redaction, owner };
}

describe("PreviewFrameTexture", () => {
	it("uploads a redacted source at both output-timeline boundaries and restores raw video outside", () => {
		const { owner, source, video, canvas, redaction } = setup();
		expect(source.autoUpdate).toBe(false);
		const original = owner.update(video, { ...options, timeMs: 3_999 });
		expect(original.source).toBe(source);
		const active = owner.update(video, { ...options, timeMs: 4_000 });
		expect(active.source.resource).toBe(canvas);
		expect(active).not.toBe(original);
		expect(owner.update(video, { ...options, timeMs: 5_000 })).toBe(active);
		expect(owner.update(video, { ...options, timeMs: 5_001 })).toBe(original);
		expect(redaction.render).toHaveBeenLastCalledWith(video, {
			...options,
			timeMs: 5_001,
			width: 1920,
			height: 1080,
		});
		// Source time is deliberately different: annotations belong to the edit timeline.
		expect(video.currentTime).toBe(1.5);
		owner.dispose();
		source.destroy();
	});

	it("reuses and refreshes the canvas texture for moving frames, edits, and source dimension changes", () => {
		const { owner, video, canvas } = setup();
		const texture = owner.update(video, options);
		const update = vi.fn();
		texture.source.on("update", update);
		for (let frame = 1; frame < 20; frame++) {
			video.currentTime += 1 / 60;
			expect(owner.update(video, { ...options, timeMs: 4_500 + frame })).toBe(texture);
		}
		expect(update).toHaveBeenCalledTimes(19);
		canvas.width = 1280;
		canvas.height = 720;
		expect(owner.update(video, options)).toBe(texture);
		expect(texture.source.pixelWidth).toBe(1280);
		expect(texture.source.pixelHeight).toBe(720);
		owner.dispose();
	});

	it("never uploads raw pixels when the active privacy pass fails", () => {
		const { owner, source, video, redaction } = setup();
		owner.update(video, options);
		const update = vi.spyOn(source, "update");
		redaction.render.mockImplementationOnce(() => {
			throw new Error("Source redaction canvas is unavailable");
		});
		expect(() => owner.update(video, options)).toThrow(
			"Source redaction canvas is unavailable",
		);
		expect(update).not.toHaveBeenCalled();
		owner.dispose();
	});

	it("releases owned GPU textures before buffers without destroying the persistent media source", () => {
		const { owner, source, video, canvas, redaction } = setup();
		const original = owner.update(video, { ...options, timeMs: 3_999 });
		const active = owner.update(video, options);
		const activeSource = active.source;
		redaction.dispose.mockImplementationOnce(() => {
			expect(active.destroyed).toBe(true);
			expect(activeSource.destroyed).toBe(true);
		});
		owner.dispose();
		expect(original.destroyed).toBe(true);
		expect(source.destroyed).toBe(false);
		expect(video.load).not.toHaveBeenCalled();
		expect(canvas).toMatchObject({ width: 1920, height: 1080 });
		expect(redaction.dispose).toHaveBeenCalledOnce();
	});
});
