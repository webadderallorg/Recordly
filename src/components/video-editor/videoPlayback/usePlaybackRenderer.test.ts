import { expect, it, vi } from "vitest";
import { usePlaybackRenderer } from "./usePlaybackRenderer";

const mocks = vi.hoisted(() => ({
	cleanup: undefined as (() => void) | undefined,
	preload: vi.fn(),
	initialize: vi.fn(),
}));
vi.mock("react", () => ({
	useRef: (current: unknown) => ({ current }),
	useEffect: (effect: () => () => void) => {
		mocks.cleanup = effect();
	},
}));
vi.mock("pixi.js", () => ({ Application: class {}, Container: class {} }));
vi.mock("./cursorRenderer", () => ({
	preloadCursorAssets: mocks.preload,
	DEFAULT_CURSOR_CONFIG: { dotRadius: 28 },
	PixiCursorOverlay: class {},
}));
vi.mock("./initializePreviewRenderer", () => ({
	initializePixiRenderer: mocks.initialize,
	toRendererErrorMessage: String,
}));
vi.mock("@/lib/exporter/videoBlurFilters", () => ({ createVideoBlurFilters: vi.fn() }));
vi.mock("@/lib/pixiApplicationLifecycle", () => ({ destroyPixiApplication: vi.fn() }));

it("does not allocate a GPU context after a hover leaves during shared asset loading", async () => {
	let finishLoading = () => {};
	mocks.preload.mockReturnValue(
		new Promise<void>((resolve) => {
			finishLoading = resolve;
		}),
	);
	const ref = () => ({ current: null });
	usePlaybackRenderer({
		containerRef: { current: {} },
		appRef: ref(),
		cameraContainerRef: ref(),
		videoEffectsContainerRef: ref(),
		zoomBlurFilterRef: ref(),
		motionBlurFilterRef: ref(),
		videoContainerRef: ref(),
		cursorContainerRef: ref(),
		cursorOverlayRef: ref(),
		videoSpriteRef: ref(),
		setPixiReady: vi.fn(),
		onError: vi.fn(),
	} as unknown as Parameters<typeof usePlaybackRenderer>[0]);
	mocks.cleanup?.();
	finishLoading();
	await Promise.resolve();
	await Promise.resolve();
	expect(mocks.initialize).not.toHaveBeenCalled();
});
