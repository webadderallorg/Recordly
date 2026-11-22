import { describe, expect, it } from "vitest";
import { parseAnnouncementFeed } from "@/lib/announcements";
import {
	buildAnnouncement,
	buildDashboardBanner,
	defaults,
	restoreDraft,
	validateDraft,
} from "./announcementStudioModel";

describe("studio runtime compatibility", () => {
	it("exports the supported popup fields without losing them in the runtime parser", () => {
		const draft = {
			...defaults,
			priority: -20,
			mediaType: "video" as const,
			mediaUrl: "/demo.mp4",
			mediaAlt: "Demo video",
			posterUrl: "/demo.jpg",
			mediaMode: "cover" as const,
			actionEnabled: true,
			actionType: "url" as const,
			actionDestination: "https://recordly.dev",
			autoHide: true,
			maxImpressions: 3,
		};
		expect(validateDraft(draft)).toEqual([]);
		const item = buildAnnouncement(draft);
		const { presentation: _presentation, ...runtimeItem } = item;
		expect(parseAnnouncementFeed({ announcements: [item] }).announcements[0]).toEqual(
			runtimeItem,
		);
	});
	it("rejects media the app would discard", () => {
		for (const mediaUrl of [
			"http://example.com/img.png",
			"//example.com/img.png",
			"data:image/png,abc",
			"https://example.com/" + "a".repeat(2048),
		]) {
			expect(validateDraft({ ...defaults, mediaType: "image", mediaUrl })).not.toEqual([]);
		}
	});
	it("retains known legacy draft values and ignores malformed or unsupported properties", () => {
		expect(restoreDraft("{")).toEqual(defaults);
		expect(
			restoreDraft(
				JSON.stringify({
					title: "Saved title",
					presentation: "old",
					priority: "bad",
					repeatEnabled: true,
				}),
			),
		).toEqual({ ...defaults, title: "Saved title" });
	});
	it("keeps popup alt text within the runtime parser's 300-character boundary", () => {
		const draft = { ...defaults, mediaType: "image" as const, mediaUrl: "/demo.png" };
		const alt = "a".repeat(300);
		for (const mediaAlt of [alt, ` ${alt} `]) {
			const valid = { ...draft, mediaAlt };
			expect(validateDraft(valid)).toEqual([]);
			expect(
				parseAnnouncementFeed({ announcements: [buildAnnouncement(valid)] })
					.announcements[0].media?.alt,
			).toBe(alt);
		}
		expect(validateDraft({ ...draft, mediaAlt: `${alt}b` })).toEqual([
			"Media alt text must be 300 characters or fewer.",
		]);
	});
	it("preserves negative priority and trims dashboard destinations", () => {
		expect(buildAnnouncement({ ...defaults, priority: -20 }).priority).toBe(-20);
		expect(
			buildDashboardBanner({
				...defaults,
				mediaUrl: " /banner.png ",
				actionEnabled: true,
				actionType: "url",
				actionDestination: " https://recordly.dev ",
			}),
		).toEqual({
			enabled: true,
			banners: [{ src: "/banner.png", alt: defaults.title, href: "https://recordly.dev" }],
		});
	});
	it("rejects invalid delivery values and incompatible dashboard actions", () => {
		expect(
			validateDraft({ ...defaults, autoHide: true, displayDurationSeconds: 2 }),
		).not.toEqual([]);
		expect(validateDraft({ ...defaults, aspectRatio: "99:1" })).not.toEqual([]);
		expect(
			validateDraft({
				...defaults,
				presentation: "dashboard-banner",
				mediaType: "video",
				mediaUrl: "/demo.mp4",
				mediaAlt: "Demo video",
				actionEnabled: true,
			}),
		).toHaveLength(2);
	});
	it.each([
		["id", "Use an ID between 1 and 100 characters."],
		["title", "Use a title between 1 and 160 characters."],
		["body", "Use a message between 1 and 2,000 characters."],
	] as const)("does not blame a valid action when the %s is missing", (field, message) => {
		for (const action of [
			{ actionType: "section", actionDestination: "settings" },
			{ actionType: "url", actionDestination: "https://recordly.dev" },
		] as const) {
			expect(
				validateDraft({ ...defaults, [field]: "  ", actionEnabled: true, ...action }),
			).toEqual([message]);
		}
	});
	it.each([
		{ actionLabel: "" },
		{ actionType: "url", actionDestination: "http://recordly.dev" },
		{ actionType: "section", actionDestination: "not-an-editor-section" },
	] as const)("still rejects an invalid action on an otherwise valid draft: %o", (action) => {
		expect(validateDraft({ ...defaults, actionEnabled: true, ...action })).toEqual([
			"Use an action label (up to 80 characters) and a valid HTTPS URL or editor section.",
		]);
	});
	it("keeps independent dashboard presentation errors when a required field is missing", () => {
		expect(
			validateDraft({
				...defaults,
				id: "",
				presentation: "dashboard-banner",
				mediaType: "video",
				mediaUrl: "/demo.mp4",
				actionEnabled: true,
			}),
		).toEqual([
			"Use an ID between 1 and 100 characters.",
			"Dashboard banners support images only.",
			"Dashboard banners link to an HTTPS URL.",
		]);
	});
});
