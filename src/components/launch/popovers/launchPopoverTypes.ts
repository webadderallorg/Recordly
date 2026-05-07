export interface DesktopSource {
	id: string;
	name: string;
	thumbnail: string | null;
	display_id: string;
	appIcon: string | null;
	sourceType?: "screen" | "window";
	appName?: string;
	windowTitle?: string;
}

export interface RawDesktopSource {
	id: string;
	name: string;
	thumbnail: string | null;
	display_id: string;
	appIcon: string | null;
	sourceType?: "screen" | "window";
	appName?: string;
	windowTitle?: string;
}

export function mapRawSource(s: RawDesktopSource): DesktopSource {
	const isWindow = s.id.startsWith("window:");
	const type = s.sourceType ?? (isWindow ? "window" : "screen");
	let displayName = s.name;
	let appName = s.appName;
	if (isWindow && !appName && s.name.includes(" — ")) {
		const parts = s.name.split(" — ");
		appName = parts[0]?.trim();
		displayName = parts.slice(1).join(" — ").trim() || s.name;
	} else if (isWindow && s.windowTitle) {
		displayName = s.windowTitle;
	}
	return {
		id: s.id,
		name: displayName,
		thumbnail: s.thumbnail,
		display_id: s.display_id,
		appIcon: s.appIcon,
		sourceType: type,
		appName,
		windowTitle: s.windowTitle ?? displayName,
	};
}

export interface DeviceOption {
	deviceId: string;
	label: string;
}
