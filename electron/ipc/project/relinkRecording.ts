import fs from "node:fs/promises";
import path from "node:path";
import { isSupportedLocalMediaPath } from "../../mediaTypes";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { probeNativeVideoMetadata } from "../ffmpeg/metadata";
import { normalizeVideoSourcePath, parseJsonWithByteOrderMark } from "../utils";
import { updateProjectFileAtomically } from "./atomicSave";
import { isLoadableProjectData, requireLibraryProject } from "./manager";

/** Include undo history and trim bounds so reconnecting cannot truncate saved edits. */
export function requiredRecordingDurationMs(project: Record<string, unknown>): number {
	let required = 0;
	const visit = (value: unknown) => {
		if (!value || typeof value !== "object") return;
		if (Array.isArray(value)) {
			for (const entry of value) visit(entry);
			return;
		}
		const item = value as Record<string, unknown>;
		const { startMs, endMs, sourceStartMs, speed, sourceMaxMs } = item;
		if (typeof startMs === "number" && typeof endMs === "number") {
			const start = typeof sourceStartMs === "number" ? sourceStartMs : startMs;
			const rate = typeof speed === "number" && speed > 0 ? speed : 1;
			const end = start + Math.max(0, endMs - startMs) * rate;
			if (Number.isFinite(end)) required = Math.max(required, end);
			if (typeof sourceMaxMs === "number" && Number.isFinite(sourceMaxMs))
				required = Math.max(required, sourceMaxMs);
		}
		for (const nested of Object.values(item)) visit(nested);
	};
	const editor = project.editor as Record<string, unknown>;
	// Other timeline tracks can extend beyond the recording (music, annotations).
	visit(editor.clipRegions);
	visit(editor.trimRegions);
	const history = project.history as
		| {
				version?: unknown;
				values?: unknown[];
				past?: unknown[];
				current?: unknown;
				future?: unknown[];
		  }
		| undefined;
	// The pool also contains source-time speed regions; only referenced clips need speed conversion.
	if (history?.version === 1 && Array.isArray(history.values)) {
		for (const snapshot of [
			...(Array.isArray(history.past) ? history.past : []),
			history.current,
			...(Array.isArray(history.future) ? history.future : []),
		]) {
			if (!snapshot || typeof snapshot !== "object") continue;
			const clips = (snapshot as { clipRegions?: unknown }).clipRegions;
			if (!Array.isArray(clips)) continue;
			for (const id of clips) {
				if (Number.isInteger(id) && id >= 0 && id < history.values.length)
					visit(history.values[id]);
			}
		}
	}
	return required;
}

/** A native picker supplies the replacement; the renderer never authorizes a new path. */
export async function relinkProjectRecording(
	projectPath: string,
	chooseRecording: (missingPath: string) => Promise<string | null>,
	probe = (file: string) => probeNativeVideoMetadata(getFfmpegBinaryPath(), file),
	isCurrent = () => true,
) {
	const target = await requireLibraryProject(projectPath);
	const original = await fs.readFile(target, "utf-8");
	const project = parseJsonWithByteOrderMark(original);
	if (!isLoadableProjectData(project)) throw new Error("Invalid project file format");
	const missingPath = normalizeVideoSourcePath(project.videoPath);
	if (!missingPath) throw new Error("Invalid project video path");
	try {
		await fs.access(missingPath);
		throw new Error("The project's recording is already available. Open the project again.");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const selected = await chooseRecording(missingPath);
	if (!selected) return { success: false, canceled: true };
	if (!isCurrent()) return { success: false, canceled: true };
	if (!path.isAbsolute(selected) || !(await fs.stat(selected)).isFile())
		throw new Error("relinkRecordingInvalid");
	const canonical = await fs.realpath(selected);
	if (!isSupportedLocalMediaPath(selected) || !isSupportedLocalMediaPath(canonical))
		throw new Error("relinkRecordingInvalid");
	let metadata: Awaited<ReturnType<typeof probe>>;
	try {
		metadata = await probe(selected);
	} catch {
		throw new Error("relinkRecordingInvalid");
	}
	if (
		![metadata.width, metadata.height, metadata.duration].every(
			(value) => Number.isFinite(value) && value > 0,
		)
	)
		throw new Error("relinkRecordingInvalid");
	// Allow metadata rounding of up to one frame without accepting truncated edits.
	const toleranceMs = Math.min(
		50,
		1000 / Math.max(1, Number.isFinite(metadata.frameRate) ? metadata.frameRate : 60),
	);
	if (metadata.duration * 1000 + toleranceMs < requiredRecordingDurationMs(project))
		throw new Error("relinkRecordingTooShort");
	await updateProjectFileAtomically(target, (contents) => {
		if (!isCurrent()) throw new Error("relinkProjectChanged");
		if (contents !== original) throw new Error("relinkProjectChanged");
		return JSON.stringify({ ...project, videoPath: selected }, null, 2);
	});
	return { success: true, path: target };
}
