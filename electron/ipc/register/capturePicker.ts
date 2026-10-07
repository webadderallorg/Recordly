import { ipcMain } from "electron";
import {
	closeCapturePickerWindows,
	createCapturePickerWindows,
	isCapturePickerWebContents,
} from "../../windows";
import { getNativeMacWindowsFrontToBack, stopWindowBoundsCapture } from "../cursor/bounds";
import { setSelectedSource } from "../state";
import { createAreaSource, createWindowSource, normalizeCapturePick } from "../sourceArea";
import type { AreaCapturePick, CapturePick, CapturePickerWindow, SelectedSource } from "../types";
import { getScreen } from "../utils";
import { getScreenSourceIdForDisplay } from "./sourceMapping";
import { bringSelectedWindowForward, broadcastSelectedSourceChange } from "./sources";

/** Windows the picker can offer, front to back, without Recordly's own. */
async function listPickableWindows(): Promise<CapturePickerWindow[]> {
	const entries = await getNativeMacWindowsFrontToBack();
	return entries.flatMap((entry) => {
		const { x, y, width, height } = entry;
		if (
			entry.ownerPid === process.pid ||
			typeof x !== "number" ||
			typeof y !== "number" ||
			typeof width !== "number" ||
			typeof height !== "number" ||
			width <= 0 ||
			height <= 0
		) {
			return [];
		}
		return [
			{
				id: entry.id,
				appName: entry.appName ?? "",
				title: entry.windowTitle ?? entry.name,
				display_id: entry.display_id,
				x,
				y,
				width,
				height,
			},
		];
	});
}

/** The same source the screen list offers for this display. */
function createScreenSource(displayId: number): SelectedSource | null {
	const displays = getScreen().getAllDisplays();
	const index = displays.findIndex((display) => display.id === displayId);
	if (index < 0) return null;
	const isPrimary = getScreen().getPrimaryDisplay().id === displayId;
	return {
		id: getScreenSourceIdForDisplay({
			displayId: String(displayId),
			platform: process.platform,
		}),
		name: isPrimary ? `Screen ${index + 1} (Primary)` : `Screen ${index + 1}`,
		display_id: String(displayId),
		sourceType: "screen",
	};
}

/**
 * The capture picker covers every display: hovering highlights the window under
 * the cursor, a click picks that window or the whole screen, and a drag draws an
 * area. The pick becomes the selected source.
 */
export function registerCapturePickerHandlers() {
	let resolvePendingPick: ((pick: CapturePick | null) => void) | null = null;
	let pickableWindows: Promise<CapturePickerWindow[]> = Promise.resolve([]);
	let lastArea: AreaCapturePick | null = null;

	const finishPick = (pick: CapturePick | null) => {
		const resolve = resolvePendingPick;
		resolvePendingPick = null;
		resolve?.(pick);
	};

	ipcMain.handle("pick-capture-target", async () => {
		if (process.platform !== "darwin") {
			return { success: false, message: "Picking on screen is available on macOS." };
		}

		finishPick(null);
		// List windows before the overlays cover them.
		pickableWindows = listPickableWindows();
		const pick = await new Promise<CapturePick | null>((resolve) => {
			resolvePendingPick = resolve;
			// Closing an overlay without confirming cancels the pick.
			createCapturePickerWindows(() => finishPick(null));
		});
		closeCapturePickerWindows();
		if (!pick) {
			return { success: false, canceled: true };
		}

		let source: SelectedSource | null;
		if (pick.kind === "area") {
			lastArea = pick;
			source = createAreaSource(pick);
		} else if (pick.kind === "window") {
			const window = (await pickableWindows).find((entry) => entry.id === pick.windowId);
			source = window ? createWindowSource(window) : null;
		} else {
			source = createScreenSource(pick.displayId);
		}
		if (!source) {
			return { success: false, message: "That window or screen is no longer available." };
		}

		// Recording raises the window itself, so only raise it here when it is
		// just being selected.
		if (source.id?.startsWith("window:") && !pick.record) {
			await bringSelectedWindowForward(source);
		}
		setSelectedSource(source);
		broadcastSelectedSourceChange();
		stopWindowBoundsCapture();
		return { success: true, source, record: pick.record };
	});

	ipcMain.handle("complete-capture-pick", async (event, input: unknown) => {
		// Only the picker overlays answer a pick.
		if (!isCapturePickerWebContents(event.sender)) return;
		if (!input) {
			finishPick(null);
			return;
		}
		const displays = getScreen()
			.getAllDisplays()
			.map((display) => ({ id: display.id, bounds: display.bounds }));
		finishPick(normalizeCapturePick(input, displays, await pickableWindows));
	});

	ipcMain.handle("get-capture-picker-context", async (_, displayId: unknown) => {
		const display = getScreen()
			.getAllDisplays()
			.find((entry) => entry.id === Number(displayId));
		if (!display) {
			return { displayBounds: null, lastArea: null, windows: [], cursor: null };
		}
		const { x, y, width, height } = display.bounds;
		const windows = (await pickableWindows).filter(
			(window) =>
				window.x < x + width &&
				window.x + window.width > x &&
				window.y < y + height &&
				window.y + window.height > y,
		);
		const previous = lastArea?.displayId === display.id ? lastArea : null;
		return {
			displayBounds: display.bounds,
			lastArea: previous
				? { x: previous.x, y: previous.y, width: previous.width, height: previous.height }
				: null,
			windows,
			cursor: getScreen().getCursorScreenPoint(),
		};
	});
}
