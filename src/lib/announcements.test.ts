import { describe, expect, it } from "vitest";
import { compareVersions, parseAnnouncementFeed, selectAnnouncements } from "./announcements";

describe("parseAnnouncementFeed", () => {
	it("accepts safe text, media, and actions", () => {
		const feed = parseAnnouncementFeed({
			settings: { aspectRatio: "16:9" },
			announcements: [
				{
					id: "release-1",
					title: "New release",
					body: "See what changed.",
					audience: "editor",
					priority: 200,
					mediaMode: "cover",
					displayDurationSeconds: 15,
					maxImpressions: 3,
					controls: {
						close: false,
						dismiss: false,
						action: true,
						navigation: false,
						indicators: true,
					},
					media: {
						type: "video",
						url: "https://example.com/demo.mp4",
						posterUrl: "/announcement-poster.jpg",
					},
					action: { label: "Learn more", url: "https://example.com/release" },
				},
			],
		});

		expect(feed.settings).toEqual({ aspectRatio: "16:9" });
		expect(feed.announcements).toEqual([
			{
				id: "release-1",
				title: "New release",
				body: "See what changed.",
				audience: "editor",
				priority: 100,
				mediaMode: "cover",
				displayDurationSeconds: 15,
				maxImpressions: 3,
				controls: {
					close: false,
					dismiss: false,
					action: true,
					navigation: false,
					indicators: true,
				},
				media: {
					type: "video",
					url: "https://example.com/demo.mp4",
					posterUrl: "/announcement-poster.jpg",
				},
				action: { label: "Learn more", url: "https://example.com/release" },
			},
		]);
	});

	it("keeps notifications as text-only toasts", () => {
		const feed = parseAnnouncementFeed({
			announcements: [
				{
					id: "notice-1",
					title: "Service notice",
					body: "A short notification.",
					presentation: "notification",
					mediaMode: "cover",
					media: { type: "image", url: "https://example.com/banner.jpg" },
					action: { label: "Details", url: "https://example.com/details" },
				},
			],
		});

		expect(feed.announcements).toEqual([
			{
				id: "notice-1",
				title: "Service notice",
				body: "A short notification.",
				presentation: "notification",
				audience: "all",
				priority: 0,
				action: { label: "Details", url: "https://example.com/details" },
			},
		]);
	});

	it("keeps editor banners text-only", () => {
		const feed = parseAnnouncementFeed({
			announcements: [
				{
					id: "banner-1",
					title: "Editor notice",
					body: "A short banner.",
					presentation: "banner",
					mediaMode: "cover",
					media: { type: "video", url: "https://example.com/banner.mp4" },
					action: { label: "Details", url: "https://example.com/details" },
				},
			],
		});

		expect(feed.announcements).toEqual([
			{
				id: "banner-1",
				title: "Editor notice",
				body: "A short banner.",
				presentation: "banner",
				audience: "all",
				priority: 0,
				action: { label: "Details", url: "https://example.com/details" },
			},
		]);
	});

	it("accepts text-only messages for the export status stream", () => {
		const feed = parseAnnouncementFeed({
			announcements: [
				{
					id: "export-tip-1",
					title: "Did you know?",
					body: "Cursor styles can be changed in the editor.",
					presentation: "export",
					media: { type: "image", url: "https://example.com/ignored.jpg" },
					displayDurationSeconds: 8,
				},
			],
		});

		expect(feed.announcements).toEqual([
			{
				id: "export-tip-1",
				title: "Did you know?",
				body: "Cursor styles can be changed in the editor.",
				presentation: "export",
				audience: "all",
				priority: 0,
				displayDurationSeconds: 8,
			},
		]);
	});

	it("accepts an action that opens a safe editor section", () => {
		const feed = parseAnnouncementFeed({
			announcements: [
				{
					id: "settings-link",
					title: "Try experimental updates",
					body: "Open settings to opt in.",
					action: { label: "Open settings", section: "settings" },
				},
			],
		});

		expect(feed.announcements[0]?.action).toEqual({
			label: "Open settings",
			section: "settings",
		});
	});

	it("ignores ambiguous or unknown in-app actions", () => {
		const announcements = parseAnnouncementFeed({
			announcements: [
				{
					id: "ambiguous",
					title: "Ambiguous",
					body: "Two destinations are not allowed.",
					action: {
						label: "Open",
						url: "https://example.com",
						section: "settings",
					},
				},
				{
					id: "unknown",
					title: "Unknown",
					body: "Unknown destinations are ignored.",
					action: { label: "Open", section: "billing" },
				},
			],
		}).announcements;

		expect(announcements.map((announcement) => announcement.action)).toEqual([
			undefined,
			undefined,
		]);
	});

	it("drops malformed items and unsafe URLs", () => {
		const feed = parseAnnouncementFeed({
			announcements: [
				{ id: "missing-body", title: "Incomplete" },
				{
					id: "safe-text",
					title: "Still valid",
					body: "Unsafe optional fields are ignored.",
					media: { type: "image", url: "javascript:alert(1)" },
					action: { label: "Bad", url: "http://example.com" },
				},
			],
		});

		expect(feed.announcements).toEqual([
			{
				id: "safe-text",
				title: "Still valid",
				body: "Unsafe optional fields are ignored.",
				audience: "all",
				priority: 0,
			},
		]);
	});
});

describe("selectAnnouncements", () => {
	it("filters by audience, date, version, and dismissal", () => {
		const parsed = parseAnnouncementFeed({
			announcements: [
				{ id: "shown", title: "Shown", body: "Visible", priority: 2, minVersion: "1.2.0" },
				{ id: "dismissed", title: "Dismissed", body: "Hidden" },
				{ id: "future", title: "Future", body: "Hidden", startsAt: "2027-01-01T00:00:00Z" },
				{ id: "expired", title: "Expired", body: "Hidden", endsAt: "2025-01-01T00:00:00Z" },
				{ id: "newer", title: "Newer", body: "Hidden", minVersion: "2.0.0" },
			],
		}).announcements;

		const selected = selectAnnouncements({
			bundled: [],
			remote: parsed,
			dismissedIds: new Set(["dismissed"]),
			appVersion: "1.3.5-beta.2",
			audience: "editor",
			now: new Date("2026-09-01T00:00:00Z"),
		});

		expect(selected.map((announcement) => announcement.id)).toEqual(["shown"]);
	});

	it("lets remote announcements replace bundled items with the same ID", () => {
		const common = { audience: "all" as const, priority: 0 };
		const selected = selectAnnouncements({
			bundled: [{ id: "same", title: "Bundled", body: "Old", ...common }],
			remote: [{ id: "same", title: "Remote", body: "New", ...common }],
			dismissedIds: new Set(),
			appVersion: "1.0.0",
			audience: "editor",
		});

		expect(selected[0]?.title).toBe("Remote");
	});

	it("stops selecting an announcement after its impression limit", () => {
		const common = { audience: "all" as const, priority: 0 };
		const selected = selectAnnouncements({
			bundled: [
				{
					id: "limited",
					title: "Limited",
					body: "Shown twice",
					maxImpressions: 2,
					...common,
				},
			],
			remote: [],
			dismissedIds: new Set(),
			impressionCounts: { limited: 2 },
			appVersion: "1.0.0",
			audience: "editor",
		});

		expect(selected).toEqual([]);
	});
});

describe("compareVersions", () => {
	it("compares numeric release segments", () => {
		expect(compareVersions("1.3.5-beta.2", "1.3.4")).toBe(1);
		expect(compareVersions("1.3", "1.3.0")).toBe(0);
		expect(compareVersions("v1.2.9", "1.3.0")).toBe(-1);
	});
});
