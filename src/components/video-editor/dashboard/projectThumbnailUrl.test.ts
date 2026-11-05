import { afterEach, expect, it, vi } from "vitest";
import { resolveProjectThumbnailUrl } from "./projectThumbnailUrl";

afterEach(() => vi.unstubAllGlobals());

it.each([
	"/Users/demo/Projects/Cat #1.recordly.preview.png",
	"file:///Users/demo/Projects/Cat%20%231.recordly.preview.png",
])("loads a local PNG through approved media transport and preserves its capability: %s", async (source) => {
	const path = "/Users/demo/Projects/Cat #1.recordly.preview.png";
	const serverUrl = new URL("http://127.0.0.1:1234/video");
	serverUrl.searchParams.set("path", path);
	serverUrl.searchParams.set("token", "approved-image-capability");
	const getLocalMediaUrl = vi.fn().mockResolvedValue({ success: true, url: serverUrl.href });
	vi.stubGlobal("window", { location: { protocol: "http:" }, electronAPI: { getLocalMediaUrl } });
	const result = new URL(await resolveProjectThumbnailUrl(source, 123));
	expect(getLocalMediaUrl).toHaveBeenCalledWith(path);
	expect(result.origin).toBe("http://127.0.0.1:1234");
	expect(result.searchParams.get("path")).toBe(path);
	expect(result.searchParams.get("token")).toBe("approved-image-capability");
	expect(result.searchParams.get("v")).toBe("123");
});

it("preserves remote queries and replaces an old cache revision", async () => {
	const getLocalMediaUrl = vi.fn();
	vi.stubGlobal("window", { location: { protocol: "http:" }, electronAPI: { getLocalMediaUrl } });
	const result = new URL(
		await resolveProjectThumbnailUrl("https://example.test/thumb?size=640&v=old", 7),
	);
	expect(result.searchParams.get("size")).toBe("640");
	expect(result.searchParams.getAll("v")).toEqual(["7"]);
	expect(getLocalMediaUrl).not.toHaveBeenCalled();
});

it("reports unavailable local transport without giving the HTTP renderer a blocked file URL", async () => {
	vi.stubGlobal("window", {
		location: { protocol: "http:" },
		electronAPI: { getLocalMediaUrl: async () => ({ success: false }) },
	});
	await expect(resolveProjectThumbnailUrl("/private/preview.png", 1)).rejects.toThrow(
		"transport unavailable",
	);
});

it.each([
	"data:image/png;base64,preview",
	"blob:http://localhost/preview",
])("keeps in-memory previews unchanged: %s", async (source) => {
	expect(await resolveProjectThumbnailUrl(source, 123)).toBe(source);
});
