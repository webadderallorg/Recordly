import { isExportErrorReport, type ExportErrorReport } from "../_shared/exportErrorReport.ts";
const MAX_BYTES = 4096;
const headers = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "apikey, content-type",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Content-Type": "application/json",
};
const reply = (status: number, code?: string) =>
	new Response(JSON.stringify(code ? { code } : { success: true }), { status, headers });
export interface ExportErrorBackend {
	reserve(): Promise<boolean>;
	insert(report: ExportErrorReport): Promise<void>;
}
/** Public, minimal reports only. No identity/IP/device identifier is read or persisted. */
export function exportErrorHandler(backend: ExportErrorBackend) {
	return async (request: Request): Promise<Response> => {
		if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
		if (request.method !== "POST") return reply(405, "METHOD_NOT_ALLOWED");
		if (request.headers.has("Authorization")) return reply(400, "IDENTITY_NOT_ACCEPTED");
		if (!request.headers.get("Content-Type")?.startsWith("application/json"))
			return reply(400, "INVALID_REPORT");
		let report: unknown;
		try {
			const reader = request.body?.getReader();
			if (!reader) return reply(400, "INVALID_REPORT");
			const chunks: Uint8Array[] = [];
			let size = 0;
			try {
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					size += value.byteLength;
					if (size > MAX_BYTES) return reply(413, "REPORT_TOO_LARGE");
					chunks.push(value);
				}
			} finally {
				await reader.cancel();
			}
			const bytes = new Uint8Array(size);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			report = JSON.parse(new TextDecoder().decode(bytes));
		} catch {
			return reply(400, "INVALID_REPORT");
		}
		if (!isExportErrorReport(report)) return reply(400, "INVALID_REPORT");
		try {
			if (!(await backend.reserve())) return reply(429, "REPORT_LIMIT");
			await backend.insert(report);
			return reply(200);
		} catch {
			return reply(500, "SUBMISSION_FAILED");
		}
	};
}
