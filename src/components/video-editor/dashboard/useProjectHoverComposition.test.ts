import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProjectHoverComposition } from "./useProjectHoverComposition";

const effects = vi.hoisted(() => [] as (() => void | (() => void))[]);
vi.mock("react", () => ({
	useState: (value: unknown) => [value, vi.fn()],
	useRef: (current: unknown) => ({ current }),
	useEffect: (effect: () => void | (() => void)) => effects.push(effect),
	useLayoutEffect: (effect: () => void | (() => void)) => effects.push(effect),
}));
vi.mock("./projectHoverFonts", () => ({ preloadProjectHoverFonts: async () => undefined }));
let cleanups: (() => void)[];
beforeEach(() => {
	effects.length = 0;
	cleanups = [];
	vi.stubGlobal("location", { href: "http://localhost/" });
	vi.stubGlobal("document", { fonts: {} });
	const Observer = class {
		observe() {}
		disconnect() {}
	};
	vi.stubGlobal("ResizeObserver", Observer);
	vi.stubGlobal("MutationObserver", Observer);
});
afterEach(() => {
	for (const cleanup of cleanups) cleanup();
	vi.unstubAllGlobals();
});

function mount(enabled: boolean, sourcePath: string | undefined, webcamUrl: string | null) {
	const onFailure = vi.fn();
	const seekTimeline = vi.fn();
	const element = Object.assign(new EventTarget(), {
		style: {},
		dataset: {},
		querySelector: () => null,
		querySelectorAll: () => [],
	});
	useProjectHoverComposition({
		data: { videoUrl: "http://localhost/recording.mp4", webcamUrl },
		playback: {
			current: {
				app: { renderer: { runners: { postrender: { add: vi.fn(), remove: vi.fn() } } } },
				containerRef: { current: null },
				seekTimeline,
			},
		},
		host: { current: element },
		rendererReady: true,
		metadataReady: true,
		telemetryReady: true,
		annotationImages: [],
		annotations: [],
		aspectRatio: 16 / 9,
		webcam: { enabled, sourcePath },
		timelineTime: { current: 0 },
		onFailure,
	} as unknown as Parameters<typeof useProjectHoverComposition>[0]);
	for (const effect of effects.splice(0)) {
		const cleanup = effect();
		if (cleanup) cleanups.push(cleanup);
	}
	return { onFailure, seekTimeline };
}

it("falls back immediately when an enabled project's required webcam source is missing", () => {
	const preview = mount(true, "/missing-camera.mp4", null);
	expect(preview.onFailure).toHaveBeenCalledOnce();
	expect(preview.seekTimeline).not.toHaveBeenCalled();
});
it.each([
	[false, "/camera.mp4", null],
	[true, undefined, null],
	[true, "/camera.mp4", "http://localhost/camera.mp4"],
] as const)("does not fail for disabled, absent, or resolvable cameras (%s, %s, %s)", (enabled, sourcePath, webcamUrl) => {
	expect(mount(enabled, sourcePath, webcamUrl).onFailure).not.toHaveBeenCalled();
});
