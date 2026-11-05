import { recordFeedbackDiagnostic, redactDiagnostic } from "../feedback/diagnostics";

export type SignInAction =
	| "code"
	| "verify"
	| "password"
	| "signout"
	| "google"
	| "azure"
	| "apple";
type AuthStage =
	| `sign-in-${SignInAction}`
	| "session-restore"
	| "session-event"
	| "provider-discovery"
	| "callback-read"
	| "callback-delivery"
	| "callback-completion"
	| "callback-verifier"
	| "callback-token-exchange"
	| "callback-consent-save";

export function recordAuthEvent(
	stage: AuthStage,
	outcome: "started" | "succeeded" | "empty" | "signed-in" | "signed-out",
) {
	recordFeedbackDiagnostic(`[auth] ${stage}: ${outcome}`);
}

/** Select error fields explicitly. Never serialize sessions, request bodies or callback URLs. */
export function describeAuthFailure(stage: AuthStage, error: unknown): string {
	const lines = [`[auth] ${stage}: failed`];
	let current = error;
	for (let depth = 0; depth < 3 && current != null; depth++) {
		if (depth) lines.push("Caused by:");
		if (typeof current === "string") {
			lines.push(redactDiagnostic(current));
			break;
		}
		if (typeof current !== "object") break;
		try {
			const detail = current as Record<string, unknown>;
			for (const key of ["name", "code", "status", "message", "stack"] as const) {
				const value = detail[key];
				if (typeof value === "string" || (key === "status" && typeof value === "number"))
					lines.push(`${key}: ${redactDiagnostic(String(value))}`);
			}
			current = detail.cause ?? detail.originalError;
		} catch {
			// Reporting an unusual thrown value must not replace the original failure.
			lines.push("Error details unavailable");
			break;
		}
	}
	return redactDiagnostic(lines.join("\n"));
}

export function captureAuthFailure(stage: AuthStage, error: unknown): string {
	const diagnostic = describeAuthFailure(stage, error);
	recordFeedbackDiagnostic(diagnostic);
	return diagnostic;
}

export async function traceAuthOperation<T>(
	stage: AuthStage,
	action: () => Promise<T>,
): Promise<T> {
	recordAuthEvent(stage, "started");
	try {
		const result = await action();
		recordAuthEvent(stage, "succeeded");
		return result;
	} catch (error) {
		captureAuthFailure(stage, error);
		throw error;
	}
}
