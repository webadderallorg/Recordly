import { type EditorProjectData, stripProjectUserPreferences } from "./projectPersistence";

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

function normalizeProjectComparison(project: EditorProjectData | null) {
	if (!project?.editor || typeof project.editor !== "object") {
		return project;
	}

	const editor = stripProjectUserPreferences(project.editor) as Record<string, unknown>;
	// A loaded clip sequence projects these source gaps once duration is known.
	// Only clip edits are user changes; legacy trim-only projects still compare trims.
	if (Array.isArray(editor.clipRegions) && editor.clipRegions.length > 0) {
		delete editor.trimRegions;
	}
	return { ...project, editor };
}

export function hasUnsavedProjectChanges(
	currentProjectSnapshot: EditorProjectData | null,
	lastSavedSnapshot: EditorProjectData | null,
): boolean {
	const comparableCurrentSnapshot = normalizeProjectComparison(currentProjectSnapshot);
	const comparableLastSavedSnapshot = normalizeProjectComparison(lastSavedSnapshot);

	return Boolean(
		comparableCurrentSnapshot &&
			(!comparableLastSavedSnapshot ||
				!areDeepEqual(comparableCurrentSnapshot, comparableLastSavedSnapshot)),
	);
}
