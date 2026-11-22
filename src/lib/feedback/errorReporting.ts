import type { AppErrorReport } from "../../../services/supabase/functions/_shared/appErrorReport";
import { collectFeedbackDiagnostics, redactDiagnostic } from "./diagnostics";
import { submitExportErrorReport } from "./exportErrorReporting";

export async function buildErrorReport(
	error: string,
	context = "application",
	format: AppErrorReport["format"] = "unknown",
): Promise<AppErrorReport> {
	return {
		schemaVersion: 2,
		cloudPlan: "unknown",
		format,
		context,
		error: redactDiagnostic(error) || "Unknown error",
		logs: await collectFeedbackDiagnostics(),
	};
}

/** This action is invoked only by a user's Report button click. */
export async function reportError(
	error: string,
	context = "application",
	format: AppErrorReport["format"] = "unknown",
) {
	await submitExportErrorReport(await buildErrorReport(error, context, format));
}
