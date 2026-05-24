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

export function hasUnsavedProjectChanges(
	currentProjectSnapshot: EditorProjectData | null,
	lastSavedSnapshot: EditorProjectData | null,
): boolean {
	return Boolean(
		currentProjectSnapshot &&
			(!lastSavedSnapshot || !areDeepEqual(currentProjectSnapshot, lastSavedSnapshot)),
	);
}
