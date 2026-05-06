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

export interface DeviceOption {
	deviceId: string;
	label: string;
}
