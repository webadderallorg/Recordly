import type { BrowserWindow } from "electron";
import { expect, it, vi } from "vitest";
import { createRecordingEditorNavigation } from "./recordingEditorNavigation";

it("returns a finished HUD recording to its originating editor and consumes the destination", () => {
	const create = vi.fn();
	const target = {
		isDestroyed: () => false,
		isMinimized: () => true,
		reload: vi.fn(),
		restore: vi.fn(),
		show: vi.fn(),
		focus: vi.fn(),
	};
	const navigation = createRecordingEditorNavigation(create);
	navigation.setReturnWindow(target as unknown as BrowserWindow);
	navigation.open();
	expect(target.reload).toHaveBeenCalledOnce();
	expect(target.restore).toHaveBeenCalledOnce();
	expect(target.focus).toHaveBeenCalledOnce();
	expect(create).not.toHaveBeenCalled();
	navigation.open();
	expect(create).toHaveBeenCalledOnce();
});
it("opens an editor if the originating dashboard has closed", () => {
	const create = vi.fn();
	const navigation = createRecordingEditorNavigation(create);
	navigation.setReturnWindow({ isDestroyed: () => true } as BrowserWindow);
	navigation.open();
	expect(create).toHaveBeenCalledOnce();
});

it("opens Home without reloading and retains the destination for recording completion", () => {
	const create = vi.fn();
	const target = {
		isDestroyed: () => false,
		isMinimized: () => false,
		reload: vi.fn(),
		show: vi.fn(),
		focus: vi.fn(),
	};
	const navigation = createRecordingEditorNavigation(create);
	navigation.setReturnWindow(target as unknown as BrowserWindow);
	navigation.open(false);
	expect(target.reload).not.toHaveBeenCalled();
	expect(target.show).toHaveBeenCalledOnce();
	navigation.open();
	expect(target.reload).toHaveBeenCalledOnce();
	expect(create).not.toHaveBeenCalled();
});
