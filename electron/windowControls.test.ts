import { expect, it, vi } from "vitest";
import { applyWindowControl } from "./windowControls";

function windowFixture() {
	return {
		isDestroyed: () => false,
		isMaximized: vi.fn(() => false),
		minimize: vi.fn(),
		maximize: vi.fn(),
		unmaximize: vi.fn(),
		close: vi.fn(),
	};
}

it("minimizes and toggles maximize/restore on the calling window", () => {
	const win = windowFixture();
	expect(applyWindowControl(win, "minimize")).toBe(true);
	expect(win.minimize).toHaveBeenCalledOnce();
	applyWindowControl(win, "maximize");
	expect(win.maximize).toHaveBeenCalledOnce();
	win.isMaximized.mockReturnValue(true);
	applyWindowControl(win, "maximize");
	expect(win.unmaximize).toHaveBeenCalledOnce();
});

it("uses normal close so the unsaved-change handler can cancel it", () => {
	const win = windowFixture();
	expect(applyWindowControl(win, "close")).toBe(true);
	expect(win.close).toHaveBeenCalledOnce();
});

it("ignores unknown actions and destroyed or missing windows", () => {
	const win = windowFixture();
	expect(applyWindowControl(win, "quit")).toBe(false);
	expect(applyWindowControl(null, "close")).toBe(false);
	expect(applyWindowControl({ ...win, isDestroyed: () => true }, "close")).toBe(false);
	expect(win.close).not.toHaveBeenCalled();
});
