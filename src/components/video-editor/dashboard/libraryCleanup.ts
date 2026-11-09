import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import type { EditorProjectData } from "../projectPersistence";
import { fromFileUrl } from "../projectMediaPaths";
import { getTimelineDurationMs } from "../types";
import { getProjectShareLink, getProjectShareLinkStrict } from "../cloud/projectShareLinks";
import { hasLibraryExport, readLibraryExportHistory } from "./libraryExportHistory";
import { readLibraryMediaInfo } from "./librarySort";

export type CleanupRule = "all" | "untouched" | "duplicates" | "unused" | "neverExported" | "short";
export const CLEANUP_SHORT_SECONDS = 5;
export function toggleCleanupRule(rules: readonly CleanupRule[], rule: CleanupRule): CleanupRule[] {
	if (rule === "all") return [];
	return rules.includes(rule)
		? rules.filter((item) => item !== rule)
		: [...rules.filter((item) => item !== "all"), rule];
}
export type CleanupPeriod = "all" | "older7" | "older30" | "older90" | "custom";
export type CleanupDateFilter = {
	period: CleanupPeriod;
	basis: "created" | "edited";
	from: string;
	to: string;
};
export type CleanupScan = {
	candidates: Set<string>;
	keepers: Map<string, string>;
	skipped: number;
	incomplete: boolean;
};

export function matchesCleanupDate(
	entry: ProjectLibraryEntry,
	filter: CleanupDateFilter,
	now = Date.now(),
) {
	const time = filter.basis === "created" ? entry.createdAt : entry.updatedAt;
	if (filter.period === "all") return true;
	if (time === undefined || !Number.isFinite(time)) return false;
	if (filter.period !== "custom") return time < now - Number(filter.period.slice(5)) * 86400000;
	// Calendar boundaries use local time and an exclusive next-day end, including DST.
	const from = filter.from ? new Date(`${filter.from}T00:00:00`).getTime() : -Infinity;
	const end = filter.to ? new Date(`${filter.to}T00:00:00`) : null;
	if (end) end.setDate(end.getDate() + 1);
	return time >= from && time < (end?.getTime() ?? Infinity);
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		const members = Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
		return `{${members.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/** Deliberately conservative: preserve all editor fields, IDs and source paths. */
export const projectDuplicateKey = (project: EditorProjectData) =>
	stableJson({ version: project.version, videoPath: project.videoPath, editor: project.editor });

export function hasNoTimelineEdits(project: EditorProjectData, durationMs: number) {
	const editor = project.editor;
	if (!Number.isFinite(durationMs) || durationMs <= 0) return false;
	const audioSettings = [
		editor.defaultSourceAudioTrackSettings,
		...Object.values(editor.sourceAudioTrackSettingsByClip ?? {}),
	];
	for (const settings of audioSettings) {
		if (
			settings !== undefined &&
			(!settings || typeof settings !== "object" || Array.isArray(settings))
		)
			return false;
		for (const setting of Object.values(settings ?? {})) {
			if (
				!setting ||
				typeof setting !== "object" ||
				(setting.volume !== undefined && setting.volume !== 1) ||
				setting.normalize
			)
				return false;
		}
	}
	for (const key of [
		"zoomRegions",
		"trimRegions",
		"speedRegions",
		"annotationRegions",
		"audioRegions",
		"autoCaptions",
	] as const) {
		if (editor[key] !== undefined && (!Array.isArray(editor[key]) || editor[key]!.length > 0))
			return false;
	}
	const clips = editor.clipRegions;
	if (clips === undefined) return true;
	if (!Array.isArray(clips)) return false;
	if (!clips.length) return true;
	if (clips.length !== 1) return false;
	const clip = clips[0];
	if (!clip || typeof clip !== "object") return false;
	return (
		clip.startMs === 0 &&
		(clip.sourceStartMs ?? 0) === 0 &&
		(clip.speed ?? 1) === 1 &&
		!clip.muted &&
		Math.abs(clip.endMs - durationMs) <= 1
	);
}

function pathValue(value: string) {
	const normalized = fromFileUrl(value).replace(/\\/g, "/");
	const prefix = normalized.startsWith("//") ? "//" : normalized.startsWith("/") ? "/" : "";
	const parts: string[] = [];
	for (const part of normalized.split("/")) {
		if (!part || part === ".") continue;
		if (part === ".." && parts.length && !/^[a-z]:$/i.test(parts[parts.length - 1]))
			parts.pop();
		else parts.push(part);
	}
	// Case-fold conservatively: ambiguous aliases are protected, even on a
	// case-sensitive volume, rather than suggested as unused recordings.
	return `${prefix}${parts.join("/")}`.toLowerCase();
}
function collectPaths(value: unknown, paths: Set<string>) {
	if (typeof value === "string") paths.add(pathValue(value));
	else if (Array.isArray(value)) value.forEach((item) => collectPaths(item, paths));
	else if (value && typeof value === "object")
		Object.values(value).forEach((item) => collectPaths(item, paths));
}

export function sourceIsReferenced(source: string, references: Set<string>) {
	source = pathValue(source);
	for (const reference of references) {
		const video = pathValue(reference);
		if (source === video) return true;
		if (!/\.(mp4|mov|webm|mkv|m4v)$/i.test(video)) continue;
		const stem = video.replace(/\.[^.]+$/, "");
		if (
			(source.startsWith(`${stem}.`) &&
				/^\.(system|mic|microphone|audio|webcam)\./i.test(source.slice(stem.length))) ||
			source.startsWith(`${stem}-webcam.`)
		)
			return true;
	}
	return false;
}

export function duplicateCandidates(
	groups: string[][],
	entries: ProjectLibraryEntry[],
	protectedPaths = new Set<string>(),
) {
	const candidates = new Set<string>();
	const keepers = new Map<string, string>();
	const byPath = new Map(entries.map((entry) => [entry.path, entry]));
	for (const group of groups) {
		const sorted = group
			.filter((path) => byPath.has(path))
			.sort(
				(a, b) =>
					Number(protectedPaths.has(b) || byPath.get(b)!.isCurrent) -
						Number(protectedPaths.has(a) || byPath.get(a)!.isCurrent) ||
					byPath.get(b)!.updatedAt - byPath.get(a)!.updatedAt ||
					a.localeCompare(b),
			);
		for (const path of sorted.slice(1)) {
			if (protectedPaths.has(path) || byPath.get(path)!.isCurrent) continue;
			candidates.add(path);
			keepers.set(path, sorted[0]);
		}
	}
	return { candidates, keepers };
}

export async function scanCleanup(
	selection: CleanupRule | readonly CleanupRule[],
	entries: ProjectLibraryEntry[],
	projects: ProjectLibraryEntry[],
	isRaw: boolean,
	cancelled: () => boolean,
	shortSeconds = CLEANUP_SHORT_SECONDS,
): Promise<CleanupScan> {
	const rules = [
		...new Set(
			(typeof selection === "string" ? [selection] : selection).filter(
				(rule) => rule !== "all",
			),
		),
	];
	const result: CleanupScan = {
		candidates: new Set(),
		keepers: new Map(),
		skipped: 0,
		incomplete: false,
	};
	const eligible = entries.filter((entry) => !entry.isCurrent);
	if (rules.includes("short") && (!Number.isFinite(shortSeconds) || shortSeconds <= 0))
		return result;
	if (!rules.length) {
		result.candidates = new Set(eligible.map((entry) => entry.path));
		return result;
	}
	const candidates = new Map(rules.map((rule) => [rule, new Set<string>()]));
	const references = new Set<string>();
	const exportedSources = new Set<string>();
	const groups = new Map<string, string[]>();
	const history = readLibraryExportHistory();
	if (rules.includes("neverExported") && !history.available) result.skipped++;
	let index = 0;
	const work = async () => {
		while (!cancelled() && index < projects.length) {
			const entry = projects[index++];
			try {
				const preview = await window.electronAPI.getProjectPreview(entry.path);
				if (!preview.success) throw new Error("Unreadable project");
				if (isRaw && preview.value.sourcePathsComplete === false)
					throw new Error("Incomplete source references");
				const project = preview.value.project;
				if (!project?.videoPath || !project.editor) throw new Error("Invalid project");
				const knownExport =
					hasLibraryExport(history.records, {
						projectId: project.projectId,
						projectPath: entry.path,
						sourcePath: project.videoPath,
					}) ||
					Boolean(
						rules.includes("neverExported")
							? getProjectShareLinkStrict(entry.path)
							: getProjectShareLink(entry.path),
					);
				collectPaths(project, references);
				collectPaths(preview.value.videoUrl, references);
				collectPaths(preview.value.webcamUrl, references);
				collectPaths(preview.value.sourcePaths, references);
				if (knownExport) {
					collectPaths(project.videoPath, exportedSources);
					collectPaths(preview.value.sourcePaths, exportedSources);
				}
				if (isRaw) continue;
				if (rules.includes("duplicates")) {
					const key = projectDuplicateKey(project);
					groups.set(key, [...(groups.get(key) ?? []), entry.path]);
				}
				if (entry.isCurrent) continue;
				if (rules.includes("neverExported") && history.available && !knownExport)
					candidates.get("neverExported")!.add(entry.path);
				if (rules.includes("untouched") || rules.includes("short")) {
					const probe = await window.electronAPI.probeNativeVideoMetadata(
						project.videoPath,
					);
					if (!probe.success || !probe.metadata) throw new Error("Unreadable media");
					if (
						rules.includes("untouched") &&
						hasNoTimelineEdits(project, probe.metadata.duration * 1000)
					)
						candidates.get("untouched")!.add(entry.path);
					const duration = project.editor.clipRegions?.length
						? getTimelineDurationMs(project.editor.clipRegions, 0) / 1000
						: probe.metadata.duration;
					if (Number.isFinite(duration) && duration > 0 && duration <= shortSeconds)
						candidates.get("short")?.add(entry.path);
				}
			} catch {
				result.skipped++;
			}
		}
	};
	await Promise.all([work(), work()]);
	if (cancelled()) return result;
	if (isRaw) {
		result.incomplete = result.skipped > 0;
		if (result.incomplete) return result;
		const protectedPaths = new Set(
			entries
				.filter((entry) => sourceIsReferenced(entry.path, references))
				.map((entry) => entry.path),
		);
		if (rules.includes("unused"))
			candidates.set(
				"unused",
				new Set(
					eligible
						.filter((entry) => !protectedPaths.has(entry.path))
						.map((entry) => entry.path),
				),
			);
		if (rules.includes("duplicates")) {
			const duplicates = await window.electronAPI.findDuplicateRecordingSources();
			if (!duplicates.success) throw new Error(duplicates.error);
			const found = duplicateCandidates(duplicates.value, entries, protectedPaths);
			candidates.set("duplicates", found.candidates);
			result.keepers = found.keepers;
		}
		for (const entry of eligible) {
			if (cancelled()) return result;
			if (
				rules.includes("neverExported") &&
				history.available &&
				!hasLibraryExport(history.records, { sourcePath: entry.path }, true) &&
				!sourceIsReferenced(entry.path, exportedSources)
			)
				candidates.get("neverExported")!.add(entry.path);
			if (rules.includes("short")) {
				try {
					const duration = (await readLibraryMediaInfo(entry)).duration;
					if (duration !== undefined && duration > 0 && duration <= shortSeconds)
						candidates.get("short")!.add(entry.path);
				} catch {
					result.skipped++;
				}
			}
		}
	} else if (rules.includes("duplicates")) {
		const found = duplicateCandidates([...groups.values()], entries);
		candidates.set("duplicates", found.candidates);
		result.keepers = found.keepers;
	}
	result.candidates = new Set(
		eligible
			.filter((entry) => rules.every((rule) => candidates.get(rule)?.has(entry.path)))
			.map((entry) => entry.path),
	);
	return result;
}
