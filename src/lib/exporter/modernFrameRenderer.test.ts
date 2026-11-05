import { describe, expect, it, vi } from "vitest";

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

it("bypasses blur annotation compositing during gaps and clears stale composite frames", async () => {
	const renderer = createRenderer();
	const camera = { visible: true };
	const canvas = createMockCanvas();
	const render = vi.fn();
	const compose = vi.fn();
	const webcam = { visible: true };
	const captions = { visible: true };
	Object.assign(renderer.scene, {
		app: { canvas, render },
		videoContainer: {},
		videoMaskGraphics: {},
		cameraContainer: camera,
		webcamRootContainer: webcam,
		captionContainer: captions,
	});
	Object.assign(renderer.annotations, {
		hasActiveBlurAnnotations: () => true,
		composeBlurAnnotationFrame: compose,
		outputCanvasOverride: createMockCanvas(),
	});
	await renderer.renderFrame(null, 0, 0, 33333, 1500000);
	expect(camera.visible).toBe(false);
	expect(webcam.visible).toBe(false);
	expect(captions.visible).toBe(false);
	expect(compose).not.toHaveBeenCalled();
	expect(render).toHaveBeenCalledOnce();
	expect(renderer.getCanvas()).toBe(canvas);
});

describe("ModernFrameRenderer Pixi lifecycle", () => {
	it("defaults to WebGL even when WebGPU is available", async () => {
		pixiApplicationInstancesMock.length = 0;
		pixiInitializationErrorsMock.length = 0;
		vi.stubGlobal("navigator", { gpu: {} });
		try {
			const renderer = createRenderer();
			renderer.config.preferredRenderBackend = undefined;
			await expect(
				renderer.scene.createPixiApplication({} as HTMLCanvasElement),
			).resolves.toMatchObject({ backend: "webgl" });
			expect(pixiApplicationInstancesMock).toHaveLength(1);
			expect(pixiApplicationInstancesMock[0].init).toHaveBeenCalledWith(
				expect.objectContaining({ preference: "webgl" }),
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("reports the actual WebGL renderer when Pixi falls back from a WebGPU preference", async () => {
		pixiApplicationInstancesMock.length = 0;
		pixiInitializationErrorsMock.length = 0;
		vi.stubGlobal("navigator", { gpu: {} });
		try {
			const renderer = createRenderer() as unknown as {
				config: { preferredRenderBackend?: "webgl" | "webgpu" };
				scene: {
					createPixiApplication: (
						canvas: HTMLCanvasElement,
					) => Promise<{ backend: string }>;
				};
			};
			renderer.config.preferredRenderBackend = "webgpu";
			const pending = renderer.scene.createPixiApplication({} as HTMLCanvasElement);
			Object.assign(pixiApplicationInstancesMock[0].renderer, { type: 1 });
			await expect(pending).resolves.toMatchObject({ backend: "webgl" });
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("continues to the next backend when failed-init cleanup would throw", async () => {
		pixiApplicationInstancesMock.length = 0;
		pixiInitializationErrorsMock.length = 0;
		pixiInitializationErrorsMock.push(new Error("WebGPU initialization failed"), undefined);
		vi.stubGlobal("navigator", { gpu: {} });

		try {
			const renderer = createRenderer() as unknown as {
				config: { preferredRenderBackend?: "webgl" | "webgpu" };
				scene: {
					createPixiApplication: (
						canvas: HTMLCanvasElement,
					) => Promise<{ backend: "webgl" | "webgpu" }>;
				};
			};
			renderer.config.preferredRenderBackend = "webgpu";

			await expect(
				renderer.scene.createPixiApplication({} as HTMLCanvasElement),
			).resolves.toMatchObject({
				backend: "webgl",
			});

			expect(pixiApplicationInstancesMock).toHaveLength(2);
			expect(pixiApplicationInstancesMock[0].destroy).not.toHaveBeenCalled();
			expect(pixiApplicationInstancesMock[0].stage.destroy).toHaveBeenCalledTimes(1);
			expect(pixiApplicationInstancesMock[0].renderer.destroy).toHaveBeenCalledTimes(1);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe("ModernFrameRenderer frame sequencing", () => {
	it("resumes visual layers after a background gap", async () => {
		const renderer = createRenderer();
		const sceneCanvas = createMockCanvas();
		const gapCanvas = createMockCanvas();
		gapCanvas.width = 1920;
		gapCanvas.height = 1080;
		const render = vi.fn();
		const syncWebcam = vi.fn();
		const syncBackground = vi.fn();
		const updateAnnotations = vi.fn();
		const updateCaptions = vi.fn();
		const updateWebcam = vi.fn();
		const updateAnimation = vi.fn();
		const camera = { visible: true };
		Object.assign(renderer, {
			config: {
				width: 1920,
				height: 1080,
				timelineEffects: true,
				zoomMotionBlur: 0.5,
			},
		});
		Object.assign(renderer.scene, {
			app: { canvas: sceneCanvas, render },
			videoContainer: {},
			videoMaskGraphics: {},
			cameraContainer: camera,
			videoSprite: {},
			videoTextureSource: { update: vi.fn() },
		});
		Object.assign(renderer.geometry, {
			layoutCache: {
				stageSize: { width: 1920, height: 1080 },
				maskRect: { x: 0, y: 0, width: 1920, height: 1080 },
			},
		});
		Object.assign(renderer.textures, {
			resolveDetachedVideoFrameSource: async (frame: VideoFrame) => frame,
		});
		Object.assign(renderer.annotations, {
			ensureExportCompositeCanvas: () => ({ canvas: gapCanvas, context: gapCanvas.context }),
			updateAnnotationLayer: updateAnnotations,
		});
		Object.assign(renderer.webcamMedia, {
			webcamForwardFrameSource: {},
			syncWebcamFrame: syncWebcam,
		});
		Object.assign(renderer.backgroundPlayback, {
			backgroundForwardFrameSource: {},
			syncBackgroundFrame: syncBackground,
		});
		Object.assign(renderer.motion, {
			updateAnimationState: updateAnimation,
		});
		Object.assign(renderer.captions, {
			updateCaptionLayer: updateCaptions,
		});
		Object.assign(renderer.webcam, {
			updateWebcamOverlay: updateWebcam,
		});
		await renderer.renderFrame({} as VideoFrame, 0, 0, 33_333, 0);
		expect(renderer.getCanvas()).toBe(sceneCanvas);

		await renderer.renderFrame(null, 0, 0, 33_333, 1_500_000);
		expect(updateAnimation).toHaveBeenLastCalledWith(1500, 0);
		expect(renderer.getCanvas()).toBe(sceneCanvas);
		expect(render).toHaveBeenCalledTimes(2);
		expect(syncBackground).toHaveBeenCalledTimes(2);
		expect(camera.visible).toBe(false);
		for (const callback of [syncWebcam, updateAnnotations, updateCaptions, updateWebcam]) {
			expect(callback).toHaveBeenCalledTimes(1);
		}

		await renderer.renderFrame({} as VideoFrame, 6_000_000, 6_000_000, 33_333, 2_000_000);
		expect(renderer.getCanvas()).toBe(sceneCanvas);
		expect(camera.visible).toBe(true);
		expect(render).toHaveBeenCalledTimes(3);
		expect(syncWebcam).toHaveBeenLastCalledWith(6);
		expect(syncBackground).toHaveBeenLastCalledWith(2);
		expect(updateAnnotations).toHaveBeenLastCalledWith(2000);
		expect(updateCaptions).toHaveBeenLastCalledWith(6000);
	});
});
