export function parseSharedRecordingDate(value?: string): number {
	if (!value) return 0;
	const parsed = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
	return Number.isFinite(parsed) ? parsed : 0;
}
