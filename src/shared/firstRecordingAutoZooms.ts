export const AUTO_ZOOM_RECORDING_LIMIT = 3;

export interface FirstRecordingAutoZooms {
	recordings: string[];
	handled: string[];
}

export function normalizeFirstRecordingAutoZooms(value: unknown): FirstRecordingAutoZooms {
	const raw = value as Partial<FirstRecordingAutoZooms> | null;
	const recordings = Array.isArray(raw?.recordings)
		? [
				...new Set(
					raw.recordings.filter(
						(path): path is string => typeof path === "string" && path.length > 0,
					),
				),
			].slice(0, AUTO_ZOOM_RECORDING_LIMIT)
		: [];
	return {
		recordings,
		handled: Array.isArray(raw?.handled)
			? recordings.filter((path) => raw.handled?.includes(path))
			: [],
	};
}
