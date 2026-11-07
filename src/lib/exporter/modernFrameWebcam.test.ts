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

import { createMockCanvas, createRenderer } from "./modernFrameRenderer.testSupport";

describe("ModernFrameRenderer webcam export fallback", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		initializeForwardFrameSourceMock.mockResolvedValue(undefined);
		getForwardFrameAtTimeMock.mockResolvedValue(null);
		resolveMediaElementSourceMock.mockResolvedValue({
			src: "blob:webcam",
			revoke: vi.fn(),
		});

		Object.assign(globalThis, {
			window: {
				clearTimeout,
				setTimeout,
			},
			HTMLMediaElement: {
				HAVE_CURRENT_DATA: 2,
			},
			cancelAnimationFrame: vi.fn(),
			requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
				callback(0);
				return 1;
			}),
			document: {
				createElement: vi.fn((tag: string) => {
					if (tag === "video") {
						return {
							duration: 5,
							readyState: 2,
							videoWidth: 640,
							videoHeight: 360,
							muted: true,
							loop: true,
							playsInline: true,
							preload: "auto",
							src: "",
							currentTime: 0,
							seeking: false,
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

	it("falls back to media-element webcam sync when packet streaming fails after initialize", async () => {
		getForwardFrameAtTimeMock.mockRejectedValueOnce(
			new Error("readAVPacket pipeline failed: Failed after 3 attempts"),
		);
		const renderer = createRenderer();
		renderer.config.webcam = {
			...DEFAULT_WEBCAM_OVERLAY,
			enabled: true,
		};
		renderer.config.webcamUrl = "file:///tmp/webcam.webm";

		await renderer.webcamMedia.setupWebcamSource();
		await expect(renderer.webcamMedia.syncWebcamFrame(1)).resolves.toBeUndefined();

		expect(cancelForwardFrameSourceMock).toHaveBeenCalled();
		expect(destroyForwardFrameSourceMock).toHaveBeenCalled();
		expect(resolveMediaElementSourceMock).toHaveBeenCalledWith("file:///tmp/webcam.webm");
		expect(renderer.webcamMedia.webcamForwardFrameSource).toBeNull();
		expect(renderer.webcamMedia.webcamVideoElement).toBeTruthy();
	});

	it("tears down the media-element fallback when readiness times out", async () => {
		vi.useFakeTimers();
		const originalCreateElement = globalThis.document.createElement;
		const revoke = vi.fn();
		getForwardFrameAtTimeMock.mockRejectedValueOnce(
			new Error("readAVPacket pipeline failed: Failed after 3 attempts"),
		);
		resolveMediaElementSourceMock.mockResolvedValueOnce({
			src: "blob:webcam-timeout",
			revoke,
		});
		Object.assign(globalThis.window, {
			clearTimeout,
			setTimeout,
		});

		globalThis.document.createElement = vi.fn((tag: string) => {
			if (tag === "video") {
				return {
					duration: Number.NaN,
					readyState: 0,
					videoWidth: 0,
					videoHeight: 0,
					muted: true,
					loop: true,
					playsInline: true,
					preload: "auto",
					src: "",
					currentTime: 0,
					seeking: false,
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
		});

		try {
			const renderer = createRenderer();
			renderer.config.webcam = {
				...DEFAULT_WEBCAM_OVERLAY,
				enabled: true,
			};
			renderer.config.webcamUrl = "file:///tmp/webcam.webm";

			await renderer.webcamMedia.setupWebcamSource();
			const syncPromise = renderer.webcamMedia.syncWebcamFrame(1);

			await vi.advanceTimersByTimeAsync(5_001);
			await expect(syncPromise).resolves.toBeUndefined();

			expect(cancelForwardFrameSourceMock).toHaveBeenCalled();
			expect(destroyForwardFrameSourceMock).toHaveBeenCalled();
			expect(revoke).toHaveBeenCalled();
			expect(renderer.webcamMedia.webcamForwardFrameSource).toBeNull();
			expect(renderer.webcamMedia.webcamVideoElement).toBeNull();
		} finally {
			globalThis.document.createElement = originalCreateElement;
			vi.useRealTimers();
		}
	});

	it("keeps the webcam live when sync uses an offset timeline", () => {
		const renderer = createRenderer();
		renderer.config.webcam = {
			...DEFAULT_WEBCAM_OVERLAY,
			enabled: true,
			timeOffsetMs: 500,
		};
		renderer.currentVideoTime = 10;
		renderer.webcamMedia.lastSyncedWebcamTime = 9.5;
		renderer.webcamMedia.webcamVideoElement = {
			readyState: 2,
			seeking: false,
			videoWidth: 640,
			videoHeight: 360,
			duration: Number.NaN,
		};
		renderer.scene.webcamRootContainer = {
			visible: false,
			addChild: vi.fn(),
			position: { set: vi.fn() },
		};
		renderer.scene.webcamContainer = {
			addChildAt: vi.fn(),
		};
		renderer.scene.webcamMaskGraphics = {
			clear: vi.fn(),
			moveTo: vi.fn(),
			lineTo: vi.fn(),
			closePath: vi.fn(),
			fill: vi.fn(),
		};
		renderer.webcamShadowLayers = [];
		renderer.motion.animationState = {
			appliedScale: 1,
		};

		renderer.webcam.updateWebcamOverlay();

		expect(renderer.scene.webcamRootContainer.visible).toBe(true);
		expect(renderer.webcam.webcamSprite).toBeTruthy();
	});

	it("keeps the webcam live when the media element time is current but lastSyncedWebcamTime is stale", () => {
		const renderer = createRenderer();
		renderer.config.webcam = {
			...DEFAULT_WEBCAM_OVERLAY,
			enabled: true,
			timeOffsetMs: 500,
		};
		renderer.currentVideoTime = 10;
		renderer.webcamMedia.lastSyncedWebcamTime = 8;
		renderer.webcamMedia.webcamVideoElement = {
			currentTime: 9.5,
			readyState: 2,
			seeking: false,
			videoWidth: 640,
			videoHeight: 360,
			duration: Number.NaN,
		};
		renderer.scene.webcamRootContainer = {
			visible: false,
			addChild: vi.fn(),
			position: { set: vi.fn() },
		};
		renderer.scene.webcamContainer = {
			addChildAt: vi.fn(),
		};
		renderer.scene.webcamMaskGraphics = {
			clear: vi.fn(),
			moveTo: vi.fn(),
			lineTo: vi.fn(),
			closePath: vi.fn(),
			fill: vi.fn(),
		};
		renderer.webcamShadowLayers = [];
		renderer.motion.animationState = {
			appliedScale: 1,
		};

		renderer.webcam.updateWebcamOverlay();

		expect(renderer.scene.webcamRootContainer.visible).toBe(true);
		expect(renderer.webcam.webcamSprite).toBeTruthy();
	});

	it("snapshots media-element webcam frames into the cache before rendering", () => {
		const renderer = createRenderer();
		renderer.config.webcam = {
			...DEFAULT_WEBCAM_OVERLAY,
			enabled: true,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		};
		renderer.currentVideoTime = 4;
		const previousHtmlVideoElement = (
			globalThis as typeof globalThis & { HTMLVideoElement?: unknown }
		).HTMLVideoElement;
		class MockHtmlVideoElement {
			currentTime = 4;
			readyState = 2;
			seeking = false;
			videoWidth = 640;
			videoHeight = 360;
			duration = Number.NaN;
		}
		Object.assign(globalThis, {
			HTMLVideoElement: MockHtmlVideoElement,
		});

		const webcamVideoElement = new MockHtmlVideoElement();

		try {
			const renderableSource = renderer.webcamFrames.resolveRenderableWebcamSource(
				webcamVideoElement,
				640,
				360,
				true,
			);

			expect(renderableSource?.source).toBe(renderer.webcamFrames.webcamFrameCacheCanvas);
			expect(renderer.webcamFrames.webcamFrameCacheCtx.drawImage).toHaveBeenCalledWith(
				webcamVideoElement,
				0,
				0,
				640,
				360,
				0,
				0,
				640,
				360,
			);
		} finally {
			Object.assign(globalThis, {
				HTMLVideoElement: previousHtmlVideoElement,
			});
		}
	});

	it("renders decoder-backed webcam frames directly for the default crop region", () => {
		const renderer = createRenderer();
		renderer.config.webcam = {
			...DEFAULT_WEBCAM_OVERLAY,
			enabled: true,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		};

		const previousVideoFrame = (globalThis as typeof globalThis & { VideoFrame?: unknown })
			.VideoFrame;
		class MockVideoFrame {}
		Object.assign(globalThis, {
			VideoFrame: MockVideoFrame,
		});

		try {
			const webcamFrame = new MockVideoFrame();
			const renderableSource = renderer.webcamFrames.resolveRenderableWebcamSource(
				webcamFrame,
				640,
				360,
				true,
			);

			expect(renderableSource?.source).toBe(webcamFrame);
			expect(renderer.webcamFrames.webcamFrameCacheCanvas).toBeNull();
		} finally {
			Object.assign(globalThis, {
				VideoFrame: previousVideoFrame,
			});
		}
	});
	it("keeps a cropped camera without an explicit shape square in modern export", () => {
		const renderer = createRenderer();
		renderer.config.webcam = {
			...DEFAULT_WEBCAM_OVERLAY,
			enabled: true,
			shape: undefined,
			width: 30,
			height: 30,
			cropRegion: { x: 0, y: 0, width: 0.5, height: 1 },
		};
		renderer.currentVideoTime = 0;
		renderer.webcamMedia.lastSyncedWebcamTime = 0;
		renderer.webcamMedia.webcamVideoElement = {
			currentTime: 0,
			readyState: 2,
			seeking: false,
			videoWidth: 1920,
			videoHeight: 1080,
			duration: Number.NaN,
		};
		renderer.scene.webcamRootContainer = {
			visible: false,
			addChild: vi.fn(),
			position: { set: vi.fn() },
		};
		renderer.scene.webcamContainer = { addChildAt: vi.fn() };
		renderer.scene.webcamMaskGraphics = {
			clear: vi.fn(),
			moveTo: vi.fn(),
			lineTo: vi.fn(),
			closePath: vi.fn(),
			fill: vi.fn(),
		};
		renderer.webcamShadowLayers = [];
		renderer.motion.animationState = { appliedScale: 1 };
		const render = vi.spyOn(renderer.webcam.webcamMotionBlur, "render").mockReturnValue(null);
		renderer.webcam.updateWebcamOverlay();
		expect(render).toHaveBeenCalledWith(
			expect.objectContaining({
				shape: "squircle",
				layout: expect.objectContaining({ width: 324, height: 324 }),
			}),
		);
	});
});
