import type { DesktopSource } from "./popovers/launchPopoverTypes";

type SourceLabelTranslate = (
	key: string,
	fallback?: string,
	vars?: Record<string, string | number>,
) => string;

const SCREEN_SOURCE_PATTERN = /^Screen\s+(\d+)(?:\s+\(Primary\))?$/i;

/**
 * Returns a localized label for generated screen sources without changing
 * the source name used by Electron for selection and recording.
 */
export function getLocalizedSourceLabel(
	sourceName: string,
	translate: SourceLabelTranslate,
): string {
	const normalizedName = sourceName.trim();

	if (normalizedName.toLowerCase() === "screen") {
		return translate("recording.screen", "Screen");
	}

	if (/^folder\s*browser$/i.test(normalizedName)) {
		return translate("recording.folder", "Folder");
	}

	const screenMatch = normalizedName.match(SCREEN_SOURCE_PATTERN);
	if (!screenMatch) return sourceName;

	const index = screenMatch[1];
	const isPrimary = /\(Primary\)$/i.test(normalizedName);
	return isPrimary
		? translate("recording.primaryDisplay", "Display {{index}} (Primary)", { index })
		: translate("recording.display", "Display {{index}}", { index });
}

/**
 * Localizes generated display labels only for actual screen sources.
 * Window titles are user/application content and must remain unchanged.
 */
export function getSourceDisplayLabel(
	source: Pick<DesktopSource, "id" | "name" | "sourceType" | "windowTitle">,
	translate: SourceLabelTranslate,
): string {
	const isScreen = source.sourceType === "screen" || source.id.startsWith("screen:");
	return isScreen
		? getLocalizedSourceLabel(source.name, translate)
		: source.windowTitle || source.name;
}

export function getSelectedSourceDisplayLabel(
	source: Pick<DesktopSource, "id" | "name" | "sourceType" | "windowTitle"> | null | undefined,
	translate: SourceLabelTranslate,
): string {
	return source
		? getSourceDisplayLabel(source, translate)
		: getLocalizedSourceLabel("Screen", translate);
}
