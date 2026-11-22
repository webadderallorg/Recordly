export interface RecordingWebcamSource {
	sourcePath: string | null;
	timeOffsetMs: number;
	visibleRanges?: { startMs: number; endMs: number }[];
}
export interface RecordingLibraryEntry {
	path: string;
	name: string;
	createdAt: number;
	bytes: number;
	url: string;
}
export interface RecordingImportResult {
	path: string;
	url: string;
	sourceStartMs: number;
	durationMs: number;
	totalDurationMs: number;
	webcam?: RecordingWebcamSource;
}
export type LibraryResult<T> = { success: true; value: T } | { success: false; error: string };
export const RECORDING_DRAG_TYPE = "application/x-recordly-recording";
