export type AnnouncementAudience = "all" | "editor";

export interface AnnouncementMedia {
	type: "image" | "video";
	url: string;
	alt?: string;
	posterUrl?: string;
}

export type AnnouncementEditorSection =
	| "scene"
	| "cursor"
	| "webcam"
	| "captions"
	| "settings"
	| "extensions";

export type AnnouncementAction =
	| { label: string; url: string; section?: never }
	| { label: string; section: AnnouncementEditorSection; url?: never };

export interface AnnouncementControls {
	close?: boolean;
	dismiss?: boolean;
	action?: boolean;
	navigation?: boolean;
	indicators?: boolean;
}

export interface Announcement {
	id: string;
	title: string;
	body: string;
	presentation?: "popup" | "notification" | "banner" | "export";
	audience: AnnouncementAudience;
	priority: number;
	mediaMode?: "banner" | "cover";
	displayDurationSeconds?: number;
	maxImpressions?: number;
	controls?: AnnouncementControls;
	media?: AnnouncementMedia;
	action?: AnnouncementAction;
	startsAt?: string;
	endsAt?: string;
	minVersion?: string;
	maxVersion?: string;
}

export interface AnnouncementFeed {
	settings: AnnouncementFeedSettings;
	announcements: Announcement[];
}

export interface AnnouncementFeedSettings {
	aspectRatio?: string;
}

const MAX_ANNOUNCEMENTS = 50;
const MAX_ID_LENGTH = 100;
const MAX_TITLE_LENGTH = 160;
const MAX_BODY_LENGTH = 2_000;
const MAX_LABEL_LENGTH = 80;
const MAX_URL_LENGTH = 2_048;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readTrimmedString(value: unknown, maxLength: number): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed && trimmed.length <= maxLength ? trimmed : undefined;
}

function readDate(value: unknown): string | undefined {
	const date = readTrimmedString(value, 64);
	return date && Number.isFinite(Date.parse(date)) ? date : undefined;
}

function readAspectRatio(value: unknown): string | undefined {
	const ratio = readTrimmedString(value, 16);
	const match = ratio?.match(/^(\d{1,3}):(\d{1,3})$/);
	if (!match) {
		return undefined;
	}

	const width = Number(match[1]);
	const height = Number(match[2]);
	const numericRatio = width / height;
	return width > 0 && height > 0 && numericRatio >= 0.4 && numericRatio <= 3
		? `${width}:${height}`
		: undefined;
}

function readBoundedInteger(value: unknown, minimum: number, maximum: number): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return undefined;
	}

	const rounded = Math.round(value);
	return rounded >= minimum && rounded <= maximum ? rounded : undefined;
}

function readSafeUrl(value: unknown, allowRelative: boolean): string | undefined {
	const url = readTrimmedString(value, MAX_URL_LENGTH);
	if (!url) {
		return undefined;
	}

	if (allowRelative && url.startsWith("/") && !url.startsWith("//")) {
		return url;
	}

	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" && !parsed.username && !parsed.password
			? url
			: undefined;
	} catch {
		return undefined;
	}
}

function parseMedia(value: unknown): AnnouncementMedia | undefined {
	if (!isRecord(value) || (value.type !== "image" && value.type !== "video")) {
		return undefined;
	}

	const url = readSafeUrl(value.url, true);
	if (!url) {
		return undefined;
	}

	const alt = readTrimmedString(value.alt, 300);
	const posterUrl = value.type === "video" ? readSafeUrl(value.posterUrl, true) : undefined;
	return {
		type: value.type,
		url,
		...(alt ? { alt } : {}),
		...(posterUrl ? { posterUrl } : {}),
	};
}

function parseAction(value: unknown): AnnouncementAction | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const label = readTrimmedString(value.label, MAX_LABEL_LENGTH);
	const url = readSafeUrl(value.url, false);
	const section = isAnnouncementEditorSection(value.section) ? value.section : undefined;
	if (!label || Boolean(url) === Boolean(section)) {
		return undefined;
	}

	if (url) {
		return { label, url };
	}

	return section ? { label, section } : undefined;
}

export function isAnnouncementEditorSection(value: unknown): value is AnnouncementEditorSection {
	return (
		value === "scene" ||
		value === "cursor" ||
		value === "webcam" ||
		value === "captions" ||
		value === "settings" ||
		value === "extensions"
	);
}

function parseControls(value: unknown): AnnouncementControls | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const controls: AnnouncementControls = {};
	for (const key of ["close", "dismiss", "action", "navigation", "indicators"] as const) {
		if (typeof value[key] === "boolean") {
			controls[key] = value[key];
		}
	}

	return Object.keys(controls).length > 0 ? controls : undefined;
}

function parseAnnouncement(value: unknown): Announcement | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const id = readTrimmedString(value.id, MAX_ID_LENGTH);
	const title = readTrimmedString(value.title, MAX_TITLE_LENGTH);
	const body = readTrimmedString(value.body, MAX_BODY_LENGTH);
	if (!id || !title || !body) {
		return undefined;
	}

	const audience = value.audience === "editor" ? "editor" : "all";
	const presentation =
		value.presentation === "notification" ||
		value.presentation === "banner" ||
		value.presentation === "export"
			? value.presentation
			: undefined;
	const isTextOnlyPresentation =
		presentation === "notification" || presentation === "banner" || presentation === "export";
	const priority =
		typeof value.priority === "number" && Number.isFinite(value.priority)
			? Math.max(-100, Math.min(100, value.priority))
			: 0;
	const media = isTextOnlyPresentation ? undefined : parseMedia(value.media);
	const action = parseAction(value.action);
	const controls = parseControls(value.controls);
	const mediaMode =
		!isTextOnlyPresentation && (value.mediaMode === "cover" || value.mediaMode === "banner")
			? value.mediaMode
			: undefined;
	const displayDurationSeconds = readBoundedInteger(value.displayDurationSeconds, 3, 300);
	const maxImpressions = readBoundedInteger(value.maxImpressions, 1, 100);
	const startsAt = readDate(value.startsAt);
	const endsAt = readDate(value.endsAt);
	const minVersion = readTrimmedString(value.minVersion, 64);
	const maxVersion = readTrimmedString(value.maxVersion, 64);

	return {
		id,
		title,
		body,
		...(presentation ? { presentation } : {}),
		audience,
		priority,
		...(mediaMode ? { mediaMode } : {}),
		...(displayDurationSeconds ? { displayDurationSeconds } : {}),
		...(maxImpressions ? { maxImpressions } : {}),
		...(controls ? { controls } : {}),
		...(media ? { media } : {}),
		...(action ? { action } : {}),
		...(startsAt ? { startsAt } : {}),
		...(endsAt ? { endsAt } : {}),
		...(minVersion ? { minVersion } : {}),
		...(maxVersion ? { maxVersion } : {}),
	};
}

export function parseAnnouncementFeed(value: unknown): AnnouncementFeed {
	if (!isRecord(value) || !Array.isArray(value.announcements)) {
		return { settings: {}, announcements: [] };
	}

	const settings = isRecord(value.settings)
		? { aspectRatio: readAspectRatio(value.settings.aspectRatio) }
		: {};

	const announcements: Announcement[] = [];
	for (const item of value.announcements.slice(0, MAX_ANNOUNCEMENTS)) {
		const announcement = parseAnnouncement(item);
		if (announcement) {
			announcements.push(announcement);
		}
	}

	return {
		settings: settings.aspectRatio ? { aspectRatio: settings.aspectRatio } : {},
		announcements,
	};
}

function versionParts(version: string): number[] {
	const core = version.trim().replace(/^v/i, "").split("-")[0];
	return core.split(".").map((part) => {
		const parsed = Number.parseInt(part, 10);
		return Number.isFinite(parsed) ? parsed : 0;
	});
}

export function compareVersions(left: string, right: string): number {
	const leftParts = versionParts(left);
	const rightParts = versionParts(right);
	const length = Math.max(leftParts.length, rightParts.length);

	for (let index = 0; index < length; index += 1) {
		const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (difference !== 0) {
			return difference > 0 ? 1 : -1;
		}
	}

	return 0;
}

export function selectAnnouncements({
	bundled,
	remote,
	dismissedIds,
	impressionCounts = {},
	appVersion,
	audience,
	now = new Date(),
}: {
	bundled: Announcement[];
	remote: Announcement[];
	dismissedIds: ReadonlySet<string>;
	impressionCounts?: Readonly<Record<string, number>>;
	appVersion: string;
	audience: AnnouncementAudience;
	now?: Date;
}): Announcement[] {
	const byId = new Map<string, Announcement>();
	for (const announcement of bundled) {
		byId.set(announcement.id, announcement);
	}
	for (const announcement of remote) {
		byId.set(announcement.id, announcement);
	}

	const nowMs = now.getTime();
	return [...byId.values()]
		.filter((announcement) => {
			if (dismissedIds.has(announcement.id)) {
				return false;
			}
			if (
				announcement.maxImpressions &&
				(impressionCounts[announcement.id] ?? 0) >= announcement.maxImpressions
			) {
				return false;
			}
			if (announcement.audience !== "all" && announcement.audience !== audience) {
				return false;
			}
			if (announcement.startsAt && Date.parse(announcement.startsAt) > nowMs) {
				return false;
			}
			if (announcement.endsAt && Date.parse(announcement.endsAt) < nowMs) {
				return false;
			}
			if (
				announcement.minVersion &&
				compareVersions(appVersion, announcement.minVersion) < 0
			) {
				return false;
			}
			if (
				announcement.maxVersion &&
				compareVersions(appVersion, announcement.maxVersion) > 0
			) {
				return false;
			}
			return true;
		})
		.sort((left, right) => right.priority - left.priority);
}
