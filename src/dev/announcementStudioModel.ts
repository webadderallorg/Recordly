import { type Announcement, parseAnnouncementFeed } from "@/lib/announcements";

export type Placement = "popup" | "notification" | "banner" | "dashboard-banner";
export type StudioDraft = {
	id: string;
	title: string;
	body: string;
	presentation: Placement;
	audience: "editor" | "all";
	priority: number;
	mediaType: "none" | "image" | "video";
	mediaUrl: string;
	mediaAlt: string;
	mediaMode: "banner" | "cover";
	posterUrl: string;
	actionEnabled: boolean;
	actionLabel: string;
	actionType: "section" | "url";
	actionDestination: string;
	startsAt: string;
	endsAt: string;
	autoHide: boolean;
	displayDurationSeconds: number;
	maxImpressions: number;
	showClose: boolean;
	showDismiss: boolean;
	aspectRatio: string;
};
export const STORAGE_KEY = "recordly-announcement-studio-draft-v1";
export const defaults: StudioDraft = {
	id: "recordly-announcement-1",
	title: "A faster Recordly is here",
	body: "Exports are faster and cursor motion is smoother. Thanks for using Recordly!",
	presentation: "popup",
	audience: "editor",
	priority: 10,
	mediaType: "none",
	mediaUrl: "",
	mediaAlt: "",
	mediaMode: "banner",
	posterUrl: "",
	actionEnabled: false,
	actionLabel: "Learn more",
	actionType: "section",
	actionDestination: "settings",
	startsAt: "",
	endsAt: "",
	autoHide: false,
	displayDurationSeconds: 10,
	maxImpressions: 0,
	showClose: true,
	showDismiss: true,
	aspectRatio: "",
};
export function restoreDraft(saved: string | null): StudioDraft {
	if (!saved) return { ...defaults };
	try {
		const source = JSON.parse(saved);
		const result = { ...defaults };
		for (const key of Object.keys(defaults) as (keyof StudioDraft)[]) {
			if (typeof source?.[key] === typeof defaults[key])
				Object.assign(result, { [key]: source[key] });
		}
		if (!["popup", "notification", "banner", "dashboard-banner"].includes(result.presentation))
			result.presentation = "popup";
		if (!["none", "image", "video"].includes(result.mediaType)) result.mediaType = "none";
		if (!["banner", "cover"].includes(result.mediaMode)) result.mediaMode = "banner";
		if (!["editor", "all"].includes(result.audience)) result.audience = "editor";
		if (!["section", "url"].includes(result.actionType)) result.actionType = "section";
		return result;
	} catch {
		return { ...defaults };
	}
}
export function buildAnnouncement(draft: StudioDraft): Announcement {
	return {
		id: draft.id.trim(),
		title: draft.title.trim(),
		body: draft.body.trim(),
		presentation: draft.presentation === "dashboard-banner" ? "banner" : draft.presentation,
		audience: draft.audience,
		priority: draft.priority,
		controls: {
			close: draft.showClose,
			dismiss: draft.showDismiss,
			action: draft.actionEnabled,
		},
		...(draft.presentation === "popup" && draft.mediaType !== "none" && draft.mediaUrl
			? {
					mediaMode: draft.mediaMode,
					media: {
						type: draft.mediaType,
						url: draft.mediaUrl,
						alt: draft.mediaAlt,
						...(draft.mediaType === "video" && draft.posterUrl
							? { posterUrl: draft.posterUrl }
							: {}),
					},
				}
			: {}),
		...(draft.actionEnabled
			? {
					action:
						draft.actionType === "url"
							? {
									label: draft.actionLabel.trim(),
									url: draft.actionDestination.trim(),
								}
							: {
									label: draft.actionLabel.trim(),
									section: draft.actionDestination as "settings",
								},
				}
			: {}),
		...(draft.startsAt && Number.isFinite(Date.parse(draft.startsAt))
			? { startsAt: new Date(draft.startsAt).toISOString() }
			: {}),
		...(draft.endsAt && Number.isFinite(Date.parse(draft.endsAt))
			? { endsAt: new Date(draft.endsAt).toISOString() }
			: {}),
		...(draft.autoHide ? { displayDurationSeconds: draft.displayDurationSeconds } : {}),
		...(draft.maxImpressions > 0 ? { maxImpressions: draft.maxImpressions } : {}),
	};
}
export function buildDashboardBanner(draft: StudioDraft, previewUrl?: string) {
	return {
		enabled: true,
		banners: [
			{
				src: (previewUrl || draft.mediaUrl).trim(),
				alt: draft.mediaAlt || draft.title,
				...(draft.actionEnabled && draft.actionType === "url"
					? { href: draft.actionDestination.trim() }
					: {}),
			},
		],
	};
}
const safeMedia = (value: string) =>
	value.trim().length <= 2048 &&
	(/^\/(?!\/)/.test(value) ||
		(() => {
			try {
				const u = new URL(value);
				return u.protocol === "https:" && !u.username && !u.password;
			} catch {
				return false;
			}
		})());
export function validateDraft(draft: StudioDraft): string[] {
	const errors: string[] = [];
	if (!draft.id.trim() || draft.id.trim().length > 100)
		errors.push("Use an ID between 1 and 100 characters.");
	if (!draft.title.trim() || draft.title.trim().length > 160)
		errors.push("Use a title between 1 and 160 characters.");
	if (!draft.body.trim() || draft.body.trim().length > 2000)
		errors.push("Use a message between 1 and 2,000 characters.");
	if (!Number.isFinite(draft.priority) || draft.priority < -100 || draft.priority > 100)
		errors.push("Priority must be between -100 and 100.");
	if (
		(draft.startsAt && !Number.isFinite(Date.parse(draft.startsAt))) ||
		(draft.endsAt && !Number.isFinite(Date.parse(draft.endsAt)))
	)
		errors.push("Use valid start and end dates.");
	if (draft.startsAt && draft.endsAt && Date.parse(draft.endsAt) <= Date.parse(draft.startsAt))
		errors.push("End must follow start.");
	if (
		(draft.presentation === "popup" && draft.mediaType !== "none") ||
		draft.presentation === "dashboard-banner"
	) {
		if (!safeMedia(draft.mediaUrl))
			errors.push("Choose media, or enter an HTTPS URL or /public-path.");
	}
	if (draft.presentation === "dashboard-banner" && draft.mediaType === "video")
		errors.push("Dashboard banners support images only.");
	if (
		draft.presentation === "popup" &&
		draft.mediaType !== "none" &&
		draft.mediaAlt.trim().length > 300
	)
		errors.push("Media alt text must be 300 characters or fewer.");
	if (draft.posterUrl && !safeMedia(draft.posterUrl))
		errors.push("Poster must use HTTPS or a /public-path.");
	if (draft.actionEnabled) {
		const action = parseAnnouncementFeed({ announcements: [buildAnnouncement(draft)] })
			.announcements[0]?.action;
		if (!action)
			errors.push(
				"Use an action label (up to 80 characters) and a valid HTTPS URL or editor section.",
			);
		if (draft.presentation === "dashboard-banner" && draft.actionType !== "url")
			errors.push("Dashboard banners link to an HTTPS URL.");
	}
	if (
		draft.autoHide &&
		(!Number.isInteger(draft.displayDurationSeconds) ||
			draft.displayDurationSeconds < 3 ||
			draft.displayDurationSeconds > 300)
	)
		errors.push("Auto-hide must be 3–300 seconds.");
	if (
		!Number.isInteger(draft.maxImpressions) ||
		draft.maxImpressions < 0 ||
		draft.maxImpressions > 100
	)
		errors.push("Impressions must be 0–100 (0 means unlimited).");
	if (
		draft.aspectRatio &&
		!parseAnnouncementFeed({ settings: { aspectRatio: draft.aspectRatio }, announcements: [] })
			.settings.aspectRatio
	)
		errors.push("Use a ratio such as 16:9, between 0.4 and 3.");
	return errors;
}
