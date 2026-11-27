import type { OperationEvent } from "../../shared/operationDiagnostics";

interface ExportSummary {
	id: string;
	startedAt?: string;
	updatedAt: string;
	status:
		| "in-progress"
		| "no-progress"
		| "interrupted"
		| "failed"
		| "succeeded"
		| "cancelled"
		| "blocked";
	format?: string;
	destination?: string;
	stage?: string;
	route?: string;
	frame?: number;
	lastCompletedFrame?: number;
	totalFrames?: number;
	renderBackend?: string;
	encodeBackend?: string;
	encoderName?: string;
	code?: string;
	reason?: string;
	interruption?: string;
	idleMs?: number;
	elapsedMs?: number;
	width?: number;
	height?: number;
	frameRate?: number;
	recoveryCount?: number;
	cancellation?: string;
	lastRecovery?: { route?: string; reason?: string };
	lastMediaFailure?: { asset: string; mediaStage: string; code: string; reason?: string };
	source?: { codec?: string; duration?: number; width?: number; height?: number };
}

const textFields = [
	"format",
	"destination",
	"stage",
	"route",
	"renderBackend",
	"encodeBackend",
	"encoderName",
	"code",
	"reason",
	"cancellation",
] as const;
const numberFields = [
	"frame",
	"lastCompletedFrame",
	"totalFrames",
	"elapsedMs",
	"width",
	"height",
	"frameRate",
	"recoveryCount",
] as const;

/** Pull the support summary from the durable log, including exports with no terminal result. */
export function summarizeExportDiagnostics(
	logs: string[],
	operations: OperationEvent[],
	currentAppRunId?: string,
): ExportSummary[] {
	const runs = new Map<string, ExportSummary>();
	for (const line of logs) {
		const match = line.match(/^(\d\S+) info: \[export\] ([a-z-]+) (\{.*\})$/);
		if (!match) continue;
		const [, time, event, json] = match;
		let fields: Record<string, unknown>;
		try {
			fields = JSON.parse(json);
		} catch {
			continue;
		}
		const id = fields.attempt;
		if (typeof id !== "string" || !/^[a-f0-9]{16}$/.test(id)) continue;
		const run: ExportSummary = runs.get(id) ?? { id, updatedAt: time, status: "in-progress" };
		runs.set(id, run);
		run.updatedAt = time;
		if (event === "started") run.startedAt = time;
		const mediaFailure = event === "renderer-media-failure" ? fields : fields.lastMediaFailure;
		if (mediaFailure && typeof mediaFailure === "object") {
			const { asset, mediaStage, code, reason } = mediaFailure as Record<string, unknown>;
			if (
				typeof asset === "string" &&
				typeof mediaStage === "string" &&
				typeof code === "string"
			) {
				run.lastMediaFailure = {
					asset: asset.slice(0, 40),
					mediaStage: mediaStage.slice(0, 40),
					code: code.slice(0, 64),
					reason: typeof reason === "string" ? reason.slice(0, 160) : undefined,
				};
			}
		}
		if (event === "renderer-media-failure") continue;
		if (event === "attempt-start" || event === "stage" || event === "activity-resumed") {
			run.status = "in-progress";
			run.idleMs = undefined;
			if (event === "attempt-start") {
				run.lastCompletedFrame = undefined;
				run.reason = undefined;
				run.code = undefined;
			}
			run.frame = undefined;
		}
		if (event === "no-progress") {
			run.status = "no-progress";
			if (typeof fields.idleMs === "number") run.idleMs = fields.idleMs;
		}
		if (event === "source-metadata") {
			run.source = {
				codec: typeof fields.codec === "string" ? fields.codec.slice(0, 64) : undefined,
				duration: typeof fields.duration === "number" ? fields.duration : undefined,
				width: typeof fields.width === "number" ? fields.width : undefined,
				height: typeof fields.height === "number" ? fields.height : undefined,
			};
			continue;
		}
		if (
			event === "recovery-started" ||
			event === "video-reader-retry" ||
			(event === "backend" && fields.status === "retry")
		) {
			const retryRoute =
				event === "video-reader-retry"
					? "video-reader"
					: (fields.backendRoute ?? fields.route);
			const retryReason = fields.initialError ?? fields.reason;
			run.lastRecovery = {
				route: typeof retryRoute === "string" ? retryRoute.slice(0, 64) : undefined,
				reason: typeof retryReason === "string" ? retryReason.slice(0, 400) : undefined,
			};
		}
		// Backend decisions describe their own route and reason. Keep them distinct from the final failure.
		if (event === "backend" || event === "recovery-started" || event === "video-reader-retry")
			continue;
		if (
			event === "progress" &&
			fields.phase === "extracting" &&
			typeof fields.currentFrame === "number"
		) {
			run.lastCompletedFrame = fields.currentFrame;
		}
		for (const key of textFields) {
			const value = fields[key];
			if (typeof value === "string") run[key] = value.slice(0, key === "reason" ? 400 : 120);
		}
		for (const key of numberFields) {
			const value = fields[key];
			if (typeof value === "number" && Number.isFinite(value)) run[key] = value;
		}
		if (event === "complete") {
			run.frame = typeof fields.frame === "number" ? fields.frame : undefined;
			if (fields.source && typeof fields.source === "object") {
				const { codec, duration, width, height } = fields.source as Record<string, unknown>;
				if (
					typeof codec === "string" &&
					typeof duration === "number" &&
					typeof width === "number" &&
					typeof height === "number"
				) {
					run.source = { codec: codec.slice(0, 64), duration, width, height };
				}
			}
			if (fields.lastRecovery && typeof fields.lastRecovery === "object") {
				const { route, reason } = fields.lastRecovery as Record<string, unknown>;
				if (typeof route === "string")
					run.lastRecovery = {
						route: route.slice(0, 64),
						reason: typeof reason === "string" ? reason.slice(0, 250) : undefined,
					};
			}
			const outcome = fields.outcome;
			if (
				outcome === "failed" ||
				outcome === "succeeded" ||
				outcome === "cancelled" ||
				outcome === "blocked"
			)
				run.status = outcome;
			run.reason =
				outcome === "failed" && typeof fields.reason === "string"
					? fields.reason.slice(0, 400)
					: undefined;
			run.code =
				outcome === "failed" && typeof fields.code === "string"
					? fields.code.slice(0, 120)
					: undefined;
			run.idleMs = undefined;
		}
	}

	return [...runs.values()]
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
		.slice(0, 4)
		.map((run) => {
			if (run.status !== "in-progress" && run.status !== "no-progress") return run;
			const operation = operations.find(
				(event) => event.operationId === run.id && event.appRunId,
			);
			if (!operation) return run;
			const rendererExit =
				operation.appRunId &&
				operation.windowId !== undefined &&
				operations.find(
					(event) =>
						event.name === "app.renderer-exit" &&
						event.phase === "finish" &&
						event.windowId === operation.windowId &&
						event.appRunId === operation.appRunId &&
						event.timestamp >= run.updatedAt,
				);
			if (rendererExit)
				return {
					...run,
					status: "interrupted",
					interruption: rendererExit.stage ?? "renderer-exit",
				};
			if (operation.appRunId && currentAppRunId && operation.appRunId !== currentAppRunId) {
				return { ...run, status: "interrupted", interruption: "app-session-ended" };
			}
			return run;
		});
}
