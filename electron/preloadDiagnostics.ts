import { ipcRenderer } from "electron";
import {
	diagnosticSurface,
	type OperationEvent,
	startDiagnosticOperation,
} from "../src/shared/operationDiagnostics";

export function sendOperationDiagnostic(event: OperationEvent) {
	void ipcRenderer.invoke("app-diagnostics:operation", event).catch(() => undefined);
}

export async function invokeWithDiagnostics(channel: string, ...args: unknown[]) {
	const surface = diagnosticSurface(
		document.documentElement?.dataset.diagnosticView ??
			new URLSearchParams(location.search).get("windowType"),
	);
	const operation = startDiagnosticOperation(sendOperationDiagnostic, {
		name: `ipc.${channel}`,
		source: "ipc",
		surface,
	});
	try {
		const result = await ipcRenderer.invoke(channel, ...args);
		// Read only conventional result flags. Never log arguments, responses or error text.
		operation.finish(
			result?.cancelled === true || result?.canceled === true
				? "cancelled"
				: result?.success === false || result?.ok === false
					? "failed"
					: "succeeded",
		);
		return result;
	} catch (error) {
		operation.finish("failed");
		throw error;
	}
}
