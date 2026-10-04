import { readAppSetting, writeAppSetting } from "../appSettingsStore";
import { listCapturePickerWindows } from "./capturePickerSources";
import {
	createAreaSource,
	createWindowSource,
	getSourceArea,
	normalizeCapturePick,
} from "./sourceArea";
import { selectedSource, setSelectedSource } from "./state";
import type { SelectedSource } from "./types";
import { getScreen } from "./utils";
import { getDesktopSources } from "./register/sources";
import {
	isLikelyLinuxWaylandSession,
	LINUX_PORTAL_SCREEN_SOURCE_ID,
} from "./register/sourceMapping";

const LAST_SOURCE_KEY = "recordly.capture.lastSource.v1";

/** Revalidate identity and geometry; never substitute a broader capture source. */
export async function validateCaptureSource(candidate: unknown): Promise<SelectedSource | null> {
	if (!candidate || typeof candidate !== "object") return null;
	const source = candidate as Partial<SelectedSource>;
	if (typeof source.id !== "string" || typeof source.name !== "string") return null;
	if (source.id === LINUX_PORTAL_SCREEN_SOURCE_ID)
		return process.platform === "linux" && isLikelyLinuxWaylandSession(process.env)
			? { id: source.id, name: "System picker", sourceType: "screen" }
			: null;
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

export function rememberCaptureSource(source: SelectedSource) {
	try {
		writeAppSetting(LAST_SOURCE_KEY, {
			platform: process.platform,
			source: {
				id: source.id,
				name: source.name,
				display_id: source.display_id,
				sourceType: source.sourceType,
				appName: source.appName,
				windowTitle: source.windowTitle,
				area: source.area,
			},
		});
	} catch (error) {
		console.warn("Unable to remember capture source:", error);
	}
}

let restoring: Promise<SelectedSource | null> | null = null;
export async function restoreLastCaptureSource(): Promise<SelectedSource | null> {
	if (selectedSource) return selectedSource;
	if (!restoring)
		restoring = (async () => {
			const saved = readAppSetting(LAST_SOURCE_KEY) as {
				platform?: unknown;
				source?: unknown;
			} | null;
			if (!saved || saved.platform !== process.platform) return null;
			try {
				const restored = await validateCaptureSource(saved.source);
				// A user selection made while validation runs takes precedence.
				if (selectedSource) return selectedSource;
				setSelectedSource(restored);
				if (!restored) writeAppSetting(LAST_SOURCE_KEY, null);
				return restored;
			} catch {
				return null;
			}
		})().finally(() => {
			restoring = null;
		});
	return restoring;
}
