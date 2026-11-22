import { ipcMain } from "electron";
import type { SourceListPickResult } from "../../sourceListPicker";
import {
	closeCapturePickerWindows,
	createCapturePickerWindows,
	getCapturePickerWindows,
	isCapturePickerWebContents,
} from "../../windows";
import { listCapturePickerWindows } from "../capturePickerSources";
import { validateCaptureSource } from "../captureSelection";
import { stopWindowBoundsCapture } from "../cursor/bounds";
import { createAreaSource, createWindowSource, normalizeCapturePick } from "../sourceArea";
import { isCursorCaptureActive, setSelectedSource } from "../state";
import type { CapturePick, CapturePickerWindow, SelectedSource } from "../types";
import { getScreen } from "../utils";
import { resizeCaptureWindow } from "../windowResize";
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
 * the cursor, clicking immediately selects that window or screen, and dragging
 * creates an adjustable recording area.
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
	let resizing = false;
	let resizeDone: Promise<void> = Promise.resolve();
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

	ipcMain.handle("resize-capture-window", async (event, input: unknown) => {
		if (
			!isCapturePickerWebContents(event.sender) ||
			!resolvePendingPick ||
			isCursorCaptureActive
		)
			return { success: false, error: "Open the source picker before resizing a window." };
		if (resizing) return { success: false, error: "A window resize is already in progress." };
		if (!input || typeof input !== "object" || Array.isArray(input))
			return { success: false, error: "Invalid window size." };
		const { windowId, width, height } = input as Record<string, unknown>;
		if (
			typeof windowId !== "string" ||
			![width, height].every(
				(n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 100 && n <= 16384,
			)
		)
			return { success: false, error: "Enter whole sizes from 100 to 16,384." };
		const session = resolvePendingPick;
		resizing = true;
		let finishResize!: () => void;
		resizeDone = new Promise<void>((resolve) => {
			finishResize = resolve;
		});
		try {
			const offered = (await pickableWindows).find((window) => window.id === windowId);
			if (!offered) throw new Error("That window is no longer available.");
			const fresh = (await listCapturePickerWindows()).find(
				(window) => window.id === windowId,
			);
			if (!fresh) throw new Error("That window is no longer available.");
			if (session !== resolvePendingPick || isCursorCaptureActive)
				throw new Error("Window selection was canceled.");
			const bounds = await resizeCaptureWindow(fresh, {
				width: width as number,
				height: height as number,
			});
			if (session !== resolvePendingPick || isCursorCaptureActive)
				throw new Error("Window selection was canceled.");
			const window = { ...fresh, ...bounds };
			pickableWindows = Promise.resolve(
				(await pickableWindows).map((entry) => (entry.id === window.id ? window : entry)),
			);
			for (const overlay of getCapturePickerWindows()) {
				if (!overlay.isDestroyed())
					overlay.webContents.send("capture-picker-window-resized", window);
			}
			return { success: true, window };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Could not resize this window.",
			};
		} finally {
			resizing = false;
			finishResize();
		}
	});

	ipcMain.handle("complete-capture-pick", async (event, input: unknown) => {
		if (!isCapturePickerWebContents(event.sender)) return;
		if (input && resizing) {
			const session = resolvePendingPick;
			await resizeDone;
			if (session !== resolvePendingPick) return;
		}
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
		// Preserve global stacking order so a window expanding onto another display
		// can be inserted at its original rank by that display's overlay.
		const windows = await pickableWindows;
		return {
			displayBounds: display.bounds,
			allowArea: process.platform === "darwin",
			lastArea: null,
			windows,
			cursor: getScreen().getCursorScreenPoint(),
		};
	});
}
