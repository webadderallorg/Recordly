import { rememberCaptureSource, validateCaptureSource } from "../captureSelection";
import { listCapturePickerWindows } from "../capturePickerSources";
import { ipcMain } from "electron";
import type { SourceListPickResult } from "../../sourceListPicker";
import {
	closeCapturePickerWindows,
	createCapturePickerWindows,
	isCapturePickerWebContents,
} from "../../windows";
import { stopWindowBoundsCapture } from "../cursor/bounds";
import { isCursorCaptureActive, selectedSource, setSelectedSource } from "../state";
import {
	createAreaSource,
	createWindowSource,
	getSourceArea,
	normalizeCapturePick,
} from "../sourceArea";
import type { CapturePick, CapturePickerWindow, SelectedSource } from "../types";
import { getScreen } from "../utils";
import { getScreenSourceIdForDisplay, isLikelyLinuxWaylandSession } from "./sourceMapping";
import { broadcastSelectedSourceChange, getDesktopSources } from "./sources";

/** The same source the screen list offers for this display. */
async function createScreenSource(displayId: number): Promise<SelectedSource | null> {
	const displays = getScreen().getAllDisplays();
	const index = displays.findIndex((display) => display.id === displayId);
	if (index < 0) return null;
	const sources = await getDesktopSources(
		{
			types: ["screen"],
			thumbnailSize: { width: 0, height: 0 },
		},
		{ strict: true },
	);
	const matched =
		sources.find((source) => source.display_id === String(displayId)) ??
		(sources.length === displays.length ? sources[index] : undefined);
	const isPrimary = getScreen().getPrimaryDisplay().id === displayId;
	return {
		id: getScreenSourceIdForDisplay({
			displayId: String(displayId),
			platform: process.platform,
			matchedSourceId: matched?.id,
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
export function registerCapturePickerHandlers({
	pickSourceList,
}: {
	pickSourceList: () => Promise<SourceListPickResult>;
}) {
	let resolvePendingPick: ((pick: CapturePick | null) => void) | null = null;
	let pickableWindows: Promise<CapturePickerWindow[]> = Promise.resolve([]);

	const finishPick = (pick: CapturePick | null) => {
		const resolve = resolvePendingPick;
		resolvePendingPick = null;
		resolve?.(pick);
	};

	let activePick: Promise<unknown> | null = null;
	const pickTarget = async () => {
		if (isCursorCaptureActive) return { success: false, canceled: true };
		if (process.platform === "linux" && isLikelyLinuxWaylandSession(process.env)) {
			// Preserve the existing portal recording path: its system picker opens
			// when recording starts; overlay selection cannot identify Wayland windows.
			const source = {
				id: "screen:linux-portal",
				name: "System picker",
				sourceType: "screen" as const,
			};
			setSelectedSource(source);
			rememberCaptureSource(source);
			broadcastSelectedSourceChange();
			return {
				success: true,
				source,
				message: "Choose a screen or window in the system picker when you start recording.",
			};
		}

		if (process.platform === "linux") return pickSourceList();

		finishPick(null);
		// List windows before the overlays cover them.
		pickableWindows = Promise.resolve(await listCapturePickerWindows());
		if (isCursorCaptureActive) return { success: false, canceled: true };
		const pick = await new Promise<CapturePick | null>((resolve) => {
			resolvePendingPick = resolve;
			// Closing an overlay without confirming cancels the pick.
			createCapturePickerWindows(() => finishPick(null));
		});
		closeCapturePickerWindows();
		if (!pick || isCursorCaptureActive) {
			return { success: false, canceled: true };
		}

		let source: SelectedSource | null;
		if (pick.kind === "area") {
			source = createAreaSource(pick);
		} else if (pick.kind === "window") {
			const window = (await pickableWindows).find((entry) => entry.id === pick.windowId);
			source = window ? createWindowSource(window) : null;
		} else {
			source = await createScreenSource(pick.displayId);
		}
		if (source) source = await validateCaptureSource(source);
		if (!source) {
			return { success: false, message: "That window or screen is no longer available." };
		}

		if (isCursorCaptureActive) return { success: false, canceled: true };
		// Recording brings the selected window forward; selection need not wait for it.
		setSelectedSource(source);
		rememberCaptureSource(source);
		broadcastSelectedSourceChange();
		stopWindowBoundsCapture();
		return { success: true, source };
	};
	ipcMain.handle("pick-capture-target", () => {
		if (isCursorCaptureActive) return { success: false, canceled: true };
		if (!activePick) {
			activePick = pickTarget()
				.catch((error) => {
					finishPick(null);
					closeCapturePickerWindows();
					return {
						success: false,
						message:
							error instanceof Error
								? error.message
								: "Unable to open the source picker.",
					};
				})
				.finally(() => {
					activePick = null;
				});
		}
		return activePick;
	});

	ipcMain.handle("complete-capture-pick", async (event, input: unknown) => {
		if (!isCapturePickerWebContents(event.sender)) return;
		if (
			input &&
			typeof input === "object" &&
			(input as { kind?: unknown }).kind === "area" &&
			process.platform !== "darwin"
		)
			return;
		if (!input || isCursorCaptureActive) {
			finishPick(null);
			return;
		}
		const displays = getScreen()
			.getAllDisplays()
			.map((display) => ({ id: display.id, bounds: display.bounds }));
		finishPick(
			normalizeCapturePick(
				input && typeof input === "object" ? { ...input, record: false } : input,
				displays,
				await pickableWindows,
			),
		);
	});

	ipcMain.handle("get-capture-picker-context", async (event, displayId: unknown) => {
		if (!isCapturePickerWebContents(event.sender)) throw new Error("Unknown picker window.");
		const display = getScreen()
			.getAllDisplays()
			.find((entry) => entry.id === Number(displayId));
		if (!display) {
			return {
				displayBounds: null,
				lastArea: null,
				allowArea: process.platform === "darwin",
				windows: [],
				cursor: null,
			};
		}
		const { x, y, width, height } = display.bounds;
		const windows = (await pickableWindows).filter(
			(window) =>
				window.x < x + width &&
				window.x + window.width > x &&
				window.y < y + height &&
				window.y + window.height > y,
		);
		const previous =
			selectedSource?.display_id === String(display.id)
				? getSourceArea(selectedSource)
				: null;
		return {
			displayBounds: display.bounds,
			allowArea: process.platform === "darwin",
			lastArea: previous
				? { x: previous.x, y: previous.y, width: previous.width, height: previous.height }
				: null,
			windows,
			cursor: getScreen().getCursorScreenPoint(),
		};
	});
}
