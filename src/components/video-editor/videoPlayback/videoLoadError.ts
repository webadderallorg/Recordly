export const VIDEO_LOAD_ERROR_PREFIX = "Failed to load video";

const SERVABLE_CHECK_TIMEOUT_MS = 2000;

const MEDIA_ERR_ABORTED = 1;
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

export type VideoLoadErrorKind = "aborted" | "network" | "decode" | "src-not-supported" | "unknown";

export type VideoLoadErrorDetail = {
	code?: number;
	kind: VideoLoadErrorKind;
	message?: string;
	src: string;
	sourcePath: string;
	servable: boolean | null;
};

export type ServableCheckDeps = {
	getLocalMediaUrl: (filePath: string) => Promise<{ success: boolean }>;
	timeoutMs?: number;
};

export function toVideoLoadErrorKind(code?: number): VideoLoadErrorKind {
	if (code === MEDIA_ERR_ABORTED) return "aborted";
	if (code === MEDIA_ERR_NETWORK) return "network";
	if (code === MEDIA_ERR_DECODE) return "decode";
	if (code === MEDIA_ERR_SRC_NOT_SUPPORTED) return "src-not-supported";
	return "unknown";
}

export async function isSourceStillServable(
	sourcePath: string,
	deps: ServableCheckDeps,
): Promise<boolean | null> {
	if (!sourcePath) return null;

	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			deps.getLocalMediaUrl(sourcePath).then((result) => result.success),
			new Promise<null>((resolve) => {
				timer = setTimeout(
					() => resolve(null),
					deps.timeoutMs ?? SERVABLE_CHECK_TIMEOUT_MS,
				);
			}),
		]);
	} catch {
		return null;
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

export function resolveDefaultServableCheckDeps(): ServableCheckDeps | null {
	const api = typeof window === "undefined" ? undefined : window.electronAPI;
	if (!api?.getLocalMediaUrl) return null;
	return { getLocalMediaUrl: (filePath) => api.getLocalMediaUrl(filePath) };
}

function describeDetail({ kind, message, servable }: VideoLoadErrorDetail): string {
	const raw = message?.trim() ?? "";

	if (kind === "aborted") return "loading was cancelled";

	if (raw.includes("URL safety check")) {
		return "this page is not allowed to load the file:// URL for the recording";
	}

	if (raw.includes("DEMUXER_ERROR_COULD_NOT_OPEN")) {
		return "the file is empty or was cut off before it finished writing";
	}

	if (servable === false) {
		return "the app is no longer serving this file to the player";
	}

	if (kind === "network") {
		return raw ? `the download failed — ${raw}` : "the download failed";
	}

	if (kind === "decode") {
		return raw ? `the video could not be decoded — ${raw}` : "the video could not be decoded";
	}

	if (kind === "src-not-supported") {
		return raw
			? `the file could not be fetched or decoded — ${raw}`
			: "the file could not be fetched or decoded, and the player gave no reason";
	}

	return raw || "the player reported no reason";
}

export function describeVideoLoadError(detail: VideoLoadErrorDetail): string {
	return `${VIDEO_LOAD_ERROR_PREFIX} (${describeDetail(detail)})`;
}

export function formatVideoLoadErrorLog(detail: VideoLoadErrorDetail): string {
	return [
		`code=${detail.code ?? "unknown"}`,
		`kind=${detail.kind}`,
		`message=${JSON.stringify(detail.message ?? "")}`,
		`src=${detail.src}`,
		`sourcePath=${detail.sourcePath}`,
		`servable=${String(detail.servable)}`,
	].join(" ");
}
