import type { DiagnosticSurface } from "../../shared/operationDiagnostics";
import { redactDiagnostic } from "./diagnosticRedaction";

export type CrashView = DiagnosticSurface;

export interface CrashDiagnostic {
	view: CrashView;
	occurredAt: string;
	errorName: string;
	message: string;
	stack: string[];
	componentStack: string[];
	activeOperations?: { name: string; stage?: string; operationId: string }[];
}

function stackFrames(stack: unknown, appUrl: string): string[] {
	if (typeof stack !== "string") return [];
	const assetsUrl = new URL("./assets/", appUrl).href;
	const sourceUrl = new URL("./src/", appUrl).href;
	return stack
		.split("\n")
		.filter((line) => /^\s*at\s/.test(line))
		.slice(0, 16)
		.map((line) => {
			const frame = line
				.trim()
				.replace(
					/((?:https?:\/\/|file:\/\/)[^\s()]+):(\d+):(\d+)(?=\)?$)/,
					(_match, source: string, lineNumber: string, column: string) => {
						const path = source.split("?")[0];
						const asset = path.startsWith(assetsUrl)
							? path.slice(assetsUrl.length).match(/^[\w.-]+\.js$/)?.[0]
							: undefined;
						const module = path.startsWith(sourceUrl)
							? path
									.slice(sourceUrl.length)
									.match(/^(?:[\w-]+\/)*[\w.-]+\.[jt]sx?$/)?.[0]
							: undefined;
						return `${asset ?? (module ? `src/${module}` : "[source]")}:${lineNumber}:${column}`;
					},
				);
			return redactDiagnostic(frame).slice(0, 240);
		});
}

export function captureCrash(
	error: unknown,
	componentStack: string,
	view: CrashView,
): CrashDiagnostic {
	const fallback = {
		view,
		occurredAt: new Date().toISOString(),
		errorName: "Error",
		message: "Unexpected application error",
		stack: [],
		componentStack: [],
	};
	try {
		const appUrl = window.location.href;
		const exception = error instanceof Error ? error : undefined;
		const message = exception?.message ?? error;
		return {
			...fallback,
			errorName: redactDiagnostic(exception?.name || fallback.errorName).slice(0, 80),
			message:
				typeof message === "string" && message
					? redactDiagnostic(message)
					: fallback.message,
			stack: stackFrames(exception?.stack, appUrl),
			componentStack: stackFrames(componentStack, appUrl),
		};
	} catch {
		return fallback;
	}
}
