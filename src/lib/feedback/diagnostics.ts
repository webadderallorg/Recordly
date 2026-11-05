import packageInfo from "../../../package.json";
import { redactDiagnostic } from "./diagnosticRedaction";
import { getExportDiagnosticLogs } from "./exportDiagnostics";
export { redactDiagnostic } from "./diagnosticRedaction";

const entries: string[] = [];
let installed = false;

/** Keep handled failures and operation milestones in the user-requested snapshot too. */
export function recordFeedbackDiagnostic(message: string) {
	record("diagnostic", [message]);
}

function record(level: string, args: unknown[]) {
	// Do not serialize arbitrary objects: they may contain session or project data.
	const message = args
		.map((value) =>
			value instanceof Error
				? value.message
				: typeof value === "string"
					? value
					: `[${typeof value}]`,
		)
		.join(" ");
	entries.push(`${new Date().toISOString()} ${level}: ${redactDiagnostic(message)}`);
	if (entries.length > 100) entries.shift();
}
export function installFeedbackDiagnostics() {
	if (installed) return;
	installed = true;
	for (const level of ["warn", "error"] as const) {
		const original = console[level].bind(console);
		console[level] = (...args: unknown[]) => {
			record(level, args);
			original(...args);
		};
	}
	window.addEventListener("error", (event) => record("error", [event.message]));
	window.addEventListener("unhandledrejection", (event) => record("rejection", [event.reason]));
}
const MAX_DIAGNOSTIC_BYTES = 290_000;
export function feedbackDiagnostics(exportLogs: string[] = []) {
	const metadata = {
		capturedAt: new Date().toISOString(),
		appVersion: packageInfo.version,
		platform: navigator.platform.slice(0, 2000),
		userAgent: navigator.userAgent.slice(0, 2000),
	};
	const logs = [...entries, ...exportLogs]
		.map(redactDiagnostic)
		.sort((a, b) => a.slice(0, 24).localeCompare(b.slice(0, 24)));
	const encoder = new TextEncoder();
	let payload = JSON.stringify({ ...metadata, logs });
	while (encoder.encode(payload).byteLength > MAX_DIAGNOSTIC_BYTES && logs.length) {
		logs.shift();
		payload = JSON.stringify({ ...metadata, logs });
	}
	return payload;
}

/** Read persisted export history only when preparing a user-requested report. */
export async function collectFeedbackDiagnostics() {
	return feedbackDiagnostics(await getExportDiagnosticLogs());
}
