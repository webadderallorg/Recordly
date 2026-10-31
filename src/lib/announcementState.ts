const DISMISSED_ANNOUNCEMENTS_KEY = "dismissedAnnouncementIds";
const ANNOUNCEMENT_IMPRESSIONS_KEY = "announcementImpressionCounts";
const MAX_DISMISSED_ANNOUNCEMENTS = 200;

export function readDismissedAnnouncementIds(): string[] {
	const value = window.electronAPI.getAppSetting(DISMISSED_ANNOUNCEMENTS_KEY);
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((item): item is string => typeof item === "string")
		.slice(-MAX_DISMISSED_ANNOUNCEMENTS);
}

export function dismissAnnouncements(ids: Iterable<string>) {
	const dismissedIds = new Set(readDismissedAnnouncementIds());
	for (const id of ids) {
		dismissedIds.add(id);
	}
	window.electronAPI.setAppSetting(
		DISMISSED_ANNOUNCEMENTS_KEY,
		[...dismissedIds].slice(-MAX_DISMISSED_ANNOUNCEMENTS),
	);
}

export function readAnnouncementImpressionCounts(): Record<string, number> {
	const value = window.electronAPI.getAppSetting(ANNOUNCEMENT_IMPRESSIONS_KEY);
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}

	const counts: Record<string, number> = {};
	for (const [id, count] of Object.entries(value)) {
		if (typeof count === "number" && Number.isInteger(count) && count >= 0) {
			counts[id] = count;
		}
	}
	return counts;
}

export function recordAnnouncementImpression(id: string) {
	const counts = readAnnouncementImpressionCounts();
	counts[id] = (counts[id] ?? 0) + 1;
	window.electronAPI.setAppSetting(ANNOUNCEMENT_IMPRESSIONS_KEY, counts);
}
