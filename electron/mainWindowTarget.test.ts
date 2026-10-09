import { describe, expect, it } from "vitest";
import { pickWindowToFocus } from "./mainWindowTarget";

const window = (visible: boolean, destroyed = false) => ({
	isVisible: () => visible,
	isDestroyed: () => destroyed,
});

describe("pickWindowToFocus", () => {
	it("keeps the window already in use", () => {
		const current = window(true);
		expect(pickWindowToFocus({ current, editor: window(true), overlay: null })).toBe(current);
	});

	it("falls back to the editor window when the one in use is gone", () => {
		const editor = window(false);
		expect(
			pickWindowToFocus({ current: window(true, true), editor, overlay: window(true) }),
		).toBe(editor);
	});

	it("takes a visible overlay when there is no editor window", () => {
		const overlay = window(true);
		expect(pickWindowToFocus({ current: null, editor: null, overlay })).toBe(overlay);
	});

	it("asks for a new window rather than focusing a hidden overlay", () => {
		expect(pickWindowToFocus({ current: null, editor: null, overlay: window(false) })).toBe(
			null,
		);
	});

	it("asks for a new window when every candidate is destroyed or missing", () => {
		expect(
			pickWindowToFocus({
				current: window(true, true),
				editor: window(true, true),
				overlay: window(true, true),
			}),
		).toBe(null);
	});
});
