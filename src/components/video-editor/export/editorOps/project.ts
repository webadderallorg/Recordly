import {
	type EditorProjectData,
	fromFileUrl,
	normalizeProjectEditor,
	validateProjectData,
} from "../../projectPersistence";
import {
	type EditorOpContext,
	type EditorOpMap,
	nextId,
	rejectUnknown,
	requireObject,
} from "./types";

export const PROJECT_IO_TIMEOUT_MS = 15_000;
export const MAX_PROJECT_NAME_LENGTH = 100;
const PROJECT_EXTENSIONS = [".recordly", ".openscreen"];
const ABSOLUTE_PATH = /^(\/|[A-Za-z]:[\\/]|\\\\)/;
const FORBIDDEN_NAME = /[<>:"/\\|?*]/;

async function within<T>(work: Promise<T>, waitingFor: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() =>
						reject(
							new Error(
								`Timed out after ${PROJECT_IO_TIMEOUT_MS / 1000} seconds waiting for ${waitingFor}.`,
							),
						),
					PROJECT_IO_TIMEOUT_MS,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

function requireProject(context: EditorOpContext, op: string) {
	if (!context.project || !context.videoSourcePath) {
		throw new Error(`There is no recording loaded, so ${op} has nothing to work on.`);
	}
	return context.project;
}

function requireIdle(context: EditorOpContext, op: string) {
	if (context.project?.isExporting) {
		throw new Error(`An export is running. Wait for it to finish before ${op}.`);
	}
}

function readName(value: unknown, op: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${op} needs a non-empty name.`);
	}
	const name = value.trim();
	if (name.length > MAX_PROJECT_NAME_LENGTH) {
		throw new Error(`${op}: the name is longer than ${MAX_PROJECT_NAME_LENGTH} characters.`);
	}
	if (
		FORBIDDEN_NAME.test(name) ||
		Array.from(name).some((character) => character.charCodeAt(0) < 32) ||
		name === "." ||
		name === ".." ||
		name.endsWith(".")
	) {
		throw new Error(
			`${op}: the name "${name}" cannot be used. Leave out slashes, control characters and any of < > : " | ? *, and do not end it with a dot.`,
		);
	}
	return name;
}

function readPath(value: unknown, op: string): string {
	if (typeof value !== "string" || !ABSOLUTE_PATH.test(value) || value.includes("\0")) {
		throw new Error(`${op}: path must be an absolute path to a Recordly project file.`);
	}
	if (!PROJECT_EXTENSIONS.some((extension) => value.toLowerCase().endsWith(extension))) {
		throw new Error(
			`${op}: "${value}" is not a Recordly project. Project files end in ${PROJECT_EXTENSIONS.join(" or ")}.`,
		);
	}
	return value;
}

function counts(editor: Partial<ReturnType<typeof normalizeProjectEditor>>) {
	return {
		clips: editor.clipRegions?.length ?? 0,
		zooms: editor.zoomRegions?.length ?? 0,
		annotations: editor.annotationRegions?.length ?? 0,
		captions: editor.autoCaptions?.length ?? 0,
		audio: editor.audioRegions?.length ?? 0,
		speeds: editor.speedRegions?.length ?? 0,
	};
}

function lookOf(editor: Partial<ReturnType<typeof normalizeProjectEditor>>) {
	return {
		wallpaper: editor.wallpaper,
		padding: editor.padding,
		borderRadius: editor.borderRadius,
		shadowIntensity: editor.shadowIntensity,
		backgroundBlur: editor.backgroundBlur,
	};
}

async function resolveOpenPath(args: Record<string, unknown>): Promise<string> {
	if ((args.name === undefined) === (args.path === undefined)) {
		throw new Error("project.open needs exactly one of name or path.");
	}
	if (args.path !== undefined) return readPath(args.path, "project.open");
	const name = readName(args.name, "project.open");
	const folder = await within(
		window.electronAPI.getProjectsDirectory(),
		"the projects folder to be located",
	);
	if (!folder.success || !folder.path) {
		throw new Error(folder.error ?? "Recordly could not find its projects folder.");
	}
	const separator = folder.path.includes("\\") ? "\\" : "/";
	const file = name.toLowerCase().endsWith(".recordly") ? name : `${name}.recordly`;
	return `${folder.path}${separator}${file}`;
}

export const projectOps: EditorOpMap = {
	"project.save": async (payload, context) => {
		const args = requireObject(payload, "project.save");
		rejectUnknown(args, ["name"], "project.save");
		const name = readName(args.name, "project.save");
		const project = requireProject(context, "project.save");
		const snapshot = project.snapshot;
		if (!snapshot)
			throw new Error("There is no recording loaded, so project.save has nothing to save.");
		const result = await within(
			window.electronAPI.saveProjectFileNamed(snapshot, name, null, "copy"),
			"the project file to be written",
		);
		if (!result.success || !result.path) {
			throw new Error(
				`${result.message ?? result.error ?? "The project could not be saved."} Nothing was changed.`,
			);
		}
		project.markSaved({ path: result.path, projectId: result.projectId });
		return {
			saved: true,
			name,
			path: result.path,
			videoPath: snapshot.videoPath,
			counts: counts(snapshot.editor),
			look: lookOf(snapshot.editor),
			note: "Clips, zooms, annotations, captions, audio, speeds and the look are all in the file. It is on disk, so it survives a restart; open it again with project.open.",
		};
	},

	"project.open": async (payload, context) => {
		const args = requireObject(payload, "project.open");
		rejectUnknown(args, ["name", "path", "discard"], "project.open");
		if (args.discard !== undefined && typeof args.discard !== "boolean") {
			throw new Error("project.open: discard must be true or false.");
		}
		const project = context.project;
		if (!project) throw new Error("Project files are unavailable in this editor.");
		requireIdle(context, "opening a project");
		if (project.hasUnsavedChanges && args.discard !== true) {
			throw new Error(
				"The current edit has changes that are not saved. Call project.save first, or pass discard: true to replace them.",
			);
		}
		const path = await resolveOpenPath(args);
		const loaded = await within(
			window.electronAPI.openProjectFileAtPath(path),
			`the project file ${path} to be read`,
		);
		if (!loaded.success || !loaded.project) {
			const reason = loaded.message ?? loaded.error ?? `Could not open ${path}.`;
			throw new Error(
				`${reason}${/[.!?]$/.test(reason) ? "" : "."} The editor was not changed.`,
			);
		}
		if (!validateProjectData(loaded.project)) {
			throw new Error(`${path} is not a Recordly project file. The editor was not changed.`);
		}
		const data: EditorProjectData = loaded.project;
		const applied = await within(
			project.applyLoaded(data, loaded.path ?? path),
			"the editor to apply the project",
		);
		if (!applied) {
			throw new Error(`${path} could not be applied to the editor.`);
		}
		const videoPath = fromFileUrl(data.videoPath);
		return {
			opened: true,
			path: loaded.path ?? path,
			videoPath,
			videoChanged: videoPath !== context.videoSourcePath,
			counts: counts(normalizeProjectEditor(data.editor)),
			note: "The editor is reloading the recording. Wait for get_editor_state to answer before the next edit.",
		};
	},

	"project.new": (payload, context) => {
		rejectUnknown(requireObject(payload, "project.new"), [], "project.new");
		const project = requireProject(context, "project.new");
		requireIdle(context, "starting a new edit");
		const durationMs = Math.round(context.duration * 1000);
		if (!(durationMs > 0)) {
			throw new Error(
				"The recording has not finished loading, so project.new cannot rebuild its clip.",
			);
		}
		const { timeline } = context;
		const cleared = counts({
			clipRegions: timeline.clipRegions,
			zoomRegions: timeline.zoomRegions,
			annotationRegions: timeline.annotationRegions,
			autoCaptions: timeline.autoCaptions,
			audioRegions: timeline.audioRegions,
			speedRegions: timeline.speedRegions,
		});
		timeline.setZoomRegions([]);
		timeline.setTrimRegions([]);
		timeline.setSpeedRegions([]);
		timeline.setAnnotationRegions([]);
		timeline.setAudioRegions([]);
		timeline.setAutoCaptions([]);
		timeline.setClipRegions([
			{ id: nextId(context.ids.clip, "clip"), startMs: 0, endMs: durationMs, speed: 1 },
		]);
		timeline.setSelectedZoomId(null);
		timeline.setSelectedClipId(null);
		timeline.setSelectedAnnotationId(null);
		timeline.setSelectedAudioId(null);
		project.detach();
		return {
			cleared,
			undoable: true,
			note: "Clips, zooms, speeds, annotations, captions and audio were cleared and history.undo restores them (trim regions are not in the undo history). The look and cursor settings were left as they are. The editor is no longer attached to the saved project, so later changes will not overwrite it.",
		};
	},
};
