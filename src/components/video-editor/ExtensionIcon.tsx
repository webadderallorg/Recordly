import type { Icon, IconProps } from "@phosphor-icons/react";
import * as PhosphorIcons from "@phosphor-icons/react";

const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/;
const { PuzzlePiece } = PhosphorIcons;

const ICON_NAME_ALIASES: Record<string, keyof typeof PhosphorIcons> = {
	Check: "Check",
	ChevronDown: "CaretDown",
	ChevronLeft: "CaretLeft",
	ChevronRight: "CaretRight",
	ChevronUp: "CaretUp",
	Download: "DownloadSimple",
	ExternalLink: "ArrowSquareOut",
	Film: "FilmSlate",
	FolderOpen: "FolderOpen",
	HelpCircle: "Question",
	ImageIcon: "ImageSquare",
	Loader2: "Spinner",
	MessageSquare: "ChatCircle",
	MessageSquareMore: "ChatCircleDots",
	Palette: "Palette",
	Puzzle: "PuzzlePiece",
	Redo2: "ArrowClockwise",
	RefreshCw: "ArrowClockwise",
	RotateCcw: "ArrowCounterClockwise",
	Save: "FloppyDisk",
	Search: "MagnifyingGlass",
	Settings2: "Gear",
	ShieldAlert: "ShieldWarning",
	Trash2: "Trash",
	Twitter: "TwitterLogo",
	Undo2: "ArrowCounterClockwise",
	Upload: "UploadSimple",
	User: "UserCircle",
	Volume1: "SpeakerLow",
	Volume2: "SpeakerHigh",
	VolumeX: "SpeakerX",
	WandSparkles: "MagicWand",
	ZoomIn: "MagnifyingGlassPlus",
};

function isImagePath(value: string): boolean {
	return (
		value.startsWith("data:") ||
		value.startsWith("file://") ||
		value.startsWith("http://") ||
		value.startsWith("https://") ||
		value.includes("/") ||
		/\.(png|svg|jpg|jpeg|webp|gif)$/i.test(value)
	);
}

function toFileHref(filePath: string): string {
	const normalized = filePath.replace(/\\/g, "/");

	if (normalized.startsWith("file://")) {
		return normalized;
	}

	if (normalized.startsWith("/")) {
		return `file://${normalized}`;
	}

	if (WINDOWS_ABSOLUTE_PATH.test(normalized)) {
		return `file:///${normalized}`;
	}

	return normalized;
}

function resolveIconSrc(icon: string, extensionPath?: string | null): string | null {
	if (!isImagePath(icon)) {
		return null;
	}

	if (
		icon.startsWith("data:") ||
		icon.startsWith("file://") ||
		icon.startsWith("http://") ||
		icon.startsWith("https://")
	) {
		return icon;
	}

	if (icon.startsWith("/") || WINDOWS_ABSOLUTE_PATH.test(icon)) {
		return toFileHref(icon);
	}

	if (!extensionPath) {
		return icon;
	}

	const baseHref = toFileHref(extensionPath.endsWith("/") ? extensionPath : `${extensionPath}/`);
	return new URL(icon, baseHref).toString();
}

function resolvePhosphorIcon(name: string): Icon | null {
	const direct = PhosphorIcons[name as keyof typeof PhosphorIcons];
	if (typeof direct === "function") {
		return direct as Icon;
	}

	const alias = ICON_NAME_ALIASES[name];
	if (!alias) {
		return null;
	}

	const mapped = PhosphorIcons[alias];
	return typeof mapped === "function" ? (mapped as Icon) : null;
}

/**
 * Renders either a Phosphor icon (by PascalCase name) or an image (by path/URL).
 * Falls back to the PuzzlePiece icon if nothing matches.
 */
export function ExtensionIcon({
	icon,
	extensionPath,
	className = "w-4 h-4",
	imageClassName,
	...rest
}: {
	icon?: string | null;
	extensionPath?: string | null;
	className?: string;
	imageClassName?: string;
} & Omit<IconProps, "ref">) {
	if (!icon) {
		return <PuzzlePiece className={className} {...rest} />;
	}

	const iconSrc = resolveIconSrc(icon, extensionPath);
	if (iconSrc) {
		return (
			<img
				src={iconSrc}
				alt=""
				className={imageClassName ?? className}
				style={{ objectFit: "cover" }}
			/>
		);
	}

	const PhosphorIcon = resolvePhosphorIcon(icon);
	if (PhosphorIcon) {
		return <PhosphorIcon className={className} {...rest} />;
	}

	return <PuzzlePiece className={className} {...rest} />;
}
