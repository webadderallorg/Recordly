import { listCapturePickerWindows } from "./capturePickerSources";
import {
	createAreaSource,
	createWindowSource,
	getSourceArea,
	normalizeCapturePick,
} from "./sourceArea";
import { selectedSource } from "./state";
import type { SelectedSource } from "./types";
import { getScreen } from "./utils";
import { getDesktopSources } from "./register/sources";
import {
	isLikelyLinuxWaylandSession,
	LINUX_PORTAL_SCREEN_SOURCE_ID,
} from "./register/sourceMapping";

/** Revalidate identity and geometry; never substitute a broader capture source. */
export async function validateCaptureSource(candidate: unknown): Promise<SelectedSource | null> {
	if (!candidate || typeof candidate !== "object") return null;
	const source = candidate as Partial<SelectedSource>;
	if (typeof source.id !== "string" || typeof source.name !== "string") return null;
	if (source.id === LINUX_PORTAL_SCREEN_SOURCE_ID)
		return process.platform === "linux" && isLikelyLinuxWaylandSession(process.env)
			? { id: source.id, name: "System picker", sourceType: "screen" }
			: null;
	if (process.platform === "linux" && isLikelyLinuxWaylandSession(process.env)) return null;
	if (source.id.startsWith("window:") && process.platform === "linux") {
		const windows = await getDesktopSources(
			{ types: ["window"], thumbnailSize: { width: 0, height: 0 } },
			{ strict: true },
		);
		const match = windows.find(
			(entry) =>
				entry.id === source.id &&
				(entry.windowTitle ?? entry.name) === (source.windowTitle ?? source.name),
		);
		return match
			? {
					id: match.id,
					name: match.name,
					windowTitle: match.windowTitle ?? match.name,
					display_id: match.display_id,
					sourceType: "window",
				}
			: null;
	}
	if (source.id.startsWith("window:")) {
		const windows = await listCapturePickerWindows();
		const match = windows.find(
			(entry) =>
				entry.id === source.id &&
				(entry.title || entry.appName || "Window") ===
					(source.windowTitle ?? source.name) &&
				(!source.appName || entry.appName === source.appName),
		);
		return match ? createWindowSource(match) : null;
	}
	const display = getScreen()
		.getAllDisplays()
		.find((entry) => String(entry.id) === source.display_id);
	if (!display) return null;
	if (source.id.startsWith("area:")) {
		if (process.platform !== "darwin") return null;
		const area = getSourceArea(source as SelectedSource);
		if (!area) return null;
		const normalized = normalizeCapturePick(
			{ ...area, kind: "area", displayId: display.id, record: false },
			[{ id: display.id, bounds: display.bounds }],
			[],
		);
		// A changed display must invalidate the area rather than silently resize it.
		if (
			!normalized ||
			normalized.kind !== "area" ||
			["x", "y", "width", "height"].some(
				(key) => normalized[key as keyof typeof area] !== area[key as keyof typeof area],
			)
		)
			return null;
		return createAreaSource(normalized);
	}
	if (!source.id.startsWith("screen:")) return null;
	const sources = await getDesktopSources(
		{ types: ["screen"], thumbnailSize: { width: 0, height: 0 } },
		{ strict: true },
	);
	const match = sources.find(
		(entry) => entry.id === source.id && entry.display_id === source.display_id,
	);
	return match
		? { id: match.id, name: match.name, display_id: match.display_id, sourceType: "screen" }
		: null;
}

/** A new main process starts unselected; old saved preferences are never restored. */
export function getSessionCaptureSource(): SelectedSource | null {
	return selectedSource;
}
