import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WEBCAM_OVERLAY } from "../../components/video-editor/types";

const {
	cancelForwardFrameSourceMock,
	destroyForwardFrameSourceMock,
	getForwardFrameAtTimeMock,
	initializeForwardFrameSourceMock,
	pixiApplicationInstancesMock,
	pixiInitializationErrorsMock,
	resolveMediaElementSourceMock,
} = vi.hoisted(() => ({
	cancelForwardFrameSourceMock: vi.fn(),
	destroyForwardFrameSourceMock: vi.fn(async () => undefined),
	getForwardFrameAtTimeMock: vi.fn(async () => null),
	initializeForwardFrameSourceMock: vi.fn(async () => undefined),
	pixiApplicationInstancesMock: [] as Array<{
		destroy: ReturnType<typeof vi.fn>;
		init: ReturnType<typeof vi.fn>;
		renderer: { destroy: ReturnType<typeof vi.fn> };
		stage: { destroy: ReturnType<typeof vi.fn> };
	}>,
	pixiInitializationErrorsMock: [] as Array<Error | undefined>,
	resolveMediaElementSourceMock: vi.fn(async () => ({
		src: "blob:background",
		revoke: vi.fn(),
	})),
}));

vi.mock("pixi.js", () => ({
	RendererType: { WEBGL: 1, WEBGPU: 2 },
	Application: class {
		destroy = vi.fn(() => {
			throw new TypeError("this._cancelResize is not a function");
		});
		init = vi.fn(async () => {
			const error = pixiInitializationErrorsMock.shift();
			if (error) throw error;
		});
		renderer = { destroy: vi.fn() };
		stage = { destroy: vi.fn() };

		constructor() {
			pixiApplicationInstancesMock.push(this);
		}
	},
	BlurFilter: class {},
	Container: class {
		visible = true;
		addChild = vi.fn();
		addChildAt = vi.fn();
		removeChildren = vi.fn();
	},
	Graphics: class {},
	Sprite: class {
		visible = true;
		x = 0;
		y = 0;
		alpha = 1;
		scale = { x: 1, y: 1, set: vi.fn() };
		anchor = { x: 0.5, y: 0.5, set: vi.fn() };
		position = { set: vi.fn() };
		texture: { destroy: ReturnType<typeof vi.fn> };

		constructor(texture = { destroy: vi.fn() }) {
			this.texture = texture;
		}
	},
	Texture: {
		from: vi.fn(() => ({ source: { update: vi.fn() }, destroy: vi.fn() })),
	},
}));

vi.mock("pixi-filters/motion-blur", () => ({
	MotionBlurFilter: class {},
}));

vi.mock("@/lib/assetPath", () => ({
	getAssetPath: vi.fn(async (value: string) => value),
	getExportableVideoUrl: vi.fn(async (value: string) => value),
	getRenderableAssetUrl: vi.fn((value: string) => value),
}));

vi.mock("@/components/video-editor/videoPlayback/zoomRegionUtils", () => ({
	findDominantRegion: vi.fn(() => ({
		region: null,
		strength: 0,
		blendedScale: 1,
		transition: null,
	})),
}));

vi.mock("@/components/video-editor/videoPlayback/zoomTransform", () => ({
	applyZoomTransform: vi.fn(),
	computeFocusFromTransform: vi.fn(() => ({ cx: 0.5, cy: 0.5 })),
	computeZoomTransform: vi.fn(() => ({ scale: 1, x: 0, y: 0 })),
	createMotionBlurState: vi.fn(() => ({})),
}));

vi.mock("@/components/video-editor/videoPlayback/cursorRenderer", () => ({
	PixiCursorOverlay: class {
		container = {};
		update = vi.fn();
		destroy = vi.fn();
	},
	DEFAULT_CURSOR_CONFIG: {
		dotRadius: 28,
		smoothingFactor: 0.18,
		motionBlur: 0,
		clickBounce: 1,
		sway: 0,
	},
	preloadCursorAssets: vi.fn(async () => undefined),
}));

vi.mock("./forwardFrameSource", () => ({
	ForwardFrameSource: class {
		cancel = cancelForwardFrameSourceMock;
		destroy = destroyForwardFrameSourceMock;
		getFrameAtTime = getForwardFrameAtTimeMock;
		initialize = initializeForwardFrameSourceMock;
	},
}));

vi.mock("./localMediaSource", () => ({
	resolveMediaElementSource: resolveMediaElementSourceMock,
}));

vi.mock("./annotationRenderer", () => ({
	preloadAnnotationAssets: vi.fn(async () => ({ imageCache: new Map() })),
	renderAnnotationToCanvas: vi.fn(async () => null),
	renderAnnotations: vi.fn(async () => undefined),
}));

import { renderAnnotations } from "./annotationRenderer";

import { FrameRenderer } from "./modernFrameRenderer";

import { createMockCanvas, createRenderer } from "./modernFrameRenderer.testSupport";

describe("ModernFrameRenderer blur export path", () => {
	beforeEach(() => {
		Object.assign(globalThis, {
			window: globalThis,
			requestAnimationFrame: (callback: FrameRequestCallback) => {
				callback(0);
				return 1;
			},
			cancelAnimationFrame: vi.fn(),
			HTMLMediaElement: {
				HAVE_CURRENT_DATA: 2,
			},
			document: {
				createElement: vi.fn((tag: string) => {
					if (tag === "video") {
						return {
							duration: 5,
							readyState: 2,
							videoWidth: 1280,
							videoHeight: 720,
							muted: true,
							loop: true,
							playsInline: true,
							preload: "auto",
							src: "",
							currentTime: 0,
							load: vi.fn(),
							pause: vi.fn(),
							addEventListener: vi.fn(),
							removeEventListener: vi.fn(),
						};
					}
					if (tag !== "canvas") {
						throw new Error(`Unexpected element requested in test: ${tag}`);
					}

					return createMockCanvas();
				}),
			},
		});
	});

	it("uses a composited canvas and disables pixel readback when blur post-processing is active", async () => {
		const renderer = createRenderer();
		const sourceCanvas = createMockCanvas();

		renderer.scene.app = { canvas: sourceCanvas };
		renderer.annotations.annotationScaleFactor = 1;
		renderer.annotations.annotationAssets = { imageCache: new Map() };

		await renderer.annotations.composeBlurAnnotationFrame(500);

		expect(renderAnnotations).toHaveBeenCalledTimes(1);
		expect(renderer.getCanvas()).not.toBe(sourceCanvas);
		expect(renderer.capturePixelsForNativeExport()).not.toBeNull();
	});

	it("prefers decoder-backed sync for video wallpapers during export", async () => {
		vi.clearAllMocks();
		const renderer = new FrameRenderer({
			width: 1920,
			height: 1080,
			nativeReadbackMode: "pixels",
			wallpaper: "/wallpapers/wispysky.mp4",
			zoomRegions: [],
			showShadow: false,
			shadowIntensity: 0,
			backgroundBlur: 0,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			webcam: {
				...DEFAULT_WEBCAM_OVERLAY,
				enabled: false,
			},
			videoWidth: 1920,
			videoHeight: 1080,
		});

		await renderer.background.setupBackground();

		expect(initializeForwardFrameSourceMock).toHaveBeenCalledWith("wallpapers/wispysky.mp4");
		expect(resolveMediaElementSourceMock).not.toHaveBeenCalled();
		expect(renderer.backgroundPlayback.backgroundForwardFrameSource).toBeTruthy();
		expect(renderer.backgroundPlayback.backgroundVideoElement).toBeNull();
	});

	it("falls back to media-element sync when video wallpaper packet streaming fails", async () => {
		vi.clearAllMocks();
		initializeForwardFrameSourceMock.mockResolvedValue(undefined);
		getForwardFrameAtTimeMock.mockRejectedValueOnce(
			new Error("readAVPacket pipeline failed: Failed after 3 attempts"),
		);
		resolveMediaElementSourceMock.mockResolvedValueOnce({
			src: "blob:background-video",
			revoke: vi.fn(),
		});
		const renderer = new FrameRenderer({
			width: 1920,
			height: 1080,
			nativeReadbackMode: "pixels",
			wallpaper: "/wallpapers/wispysky.mp4",
			zoomRegions: [],
			showShadow: false,
			shadowIntensity: 0,
			backgroundBlur: 0,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			webcam: {
				...DEFAULT_WEBCAM_OVERLAY,
				enabled: false,
			},
			videoWidth: 1920,
			videoHeight: 1080,
		});

		await renderer.background.setupBackground();
		await expect(renderer.backgroundPlayback.syncBackgroundFrame(1)).resolves.toBeUndefined();

		expect(cancelForwardFrameSourceMock).toHaveBeenCalled();
		expect(destroyForwardFrameSourceMock).toHaveBeenCalled();
		expect(resolveMediaElementSourceMock).toHaveBeenCalledWith("wallpapers/wispysky.mp4");
		expect(renderer.backgroundPlayback.backgroundForwardFrameSource).toBeNull();
		expect(renderer.backgroundPlayback.backgroundVideoElement).toBeTruthy();
	});
});
