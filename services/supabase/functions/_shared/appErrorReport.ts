import { isExportErrorReport, type ExportErrorReport } from "./exportErrorReport.ts";

export interface AppErrorReport {
	schemaVersion: 2;
	cloudPlan: "unknown";
	format: "mp4" | "gif" | "unknown";
	context: string;
	error: string;
	/** Bounded, redacted diagnostic snapshot. Never media or attachments. */
	logs: string;
}
export type SupportErrorReport = ExportErrorReport | AppErrorReport;
export function isSupportErrorReport(value: unknown): value is SupportErrorReport {
	if (isExportErrorReport(value)) return true;
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const report = value as Record<string, unknown>;
	return (
		Object.keys(report).every((key) =>
			["schemaVersion", "cloudPlan", "format", "context", "error", "logs"].includes(key),
		) &&
		report.schemaVersion === 2 &&
		report.cloudPlan === "unknown" &&
		typeof report.format === "string" &&
		["mp4", "gif", "unknown"].includes(report.format) &&
		typeof report.context === "string" &&
		/^[a-z][a-z-]{0,79}$/.test(report.context) &&
		typeof report.error === "string" &&
		report.error.length > 0 &&
		report.error.length <= 2000 &&
		typeof report.logs === "string" &&
		new TextEncoder().encode(report.logs).byteLength <= 290_000
	);
}
