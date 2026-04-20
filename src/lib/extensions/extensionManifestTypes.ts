export interface ExtensionManifest {
	id: string;
	name: string;
	version: string;
	description: string;
	author?: string;
	homepage?: string;
	license?: string;
	engine?: string;
	icon?: string;
	main: string;
	permissions: ExtensionPermission[];
	contributes?: ExtensionContributions;
}

export type ExtensionPermission =
	| "render"
	| "cursor"
	| "audio"
	| "timeline"
	| "ui"
	| "assets"
	| "export";

export interface ExtensionContributions {
	cursorStyles?: ContributedCursorStyle[];
	sounds?: ContributedSound[];
	wallpapers?: ContributedWallpaper[];
	webcamFrames?: ContributedWebcamFrame[];
	frames?: ContributedFrame[];
}

export interface ContributedCursorStyle {
	id: string;
	label: string;
	defaultImage: string;
	clickImage?: string;
	hotspot?: { x: number; y: number };
}

export interface ContributedSound {
	id: string;
	label: string;
	category: "click" | "transition" | "ambient" | "notification";
	file: string;
	durationMs?: number;
}

export interface ContributedWallpaper {
	id: string;
	label: string;
	file: string;
	thumbnail?: string;
	isVideo?: boolean;
}

export interface ContributedWebcamFrame {
	id: string;
	label: string;
	file: string;
	thumbnail?: string;
}

export interface ContributedFrame {
	id: string;
	label: string;
	category: "browser" | "laptop" | "phone" | "tablet" | "desktop" | "custom";
	file?: string;
	dataUrl?: string;
	thumbnail?: string;
	screenInsets: { top: number; right: number; bottom: number; left: number };
	appearance?: "light" | "dark";
	draw?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
}