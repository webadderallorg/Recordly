import { ipcMain } from "electron";

const DEFAULT_ANNOUNCEMENT_FEED_URL =
	"https://raw.githubusercontent.com/webadderallorg/Recordly/main/announcements.json";
const ANNOUNCEMENT_FETCH_TIMEOUT_MS = 5_000;
const ANNOUNCEMENT_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const MAX_ANNOUNCEMENT_FEED_BYTES = 1_000_000;

let cachedFeed: unknown = null;
let cachedAt = 0;
let hasCachedResult = false;
let pendingFetch: Promise<unknown> | null = null;

function getAnnouncementFeedUrl(): string | null {
	const configuredUrl = process.env.RECORDLY_ANNOUNCEMENTS_URL?.trim();
	if (configuredUrl?.toLowerCase() === "off") {
		return null;
	}

	const candidate = configuredUrl || DEFAULT_ANNOUNCEMENT_FEED_URL;
	try {
		const parsed = new URL(candidate);
		return parsed.protocol === "https:" && !parsed.username && !parsed.password
			? parsed.href
			: null;
	} catch {
		return null;
	}
}

async function requestAnnouncementFeed(feedUrl: string): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), ANNOUNCEMENT_FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(feedUrl, {
			signal: controller.signal,
			headers: { Accept: "application/json" },
			redirect: "follow",
		});
		if (!response.ok) {
			throw new Error(`Announcement feed returned HTTP ${response.status}`);
		}
		if (new URL(response.url).protocol !== "https:") {
			throw new Error("Announcement feed redirected to an unsafe URL");
		}

		const declaredLength = Number(response.headers.get("content-length"));
		if (Number.isFinite(declaredLength) && declaredLength > MAX_ANNOUNCEMENT_FEED_BYTES) {
			throw new Error("Announcement feed is too large");
		}

		const text = await response.text();
		if (Buffer.byteLength(text, "utf8") > MAX_ANNOUNCEMENT_FEED_BYTES) {
			throw new Error("Announcement feed is too large");
		}

		cachedFeed = JSON.parse(text) as unknown;
		cachedAt = Date.now();
		hasCachedResult = true;
		return cachedFeed;
	} catch (error) {
		console.warn("Failed to load announcement feed:", error);
		return cachedFeed;
	} finally {
		clearTimeout(timeout);
	}
}

function fetchAnnouncementFeed(): Promise<unknown> {
	const feedUrl = getAnnouncementFeedUrl();
	if (!feedUrl) {
		return Promise.resolve(null);
	}

	if (hasCachedResult && Date.now() - cachedAt < ANNOUNCEMENT_CACHE_TTL_MS) {
		return Promise.resolve(cachedFeed);
	}

	if (!pendingFetch) {
		pendingFetch = requestAnnouncementFeed(feedUrl).finally(() => {
			pendingFetch = null;
		});
	}

	return pendingFetch;
}

export function registerAnnouncementHandlers() {
	ipcMain.handle("announcements:get", fetchAnnouncementFeed);
}
