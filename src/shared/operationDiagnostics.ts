export const OPERATION_HISTORY_LIMIT = 180;

export const diagnosticSurfaces = [
	"application",
	"home",
	"editor",
	"hud-overlay",
	"source-selector",
	"capture-picker",
	"countdown",
	"update-toast",
	"onboarding",
	"onboarding-intro",
	"permission-accessory",
] as const;

export type DiagnosticSurface = (typeof diagnosticSurfaces)[number];
type OperationSource = "renderer" | "ipc" | "main";
type OperationOutcome = "succeeded" | "failed" | "cancelled" | "blocked";

export interface OperationEvent {
	timestamp: string;
	name: string;
	surface: DiagnosticSurface;
	source: OperationSource;
	operationId: string;
	parentOperationId?: string;
	sequence: number;
	phase: "start" | "step" | "finish";
	stage?: string;
	outcome?: OperationOutcome;
	elapsedMs?: number;
	appRunId?: string;
	windowId?: number;
}

const identifier = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const operationName = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]{0,63}$/;
const id = /^[a-f0-9]{16}$/;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function diagnosticSurface(value: unknown): DiagnosticSurface {
	return diagnosticSurfaces.find((surface) => surface === value) ?? "application";
}

export function newDiagnosticId() {
	const parts = new Uint32Array(2);
	if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(parts);
	else for (let index = 0; index < parts.length; index++) parts[index] = Math.random() * 2 ** 32;
	return Array.from(parts, (part) => part.toString(16).padStart(8, "0")).join("");
}

/** Validate and copy only the fields that can be written to a support report. */
export function parseOperationEvent(value: unknown): OperationEvent | undefined {
	if (!value || typeof value !== "object") return undefined;
	const {
		timestamp: time,
		name,
		surface,
		source,
		operationId,
		parentOperationId,
		sequence,
		phase,
		stage,
		outcome,
		elapsedMs,
		appRunId,
		windowId,
	} = value as OperationEvent;
	if (
		typeof time !== "string" ||
		!timestamp.test(time) ||
		!Number.isFinite(Date.parse(time)) ||
		typeof name !== "string" ||
		name.length > 80 ||
		!operationName.test(name) ||
		diagnosticSurface(surface) !== surface ||
		(source !== "renderer" && source !== "ipc" && source !== "main") ||
		typeof operationId !== "string" ||
		!id.test(operationId) ||
		(parentOperationId !== undefined &&
			(typeof parentOperationId !== "string" || !id.test(parentOperationId))) ||
		!Number.isSafeInteger(sequence) ||
		sequence < 0 ||
		sequence > 1000 ||
		(phase !== "start" && phase !== "step" && phase !== "finish") ||
		(stage !== undefined && (typeof stage !== "string" || !identifier.test(stage))) ||
		(phase === "step" && stage === undefined) ||
		(phase === "finish"
			? !["succeeded", "failed", "cancelled", "blocked"].includes(outcome ?? "")
			: outcome !== undefined) ||
		(elapsedMs !== undefined && (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0)) ||
		(appRunId !== undefined && (typeof appRunId !== "string" || !id.test(appRunId))) ||
		(windowId !== undefined && (!Number.isSafeInteger(windowId) || windowId < 1))
	)
		return undefined;
	return {
		timestamp: time,
		name,
		surface,
		source,
		operationId,
		parentOperationId,
		sequence,
		phase,
		stage,
		outcome,
		elapsedMs,
		appRunId,
		windowId,
	};
}

/** Use fixed names and stages. Payloads, paths, user input and responses are excluded. */
export function startDiagnosticOperation(
	emit: (event: OperationEvent) => void,
	context: Pick<OperationEvent, "name" | "surface" | "source" | "parentOperationId">,
) {
	const operationId = newDiagnosticId();
	const startedAt = performance.now();
	let sequence = 0;
	let finished = false;
	let currentStage: string | undefined;
	const record = (phase: OperationEvent["phase"], outcome?: OperationOutcome) => {
		try {
			const event = parseOperationEvent({
				...context,
				operationId,
				timestamp: new Date().toISOString(),
				sequence: sequence++,
				phase,
				stage: currentStage,
				outcome,
				elapsedMs:
					phase === "start" ? undefined : Math.round(performance.now() - startedAt),
			});
			if (event) emit(event);
		} catch {
			// Instrumentation must not change the operation's behavior.
		}
	};
	record("start");
	return {
		id: operationId,
		step(stage: string) {
			if (finished || stage === currentStage) return;
			currentStage = stage;
			record("step");
		},
		finish(outcome: OperationOutcome) {
			if (finished) return;
			finished = true;
			record("finish", outcome);
		},
	};
}
