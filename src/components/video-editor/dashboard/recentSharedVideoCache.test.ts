import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { subscribeShareCapacityChanges } from "../cloud/shareCapacity";

vi.mock("../cloud/shareCapacity", () => ({ subscribeShareCapacityChanges: vi.fn() }));
let cache: typeof import("./recentSharedVideoCache");
const list = vi.fn();
beforeEach(async () => {
	vi.resetModules();
	vi.useFakeTimers();
	list.mockReset();
	vi.stubGlobal("window", { electronAPI: { cloudShareManage: list } });
	cache = await import("./recentSharedVideoCache");
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it("deduplicates requests, caches known empty lists, and expires them", async () => {
	list.mockResolvedValue({ success: true, videos: [] });
	const first = cache.readRecentSharedVideos("account", "https://share.test", "token");
	expect(cache.readRecentSharedVideos("account", "https://share.test", "token")).toBe(first);
	await first;
	expect(cache.peekRecentSharedVideos("account")).toEqual([]);
	await cache.readRecentSharedVideos("account", "https://share.test", "token");
	expect(list).toHaveBeenCalledTimes(1);
	vi.advanceTimersByTime(60_001);
	expect(cache.peekRecentSharedVideos("account")).toEqual([]);
	await cache.readRecentSharedVideos("account", "https://share.test", "token");
	expect(list).toHaveBeenCalledTimes(2);
});

it("separates accounts and endpoints and bounds saved snapshots", async () => {
	list.mockResolvedValue({ success: true, videos: [] });
	expect(cache.sharedVideoCacheKey("a", "person")).not.toBe(
		cache.sharedVideoCacheKey("b", "person"),
	);
	expect(cache.sharedVideoCacheKey("a", "person")).not.toBe(
		cache.sharedVideoCacheKey("a", "other"),
	);
	for (let index = 0; index < 9; index++)
		await cache.readRecentSharedVideos(String(index), "https://share.test", "token");
	expect(cache.peekRecentSharedVideos("0")).toBeUndefined();
	expect(cache.peekRecentSharedVideos("8")).toEqual([]);
});

it("does not cache failures and refreshes explicitly after remote changes", async () => {
	list.mockResolvedValueOnce({ success: false, error: "Offline" });
	await expect(
		cache.readRecentSharedVideos("account", "https://share.test", "token"),
	).rejects.toThrow("Offline");
	list.mockResolvedValue({ success: true, videos: [] });
	await cache.readRecentSharedVideos("account", "https://share.test", "token");
	await cache.readRecentSharedVideos("account", "https://share.test", "token", true);
	expect(list).toHaveBeenCalledTimes(3);
});

it("invalidates pending snapshots on a share mutation", async () => {
	let release!: (value: { success: boolean; videos: never[] }) => void;
	list.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	const pending = cache.readRecentSharedVideos("account", "https://share.test", "token");
	await Promise.resolve();
	vi.mocked(subscribeShareCapacityChanges).mock.calls.at(-1)![0]();
	release({ success: true, videos: [] });
	await pending;
	expect(cache.peekRecentSharedVideos("account")).toBeUndefined();
	list.mockResolvedValue({ success: true, videos: [] });
	await cache.readRecentSharedVideos("account", "https://share.test", "token");
	expect(list).toHaveBeenCalledTimes(2);
});

it("keeps a known nonempty display snapshot during an expired background reload", async () => {
	const videos = [{ code: "demo", title: "Demo", url: "https://share.test/s/demo", ready: true }];
	list.mockResolvedValueOnce({ success: true, videos });
	await cache.readRecentSharedVideos("account", "https://share.test", "token");
	vi.advanceTimersByTime(60_001);
	let release!: (value: { success: boolean; videos: never[] }) => void;
	list.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	const pending = cache.readRecentSharedVideos("account", "https://share.test", "token");
	await Promise.resolve();
	expect(cache.peekRecentSharedVideos("account")).toEqual(videos);
	release({ success: true, videos: [] });
	await pending;
	expect(cache.peekRecentSharedVideos("account")).toEqual([]);
});

it("uses the newer result when a forced refresh overtakes an in-flight list", async () => {
	const old = { code: "old", title: "Old", url: "https://share.test/s/old", ready: true };
	let release!: (result: { success: boolean; videos: (typeof old)[] }) => void;
	list.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	).mockResolvedValueOnce({ success: true, videos: [] });
	const read = (fresh = false) =>
		cache.readRecentSharedVideos("account", "https://share.test", "token", fresh);
	const earlier = read();
	await Promise.resolve();
	const refreshed = read(true);
	expect(read()).toBe(refreshed);
	await expect(refreshed).resolves.toEqual([]);
	release({ success: true, videos: [old] });
	await earlier;
	expect(cache.peekRecentSharedVideos("account")).toEqual([]);
	expect(list).toHaveBeenCalledTimes(2);
});
