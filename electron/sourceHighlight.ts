import { BrowserWindow } from "electron";
import type { WindowBounds } from "./ipc/types";
import {
	createSourceHighlightController,
	type SourceHighlightWindowBoundsOptions,
} from "./sourceHighlightController";
import { reassertHudOverlayMousePassthrough } from "./windows";

const sourceHighlightController = createSourceHighlightController({
	createWindow: (bounds: WindowBounds) =>
		new BrowserWindow({
			x: bounds.x,
			y: bounds.y,
			width: bounds.width,
			height: bounds.height,
			frame: false,
			transparent: true,
			backgroundColor: "#00000000",
			alwaysOnTop: true,
			skipTaskbar: true,
			hasShadow: false,
			resizable: false,
			minimizable: false,
			maximizable: false,
			fullscreenable: false,
			focusable: false,
			show: false,
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				backgroundThrottling: false,
			},
		}),
	reassertHudOverlayMousePassthrough,
});

export function showSourceHighlightWindow(
	bounds: WindowBounds,
	options?: SourceHighlightWindowBoundsOptions,
): Promise<boolean> {
	return sourceHighlightController.show(bounds, options);
}

export function clearSourceHighlightWindow(): void {
	sourceHighlightController.clear();
}
