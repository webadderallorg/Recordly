import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import { normalizeProjectEditor } from "../projectPersistence";
import { getTimelineDurationMs } from "../types";
import { getCachedProjectPreview } from "./projectPreviewCache";

export type LibrarySort = "recent" | "created" | "name" | "duration" | "audio";
export type LibrarySortDirection = "asc" | "desc";
export const defaultLibrarySortDirection = (sort: LibrarySort): LibrarySortDirection =>
	sort === "name" ? "asc" : "desc";
export type LibraryMediaInfo = { duration?: number; hasAudio?: boolean };
export const needsLibraryMediaInfo = (sort: LibrarySort) => sort === "duration" || sort === "audio";
export const libraryMediaKey = (entry: ProjectLibraryEntry) => `${entry.path}:${entry.updatedAt}`;

export function compareLibraryEntries(
	a: ProjectLibraryEntry,
	b: ProjectLibraryEntry,
	sort: LibrarySort,
	locale: string,
	metadata: ReadonlyMap<string, LibraryMediaInfo>,
	direction: LibrarySortDirection = defaultLibrarySortDirection(sort),
) {
	const sign = direction === "asc" ? 1 : -1;
	const recent =
		b.updatedAt - a.updatedAt ||
		a.name.localeCompare(b.name, locale) ||
		a.path.localeCompare(b.path);
	if (sort === "name") return sign * a.name.localeCompare(b.name, locale) || recent;
	if (sort === "created")
		return sign * ((a.createdAt ?? a.updatedAt) - (b.createdAt ?? b.updatedAt)) || recent;
	if (!needsLibraryMediaInfo(sort)) return sign * (a.updatedAt - b.updatedAt) || recent;
	const left = metadata.get(libraryMediaKey(a));
	const right = metadata.get(libraryMediaKey(b));
	const x = sort === "audio" ? left?.hasAudio : left?.duration;
	const y = sort === "audio" ? right?.hasAudio : right?.duration;
	// Missing/corrupt/offline media always follows known values in either direction.
	if (x === undefined || y === undefined) return x === y ? recent : x === undefined ? 1 : -1;
	return sign * (Number(x) - Number(y)) || recent;
}

function readAudioDuration(url: string): Promise<number | undefined> {
	return new Promise((resolve) => {
		const audio = document.createElement("audio");
		const finish = () => {
			const duration =
				Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined;
			clearTimeout(timeout);
			audio.removeEventListener("loadedmetadata", finish);
			audio.removeEventListener("error", finish);
			audio.removeAttribute("src");
			audio.load();
			resolve(duration);
		};
		const timeout = setTimeout(finish, 8000);
		audio.addEventListener("loadedmetadata", finish);
		audio.addEventListener("error", finish);
		audio.preload = "metadata";
		audio.src = url;
	});
}

/** Read metadata only when requested by a media sort; never infer video audio from its name. */
export async function readLibraryMediaInfo(
	entry: ProjectLibraryEntry,
	audioOnly = false,
): Promise<LibraryMediaInfo> {
	const api = window.electronAPI;
	if (entry.rawSource && /\.(wav|m4a|mp3|ogg|flac)$/i.test(entry.rawSource.path)) {
		return {
			hasAudio: true,
			duration: audioOnly ? undefined : await readAudioDuration(entry.rawSource.url),
		};
	}
	let source = entry.rawSource?.path;
	let editor: ReturnType<typeof normalizeProjectEditor> | undefined;
	if (!source) {
		const preview = await getCachedProjectPreview(entry.path, entry.updatedAt);
		if (!preview.success) return {};
		source = preview.value.project.videoPath;
		editor = normalizeProjectEditor(preview.value.project.editor);
	}
	const [probe, companions] = await Promise.allSettled([
		api.probeNativeVideoMetadata(source),
		api.getVideoAudioFallbackPaths(source),
	]);
	const media =
		probe.status === "fulfilled" && probe.value.success ? probe.value.metadata : undefined;
	const hasCompanion =
		companions.status === "fulfilled" &&
		companions.value.success &&
		companions.value.paths.length > 0;
	const companionsKnown = companions.status === "fulfilled" && companions.value.success;
	const addedAudio = editor?.audioRegions.some(
		(region) => Boolean(region.audioPath) && region.endMs > region.startMs && region.volume > 0,
	);
	const duration = editor?.clipRegions.length
		? getTimelineDurationMs(editor.clipRegions, 0) / 1000
		: media?.duration;
	return {
		duration:
			duration !== undefined && Number.isFinite(duration) && duration > 0
				? duration
				: undefined,
		hasAudio:
			hasCompanion || addedAudio || media?.hasAudio === true
				? true
				: media?.hasAudio === false && companionsKnown
					? false
					: undefined,
	};
}
