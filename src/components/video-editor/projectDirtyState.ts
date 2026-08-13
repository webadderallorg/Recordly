import type { EditorProjectData } from "./projectPersistence";

function isComparableObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function areDeepEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}

	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
			return false;
		}

		for (let index = 0; index < left.length; index += 1) {
			if (!areDeepEqual(left[index], right[index])) {
				return false;
			}
		}

		return true;
	}

	if (!isComparableObject(left) || !isComparableObject(right)) {
		return false;
	}

	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) {
		return false;
	}

	for (const key of leftKeys) {
		if (!(key in right) || !areDeepEqual(left[key], right[key])) {
			return false;
		}
	}

	return true;
}

function omitTransientWebcamMediaFields(project: EditorProjectData | null) {
	if (!project?.editor || typeof project.editor !== "object") {
		return project;
	}

	const editor = project.editor as Record<string, unknown>;
	const webcam = editor.webcam;
	if (!isComparableObject(webcam)) {
		return project;
	}

	const {
		enabled: _enabled,
		sourcePath: _sourcePath,
		timeOffsetMs: _timeOffsetMs,
		...persistentWebcamFields
	} = webcam;

	return {
		...project,
		editor: {
			...editor,
			webcam: persistentWebcamFields,
		},
	};
}

export function hasUnsavedProjectChanges(
	currentProjectSnapshot: EditorProjectData | null,
	lastSavedSnapshot: EditorProjectData | null,
): boolean {
	const comparableCurrentSnapshot = omitTransientWebcamMediaFields(currentProjectSnapshot);
	const comparableLastSavedSnapshot = omitTransientWebcamMediaFields(lastSavedSnapshot);

	return Boolean(
		comparableCurrentSnapshot &&
			(!comparableLastSavedSnapshot ||
				!areDeepEqual(comparableCurrentSnapshot, comparableLastSavedSnapshot)),
	);
}
