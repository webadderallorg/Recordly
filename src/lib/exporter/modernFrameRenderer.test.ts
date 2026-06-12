import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WEBCAM_OVERLAY } from "../../components/video-editor/types";

const {
	cancelForwardFrameSourceMock,
	destroyForwardFrameSourceMock,
	getForwardFrameAtTimeMock,
	initializeForwardFrameSourceMock,
	resolveMediaElementSourceMock,
} = vi.hoisted(() => ({
	cancelForwardFrameSourceMock: vi.fn(),
	destroyForwardFrameSourceMock: vi.fn(async () => undefined),
	getForwardFrameAtTimeMock: vi.fn(async () => null),
	initializeForwardFrameSourceMock: vi.fn(async () => undefined),
	resolveMediaElementSourceMock: vi.fn(async () => ({
		src: "blob:background",
		revoke: vi.fn(),
	})),
}));

vi.mock("pixi.js", () => ({
	Application: class {},
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

function createMockContext() {
	return {
		clearRect: vi.fn(),
		drawImage: vi.fn(),
		fillRect: vi.fn(),
		save: vi.fn(),
		restore: vi.fn(),
		getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(0) })),
		globalAlpha: 1,
		imageSmoothingEnabled: true,
		imageSmoothingQuality: "high",
	} as unknown as CanvasRenderingContext2D;
}

function createMockCanvas() {
	const context = createMockContext();
	return {
		width: 0,
		height: 0,
		getContext: vi.fn(() => context),
		context,
	};
}

function createRenderer() {
	return new FrameRenderer({
		width: 1920,
		height: 1080,
		nativeReadbackMode: "pixels",
		wallpaper: "#000000",
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
		annotationRegions: [
			{
				id: "blur-1",
				startMs: 0,
				endMs: 1000,
				type: "blur",
				content: "",
				position: { x: 10, y: 10 },
				size: { width: 20, height: 20 },
				style: {
					color: "#ffffff",
					backgroundColor: "transparent",
					fontSize: 24,
					fontFamily: "Inter",
					fontWeight: "normal",
					fontStyle: "normal",
					textDecoration: "none",
					textAlign: "center",
					borderRadius: 0,
				},
				zIndex: 1,
				blurIntensity: 20,
			},
		],
	});
}

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
		const renderer = createRenderer() as any;
		const sourceCanvas = createMockCanvas();

		renderer.app = { canvas: sourceCanvas };
		renderer.annotationScaleFactor = 1;
		renderer.annotationAssets = { imageCache: new Map() };

		await renderer.composeBlurAnnotationFrame(500);

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
		}) as any;

		await renderer.setupBackground();

		expect(initializeForwardFrameSourceMock).toHaveBeenCalledWith("wallpapers/wispysky.mp4");
		expect(resolveMediaElementSourceMock).not.toHaveBeenCalled();
		expect(renderer.backgroundForwardFrameSource).toBeTruthy();
		expect(renderer.backgroundVideoElement).toBeNull();
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
		}) as any;

		await renderer.setupBackground();
		await expect(renderer.syncBackgroundFrame(1)).resolves.toBeUndefined();

		expect(cancelForwardFrameSourceMock).toHaveBeenCalled();
		expect(destroyForwardFrameSourceMock).toHaveBeenCalled();
		expect(resolveMediaElementSourceMock).toHaveBeenCalledWith("wallpapers/wispysky.mp4");
		expect(renderer.backgroundForwardFrameSource).toBeNull();
		expect(renderer.backgroundVideoElement).toBeTruthy();
	});
});

describe("ModernFrameRenderer webcam frame cache", () => {
	it("stages webcam video frames on WebGPU instead of using retained frame uploads", () => {
		const renderer = createRenderer() as any;
		renderer.rendererBackend = "webgpu";

		const frame = {
			displayWidth: 320,
			displayHeight: 180,
			timestamp: 0,
		} as VideoFrame;

		const result = renderer.stageVideoFrameForTexture(frame, "webcam", 640, 360);

		expect(result).toBe(renderer.webcamVideoFrameStagingCanvas);
		expect(renderer.webcamVideoFrameStagingCtx.drawImage).toHaveBeenCalledWith(
			frame,
			0,
			0,
			320,
			180,
		);
	});

	it("uses staging canvas instead of recursing when WebGPU frame retention fails", () => {
		const renderer = createRenderer() as any;
		const originalVideoFrame = (globalThis as any).VideoFrame;

		(globalThis as any).VideoFrame = class {
			constructor() {
				throw new Error("retain failed");
			}
		};

		try {
			renderer.rendererBackend = "webgpu";
			const frame = {
				displayWidth: 320,
				displayHeight: 180,
				timestamp: 0,
			} as VideoFrame;

			const result = renderer.stageVideoFrameForTexture(frame, "webcam", 640, 360);

			expect(result).toBe(renderer.webcamVideoFrameStagingCanvas);
			expect(renderer.webcamVideoFrameStagingCtx.drawImage).toHaveBeenCalledWith(
				frame,
				0,
				0,
				320,
				180,
			);
		} finally {
			if (originalVideoFrame === undefined) {
				delete (globalThis as any).VideoFrame;
			} else {
				(globalThis as any).VideoFrame = originalVideoFrame;
			}
		}
	});

	it("renders non-video webcam frames directly for default crop regions", () => {
		const renderer = createRenderer() as any;
		const liveSource = {};

		renderer.config.webcam.cropRegion = { x: 0, y: 0, width: 1, height: 1 };
		const renderableSource = renderer.resolveRenderableWebcamSource(
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
		expect(renderer.webcamFrameCacheCanvas).toBeNull();
	});

	it("uses a cache-backed source for cropped webcam regions", () => {
		const renderer = createRenderer() as any;
		const liveSource = {};

		renderer.config.webcam.cropRegion = {
			x: 0.25,
			y: 0,
			width: 0.5,
			height: 1,
		};
		const renderableSource = renderer.resolveRenderableWebcamSource(
			liveSource,
			1280,
			720,
			true,
		);

		expect(renderableSource?.source).toBe(renderer.webcamFrameCacheCanvas);
		expect(renderableSource).toMatchObject({
			width: 640,
			height: 720,
			mode: "cached",
		});
		expect(renderer.webcamFrameCacheCtx.drawImage).toHaveBeenCalledWith(
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
		const renderer = createRenderer() as any;
		renderer.config.webcam = {
			...DEFAULT_WEBCAM_OVERLAY,
			enabled: true,
		};
		renderer.config.webcamUrl = "file:///tmp/webcam.webm";

		await renderer.setupWebcamSource();
		await expect(renderer.syncWebcamFrame(1)).resolves.toBeUndefined();

		expect(cancelForwardFrameSourceMock).toHaveBeenCalled();
		expect(destroyForwardFrameSourceMock).toHaveBeenCalled();
		expect(resolveMediaElementSourceMock).toHaveBeenCalledWith("file:///tmp/webcam.webm");
		expect(renderer.webcamForwardFrameSource).toBeNull();
		expect(renderer.webcamVideoElement).toBeTruthy();
	});

	it("tears down the media-element fallback when readiness times out", async () => {
		vi.useFakeTimers();
		const originalCreateElement = (globalThis as any).document.createElement;
		const revoke = vi.fn();
		getForwardFrameAtTimeMock.mockRejectedValueOnce(
			new Error("readAVPacket pipeline failed: Failed after 3 attempts"),
		);
		resolveMediaElementSourceMock.mockResolvedValueOnce({
			src: "blob:webcam-timeout",
			revoke,
		});
		Object.assign((globalThis as any).window, {
			clearTimeout,
			setTimeout,
		});

		(globalThis as any).document.createElement = vi.fn((tag: string) => {
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
			const renderer = createRenderer() as any;
			renderer.config.webcam = {
				...DEFAULT_WEBCAM_OVERLAY,
				enabled: true,
			};
			renderer.config.webcamUrl = "file:///tmp/webcam.webm";

			await renderer.setupWebcamSource();
			const syncPromise = renderer.syncWebcamFrame(1);

			await vi.advanceTimersByTimeAsync(5_001);
			await expect(syncPromise).resolves.toBeUndefined();

			expect(cancelForwardFrameSourceMock).toHaveBeenCalled();
			expect(destroyForwardFrameSourceMock).toHaveBeenCalled();
			expect(revoke).toHaveBeenCalled();
			expect(renderer.webcamForwardFrameSource).toBeNull();
			expect(renderer.webcamVideoElement).toBeNull();
		} finally {
			(globalThis as any).document.createElement = originalCreateElement;
			vi.useRealTimers();
		}
	});

	it("keeps the webcam live when sync uses an offset timeline", () => {
		const renderer = createRenderer() as any;
		renderer.config.webcam = {
			...DEFAULT_WEBCAM_OVERLAY,
			enabled: true,
			timeOffsetMs: 500,
		};
		renderer.currentVideoTime = 10;
		renderer.lastSyncedWebcamTime = 9.5;
		renderer.webcamVideoElement = {
			readyState: 2,
			seeking: false,
			videoWidth: 640,
			videoHeight: 360,
			duration: Number.NaN,
		};
		renderer.webcamRootContainer = {
			visible: false,
			position: { set: vi.fn() },
		};
		renderer.webcamContainer = {
			addChildAt: vi.fn(),
		};
		renderer.webcamMaskGraphics = {
			clear: vi.fn(),
			moveTo: vi.fn(),
			lineTo: vi.fn(),
			closePath: vi.fn(),
			fill: vi.fn(),
		};
		renderer.webcamShadowLayers = [];
		renderer.animationState = {
			appliedScale: 1,
		};

		renderer.updateWebcamOverlay();

		expect(renderer.webcamRootContainer.visible).toBe(true);
		expect(renderer.webcamSprite).toBeTruthy();
	});

	it("keeps the webcam live when the media element time is current but lastSyncedWebcamTime is stale", () => {
		const renderer = createRenderer() as any;
		renderer.config.webcam = {
			...DEFAULT_WEBCAM_OVERLAY,
			enabled: true,
			timeOffsetMs: 500,
		};
		renderer.currentVideoTime = 10;
		renderer.lastSyncedWebcamTime = 8;
		renderer.webcamVideoElement = {
			currentTime: 9.5,
			readyState: 2,
			seeking: false,
			videoWidth: 640,
			videoHeight: 360,
			duration: Number.NaN,
		};
		renderer.webcamRootContainer = {
			visible: false,
			position: { set: vi.fn() },
		};
		renderer.webcamContainer = {
			addChildAt: vi.fn(),
		};
		renderer.webcamMaskGraphics = {
			clear: vi.fn(),
			moveTo: vi.fn(),
			lineTo: vi.fn(),
			closePath: vi.fn(),
			fill: vi.fn(),
		};
		renderer.webcamShadowLayers = [];
		renderer.animationState = {
			appliedScale: 1,
		};

		renderer.updateWebcamOverlay();

		expect(renderer.webcamRootContainer.visible).toBe(true);
		expect(renderer.webcamSprite).toBeTruthy();
	});

	it("letterboxes the webcam and hides the screen during camera-full segments", () => {
		const renderer = createRenderer() as any;
		renderer.config.webcam = {
			...DEFAULT_WEBCAM_OVERLAY,
			enabled: true,
		};
		renderer.config.webcamLayoutRegions = [{ id: "layout-1", startMs: 5_000, endMs: 9_000 }];
		renderer.lastSyncedWebcamTime = 6;
		renderer.webcamVideoElement = {
			currentTime: 6,
			readyState: 2,
			seeking: false,
			videoWidth: 640,
			videoHeight: 360,
			duration: Number.NaN,
		};
		renderer.cameraContainer = { visible: true };
		renderer.webcamRootContainer = {
			visible: false,
			position: { set: vi.fn() },
		};
		renderer.webcamContainer = {
			addChildAt: vi.fn(),
		};
		renderer.webcamMaskGraphics = {
			clear: vi.fn(),
			moveTo: vi.fn(),
			lineTo: vi.fn(),
			closePath: vi.fn(),
			fill: vi.fn(),
		};
		renderer.webcamShadowLayers = [];
		renderer.animationState = {
			appliedScale: 1,
		};

		// Inside the camera-full region: screen hidden, webcam letterboxed.
		renderer.currentVideoTime = 6;
		renderer.updateWebcamOverlay();

		expect(renderer.cameraContainer.visible).toBe(false);
		expect(renderer.webcamRootContainer.visible).toBe(true);
		// 16:9 source in a 1920x1080 frame with padding 1080 * 0.04 = 43.2:
		// available 1833.6x993.6 -> fit 1766.4x993.6, centered at (76.8, 43.2).
		const cameraFullLayout = renderer.webcamLayoutCache;
		expect(cameraFullLayout.width).toBeCloseTo(1766.4);
		expect(cameraFullLayout.height).toBeCloseTo(993.6);
		expect(cameraFullLayout.positionX).toBeCloseTo(76.8);
		expect(cameraFullLayout.positionY).toBeCloseTo(43.2);
		const [cameraFullX, cameraFullY] =
			renderer.webcamRootContainer.position.set.mock.calls.at(-1);
		expect(cameraFullX).toBeCloseTo(76.8);
		expect(cameraFullY).toBeCloseTo(43.2);

		// Outside the region: screen restored, webcam back to the square bubble.
		renderer.currentVideoTime = 2;
		renderer.lastSyncedWebcamTime = 2;
		renderer.webcamVideoElement.currentTime = 2;
		renderer.updateWebcamOverlay();

		expect(renderer.cameraContainer.visible).toBe(true);
		expect(renderer.webcamRootContainer.visible).toBe(true);
		const bubbleLayout = renderer.webcamLayoutCache;
		expect(bubbleLayout.width).toBeCloseTo(bubbleLayout.height);
		expect(bubbleLayout.width).toBeGreaterThan(0);
		expect(bubbleLayout.width).not.toBeCloseTo(cameraFullLayout.width);
	});

	it("fills the full frame during camera-full segments when the layout style is fill", () => {
		const renderer = createRenderer() as any;
		renderer.config.webcam = {
			...DEFAULT_WEBCAM_OVERLAY,
			enabled: true,
		};
		renderer.config.webcamLayoutRegions = [{ id: "layout-1", startMs: 5_000, endMs: 9_000 }];
		renderer.config.webcamLayoutStyle = "fill";
		renderer.lastSyncedWebcamTime = 6;
		renderer.webcamVideoElement = {
			currentTime: 6,
			readyState: 2,
			seeking: false,
			videoWidth: 640,
			videoHeight: 360,
			duration: Number.NaN,
		};
		renderer.cameraContainer = { visible: true };
		renderer.webcamRootContainer = {
			visible: false,
			position: { set: vi.fn() },
		};
		renderer.webcamContainer = {
			addChildAt: vi.fn(),
		};
		renderer.webcamMaskGraphics = {
			clear: vi.fn(),
			moveTo: vi.fn(),
			lineTo: vi.fn(),
			closePath: vi.fn(),
			fill: vi.fn(),
		};
		renderer.webcamShadowLayers = [];
		renderer.animationState = {
			appliedScale: 1,
		};

		renderer.currentVideoTime = 6;
		renderer.updateWebcamOverlay();

		// Screen hidden, webcam stretched edge-to-edge with no rounding/shadow.
		expect(renderer.cameraContainer.visible).toBe(false);
		expect(renderer.webcamRootContainer.visible).toBe(true);
		const fillLayout = renderer.webcamLayoutCache;
		expect(fillLayout.width).toBeCloseTo(1920);
		expect(fillLayout.height).toBeCloseTo(1080);
		expect(fillLayout.positionX).toBeCloseTo(0);
		expect(fillLayout.positionY).toBeCloseTo(0);
		expect(fillLayout.radius).toBe(0);
		expect(fillLayout.shadowStrength).toBe(0);
		const [fillX, fillY] = renderer.webcamRootContainer.position.set.mock.calls.at(-1);
		expect(fillX).toBeCloseTo(0);
		expect(fillY).toBeCloseTo(0);

		// Outside the region: screen restored, bubble keeps its rounding/shadow.
		renderer.currentVideoTime = 2;
		renderer.lastSyncedWebcamTime = 2;
		renderer.webcamVideoElement.currentTime = 2;
		renderer.updateWebcamOverlay();

		expect(renderer.cameraContainer.visible).toBe(true);
		const bubbleLayout = renderer.webcamLayoutCache;
		expect(bubbleLayout.width).toBeCloseTo(bubbleLayout.height);
		expect(bubbleLayout.radius).toBeGreaterThan(0);
		expect(bubbleLayout.shadowStrength).toBeGreaterThan(0);
	});

	it("expands a square bubble crop to the frame aspect for camera-full fill", () => {
		const renderer = createRenderer() as any;
		renderer.config.webcam = {
			...DEFAULT_WEBCAM_OVERLAY,
			enabled: true,
			// Max centered pixel-square crop of a 1280x720 webcam: 720x720 at
			// x = 280/1280 = 0.21875 (the crop panel always stores squares).
			cropRegion: { x: 0.21875, y: 0, width: 0.5625, height: 1 },
		};
		renderer.config.webcamLayoutRegions = [{ id: "layout-1", startMs: 5_000, endMs: 9_000 }];
		renderer.config.webcamLayoutStyle = "fill";
		renderer.lastSyncedWebcamTime = 6;
		const previousHtmlVideoElement = (
			globalThis as typeof globalThis & { HTMLVideoElement?: unknown }
		).HTMLVideoElement;
		class MockHtmlVideoElement {
			currentTime = 6;
			readyState = 2;
			seeking = false;
			videoWidth = 1280;
			videoHeight = 720;
			duration = Number.NaN;
		}
		Object.assign(globalThis, { HTMLVideoElement: MockHtmlVideoElement });
		renderer.webcamVideoElement = new MockHtmlVideoElement();
		renderer.cameraContainer = { visible: true };
		renderer.webcamRootContainer = {
			visible: false,
			position: { set: vi.fn() },
		};
		renderer.webcamContainer = {
			addChildAt: vi.fn(),
		};
		renderer.webcamMaskGraphics = {
			clear: vi.fn(),
			moveTo: vi.fn(),
			lineTo: vi.fn(),
			closePath: vi.fn(),
			fill: vi.fn(),
		};
		renderer.webcamShadowLayers = [];
		renderer.animationState = {
			appliedScale: 1,
		};

		try {
			renderer.currentVideoTime = 6;
			renderer.updateWebcamOverlay();

			// The square 720x720 crop expands to the 16:9 output aspect around
			// its center: the full 1280x720 webcam frame -> fill barely crops.
			expect(renderer.webcamFrameCacheCtx.drawImage).toHaveBeenCalledWith(
				renderer.webcamVideoElement,
				0,
				0,
				1280,
				720,
				0,
				0,
				1280,
				720,
			);
			const fillLayout = renderer.webcamLayoutCache;
			expect(fillLayout.sourceWidth).toBe(1280);
			expect(fillLayout.sourceHeight).toBe(720);
			expect(fillLayout.width).toBeCloseTo(1920);
			expect(fillLayout.height).toBeCloseTo(1080);

			// Outside the region the bubble goes back to the square crop.
			renderer.currentVideoTime = 2;
			renderer.lastSyncedWebcamTime = 2;
			renderer.webcamVideoElement.currentTime = 2;
			renderer.updateWebcamOverlay();

			expect(renderer.webcamFrameCacheCtx.drawImage).toHaveBeenLastCalledWith(
				renderer.webcamVideoElement,
				280,
				0,
				720,
				720,
				0,
				0,
				720,
				720,
			);
			const bubbleLayout = renderer.webcamLayoutCache;
			expect(bubbleLayout.sourceWidth).toBe(720);
			expect(bubbleLayout.sourceHeight).toBe(720);
		} finally {
			Object.assign(globalThis, { HTMLVideoElement: previousHtmlVideoElement });
		}
	});

	it("covers the full frame for camera-full fill with a decoded export webcam source after a bubble segment", () => {
		// Export-realistic path: the webcam source is a decoded VideoFrame from
		// the streaming decoder (not a media element), the stored crop is the
		// pixel-square bubble viewport, and a screen/bubble segment renders
		// BEFORE the camera-full fill segment so the frame cache transitions
		// from the square crop to the aspect-expanded crop mid-export.
		const renderer = createRenderer() as any;
		renderer.config.webcam = {
			...DEFAULT_WEBCAM_OVERLAY,
			enabled: true,
			// Max centered pixel-square crop of a 1280x720 webcam.
			cropRegion: { x: 0.21875, y: 0, width: 0.5625, height: 1 },
		};
		renderer.config.webcamLayoutRegions = [{ id: "layout-1", startMs: 5_000, endMs: 9_000 }];
		renderer.config.webcamLayoutStyle = "fill";
		renderer.webcamDecodedFrame = {
			displayWidth: 1280,
			displayHeight: 720,
			timestamp: 0,
		};
		renderer.cameraContainer = { visible: true };
		renderer.webcamRootContainer = {
			visible: false,
			position: { set: vi.fn() },
		};
		renderer.webcamContainer = {
			addChildAt: vi.fn(),
		};
		renderer.webcamMaskGraphics = {
			clear: vi.fn(),
			moveTo: vi.fn(),
			lineTo: vi.fn(),
			closePath: vi.fn(),
			fill: vi.fn(),
		};
		renderer.webcamShadowLayers = [];
		renderer.animationState = {
			appliedScale: 1,
		};

		// Screen segment first: the bubble renders from the square crop cache.
		renderer.currentVideoTime = 2;
		renderer.lastSyncedWebcamTime = 2;
		renderer.updateWebcamOverlay();

		expect(renderer.cameraContainer.visible).toBe(true);
		const bubbleLayout = renderer.webcamLayoutCache;
		expect(bubbleLayout.sourceWidth).toBe(720);
		expect(bubbleLayout.sourceHeight).toBe(720);
		expect(renderer.webcamFrameCacheCtx.drawImage).toHaveBeenLastCalledWith(
			renderer.webcamDecodedFrame,
			280,
			0,
			720,
			720,
			0,
			0,
			720,
			720,
		);

		const bubbleTexture = renderer.webcamSprite.texture;

		// Camera-full fill segment: the cache expands to the frame aspect and
		// the layout covers the whole output frame edge to edge.
		renderer.currentVideoTime = 6;
		renderer.lastSyncedWebcamTime = 6;
		renderer.updateWebcamOverlay();

		// The frame cache canvas was recreated at the expanded size. Pixi
		// sprites only forward texture "update" events for dynamic textures, so
		// an in-place resource swap would leave the sprite's batched quad at
		// the stale square size (rendering the fill as a shrunken pillarboxed
		// rect). The texture must be replaced so the sprite re-reads its size.
		expect(renderer.webcamSprite.texture).not.toBe(bubbleTexture);
		expect(bubbleTexture.destroy).toHaveBeenCalled();

		expect(renderer.cameraContainer.visible).toBe(false);
		expect(renderer.webcamRootContainer.visible).toBe(true);
		expect(renderer.webcamFrameCacheCtx.drawImage).toHaveBeenLastCalledWith(
			renderer.webcamDecodedFrame,
			0,
			0,
			1280,
			720,
			0,
			0,
			1280,
			720,
		);
		const fillLayout = renderer.webcamLayoutCache;
		expect(fillLayout.sourceWidth).toBe(1280);
		expect(fillLayout.sourceHeight).toBe(720);
		expect(fillLayout.width).toBeCloseTo(1920);
		expect(fillLayout.height).toBeCloseTo(1080);
		expect(fillLayout.positionX).toBeCloseTo(0);
		expect(fillLayout.positionY).toBeCloseTo(0);
		expect(fillLayout.radius).toBe(0);
		// The sprite cover-fit must match the layout rect: 1920/1280 = 1.5
		// (negative X when the webcam is mirrored).
		const [scaleX, scaleY] = renderer.webcamSprite.scale.set.mock.calls.at(-1);
		expect(Math.abs(scaleX)).toBeCloseTo(1.5);
		expect(scaleY).toBeCloseTo(1.5);
		const [fillX, fillY] = renderer.webcamRootContainer.position.set.mock.calls.at(-1);
		expect(fillX).toBeCloseTo(0);
		expect(fillY).toBeCloseTo(0);
	});

	it("snapshots media-element webcam frames into the cache before rendering", () => {
		const renderer = createRenderer() as any;
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
			const renderableSource = renderer.resolveRenderableWebcamSource(
				webcamVideoElement,
				640,
				360,
				true,
				false,
			);

			expect(renderableSource?.source).toBe(renderer.webcamFrameCacheCanvas);
			expect(renderer.webcamFrameCacheCtx.drawImage).toHaveBeenCalledWith(
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
		const renderer = createRenderer() as any;
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
			const renderableSource = renderer.resolveRenderableWebcamSource(
				webcamFrame,
				640,
				360,
				true,
				false,
			);

			expect(renderableSource?.source).toBe(webcamFrame);
			expect(renderer.webcamFrameCacheCanvas).toBeNull();
		} finally {
			Object.assign(globalThis, {
				VideoFrame: previousVideoFrame,
			});
		}
	});
});

describe("ModernFrameRenderer temporal webcam sync", () => {
	it("pins webcam sync to the frame center during temporal blur sampling", async () => {
		const renderer = createRenderer() as any;
		renderer.config.annotationRegions = [];
		renderer.config.zoomTemporalMotionBlur = 1;
		renderer.config.zoomMotionBlurSampleCount = 3;
		renderer.config.zoomMotionBlurShutterFraction = 0.5;
		renderer.app = { canvas: createMockCanvas() };
		renderer.updateCaptionLayer = vi.fn();
		renderer.renderSceneSample = vi.fn(async (sampleTimestamp: number) => ({
			timeMs: sampleTimestamp / 1000,
			cursorTimeMs: sampleTimestamp / 1000,
			backgroundTimelineTimeMs: sampleTimestamp / 1000,
			sceneTransform: { scale: 1, x: 0, y: 0 },
			zoom: { scale: 1, focusX: 0.5, focusY: 0.5, progress: 0 },
		}));

		await renderer.renderTemporalMotionBlurFrame(1_000_000, 1_000_000, 1_000_000, 33_333, {
			stageSize: { width: 1920, height: 1080 },
			videoSize: { width: 1920, height: 1080 },
			baseScale: 1,
			baseOffset: { x: 0, y: 0 },
			maskRect: {
				x: 0,
				y: 0,
				width: 1920,
				height: 1080,
				sourceCrop: { x: 0, y: 0, width: 1, height: 1 },
			},
		});

		expect(renderer.renderSceneSample).toHaveBeenCalledTimes(3);
		expect(renderer.renderSceneSample.mock.calls.map((call: unknown[]) => call[6])).toEqual([
			1, 1, 1,
		]);
		expect(
			new Set(renderer.renderSceneSample.mock.calls.map((call: unknown[]) => call[0])).size,
		).toBeGreaterThan(1);
	});
});
