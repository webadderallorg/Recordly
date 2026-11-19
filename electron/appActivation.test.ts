import { describe, expect, it, vi } from "vitest";
import { activateFromDesktopIcon } from "./appActivation";

function windowState(
	overrides: { destroyed?: boolean; visible?: boolean; minimized?: boolean } = {},
) {
	return {
		isDestroyed: () => overrides.destroyed ?? false,
		isVisible: () => overrides.visible ?? true,
		isMinimized: () => overrides.minimized ?? false,
	};
}

function setup(hud = windowState(), priority: ReturnType<typeof windowState> | null = null) {
	return {
		stopRecording: vi.fn(() => false),
		getPriorityWindow: () => priority,
		getHudWindow: () => hud,
		showHud: vi.fn(),
		showMain: vi.fn(),
	};
}

describe("desktop icon activation", () => {
	it("keeps a visible HUD in front without raising Home beside it", () => {
		const options = setup();
		activateFromDesktopIcon(options);
		expect(options.showHud).toHaveBeenCalledOnce();
		expect(options.showMain).not.toHaveBeenCalled();
	});

	it("preserves recording stop clicks without opening any window", () => {
		const options = setup();
		options.stopRecording.mockReturnValue(true);
		activateFromDesktopIcon(options);
		expect(options.showHud).not.toHaveBeenCalled();
		expect(options.showMain).not.toHaveBeenCalled();
	});

	for (const state of [{ visible: false }, { minimized: true }, { destroyed: true }]) {
		it(`restores the main window when the HUD is unavailable: ${JSON.stringify(state)}`, () => {
			const options = setup(windowState(state));
			activateFromDesktopIcon(options);
			expect(options.showMain).toHaveBeenCalledOnce();
			expect(options.showHud).not.toHaveBeenCalled();
		});
	}

	it("preserves onboarding and update dialog priority", () => {
		const options = setup(windowState(), windowState());
		activateFromDesktopIcon(options);
		expect(options.showMain).toHaveBeenCalledOnce();
		expect(options.showHud).not.toHaveBeenCalled();
	});

	it("does not let a destroyed priority window prevent access to the HUD", () => {
		const options = setup(windowState(), windowState({ destroyed: true }));
		activateFromDesktopIcon(options);
		expect(options.showHud).toHaveBeenCalledOnce();
		expect(options.showMain).not.toHaveBeenCalled();
	});

	it("reopens the main window when no HUD remains", () => {
		const options = { ...setup(), getHudWindow: () => null };
		activateFromDesktopIcon(options);
		expect(options.showMain).toHaveBeenCalledOnce();
	});
});
