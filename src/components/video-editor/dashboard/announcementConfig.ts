export type AnnouncementBanner = { src: string; alt: string; href?: string };
export type AnnouncementConfig = { enabled: boolean; banners: AnnouncementBanner[] };

/** Code-only configuration. One banner hides navigation; an empty list hides the card. */
export const dashboardAnnouncements: AnnouncementConfig = {
	enabled: false,
	banners: [
		{ src: "announcements/placeholder-1.svg", alt: "Announcement banner placeholder 1" },
		{ src: "announcements/placeholder-2.svg", alt: "Announcement banner placeholder 2" },
		// Optional href: "https://..." opens the banner destination in the default browser.
	],
};
