import { expect, it, vi } from "vitest";
import { collectReleaseVersions, createReleaseVersionCatalog } from "./releaseVersions";

const release = (tag = "v1.4.0", name = "Recordly-arm64.dmg") => ({
	tag_name: tag,
	draft: false,
	prerelease: tag.includes("-"),
	published_at: "2026-11-01T00:00:00Z",
	assets: [
		{
			name,
			browser_download_url: `https://github.com/webadderallorg/Recordly/releases/download/${tag}/${name}`,
		},
	],
});
it("lists published compatible installers, including older and prerelease versions", () => {
	const result = collectReleaseVersions(
		[
			release(),
			release("v1.3.3"),
			release("v1.4.0-beta.1"),
			release("v1.3.2", "Recordly-x64.dmg"),
			{ ...release("v9.0.0"), draft: true },
		],
		"darwin",
		"arm64",
	);
	expect([...result.values()].map((item) => item.release.version)).toEqual([
		"1.4.0",
		"1.3.3",
		"1.4.0-beta.1",
	]);
	expect(result.get("v1.4.0-beta.1")?.release.prerelease).toBe(true);
});
it("rejects injected URLs, invalid tags and unsupported architectures", () => {
	const bad = {
		...release(),
		assets: [
			{
				name: "Recordly-arm64.dmg",
				browser_download_url: "https://example.com/installer.dmg",
			},
		],
	};
	expect(collectReleaseVersions([bad, release("../../installer")], "darwin", "arm64").size).toBe(
		0,
	);
	expect(collectReleaseVersions([release()], "darwin", "ia32").size).toBe(0);
	expect(collectReleaseVersions(null, "darwin", "arm64").size).toBe(0);
});
it("chooses matching Windows and Linux packages", () => {
	expect(
		collectReleaseVersions([release("v1.4.0", "Recordly-windows-x64.exe")], "win32", "x64")
			.size,
	).toBe(1);
	expect(
		collectReleaseVersions([release("v1.4.0", "Recordly-linux-x64.AppImage")], "linux", "x64")
			.size,
	).toBe(1);
});
it("caches release metadata and only resolves tags the main process has listed", async () => {
	const fetcher = vi
		.fn()
		.mockResolvedValue(new Response(JSON.stringify([release()]), { status: 200 }));
	const catalog = createReleaseVersionCatalog("darwin", "arm64", fetcher);
	expect(catalog.installer("v1.4.0")).toBeNull();
	await catalog.list();
	await catalog.list();
	expect(fetcher).toHaveBeenCalledOnce();
	expect(catalog.installer("v1.4.0")).toBe(
		"https://github.com/webadderallorg/Recordly/releases/download/v1.4.0/Recordly-arm64.dmg",
	);
	expect(catalog.installer("https://example.com")).toBeNull();
	expect(catalog.installer("v9.0.0")).toBeNull();
});
it("allows retry after HTTP or invalid response failures", async () => {
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(new Response("rate limited", { status: 403 }))
		.mockResolvedValueOnce(new Response("{}", { status: 200 }))
		.mockResolvedValueOnce(new Response(JSON.stringify([release()]), { status: 200 }));
	const catalog = createReleaseVersionCatalog("darwin", "arm64", fetcher);
	await expect(catalog.list()).rejects.toThrow("403");
	await expect(catalog.list()).rejects.toThrow("invalid response");
	expect(await catalog.list()).toHaveLength(1);
});

it("shares pending lookups across dialog reopenings", async () => {
	let resolve!: (response: Response) => void;
	const fetcher = vi.fn(
		() =>
			new Promise<Response>((done) => {
				resolve = done;
			}),
	);
	const catalog = createReleaseVersionCatalog("darwin", "arm64", fetcher);
	const first = catalog.list(),
		second = catalog.list();
	expect(fetcher).toHaveBeenCalledOnce();
	resolve(new Response(JSON.stringify([release()]), { status: 200 }));
	const [a, b] = await Promise.all([first, second]);
	expect(a).toEqual(b);
	expect(a[0].tag).toBe("v1.4.0");
});
it("clears a failed shared lookup so the next request can retry", async () => {
	let reject!: (error: Error) => void;
	const fetcher = vi
		.fn()
		.mockImplementationOnce(
			() =>
				new Promise<Response>((_, fail) => {
					reject = fail;
				}),
		)
		.mockResolvedValueOnce(new Response(JSON.stringify([release()]), { status: 200 }));
	const catalog = createReleaseVersionCatalog("darwin", "arm64", fetcher);
	const pending = Promise.allSettled([catalog.list(), catalog.list()]);
	reject(new Error("offline"));
	expect((await pending).map((item) => item.status)).toEqual(["rejected", "rejected"]);
	expect(fetcher).toHaveBeenCalledOnce();
	expect(await catalog.list()).toHaveLength(1);
	expect(fetcher).toHaveBeenCalledTimes(2);
});
