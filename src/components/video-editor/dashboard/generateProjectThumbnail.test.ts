import { afterEach, beforeEach, expect, it, vi } from "vitest";
const renderer = vi.hoisted(() => ({
	construct: vi.fn(),
	initialize: vi.fn(),
	destroy: vi.fn(),
	renderFrame: vi.fn(),
	getCanvas: vi.fn(),
}));
const getCursorTelemetry = vi.fn();
const cursorSamples = [
	{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move" },
	{ timeMs: 1000, cx: 0.6, cy: 0.5, interactionType: "move" },
];
vi.mock("@/lib/exporter/frameRenderer", () => ({
	FrameRenderer: class {
		constructor(config: unknown) {
			renderer.construct(config);
		}
		initialize = renderer.initialize;
		destroy = renderer.destroy;
		renderFrame = renderer.renderFrame;
		getCanvas = renderer.getCanvas;
	},
}));
import { generateProjectThumbnail } from "./generateProjectThumbnail";
import { getOrCreateProjectThumbnail } from "./projectThumbnailCache";

beforeEach(() => {
	renderer.initialize.mockResolvedValue(undefined);
	renderer.renderFrame.mockResolvedValue(undefined);
	getCursorTelemetry.mockResolvedValue({ success: true, samples: cursorSamples });
	vi.stubGlobal("electronAPI", { getCursorTelemetry });
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

it.each([
	{ aspectRatio: "16:9", crop: { width: 1, height: 1 }, width: 853, height: 480 },
	{ aspectRatio: "9:16", crop: { width: 1, height: 1 }, width: 640, height: 1138 },
	{ aspectRatio: "native", crop: { width: 0.5, height: 1 }, width: 640, height: 720 },
	{
		aspectRatio: "16:9",
		crop: { width: 1, height: 1 },
		width: 853,
		height: 480,
		showCursor: false,
	},
	{
		aspectRatio: "16:9",
		crop: { width: 1, height: 1 },
		width: 853,
		height: 480,
		unavailable: true,
	},
])("covers the card from the saved $aspectRatio composition without adding margins", async ({
	aspectRatio,
	crop,
	width,
	height,
	showCursor = true,
	unavailable = false,
}) => {
	if (unavailable) getCursorTelemetry.mockRejectedValueOnce(new Error("Missing sidecar"));
	const video = {
		videoWidth: 1920,
		videoHeight: 1080,
		duration: 6,
		onloadeddata: null as (() => void) | null,
		onseeked: null,
		onerror: null,
		set src(_value: string) {
			Promise.resolve().then(() => this.onloadeddata?.());
		},
		removeAttribute: vi.fn(),
		load: vi.fn(),
	};
	const drawImage = vi.fn();
	const canvas = {
		width: 0,
		height: 0,
		getContext: () => ({ drawImage }),
		toDataURL: () => "data:image/png;base64,thumbnail",
	};
	const composed = {};
	renderer.getCanvas.mockReturnValue(composed);
	vi.stubGlobal("document", {
		createElement: (tag: string) => (tag === "video" ? video : canvas),
	});
	vi.stubGlobal("window", globalThis);
	vi.stubGlobal(
		"VideoFrame",
		class {
			close() {}
		},
	);
	const result = await generateProjectThumbnail("source", {
		project: {
			version: 1,
			videoPath: "/recordings/source.mp4",
			editor: { aspectRatio, cropRegion: { x: 0, y: 0, ...crop }, padding: 24, showCursor },
		},
		videoUrl: "source",
		webcamUrl: null,
	} as Parameters<typeof generateProjectThumbnail>[1]);
	expect(renderer.construct).toHaveBeenCalledWith(
		expect.objectContaining({
			width,
			height,
			padding: { top: 24, bottom: 24, left: 24, right: 24, linked: true },
			showCursor,
			cursorTelemetry: unavailable ? [] : cursorSamples,
		}),
	);
	expect(getCursorTelemetry).toHaveBeenCalledWith("/recordings/source.mp4");
	expect(result).toEqual({ url: "data:image/png;base64,thumbnail", duration: 6 });
	expect(canvas).toMatchObject({ width: 640, height: 480 });
	const [source, x, y, cropWidth, cropHeight, targetX, targetY, targetWidth, targetHeight] =
		drawImage.mock.calls[0];
	expect(source).toBe(composed);
	// The crop fills the cache exactly and keeps the composition's center and proportions.
	expect([targetX, targetY, targetWidth, targetHeight]).toEqual([0, 0, 640, 480]);
	expect(cropWidth / cropHeight).toBeCloseTo(4 / 3);
	expect(x + cropWidth / 2).toBeCloseTo(width / 2);
	expect(y + cropHeight / 2).toBeCloseTo(height / 2);
	expect(Math.min(x, y)).toBe(0);
});

it("times out a stalled composition, releases resources and lets the next queued preview run", async () => {
	vi.useFakeTimers();
	let finishInitialize!: () => void;
	renderer.initialize.mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				finishInitialize = resolve;
			}),
	);
	const video = {
		videoWidth: 1920,
		videoHeight: 1080,
		duration: 6,
		onloadeddata: null as (() => void) | null,
		onseeked: null,
		onerror: null,
		set src(_value: string) {
			Promise.resolve().then(() => this.onloadeddata?.());
		},
		removeAttribute: vi.fn(),
		load: vi.fn(),
	};
	vi.stubGlobal("document", { createElement: () => video });
	vi.stubGlobal("window", globalThis);
	const first = getOrCreateProjectThumbnail("stalled-composition", () =>
		generateProjectThumbnail("source", {
			project: { version: 1, videoPath: "source", editor: {} },
			videoUrl: "source",
			webcamUrl: null,
		} as Parameters<typeof generateProjectThumbnail>[1]),
	);
	const rejected = expect(first).rejects.toThrow("Thumbnail render timed out");
	const next = vi.fn(async () => ({ url: "next", duration: 2 }));
	const second = getOrCreateProjectThumbnail("after-stalled-composition", next);
	await vi.advanceTimersByTimeAsync(15001);
	await rejected;
	await second;
	expect(renderer.destroy).toHaveBeenCalled();
	expect(video.removeAttribute).toHaveBeenCalledWith("src");
	expect(next).toHaveBeenCalledOnce();
	// Late initialization cannot publish a stale frame or leak newly created resources.
	finishInitialize();
	await vi.advanceTimersByTimeAsync(1);
	expect(renderer.renderFrame).not.toHaveBeenCalled();
});
