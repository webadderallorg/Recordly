import type { WebDemuxer } from "web-demuxer";
import { redactDiagnostic } from "../feedback/diagnosticRedaction";
import { recordExportDiagnostic } from "../feedback/exportDiagnostics";
import type { ExportDiagnosticCallbacks } from "./types";

const workerSignals = new WeakMap<WebDemuxer, AbortSignal>();

export class VideoDemuxerWorkerError extends Error {
	constructor(code: "VIDEO_READER_WORKER_ERROR" | "VIDEO_READER_WORKER_MESSAGE_ERROR") {
		super(`[${code}] Video reader worker failed`);
	}
}

export function getVideoDemuxerSignal(
	demuxer: WebDemuxer,
	signal?: AbortSignal,
	recordDiagnostic: NonNullable<
		ExportDiagnosticCallbacks["onDiagnostic"]
	> = recordExportDiagnostic,
): AbortSignal | undefined {
	let failure = workerSignals.get(demuxer);
	if (!failure) {
		// web-demuxer 4.0.0 waits for protocol replies and does not expose worker errors.
		// Keep this optional integration at the vendor boundary so a changed worker
		// implementation can still use the existing deadlines.
		const worker: unknown = Reflect.get(demuxer, "wasmWorker");
		if (!(worker instanceof EventTarget)) return signal;
		const controller = new AbortController();
		const fail = (event: Event) => {
			const code =
				event.type === "messageerror"
					? "VIDEO_READER_WORKER_MESSAGE_ERROR"
					: "VIDEO_READER_WORKER_ERROR";
			// Dedicated worker errors may carry a reason. Their URL, stack and message payload are unnecessary.
			const reason =
				typeof ErrorEvent !== "undefined" && event instanceof ErrorEvent
					? redactDiagnostic(event.message).slice(0, 240) || undefined
					: undefined;
			controller.abort(new VideoDemuxerWorkerError(code));
			recordDiagnostic("video-reader-failure", { code, reason });
		};
		worker.addEventListener("error", fail, { signal: controller.signal });
		worker.addEventListener("messageerror", fail, { signal: controller.signal });
		failure = controller.signal;
		workerSignals.set(demuxer, failure);
	}
	return signal ? AbortSignal.any([signal, failure]) : failure;
}
