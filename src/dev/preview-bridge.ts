/** Browser-only desktop adapter for the announcement studio. No native APIs or user data. */

import type { AnnouncementConfig } from "@/components/video-editor/dashboard/announcementConfig";
import type { Announcement } from "@/lib/announcements";

export interface StudioUpdate {
	type: "recordly-studio:update";
	announcement?: Announcement | null;
	dashboardBanner?: AnnouncementConfig;
	theme: "dark" | "light";
	surface: "dashboard" | "editor";
	aspectRatio?: string;
}

class PreviewStorage implements Storage {
	private values = new Map<string, string>();
	get length() {
		return this.values.size;
	}
	clear() {
		this.values.clear();
	}
	getItem(key: string) {
		return this.values.get(key) ?? null;
	}
	key(index: number) {
		return [...this.values.keys()][index] ?? null;
	}
	removeItem(key: string) {
		this.values.delete(key);
	}
	setItem(key: string, value: string) {
		this.values.set(String(key), String(value));
	}
}

const settings = new Map<string, unknown>([
	["recordly.theme", "dark"],
	["recordly.onboarding.v1.seen", false],
]);
const local = new PreviewStorage();
local.setItem("recordly.locale", "en");
// The frame shares the studio origin, but must never read or alter its stored account/preferences.
Object.defineProperty(window, "localStorage", {
	configurable: true,
	value: local,
});
Object.defineProperty(window, "sessionStorage", {
	configurable: true,
	value: new PreviewStorage(),
});

let current: StudioUpdate | null = null;
const subscribe = () => () => undefined;
const unavailable = async () => ({
	success: false,
	canceled: true,
	error: "Disabled in studio preview",
});
const api: Record<string, unknown> = {
	getAppSetting: (key: string) => settings.get(key) ?? null,
	setAppSetting: (key: string, value: unknown) => {
		settings.set(key, value);
		return true;
	},
	getAppVersion: async () => "1.4.0",
	getPlatform: async () => "darwin",
	getWindowChrome: async () => ({ trafficLightsVisible: false }),
	getPendingAuthCallbackUrl: async () => null,
	showOnboardingWindow: async () => true,
	authStorageAvailable: async () => false,
	getShortcuts: async () => null,
	getAnnouncements: async () => ({
		announcements: current?.announcement
			? [
					{
						...current.announcement,
						id: "studio-preview",
						// Eligibility is deliberately ignored while authoring. Rendering fields stay unchanged.
						audience: "all",
						startsAt: undefined,
						endsAt: undefined,
						minVersion: undefined,
						maxVersion: undefined,
						maxImpressions: undefined,
					},
				]
			: [],
		settings: { aspectRatio: current?.aspectRatio },
	}),
	listProjectFiles: async () => ({ success: true, projects: [], entries: [] }),
	listRecordings: async () => ({ success: true, recordings: [], entries: [] }),
	loadCurrentProjectFile: unavailable,
	getCurrentRecordingSession: async () => ({ success: true, session: null }),
	waitForRecordingEditor: async () => ({}),
	getCurrentVideoPath: async () => ({
		success: true,
		path: `${location.origin}/wallpapers/wispysky.mp4`,
	}),
	getVideoAudioFallbackPaths: async () => ({ success: true, paths: [] }),
	getCursorTelemetry: async () => ({ success: true, samples: [] }),
	getWhisperSmallModelStatus: async () => ({ success: true, exists: false }),
	getParakeetModelStatus: async () => ({ success: true, exists: false }),
	getExperimentalUpdatesEnabled: async () => false,
	getRecordingsDirectory: async () => ({
		success: true,
		path: "Preview recordings",
	}),
	getHudOverlayCaptureProtection: async () => ({
		success: true,
		enabled: false,
		supported: false,
	}),
};

// Unknown native actions fail closed. Event APIs are inert subscriptions.
window.electronAPI = new Proxy(api, {
	get: (target, key) =>
		key in target
			? target[String(key)]
			: String(key).startsWith("on")
				? subscribe
				: unavailable,
}) as unknown as Window["electronAPI"];

const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
	const url = new URL(
		typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
		location.href,
	);
	if (url.origin !== location.origin)
		return Promise.reject(new Error("External services are disabled in studio preview"));
	return originalFetch(input, init);
};
// Embedded app modals must not pull focus out of the studio's controls.
// Native clicks/Tab into the iframe focus it first; once the frame owns focus,
// keep the app's real keyboard navigation and modal containment unchanged.
if (window.parent !== window) {
	const focus = HTMLElement.prototype.focus;
	HTMLElement.prototype.focus = function (options?: FocusOptions) {
		if (window.parent.document.activeElement !== window.frameElement) return;
		focus.call(this, options);
	};
}

document.documentElement.dataset.platform = "macos";
document.documentElement.dataset.startupView = "editor";

export function setPreviewUpdate(update: StudioUpdate) {
	current = update;
	settings.set("dismissedAnnouncementIds", []);
	settings.set("announcementImpressionCounts", {});
	settings.set("recordly.theme", update.theme);
}
