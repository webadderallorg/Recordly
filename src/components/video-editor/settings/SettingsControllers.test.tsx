import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CURSOR_MOTION_PRESETS } from "../cursorMotionPresets";
import { DEFAULT_EDITOR_PREFERENCES } from "../editorPreferences";
import { DEFAULT_CURSOR_CLICK_BOUNCE, DEFAULT_PADDING } from "../types";
import { resolveSettingsPanelProps } from "./settingsPanelDefaults";
import { useAppSettings } from "./useAppSettings";
import { useFrameSettings } from "./useFrameSettings";

vi.mock("@/contexts/I18nContext", () => ({
	useI18n: () => ({ locale: "en", t: (key: string) => key }),
	useScopedT: () => (key: string) => key,
}));
vi.mock("@/contexts/ThemeContext", () => ({
	useTheme: () => ({ preference: "system", setPreference: vi.fn() }),
}));
vi.mock("@/contexts/ShortcutsContext", () => ({ useShortcuts: () => ({ openConfig: vi.fn() }) }));

// Real React renders the controllers; their refs and callbacks stay alive for the assertions.
function captureController<T>(read: () => T): T {
	let controller: T;
	function Capture() {
		controller = read();
		return null;
	}
	renderToStaticMarkup(<Capture />);
	return controller!;
}
const panel = (overrides: Partial<Parameters<typeof resolveSettingsPanelProps>[0]> = {}) =>
	resolveSettingsPanelProps({ selected: "saved.png", aspectRatio: "16:9", ...overrides });

describe("panel prop defaults", () => {
	it("uses defaults only for undefined while preserving explicit false, zero and null", () => {
		const original = {
			selected: "saved.png",
			aspectRatio: "native" as const,
			connectZooms: false,
			cursorSize: 0,
			selectedCaptionId: null,
			backgroundBlur: undefined,
		};
		const resolved = resolveSettingsPanelProps(original);
		expect(resolved).toMatchObject({
			...original,
			backgroundBlur: 0,
			panelMode: "editor",
			advanced: false,
			showCursor: false,
			cursorClickBounce: DEFAULT_CURSOR_CLICK_BOUNCE,
		});
		expect(original.backgroundBlur).toBeUndefined();
		expect("panelMode" in original).toBe(false);
	});
	it("keeps fresh missing arrays and the original shared padding default", () => {
		const first = panel(),
			second = panel();
		expect(first.autoCaptions).toEqual([]);
		expect(first.autoCaptions).not.toBe(second.autoCaptions);
		expect(first.annotationRegions).not.toBe(second.annotationRegions);
		expect(first.padding).toBe(DEFAULT_PADDING);
	});
});

describe("frame settings controller", () => {
	it("restores the exact aspect ratio and unlinked padding after temporarily removing a background", () => {
		const onAspectRatioChange = vi.fn(),
			onPaddingChange = vi.fn();
		const padding = { top: 10, bottom: 20, left: 30, right: 40, linked: false };
		const controller = captureController(() =>
			useFrameSettings(
				panel({ padding, onAspectRatioChange, onPaddingChange }),
				DEFAULT_EDITOR_PREFERENCES,
			),
		);
		controller.handleRemoveBackgroundToggle(true);
		expect(onAspectRatioChange).toHaveBeenLastCalledWith("native");
		expect(onPaddingChange).toHaveBeenLastCalledWith({
			top: 0,
			bottom: 0,
			left: 0,
			right: 0,
			linked: false,
		});
		controller.handleRemoveBackgroundToggle(false);
		expect(onAspectRatioChange).toHaveBeenLastCalledWith("16:9");
		expect(onPaddingChange).toHaveBeenLastCalledWith(padding);
	});
	it("forgets the removed-background snapshot when resetting the frame", () => {
		const onAspectRatioChange = vi.fn(),
			onPaddingChange = vi.fn(),
			onBackgroundBlurChange = vi.fn(),
			onShadowChange = vi.fn(),
			onBorderRadiusChange = vi.fn();
		const initial = { ...DEFAULT_EDITOR_PREFERENCES, aspectRatio: "4:3" as const };
		const controller = captureController(() =>
			useFrameSettings(
				panel({
					onAspectRatioChange,
					onPaddingChange,
					onBackgroundBlurChange,
					onShadowChange,
					onBorderRadiusChange,
				}),
				initial,
			),
		);
		controller.handleRemoveBackgroundToggle(true);
		controller.resetFrameSection();
		expect(onBackgroundBlurChange).toHaveBeenCalledWith(
			DEFAULT_EDITOR_PREFERENCES.backgroundBlur,
		);
		expect(onShadowChange).toHaveBeenCalledWith(DEFAULT_EDITOR_PREFERENCES.shadowIntensity);
		expect(onBorderRadiusChange).toHaveBeenCalledWith(DEFAULT_EDITOR_PREFERENCES.borderRadius);
		controller.handleRemoveBackgroundToggle(false);
		expect(onAspectRatioChange).toHaveBeenLastCalledWith("4:3");
		expect(onPaddingChange).toHaveBeenLastCalledWith(DEFAULT_PADDING);
	});
	it("relinks padding to the rounded average and edits unlinked sides independently", () => {
		const onPaddingChange = vi.fn();
		const padding = { top: 10, bottom: 21, left: 30, right: 40, linked: false };
		const controller = captureController(() =>
			useFrameSettings(panel({ padding, onPaddingChange }), DEFAULT_EDITOR_PREFERENCES),
		);
		controller.togglePaddingLink();
		expect(onPaddingChange).toHaveBeenLastCalledWith({
			top: 25,
			bottom: 25,
			left: 25,
			right: 25,
			linked: true,
		});
		controller.handlePaddingSideChange("right", 55);
		expect(onPaddingChange).toHaveBeenLastCalledWith({ ...padding, right: 55 });
	});
	it("updates all linked sides together", () => {
		const onPaddingChange = vi.fn();
		const controller = captureController(() =>
			useFrameSettings(panel({ onPaddingChange }), DEFAULT_EDITOR_PREFERENCES),
		);
		controller.handlePaddingSideChange("bottom", 15);
		expect(onPaddingChange).toHaveBeenCalledWith({
			top: 15,
			bottom: 15,
			left: 15,
			right: 15,
			linked: true,
		});
	});
});

it("applies every field promised by a motion preset and recognizes saved matching settings", () => {
	const names = [
		"zoomInDurationMs",
		"zoomOutDurationMs",
		"cursorSize",
		"cursorSmoothing",
		"cursorSpringStiffnessMultiplier",
		"cursorSpringDampingMultiplier",
		"cursorSpringMassMultiplier",
		"cursorClickBounce",
		"cursorClickBounceDuration",
	] as const;
	const callbacks = Object.fromEntries(
		names.map((name) => [`on${name[0].toUpperCase()}${name.slice(1)}Change`, vi.fn()]),
	);
	const preset = CURSOR_MOTION_PRESETS.smooth;
	const controller = captureController(() => useAppSettings(panel({ ...preset, ...callbacks })));
	expect(controller.activeMotionPresetId).toBe("smooth");
	controller.applyMotionPreset("focused");
	for (const name of names)
		expect(callbacks[`on${name[0].toUpperCase()}${name.slice(1)}Change`]).toHaveBeenCalledWith(
			CURSOR_MOTION_PRESETS.focused[name],
		);
});
