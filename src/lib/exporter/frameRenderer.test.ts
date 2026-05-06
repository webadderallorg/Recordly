import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WEBCAM_OVERLAY } from "../../components/video-editor/types";

const { initializeForwardFrameSourceMock, resolveMediaElementSourceMock } = vi.hoisted(() => ({
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
		initialize = initializeForwardFrameSourceMock;
	},
}));

vi.mock("./localMediaSource", () => ({
	resolveMediaElementSource: resolveMediaElementSourceMock,
}));

import { FrameRenderer } from "./frameRenderer";

type MockFunction = ReturnType<typeof vi.fn>;
type MockContext = {
	beginPath: MockFunction;
	moveTo: MockFunction;
	lineTo: MockFunction;
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

function createRenderer() {
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
	});
}

describe("FrameRenderer webcam export path", () => {
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
		expect((outputContext as MockContext).drawImage.mock.calls[0][0]).toBe(bubbleCanvas);
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
		expect((outputContext as MockContext).drawImage.mock.calls[0][0]).toBe(bubbleCanvas);
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

		const bubbleCanvas = createdCanvases[0];
		const cacheCanvas = createdCanvases[1];
		expect(cacheCanvas).toBeDefined();
		expect((cacheCanvas.context as MockContext).drawImage.mock.calls[0][0]).toBe(webcamVideo);
		expect((bubbleCanvas.context as MockContext).drawImage.mock.calls[0][0]).toBe(cacheCanvas);
		expect((outputContext as MockContext).drawImage.mock.calls[0][0]).toBe(bubbleCanvas);
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
		renderer.drawWebcamOverlay(outputContext as unknown as CanvasRenderingContext2D, 1280, 720);

		expect(createdCanvases).toHaveLength(2);
	});

	it("prefers decoder-backed sync for video wallpapers during export", async () => {
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
});
