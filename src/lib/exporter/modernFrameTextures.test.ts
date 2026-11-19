import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { createMockCanvas, createRenderer } from "./modernFrameRenderer.testSupport";

describe("ModernFrameRenderer webcam frame cache", () => {
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
	it("stages webcam video frames on WebGPU instead of using retained frame uploads", () => {
		const renderer = createRenderer();
		renderer.scene.rendererBackend = "webgpu";

		const frame = {
			displayWidth: 320,
			displayHeight: 180,
			timestamp: 0,
		} as VideoFrame;

		const result = renderer.textures.stageVideoFrameForTexture(frame, "webcam", 640, 360);

		expect(result).toBe(renderer.textures.webcamVideoFrameStagingCanvas);
		expect(renderer.textures.webcamVideoFrameStagingCtx.drawImage).toHaveBeenCalledWith(
			frame,
			0,
			0,
			320,
			180,
		);
	});

	it("uses staging canvas instead of recursing when WebGPU frame retention fails", () => {
		const renderer = createRenderer();
		const originalVideoFrame = globalThis.VideoFrame;

		globalThis.VideoFrame = class {
			constructor() {
				throw new Error("retain failed");
			}
		};

		try {
			renderer.scene.rendererBackend = "webgpu";
			const frame = {
				displayWidth: 320,
				displayHeight: 180,
				timestamp: 0,
			} as VideoFrame;

			const result = renderer.textures.stageVideoFrameForTexture(frame, "webcam", 640, 360);

			expect(result).toBe(renderer.textures.webcamVideoFrameStagingCanvas);
			expect(renderer.textures.webcamVideoFrameStagingCtx.drawImage).toHaveBeenCalledWith(
				frame,
				0,
				0,
				320,
				180,
			);
		} finally {
			if (originalVideoFrame === undefined) {
				delete globalThis.VideoFrame;
			} else {
				globalThis.VideoFrame = originalVideoFrame;
			}
		}
	});

	it("renders non-video webcam frames directly for default crop regions", () => {
		const renderer = createRenderer();
		const liveSource = {};

		renderer.config.webcam.cropRegion = { x: 0, y: 0, width: 1, height: 1 };
		const renderableSource = renderer.webcamFrames.resolveRenderableWebcamSource(
			liveSource,
			1280,
			720,
			true,
		);

		expect(renderableSource).toMatchObject({
			source: liveSource,
			width: 1280,
			height: 720,
			mode: "live",
		});
		expect(renderer.webcamFrames.webcamFrameCacheCanvas).toBeNull();
	});

	it("uses a cache-backed source for cropped webcam regions", () => {
		const renderer = createRenderer();
		const liveSource = {};

		renderer.config.webcam.cropRegion = {
			x: 0.25,
			y: 0,
			width: 0.5,
			height: 1,
		};
		const renderableSource = renderer.webcamFrames.resolveRenderableWebcamSource(
			liveSource,
			1280,
			720,
			true,
		);

		expect(renderableSource?.source).toBe(renderer.webcamFrames.webcamFrameCacheCanvas);
		expect(renderableSource).toMatchObject({
			width: 640,
			height: 720,
			mode: "cached",
		});
		expect(renderer.webcamFrames.webcamFrameCacheCtx.drawImage).toHaveBeenCalledWith(
			liveSource,
			320,
			0,
			640,
			720,
			0,
			0,
			640,
			720,
		);
	});
});
