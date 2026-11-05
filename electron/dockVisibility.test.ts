import { afterEach, describe, expect, it, vi } from "vitest";
import { createDockVisibilityController } from "./dockVisibility";

function fixture(initiallyVisible = true) {
	let visible = initiallyVisible;
	const dock = {
		isVisible: () => visible,
		show: vi.fn(async () => {
			visible = true;
		}),
		hide: vi.fn(() => {
			visible = false;
		}),
	};
	return { dock, controller: createDockVisibilityController(dock) };
}

afterEach(() => vi.useRealTimers());

describe("macOS Dock visibility", () => {
	it("leaves a visible icon alone during repeated recording and locale updates", () => {
		const { dock, controller } = fixture();
		for (let i = 0; i < 30; i++) controller.setVisible(true);
		expect(dock.show).not.toHaveBeenCalled();
		expect(dock.hide).not.toHaveBeenCalled();
	});

	it("allows only one asynchronous show and waits before applying a hide", async () => {
		vi.useFakeTimers();
		const { dock, controller } = fixture(false);
		let finish!: () => void;
		dock.show.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		controller.setVisible(true);
		controller.setVisible(true);
		controller.setVisible(false);
		expect(dock.show).toHaveBeenCalledOnce();
		// Model Electron publishing the new visibility only when its promise resolves.
		dock.isVisible = () => true;
		finish();
		await vi.advanceTimersByTimeAsync(1099);
		expect(dock.hide).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(dock.hide).toHaveBeenCalledOnce();
	});

	it("coalesces rapid preference changes and spaces opposing transformations", async () => {
		vi.useFakeTimers();
		const { dock, controller } = fixture();
		controller.setVisible(false);
		controller.setVisible(true);
		controller.setVisible(false);
		await vi.advanceTimersByTimeAsync(1100);
		expect(dock.hide).toHaveBeenCalledOnce();
		expect(dock.show).not.toHaveBeenCalled();
		controller.setVisible(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(dock.show).toHaveBeenCalledOnce();
		controller.setVisible(false);
		await vi.advanceTimersByTimeAsync(1099);
		expect(dock.hide).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(1);
		expect(dock.hide).toHaveBeenCalledTimes(2);
	});

	it("cancels delayed changes when the app quits", async () => {
		vi.useFakeTimers();
		const { dock, controller } = fixture();
		controller.setVisible(false);
		controller.setVisible(true);
		controller.dispose();
		await vi.advanceTimersByTimeAsync(2000);
		expect(dock.show).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("reports show failures without looping, and permits a later retry", async () => {
		vi.useFakeTimers();
		const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		try {
			const { dock, controller } = fixture(false);
			dock.show.mockRejectedValueOnce(new Error("Dock unavailable"));
			controller.setVisible(true);
			await vi.advanceTimersByTimeAsync(2000);
			expect(warning).toHaveBeenCalledOnce();
			expect(dock.show).toHaveBeenCalledOnce();
			controller.setVisible(true);
			await vi.advanceTimersByTimeAsync(0);
			expect(dock.isVisible()).toBe(true);
			expect(dock.show).toHaveBeenCalledTimes(2);
		} finally {
			warning.mockRestore();
		}
	});
});
