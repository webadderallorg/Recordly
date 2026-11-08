import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CursorSettings } from "./CursorSettings";
import { resolveSettingsPanelProps } from "./settingsPanelDefaults";

import { CursorStylePreview } from "./CursorAppearancePreviews";
const previews = vi.hoisted(() => ({
	urls: null as Record<string, { url: string; offsetX: number; offsetY: number }> | null,
	get: vi.fn(),
	cleanup: [] as Array<() => void>,
}));
vi.mock("@/components/video-editor/videoPlayback/cursorRenderer", () => ({
	getCursorStylePreview: previews.get,
}));
afterEach(() => {
	for (const cleanup of previews.cleanup.splice(0)) cleanup();
	vi.doUnmock("react");
	vi.resetModules();
	vi.restoreAllMocks();
});
async function loadPreviewFixture() {
	previews.urls = null;
	// Scope mocked hooks to this dynamic hook import; existing section SSR stays real.
	vi.doMock("react", async (importOriginal) => ({
		...(await importOriginal<typeof import("react")>()),
		useRef: <T,>(value: T) => ({ current: value }),
		useState: (value: unknown) => [
			value,
			(urls: NonNullable<typeof previews.urls>) => {
				previews.urls = urls;
			},
		],
		useEffect: (effect: () => void | (() => void)) => {
			const cleanup = effect();
			if (cleanup) previews.cleanup.push(cleanup);
		},
	}));
	const { useCursorSettings } = await import("./useCursorSettings");
	// The dynamic hook fixture evaluates asynchronous preview availability with mocked hooks.
	return useCursorSettings({ cursorClickBounce: 1 } as Parameters<typeof useCursorSettings>[0]);
}

vi.mock("@/contexts/I18nContext", () => ({
	useI18n: () => ({ locale: "en", t: (key: string, fallback?: string) => fallback || key }),
	useScopedT: () => (key: string, fallback?: string) => fallback || key,
}));

const cursor = {
	lastCursorBounceStrength: { current: 1 },
	cursorPreviewUrls: {},
	showDevMotionControls: false,
	cursorStyleOptions: [],
	resetCursorSection: vi.fn(),
};
function render(advanced: boolean, enabled = true) {
	const props = resolveSettingsPanelProps({
		selected: "wallpaper.png",
		aspectRatio: "native",
		onWallpaperChange: vi.fn(),
		advanced,
		cursorIdleHide: {
			enabled,
			idleThresholdMs: 2000,
			fadeDelayMs: 500,
			fadeDurationMs: 300,
			movementTolerancePx: 2,
		},
	});
	return renderToStaticMarkup(<CursorSettings {...props} cursor={cursor} />);
}

describe("cursor idle controls", () => {
	it("shows the enabled toggle in basic mode without advanced timing controls", () => {
		const markup = render(false);
		expect(markup).toContain('aria-label="Hide cursor when idle"');
		expect(markup).toMatch(/aria-label="Hide cursor when idle"[^>]*checked=""/);
		expect(markup).not.toContain('aria-label="Idle detection"');
	});
	it("shows timing and jitter tolerance only when advanced mode and the feature are enabled", () => {
		const markup = render(true);
		expect(markup).toContain("Idle detection");
		expect(markup).toContain("Fade duration");
		expect(markup).toContain("Movement tolerance");
		expect(markup).toContain("After a short delay");
		expect(markup).toContain("Fade delay");
		expect(render(true, false)).not.toContain("Movement tolerance");
	});
});

describe("cursor preview availability", () => {
	it("keeps arrow previews and other pointer images when one optional pointer fails", async () => {
		previews.get.mockImplementation(async (style: string, kind = "arrow") => {
			if (style === "tahoe" && kind === "pointer")
				throw new Error("Pointer image unavailable");
			return { url: `${style}-${kind}`, offsetX: 0, offsetY: 0 };
		});
		await loadPreviewFixture();
		await vi.waitFor(() => expect(previews.urls?.tahoe.url).toBe("tahoe-arrow"));
		expect(previews.urls?.["tahoe:pointer"]).toBeUndefined();
		expect(previews.urls?.["figma:pointer"].url).toBe("figma-pointer");
		const markup = renderToStaticMarkup(
			<CursorStylePreview style="tahoe" previewUrls={previews.urls!} />,
		);
		expect(markup.match(/src="tahoe-arrow"/g)).toHaveLength(2);
	});
	it("keeps reporting a required default preview failure", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		previews.get.mockImplementation(async (style: string, kind = "arrow") => {
			if (style === "tahoe" && kind === "arrow") throw new Error("Default image unavailable");
			return { url: `${style}-${kind}`, offsetX: 0, offsetY: 0 };
		});
		await loadPreviewFixture();
		await vi.waitFor(() =>
			expect(warn).toHaveBeenCalledWith("Failed to load cursor previews", expect.any(Error)),
		);
		expect(previews.urls).toBeNull();
	});
});
