import { afterEach, expect, it, vi } from "vitest";
import { WindowControls } from "./WindowControls";

vi.mock("@/contexts/I18nContext", () => ({
	useI18n: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

afterEach(() => vi.unstubAllGlobals());

it("exposes accessible caption buttons and sends the corresponding native actions", () => {
	const control = vi.fn();
	vi.stubGlobal("window", { electronAPI: { windowControl: control } });
	const buttons = WindowControls({ maximized: false }).props.children;
	expect(buttons.map((button) => button.props["aria-label"])).toEqual([
		"Minimize",
		"Maximize",
		"Close",
	]);
	for (const button of buttons) button.props.onClick();
	expect(control.mock.calls).toEqual([["minimize"], ["maximize"], ["close"]]);
});

it("labels the maximize button as restore when the native window is maximized", () => {
	expect(WindowControls({ maximized: true }).props.children[1].props["aria-label"]).toBe(
		"Restore window",
	);
});
