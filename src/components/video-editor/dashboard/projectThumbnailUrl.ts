import { resolveVideoUrl } from "../projectMediaPaths";

/** Images use the same approved local-media transport as project video sources. */
export async function resolveProjectThumbnailUrl(path: string, revision: number): Promise<string> {
	if (/^(data:|blob:)/i.test(path)) return path;
	const resolved = await resolveVideoUrl(path);
	if (/^file:/i.test(resolved) && /^https?:/i.test(window.location.protocol)) {
		throw new Error("Local thumbnail transport unavailable");
	}
	const url = new URL(resolved);
	// Capability URLs already contain path/token queries; keep them intact.
	url.searchParams.set("v", String(revision));
	return url.href;
}
