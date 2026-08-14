import type { SourceAudioTrackWithPeaks } from "@/components/video-editor/audio/audioTypes";
import type { AudioPeaksData } from "./core/timelineTypes";

export type SourceSidecarSuffix = "mic" | "system";

export type SourceSidecarExtension = ".wav" | ".m4a" | ".webm";

const SOURCE_SIDECAR_EXTENSIONS: readonly SourceSidecarExtension[] = [".wav", ".m4a", ".webm"];

// Windows WGC/native recordings always materialize .system.wav/.mic.wav sidecars
// in the main process (see electron/ipc/register/recording.ts), so the .m4a/
// .webm variants are impossible candidates there. Avoiding them keeps the
// renderer from asking the media server for nonexistent paths on Windows while
// macOS/Linux retain the real .m4a/.webm fallback behavior.
const WINDOWS_SIDECAR_EXTENSIONS: readonly SourceSidecarExtension[] = [".wav"];

// Marker substrings used to classify authoritative companion audio sidecars into
// the dedicated system/mic tracks emitted by the recording main process
// (recording-<id>.system.wav / recording-<id>.mic.wav).
const SYSTEM_SIDECAR_MARK = ".system.";
const MIC_SIDECAR_MARK = ".mic.";

export function resolveSourceSidecarExtensions(
	navigatorPlatform?: string,
): readonly SourceSidecarExtension[] {
	// navigator.platform is "Win32"/"Win64" on Windows; matching the prefix avoids
	// false positives from strings that merely contain "win" (e.g. "darwin").
	return /^win/i.test(navigatorPlatform ?? "")
		? WINDOWS_SIDECAR_EXTENSIONS
		: SOURCE_SIDECAR_EXTENSIONS;
}

export function isWindowsNavigatorPlatform(navigatorPlatform?: string): boolean {
	return /^win/i.test(navigatorPlatform ?? "");
}

// Classifies the authoritative companion sidecar paths returned by the main
// process (get-video-audio-fallback-paths) into system/mic tracks, deduplicated
// and filtered so impossible candidates never reach the media server. On Windows
// only .wav sidecars are ever materialized, so any stray .m4a/.webm path is
// dropped. `pendingPaths` are the deterministic sidecar paths the finalized
// recording metadata reports as expected but not yet materialized; the waveform
// keeps retrying those while never probing impossible or duplicate candidates.
export interface AuthoritativeSourceSidecars {
	systemPaths: readonly string[];
	micPaths: readonly string[];
	pendingPaths: readonly string[];
}

function isSidecarPathAllowed(path: string, navigatorPlatform?: string): boolean {
	if (!isWindowsNavigatorPlatform(navigatorPlatform)) {
		return true;
	}
	return /\.wav$/i.test(path);
}

function classifySidecarPathKind(path: string): "system" | "mic" | "other" {
	if (path.includes(SYSTEM_SIDECAR_MARK)) {
		return "system";
	}
	if (path.includes(MIC_SIDECAR_MARK)) {
		return "mic";
	}
	return "other";
}

export function classifyAuthoritativeSourceSidecars(
	authoritativePaths: readonly string[],
	pendingPaths: readonly string[] = [],
	navigatorPlatform?: string,
): AuthoritativeSourceSidecars {
	const platform = navigatorPlatform ?? getRendererNavigatorPlatform();
	const systemPaths: string[] = [];
	const micPaths: string[] = [];
	const known = new Set<string>();

	const pushUnique = (target: string[], value: string): void => {
		if (!isSidecarPathAllowed(value, platform) || known.has(value)) {
			return;
		}
		known.add(value);
		target.push(value);
	};

	for (const path of authoritativePaths) {
		const kind = classifySidecarPathKind(path);
		if (kind === "system") {
			pushUnique(systemPaths, path);
		} else if (kind === "mic") {
			pushUnique(micPaths, path);
		}
	}

	const delayedPaths: string[] = [];
	for (const path of pendingPaths) {
		pushUnique(delayedPaths, path);
	}

	return { systemPaths, micPaths, pendingPaths: delayedPaths };
}

export function getRendererNavigatorPlatform(): string | undefined {
	return typeof navigator !== "undefined" ? navigator.platform : undefined;
}

export function buildSourceSidecarPathCandidates(
	source: string,
	suffix: SourceSidecarSuffix,
	navigatorPlatform?: string,
): string[] {
	const normalized = source.replace(/\\/g, "/");
	const lastSlash = normalized.lastIndexOf("/");
	const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : "";
	const fileName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
	const dotIndex = fileName.lastIndexOf(".");
	const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
	const platform = navigatorPlatform ?? getRendererNavigatorPlatform();
	return resolveSourceSidecarExtensions(platform).map(
		(extension) => `${dir}${baseName}.${suffix}${extension}`,
	);
}

export interface MediaUrlResourceResolver {
	(resource: string): Promise<string>;
}

const MEDIA_URL_RESOLVER_CACHE_BOUND = 64;

// Bounded per-path LRU cache for media resource URL resolution. Memoizing the
// resolved URL means a remount/session refresh for the same sidecar path does
// not repeat an identical get-local-media-url IPC call, while the bound keeps
// memory flat across a long editing session. It only memoizes the result of the
// existing resolver (which still enforces media-server security per request).
export class BoundedMediaUrlResolverCache {
	private readonly cache = new Map<string, Promise<string>>();
	private readonly bound: number;
	private readonly resolveResource: MediaUrlResourceResolver;

	constructor(resolve: MediaUrlResourceResolver, bound = MEDIA_URL_RESOLVER_CACHE_BOUND) {
		this.resolveResource = resolve;
		this.bound = Math.max(1, bound);
	}

	resolve(resource: string): Promise<string> {
		const cached = this.cache.get(resource);
		if (cached !== undefined) {
			// Refresh LRU ordering so recently used paths survive eviction.
			this.cache.delete(resource);
			this.cache.set(resource, cached);
			return cached;
		}

		if (this.cache.size >= this.bound) {
			const oldest = this.cache.keys().next().value;
			if (oldest !== undefined) {
				this.cache.delete(oldest);
			}
		}

		const inFlight = this.resolveResource(resource);
		this.cache.set(resource, inFlight);
		inFlight.catch(() => {
			// Do not cache a failed resolution forever; allow a later retry.
			if (this.cache.get(resource) === inFlight) {
				this.cache.delete(resource);
			}
		});
		return inFlight;
	}

	clear(): void {
		this.cache.clear();
	}
}

export function buildTimelineSourceAudioTracks({
	sourceAudioPeaks,
	micSidecarPeaks,
	systemSidecarPeaks,
	labels,
}: {
	sourceAudioPeaks: AudioPeaksData | null;
	micSidecarPeaks: AudioPeaksData | null;
	systemSidecarPeaks: AudioPeaksData | null;
	labels: {
		system: string;
		mic: string;
		mixed: string;
	};
}): SourceAudioTrackWithPeaks[] {
	if (systemSidecarPeaks || micSidecarPeaks) {
		const tracks: SourceAudioTrackWithPeaks[] = [];
		if (systemSidecarPeaks) {
			tracks.push({
				id: "system",
				label: labels.system,
				peaks: systemSidecarPeaks,
			});
		} else if (micSidecarPeaks && sourceAudioPeaks) {
			tracks.push({
				id: "system",
				label: labels.system,
				peaks: sourceAudioPeaks,
			});
		}
		if (micSidecarPeaks) {
			tracks.push({
				id: "mic",
				label: labels.mic,
				peaks: micSidecarPeaks,
			});
		}
		return tracks;
	}

	return sourceAudioPeaks
		? [
				{
					id: "mixed",
					label: labels.mixed,
					peaks: sourceAudioPeaks,
				},
			]
		: [];
}
