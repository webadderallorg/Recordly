import {
	ANNOTATION_ROW_ID,
	ANNOTATION_ROW_PREFIX,
	AUDIO_ROW_ID,
	AUDIO_ROW_PREFIX,
} from "./constants";

export function getAnnotationTrackRowId(trackIndex: number) {
	return `${ANNOTATION_ROW_ID}-${Math.max(0, Math.floor(trackIndex))}`;
}

export function isAnnotationTrackRowId(rowId: string) {
	return rowId === ANNOTATION_ROW_ID || rowId.startsWith(ANNOTATION_ROW_PREFIX);
}

export function getAnnotationTrackIndex(rowId: string) {
	if (rowId === ANNOTATION_ROW_ID) {
		return 0;
	}

	const parsed = Number.parseInt(rowId.slice(ANNOTATION_ROW_PREFIX.length), 10);
	return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function getAudioTrackRowId(trackIndex: number) {
	return `${AUDIO_ROW_PREFIX}${Math.max(0, Math.floor(trackIndex))}`;
}

export function isAudioTrackRowId(rowId: string) {
	return rowId === AUDIO_ROW_ID || rowId.startsWith(AUDIO_ROW_PREFIX);
}

export function getAudioTrackIndex(rowId: string) {
	if (rowId === AUDIO_ROW_ID) {
		return 0;
	}

	const parsed = Number.parseInt(rowId.slice(AUDIO_ROW_PREFIX.length), 10);
	return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}
