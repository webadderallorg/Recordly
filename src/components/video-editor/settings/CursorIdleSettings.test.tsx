import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CursorSettings } from "./CursorSettings";
import { resolveSettingsPanelProps } from "./settingsPanelDefaults";

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
