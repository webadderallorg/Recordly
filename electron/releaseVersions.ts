export interface ReleaseVersion {
	tag: string;
	version: string;
	prerelease: boolean;
	publishedAt: string;
}

const RELEASES_API = "https://api.github.com/repos/webadderallorg/Recordly/releases?per_page=100";
const DOWNLOAD_BASE = "https://github.com/webadderallorg/Recordly/releases/download/";
const TAG = /^v?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;

type ReleaseAsset = { name?: unknown; browser_download_url?: unknown };
type PublishedRelease = {
	tag_name?: unknown;
	draft?: unknown;
	prerelease?: unknown;
	published_at?: unknown;
	assets?: unknown;
};

export function collectReleaseVersions(value: unknown, platform: string, arch: string) {
	const filename =
		platform === "darwin" && ["arm64", "x64"].includes(arch)
			? `Recordly-${arch}.dmg`
			: platform === "win32" && arch === "x64"
				? "Recordly-windows-x64.exe"
				: platform === "linux" && ["arm64", "x64"].includes(arch)
					? `Recordly-linux-${arch}.AppImage`
					: null;
	const versions = new Map<string, { release: ReleaseVersion; installer: string }>();
	if (!filename || !Array.isArray(value)) return versions;
	for (const candidate of value) {
		if (!candidate || typeof candidate !== "object") continue;
		const item = candidate as PublishedRelease;
		const tag = item.tag_name;
		if (
			item.draft !== false ||
			typeof tag !== "string" ||
			tag.length > 80 ||
			!TAG.test(tag) ||
			!Array.isArray(item.assets)
		)
			continue;
		const installer = `${DOWNLOAD_BASE}${encodeURIComponent(tag)}/${filename}`;
		const found = item.assets.some(
			(asset: ReleaseAsset | null) =>
				asset && asset.name === filename && asset.browser_download_url === installer,
		);
		if (!found || versions.has(tag)) continue;
		versions.set(tag, {
			release: {
				tag,
				version: tag.replace(/^v/, ""),
				prerelease: item.prerelease === true,
				publishedAt: typeof item.published_at === "string" ? item.published_at : "",
			},
			installer,
		});
	}
	return versions;
}

/** The renderer selects a tag; it never supplies a URL or executable path. */
export function createReleaseVersionCatalog(
	platform: string,
	arch: string,
	fetcher: typeof fetch = fetch,
) {
	let catalog = new Map<string, { release: ReleaseVersion; installer: string }>();
	let loadedAt = 0;
	let inFlight: Promise<ReleaseVersion[]> | null = null;
	return {
		async list() {
			if (catalog.size && Date.now() - loadedAt < 5 * 60_000)
				return [...catalog.values()].map((item) => item.release);
			inFlight ??= (async () => {
				const response = await fetcher(RELEASES_API, {
					headers: { Accept: "application/vnd.github+json", "User-Agent": "Recordly" },
					signal: AbortSignal.timeout(10_000),
				});
				if (!response.ok) throw new Error(`Release lookup failed (${response.status}).`);
				const data: unknown = await response.json();
				if (!Array.isArray(data))
					throw new Error("The release service returned an invalid response.");
				catalog = collectReleaseVersions(data, platform, arch);
				loadedAt = Date.now();
				return [...catalog.values()].map((item) => item.release);
			})().finally(() => {
				inFlight = null;
			});
			return inFlight;
		},
		installer(tag: unknown) {
			if (typeof tag !== "string" || !TAG.test(tag)) return null;
			return catalog.get(tag)?.installer ?? null;
		},
	};
}
