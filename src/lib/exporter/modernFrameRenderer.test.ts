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

	it("keeps the refresh throttle for default crop regions", () => {
		const renderer = createRenderer() as any;

		renderer.config.webcam.cropRegion = { x: 0, y: 0, width: 1, height: 1 };
		renderer.webcamFrameCacheCanvas = { width: 1280, height: 720 };
		renderer.lastWebcamCacheRefreshTime = 10;
		renderer.currentVideoTime = 10.1;

		expect(renderer.shouldRefreshWebcamFrameCache(1280, 720)).toBe(false);
	});

	it("bypasses the refresh throttle for cropped webcam regions", () => {
		const renderer = createRenderer() as any;

		renderer.config.webcam.cropRegion = { x: 0.25, y: 0, width: 0.5, height: 1 };
		renderer.webcamFrameCacheCanvas = { width: 640, height: 720 };
		renderer.lastWebcamCacheRefreshTime = 10;
		renderer.currentVideoTime = 10.1;

		expect(renderer.shouldRefreshWebcamFrameCache(1280, 720)).toBe(true);
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
});
