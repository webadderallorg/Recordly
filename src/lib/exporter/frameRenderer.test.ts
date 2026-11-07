import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
	Application: vi.fn(),
	Container: vi.fn(),
	Sprite: vi.fn(),
	Graphics: vi.fn(),
	BlurFilter: vi.fn(),
	Texture: {
		from: vi.fn(() => ({ destroy: vi.fn() })),
	},
}));

vi.mock("pixi-filters/motion-blur", () => ({
	MotionBlurFilter: vi.fn(),
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

vi.mock("./annotationRenderer", () => ({
	renderAnnotations: vi.fn(),
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

import { FrameRenderer } from "./frameRenderer";

const rendererSource = readFileSync(
	fileURLToPath(new URL("./legacyFrameBackend.ts", import.meta.url)),
	"utf8",
);

type MockFunction = ReturnType<typeof vi.fn>;
type MockContext = {
	beginPath: MockFunction;
	moveTo: MockFunction;
	lineTo: MockFunction;
	arcTo: MockFunction;
	closePath: MockFunction;
	clip: MockFunction;
	drawImage: MockFunction;
	fillRect: MockFunction;
	save: MockFunction;
	restore: MockFunction;
	translate: MockFunction;
	scale: MockFunction;
	clearRect: MockFunction;
	filter: string;
	fillStyle: string;
};
type MockCanvas = ReturnType<typeof createMockCanvas>;
type FrameRendererTestAccess = {
	webcamVideoElement: FakeVideoElement | null;
	webcamSeekPromise: Promise<void> | null;
	webcamFrameCacheCanvas: MockCanvas | null;
	webcamFrameCacheCtx: CanvasRenderingContext2D | null;
	lastSyncedWebcamTime: number | null;
	currentVideoTime: number;
	animationState: { appliedScale: number };
	syncWebcamFrame: (targetTimeSec: number) => Promise<void>;
	drawWebcamOverlay: (
		outputCtx: CanvasRenderingContext2D,
		outputWidth: number,
		outputHeight: number,
	) => void;
};

describe("FrameRenderer mask hierarchy", () => {
	it("keeps the mask in the video wrapper when camera transforms change", () => {
		expect(rendererSource).toContain(
			"context.cameraContainer.addChild(context.videoEffectsContainer)",
		);
		expect(rendererSource).toContain(
			"context.videoEffectsContainer.addChild(context.maskGraphics)",
		);
		expect(rendererSource).not.toContain(
			"context.cameraContainer.addChild(context.maskGraphics)",
		);
	});
});

type Listener = {
	callback: () => void;
	once: boolean;
};

class FakeVideoElement {
	duration: number;
	readyState: number;
	seeking = false;
	videoWidth: number;
	videoHeight: number;
	muted = true;
	preload = "auto";
	playsInline = true;
	src = "";

	private currentTimeValue: number;
	private listeners = new Map<string, Listener[]>();

	constructor({
		duration = 5,
		currentTime = 0,
		readyState = 2,
		videoWidth = 1280,
		videoHeight = 720,
	}: {
		duration?: number;
		currentTime?: number;
		readyState?: number;
		videoWidth?: number;
		videoHeight?: number;
	} = {}) {
		this.duration = duration;
		this.currentTimeValue = currentTime;
		this.readyState = readyState;
		this.videoWidth = videoWidth;
		this.videoHeight = videoHeight;
	}

	get currentTime() {
		return this.currentTimeValue;
	}

	set currentTime(next: number) {
		this.currentTimeValue = next;
		this.seeking = true;
		queueMicrotask(() => {
			this.seeking = false;
			this.dispatch("seeked");
		});
	}

	addEventListener(
		name: string,
		callback: () => void,
		options?: boolean | AddEventListenerOptions,
	) {
		const listeners = this.listeners.get(name) ?? [];
		listeners.push({
			callback,
			once: !!(typeof options === "object" && options?.once),
		});
		this.listeners.set(name, listeners);
	}

	removeEventListener(name: string, callback: () => void) {
		const listeners = this.listeners.get(name) ?? [];
		this.listeners.set(
			name,
			listeners.filter((listener) => listener.callback !== callback),
		);
	}

	load() {
		// Intentional no-op for the mock video element.
	}

	pause() {
		// Intentional no-op for the mock video element.
	}

	private dispatch(name: string) {
		const listeners = [...(this.listeners.get(name) ?? [])];
		if (listeners.length === 0) {
			return;
		}

		for (const listener of listeners) {
			listener.callback();
			if (listener.once) {
				this.removeEventListener(name, listener.callback);
			}
		}
	}
}

function createMockContext() {
	return {
		beginPath: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		arcTo: vi.fn(),
		closePath: vi.fn(),
		clip: vi.fn(),
		drawImage: vi.fn(),
		fillRect: vi.fn(),
		save: vi.fn(),
		restore: vi.fn(),
		translate: vi.fn(),
		scale: vi.fn(),
		clearRect: vi.fn(),
		filter: "",
		fillStyle: "",
	};
}

function createMockCanvas() {
	const context = createMockContext();
	return {
		width: 0,
		height: 0,
		context,
		getContext: vi.fn((_type?: string) => context as unknown as CanvasRenderingContext2D),
	};
}

function createRenderer(overrides: Partial<ConstructorParameters<typeof FrameRenderer>[0]> = {}) {
	return new FrameRenderer({
		width: 1920,
		height: 1080,
		wallpaper: "#000000",
		zoomRegions: [],
		showShadow: false,
		shadowIntensity: 0,
		backgroundBlur: 0,
		cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		webcam: {
			...DEFAULT_WEBCAM_OVERLAY,
			enabled: true,
			mirror: false,
			shadow: 0,
		},
		webcamUrl: "file:///tmp/webcam.webm",
		videoWidth: 1920,
		videoHeight: 1080,
		...overrides,
	});
}

describe("FrameRenderer webcam export path", () => {
	it("composites the background during a gap without source layers", async () => {
		const renderer = createRenderer();
		const camera = { visible: true };
		const context = createMockContext();
		const app = { stage: {}, renderer: { render: vi.fn() } };
		const composite = vi.fn();
		Object.assign(renderer, {
			app,
			cameraContainer: camera,
			videoContainer: {},
			compositeCtx: context,
			compositeWithShadows: composite,
		});
		await renderer.renderFrame(null, 0, 0, 33333, 1500000);
		expect(camera.visible).toBe(false);
		expect(app.renderer.render).toHaveBeenCalledWith(app.stage);
		expect(composite).toHaveBeenCalledWith(false);
	});
	const createdCanvases: ReturnType<typeof createMockCanvas>[] = [];

	beforeEach(() => {
		createdCanvases.length = 0;

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
						return new FakeVideoElement();
					}
					if (tag !== "canvas") {
						throw new Error(`Unexpected element requested in test: ${tag}`);
					}

					const canvas = createMockCanvas();
					createdCanvases.push(canvas);
					return canvas;
				}),
			},
		});
	});

	it("seeks optional sample media directly without starting forward decoders", async () => {
		vi.clearAllMocks();
		const renderer = createRenderer({
			preferMediaElementSampling: true,
			wallpaper: "/wallpapers/wispysky.mp4",
		});
		const access = renderer as unknown as FrameRendererTestAccess & {
			setupWebcamSource(): Promise<void>;
			setupBackground(): Promise<void>;
			backgroundVideoElement: FakeVideoElement;
		};
		await access.setupWebcamSource();
		await access.setupBackground();
		expect(initializeForwardFrameSourceMock).not.toHaveBeenCalled();
		expect(resolveMediaElementSourceMock).toHaveBeenCalledTimes(2);
		access.webcamVideoElement!.duration = 600;
		await access.syncWebcamFrame(300);
		expect(access.webcamVideoElement!.currentTime).toBe(300);
		expect(getForwardFrameAtTimeMock).not.toHaveBeenCalled();
		expect(access.backgroundVideoElement).toBeTruthy();
	});

	it("cancels pending optional-media readiness without waiting for a media event", async () => {
		const createElement = document.createElement.bind(document);
		vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
			tag === "video"
				? new FakeVideoElement({ readyState: 0 })
				: createElement(tag)) as typeof document.createElement);
		const renderer = createRenderer({ preferMediaElementSampling: true });
		const access = renderer as unknown as { setupWebcamSource(): Promise<void> };
		const loading = access.setupWebcamSource();
		await Promise.resolve();
		renderer.cancelPendingMedia();
		await expect(loading).resolves.toBeUndefined();
	});

	it("settles an optional-media seek immediately when sampling is cancelled", async () => {
		vi.useFakeTimers();
		try {
			const renderer = createRenderer({ preferMediaElementSampling: true });
			const access = renderer as unknown as FrameRendererTestAccess;
			access.webcamVideoElement = new FakeVideoElement({ duration: 600 });
			const seeking = access.syncWebcamFrame(300);
			renderer.cancelPendingMedia();
			await expect(seeking).resolves.toBeUndefined();
			expect(access.webcamSeekPromise).toBeNull();
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("cancels forward media reads while retaining in-flight renderer resources", () => {
		const renderer = createRenderer();
		const app = { destroy: vi.fn() };
		const background = { cancel: vi.fn(), destroy: vi.fn() };
		const webcam = { cancel: vi.fn(), destroy: vi.fn() };
		Object.assign(renderer, {
			app,
			backgroundForwardFrameSource: background,
			webcamForwardFrameSource: webcam,
		});
		renderer.cancelPendingMedia();
		expect(background.cancel).toHaveBeenCalledOnce();
		expect(webcam.cancel).toHaveBeenCalledOnce();
		expect(background.destroy).not.toHaveBeenCalled();
		expect(webcam.destroy).not.toHaveBeenCalled();
		expect(app.destroy).not.toHaveBeenCalled();
	});

	it("clamps webcam sync seeks to the media duration", async () => {
		const renderer = createRenderer() as unknown as FrameRendererTestAccess;
		const webcamVideo = new FakeVideoElement({ duration: 4.5, currentTime: 0.25 });
		renderer.webcamVideoElement = webcamVideo;

		await renderer.syncWebcamFrame(12);

		expect(webcamVideo.currentTime).toBe(4.5);
		expect(renderer.lastSyncedWebcamTime).toBe(4.5);
		expect(renderer.webcamSeekPromise).toBeNull();
	});

	it("subtracts stored webcam offsets during export sync", async () => {
		const renderer = createRenderer() as unknown as FrameRendererTestAccess & {
			config: { webcam?: { timeOffsetMs?: number } };
		};
		const webcamVideo = new FakeVideoElement({ duration: 10, currentTime: 0.25 });
		renderer.webcamVideoElement = webcamVideo;
		renderer.config.webcam = {
			...(renderer.config.webcam ?? {}),
			timeOffsetMs: 250,
		};

		await renderer.syncWebcamFrame(2);

		expect(webcamVideo.currentTime).toBe(1.75);
		expect(renderer.lastSyncedWebcamTime).toBe(1.75);
		expect(renderer.webcamSeekPromise).toBeNull();
	});

	it("falls back to animation frame when requestVideoFrameCallback does not fire", async () => {
		const renderer = createRenderer() as unknown as FrameRendererTestAccess;
		const webcamVideo = new FakeVideoElement({
			duration: 4.5,
			currentTime: 0.25,
		}) as FakeVideoElement & {
			requestVideoFrameCallback?: (callback: () => void) => number;
			cancelVideoFrameCallback?: (handle: number) => void;
		};
		webcamVideo.requestVideoFrameCallback = vi.fn(() => 7);
		webcamVideo.cancelVideoFrameCallback = vi.fn();
		renderer.webcamVideoElement = webcamVideo;

		await renderer.syncWebcamFrame(1.5);

		expect(webcamVideo.currentTime).toBe(1.5);
		expect(renderer.lastSyncedWebcamTime).toBe(1.5);
		expect(webcamVideo.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
		expect(webcamVideo.cancelVideoFrameCallback).not.toHaveBeenCalled();
		expect(renderer.webcamSeekPromise).toBeNull();
	});

	it("keeps a cropped camera without an explicit shape square in legacy export", () => {
		const renderer = createRenderer({
			webcam: {
				enabled: true,
				shape: undefined,
				width: 30,
				height: 30,
				cropRegion: { x: 0, y: 0, width: 0.5, height: 1 },
			},
		}) as unknown as FrameRendererTestAccess & {
			webcamMotionBlur: { render: (...args: unknown[]) => null };
		};
		const cached = createMockCanvas();
		cached.width = 640;
		cached.height = 360;
		renderer.webcamVideoElement = new FakeVideoElement({
			currentTime: 0,
			readyState: 0,
			videoWidth: 640,
			videoHeight: 360,
		});
		renderer.webcamFrameCacheCanvas = cached;
		renderer.webcamFrameCacheCtx = cached.getContext("2d");
		renderer.currentVideoTime = 0;
		renderer.animationState.appliedScale = 1;
		const render = vi.spyOn(renderer.webcamMotionBlur, "render").mockReturnValue(null);
		renderer.drawWebcamOverlay(
			createMockContext() as unknown as CanvasRenderingContext2D,
			1280,
			720,
		);
		expect(render).toHaveBeenCalledWith(
			expect.objectContaining({
				shape: "squircle",
				layout: expect.objectContaining({ width: 216, height: 216 }),
			}),
		);
	});

	it("uses the cached webcam frame when the live video is out of sync", () => {
		const renderer = createRenderer() as unknown as FrameRendererTestAccess;
		const outputContext = createMockContext();
		const webcamVideo = new FakeVideoElement({
			currentTime: 2,
			readyState: 2,
			videoWidth: 640,
			videoHeight: 360,
		});
		const cachedFrameCanvas = createMockCanvas();
		cachedFrameCanvas.width = 640;
		cachedFrameCanvas.height = 360;

		renderer.webcamVideoElement = webcamVideo;
		renderer.webcamFrameCacheCanvas = cachedFrameCanvas;
		renderer.webcamFrameCacheCtx = cachedFrameCanvas.getContext("2d");
		renderer.lastSyncedWebcamTime = 1.5;
		renderer.currentVideoTime = 2;
		renderer.animationState.appliedScale = 1;

		renderer.drawWebcamOverlay(outputContext as unknown as CanvasRenderingContext2D, 1280, 720);

		const bubbleCanvas = createdCanvases[0];
		expect(bubbleCanvas).toBeDefined();
		expect((bubbleCanvas.context as MockContext).drawImage.mock.calls[0][0]).toBe(
			cachedFrameCanvas,
		);
		expect((outputContext as MockContext).drawImage.mock.calls[0][0]).toBe(
			createdCanvases.at(-1),
		);
	});

	it("keeps drawing the cached webcam frame when the live element temporarily has no current data", () => {
		const renderer = createRenderer() as unknown as FrameRendererTestAccess;
		const outputContext = createMockContext();
		const webcamVideo = new FakeVideoElement({
			currentTime: 2,
			readyState: 0,
			videoWidth: 640,
			videoHeight: 360,
		});
		const cachedFrameCanvas = createMockCanvas();
		cachedFrameCanvas.width = 640;
		cachedFrameCanvas.height = 360;

		renderer.webcamVideoElement = webcamVideo;
		renderer.webcamFrameCacheCanvas = cachedFrameCanvas;
		renderer.webcamFrameCacheCtx = cachedFrameCanvas.getContext("2d");
		renderer.lastSyncedWebcamTime = 2;
		renderer.currentVideoTime = 2;
		renderer.animationState.appliedScale = 1;

		renderer.drawWebcamOverlay(outputContext as unknown as CanvasRenderingContext2D, 1280, 720);

		const bubbleCanvas = createdCanvases[0];
		expect(bubbleCanvas).toBeDefined();
		expect((bubbleCanvas.context as MockContext).drawImage.mock.calls[0][0]).toBe(
			cachedFrameCanvas,
		);
		expect((outputContext as MockContext).drawImage.mock.calls[0][0]).toBe(
			createdCanvases.at(-1),
		);
	});

	it("uses the live webcam frame and refreshes the cache when the video is synchronized", () => {
		const renderer = createRenderer() as unknown as FrameRendererTestAccess;
		const outputContext = createMockContext();
		const webcamVideo = new FakeVideoElement({
			currentTime: 2,
			readyState: 2,
			videoWidth: 800,
			videoHeight: 600,
		});

		renderer.webcamVideoElement = webcamVideo;
		renderer.lastSyncedWebcamTime = 2;
		renderer.currentVideoTime = 2;
		renderer.animationState.appliedScale = 1;

		renderer.drawWebcamOverlay(outputContext as unknown as CanvasRenderingContext2D, 1280, 720);

		const cacheCanvas = createdCanvases[0];
		const bubbleCanvas = createdCanvases[1];
		expect(cacheCanvas).toBeDefined();
		expect((cacheCanvas.context as MockContext).drawImage.mock.calls[0][0]).toBe(webcamVideo);
		expect((bubbleCanvas.context as MockContext).drawImage.mock.calls[0][0]).toBe(cacheCanvas);
		expect((outputContext as MockContext).drawImage.mock.calls[0][0]).toBe(
			createdCanvases.at(-1),
		);
	});

	it("uses the live webcam frame when sync is correct on an offset webcam timeline", () => {
		const renderer = createRenderer() as unknown as FrameRendererTestAccess & {
			config: { webcam: { timeOffsetMs?: number } };
		};
		const outputContext = createMockContext();
		const webcamVideo = new FakeVideoElement({
			currentTime: 1.75,
			readyState: 2,
			videoWidth: 800,
			videoHeight: 600,
			duration: 10,
		});

		renderer.config.webcam = {
			...renderer.config.webcam,
			timeOffsetMs: 250,
		};
		renderer.webcamVideoElement = webcamVideo;
		renderer.lastSyncedWebcamTime = 1.75;
		renderer.currentVideoTime = 2;
		renderer.animationState.appliedScale = 1;

		renderer.drawWebcamOverlay(outputContext as unknown as CanvasRenderingContext2D, 1280, 720);

		const cacheCanvas = createdCanvases[0];
		const bubbleCanvas = createdCanvases[1];
		expect(cacheCanvas).toBeDefined();
		expect((cacheCanvas.context as MockContext).drawImage.mock.calls[0][0]).toBe(webcamVideo);
		expect((bubbleCanvas.context as MockContext).drawImage.mock.calls[0][0]).toBe(cacheCanvas);
		expect((outputContext as MockContext).drawImage.mock.calls[0][0]).toBe(
			createdCanvases.at(-1),
		);
	});

	it("reuses the webcam bubble canvas across frames", () => {
		const renderer = createRenderer() as unknown as FrameRendererTestAccess;
		const outputContext = createMockContext();
		const webcamVideo = new FakeVideoElement({
			currentTime: 2,
			readyState: 2,
			videoWidth: 800,
			videoHeight: 600,
		});

		renderer.webcamVideoElement = webcamVideo;
		renderer.lastSyncedWebcamTime = 2;
		renderer.currentVideoTime = 2;
		renderer.animationState.appliedScale = 1;

		renderer.drawWebcamOverlay(outputContext as unknown as CanvasRenderingContext2D, 1280, 720);
		const canvasCount = createdCanvases.length;
		renderer.drawWebcamOverlay(outputContext as unknown as CanvasRenderingContext2D, 1280, 720);

		expect(createdCanvases).toHaveLength(canvasCount);
	});

	it("prefers decoder-backed sync for video wallpapers during export", async () => {
		vi.clearAllMocks();
		const renderer = new FrameRenderer({
			width: 1920,
			height: 1080,
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
		}) as unknown as {
			setupBackground: () => Promise<void>;
			backgroundForwardFrameSource: unknown;
			backgroundVideoElement: FakeVideoElement | null;
			backgroundSprite: MockCanvas | null;
		};

		await renderer.setupBackground();

		expect(initializeForwardFrameSourceMock).toHaveBeenCalledWith("wallpapers/wispysky.mp4");
		expect(resolveMediaElementSourceMock).not.toHaveBeenCalled();
		expect(renderer.backgroundForwardFrameSource).toBeTruthy();
		expect(renderer.backgroundVideoElement).toBeNull();
		expect(renderer.backgroundSprite).toBeTruthy();
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
		}) as unknown as {
			setupBackground: () => Promise<void>;
			syncBackgroundFrame: (timeSeconds: number) => Promise<void>;
			backgroundForwardFrameSource: unknown;
			backgroundVideoElement: FakeVideoElement | null;
		};

		await renderer.setupBackground();
		await expect(renderer.syncBackgroundFrame(1)).resolves.toBeUndefined();

		expect(cancelForwardFrameSourceMock).toHaveBeenCalled();
		expect(destroyForwardFrameSourceMock).toHaveBeenCalled();
		expect(resolveMediaElementSourceMock).toHaveBeenCalledWith("wallpapers/wispysky.mp4");
		expect(renderer.backgroundForwardFrameSource).toBeNull();
		expect(renderer.backgroundVideoElement).toBeTruthy();
	});
});
